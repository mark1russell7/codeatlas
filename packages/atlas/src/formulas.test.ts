import { readFileSync } from "node:fs";
import { parseSync } from "@swc/core";
import { afterAll, describe, expect, it } from "vitest";
import { factsOf } from "./facts.ts";
import {
  FORMULA_COPY_GATE,
  FORMULA_HOME_GATE,
  GENERIC_FORMULAS,
  fileKey,
  formulaClasses,
  formulaHash,
  formulaPrecision,
  formulaRecall,
  formulaReport,
  formulasMarkdown,
  skeletonOf,
  type FormulaRow,
  type OwnerFind,
} from "./formulas.ts";
import { queryOf } from "./query.ts";
import { scanRepoInto } from "./rescan.ts";
import { Catalog } from "./store.ts";
import { GitRepos } from "./testing/git-repo.ts";
import type { AstNode } from "./shape.ts";

/** This helper gives the skeleton text of one expression. */
const skeleton = (expression: string): string | undefined => {
  const module = parseSync(`(${expression});`, { syntax: "typescript" }) as unknown as { body: { expression: AstNode }[] };
  const statement = module.body[0];
  if (statement === undefined) throw new Error("no statement");
  return skeletonOf(statement.expression)?.text;
};

const GAUSS = "export function gauss(u: number, v: number): number {\n  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);\n}\n";

describe("skeletonOf", () => {
  it("replaces each operand with V and keeps the numbers and the members of Math", () => {
    expect(skeleton("Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)")).toBe(
      "(* call( G:Math.sqrt (* u- N:2 call( G:Math.log V ) ) ) call( G:Math.cos (* (* N:2 G:Math.PI ) V ) ) )",
    );
    expect(skeleton("(a.b as number)! ** 2")).toBe("(** V N:2 )");
  });

  it("gives undefined for a string, a template, a spread or a function", () => {
    expect(skeleton('"x" + a + b')).toBeUndefined();
    expect(skeleton("`${a}` + b")).toBeUndefined();
    expect(skeleton("Math.max(...a) + b")).toBeUndefined();
    expect(skeleton("(() => 1)() + b")).toBeUndefined();
  });
});

describe("factsOf formulas", () => {
  it("records each expression inside a function with 2 or more arithmetic operators", () => {
    const formulas = factsOf("a.ts", GAUSS).formulas;
    expect(formulas.map((f) => [f.line, f.arith, f.skeleton]).sort()).toContainEqual([2, 8, skeleton("Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)")]);
    expect(formulas.every((f) => f.arith >= 2 && f.hash.length === 16)).toBe(true);
  });

  it("does not record a module expression or a join of text", () => {
    const formulas = factsOf("a.ts", 'const top = 1 + 2 * 3 - 4;\nexport const label = (a: string, n: number) => "x" + a + "y" + n;\n').formulas;
    expect(formulas).toEqual([]);
  });
});

describe("GENERIC_FORMULAS", () => {
  const examples: Readonly<Record<string, string>> = {
    "(* (/ (- V V ) V ) N:100 )": "(a - b) / b * 100",
    "call( G:Math.floor (/ (- V V ) V ) )": "Math.floor((a - b) / c)",
    "(+ call( G:Math.floor (/ V V ) ) N:1 )": "Math.floor(a / b) + 1",
    "(- (/ V V ) (/ V V ) )": "a / b - c / d",
    "(* (- V V ) (- V V ) )": "(a - b) * (c - d)",
    "call( G:Math.round (/ (- call( G:Date.now ) V ) N:1000 ) )": "Math.round((Date.now() - t) / 1000)",
    "call( G:Math.min (- V N:1 ) call( G:Math.max N:0 (+ V V ) ) )": "Math.min(n - 1, Math.max(0, i + d))",
    "(* (/ (- V V ) V ) V )": "(v - a) / b * c",
  };

  it("has a reason for each form, and each form is the skeleton of a real expression", () => {
    expect(GENERIC_FORMULAS.length).toBe(Object.keys(examples).length);
    for (const form of GENERIC_FORMULAS) {
      expect(form.reason.length).toBeGreaterThan(0);
      expect(skeleton(examples[form.skeleton] ?? "")).toBe(form.skeleton);
    }
  });

  it("keeps a class of a generic form out of the leads", () => {
    const text = "(* (/ (- V V ) V ) N:100 )";
    const rows = ["a", "b", "c"].map((repo) => row(repo, `src/${repo}.ts`, 1, text, 3));
    expect(formulaClasses(rows)).toEqual([]);
    expect(formulaClasses(rows, { generic: [] })).toHaveLength(1);
  });
});

