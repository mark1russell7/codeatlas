import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { factsOfRepo } from "./blobs.ts";
import { coverageGaps, coverageGapsMarkdown, coverageMarkdown, coverageOfRepo, coverageReport, coverageRunOf, pathOfKey, type ArtifactInfo, type ArtifactSource } from "./coverage.ts";
import { queryOf } from "./query.ts";
import { Catalog } from "./store.ts";
import { GitRepos } from "./testing/git-repo.ts";

const repos = new GitRepos();
const dirs: string[] = [];
afterAll(() => {
  repos.removeAll();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const artifact = (name: string, runId: number, commit: string, createdAt: string, branch = "main", expired = false): ArtifactInfo => ({ name, runId, branch, commit, createdAt, expired });

describe("coverageRunOf", () => {
  const artifacts = [
    artifact("coverage", 3, "c3", "2026-11-08T03:00:00Z"),
    artifact("coverage-core", 3, "c3", "2026-11-08T03:00:00Z"),
    artifact("coverage", 2, "c2", "2026-11-08T02:00:00Z"),
    artifact("coverage", 4, "c4", "2026-11-08T04:00:00Z", "feat/x"),
    artifact("coverage", 5, "c5", "2026-11-08T05:00:00Z", "main", true),
    artifact("catalog", 6, "c6", "2026-11-08T06:00:00Z"),
  ];

  it("takes the run of the commit of the snapshot, or else the newest run of main", () => {
    expect(coverageRunOf(artifacts, "c2")).toEqual({ runId: 2, commit: "c2", createdAt: "2026-11-08T02:00:00Z", names: ["coverage"] });
    expect(coverageRunOf(artifacts, "c9")).toEqual({ runId: 3, commit: "c3", createdAt: "2026-11-08T03:00:00Z", names: ["coverage", "coverage-core"] });
  });

  it("skips branches, expired artifacts and other names", () => {
    expect(coverageRunOf(artifacts.slice(3), "c4")).toBeUndefined();
  });
});

describe("pathOfKey", () => {
  it("gives the longest tail of a runner path that is a path of the snapshot", () => {
    const paths = new Set(["packages/a/src/x.ts", "src/x.ts"]);
    expect(pathOfKey("/home/runner/work/r/r/packages/a/src/x.ts", paths)).toBe("packages/a/src/x.ts");
    expect(pathOfKey("D:\\a\\r\\r\\src\\x.ts", paths)).toBe("src/x.ts");
    expect(pathOfKey("/home/runner/work/r/r/src/y.ts", paths)).toBeUndefined();
  });
});

describe("the coverage of a repository", () => {
  const summary = {
    total: { lines: { total: 9, covered: 9 } },
    "/home/runner/work/app/app/src/math.ts": {
      lines: { total: 10, covered: 8 },
      functions: { total: 2, covered: 1 },
      statements: { total: 12, covered: 9 },
      branches: { total: 4, covered: 2 },
    },
    "/home/runner/work/app/app/src/gone.ts": { lines: { total: 1, covered: 0 } },
  };
  const final = {
    "/home/runner/work/app/app/src/math.ts": {
      fnMap: { "0": { name: "add", decl: { start: { line: 1 } } }, "1": { name: "sub", decl: { start: { line: 4 } } } },
      f: { "0": 3, "1": 0 },
    },
  };
  const source: ArtifactSource = {
    artifacts: (repo) => (repo === "app" ? [artifact("coverage", 7, "c0", "2026-11-08T07:00:00Z")] : []),
    download(_repo, _runId, _name, dir) {
      writeFileSync(join(dir, "coverage-summary.json"), JSON.stringify(summary));
      writeFileSync(join(dir, "coverage-final.json"), JSON.stringify(final));
    },
  };

  it("reads the measures of each file and the hits of each function, and counts the unknown keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "coverage-"));
    dirs.push(dir);
    const run = coverageOfRepo(source, "app", "c0", new Set(["src/math.ts"]), dir)!;
    expect(run.files).toEqual([
      { path: "src/math.ts", statements: { total: 12, covered: 9 }, branches: { total: 4, covered: 2 }, functions: { total: 2, covered: 1 }, lines: { total: 10, covered: 8 } },
    ]);
    expect(run.functions.map((f) => [f.name, f.line, f.hits])).toEqual([["add", 1, 3], ["sub", 4, 0]]);
    expect([run.runId, run.unmatched, run.artifacts]).toEqual([7, 1, ["coverage"]]);
    expect(coverageOfRepo(source, "other", "c0", new Set(), dir)).toBeUndefined();
  });

  it("keeps the coverage in the catalog, and counts the exported functions with no hit", async () => {
    const catalog = new Catalog(":memory:");
    afterAll(() => catalog.close());
    const root = repos.with({ "src/math.ts": "export function add(a: number, b: number) {\n  return a + b;\n}\nexport function sub(a: number, b: number) {\n  return a - b;\n}\n" });
    const result = factsOfRepo("app", root, catalog);
    const snapshot = catalog.putSnapshot("app", "c0", "2026-11-08T00:00:00Z", "test", result.files, result.counts);
    const dir = mkdtempSync(join(tmpdir(), "coverage-"));
    dirs.push(dir);
    catalog.putCoverage(snapshot, coverageOfRepo(source, "app", "c0", new Set(["src/math.ts"]), dir)!);
    const report = await coverageReport(queryOf(catalog.db));
    expect(report).toEqual({
      repos: 1,
      covered: [{ repo: "app", commit: "c0", current: true, files: 1, lines: { total: 10, covered: 8 }, functions: { total: 2, covered: 1 }, reported: 2, exported: 2, exportedUnhit: 1 }],
    });
    const markdown = coverageMarkdown(report);
    expect(markdown).toContain("Repositories with a coverage artifact on `main`: **1** of 1.");
    expect(markdown).toContain("| `app` | `c0` | 1 | 80.0% | 50.0% | 1 of 2 |");
    expect(markdown).toContain("With an Istanbul report (`coverage-summary.json`): 1.");
    expect(markdown).toContain("With a function report (`coverage-final.json`): 1.");
    const summaryOnly = { ...report.covered[0]!, reported: 0, exported: 0, exportedUnhit: 0 };
    expect(coverageMarkdown({ repos: 1, covered: [summaryOnly] })).toContain("| 80.0% | 50.0% | no function report |");
    // A scan of the same commit again replaces the snapshot, so its coverage rows go first
    catalog.putSnapshot("app", "c0", "2026-11-08T01:00:00Z", "test", result.files, result.counts);
    expect((await coverageReport(queryOf(catalog.db))).covered).toEqual([]);
  });
});

describe("coverageGaps", () => {
  it("gives the cause of each repository with no function report, in a fixed order", async () => {
    const catalog = new Catalog(":memory:");
    afterAll(() => catalog.close());
    const tested = repos.with({ "src/a.ts": "export const a = 1;\n", "src/a.test.ts": "import { a } from './a';\n" });
    const untested = repos.with({ "src/a.ts": "export const a = 1;\n" });
    const ci = ".github/workflows/reusable-ci.yml";
    const put = (repo: string, root: string): string => {
      const result = factsOfRepo(repo, root, catalog);
      return catalog.putSnapshot(repo, `${repo}-head`, "2026-11-09T00:00:00Z", "test", result.files, result.counts);
    };
    const run = (functions: number) => ({
      runId: 1, commit: "c", createdAt: "2026-11-09T00:00:00Z", artifacts: ["coverage"], files: [], unmatched: 0,
      functions: Array.from({ length: functions }, (_, i) => ({ path: "src/a.ts", line: i + 1, name: `f${i}`, hits: 1 })),
    });
    const sql = (text: string, ...values: (string | number | null)[]): void => {
      catalog.db.prepare(text).run(...values);
    };
    const template = put("template", tested);
    sql("INSERT INTO template_version (snapshot, ref, committed_at, path, oid) VALUES (?, ?, ?, ?, ?)", template, "template-head", "2026-11-09", ci, "new");
    sql("INSERT INTO template_version (snapshot, ref, committed_at, path, oid) VALUES (?, ?, ?, ?, ?)", template, "older", "2026-11-08", ci, "new");
    sql("INSERT INTO template_version (snapshot, ref, committed_at, path, oid) VALUES (?, ?, ?, ?, ?)", template, "oldest", "2026-11-07", ci, "old");
    catalog.putCoverage(template, run(1));
    put("bare", untested);
    for (const repo of ["plain", "summary", "own", "old", "fresh"]) {
      const snapshot = put(repo, tested);
      sql("INSERT INTO manifest (snapshot, path, oid, name, version, private, parse_error) VALUES (?, ?, ?, ?, ?, ?, ?)", snapshot, "package.json", `m-${repo}`, repo, "0.0.0", 0, null);
      if (repo !== "plain") sql('INSERT INTO dependency (oid, field, name, "range", kind) VALUES (?, ?, ?, ?, ?)', `m-${repo}`, "devDependencies", "@vitest/coverage-v8", "^4.0.0", "semver");
      if (repo === "summary") catalog.putCoverage(snapshot, run(0));
      if (repo === "old" || repo === "fresh") sql("INSERT INTO template_pin (snapshot, path, line, target, ref) VALUES (?, ?, ?, ?, ?)", snapshot, ".github/workflows/ci.yml", 9, ci, repo === "old" ? "oldest" : "older");
    }
    const gaps = await coverageGaps(queryOf(catalog.db));
    expect(gaps).toEqual([
      { repo: "bare", cause: "no-tests" },
      { repo: "fresh", cause: "no-artifact" },
      { repo: "old", cause: "old-ci", ref: "oldest" },
      { repo: "own", cause: "no-shared-ci" },
      { repo: "plain", cause: "no-coverage-v8" },
      { repo: "summary", cause: "summary-only" },
    ]);
    const markdown = coverageGapsMarkdown(gaps);
    expect(markdown).toContain("| `old-ci` | `old` (`oldest`) | Merge the sync of the template. It moves the pin of the shared CI. |");
    expect(markdown.indexOf("`no-tests`")).toBeLessThan(markdown.indexOf("`no-artifact`"));
    expect(coverageGapsMarkdown([])).toBe("");
  });
});
