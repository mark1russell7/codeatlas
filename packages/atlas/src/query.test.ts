import { afterAll, describe, expect, it } from "vitest";
import { factsOfRepo } from "./blobs.ts";
import { CATALOG_COLUMNS, CATALOG_VIEWS, queryOf } from "./query.ts";
import { CLONE_LEVELS, cloneClasses, complexFunctions, copiesOf, duplication, importersOf, markerCounts, membersOf } from "./queries.ts";
import { Catalog } from "./store.ts";
import { GitRepos } from "./testing/git-repo.ts";

const repos = new GitRepos();
afterAll(() => repos.removeAll());

/** A function of more than 40 nodes, with the names `name` and `v` and the constant `k`. */
const big = (name: string, v: string, k = 2): string =>
  `export function ${name}(${v}: number[]) { let s = 0; for (const x of ${v}) { if (x > 0) s += x * ${k}; else s -= x; } return ${v}.length === 0 ? 0 : s / ${v}.length + Math.max(...${v}); }\n`;

const a = repos.with({
  "src/a.ts": `${big("score", "values")}// TODO: one\nimport { join } from "node:path";\nexport const p = join("a", "b")!;\n`,
  "src/a.test.ts": `import { join } from "node:path";\n${big("score", "values")}`,
  "src/tiny.ts": "export const add = (x: number, y: number) => x + y;\n",
});
const b = repos.with({
  "src/b.ts": big("rate", "xs"),
  "lib/same.ts": big("score", "values"),
  "lib/other.ts": big("weigh", "ws", 3),
});

const catalog = new Catalog(":memory:");
for (const [name, root] of [
  ["a", a],
  ["b", b],
] as const) {
  const result = factsOfRepo(name, root, catalog);
  catalog.putSnapshot(name, "c0", "2026-11-08T00:00:00Z", "test", result.files, result.counts);
}
const q = queryOf(catalog.db);
afterAll(() => catalog.close());

describe("CATALOG_COLUMNS", () => {
  it("has the columns, the types and the NULL rules of each table and view of the database", () => {
    const relations = catalog.db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name").all() as { name: string }[];
    expect(relations.map((row) => row.name)).toEqual(Object.keys(CATALOG_COLUMNS).sort());
    for (const [relation, columns] of Object.entries(CATALOG_COLUMNS)) {
      const info = catalog.db.prepare(`PRAGMA table_info("${relation}")`).all() as { name: string; type: string; notnull: number; pk: number }[];
      const actual = info.map((row) => {
        const type = row.type.toLowerCase();
        // A view gives no NOT NULL, so its columns take the rule of the declared type
        const nullable = CATALOG_VIEWS.has(relation) ? (columns as Record<string, string>)[row.name]?.endsWith("?") : row.notnull === 0 && row.pk === 0;
        return [row.name, nullable ? `${type}?` : type];
      });
      expect(actual, relation).toEqual(Object.entries(columns));
    }
  });

  it("does not compile a query of a column that does not exist", async () => {
    // @ts-expect-error: the symbol table has no column "size"
    const query = q.selectFrom("symbol").select("size");
    expect(query.compile().sql).toBe('select "size" from "symbol"');
  });
});

describe("the queries", () => {
  it("give the clone classes of each level, outside tests and above the size of a class", async () => {
    // score in a.ts and same.ts is one exact class. rate joins it at renamed, and weigh (another constant) too.
    const exact = await cloneClasses(q, "exact");
    expect(exact.map((c) => [c.copies, c.repos])).toEqual([[2, 2]]);
    const renamed = await cloneClasses(q, "renamed");
    expect(renamed.map((c) => [c.copies, c.repos])).toEqual([[4, 2]]);
    expect(renamed[0]?.duplicatedNodes).toBe((renamed[0]?.nodes ?? 0) * 3);
    const members = await membersOf(q, "renamed", renamed[0]?.hash ?? "");
    expect(members.map((m) => `${m.repo}/${m.path}:${m.name}`)).toEqual(["a/src/a.ts:score", "b/lib/other.ts:weigh", "b/lib/same.ts:score", "b/src/b.ts:rate"]);
  });

  it("give the copies of one function, and none for a function with no copy", async () => {
    const copies = await copiesOf(q, { repo: "b", path: "src/b.ts", name: "rate" }, "renamed");
    expect(copies.map((m) => `${m.repo}/${m.path}`)).toEqual(["a/src/a.ts", "b/lib/other.ts", "b/lib/same.ts"]);
    expect(await copiesOf(q, { repo: "b", path: "src/b.ts", name: "rate" }, "exact")).toEqual([]);
    expect(await copiesOf(q, { repo: "a", path: "src/missing.ts", name: "rate" }, "exact")).toEqual([]);
  });

  it("give the duplication of each level as the summary of the catalog does, and keep the law of the chain", async () => {
    const measures = await duplication(q);
    const summary = catalog.summary({ parsed: 0, reused: 0, errors: 0, bytesParsed: 0, ms: 1 });
    for (const level of CLONE_LEVELS) {
      const { classes, members } = measures.levels[level];
      expect({ classes, members }, level).toEqual(summary.classes[level]);
    }
    const nodes = CLONE_LEVELS.map((level) => measures.levels[level].duplicatedNodes);
    expect(nodes).toEqual([...nodes].sort((x, y) => x - y));
    for (const level of CLONE_LEVELS) expect(measures.ratio[level]).toBeGreaterThanOrEqual(0);
    expect(measures.ratio.shape).toBeLessThanOrEqual(1);
    expect(measures.ratio.renamed).toBeCloseTo(3 / 4);
  });

  it("give the importers of a specifier, the markers of each repository and the complex functions", async () => {
    expect(await importersOf(q, "node:path")).toEqual([
      { repo: "a", path: "src/a.test.ts", line: 1, kind: "static" },
      { repo: "a", path: "src/a.ts", line: 3, kind: "static" },
    ]);
    expect(await markerCounts(q)).toEqual([
      { repo: "a", kind: "non-null", count: 1 },
      { repo: "a", kind: "todo", count: 1 },
    ]);
    const complex = await complexFunctions(q, 4);
    expect(complex.map((f) => `${f.repo}/${f.path}:${f.name}`)).toEqual(["a/src/a.ts:score", "b/lib/other.ts:weigh", "b/lib/same.ts:score", "b/src/b.ts:rate"]);
    expect(complex.every((f) => f.cyclomatic >= 4 && f.depth >= 1 && f.nodes > 40)).toBe(true);
    expect(await complexFunctions(q, 99)).toEqual([]);
  });
});
