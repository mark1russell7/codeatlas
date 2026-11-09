import { afterAll, describe, expect, it } from "vitest";
import { factsOfRepo } from "./blobs.ts";
import { CLONE_LEVELS, duplication } from "./queries.ts";
import { queryOf } from "./query.ts";
import { Catalog } from "./store.ts";
import { GitRepos } from "./testing/git-repo.ts";
import { addPoint, filterTrend, pointTotals, trendPoint, TREND_VERSION, type RepoPoint, type Trend, type TrendPoint } from "./trend.ts";

const repos = new GitRepos();
afterAll(() => repos.removeAll());

/** A function of more than 40 nodes, with the names `name` and `v` and the constant `k`. */
const big = (name: string, v: string, k = 2): string =>
  `export function ${name}(${v}: number[]) { let s = 0; for (const x of ${v}) { if (x > 0) s += x * ${k}; else s -= x; } return ${v}.length === 0 ? 0 : s / ${v}.length + Math.max(...${v}); }\n`;

const a = repos.with({
  "src/a.ts": big("score", "values"),
  "src/a.test.ts": big("score", "values"),
  "src/tiny.ts": "export const add = (x: number, y: number) => x + y;\n",
});
const b = repos.with({ "src/b.ts": big("rate", "xs"), "lib/same.ts": big("score", "values"), "lib/other.ts": big("weigh", "ws", 3) });

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

describe("trendPoint", () => {
  it("gives the measures of each repository, and the first function of a class is not duplicated", async () => {
    const point = await trendPoint(q, "2026-11-09T06:40:00Z", "facts/1");
    expect(point.repos.map((repo) => [repo.repo, repo.commit, repo.files])).toEqual([
      ["a", "commit-a", 2],
      ["b", "commit-b", 3],
    ]);
    const [ra, rb] = point.repos;
    expect(rb?.functions).toBe(3);
    const nodes = (rb?.nodes ?? 0) / 3;
    expect(ra?.nodes).toBe(nodes);
    // score of a.ts is the first of each class. same.ts is its exact copy, and rate and weigh join it at renamed.
    expect(ra?.duplicated).toEqual({ exact: 0, renamed: 0, shape: 0 });
    expect(rb?.duplicated.exact).toBe(nodes);
    expect(rb?.duplicated.renamed).toBe(3 * nodes);
  });

  it("adds up to the duplication of the catalog at each level", async () => {
    const point = await trendPoint(q, "2026-11-09T06:40:00Z", "facts/1");
    const whole = await duplication(q);
    expect(point.repos.reduce((sum, repo) => sum + repo.nodes, 0)).toBe(whole.topNodes);
    for (const level of CLONE_LEVELS) {
      expect(point.repos.reduce((sum, repo) => sum + repo.duplicated[level], 0), level).toBe(whole.levels[level].duplicatedNodes);
    }
  });
});

describe("addPoint", () => {
  const point = (at: string): TrendPoint => ({ at, scanner: "facts/1", repos: [] });

  it("starts a trend, keeps one point for each day and keeps the order of time", () => {
    const first = addPoint(undefined, point("2026-11-09T06:40:00Z"));
    expect(first).toEqual({ version: TREND_VERSION, points: [point("2026-11-09T06:40:00Z")] });
    const second = addPoint(JSON.parse(JSON.stringify(first)), point("2026-11-16T06:40:00Z"));
    const again = addPoint(second, point("2026-11-16T09:00:00Z"));
    expect(again.points.map((each) => each.at)).toEqual(["2026-11-09T06:40:00Z", "2026-11-16T09:00:00Z"]);
    expect(addPoint(again, point("2026-11-02T06:40:00Z")).points[0]?.at).toBe("2026-11-02T06:40:00Z");
  });

  it("refuses a file that is not a trend of this version", () => {
    expect(() => addPoint({ version: "trend/0", points: [] }, point("2026-11-09T06:40:00Z"))).toThrow(/not a trend/);
    expect(() => addPoint(null, point("2026-11-09T06:40:00Z"))).toThrow(/not a trend/);
    expect(() => addPoint({ version: TREND_VERSION }, point("2026-11-09T06:40:00Z"))).toThrow(/not a trend/);
  });
});

describe("filterTrend", () => {
  const row = (repo: string, nodes: number): RepoPoint => ({ repo, commit: `${repo}-c`, files: 1, functions: 2, nodes, duplicated: { exact: 1, renamed: 2, shape: 3 } });
  const trend: Trend = {
    version: TREND_VERSION,
    points: [
      { at: "2026-11-02T06:40:00Z", scanner: "facts/1", repos: [row("a", 10), row("secret", 30)] },
      { at: "2026-11-09T06:40:00Z", scanner: "facts/1", repos: [row("a", 20)] },
    ],
  };

  it("leaves no name of a repository that turns private in the trend file, and keeps the totals of each point", () => {
    const before = trend.points.map(pointTotals);
    const filtered = filterTrend(trend, ["a", "b"]);
    expect(JSON.stringify(filtered)).not.toContain("secret");
    expect(filtered.points.map(pointTotals)).toEqual(before);
    expect(filtered.points[0]).toMatchObject({ filtered: true, totals: { files: 2, functions: 4, nodes: 40, duplicated: { exact: 2, renamed: 4, shape: 6 } } });
    expect(filtered.points[0]?.repos.map((each) => each.repo)).toEqual(["a"]);
    // A point that loses no row stays as it is
    expect(filtered.points[1]).toBe(trend.points[1]);
  });

  it("keeps the totals of the first filter when a second filter removes more rows", () => {
    const once = filterTrend(trend, ["a"]);
    const twice = filterTrend(JSON.parse(JSON.stringify(once)) as Trend, ["b"]);
    expect(twice.points.map((point) => point.repos.length)).toEqual([0, 0]);
    expect(twice.points.map((point) => pointTotals(point).nodes)).toEqual([40, 20]);
  });

  it("refuses an empty list of names, so a failed list does not empty the history", () => {
    expect(() => filterTrend(trend, [])).toThrow(/empty/);
  });
});
