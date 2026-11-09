import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { calleeNamesOf, checkIndex, checkOf, commitsOfPath, importsOf, matchFunction, precisionMarkdown, referenceOf, tokenLinesOf, type CodeIndexFile } from "./index.ts";

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
    expect(load).toEqual({ start: 4, end: 11, cyclomatic: 6, params: 2, cognitive: 7, depth: 3, fanOut: 0 });
    expect(matchFunction(file.functions, 13, 15)).toMatchObject({ start: 13, end: 15, cyclomatic: 1, params: 1, cognitive: 0, depth: 0, fanOut: 1 });
    expect(matchFunction(file.functions, 17, 18)).toMatchObject({ start: 17, end: 18, params: 1 });
    expect(file.unsafeLines).toEqual([4, 7]);
  });

  it("gives the different callees of each function, as written, and a call in a nested function counts for it", () => {
    const calls = [
      "export function run(xs: number[], s: Store) {", // 1
      "  const f = (x: number) => g(x);", // 2
      "  s.save(xs); s.save([]); this?.m?.(); new Map();", // 3
      '  xs[0]!.toFixed(); (s as any).load(); import("./x.ts"); require("y");', // 4
      "  return f(1);", // 5
      "}", // 6
      "",
    ].join("\n");
    const file = referenceOf(calls, "src/run.ts");
    // s.save, this.m, Map, xs[].toFixed, s.load, require and f: the call g belongs to the arrow function
    expect(matchFunction(file.functions, 1, 6)?.fanOut).toBe(7);
    expect(matchFunction(file.functions, 2, 2)?.fanOut).toBe(1);
    expect(calleeNamesOf(calls, "src/run.ts")).toEqual(["g", "save", "save", "m", "Map", "toFixed", "load", "require", "f"]);
  });

  it("gives the message of the parser for a file that it cannot read", () => {
    expect(referenceOf("function (", "bad.ts").error).not.toBeNull();
  });
});

describe("tokenLinesOf", () => {
  it("gives the line of each leaf with a width, without comments, JSDoc and the text of JSX", () => {
    const text = ["/** A doc. */", "const j = <a>{n} words</a>; // end", "const t = `x${y}z`;", ""].join("\n");
    // const j = < a > { n } < / a > ; and const t = head y tail ;
    expect(tokenLinesOf(text, "src/x.tsx")).toEqual([...Array<number>(14).fill(2), ...Array<number>(7).fill(3)]);
  });
});

describe("importsOf", () => {
  it("gives each different specifier once", () => {
    expect(importsOf(SOURCE)).toEqual(["./a.ts", "./b.ts"]);
  });
});

describe("matchFunction", () => {
  const f = (start: number, end: number) => ({ start, end, cyclomatic: 1, params: 0, cognitive: 0, depth: 0, fanOut: 0 });
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
        { repo: "r", path: "src/load.ts", name: "load", simple: "load", line: 4, endLine: 11, values: { length: 8, params: 2, cyclomatic: 6, depth: 3, cognitive: 7, fan_out: 0, fan_in: 0, unsafe_types: 2, tokens: 46, churn: 1 } },
        { repo: "r", path: "src/load.ts", name: "Store.trim", simple: "trim", line: 13, endLine: 15, values: { length: 3, params: 1, cyclomatic: 1, depth: 0, cognitive: 0, fan_out: 1, fan_in: 1, unsafe_types: 0, tokens: 17, churn: 1 } },
        { repo: "r", path: "src/load.ts", name: "twice", simple: "twice", line: 17, endLine: 18, values: { length: 2, params: 1, cyclomatic: 1, depth: 0, cognitive: 1, fan_out: 0, fan_in: 5, unsafe_types: 0, tokens: 14, churn: 2 } },
        { repo: "r", path: "src/gone.ts", name: "gone", simple: "gone", line: 1, endLine: 2, values: { length: 2, params: 0, cyclomatic: 1, depth: 0, cognitive: 0, unsafe_types: 0 } },
      ],
      modules: [{ repo: "r", path: "src/load.ts", values: { imports: 2 } }],
    };
    const report = checkIndex(index, { reposDir, seed: "test", at: "2026-11-08T00:00:00Z", churnUntil: new Map([["r", { until, days: 90 }]]) });
    const by = new Map(report.checks.map((c) => [c.dimension, c]));
    expect([...by.keys()]).toEqual(["length", "params", "cyclomatic", "depth", "cognitive", "fan_out", "unsafe_types", "tokens", "churn", "fan_in", "imports"]);
    expect(by.get("params")).toMatchObject({ agree: 3, checked: 3, unmatched: 1 });
    expect(by.get("cognitive")).toMatchObject({ agree: 2, checked: 3, misses: [{ place: "r:src/load.ts:17", atlas: 1, reference: 0 }] });
    expect(by.get("unsafe_types")).toMatchObject({ agree: 3, checked: 3 });
    // The TypeScript compiler gives 15 tokens for twice. gone has no file and no value
    expect(by.get("tokens")).toMatchObject({ agree: 2, checked: 3, unmatched: 1, misses: [{ place: "r:src/load.ts:17", atlas: 14, reference: 15 }] });
    expect(by.get("churn")).toMatchObject({ agree: 2, checked: 3, unmatched: 1 });
    expect(by.get("fan_out")).toMatchObject({ agree: 3, checked: 3, unmatched: 1 });
    // The call text.trim() is the one call of trim in the repository. gone has no value in the index.
    expect(by.get("fan_in")).toMatchObject({ agree: 2, checked: 3, unmatched: 1, misses: [{ place: "r:src/load.ts:17", atlas: 5, reference: 0 }] });
    expect(by.get("imports")).toMatchObject({ agree: 1, checked: 1 });
    // The same seed draws the same sample
    expect(checkIndex(index, { reposDir, seed: "test", at: "x" }).checks).toEqual(checkIndex(index, { reposDir, seed: "test", at: "y" }).checks);
    expect(precisionMarkdown(report)).toContain("| cognitive | the rule cognitive-complexity of SonarJS | 2 | 3 | 1 |");
  });
});
