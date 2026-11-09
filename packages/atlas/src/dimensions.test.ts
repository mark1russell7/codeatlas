import { afterAll, describe, expect, it } from "vitest";
import { codeIndex, DIMENSIONS, dimensionCounts, dimensionSummaries, dimensionsMarkdown, type Dimension } from "./dimensions.ts";
import { queryOf } from "./query.ts";
import { scanRepoInto } from "./rescan.ts";
import { Catalog } from "./store.ts";
import { GitRepos } from "./testing/git-repo.ts";

const SOURCE = `import { readFileSync } from "node:fs";
import { join } from "node:path";

export function load(dir: string, name: string): string {
  if (dir === "") {
    return "";
  }
  const text = readFileSync(join(dir, name), "utf8") as unknown as string;
  return trim(text);
}

function trim(text: any): string {
  return text!.trim();
}

export function twice(dir: string): string {
  return trim(load(dir, "a")) + trim(load(dir, "b"));
}
`;

describe("DIMENSIONS", () => {
  it("has unique ids in snake case, and a definition and a unit for each", () => {
    const ids = DIMENSIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of DIMENSIONS) {
      expect(d.id).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(d.definition.length).toBeGreaterThan(20);
      expect(d.unit.length).toBeGreaterThan(0);
    }
  });

  it("counts a dimension only after a check with a lower bound at the gate", () => {
    const base = DIMENSIONS[0] as Dimension;
    expect(dimensionCounts(base)).toBe(false);
    expect(dimensionCounts({ ...base, precision: { method: "tsc", agree: 50, checked: 50, at: "2026-11-09" } })).toBe(true);
    expect(dimensionCounts({ ...base, precision: { method: "tsc", agree: 45, checked: 50, at: "2026-11-09" } })).toBe(false);
  });
});

describe("codeIndex", () => {
  const repos = new GitRepos();
  afterAll(() => repos.removeAll());

  it("gives the value of each dimension for each function and each file outside the tests", async () => {
    const root = repos.with({ "src/load.ts": SOURCE, "src/load.test.ts": SOURCE });
    const catalog = new Catalog(":memory:");
    try {
      // The churn window ends at the time of the scan, so the scan is after the commit
      scanRepoInto(catalog, "app", root, [], new Date(Date.now() + 60_000).toISOString());
      const index = await codeIndex(queryOf(catalog.db));
      const byName = new Map(index.functions.map((f) => [f.name, f]));
      expect([...byName.keys()]).toEqual(["load", "trim", "twice"]);
      expect(byName.get("load")?.values).toEqual({ length: 7, params: 2, nodes: byName.get("load")?.values["nodes"], cyclomatic: 2, depth: 1, cognitive: 1, fan_out: 3, fan_in: 4, unsafe_types: 1, churn: 1, hotspot: 1 });
      // The fan-in is by name, tests included: `text.trim()` counts for `trim`. The precision check measures this error
      expect(byName.get("trim")?.values).toMatchObject({ length: 3, params: 1, fan_out: 1, fan_in: 8, unsafe_types: 2 });
      expect(byName.get("twice")?.values).toMatchObject({ fan_out: 2, fan_in: 0 });
      expect(index.modules).toEqual([{ repo: "app", path: "src/load.ts", values: { imports: 2 } }]);

      const summaries = dimensionSummaries(index);
      expect(summaries.find((s) => s.id === "length")).toMatchObject({ count: 3, max: 7, top: "app:src/load.ts:4", counts: false });
      const markdown = dimensionsMarkdown(summaries);
      expect(markdown).toContain(`The catalog has ${DIMENSIONS.length} dimensions. 0 passed a check of their precision, so only they count.`);
      expect(markdown).toContain("| Length | lines | parser | not checked | 3 |");
    } finally {
      catalog.close();
    }
  });

  it("takes the coverage of a function from its hits, or else from the lines of its file, and the hotspot from both", async () => {
    const root = repos.with({ "src/load.ts": SOURCE });
    const catalog = new Catalog(":memory:");
    try {
      const { snapshot, commit } = scanRepoInto(catalog, "app", root, [], new Date(Date.now() + 60_000).toISOString());
      const none = { total: 0, covered: 0 };
      catalog.putCoverage(snapshot, {
        runId: 1,
        commit: commit ?? "",
        createdAt: "2026-11-08T00:00:00Z",
        artifacts: ["coverage"],
        unmatched: 0,
        files: [{ path: "src/load.ts", statements: none, branches: none, functions: none, lines: { total: 10, covered: 5 } }],
        functions: [
          { path: "src/load.ts", line: 4, name: "load", hits: 3 },
          { path: "src/load.ts", line: 12, name: "trim", hits: 0 },
        ],
      });
      const index = await codeIndex(queryOf(catalog.db));
      const byName = new Map(index.functions.map((f) => [f.name, f.values]));
      expect(byName.get("load")).toMatchObject({ cognitive: 1, churn: 1, coverage: 1, hotspot: 0 });
      expect(byName.get("trim")).toMatchObject({ coverage: 0, hotspot: 0 });
      // No record of the function: the line coverage of the file
      expect(byName.get("twice")).toMatchObject({ coverage: 0.5 });
    } finally {
      catalog.close();
    }
  });
});
