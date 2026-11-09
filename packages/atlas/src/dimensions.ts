/**
 * The dimensions of the code (CA20 of `docs/ROADMAP.md`): each attribute that the catalog measures, as data. A dimension
 * has a definition, an extractor, a unit and a measured precision. It counts only after a check of its precision.
 * The function index gives the value of each dimension for each function outside the tests.
 */
import { quantile, wilson } from "@mark1russell7/rigor-statistics";
import { CHURN_DAYS } from "./churn.ts";
import type { CatalogQuery } from "./query.ts";

/** The version of the dimension catalog. A new dimension or a new definition gives a new version. */
export const DIMENSIONS_VERSION: string = "dimensions/2";

/** A dimension counts when the Wilson lower bound of its precision check is this value or more. */
export const DIMENSION_PRECISION_GATE: number = 0.9;

/** The source of the values of a dimension. Only `model` costs tokens. */
export type Extractor = "parser" | "git" | "ci" | "derived" | "model";

/** The thing that a dimension measures. */
export type DimensionScope = "function" | "module";

/** The result of a check of a dimension against an independent source. */
export interface DimensionPrecision {
  /** The independent source of the check, for example the TypeScript compiler. */
  readonly method: string;
  readonly agree: number;
  readonly checked: number;
  readonly at: string;
}

/** One attribute of the code. */
export interface Dimension {
  /** The stable name of the dimension, in snake case. */
  readonly id: string;
  readonly title: string;
  /** The definition, in one or two sentences. */
  readonly definition: string;
  readonly unit: string;
  readonly scope: DimensionScope;
  readonly extractor: Extractor;
  /** The tables of the catalog that give the values. */
  readonly source: string;
  /** True when a high value is a risk. */
  readonly higherIsWorse: boolean;
  /** The last check of the precision, or null before the first check. */
  readonly precision: DimensionPrecision | null;
}

/** The dimensions of `dimensions/2`. Each one comes from the parser, the git history or the CI, with no model tokens. */
export const DIMENSIONS: readonly Dimension[] = [
  {
    id: "length",
    title: "Length",
    definition: "The lines from the first line of the function to its last line, nested functions included.",
    unit: "lines",
    scope: "function",
    extractor: "parser",
    source: "symbol.line, symbol.end_line",
    higherIsWorse: true,
    precision: null,
  },
  {
    id: "params",
    title: "Parameters",
    definition: "The parameters of the function. A destructured parameter counts as one.",
    unit: "parameters",
    scope: "function",
    extractor: "parser",
    source: "symbol.params",
    higherIsWorse: true,
    precision: null,
  },
  {
    id: "nodes",
    title: "Size",
    definition: "The syntax nodes of the parameters and the body, without the types.",
    unit: "nodes",
    scope: "function",
    extractor: "parser",
    source: "symbol.nodes",
    higherIsWorse: true,
    precision: null,
  },
  {
    id: "cyclomatic",
    title: "Cyclomatic complexity",
    definition: "The decision points plus one, as the rule complexity of ESLint counts them. A nested function counts for itself, not for the function that holds it.",
    unit: "paths",
    scope: "function",
    extractor: "parser",
    source: "symbol.cyclomatic",
    higherIsWorse: true,
    precision: null,
  },
  {
    id: "depth",
    title: "Nesting depth",
    definition: "The deepest nesting of control statements in the body: `if`, the loops, `switch` and `try`.",
    unit: "levels",
    scope: "function",
    extractor: "parser",
    source: "symbol.depth",
    higherIsWorse: true,
    precision: null,
  },
  {
    id: "cognitive",
    title: "Cognitive complexity",
    definition: "The effort to read the body, after the specification of SonarSource. Each structure adds 1 plus its nesting. A nested function counts for itself.",
    unit: "points",
    scope: "function",
    extractor: "parser",
    source: "symbol.cognitive",
    higherIsWorse: true,
    precision: null,
  },
  {
    id: "fan_out",
    title: "Fan-out",
    definition: "The different callees of the function, as written. A call in a nested function counts for the nested function.",
    unit: "callees",
    scope: "function",
    extractor: "parser",
    source: "call_site.caller, call_site.callee",
    higherIsWorse: true,
    precision: null,
  },
  {
    id: "fan_in",
    title: "Fan-in",
    definition: "The call sites in the same repository whose callee ends with the name of the function. Two functions with one name share their calls.",
    unit: "call sites",
    scope: "function",
    extractor: "parser",
    source: "call_site.callee",
    higherIsWorse: false,
    precision: null,
  },
  {
    id: "unsafe_types",
    title: "Type escapes",
    definition: "The explicit `any`, `as unknown as`, non-null assertions, `@ts-ignore` and `@ts-expect-error` in the lines of the function.",
    unit: "markers",
    scope: "function",
    extractor: "parser",
    source: "marker.kind, marker.line",
    higherIsWorse: true,
    precision: null,
  },
  {
    id: "churn",
    title: "Churn",
    definition: `The commits of the ${CHURN_DAYS} days before the scan that changed the file of the function. A shallow clone gives no value.`,
    unit: "commits",
    scope: "function",
    extractor: "git",
    source: "churn_run, churn.commits",
    higherIsWorse: true,
    precision: null,
  },
  {
    id: "coverage",
    title: "Test coverage",
    definition: "1 when the CI coverage report has a hit of the function, 0 when it has none. With no record of the function, the line coverage of its file.",
    unit: "fraction",
    scope: "function",
    extractor: "ci",
    source: "coverage_function.hits, coverage_file.lines_covered",
    higherIsWorse: false,
    precision: null,
  },
  {
    id: "hotspot",
    title: "Hotspot",
    definition: "The cognitive complexity times the churn times one minus the coverage. A function with no coverage value counts as not covered.",
    unit: "points",
    scope: "function",
    extractor: "derived",
    source: "cognitive, churn, coverage",
    higherIsWorse: true,
    precision: null,
  },
  {
    id: "imports",
    title: "Module coupling",
    definition: "The different import specifiers of a file: the modules and the packages that it uses.",
    unit: "modules",
    scope: "module",
    extractor: "parser",
    source: "import.specifier",
    higherIsWorse: true,
    precision: null,
  },
];

