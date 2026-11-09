import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkIndex, checkOf, commitsOfPath, importsOf, matchFunction, precisionMarkdown, referenceOf, type CodeIndexFile } from "./index.ts";

const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

const SOURCE = [
  'import { a } from "./a.ts";', // 1
  'import type { B } from "./b.ts";', // 2
  'export * from "./a.ts";', // 3
  "export function load(x: any, y: number) {", // 4
  "  if (x) {", // 5
  "    for (const z of y as never) {", // 6
  "      if (z && a) return z!;", // 7
  "    }", // 8
  "  }", // 9
  "  return y ?? 0;", // 10
  "}", // 11
  "class Store {", // 12
  "  trim(text: string): string {", // 13
  "    return text.trim();", // 14
  "  }", // 15
  "}", // 16
  "const twice = (n: number): number =>", // 17
  "  n * 2;", // 18
  "export { Store, twice };", // 19
  "",
].join("\n");

describe("referenceOf", () => {
  it("gives the lines and the rule values of each function, and the lines of the type escapes", () => {
    const file = referenceOf(SOURCE, "src/load.ts");
    expect(file.error).toBeNull();
    const load = matchFunction(file.functions, 4, 11);
    // 1, and the if, the for, the if, the && and the ?? of ESLint complexity
    expect(load).toEqual({ start: 4, end: 11, cyclomatic: 6, params: 2, cognitive: 7, depth: 3 });
    expect(matchFunction(file.functions, 13, 15)).toMatchObject({ start: 13, end: 15, cyclomatic: 1, params: 1, cognitive: 0, depth: 0 });
    expect(matchFunction(file.functions, 17, 18)).toMatchObject({ start: 17, end: 18, params: 1 });
    expect(file.unsafeLines).toEqual([4, 7]);
  });

  it("gives the message of the parser for a file that it cannot read", () => {
    expect(referenceOf("function (", "bad.ts").error).not.toBeNull();
  });
});

describe("importsOf", () => {
  it("gives each different specifier once", () => {
    expect(importsOf(SOURCE)).toEqual(["./a.ts", "./b.ts"]);
  });
});

describe("matchFunction", () => {
  const f = (start: number, end: number) => ({ start, end, cyclomatic: 1, params: 0, cognitive: 0, depth: 0 });
  it("needs the same last line, and takes the exact first line before a first line one apart", () => {
    expect(matchFunction([f(3, 9), f(4, 9)], 4, 9)).toEqual(f(4, 9));
    expect(matchFunction([f(3, 9)], 4, 9)).toEqual(f(3, 9));
    expect(matchFunction([f(4, 8)], 4, 9)).toBeUndefined();
    expect(matchFunction([f(2, 9)], 4, 9)).toBeUndefined();
  });
});

describe("checkOf", () => {
  it("counts the agreement, keeps the unmatched inputs out, and applies the gate to the Wilson lower bound", () => {
    const inputs = [
      ...Array.from({ length: 98 }, (_, i) => ({ place: `p${i}`, atlas: 1, reference: 1 })),
      { place: "miss", atlas: 2, reference: 3 },
      { place: "none", atlas: 2, reference: undefined },
    ];
    const check = checkOf("params", "test", inputs);
    expect(check).toMatchObject({ agree: 98, checked: 99, unmatched: 1, counts: true, misses: [{ place: "miss", atlas: 2, reference: 3 }] });
    expect(check.low).toBeGreaterThan(0.9);
    expect(checkOf("params", "test", inputs.slice(97)).counts).toBe(false);
    expect(checkOf("params", "test", []).counts).toBe(false);
  });
});

describe("checkIndex", () => {
  it("checks the index of a clone against the reference tools", () => {
    const reposDir = mkdtempSync(join(tmpdir(), "precision-"));
    folders.push(reposDir);
    const root = join(reposDir, "r");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "load.ts"), SOURCE);
    const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
    git("init", "--quiet");
    git("add", ".");
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "--quiet", "-m", "one");
    const until = new Date(Date.now() + 60_000).toISOString();
    expect(commitsOfPath(root, "src/load.ts", until, 90)).toBe(1);

    const index: CodeIndexFile = {
      functions: [
        { repo: "r", path: "src/load.ts", name: "load", line: 4, endLine: 11, values: { length: 8, params: 2, cyclomatic: 6, depth: 3, cognitive: 7, unsafe_types: 2, churn: 1 } },
        { repo: "r", path: "src/load.ts", name: "Store.trim", line: 13, endLine: 15, values: { length: 3, params: 1, cyclomatic: 1, depth: 0, cognitive: 0, unsafe_types: 0, churn: 1 } },
        { repo: "r", path: "src/load.ts", name: "twice", line: 17, endLine: 18, values: { length: 2, params: 1, cyclomatic: 1, depth: 0, cognitive: 1, unsafe_types: 0, churn: 2 } },
        { repo: "r", path: "src/gone.ts", name: "gone", line: 1, endLine: 2, values: { length: 2, params: 0, cyclomatic: 1, depth: 0, cognitive: 0, unsafe_types: 0 } },
      ],
      modules: [{ repo: "r", path: "src/load.ts", values: { imports: 2 } }],
    };
    const report = checkIndex(index, { reposDir, seed: "test", at: "2026-11-08T00:00:00Z", churnUntil: new Map([["r", { until, days: 90 }]]) });
    const by = new Map(report.checks.map((c) => [c.dimension, c]));
    expect([...by.keys()]).toEqual(["length", "params", "cyclomatic", "depth", "cognitive", "unsafe_types", "churn", "imports"]);
    expect(by.get("params")).toMatchObject({ agree: 3, checked: 3, unmatched: 1 });
    expect(by.get("cognitive")).toMatchObject({ agree: 2, checked: 3, misses: [{ place: "r:src/load.ts:17", atlas: 1, reference: 0 }] });
    expect(by.get("unsafe_types")).toMatchObject({ agree: 3, checked: 3 });
    expect(by.get("churn")).toMatchObject({ agree: 2, checked: 3, unmatched: 1 });
    expect(by.get("imports")).toMatchObject({ agree: 1, checked: 1 });
    // The same seed draws the same sample
    expect(checkIndex(index, { reposDir, seed: "test", at: "x" }).checks).toEqual(checkIndex(index, { reposDir, seed: "test", at: "y" }).checks);
    expect(precisionMarkdown(report)).toContain("| cognitive | the rule cognitive-complexity of SonarJS | 2 | 3 | 1 |");
  });
});