const row = (repo: string, path: string, line: number, text: string, arith: number, fn: string | null = null, fnLines: readonly [number, number] | null = null): FormulaRow => ({
  repo,
  path,
  line,
  fn,
  fnLines,
  hash: formulaHash(text),
  skeleton: text,
  arith,
});

describe("formulaClasses", () => {
  const long = "(* call( G:Math.sqrt V ) call( G:Math.cos V ) )";
  const part = "call( G:Math.sqrt (* V N:2 ) )";

  it("keeps a skeleton in 2 repositories or more with 3 operators or more, the highest score first", () => {
    const rows = [
      row("lag", "packages/load/src/rng.ts", 41, long, 3, "createRng.gauss"),
      row("rigor", "packages/generators/src/random.ts", 199, long, 3, "normal"),
      row("rigor", "packages/generators/src/random.ts", 199, "(* (+ V V ) (+ V V ) )", 3),
      row("lag", "src/one.ts", 5, "(* (+ V V ) (- V V ) )", 3),
      row("a", "src/x.ts", 1, "(** (+ V V ) (+ V V ) )", 2),
      row("b", "src/x.ts", 1, "(** (+ V V ) (+ V V ) )", 2),
    ];
    const classes = formulaClasses(rows);
    expect(classes.map((c) => [c.skeleton, c.repos, c.score])).toEqual([[long, ["lag", "rigor"], 6]]);
    expect(classes[0]?.home?.area).toBe("random");
  });

  it("drops a part of a longer formula when it has the same places", () => {
    const rows = [row("a", "src/x.ts", 3, long, 4), row("b", "src/y.ts", 9, long, 4), row("a", "src/x.ts", 3, part, 3), row("b", "src/y.ts", 9, part, 3)];
    expect(formulaClasses(rows).map((c) => c.skeleton)).toEqual([long]);
    const more = [...rows, row("c", "src/z.ts", 1, part, 3)];
    expect(formulaClasses(more).map((c) => c.skeleton)).toEqual([part, long]);
  });
});

describe("formulaRecall", () => {
  const backoff = "(* V (** N:2 V ) )";
  const rows = [
    row("systems", "packages/cells/src/retries.ts", 126, backoff, 2, "delays", [120, 130]),
    row("systems", "packages/kind/src/reconnects.ts", 91, backoff, 2, "reconnect", [80, 100]),
    row("systems", "packages/kind/src/reconnects.ts", 209, backoff, 2, "reconnectAll", [200, 220]),
    row("client", "packages/geo/src/mercator.ts", 18, backoff, 2, "tileSize", [15, 20]),
  ];
  const finds: OwnerFind[] = [
    { repo: "systems", path: "packages/cells/src/retries.ts", line: 126, name: "the retry delays", home: "service" },
    { repo: "systems", path: "packages/kind/src/reconnects.ts", line: null, name: "reconnect backoff, copy 1 of 3", home: "service" },
    { repo: "systems", path: "packages/kind/src/reconnects.ts", line: null, name: "reconnect backoff, copy 2 of 3", home: "service" },
    { repo: "systems", path: "packages/kind/src/reconnects.ts", line: null, name: "reconnect backoff, copy 3 of 3", home: "service" },
    { repo: "client", path: "packages/geo/src/mercator.ts", line: null, name: "project", home: "geometry" },
    { repo: "lag", path: "packages/load/src/rng.ts", line: 29, name: "createRng.next", home: "random" },
  ];

  it("counts a find once for each line of a member, at the floor 2 and not at 3", () => {
    const files = new Set([...rows.map((r) => fileKey(r.repo, r.path)), fileKey("lag", "packages/load/src/rng.ts")]);
    const two = formulaRecall(rows, finds, 2, files);
    expect([two.recalled, two.present, two.total]).toEqual([3, 6, 6]);
    expect(two.hits.map((h) => h.find)).toEqual(["systems:packages/cells/src/retries.ts", "systems:packages/kind/src/reconnects.ts", "systems:packages/kind/src/reconnects.ts"]);
    expect(formulaRecall(rows, finds, 3, files).recalled).toBe(0);
  });

  it("matches a find with a line by the function that holds the line", () => {
    const nested = [row("lag", "packages/load/src/rng.ts", 31, "(| (+ V N:1 ) N:0 )", 3, "createRng.next", [29, 35]), row("crawler", "src/og.ts", 4, "(| (+ V N:1 ) N:0 )", 3)];
    expect(formulaRecall(nested, finds, 3).hits).toEqual([{ find: "lag:packages/load/src/rng.ts", hash: formulaHash("(| (+ V N:1 ) N:0 )") }]);
  });
});

