import { parseSync } from "@swc/core";
import { describe, expect, it } from "vitest";
import { calleeText, cognitiveOf, commentsOf, complexityOf, factsOf } from "./facts.ts";
import { cloneHashes } from "./hashes.ts";
import { shapeOf, type AstNode } from "./shape.ts";

/** The parts of the first function of a text, as the scan gives them to the hash. */
function partsOf(text: string): unknown[] {
  const module = parseSync(text, { syntax: "typescript" });
  const fn = (module.body[0] as unknown as AstNode);
  return [fn["params"], fn["body"]];
}

/**
 * The variants of one function: each edit that one clone level forgets. The law test compares each pair.
 * The names: `base` and the edits `rename`, `literal`, `type`, `operator`, `comment`, `spread`, `swapped`.
 */
const VARIANTS: Readonly<Record<string, string>> = {
  base: "function f(xs: number[], k: number) { let sum = 0; for (const x of xs) sum += x * k; return xs.length === 0 ? 0 : sum / xs.length; }",
  comment: "function f(xs: number[], k: number) {\n  // a comment\n  let sum = 0;\n  for (const x of xs) sum += x * k;\n  return xs.length === 0 ? 0 : sum / xs.length;\n}",
  rename: "function g(ys: number[], m: number) { let total = 0; for (const y of ys) total += y * m; return ys.length === 0 ? 0 : total / ys.length; }",
  literal: "function f(xs: number[], k: number) { let sum = 1; for (const x of xs) sum += x * k; return xs.length === 0 ? 2 : sum / xs.length; }",
  type: "function f(xs: readonly number[], k: bigint) { let sum = 0; for (const x of xs) sum += x * k; return xs.length === 0 ? 0 : sum / xs.length; }",
  operator: "function f(xs: number[], k: number) { let sum = 0; for (const x of xs) sum -= x * k; return xs.length === 0 ? 0 : sum / xs.length; }",
  // Two names become one: renamed sees it, shape does not
  swapped: "function f(xs: number[], k: number) { let sum = 0; for (const x of xs) sum += x * x; return xs.length === 0 ? 0 : sum / xs.length; }",
  spread: "function f(xs: number[], k: number) { let sum = 0; for (const x of xs) sum += x * k; return Math.max(...xs, sum); }",
  plain: "function f(xs: number[], k: number) { let sum = 0; for (const x of xs) sum += x * k; return Math.max(xs, sum); }",
};

describe("cloneHashes", () => {
  const hashes = Object.fromEntries(Object.entries(VARIANTS).map(([name, text]) => [name, cloneHashes(partsOf(text))]));
  const h = (name: string) => hashes[name] ?? expect.unreachable(name);

  it("gives the shape hash of codeatlas/1 with the same bytes", () => {
    for (const text of Object.values(VARIANTS)) {
      const parts = partsOf(text);
      expect(cloneHashes(parts).shape).toBe(shapeOf(parts).hash);
      expect(cloneHashes(parts).nodes).toBe(shapeOf(parts).nodes);
    }
  });

  it("forgets at each level what the level forgets", () => {
    expect(h("comment").exact).toBe(h("base").exact);
    expect(h("rename").exact).not.toBe(h("base").exact);
    expect(h("rename").renamed).toBe(h("base").renamed);
    expect(h("literal").renamed).toBe(h("base").renamed);
    expect(h("literal").exact).not.toBe(h("base").exact);
    expect(h("type").renamed).toBe(h("base").renamed);
    expect(h("type").exact).not.toBe(h("base").exact);
    expect(h("swapped").renamed).not.toBe(h("base").renamed);
    expect(h("swapped").shape).toBe(h("base").shape);
    expect(h("spread").renamed).not.toBe(h("plain").renamed);
    expect(h("spread").shape).toBe(h("plain").shape);
    expect(h("operator").shape).not.toBe(h("base").shape);
  });

  it("keeps the law of the chain for each pair: one exact hash gives one renamed hash, and one renamed hash one shape hash", () => {
    const names = Object.keys(hashes);
    let pairs = 0;
    for (const a of names) for (const b of names) {
      if (h(a).exact === h(b).exact) expect([a, b, h(a).renamed]).toEqual([a, b, h(b).renamed]);
      if (h(a).renamed === h(b).renamed) expect([a, b, h(a).shape]).toEqual([a, b, h(b).shape]);
      pairs++;
    }
    expect(pairs).toBe(names.length * names.length);
  });
});

