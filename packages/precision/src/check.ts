/**
 * The precision checks of the dimensions (CA20 of `docs/ROADMAP.md`). The check draws a seeded sample of the function
 * index. An independent tool gives the value of each dimension, and the check counts the values that agree.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { random } from "@mark1russell7/rigor-generators";
import { wilson } from "@mark1russell7/rigor-statistics";
import { importsOf, matchFunction, referenceOf, type ReferenceFile, type ReferenceFunction } from "./reference.ts";

/** The version of the checks. A new check or a new reference tool gives a new version. */
export const PRECISION_VERSION: string = "precision/1";

/** A dimension counts when the Wilson lower bound of its agreement is this value or more. */
export const PRECISION_GATE: number = 0.9;

/** The functions and the files that each check draws. */
export const SAMPLE_SIZE: number = 200;

/** One row of the function index of the atlas, as the command `dimensions` writes it. */
export interface IndexFunction {
  readonly repo: string;
  readonly path: string;
  readonly name: string;
  readonly line: number;
  readonly endLine: number;
  readonly values: Readonly<Record<string, number>>;
}

/** One row of the file index of the atlas. */
export interface IndexModule {
  readonly repo: string;
  readonly path: string;
  readonly values: Readonly<Record<string, number>>;
}

/** The index of the atlas: the output of the command `dimensions`. */
export interface CodeIndexFile {
  readonly functions: readonly IndexFunction[];
  readonly modules: readonly IndexModule[];
}

/** One value that does not agree. */
export interface Miss {
  readonly place: string;
  readonly atlas: number;
  readonly reference: number;
}

/** The result of the check of one dimension. */
export interface DimensionCheck {
  readonly dimension: string;
  /** The independent tool of the check. */
  readonly method: string;
  readonly agree: number;
  readonly checked: number;
  /** The items of the sample that the tool could not find or read. They are not in `checked`. */
  readonly unmatched: number;
  readonly low: number;
  readonly counts: boolean;
  /** The first values that do not agree, at most 10. */
  readonly misses: readonly Miss[];
}

/** The report of all checks. */
export interface PrecisionReport {
  readonly version: string;
  readonly seed: string;
  readonly at: string;
  readonly checks: readonly DimensionCheck[];
}

/** The place where the atlas and the tool read one value. */
export interface CheckInput {
  readonly place: string;
  readonly atlas: number | undefined;
  readonly reference: number | undefined;
}

/** This function counts the agreement of the inputs of one dimension. An input with no value on a side is unmatched. */
export function checkOf(dimension: string, method: string, inputs: readonly CheckInput[]): DimensionCheck {
  let agree = 0;
  let checked = 0;
  let unmatched = 0;
  const misses: Miss[] = [];
  for (const input of inputs) {
    if (input.atlas === undefined || input.reference === undefined) {
      unmatched++;
      continue;
    }
    checked++;
    if (input.atlas === input.reference) agree++;
    else if (misses.length < 10) misses.push({ place: input.place, atlas: input.atlas, reference: input.reference });
  }
  const low = checked === 0 ? 0 : wilson(agree, checked).low;
  return { dimension, method, agree, checked, unmatched, low, counts: checked > 0 && low >= PRECISION_GATE, misses };
}

/** The function dimensions that one pass of ESLint checks, with the tool and the value of a function. */
const FUNCTION_CHECKS: readonly { readonly dimension: string; readonly method: string; readonly value: (f: ReferenceFunction) => number }[] = [
  { dimension: "length", method: "the lines of the function in the syntax tree of typescript-eslint", value: (f) => f.end - f.start + 1 },
  { dimension: "params", method: "the rule max-params of ESLint", value: (f) => f.params },
  { dimension: "cyclomatic", method: "the rule complexity of ESLint", value: (f) => f.cyclomatic },
  { dimension: "depth", method: "the rule max-depth of ESLint", value: (f) => f.depth },
  { dimension: "cognitive", method: "the rule cognitive-complexity of SonarJS", value: (f) => f.cognitive },
];

const CHECKED_EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/;