/** The marker kinds of the dimension `unsafe_types`. */
const UNSAFE: readonly string[] = ["any", "as-unknown-as", "non-null", "ts-ignore", "ts-expect-error"];

/** The values of the function dimensions of one function. */
export interface FunctionIndexRow {
  readonly repo: string;
  readonly path: string;
  readonly name: string;
  readonly line: number;
  readonly endLine: number;
  /** The value of each function dimension, by its id. */
  readonly values: Readonly<Record<string, number>>;
}

/** The values of the module dimensions of one file. */
export interface ModuleIndexRow {
  readonly repo: string;
  readonly path: string;
  readonly values: Readonly<Record<string, number>>;
}

/** The index of the current snapshots. */
export interface CodeIndex {
  readonly version: string;
  readonly functions: readonly FunctionIndexRow[];
  readonly modules: readonly ModuleIndexRow[];
}

const lastName = (callee: string): string => callee.slice(callee.lastIndexOf(".") + 1);

/** This function gives the index of each function and each file outside the tests of the current snapshots. */
export async function codeIndex(q: CatalogQuery): Promise<CodeIndex> {
  const symbols = await q
    .selectFrom("current_file as f")
    .innerJoin("symbol as s", "s.blob", "f.blob")
    .where("f.test", "=", 0)
    .where("s.kind", "in", ["function", "method"])
    .select(["f.repo as repo", "f.path as path", "f.blob as blob", "s.qualified_name as name", "s.name as simple", "s.line as line", "s.end_line as endLine", "s.params as params", "s.nodes as nodes", "s.cyclomatic as cyclomatic", "s.depth as depth", "s.cognitive as cognitive"])
    .orderBy("repo")
    .orderBy("path")
    .orderBy("line")
    .orderBy("name")
    .execute();
  const fanOut = await q
    .selectFrom("current_file as f")
    .innerJoin("call_site as c", "c.blob", "f.blob")
    .where("f.test", "=", 0)
    .select(["f.blob as blob", "c.caller as caller", (eb) => eb.fn.count<number>("c.callee").distinct().as("n")])
    .groupBy(["f.blob", "c.caller"])
    .execute();
  const calls = await q
    .selectFrom("current_file as f")
    .innerJoin("call_site as c", "c.blob", "f.blob")
    .select(["f.repo as repo", "c.callee as callee", (eb) => eb.fn.countAll<number>().as("n")])
    .groupBy(["f.repo", "c.callee"])
    .execute();
  const markers = await q
    .selectFrom("current_file as f")
    .innerJoin("marker as m", "m.blob", "f.blob")
    .where("f.test", "=", 0)
    .where("m.kind", "in", UNSAFE)
    .select(["f.blob as blob", "m.line as line"])
    .execute();
  const churnRuns = await q.selectFrom("current_file as f").innerJoin("churn_run as r", "r.snapshot", "f.snapshot").select("f.repo as repo").distinct().execute();
  const churn = await q
    .selectFrom("current_file as f")
    .innerJoin("churn as c", (join) => join.onRef("c.snapshot", "=", "f.snapshot").onRef("c.path", "=", "f.path"))
    .where("f.test", "=", 0)
    .select(["f.repo as repo", "f.path as path", "c.commits as commits"])
    .execute();
  const fnCoverage = await q
    .selectFrom("current_file as f")
    .innerJoin("coverage_function as c", (join) => join.onRef("c.snapshot", "=", "f.snapshot").onRef("c.path", "=", "f.path"))
    .where("f.test", "=", 0)
    .select(["f.repo as repo", "f.path as path", "c.line as line", (eb) => eb.fn.max<number>("c.hits").as("hits")])
    .groupBy(["f.repo", "f.path", "c.line"])
    .execute();
  const fileCoverage = await q
    .selectFrom("current_file as f")
    .innerJoin("coverage_file as c", (join) => join.onRef("c.snapshot", "=", "f.snapshot").onRef("c.path", "=", "f.path"))
    .where("f.test", "=", 0)
    .where("c.lines", ">", 0)
    .select(["f.repo as repo", "f.path as path", "c.lines as lines", "c.lines_covered as covered"])
    .execute();
  const imports = await q
    .selectFrom("current_file as f")
    .innerJoin("import as i", "i.blob", "f.blob")
    .where("f.test", "=", 0)
    .select(["f.repo as repo", "f.path as path", (eb) => eb.fn.count<number>("i.specifier").distinct().as("n")])
    .groupBy(["f.repo", "f.path"])
    .orderBy("repo")
    .orderBy("path")
    .execute();

  const outOf = new Map(fanOut.map((row) => [`${row.blob}\0${row.caller}`, Number(row.n)]));
  const inOf = new Map<string, number>();
  for (const row of calls) {
    const key = `${row.repo}\0${lastName(row.callee)}`;
    inOf.set(key, (inOf.get(key) ?? 0) + Number(row.n));
  }
  const churnRepos = new Set(churnRuns.map((row) => row.repo));
  const churnOf = new Map(churn.map((row) => [`${row.repo}\0${row.path}`, row.commits]));
  const hitsOf = new Map(fnCoverage.map((row) => [`${row.repo}\0${row.path}\0${row.line}`, Number(row.hits)]));
  const linesOf = new Map(fileCoverage.map((row) => [`${row.repo}\0${row.path}`, row.covered / row.lines]));
  const markerLines = new Map<string, number[]>();
  for (const row of markers) markerLines.set(row.blob, [...(markerLines.get(row.blob) ?? []), row.line]);

  const functions = symbols.map((s): FunctionIndexRow => {
    const file = `${s.repo}\0${s.path}`;
    const hits = hitsOf.get(`${file}\0${s.line}`);
    const coverage = hits === undefined ? linesOf.get(file) : hits > 0 ? 1 : 0;
    const churnValue = churnRepos.has(s.repo) ? (churnOf.get(file) ?? 0) : undefined;
    const cognitive = s.cognitive ?? 0;
    const later: Record<string, number> = {};
    if (churnValue !== undefined) later["churn"] = churnValue;
    if (coverage !== undefined) later["coverage"] = coverage;
    if (churnValue !== undefined) later["hotspot"] = cognitive * churnValue * (1 - (coverage ?? 0));
    return {
      repo: s.repo,
      path: s.path,
      name: s.name,
      line: s.line,
      endLine: s.endLine,
      values: {
        length: s.endLine - s.line + 1,
        params: s.params ?? 0,
        nodes: s.nodes ?? 0,
        cyclomatic: s.cyclomatic ?? 1,
        depth: s.depth ?? 0,
        cognitive,
        fan_out: outOf.get(`${s.blob}\0${s.name}`) ?? 0,
        fan_in: inOf.get(`${s.repo}\0${s.simple}`) ?? 0,
        unsafe_types: (markerLines.get(s.blob) ?? []).filter((line) => s.line <= line && line <= s.endLine).length,
        ...later,
      },
    };
  });
  const modules = imports.map((row): ModuleIndexRow => ({ repo: row.repo, path: row.path, values: { imports: Number(row.n) } }));
  return { version: DIMENSIONS_VERSION, functions, modules };
}

