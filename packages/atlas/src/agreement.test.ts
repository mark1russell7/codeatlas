import { describe, expect, it } from "vitest";
import { agreementOf, OTHER_LIMIT, type DraftLabel } from "./agreement.ts";
import type { SampleFile, SampleItem } from "./sample.ts";

const item = (k: number): SampleItem => ({ subject: `s${k}`, repo: "r", commit: null, path: "a.ts", name: `f${k}`, line: 1, endLine: 2, nodes: 50, copies: 1 });
const sample = (size: number, home: number, purpose: number): SampleFile => ({
  version: "sample/1",
  seed: "test",
  rule: "test",
  tasks: [
    { task: "home", target: 0.9, expected: 0.95, n: home, audit: 3 },
    { task: "purpose", target: 0.85, expected: 0.92, n: purpose, audit: 2 },
  ],
  audit: 3,
  population: size,
  size,
  items: Array.from({ length: size }, (_, k) => item(k)),
});
const label = (k: number, area: string, category: string): DraftLabel => ({ subject: `s${k}`, area, category, sentence: "" });

describe("agreementOf", () => {
  const file = sample(10, 10, 6);
  const a = Array.from({ length: 10 }, (_, k) => label(k, k % 2 === 0 ? "statistics" : "none", k % 3 === 0 ? "compute" : "parse"));

  it("gives kappa 1, no disagreement and one confusion cell for each label when the drafts agree", () => {
    const result = agreementOf(file, a, [...a].reverse(), 200);
    const home = result.tasks.find((t) => t.task === "home");
    expect(home?.kappa.kappa).toBe(1);
    expect(home?.disagree).toEqual([]);
    expect(home?.confusion.map((c) => [c.a, c.b, c.count])).toEqual([
      ["none", "none", 5],
      ["statistics", "statistics", 5],
    ]);
    expect(result.tasks.map((t) => t.n)).toEqual([10, 6]);
  });

  it("names each disagreement in the order of the sample, and each task reads only its first n items", () => {
    const b = a.map((l) => (l.subject === "s1" || l.subject === "s8" ? { ...l, area: "random", category: "other" } : l));
    const result = agreementOf(file, a, b, 200);
    expect(result.tasks.find((t) => t.task === "home")?.disagree).toEqual(["s1", "s8"]);
    expect(result.tasks.find((t) => t.task === "purpose")?.disagree).toEqual(["s1"]);
    const home = result.tasks.find((t) => t.task === "home");
    expect(home?.kappa.kappa).toBeLessThan(1);
    expect(home?.interval.low).toBeLessThanOrEqual(home?.kappa.kappa ?? Number.NaN);
    expect(home?.audit).toHaveLength(3);
    expect(home?.audit.some((s) => s === "s1" || s === "s8")).toBe(false);
    expect(result.tasks.find((t) => t.task === "purpose")?.audit).toHaveLength(2);
    const marked = new Set(result.tasks.flatMap((t) => [...t.disagree, ...t.audit]));
    expect(result.person).toEqual(file.items.map((i) => i.subject).filter((s) => marked.has(s)));
  });

  it("checks the share of other on the items of the task purpose", () => {
    const b = a.map((l) => (l.subject === "s1" ? { ...l, category: "other" } : l));
    const result = agreementOf(file, a, b, 200);
    expect(result.other).toEqual({ a: 0, b: 1 / 6, limit: OTHER_LIMIT, pass: false });
  });

  it("refuses a draft with a missing or a repeated label", () => {
    expect(() => agreementOf(file, a, a.slice(1), 200)).toThrow(/no label of s0/);
    expect(() => agreementOf(file, a, [...a, a[0] as DraftLabel], 200)).toThrow(/two labels of s0/);
  });
});
