import { afterAll, describe, expect, it } from "vitest";
import { factsOfRepo } from "./blobs.ts";
import { manifestsOfRepo } from "./manifests.ts";
import { queryOf } from "./query.ts";
import { homeFacts, labelsOfLine, TEST_SUPPORT, precisionOf, raterOfText, REFERENCE_NOTE, referenceMarkdown, referenceOf, type Rater } from "./reference.ts";
import type { SampleFile, SampleItem } from "./sample.ts";
import { Catalog } from "./store.ts";
import { GitRepos } from "./testing/git-repo.ts";

const item = (subject: string, repo = "app", path = "src/a.ts"): SampleItem => ({ subject, repo, commit: null, path, name: subject, line: 1, endLine: 3, nodes: 50, copies: 1 });
const sample: SampleFile = {
  version: "sample/1",
  seed: "test",
  rule: "test",
  tasks: [
    { task: "home", target: 0.9, expected: 0.97, n: 4, audit: 0 },
    { task: "purpose", target: 0.85, expected: 0.97, n: 2, audit: 0 },
  ],
  audit: 0,
  population: 4,
  size: 4,
  items: ["s1", "s2", "s3", "s4"].map((s) => item(s)),
};
const rater = (by: string, homes: readonly (string | undefined)[], purposes: readonly string[] = []): Rater => ({
  by,
  labels: [
    ...homes.flatMap((label, i) => (label === undefined ? [] : [{ subject: `s${i + 1}`, task: "home", label }])),
    ...purposes.map((label, i) => ({ subject: `s${i + 1}`, task: "purpose", label })),
  ],
});

describe("labelsOfLine and raterOfText", () => {
  it("reads a draft line and an answer line", () => {
    expect(labelsOfLine({ subject: "s1", area: "statistics", category: "compute", sentence: "x" })).toEqual([
      { subject: "s1", task: "home", label: "statistics" },
      { subject: "s1", task: "purpose", label: "compute" },
    ]);
    expect(raterOfText("c", '{"subject":"s2","home":"none"}\n\n').labels).toEqual([{ subject: "s2", task: "home", label: "none" }]);
  });
});

describe("referenceOf", () => {
  // s1: 3 of 3 agree. s2: 2 of 3. s3: 1-1-1, unknown. s4: two raters that differ and one with no label, unknown.
  const raters = [
    rater("a", ["statistics", "bench", "random", "cli"], ["compute", "parse"]),
    rater("b", ["statistics", "bench", "bench", "system-io"], ["compute", "file-io"]),
    rater("c", ["statistics", "random", "none", undefined], ["compute"]),
  ];

  it("takes the strict majority of the raters, and gives unknown with no majority", () => {
    const reference = referenceOf(sample, raters);
    expect(reference.note).toBe(REFERENCE_NOTE);
    expect(reference.labels.filter((l) => l.task === "home").map((l) => [l.label, l.by, l.votes, l.raters])).toEqual([
      ["statistics", "raters", 3, 3],
      ["bench", "raters", 2, 3],
      [null, "unknown", 1, 3],
      [null, "unknown", 1, 2],
    ]);
    // The purpose of s2: two raters that differ, and no third label
    expect(reference.tasks).toEqual([
      { task: "home", items: 4, fact: 0, raters: 2, unknown: 2, factChecked: 0, factAgree: 0 },
      { task: "purpose", items: 2, fact: 0, raters: 1, unknown: 1, factChecked: 0, factAgree: 0 },
    ]);
  });

  it("puts a fact before the raters, and counts the facts that the majority confirms", () => {
    const reference = referenceOf(sample, raters, [
      { subject: "s1", task: "home", label: "statistics", fact: "copy" },
      { subject: "s3", task: "home", label: "random", fact: "copy" },
    ]);
    expect(reference.labels.slice(0, 3).map((l) => [l.label, l.by])).toEqual([
      ["statistics", "fact"],
      ["bench", "raters"],
      ["random", "fact"],
    ]);
    expect(reference.tasks[0]).toMatchObject({ fact: 2, raters: 1, unknown: 1, factChecked: 1, factAgree: 1 });
  });
});