/** The distribution of one dimension over the index. */
export interface DimensionSummary {
  readonly id: string;
  readonly count: number;
  readonly median: number;
  readonly p95: number;
  readonly max: number;
  /** The place with the highest value: `repo:path:line`, or the empty text for no value. */
  readonly top: string;
  /** True when the precision check passed the gate. */
  readonly counts: boolean;
}

/** This function tells if a dimension passed its precision check. */
export function dimensionCounts(dimension: Dimension): boolean {
  const precision = dimension.precision;
  if (precision === null || precision.checked === 0) return false;
  return wilson(precision.agree, precision.checked).low >= DIMENSION_PRECISION_GATE;
}

/** This function gives the distribution of each dimension of `dimensions` over the index. */
export function dimensionSummaries(index: CodeIndex, dimensions: readonly Dimension[] = DIMENSIONS): DimensionSummary[] {
  return dimensions.map((dimension): DimensionSummary => {
    const rows: readonly { readonly repo: string; readonly path: string; readonly line?: number; readonly values: Readonly<Record<string, number>> }[] =
      dimension.scope === "function" ? index.functions : index.modules;
    const values: number[] = [];
    let top = "";
    let max = Number.NEGATIVE_INFINITY;
    for (const row of rows) {
      const value = row.values[dimension.id];
      if (value === undefined) continue;
      values.push(value);
      if (value > max) {
        max = value;
        top = row.line === undefined ? `${row.repo}:${row.path}` : `${row.repo}:${row.path}:${row.line}`;
      }
    }
    const counts = dimensionCounts(dimension);
    if (values.length === 0) return { id: dimension.id, count: 0, median: 0, p95: 0, max: 0, top, counts };
    return { id: dimension.id, count: values.length, median: quantile(values, 0.5), p95: quantile(values, 0.95), max, top, counts };
  });
}

/** This function writes the dimension catalog and the distribution of each dimension as Markdown. */
export function dimensionsMarkdown(summaries: readonly DimensionSummary[], dimensions: readonly Dimension[] = DIMENSIONS): string {
  const byId = new Map(dimensions.map((d) => [d.id, d]));
  const counted = summaries.filter((s) => s.counts).length;
  const lines = [
    "## Dimensions",
    "",
    `The catalog has ${dimensions.length} dimensions. ${counted} passed a check of their precision, so only they count.`,
    "",
    "| Dimension | Unit | Extractor | Precision | Median | 95th percentile | Highest | Place of the highest |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...summaries.map((s) => {
      const d = byId.get(s.id);
      const precision = d?.precision === null || d?.precision === undefined ? "not checked" : `${d.precision.agree} of ${d.precision.checked}`;
      const place = s.top === "" ? "" : `\`${s.top}\``;
      return `| ${d?.title ?? s.id} | ${d?.unit ?? ""} | ${d?.extractor ?? ""} | ${precision} | ${round(s.median)} | ${round(s.p95)} | ${s.max === 0 && s.count === 0 ? "" : round(s.max)} | ${place} |`;
    }),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

const round = (value: number): string => String(Math.round(value * 10) / 10);