describe("factsOf", () => {
  const text = `
import { readFileSync } from "node:fs";
import type { Shape } from "./shape.ts";
import * as path from "path";
import def, { a as b } from "@scope/pkg/sub";
export { x as y } from "./x.ts";
export * from "./all.ts";

// TODO: one thing
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) {
    if (value > 0 && value < 10) sum += value;
  }
  return sum / values.length;
}

export const half = (n: number) => n / 2;
export const LIMIT = 3;

export interface Box { w: number; h: number }
export type Size = { h: number; w: number };

export class Shelf {
  place(box: Box): void {
    const raw = readFileSync(path.join("a", "b"), "utf8") as unknown as string;
    def(raw!);
  }
}

describe("mean", () => {
  it("gives 0 for no values", () => {
    mean([]);
  });
});

const lazy = () => import("./lazy.ts");
const old = require("old-pkg"); /* FIXME later */
`;
  const facts = factsOf("src/mean.ts", text);
  const byName = (name: string) => facts.symbols.find((s) => s.qualifiedName === name);

  it("gives each import with its kind, its package and its bindings", () => {
    expect(facts.imports.map((i) => [i.specifier, i.kind, i.package])).toEqual([
      ["node:fs", "static", null],
      ["./shape.ts", "type", null],
      ["path", "static", "path"],
      ["@scope/pkg/sub", "static", "@scope/pkg"],
      ["./x.ts", "re-export", null],
      ["./all.ts", "re-export", null],
      ["./lazy.ts", "dynamic", null],
      ["old-pkg", "require", "old-pkg"],
    ]);
    expect(facts.imports[3]?.names).toEqual([
      { imported: "default", local: "def" },
      { imported: "a", local: "b" },
    ]);
    expect(facts.imports[2]?.names).toEqual([{ imported: "*", local: "path" }]);
  });

  it("gives each export, with the symbol or the source of a re-export", () => {
    expect(facts.exports.map((e) => [e.name, e.symbol, e.from])).toEqual([
      ["*", null, "./all.ts"],
      ["Box", "Box", null],
      ["LIMIT", "LIMIT", null],
      ["Shelf", "Shelf", null],
      ["Size", "Size", null],
      ["half", "half", null],
      ["mean", "mean", null],
      ["y", null, "./x.ts"],
    ]);
  });

  it("gives each symbol with a qualified name that is unique in the file", () => {
    expect(facts.symbols.map((s) => [s.qualifiedName, s.kind, s.exported])).toEqual([
      ["mean", "function", true],
      ["half", "function", true],
      ["LIMIT", "variable", true],
      ["Box", "interface", true],
      ["Size", "type", true],
      ["Shelf", "class", true],
      ["Shelf.place", "method", false],
      ['describe("mean")', "function", false],
      ['describe("mean").it("gives 0 for no values")', "function", false],
      ["lazy", "function", false],
    ]);
    const names = facts.symbols.map((s) => s.qualifiedName);
    expect(new Set(names).size).toBe(names.length);
    expect(byName("Shelf.place")?.parent).toBe("Shelf");
  });

  it("gives the facts of a function", () => {
    const mean = byName("mean")?.fn;
    expect(mean?.params).toBe(1);
    expect(mean?.signature).toBe("function mean(values: readonly number[]): number");
    // if, for-of, inner if, && : 4 decisions
    expect(mean?.cyclomatic).toBe(5);
    // the for-of, and the if in it
    expect(mean?.depth).toBe(2);
    expect(byName("mean")?.line).toBe(10);
    expect(byName("mean")?.endLine).toBe(17);
    expect(byName("half")?.fn?.depth).toBe(0);
  });

  it("gives one type hash to one structure with two names and another member order", () => {
    expect(byName("Box")?.typeHash).toBe(byName("Size")?.typeHash);
    expect(byName("Box")?.typeHash).not.toBeNull();
  });

  it("gives each call site with its caller", () => {
    const sites = facts.callSites.map((c) => [c.caller, c.callee]);
    expect(sites).toContainEqual(["Shelf.place", "readFileSync"]);
    expect(sites).toContainEqual(["Shelf.place", "path.join"]);
    expect(sites).toContainEqual(["Shelf.place", "def"]);
    expect(sites).toContainEqual(['describe("mean").it("gives 0 for no values")', "mean"]);
    expect(sites).toContainEqual(["<module>", "describe"]);
    expect(sites).toContainEqual(["<module>", "require"]);
  });

  it("gives the debt markers of the comments and of the syntax", () => {
    expect(facts.markers.map((m) => [m.kind, m.line])).toEqual([
      ["todo", 9],
      ["as-unknown-as", 27],
      ["non-null", 28],
      ["fixme", 39],
    ]);
  });

  it("gives the same facts for the same text", () => {
    expect(JSON.stringify(factsOf("src/mean.ts", text))).toBe(JSON.stringify(facts));
    expect(JSON.stringify(factsOf("lib/other.mts", text))).toBe(JSON.stringify(facts));
  });
});