describe("precisionOf", () => {
  it("counts hits and misses against the reference, with no count for an unknown item, and a Wilson interval", () => {
    const reference = referenceOf(sample, [rater("a", ["statistics", "bench"]), rater("b", ["statistics", "bench"])], [{ subject: "s3", task: "home", label: "cli", fact: "copy" }]);
    const result = precisionOf(reference, rater("pilot", ["statistics", "random", "cli", "none"]));
    const home = result.tasks[0]!;
    expect(home).toMatchObject({ task: "home", note: REFERENCE_NOTE, hits: 2, misses: 1, unknown: 1, missing: 0, precision: 2 / 3 });
    expect(home.low).toBeGreaterThan(0);
    expect(home.high).toBeLessThan(1);
    expect(home.settled).toEqual({ fact: 1 / 3, raters: 2 / 3 });
    expect(home.labels.map((l) => [l.label, l.hits, l.misses])).toEqual([
      ["cli", 1, 0],
      ["random", 0, 1],
      ["statistics", 1, 0],
    ]);
    expect(result.tasks[1]).toMatchObject({ task: "purpose", hits: 0, misses: 0, missing: 2, precision: null });
    const markdown = referenceMarkdown(reference, [result]);
    expect(markdown).toContain(`Each figure is ${REFERENCE_NOTE}, with the Wilson 95 % interval.`);
    expect(markdown).toContain("| home | 66.7% |");
    expect(markdown).toContain("| purpose | not known |");
  });
});

describe("homeFacts", () => {
  it("finds the files of test support, and no other file", () => {
    const support = ["packages/lag/src/vitals/test-fakes.ts", "src/testing/git-repo.ts", "src/fakes/clock.ts", "src/mock.ts", "src/http.stub.mts"];
    const code = ["src/fake-news.ts", "src/stubborn.ts", "src/mockup/view.tsx", "src/vitals/fakes-of-time.ts"];
    expect(support.filter((p) => TEST_SUPPORT.test(p))).toEqual(support);
    expect(code.filter((p) => TEST_SUPPORT.test(p))).toEqual([]);
  });

  const repos = new GitRepos();
  afterAll(() => repos.removeAll());

  it("gives the area of a home package that exports a copy at another place", async () => {
    const catalog = new Catalog(":memory:");
    const body = "export function spread(values: number[]): number {\n  let low = values[0] ?? 0;\n  let high = low;\n  for (const v of values) {\n    if (v < low) low = v;\n    if (v > high) high = v;\n  }\n  return high - low;\n}\n";
    const put = (name: string, files: Readonly<Record<string, string>>): void => {
      const root = repos.with(files);
      const scan = factsOfRepo(name, root, catalog);
      const snapshot = catalog.putSnapshot(name, "c0", "2026-11-08T00:00:00Z", "test", scan.files, scan.counts);
      catalog.putManifests(snapshot, manifestsOfRepo(root));
    };
    put("rigor", { "packages/statistics/package.json": '{"name":"@mark1russell7/rigor-statistics"}', "packages/statistics/src/spread.ts": body });
    put("app", { "package.json": '{"name":"app"}', "src/a.ts": body.replace("spread", "range") });
    const q = queryOf(catalog.db);
    const subject = (await q.selectFrom("current_file as f").innerJoin("symbol as s", "s.blob", "f.blob").select("s.hash_renamed as h").where("f.repo", "=", "app").executeTakeFirstOrThrow()).h!;
    const facts = await homeFacts(q, [item(subject, "app", "src/a.ts")]);
    expect(facts).toEqual([{ subject, task: "home", label: "statistics", fact: "an exported copy in @mark1russell7/rigor-statistics (rigor/packages/statistics/src/spread.ts:1)" }]);
    // The copy in the home package itself is its own place, so the home function gets no fact from itself
    expect(await homeFacts(q, [item(subject, "rigor", "packages/statistics/src/spread.ts")])).toEqual([]);
    catalog.close();
  });
});
