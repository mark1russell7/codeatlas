import { describe, expect, it } from "vitest";
import type { Atlas, CloneClass, Member } from "@mark1russell7/codeatlas";
import { compilePage, pageHtml, parseSiteArgs, readAtlas } from "./build.ts";
import { matches, NO_FILTER, NO_TOPIC, pairShares, sourceUrl, stepOf, titleOf, topicRows } from "./page.ts";

const member = (repo: string, name: string, test = false): Member => ({ repo, file: `src/${name}.ts`, line: 3, name, exported: true, test });

const klass = (hash: string, nodes: number, members: Member[], topics: string[] = []): CloneClass => ({
  hash,
  nodes,
  repos: [...new Set(members.map((m) => m.repo))].sort(),
  members,
  duplicatedNodes: nodes * (members.length - 1),
  topics,
});

const repoRow = (repo: string, crossRepoClasses: number) => ({
  repo, commit: null, files: 1, functions: 1, nodes: 100, duplicatedNodes: 0, ratio: 0, crossRepoClasses, parseErrors: 0,
});

const ATLAS: Atlas = {
  schema: "codeatlas/1",
  minNodes: 40,
  totals: { repos: 3, files: 3, functions: 3, nodes: 300, duplicatedNodes: 150, ratio: 0.5, classes: 3, crossRepoClasses: 2 },
  repos: [repoRow("a", 2), repoRow("b", 1), repoRow("c", 1), repoRow("d", 0)],
  classes: [
    klass("1", 100, [member("a", "seeded"), member("b", "mulberry")], ["generators"]),
    klass("2", 50, [member("a", "tabs"), member("c", "tabs")]),
    klass("3", 40, [member("d", "x", true), member("d", "y", true)]),
  ],
  sharedNames: [],
  purposes: [],
};

describe("matches", () => {
  it("keeps the cross-repo classes by default", () => {
    expect(ATLAS.classes.filter((c) => matches(c, NO_FILTER)).map((c) => c.hash)).toEqual(["1", "2"]);
  });
  it("filters by a pair of repositories, a topic and a search", () => {
    const pick = (f: Partial<typeof NO_FILTER>): string[] => ATLAS.classes.filter((c) => matches(c, { ...NO_FILTER, ...f })).map((c) => c.hash);
    expect(pick({ repo: "a", repo2: "c" })).toEqual(["2"]);
    expect(pick({ topic: "generators" })).toEqual(["1"]);
    expect(pick({ topic: NO_TOPIC })).toEqual(["2"]);
    expect(pick({ query: "MULBERRY" })).toEqual(["1"]);
    expect(pick({ crossOnly: false })).toEqual(["1", "2", "3"]);
    expect(pick({ crossOnly: false, hideTests: true })).toEqual(["1", "2"]);
  });
});

describe("pairShares", () => {
  it("sums the size of each class that two repositories both have, and leaves out the repositories with no shared class", () => {
    const p = pairShares(ATLAS);
    expect(p.repos).toEqual(["a", "b", "c"]);
    expect(p.shared).toEqual([
      [0, 100, 50],
      [100, 0, 0],
      [50, 0, 0],
    ]);
    expect(p.max).toBe(100);
  });
});

describe("topicRows", () => {
  it("counts the cross-repo classes of each topic, the largest first", () => {
    expect(topicRows(ATLAS)).toEqual([
      { topic: "generators", classes: 1, duplicatedNodes: 100 },
      { topic: NO_TOPIC, classes: 1, duplicatedNodes: 50 },
    ]);
  });
});

describe("stepOf", () => {
  it("puts a value on a log scale, and gives no color to 0", () => {
    expect(stepOf(0, 1000, 7)).toBe(-1);
    expect(stepOf(1000, 1000, 7)).toBe(6);
    expect(stepOf(1, 1000, 7)).toBe(0);
    expect(stepOf(31, 1000, 7)).toBe(3);
    expect(stepOf(1, 1, 7)).toBe(6);
  });
});

describe("titleOf", () => {
  it("takes the first member with a name, else the file name", () => {
    expect(titleOf(klass("4", 40, [member("a", "<anonymous>"), member("b", "seeded")]))).toBe("seeded");
    expect(titleOf(klass("5", 40, [member("a", "<anonymous>"), member("b", "<anonymous>")]))).toBe("<anonymous> in <anonymous>.ts");
  });
});

describe("sourceUrl", () => {
  it("links to the line at the commit of the scan", () => {
    expect(sourceUrl("o", "abc", { ...member("r", "f"), file: "a b/c.ts" })).toBe("https://github.com/o/r/blob/abc/a%20b/c.ts#L3");
    expect(sourceUrl("o", null, member("r", "f"))).toBe("https://github.com/o/r/blob/HEAD/src/f.ts#L3");
  });
});

describe("the build", () => {
  it("reads the arguments, with the owner of the CI run as the default", () => {
    expect(parseSiteArgs(["--atlas", "a.json", "--out", "dist"], { GITHUB_REPOSITORY_OWNER: "o" })).toEqual({ atlas: "a.json", out: "dist", owner: "o", markdown: undefined });
    expect(parseSiteArgs(["--out", "dist"], {})).toHaveProperty("error");
    expect(parseSiteArgs(["--atlas"], {})).toHaveProperty("error");
  });
  it("refuses an atlas of a different schema", () => {
    expect(() => readAtlas('{"schema":"codeatlas/2"}')).toThrow(/codeatlas\/2/);
    expect(readAtlas(JSON.stringify(ATLAS)).totals.repos).toBe(3);
  });
  it("compiles the page to JavaScript with no types and no imports", () => {
    const js = compilePage("import type { A } from \"x\";\nexport const f = (a: A): number => 1;\n");
    expect(js).not.toMatch(/import|: number/);
    expect(js).toMatch(/export const f/);
  });
  it("writes a page with the script, and escapes the owner", () => {
    const html = pageHtml("console.log('</script>')", ATLAS, "o<x>", "2026-10-29");
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("o&lt;x&gt;");
    expect(html).not.toContain("console.log('</script>')");
    expect(html).toContain("50.0% of the code is a copy");
  });
});