/** This function gives the commits of the window of `days` that ends at `until` and changed `path`, from a log of the path only. */
export function commitsOfPath(root: string, path: string, until: string, days: number): number {
  const since = new Date(Date.parse(until) - days * 86_400_000).toISOString();
  const out = execFileSync("git", ["-C", root, "log", "HEAD", `--since=${since}`, `--until=${until}`, "--no-renames", "--no-merges", "--format=%H", "--", path], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return out.split("\n").filter((line) => line.trim() !== "").length;
}

/** The inputs of the checks that do not come from the index. */
export interface CheckOptions {
  /** The folder with a clone of each repository, at the commit of its snapshot. */
  readonly reposDir: string;
  readonly seed: string;
  readonly size?: number;
  readonly at: string;
  /** The end of the churn window of each repository, from the table `churn_run`. */
  readonly churnUntil?: ReadonlyMap<string, { readonly until: string; readonly days: number }>;
}

/** This function checks each dimension that has an independent tool, on a seeded sample of the index. */
export function checkIndex(index: CodeIndexFile, options: CheckOptions): PrecisionReport {
  const size = options.size ?? SAMPLE_SIZE;
  const rng = random(options.seed);
  const population = index.functions.filter((f) => CHECKED_EXTENSIONS.test(f.path));
  const sample = rng.fork("functions").sample(population, Math.min(size, population.length));
  const files = new Map<string, ReferenceFile | null>();
  const fileOf = (repo: string, path: string): ReferenceFile | null => {
    const key = `${repo}/${path}`;
    if (!files.has(key)) {
      try {
        files.set(key, referenceOf(readFileSync(join(options.reposDir, repo, path), "utf8"), path));
      } catch {
        files.set(key, null);
      }
    }
    return files.get(key) ?? null;
  };
  const place = (f: IndexFunction): string => `${f.repo}:${f.path}:${f.line}`;

  const perDimension = new Map<string, CheckInput[]>(FUNCTION_CHECKS.map((c) => [c.dimension, []]));
  const unsafe: CheckInput[] = [];
  for (const f of sample) {
    const file = fileOf(f.repo, f.path);
    const usable = file !== null && file.error === null ? file : undefined;
    const match = usable === undefined ? undefined : matchFunction(usable.functions, f.line, f.endLine);
    for (const c of FUNCTION_CHECKS) perDimension.get(c.dimension)?.push({ place: place(f), atlas: f.values[c.dimension], reference: match === undefined ? undefined : c.value(match) });
    unsafe.push({ place: place(f), atlas: f.values["unsafe_types"], reference: usable?.unsafeLines.filter((line) => f.line <= line && line <= f.endLine).length });
  }
  const checks: DimensionCheck[] = FUNCTION_CHECKS.map((c) => checkOf(c.dimension, c.method, perDimension.get(c.dimension) ?? []));
  checks.push(checkOf("unsafe_types", "the rules no-explicit-any, no-non-null-assertion and ban-ts-comment of typescript-eslint", unsafe));

  // The churn: a log of each file of the sample alone, in the window of the scan
  const churnInputs: CheckInput[] = [];
  const counted = new Map<string, number | undefined>();
  for (const f of sample) {
    const atlas = f.values["churn"];
    const window = options.churnUntil?.get(f.repo);
    const key = `${f.repo}/${f.path}`;
    if (!counted.has(key)) {
      try {
        counted.set(key, window === undefined ? undefined : commitsOfPath(join(options.reposDir, f.repo), f.path, window.until, window.days));
      } catch {
        counted.set(key, undefined);
      }
    }
    churnInputs.push({ place: place(f), atlas, reference: counted.get(key) });
  }
  checks.push(checkOf("churn", "git log of each file alone", churnInputs));

  // The module coupling: the imports of the TypeScript compiler
  const modules = rng.fork("modules").sample(
    index.modules.filter((m) => CHECKED_EXTENSIONS.test(m.path)),
    Math.min(size, index.modules.length),
  );
  const importInputs = modules.map((m): CheckInput => {
    let reference: number | undefined;
    try {
      reference = importsOf(readFileSync(join(options.reposDir, m.repo, m.path), "utf8")).length;
    } catch {
      reference = undefined;
    }
    return { place: `${m.repo}:${m.path}`, atlas: m.values["imports"], reference };
  });
  checks.push(checkOf("imports", "ts.preProcessFile of the TypeScript compiler", importInputs));
  return { version: PRECISION_VERSION, seed: options.seed, at: options.at, checks };
}

const round = (value: number): string => String(Math.round(value * 1000) / 1000);

/** This function writes the report as Markdown, with the first values that do not agree. */
export function precisionMarkdown(report: PrecisionReport): string {
  const counted = report.checks.filter((c) => c.counts).length;
  const lines = [
    "## Precision of the dimensions",
    "",
    `The checks compare ${report.checks.length} dimensions with an independent tool, on a sample with the seed \`${report.seed}\`. ${counted} pass the gate of ${PRECISION_GATE}.`,
    "",
    "| Dimension | Tool | Agree | Checked | Not found | Wilson lower bound | Counts |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...report.checks.map((c) => `| ${c.dimension} | ${c.method} | ${c.agree} | ${c.checked} | ${c.unmatched} | ${round(c.low)} | ${c.counts ? "yes" : "no"} |`),
    "",
  ];
  for (const c of report.checks.filter((check) => check.misses.length > 0)) {
    lines.push(`### ${c.dimension}: the first values that do not agree`, "", "| Place | Atlas | Tool |", "| --- | --- | --- |");
    for (const m of c.misses) lines.push(`| \`${m.place}\` | ${m.atlas} | ${m.reference} |`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
