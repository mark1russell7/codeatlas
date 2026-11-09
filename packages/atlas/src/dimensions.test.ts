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
      scanRepoInto(catalog, "app", root, [], "2026-11-09T00:00:00Z");
      const index = await codeIndex(queryOf(catalog.db));
      const byName = new Map(index.functions.map((f) => [f.name, f]));
      expect([...byName.keys()]).toEqual(["load", "trim", "twice"]);
      expect(byName.get("load")?.values).toEqual({ length: 7, params: 2, nodes: byName.get("load")?.values["nodes"], cyclomatic: 2, depth: 1, cognitive: 1, fan_out: 3, fan_in: 4, unsafe_types: 1 });
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
});
