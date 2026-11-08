import { afterAll, describe, expect, it } from "vitest";
import { factsOfRepo } from "./blobs.ts";
import { queryOf } from "./query.ts";
import { auditOf, drawSample, populationOf, sampleFile, sizedTasks, type SampleItem } from "./sample.ts";
import { Catalog } from "./store.ts";
import { GitRepos } from "./testing/git-repo.ts";

const repos = new GitRepos();
afterAll(() => repos.removeAll());

/** A function of more than 40 nodes, with the names `name` and `v`, the constant `k` and the prefix `exported`. */
const big = (name: string, v: string, k = 2, exported = "export "): string =>
  `${exported}function ${name}(${v}: number[]) { let s = 0; for (const x of ${v}) { if (x > 0) s += x * ${k}; else s -= x; } return ${v}.length === 0 ? 0 : s / ${v}.length + Math.max(...${v}); }\n`;
const other = (name: string): string =>
  `export function ${name}(t: string) { const parts = t.split(","); let n = 0; for (const p of parts) { if (p.trim() !== "") n += p.length; } return [n, parts.length, t.toUpperCase()]; }\n`;

const a = repos.with({
  "src/a.ts": big("score", "values"),
  "src/a.test.ts": other("tested"),
  "src/local.ts": big("hidden", "zs", 2, ""),
  "src/tiny.ts": "export const add = (x: number, y: number) => x + y;\n",
});
const b = repos.with({ "lib/b.ts": big("rate", "xs"), "lib/c.ts": other("count") });

const catalog = new Catalog(":memory:");
for (const [name, root] of [
  ["a", a],
  ["b", b],
] as const) {
  const result = factsOfRepo(name, root, catalog);
  catalog.putSnapshot(name, `commit-${name}`, "2026-11-08T00:00:00Z", "test", result.files, result.counts);
}
afterAll(() => catalog.close());

describe("populationOf", () => {
  it("gives one exported function outside tests for each renamed class, with its commit and copies", async () => {
    const population = await populationOf(queryOf(catalog.db));
    // score and rate are one renamed class, and a.ts is first. count is its own class. hidden is not exported.
    expect(population.map((item) => [item.repo, item.path, item.name, item.commit, item.copies]).sort()).toEqual([
      ["a", "src/a.ts", "score", "commit-a", 2],
      ["b", "lib/c.ts", "count", "commit-b", 1],
    ]);
    expect(population.map((item) => item.subject)).toEqual(population.map((item) => item.subject).sort());
  });
});

const items = (n: number): SampleItem[] =>
  Array.from({ length: n }, (_, i) => ({ subject: `h${String(i).padStart(4, "0")}`, repo: "r", commit: "c", path: `f${i}.ts`, name: `f${i}`, line: 1, endLine: 2, nodes: 50, copies: 1 }));

describe("drawSample and sampleFile", () => {
  it("draws the same items for the same seed, and a larger draw starts with a smaller one", () => {
    const population = items(500);
    const first = drawSample(population, "seed-1", 130);
    expect(drawSample(population, "seed-1", 130)).toEqual(first);
    expect(drawSample(population, "seed-1", 200).slice(0, 130)).toEqual(first);
    expect(drawSample(population, "seed-2", 130)).not.toEqual(first);
    expect(new Set(first.map((item) => item.subject)).size).toBe(130);
  });

  it("sizes each task with rigor-statistics, and serves each task with one sample", () => {
    expect(sizedTasks([{ task: "home", target: 0.9, expected: 0.95 }])[0]?.n).toBe(127);
    const tasks = [
      { task: "home", target: 0.9, expected: 0.95 },
      { task: "purpose", target: 0.85, expected: 0.92 },
    ];
    const file = sampleFile(items(500), "seed-1", tasks, 130);
    expect(file.tasks.map((task) => [task.task, task.n, task.audit])).toEqual([
      ["home", 127, 69],
      ["purpose", 92, 34],
    ]);
    // One audit serves both tasks, so its size is the largest audit size.
    expect([file.size, file.population, file.audit]).toEqual([130, 500, 69]);
    expect(() => sizedTasks([{ task: "home", target: 0.9, expected: 0.9 }])).toThrow(RangeError);
    expect(() => sampleFile(items(50), "seed-1", tasks)).toThrow(/needs 127 items/);
  });

  it("draws the audit from the agreed subjects with its own stream, the same for each order of the input", () => {
    const agreed = items(110).map((item) => item.subject);
    const audit = auditOf(agreed, "seed-1", 69);
    expect(audit).toHaveLength(69);
    expect(auditOf([...agreed].reverse(), "seed-1", 69)).toEqual(audit);
    expect(audit.every((subject) => agreed.includes(subject))).toBe(true);
    expect(auditOf(agreed.slice(0, 10), "seed-1", 69)).toHaveLength(10);
  });
});
