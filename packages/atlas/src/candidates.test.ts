import { afterAll, describe, expect, it } from "vitest";
import { factsOfRepo } from "./blobs.ts";
import { homeCandidates } from "./candidates.ts";
import { queryOf } from "./query.ts";
import { Catalog } from "./store.ts";
import { GitRepos } from "./testing/git-repo.ts";

const repos = new GitRepos();
afterAll(() => repos.removeAll());

/** A function with the name `name` and the parameter `v`. */
const fn = (name: string, v: string): string =>
  `export function ${name}(${v}: number[]) { const s = [...${v}].sort((x, y) => x - y); return s.length === 0 ? 0 : s[Math.floor(s.length / 2)]; }\n`;

const roots = {
  app: repos.with({ "src/stats.ts": `${fn("median", "values")}${fn("quantile", "xs")}`, "src/stats.test.ts": fn("median", "values") }),
  tool: repos.with({ "src/m.ts": fn("median", "list"), "src/r.ts": "export function mulberry32(a: number) { return () => (a = (a + 1) | 0); }\n" }),
  rigor: repos.with({ "src/median.ts": fn("median", "values") }),
};
const catalog = new Catalog(":memory:");
for (const [name, root] of Object.entries(roots)) {
  const result = factsOfRepo(name, root, catalog);
  catalog.putSnapshot(name, "c0", "2026-11-08T00:00:00Z", "test", result.files, result.counts);
}
const q = queryOf(catalog.db);
afterAll(() => catalog.close());

describe("homeCandidates", () => {
  it("gives the copies of each home outside it, the most nodes first, and not the home or a test", async () => {
    const candidates = await homeCandidates(q);
    expect(candidates.map((c) => c.area)).toEqual(["statistics", "random"]);
    const statistics = candidates[0];
    expect(statistics?.copies.map((c) => `${c.repo}:${c.name}`)).toEqual(["app:median", "app:quantile", "tool:median"]);
    expect(statistics).toMatchObject({ repo: "mark1russell7/rigor", home: ["@mark1russell7/rigor-statistics"], repos: ["app", "tool"] });
    expect(statistics?.nodes).toBe(statistics?.copies.reduce((sum, c) => sum + c.nodes, 0));
    // The three copies have one shape: the renamed parameter and the name do not change it
    expect(statistics?.classes).toBe(1);
    expect(candidates[1]).toMatchObject({ area: "random", repos: ["tool"], classes: 0 });
  });
});