describe("globals", () => {
  /** The globals of a text as `name use line count`. */
  const globals = (text: string, file = "src/g.ts"): string[] => factsOf(file, text).globals.map((g) => `${g.name} ${g.use} ${g.line} ${g.count}`);
  const names = (text: string, file = "src/g.ts"): string[] => factsOf(file, text).globals.map((g) => `${g.name} ${g.use}`);

  it("gives each name and use, with an alias of a member of globalThis", () => {
    const text = [
      "const WS = globalThis.WebSocket || globalThis.MozWebSocket;",
      'if (typeof EventSource !== "undefined") new WS(url);',
      "fetch(u);",
    ].join("\n");
    expect(globals(text)).toEqual([
      "EventSource typeof 2 1",
      "MozWebSocket read 1 1",
      "WebSocket read 1 1",
      "fetch call 3 1",
      "globalThis read 1 2",
      "u read 3 1",
      "url read 2 1",
    ]);
  });

  it("gives the line of the first use and the count of the uses", () => {
    expect(globals("x = 1;\nfetch(1);\nfetch(2); new fetch(3);\n")).toEqual(["fetch call 2 2", "fetch new 3 1", "x read 1 1"]);
  });

  it("gives the use of a callee in brackets, behind `!`, in an optional chain and in a sequence", () => {
    expect(names("(fetch)(1); WebSocket!(2); EventSource?.(3); (0, Worker)(4); new (Blob as any)(); typeof (Response);")).toEqual([
      "Blob new",
      "EventSource call",
      "Response typeof",
      "WebSocket call",
      "Worker call",
      "fetch call",
    ]);
  });

  it("counts a member of an unbound global object as a use of the member name", () => {
    const text = 'new globalThis.WebSocket(a); window["fetch"](b); typeof self.EventSource; global.process.env; globalThis?.Worker(c); globalThis[key];';
    expect(names(text)).toEqual([
      "EventSource typeof",
      "WebSocket new",
      "Worker call",
      "a read",
      "b read",
      "c read",
      "fetch call",
      "global read",
      "globalThis read",
      "key read",
      "process read",
      "self read",
      "window read",
    ]);
    // A bound object is not a global object
    expect(names("function post(self) { self.postMessage(1); } const window = {}; new window.WebSocket();")).toEqual([]);
  });

  it("does not give a name that a parameter, a pattern or a catch clause binds", () => {
    const text = `
function load(fetch: (u: string) => unknown) { return fetch("a"); }
const open = (WebSocket) => new WebSocket("b");
function pick({ fetch = globalThis.fetch, rest: [Blob] = [] } = {}, ...more) { return fetch(Blob, more); }
try { run(); } catch (Error) { Error; }
for (const URL of list) URL;
class Box { constructor(private Headers = 1) { Headers; } }
`;
    expect(names(text)).toEqual(["fetch read", "globalThis read", "list read", "run call"]);
  });

  it("binds a var and a function before their declarations, in the scope of the function", () => {
    const text = `
first(); later; inner;
var later = 1;
function first() { if (a) { var inner = 2; } return inner + hidden; }
{ var block = 3; }
block;
`;
    expect(names(text)).toEqual(["a read", "hidden read", "inner read"]);
  });

  it("binds let, const and class only in their block", () => {
    const text = `
{ let inner = 1; inner++; const K = 2; class Shape {} }
inner; K; new Shape();
for (let i = 0; i < 2; i++) {}
i;
switch (s) { case 1: let c = 1; c; }
c;
`;
    expect(globals(text)).toEqual(["K read 3 1", "Shape new 3 1", "c read 7 1", "i read 5 1", "inner read 3 1", "s read 6 1"]);
  });

  it("does not count the type positions, the keys, the members, the labels and the names that the file binds", () => {
    const text = `
import { readFile } from "node:fs";
import type { Shape } from "./shape.ts";
interface Box extends Base { ws: WebSocket }
type T = typeof fetch;
class C implements Iface<Gen> { x: Foo = 1 as unknown as Bar; m<P extends Q>(a: R): S { return a as Z; } }
const v: Array<Map<K, V>> = [] satisfies W[];
function f<P>(this: Window, p: P): asserts p is Q {}
enum E { A = 1, B = A * 2 }
namespace N { export const z = 1; }
const o = { key: 1, nested: { deep: 2 }, method() { return arguments; } };
o.key.deep; o.method(); readFile; E.B; N.z;
outer: for (;;) break outer;
export default function main() {}
main();
JSON.stringify(o);
`;
    expect(names(text)).toEqual(["JSON read"]);
  });

  it("gives a name of JSX with a capital letter, and not a tag of HTML", () => {
    const text = "export const App = () => <div onClick={handler}><Widget.Item /><Comp x={y} /><my-el /></div>;";
    expect(names(text, "src/app.tsx")).toEqual(["Comp read", "Widget read", "handler read", "y read"]);
  });

  it("reads JavaScript and a destructuring assignment", () => {
    const text = "let a; [a, b] = pair; ({ c, d: e = f } = obj);";
    expect(names(text, "lib/x.js")).toEqual(["b read", "c read", "e read", "f read", "obj read", "pair read"]);
  });
});

