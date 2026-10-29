import { describe, expect, it } from "vitest";
import { buildAtlas, topicsOf, wordsOf } from "./atlas.ts";
import { atlasMarkdown } from "./report.ts";
import { isSource, packageOf, scanSource, type RepoScan } from "./scan.ts";
import { parseBuildArgs } from "./cli.ts";
import { listArgs, repoNames } from "./clone.ts";

const MEAN = `
export function mean(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return values.length === 0 ? 0 : sum / values.length;
}`;

/** The same function with other names, other literals and other types: one shape. */
const AVERAGE = `
// a comment
const average = (xs: number[]): number => 0;
export function average2(xs: Array<number>) {
  let total = 1;
  for (const x of xs) total += x;
  return xs.length === 0 ? 1 : total / xs.length;
}`;

/** One operator differs: a different shape. */
const PRODUCT = `
export function product(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) sum *= value;
  return values.length === 0 ? 0 : sum / values.length;
}`;

function repo(name: string, files: Readonly<Record<string, string>>): RepoScan {
  const scans = Object.entries(files).map(([file, text]) => scanSource(file, text));
  const units = scans.flatMap((s) => s.units);
  const imports: Record<string, number> = {};
  for (const s of scans) for (const p of s.imports) imports[p] = (imports[p] ?? 0) + 1;
  return {
    repo: name,
    commit: null,
    files: scans.length,
    nodes: units.reduce((sum, u) => (u.parent === null ? sum + u.nodes : sum), 0),
    units,
    exports: scans.flatMap((s) => s.exports),
    imports,
    errors: [],
  };
}

describe("scanSource", () => {
  it("gives one shape to functions that differ only in names, literals and types", () => {
    const a = scanSource("a.ts", MEAN).units.find((u) => u.name === "mean");
    const b = scanSource("b.ts", AVERAGE).units.find((u) => u.name === "average2");
    expect(a?.hash).toBeDefined();
    expect(a?.hash).toBe(b?.hash);
    expect(a?.nodes).toBe(b?.nodes);
  });

  it("gives another shape when an operator differs", () => {
    const a = scanSource("a.ts", MEAN).units[0];
    const c = scanSource("c.ts", PRODUCT).units[0];
    expect(a?.hash).not.toBe(c?.hash);
  });

  it("gives the line of each function, after comments and with multi-byte text", () => {
    const units = scanSource("b.ts", `// é ü 😀\n${AVERAGE}`).units;
    expect(units.map((u) => [u.name, u.line])).toEqual([
      ["average", 4],
      ["average2", 5],
    ]);
  });

  it("names functions by their declaration, variable, property, method or assignment", () => {
    const text = `
const a = () => 1;
const o = { b: () => 2, c() { return 3; } };
class K { d() { return 4; } constructor() {} }
module.exports.e = function () { return 5; };
`;
    expect(scanSource("n.js", text).units.map((u) => u.name)).toEqual(["a", "b", "c", "d", "constructor", "e"]);
  });

  it("keeps the parent of a nested function and marks exports and tests", () => {
    const units = scanSource("src/x.test.ts", "export function outer() { const inner = () => 1; return inner; }").units;
    expect(units.map((u) => [u.name, u.parent, u.exported, u.test])).toEqual([
      ["outer", null, true, true],
      ["inner", "src/x.test.ts:1", false, true],
    ]);
  });

  it("lists exports and the packages that the file imports", () => {
    const scan = scanSource(
      "src/i.ts",
      `import { z } from "zod"; import "./local.ts"; import x from "@scope/pkg/sub"; export * from "fast-check";
export interface I {} export type T = 1; export enum E { A } export const v = 1, w = 2; export class C {}
const later = await import("pino");`,
    );
    expect(scan.imports).toEqual(["@scope/pkg", "fast-check", "pino", "zod"]);
    expect(scan.exports.map((e) => `${e.kind}:${e.name}`)).toEqual(["type:I", "type:T", "enum:E", "variable:v", "variable:w", "class:C"]);
  });

  it("reads JSX and TSX", () => {
    expect(scanSource("v.tsx", "export const V = (p: { a: number }) => <div>{p.a}</div>;").units).toHaveLength(1);
    expect(scanSource("v.jsx", "export const V = (p) => <div>{p.a}</div>;").units).toHaveLength(1);
  });
});

describe("isSource", () => {
  it("reads the sources, and not the build output, the bundles and the generated code", () => {
    expect(isSource("packages/core/src/route.ts")).toBe(true);
    expect(isSource("site/src/Tabs.tsx")).toBe(true);
    expect(isSource("packages/core/dist/index.js")).toBe(false);
    expect(isSource("src/types.d.ts")).toBe(false);
    expect(isSource("public/app.min.js")).toBe(false);
    expect(isSource("packages/ireko/src/core/engine/place.generated.js")).toBe(false);
    expect(isSource("packages/compiler/src/__golden__/module-sheet.js")).toBe(false);
    expect(isSource("src/generated/schema.ts")).toBe(false);
  });
});

