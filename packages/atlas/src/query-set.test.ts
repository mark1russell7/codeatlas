import { afterAll, describe, expect, it } from "vitest";
import { factsOfRepo } from "./blobs.ts";
import { duplication } from "./queries.ts";
import { queryOf } from "./query.ts";
import { querySet, QUERY_SET_LIMITS, QUERY_SET_VERSION } from "./query-set.ts";
import { Catalog } from "./store.ts";
import { GitRepos } from "./testing/git-repo.ts";

const repos = new GitRepos();
afterAll(() => repos.removeAll());

/** A function of more than 40 nodes, with the names `name` and `v`. */
const big = (name: string, v: string): string =>
  `export function ${name}(${v}: number[]) { let s = 0; for (const x of ${v}) { if (x > 0) s += x * 2; else s -= x; } return ${v}.length === 0 ? 0 : s / ${v}.length + Math.max(...${v}); }\n`;

/** A function with a cyclomatic complexity of `n + 1`. */
const branchy = (name: string, n: number): string =>
  `export function ${name}(x: number) {\n${Array.from({ length: n }, (_, i) => `  if (x === ${i}) return ${i};\n`).join("")}  return -1;\n}\n`;

const a = repos.with({ "src/a.ts": `${big("score", "values")}// TODO: one\n`, "src/choose.ts": branchy("choose", 20) });
const b = repos.with({ "lib/same.ts": big("score", "values"), "lib/rename.ts": big("rate", "xs") });

const catalog = new Catalog(":memory:");
for (const [name, root] of [
  ["a", a],
  ["b", b],
] as const) {
  const result = factsOfRepo(name, root, catalog);
  catalog.putSnapshot(name, `commit-${name}`, "2026-11-08T00:00:00Z", "test", result.files, result.counts);
}
const q = queryOf(catalog.db);
afterAll(() => catalog.close());

describe("querySet", () => {
  it("gives the commit of each repository and the duplication of each level", async () => {
    const set = await querySet(q, "2026-11-09T06:40:00Z", "facts/1");
    expect(set.version).toBe(QUERY_SET_VERSION);
    expect(set.limits).toEqual(QUERY_SET_LIMITS);
    expect(set.repos).toEqual([
      { repo: "a", commit: "commit-a" },
      { repo: "b", commit: "commit-b" },
    ]);
    expect(set.duplication).toEqual(await duplication(q));
  });

  it("gives each exact class with its functions, and no renamed copy", async () => {
    const set = await querySet(q, "2026-11-09T06:40:00Z", "facts/1");
    expect(set.exact).toHaveLength(1);
    expect(set.exact[0]?.members.map((m) => `${m.repo}/${m.path}:${m.name}`)).toEqual(["a/src/a.ts:score", "b/lib/same.ts:score"]);
    expect(set.exact[0]?.copies).toBe(2);
  });

  it("gives the complex functions and the markers of each repository", async () => {
    const set = await querySet(q, "2026-11-09T06:40:00Z", "facts/1");
    expect(set.complex.map((f) => [f.repo, f.name, f.cyclomatic])).toEqual([["a", "choose", 21]]);
    expect(set.markers).toEqual([{ repo: "a", kind: "todo", count: 1 }]);
  });

  it("keeps to its limits", async () => {
    const set = await querySet(q, "2026-11-09T06:40:00Z", "facts/1", { exactClasses: 0, complexMin: 100, complexLimit: 1 });
    expect(set.exact).toEqual([]);
    expect(set.complex).toEqual([]);
  });
});