describe("formulaPrecision", () => {
  const verdict = (v: "right" | "partial" | "wrong") => ({ hash: "x", verdict: v, reason: "r", at: "2026-11-10" });
  const verdicts = (right: number, partial: number, wrong: number) =>
    [...Array<"right">(right).fill("right"), ...Array<"partial">(partial).fill("partial"), ...Array<"wrong">(wrong).fill("wrong")].map(verdict);

  it("is open with no verdict", () => {
    const none = formulaPrecision([]);
    expect([none.copy.decision, none.home.decision]).toEqual(["open", "open"]);
  });

  it("gives a copy precision over all leads and a home precision over the real copies", () => {
    // The verdicts of the first round: 7 right, 17 partial, 6 wrong
    const first = formulaPrecision(verdicts(7, 17, 6), 0);
    expect(first.copy).toMatchObject({ right: 24, judged: 30, low: 0.627, gate: FORMULA_COPY_GATE, decision: "keep" });
    expect(first.home).toMatchObject({ right: 7, judged: 24, low: 0.149, gate: FORMULA_HOME_GATE, decision: "cut" });
    expect(first.tokensPerRightMove).toBe(0);
    // A better home turns partial verdicts into right ones: only the home precision changes
    const better = formulaPrecision(verdicts(14, 10, 6), 1400);
    expect(better.copy).toEqual(first.copy);
    expect([better.home.right, better.home.decision, better.tokensPerRightMove]).toEqual([14, "keep", 100]);
    expect(formulaPrecision(verdicts(0, 0, 30)).home.decision).toBe("open");
    const markdown = formulasMarkdown({ version: "formulas/1", classes: [], recall: [], precision: first, generic: 0 });
    expect(markdown).toContain("| A real copy | 24 of 30 | 0.800 | [0.627, 0.905] | 0.5 | keep |");
    expect(markdown).toContain("| The right home, among the real copies | 7 of 24 | 0.292 |");
  });
});

describe("formulaReport", () => {
  const repos = new GitRepos();
  afterAll(() => repos.removeAll());

  it("finds one formula in two repositories of the catalog, with its home and the recall", async () => {
    const lag = repos.with({ "packages/load/src/rng.ts": GAUSS, "packages/load/src/rng.test.ts": GAUSS });
    const rigor = repos.with({ "packages/generators/src/random.ts": GAUSS.replace("gauss", "normal") });
    const catalog = new Catalog(":memory:");
    try {
      scanRepoInto(catalog, "lag", lag, [], "2026-11-09T00:00:00Z");
      scanRepoInto(catalog, "rigor", rigor, [], "2026-11-09T00:00:00Z");
      const finds: OwnerFind[] = [
        { repo: "lag", path: "packages/load/src/rng.ts", line: null, name: "gauss", home: "random" },
        { repo: "lag", path: "packages/load/src/gone.ts", line: 3, name: "x", home: "random" },
      ];
      const report = await formulaReport(queryOf(catalog.db), finds, []);
      const top = report.classes[0];
      expect(top?.repos).toEqual(["lag", "rigor"]);
      expect(top?.arith).toBe(8);
      expect(top?.members.map((m) => [m.repo, m.path, m.line, m.fn])).toEqual([
        ["lag", "packages/load/src/rng.ts", 2, "gauss"],
        ["rigor", "packages/generators/src/random.ts", 2, "normal"],
      ]);
      expect(top?.home?.area).toBe("random");
      expect(report.recall.map((r) => [r.floor, r.recalled, r.present, r.total])).toEqual([
        [2, 1, 1, 2],
        [3, 1, 1, 2],
      ]);
      const markdown = formulasMarkdown(report);
      expect(markdown).toContain("Each class is a lead to read, not a move.");
      expect(markdown).toContain("| 3 | 1 of 2 | 1 |");
      expect(markdown).toContain("The owners have not judged a lead yet.");
    } finally {
      catalog.db.close();
    }
  });
});

describe("labels/finds-1.jsonl", () => {
  it("is the fixed recall benchmark: the 16 copies that the owners found", () => {
    const finds = readFileSync(new URL("../../../labels/finds-1.jsonl", import.meta.url), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as OwnerFind & { readonly source: string });
    expect(finds).toHaveLength(16);
    expect(finds.filter((f) => f.source === "owners-1")).toHaveLength(8);
    expect(finds.every((f) => f.repo.length > 0 && f.path.length > 0 && f.name.length > 0 && (f.line === null || f.line > 0))).toBe(true);
  });
});
