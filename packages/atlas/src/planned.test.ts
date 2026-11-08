import { afterAll, describe, expect, it } from "vitest";
import { factsOfRepo } from "./blobs.ts";
import { plannedDuplication, plannedMarkdown, plannedPairs, planWords, type PlanItem } from "./planned.ts";
import { queryOf } from "./query.ts";
import { roadmapOf, roadmapsOfRepo } from "./roadmaps.ts";
import { Catalog } from "./store.ts";
import { GitRepos } from "./testing/git-repo.ts";

const TABLE = (rows: readonly string[]): string =>
  `# Roadmap\n\n## Items\n\n| ID | Status | Title |\n| --- | --- | --- |\n${rows.map((row) => `${row}\n`).join("")}`;

const item = (repo: string, id: string, title: string, statusClass: PlanItem["statusClass"] = "open"): PlanItem => ({
  repo,
  path: "docs/ROADMAP.md",
  id,
  title,
  statusClass,
});

describe("roadmapOf", () => {
  it("reads the items of a table with an ID column and a Status column", () => {
    const items = roadmapOf(TABLE(["| A1 | done | The parser of the formula |", "| A2 | later | A cache of the results |"]));
    expect(items.map((i) => [i.id, i.statusClass, i.title, i.section, i.area])).toEqual([
      ["A1", "done", "The parser of the formula", "Items", null],
      ["A2", "later", "A cache of the results", "Items", null],
    ]);
  });
});

describe("planWords", () => {
  it("keeps the words that tell what an item makes", () => {
    expect(planWords("The `packConfig` of the 3 strategies, and its cost model")).toEqual(["pack", "config", "strategies", "cost", "model"]);
  });
});

describe("plannedPairs", () => {
  const items = [
    item("highways", "ARM-ORDER", "Mode fresh rotates the arms of a pair by round"),
    item("packing", "k165", "Mode fresh of armOrder rotates the arms by round"),
    item("packing", "k1", "The rotates arms fixture", "done"),
    item("highways", "OLD", "Mode fresh rotates the arms", "done"),
    item("vex", "V1", "A parser of the formula syntax"),
    item("coeval", "C1", "The formula syntax of vex as a profile of the parser"),
    item("typeset", "T1", "Font tables and kerning pairs"),
  ];
  const pairs = plannedPairs(items);

  it("gives the pairs of two repositories, the highest score first, with the shared words", () => {
    const top = pairs.find((p) => p.a.id === "ARM-ORDER" && p.b.id === "k165")!;
    expect([top.kind, top.names]).toEqual(["both open", false]);
    expect(top.score).toBeGreaterThan(pairs.find((p) => p.a.id === "OLD" && p.b.id === "k1")?.score ?? 0);
    expect(top.shared).toEqual(expect.arrayContaining(["mode", "fresh", "rotates", "arms", "round"]));
    for (let i = 1; i < pairs.length; i++) expect(pairs[i - 1]!.score).toBeGreaterThanOrEqual(pairs[i]!.score);
  });

  it("gives no pair in one repository, and no pair of two done items", () => {
    for (const p of pairs) {
      expect(p.a.repo).not.toBe(p.b.repo);
      expect(p.a.statusClass === "done" && p.b.statusClass === "done").toBe(false);
    }
    expect(pairs.some((p) => p.kind === "one done")).toBe(true);
  });

  it("marks a title that names the repository of the other item", () => {
    const vex = pairs.find((p) => p.a.repo === "coeval" && p.b.repo === "vex");
    expect(vex?.names).toBe(true);
  });

  it("obeys the limits, and gives the same pairs for each order of the items", () => {
    expect(plannedPairs(items, { minScore: 0.99 })).toEqual([]);
    expect(plannedPairs(items, { minShared: 9 })).toEqual([]);
    expect(plannedPairs([...items].reverse())).toEqual(pairs);
    expect(pairs.some((p) => p.a.repo === "typeset" || p.b.repo === "typeset")).toBe(false);
  });

  it("writes the pairs of two open plans as a Markdown table", () => {
    const markdown = plannedMarkdown(pairs);
    expect(markdown).toContain("### Two open plans");
    expect(markdown).toContain("`highways` ARM-ORDER (open)");

  });

  it("escapes each backslash and each pipe of a title in a table cell", () => {
    const odd = plannedPairs([item("north", "A1", "Split a|b at C:\\temp paths"), item("south", "B1", "Split a|b at C:\\temp paths")]);
    expect(plannedMarkdown(odd)).toContain("a\\|b at C:\\\\temp");
  });
});

describe("the roadmaps of the catalog", () => {
  const repos = new GitRepos();
  afterAll(() => repos.removeAll());
  const roots = {
    highways: repos.with({ "docs/ROADMAP.md": TABLE(["| ARM-ORDER | in progress | Mode fresh rotates the arms of a pair by round |"]) }),
    packing: repos.with({
      "docs/ROADMAP.md": TABLE(["| k165 | later | Mode fresh of armOrder rotates the arms by round |"]),
      "bad/ROADMAP.md": "# Roadmap\n\n| ID | Status | Title |\n| --- | --- | --- |\n| k1 | done |\n",
    }),
  };
  const catalog = new Catalog(":memory:");
  const scan = (name: string, root: string): void => {
    const result = factsOfRepo(name, root, catalog);
    const snapshot = catalog.putSnapshot(name, "c0", "2026-11-08T00:00:00Z", "test", result.files, result.counts);
    catalog.putRoadmaps(snapshot, roadmapsOfRepo(root));
  };
  for (const [name, root] of Object.entries(roots)) scan(name, root);
  afterAll(() => catalog.close());

  it("keeps each roadmap with its items, and the parse error of a broken one", () => {
    const roadmaps = catalog.db.prepare("SELECT repo, path, parse_error FROM current_roadmap ORDER BY repo, path").all();
    expect(roadmaps.map((r) => [r["repo"], r["path"], r["parse_error"] === null])).toEqual([
      ["highways", "docs/ROADMAP.md", true],
      ["packing", "bad/ROADMAP.md", false],
      ["packing", "docs/ROADMAP.md", true],
    ]);
    const items = catalog.db.prepare("SELECT repo, id, status_class FROM current_roadmap_item ORDER BY repo, id").all();
    expect(items.map((r) => [r["repo"], r["id"], r["status_class"]])).toEqual([
      ["highways", "ARM-ORDER", "progress"],
      ["packing", "k165", "later"],
    ]);
  });

  it("scans a snapshot again over its roadmaps", () => {
    scan("highways", roots.highways);
    expect(catalog.db.prepare("SELECT count(*) AS n FROM current_roadmap_item").get()).toEqual({ n: 2 });
  });

  it("gives the planned pairs of the catalog", async () => {
    const pairs = await plannedDuplication(queryOf(catalog.db), { minScore: 0.1 });
    expect(pairs.map((p) => [p.a.repo, p.a.id, p.b.repo, p.b.id, p.kind])).toEqual([["highways", "ARM-ORDER", "packing", "k165", "both open"]]);
  });
});