describe("helpers", () => {
  it("writes the callee as it is written", () => {
    const callee = (code: string) => {
      const statement = parseSync(code, { syntax: "typescript" }).body[0] as unknown as AstNode;
      return calleeText((statement["expression"] as AstNode)["callee"]);
    };
    expect(callee("a.b.c();")).toBe("a.b.c");
    expect(callee("a[0]();")).toBe("a[]");
    expect(callee("this.run();")).toBe("this.run");
    expect(callee("(f || g)();")).toBe("<expr>");
  });

  it("finds comments, and skips strings and template literals", () => {
    const comments = commentsOf('const a = "// no"; // yes\nconst b = `/* no */`;\n/* one\n two */');
    expect(comments).toEqual([
      { line: 1, text: " yes" },
      { line: 3, text: " one" },
      { line: 4, text: " two " },
    ]);
  });

  it("counts the decision points of a body", () => {
    const body = (code: string) => (parseSync(code, { syntax: "typescript" }).body[0] as unknown as AstNode)["body"];
    expect(complexityOf(body("function f() {}"))).toEqual({ cyclomatic: 1, depth: 0 });
    expect(complexityOf(body("function f(a) { if (a) if (a > 1) { while (a) a--; } }")).depth).toBe(3);
    expect(complexityOf(body("function f(a) { switch (a) { case 1: break; case 2: break; default: } return a ?? (a || 1); }")).cyclomatic).toBe(5);
    // A nested function counts for itself
    expect(complexityOf(body("function f() { const g = () => { if (x) {} }; }")).cyclomatic).toBe(1);
    // A default value and an optional chain count, as in the rule complexity of ESLint
    expect(complexityOf(body("function f(a) { const { b = 1, c } = a; return a?.b?.c() ?? b; }")).cyclomatic).toBe(5);
  });

  it("gives the cognitive complexity of the examples of the specification", () => {
    const body = (code: string) => (parseSync(code, { syntax: "typescript" }).body[0] as unknown as AstNode)["body"];
    expect(cognitiveOf(body("function f() { return 1; }"))).toBe(0);
    // sumOfPrimes: the loops +1 and +2, the if +3, the continue to a label +1
    const primes = "function f(max) { let t = 0; OUT: for (let i = 1; i <= max; ++i) { for (let j = 2; j < i; ++j) { if (i % j == 0) { continue OUT; } } t += i; } return t; }";
    expect(cognitiveOf(body(primes))).toBe(7);
    // getWords: one switch, with no nesting, is +1 for all of its cases
    expect(cognitiveOf(body('function f(n) { switch (n) { case 1: return "one"; case 2: return "two"; default: return "lots"; } }'))).toBe(1);
    // An else if and an else add 1 each, with no nesting
    expect(cognitiveOf(body("function f(a, b) { if (a) {} else if (b) {} else {} }"))).toBe(3);
    // A nested if adds its nesting
    expect(cognitiveOf(body("function f(a, b) { if (a) { if (b) {} } }"))).toBe(3);
    // Each run of && adds 1, and parentheses do not start a run. SonarJS 4 does not count || and ??
    expect(cognitiveOf(body("function f(a, b, c, d) { return a && b && c || d; }"))).toBe(1);
    expect(cognitiveOf(body("function f(a, b, c, d) { return a && b || c && d; }"))).toBe(2);
    expect(cognitiveOf(body("function f(a, b, c) { return a && (b && c); }"))).toBe(1);
    expect(cognitiveOf(body("function f(a, b, c) { return a && (b ?? c) && d; }"))).toBe(2);
    expect(cognitiveOf(body("function f(a, b) { return a || b; }"))).toBe(0);
    expect(cognitiveOf(body("function f(a) { return a ?? 1; }"))).toBe(0);
    // A short circuit of one operator in JSX adds nothing, and a mixed chain counts
    const jsx = (code: string) => (parseSync(code, { syntax: "typescript", tsx: true }).body[0] as unknown as AstNode)["body"];
    expect(cognitiveOf(jsx("function F(a, b) { return <p>{a && b && <i />}</p>; }"))).toBe(0);
    expect(cognitiveOf(jsx("function F(a, b) { return <p>{a && b || <i />}</p>; }"))).toBe(1);
    // A conditional in an if, and a catch with an if in it
    expect(cognitiveOf(body("function f(a, b) { let x; if (a) { x = b ? 1 : 2; } return x; }"))).toBe(3);
    expect(cognitiveOf(body("function f(a, b) { try { if (a) {} } catch (e) { if (b) {} } }"))).toBe(4);
    // A nested function counts for itself
    expect(cognitiveOf(body("function f() { const g = () => { if (x) {} }; }"))).toBe(0);
  });
});