describe("clone", () => {
  it("lists the public sources that are not archived, and sorts the names", () => {
    expect(listArgs("o")).toEqual(["repo", "list", "o", "--visibility", "public", "--no-archived", "--source", "--limit", "1000", "--json", "name", "--jq", ".[].name"]);
    expect(repoNames("vex\r\npacking\n\n")).toEqual(["packing", "vex"]);
  });
});

describe("packageOf", () => {
  it("gives the package of a bare specifier, and nothing for relative and built-in ones", () => {
    expect(["lodash/fp", "@a/b/c", "./x", "node:fs", "#internal"].map(packageOf)).toEqual(["lodash", "@a/b", undefined, undefined, undefined]);
  });
});

describe("buildAtlas", () => {
  const scans = [
    repo("alpha", { "src/stats.ts": MEAN, "src/other.ts": PRODUCT }),
    repo("beta", { "src/avg.ts": AVERAGE }),
    repo("gamma", { "src/mean.ts": MEAN }),
  ];

  it("finds the clone class across repositories, with its duplicated nodes", () => {
    const atlas = buildAtlas(scans, { minNodes: 10 });
    const cls = atlas.classes[0];
    expect(cls?.repos).toEqual(["alpha", "beta", "gamma"]);
    expect(cls?.members.map((m) => m.name)).toEqual(["mean", "average2", "mean"]);
    expect(cls?.duplicatedNodes).toBe((cls?.nodes ?? 0) * 2);
    expect(cls?.topics).toEqual(["statistics"]);
    expect(atlas.totals.crossRepoClasses).toBe(1);
    expect(atlas.sharedNames.map((n) => n.name)).toEqual(["mean"]);
  });

  it("drops functions under the minimum size", () => {
    expect(buildAtlas(scans, { minNodes: 10_000 }).classes).toEqual([]);
  });

  it("drops a class whose each member is inside a cloned function", () => {
    const nested = `export function wrap(values: number[]) { const inner = (xs: number[]) => { let s = 0; for (const x of xs) s += x; return s * 2 + xs.length; }; return inner(values) + inner(values) * 3; }`;
    const atlas = buildAtlas([repo("a", { "a.ts": nested }), repo("b", { "b.ts": nested })], { minNodes: 5 });
    expect(atlas.classes.map((c) => c.members[0]?.name)).toEqual(["wrap"]);
  });

  it("gives one byte sequence for one input, in any order of the repositories", () => {
    const a = JSON.stringify(buildAtlas(scans, { minNodes: 10 }));
    const b = JSON.stringify(buildAtlas([...scans].reverse(), { minNodes: 10 }));
    expect(a).toBe(b);
  });

  it("writes Markdown with the totals and the cross-repository classes", () => {
    const md = atlasMarkdown(buildAtlas(scans, { minNodes: 10 }));
    expect(md).toContain("3 repositories");
    expect(md).toContain("`alpha/src/stats.ts:2` mean");
    expect(md).toContain("**statistics**");
  });
});

describe("words and topics", () => {
  it("splits camelCase, PascalCase acronyms, snake_case and paths", () => {
    expect(wordsOf("seededRNGFactory/latin_hypercube-x")).toEqual(["seeded", "rng", "factory", "latin", "hypercube", "x"]);
  });

  it("gives each topic of the words", () => {
    expect(topicsOf(["bootstrapInterval", "chaos/inject.ts"])).toEqual(["chaos-load", "statistics"]);
    expect(topicsOf(["meaning"])).toEqual([]);
  });
});

describe("parseBuildArgs", () => {
  it("reads the options and the repositories", () => {
    expect(parseBuildArgs(["--out", "a.json", "--min-nodes", "30", "--repos-dir", "r", "x=../x"], () => ["p", "q"])).toEqual({
      out: "a.json",
      markdown: undefined,
      minNodes: 30,
      repos: [
        { name: "p", path: "r/p".replace("/", process.platform === "win32" ? "\\" : "/") },
        { name: "q", path: "r/q".replace("/", process.platform === "win32" ? "\\" : "/") },
        { name: "x", path: "../x" },
      ],
    });
  });

  it("refuses a bad size, an unknown argument and no repositories", () => {
    expect(parseBuildArgs(["--min-nodes", "0", "a=b"])).toEqual({ error: "--min-nodes takes a whole number of 1 or more." });
    expect(parseBuildArgs(["--nope"])).toEqual({ error: "Unknown argument: --nope" });
    expect(parseBuildArgs([])).toHaveProperty("error");
  });
});
