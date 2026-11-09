#!/usr/bin/env node
/**
 * The commands:
 *
 * - `codeatlas build [--out atlas.json] [--markdown atlas.md] [--min-nodes 40] [--repos-dir <folder>] [<name>=<path> ...]`
 * - `codeatlas corpus [--out corpus.json] [--markdown corpus.md] [--repos-dir <folder>] [<name>=<path> ...]`
 * - `codeatlas catalog [--out catalog.sqlite] [--markdown catalog.md] [--repos-dir <folder>] [<name>=<path> ...]`
 * - `codeatlas facts [--out facts.jsonl] [--markdown facts.md] [--cache <facts.jsonl>] [--repos-dir <folder>] [<name>=<path> ...]`
 * - `codeatlas sample --db <catalog.sqlite> --out <sample.json>`
 * - `codeatlas agreement --sample <sample.json> --a <a.jsonl> --b <b.jsonl> --out <agreement.json>`
 * - `codeatlas reference --sample <sample.json> --rater <name>=<labels.jsonl> ... [--labeler <name>=<labels.jsonl> ...] [--db <catalog.sqlite>] --out <reference.json> [--markdown <reference.md>]`
 * - `codeatlas verdict --sample <sample.json> --a <a.jsonl> --agreement <agreement.json> --answers <answers.jsonl> --out <verdict.json>`
 * - `codeatlas trend --db <catalog.sqlite> [--previous <trend.json>] --out <trend.json>`
 * - `codeatlas drift --db <catalog.sqlite> [--out drift.json] [--markdown drift.md]`
 * - `codeatlas coverage --db <catalog.sqlite> --owner <owner> --dir <folder> [--out coverage.json] [--markdown coverage.md]`
 * - `codeatlas clone --owner <owner> --into <folder>`
 * - `codeatlas mcp --db <catalog.sqlite>`
 * - `codeatlas tool <name> [<json input>] --db <catalog.sqlite>`
 *
 * The command build scans each repository (each folder of --repos-dir, and each name=path), and writes the
 * atlas as JSON and as Markdown. The command corpus counts the files, lines and bytes of each kind in the same repositories.
 *
 * The command catalog writes the same facts into a SQLite database. Its blobs are the cache of the next run.
 * The command facts writes the Layer 1a facts of each blob as JSON Lines. A cache from an earlier output saves each parse of a known blob.
 *
 * The command sample draws the seeded sample of functions of `SAMPLE_PLAN` from a catalog, for the labels of Layer 2.
 * The command agreement compares two drafts of labels of the sample, and writes the kappa, the confusion and the audit.
 * The command verdict compares the answers of the person with the audit, and writes the verdict and the labels of the truth.
 * The command trend adds the point of a catalog to the trend file of the last build.
 * The command queries writes the answers of the query set of a catalog as JSON, for the site.
 * The command coverage reads the coverage artifacts of the CI of each repository into the catalog, and writes the report.
 * The command drift writes the drift of each repository from the template, and the share of the current repositories.
 * The command mcp serves the tools of agents over a catalog as MCP tools. The command tool calls one of them.
 */
import { closeSync, existsSync, openSync, readFileSync, readdirSync, statSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { buildAtlas } from "./atlas.ts";
import { cacheOf, factsKey, factsOfRepo, type BlobFacts, type FactsLine } from "./blobs.ts";
import {
  driftMarkdown,
  keepListOfRepo,
  pinFreshness,
  pinLag,
  STAMP_MAIN,
  stampCheckOfRepo,
  stampFreshness,
  TEMPLATE_CLONE,
  TEMPLATE_REPO,
  templateDrift,
  templateVersionsOfRepo,
} from "./templates.ts";
import { queryOf } from "./query.ts";
import { agreementOf, type AgreementFile, type DraftLabel } from "./agreement.ts";
import { verdictOf, type PersonAnswer } from "./verdict.ts";
import { homeFacts, precisionOf, raterOfText, referenceMarkdown, referenceOf, type Rater } from "./reference.ts";
import { populationOf, sampleFile, SAMPLE_PLAN, type SampleFile } from "./sample.ts";
import { Catalog, readOnlyCatalog } from "./store.ts";
import { addPoint, trendPoint } from "./trend.ts";
import { querySet } from "./query-set.ts";
import { factsMarkdown, factsSummary, gateVerdict, type GateVerdict } from "./summary.ts";
import { clonePublic } from "./clone.ts";
import { coverageMarkdown, coverageOfRepo, coverageReport, ghArtifacts } from "./coverage.ts";
import { buildCorpus, corpusMarkdown, corpusOfRepo } from "./corpus.ts";
import { atlasMarkdown } from "./report.ts";
import { mcpCommand, toolCommand } from "./tools-cli.ts";
import { scanRepoInto } from "./rescan.ts";
import { conventionsBreaks, conventionsMarkdown } from "./conventions.ts";
import { formulaReport, formulasMarkdown, type FormulaVerdict, type OwnerFind } from "./formulas.ts";
import { plannedDuplication, plannedMarkdown } from "./planned.ts";
import { FACTS_VERSION } from "./facts.ts";
import { headOf, scanRepo, type RepoScan } from "./scan.ts";

export interface BuildArgs {
  readonly out: string;
  readonly markdown: string | undefined;
  readonly minNodes: number;
  readonly repos: readonly { readonly name: string; readonly path: string }[];
}

export function parseBuildArgs(argv: readonly string[], list: (dir: string) => string[] = subfolders, defaultOut = "atlas.json"): BuildArgs | { readonly error: string } {
  let out = defaultOut;
  let markdown: string | undefined;
  let minNodes = 40;
  const repos: { name: string; path: string }[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const value = (): string | undefined => argv[++i];
    if (arg === "--out") out = value() ?? out;
    else if (arg === "--markdown") markdown = value();
    else if (arg === "--min-nodes") {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 1) return { error: "--min-nodes takes a whole number of 1 or more." };
      minNodes = n;
    } else if (arg === "--repos-dir") {
      const dir = value();
      if (dir === undefined) return { error: "--repos-dir takes a folder." };
      for (const name of list(dir)) repos.push({ name, path: join(dir, name) });
    } else if (arg.includes("=") && !arg.startsWith("-")) {
      const at = arg.indexOf("=");
      repos.push({ name: arg.slice(0, at), path: arg.slice(at + 1) });
    } else return { error: `Unknown argument: ${arg}` };
  }
  if (repos.length === 0) return { error: "Give one or more repositories: --repos-dir <folder> or <name>=<path>." };
  return { out, markdown, minNodes, repos };
}

function subfolders(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => !name.startsWith(".") && statSync(join(dir, name)).isDirectory())
    .sort();
}

const USAGE = `Usage:
  codeatlas build [--out atlas.json] [--markdown atlas.md] [--min-nodes 40] [--repos-dir <folder>] [<name>=<path> ...]
  codeatlas corpus [--out corpus.json] [--markdown corpus.md] [--repos-dir <folder>] [<name>=<path> ...]
  codeatlas catalog [--out catalog.sqlite] [--markdown catalog.md] [--repos-dir <folder>] [<name>=<path> ...]
  codeatlas sample --db <catalog.sqlite> --out <sample.json>
  codeatlas agreement --sample <sample.json> --a <a.jsonl> --b <b.jsonl> --out <agreement.json>
  codeatlas verdict --sample <sample.json> --a <a.jsonl> --agreement <agreement.json> --answers <answers.jsonl> --out <verdict.json>
  codeatlas reference --sample <sample.json> --rater <name>=<labels.jsonl> ... [--labeler <name>=<labels.jsonl> ...] [--db <catalog.sqlite>] --out <reference.json> [--markdown <reference.md>]
  codeatlas trend --db <catalog.sqlite> [--previous <trend.json>] --out <trend.json>
  codeatlas queries --db <catalog.sqlite> --out <queries.json>
  codeatlas facts [--out facts.jsonl] [--markdown facts.md] [--cache <facts.jsonl>] [--repos-dir <folder>] [<name>=<path> ...]
  codeatlas drift --db <catalog.sqlite> [--out drift.json] [--markdown drift.md]
  codeatlas breaks --db <catalog.sqlite> [--out breaks.json] [--markdown breaks.md]
  codeatlas planned --db <catalog.sqlite> [--out planned.json] [--markdown planned.md] [--min 0.25]
  codeatlas formulas --db <catalog.sqlite> --finds <finds.jsonl> [--verdicts <verdicts.jsonl>] [--out formulas.json] [--markdown formulas.md] [--top 30]
  codeatlas coverage --db <catalog.sqlite> --owner <owner> --dir <folder> [--out coverage.json] [--markdown coverage.md]
  codeatlas clone --owner <owner> --into <folder>
  codeatlas mcp --db <catalog.sqlite> [--write]
  codeatlas tool <name> [<json input>] --db <catalog.sqlite>`;

function main(argv: readonly string[]): number | Promise<number> {
  const [command, ...rest] = argv;
  if (command === "clone") {
    const owner = rest[rest.indexOf("--owner") + 1];
    const into = rest[rest.indexOf("--into") + 1];
    if (!rest.includes("--owner") || !rest.includes("--into") || owner === undefined || into === undefined) {
      console.error(USAGE);
      return 2;
    }
    // The template gets its history, so the drift reads the content of each pin
    const { failed } = clonePublic(owner, into, console.error, { [TEMPLATE_REPO]: TEMPLATE_CLONE });
    for (const name of failed) console.log(`::warning::${name} did not clone`);
    return 0;
  }
  if (command === "corpus") return corpus(rest);
  if (command === "facts") return facts(rest);
  if (command === "catalog") return catalog(rest);
  if (command === "sample") return sample(rest);
  if (command === "agreement") return agreement(rest);
  if (command === "verdict") return verdict(rest);
  if (command === "reference") return reference(rest);
  if (command === "trend") return trend(rest);
  if (command === "drift") return drift(rest);
  if (command === "breaks") return breaks(rest);
  if (command === "coverage") return coverage(rest);
  if (command === "planned") return planned(rest);
  if (command === "formulas") return formulas(rest);
  if (command === "queries") return queries(rest);
  if (command === "mcp") return mcpCommand(rest);
  if (command === "tool") return toolCommand(rest);
  if (command !== "build") {
    console.error(USAGE);
    return 2;
  }
  const args = parseBuildArgs(rest);
  if ("error" in args) {
    console.error(args.error);
    return 2;
  }
  const scans: RepoScan[] = [];
  for (const repo of args.repos) {
    const scan = scanRepo(repo.name, repo.path);
    console.error(`${repo.name}: ${scan.files} files, ${scan.units.length} functions, ${scan.errors.length} parse errors`);
    scans.push(scan);
  }
  const atlas = buildAtlas(scans, { minNodes: args.minNodes });
  writeFileSync(args.out, `${JSON.stringify(atlas, null, 1)}\n`);
  if (args.markdown !== undefined) writeFileSync(args.markdown, atlasMarkdown(atlas));
  const { totals } = atlas;
  console.error(`atlas: ${totals.classes} clone classes, ${totals.crossRepoClasses} cross-repo, ${totals.duplicatedNodes} duplicated nodes of ${totals.nodes}`);
  return 0;
}

function corpus(argv: readonly string[]): number {
  const args = parseBuildArgs(argv, subfolders, "corpus.json");
  if ("error" in args) {
    console.error(args.error);
    return 2;
  }
  const repos = args.repos.map((repo) => corpusOfRepo(repo.name, repo.path));
  const result = buildCorpus(repos);
  writeFileSync(args.out, `${JSON.stringify(result, null, 1)}
`);
  if (args.markdown !== undefined) writeFileSync(args.markdown, corpusMarkdown(result));
  const { totals } = result;
  console.error(`corpus: ${totals.repos} repositories, ${totals.files} files, ${totals.kinds.source?.lines ?? 0} source lines, ${totals.kinds.test?.lines ?? 0} test lines`);
  return 0;
}

function facts(argv: readonly string[]): number {
  const at = argv.indexOf("--cache");
  const cachePath = at === -1 ? undefined : argv[at + 1];
  if (at !== -1 && cachePath === undefined) {
    console.error("--cache takes a file.");
    return 2;
  }
  const args = parseBuildArgs(at === -1 ? argv : [...argv.slice(0, at), ...argv.slice(at + 2)], subfolders, "facts.jsonl");
  if ("error" in args) {
    console.error(args.error);
    return 2;
  }
  const cache: Map<string, BlobFacts> = cachePath === undefined ? new Map() : cacheOf(readFileSync(cachePath, "utf8").split("\n"));
  const known = new Set(cache.keys());
  const started = performance.now();
  const fd = openSync(args.out, "w");
  const write = (line: FactsLine): void => {
    writeSync(fd, `${JSON.stringify(line)}\n`);
  };
  const scans = args.repos.map((repo) => {
    const scan = factsOfRepo(repo.name, repo.path, cache);
    write({ kind: "repo", repo: repo.name, commit: headOf(repo.path), counts: scan.counts });
    for (const file of scan.files) write({ kind: "file", ...file });
    return scan;
  });
  const ms = performance.now() - started;
  // Only the blobs of this run: a blob of the cache that no repository has now stays out
  const used = new Set(scans.flatMap((scan) => scan.files.map((file) => `${file.blob}:`)));
  for (const [key, value] of [...cache].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (used.has(key.slice(0, key.indexOf(":") + 1))) write({ kind: "blob", key, facts: value });
  }
  closeSync(fd);
  const summary = factsSummary(scans, cache, ms);
  const unread = scans.flatMap((scan) =>
    scan.files.flatMap((file) => {
      const entry = cache.get(factsKey(file.blob, file.path));
      return entry !== undefined && !entry.ok ? [{ repo: file.repo, path: file.path, error: entry.error }] : [];
    }),
  );
  if (args.markdown !== undefined) writeFileSync(args.markdown, factsMarkdown(summary));
  console.error(`facts: ${summary.repos} repositories, ${summary.files} files, ${summary.parsed} parsed, ${summary.reused} from the cache (${known.size} known), ${summary.errors} errors, ${Math.round(ms)} ms`);
  return report(gateVerdict(summary, unread));
}

/**
 * This function starts `stamp --check` of the template on each repository that pins it, and keeps each result. A
 * repository with no result does not count in the stamp freshness.
 */
function stampChecks(db: Catalog, templateRoot: string, repos: readonly { readonly path: string; readonly snapshot: string }[]): void {
  if (!existsSync(join(templateRoot, STAMP_MAIN))) {
    console.error(`catalog: the template has no ${STAMP_MAIN}, so the stamp freshness is not known`);
    return;
  }
  const sha = headOf(templateRoot);
  if (sha === null) {
    console.error("catalog: the template checkout has no commit, so the stamp freshness is not known");
    return;
  }
  const errors: string[] = [];
  for (const repo of repos) {
    const check = stampCheckOfRepo(templateRoot, repo.path, sha);
    if ("error" in check) errors.push(check.error);
    else db.putStampCheck(repo.snapshot, check);
  }
  const first = errors[0] === undefined ? "" : ` (first: ${errors[0]})`;
  console.error(`catalog: stamp --check on ${repos.length} repositories, ${errors.length} with no result${first}`);
}

function catalog(argv: readonly string[]): number {
  const args = parseBuildArgs(argv, subfolders, "catalog.sqlite");
  if ("error" in args) {
    console.error(args.error);
    return 2;
  }
  const db = new Catalog(args.out);
  const known = Number((db.db.prepare("SELECT count(*) AS n FROM blob").get() as { n: number }).n);
  const scannedAt = new Date().toISOString();
  const started = performance.now();
  const totals = { parsed: 0, reused: 0, errors: 0, bytesParsed: 0 };
  // The list of the files that the stamp of the template copies. Without the template in the scan, only the pins count
  const templateRoot = args.repos.find((repo) => repo.name === TEMPLATE_REPO)?.path;
  const keep = (templateRoot === undefined ? undefined : keepListOfRepo(templateRoot)) ?? [];
  if (templateRoot !== undefined && keep.length === 0) console.error("catalog: the stamp of the template has no list KEEP, so the scan compares no files");
  let templateSnapshot: string | undefined;
  const pinning: { readonly path: string; readonly snapshot: string }[] = [];
  const unchecked: string[] = [];
  for (const repo of args.repos) {
    const { snapshot, records, counts, conventions } = scanRepoInto(db, repo.name, repo.path, keep, scannedAt);
    if (conventions !== null) unchecked.push(`${repo.name}: ${conventions}`);
    if (repo.name === TEMPLATE_REPO) templateSnapshot = snapshot;
    else if (records.pins.length > 0) pinning.push({ path: repo.path, snapshot });
    totals.parsed += counts.parsed;
    totals.reused += counts.reused;
    totals.errors += counts.errors;
    totals.bytesParsed += counts.bytesParsed;
  }
  const firstUnchecked = unchecked[0] === undefined ? "" : ` (first: ${unchecked[0]})`;
  console.error(`catalog: conventions check on ${args.repos.length} repositories, ${unchecked.length} with no result${firstUnchecked}`);
  // The content of each pin: the files of the template at each ref that a repository pins
  if (templateRoot !== undefined && templateSnapshot !== undefined) {
    const refs = (db.db.prepare("SELECT DISTINCT ref FROM current_template_pin").all() as { ref: string }[]).map((row) => row.ref);
    db.putTemplateVersions(templateSnapshot, templateVersionsOfRepo(templateRoot, refs, keep));
    stampChecks(db, templateRoot, pinning);
  }
  const ms = performance.now() - started;
  const summary = db.summary({ ...totals, ms });
  const unread = db.unread();
  db.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  if (args.markdown !== undefined) writeFileSync(args.markdown, factsMarkdown(summary));
  console.error(`catalog: ${summary.repos} repositories, ${summary.files} files, ${summary.parsed} parsed, ${summary.reused} from the cache (${known} blobs known), ${summary.errors} errors, ${Math.round(ms)} ms`);
  return report(gateVerdict(summary, unread));
}

/** This function draws the sample of `SAMPLE_PLAN` from the catalog `--db`, and writes the sample file `--out`. */
async function sample(argv: readonly string[]): Promise<number> {
  const db = argv.includes("--db") ? argv[argv.indexOf("--db") + 1] : undefined;
  const out = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : undefined;
  if (db === undefined || out === undefined) {
    console.error(USAGE);
    return 2;
  }
  const catalog = new Catalog(db);
  try {
    const population = await populationOf(queryOf(catalog.db));
    const file = sampleFile(population, SAMPLE_PLAN.seed, SAMPLE_PLAN.tasks, SAMPLE_PLAN.size);
    writeFileSync(out, `${JSON.stringify(file, null, 1)}
`);
    console.error(`sample: ${file.size} of ${file.population} classes, seed ${file.seed}, ${file.tasks.map((task) => `${task.task} n=${task.n}`).join(", ")}`);
    return 0;
  } finally {
    catalog.close();
  }
}

/** This function compares the drafts `--a` and `--b` of the sample `--sample`, and writes the agreement file `--out`. */
function agreement(argv: readonly string[]): number {
  const arg = (name: string): string | undefined => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const [samplePath, a, b, out] = [arg("--sample"), arg("--a"), arg("--b"), arg("--out")];
  if (samplePath === undefined || a === undefined || b === undefined || out === undefined) {
    console.error(USAGE);
    return 2;
  }
  const draft = (path: string): DraftLabel[] =>
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as DraftLabel);
  const file = agreementOf(JSON.parse(readFileSync(samplePath, "utf8")) as SampleFile, draft(a), draft(b));
  writeFileSync(out, `${JSON.stringify(file, null, 1)}\n`);
  const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;
  console.error(`agreement: other ${pct(file.other.a)} and ${pct(file.other.b)} (limit ${pct(file.other.limit)}, ${file.other.pass ? "pass" : "fail"})`);
  for (const task of file.tasks) {
    const k = task.kappa.kappa === undefined ? "none" : task.kappa.kappa.toFixed(3);
    console.error(`agreement: ${task.task} n=${task.n} kappa ${k} [${task.interval.low.toFixed(3)}, ${task.interval.high.toFixed(3)}], ${task.disagree.length} disagree, audit ${task.audit.length}`);
  }
  console.error(`agreement: the person labels ${file.person.length} items`);
  return file.other.pass ? 0 : 1;
}

/**
 * This function compares the answers `--answers` of the person with the audit of `--agreement`, and writes the verdict
 * file `--out`. Its exit code is 1 when a task fails.
 */
function verdict(argv: readonly string[]): number {
  const arg = (name: string): string | undefined => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const [samplePath, a, agreementPath, answersPath, out] = [arg("--sample"), arg("--a"), arg("--agreement"), arg("--answers"), arg("--out")];
  if (samplePath === undefined || a === undefined || agreementPath === undefined || answersPath === undefined || out === undefined) {
    console.error(USAGE);
    return 2;
  }
  const lines = <T>(path: string): T[] =>
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as T);
  const sampleFile = JSON.parse(readFileSync(samplePath, "utf8")) as SampleFile;
  const agreementFile = JSON.parse(readFileSync(agreementPath, "utf8")) as AgreementFile;
  const file = verdictOf(sampleFile, lines<DraftLabel>(a), agreementFile, lines<PersonAnswer>(answersPath));
  writeFileSync(out, `${JSON.stringify(file, null, 1)}\n`);
  for (const task of file.tasks) {
    const state = task.pass ? "pass" : "fail";
    console.error(`verdict: ${task.task} ${task.agree} of ${task.audited}, Wilson [${task.low.toFixed(3)}, ${task.high.toFixed(3)}], target ${task.target}, ${task.missing.length} missing: ${state}`);
  }
  console.error(`verdict: ${file.sentence.right} of ${file.sentence.checked} sentences right, ${file.truth.length} labels of the truth`);
  return file.tasks.every((task) => task.pass) ? 0 : 1;
}

/**
 * This function writes the provisional reference of the sample `--sample` from the raters `--rater`, and the home
 * facts of the catalog `--db`. Each `--labeler` gets its precision against the reference.
 */
async function reference(argv: readonly string[]): Promise<number> {
  const arg = (name: string): string | undefined => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const all = (name: string): string[] => argv.flatMap((value, i) => (argv[i - 1] === name ? [value] : []));
  const [samplePath, out, markdown, db] = [arg("--sample"), arg("--out"), arg("--markdown"), arg("--db")];
  const named = (spec: string): Rater | undefined => {
    const at = spec.indexOf("=");
    return at <= 0 ? undefined : raterOfText(spec.slice(0, at), readFileSync(spec.slice(at + 1), "utf8"));
  };
  const raters = all("--rater").map(named);
  const labelers = all("--labeler").map(named);
  if (samplePath === undefined || out === undefined || raters.length < 3 || [...raters, ...labelers].includes(undefined)) {
    console.error(USAGE);
    return 2;
  }
  const sample = JSON.parse(readFileSync(samplePath, "utf8")) as SampleFile;
  let facts: Awaited<ReturnType<typeof homeFacts>> = [];
  if (db !== undefined) {
    const catalog = readOnlyCatalog(db);
    try {
      facts = await homeFacts(queryOf(catalog), sample.items);
    } finally {
      catalog.close();
    }
  }
  const file = referenceOf(sample, raters.filter((r) => r !== undefined), facts);
  const precisions = labelers.filter((r) => r !== undefined).map((labeler) => precisionOf(file, labeler));
  writeFileSync(out, `${JSON.stringify({ reference: file, facts, precisions }, null, 1)}
`);
  if (markdown !== undefined) writeFileSync(markdown, referenceMarkdown(file, precisions));
  for (const t of file.tasks) console.error(`reference: ${t.task} ${t.items} items, ${t.fact} by a fact (${t.factAgree} of ${t.factChecked} confirmed by the raters), ${t.raters} by the raters, ${t.unknown} unknown`);
  for (const p of precisions) {
    for (const t of p.tasks) {
      const value = t.precision === null ? "not known" : t.precision.toFixed(3);
      console.error(`precision: ${p.by} ${t.task} ${value} [${t.low.toFixed(3)}, ${t.high.toFixed(3)}] ${p.note}, ${t.hits} hits, ${t.misses} misses, ${t.unknown} unknown`);
    }
  }
  return 0;
}

/** This function adds the point of the catalog `--db` to the trend `--previous`, and writes the trend `--out`. */
async function trend(argv: readonly string[]): Promise<number> {
  const option = (name: string): string | undefined => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const db = option("--db");
  const out = option("--out");
  const previous = option("--previous");
  if (db === undefined || out === undefined) {
    console.error(USAGE);
    return 2;
  }
  const catalog = new Catalog(db);
  try {
    const point = await trendPoint(queryOf(catalog.db), new Date().toISOString(), FACTS_VERSION);
    const file = addPoint(previous === undefined ? undefined : JSON.parse(readFileSync(previous, "utf8")), point);
    writeFileSync(out, `${JSON.stringify(file)}
`);
    console.error(`trend: ${file.points.length} points, ${point.repos.length} repositories in the new point`);
    return 0;
  } finally {
    catalog.close();
  }
}


async function queries(argv: readonly string[]): Promise<number> {
  const option = (name: string): string | undefined => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const db = option("--db");
  const out = option("--out");
  if (db === undefined || out === undefined) {
    console.error(USAGE);
    return 2;
  }
  const catalog = new Catalog(db);
  try {
    const set = await querySet(queryOf(catalog.db), new Date().toISOString(), FACTS_VERSION);
    writeFileSync(out, `${JSON.stringify(set)}\n`);
    console.error(`queries: ${set.exact.length} exact classes, ${set.complex.length} complex functions, ${set.markers.length} marker counts`);
    return 0;
  } finally {
    catalog.close();
  }
}
/** This function writes the drift from the template of the catalog `--db` as JSON and as Markdown. */
async function drift(argv: readonly string[]): Promise<number> {
  const option = (name: string): string | undefined => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const db = option("--db");
  if (db === undefined) {
    console.error(USAGE);
    return 2;
  }
  const catalog = readOnlyCatalog(db);
  try {
    const q = queryOf(catalog);
    const [freshness, stamp, lag, all] = [await pinFreshness(q), await stampFreshness(q), await pinLag(q), await templateDrift(q)];
    const out = option("--out");
    const markdown = option("--markdown");
    if (out !== undefined) writeFileSync(out, `${JSON.stringify({ pins: freshness, stamp, lag, drift: all })}\n`);
    if (markdown !== undefined) writeFileSync(markdown, driftMarkdown(freshness, stamp, lag));
    const line = (current: number, behind: number): string => `${current} of ${current + behind}`;
    const median = lag.median === null ? "not known" : `${lag.median.behind} commits, ${lag.median.days} days`;
    console.error(`drift: pins ${line(freshness.current.length, freshness.behind.length)} current, copies ${line(stamp.current.length, stamp.behind.length)} current, median pin lag ${median}`);
    return 0;
  } finally {
    catalog.close();
  }
}

/** This function writes the planned pairs of the roadmaps of the catalog `--db` as JSON `--out` and Markdown `--markdown`. */
async function planned(argv: readonly string[]): Promise<number> {
  const option = (name: string): string | undefined => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const db = option("--db");
  const min = Number(option("--min") ?? "0.25");
  if (db === undefined || !Number.isFinite(min)) {
    console.error(USAGE);
    return 2;
  }
  const catalog = readOnlyCatalog(db);
  try {
    const pairs = await plannedDuplication(queryOf(catalog), { minScore: min });
    const out = option("--out");
    const markdown = option("--markdown");
    if (out !== undefined) writeFileSync(out, `${JSON.stringify({ pairs })}\n`);
    if (markdown !== undefined) writeFileSync(markdown, plannedMarkdown(pairs));
    console.error(`planned: ${pairs.length} pairs, ${pairs.filter((p) => p.kind === "both open").length} of two open plans`);
    return 0;
  } finally {
    catalog.close();
  }
}

/** This function gives the rows of a JSON Lines file, or no rows when the file does not exist. */
function jsonLines<T>(path: string | undefined): T[] {
  if (path === undefined || !existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);
}

/**
 * This function writes the formula classes of the catalog `--db` as JSON `--out` and Markdown `--markdown`. The recall
 * comes from the owner finds `--finds`, and the precision from the owner verdicts `--verdicts`.
 */
async function formulas(argv: readonly string[]): Promise<number> {
  const option = (name: string): string | undefined => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const db = option("--db");
  const finds = option("--finds");
  const top = Number(option("--top") ?? "30");
  if (db === undefined || finds === undefined || !Number.isInteger(top)) {
    console.error(USAGE);
    return 2;
  }
  const catalog = readOnlyCatalog(db);
  try {
    const report = await formulaReport(queryOf(catalog), jsonLines<OwnerFind>(finds), jsonLines<FormulaVerdict>(option("--verdicts")));
    const out = option("--out");
    const markdown = option("--markdown");
    if (out !== undefined) writeFileSync(out, `${JSON.stringify(report)}\n`);
    if (markdown !== undefined) writeFileSync(markdown, formulasMarkdown(report, top));
    const recall = report.recall.map((r) => `${r.recalled} of ${r.total} at ${r.floor}`).join(", ");
    console.error(`formulas: ${report.classes.length} classes, recall ${recall}, precision ${report.precision.decision}`);
    return 0;
  } finally {
    catalog.close();
  }
}

/** This function writes the conventions breaks of the catalog `--db` as JSON `--out` and Markdown `--markdown`. */
async function breaks(argv: readonly string[]): Promise<number> {
  const option = (name: string): string | undefined => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const db = option("--db");
  if (db === undefined) {
    console.error(USAGE);
    return 2;
  }
  const catalog = readOnlyCatalog(db);
  try {
    const result = await conventionsBreaks(queryOf(catalog));
    const out = option("--out");
    const markdown = option("--markdown");
    if (out !== undefined) writeFileSync(out, `${JSON.stringify(result)}\n`);
    if (markdown !== undefined) writeFileSync(markdown, conventionsMarkdown(result));
    const total = result.broken.reduce((sum, r) => sum + r.breaks, 0);
    console.error(`breaks: ${result.clean.length} of ${result.checked} repositories clean, ${total} breaks of ${result.rules.length} rules`);
    return 0;
  } finally {
    catalog.close();
  }
}

/**
 * This function reads the coverage artifacts of each current snapshot of the catalog `--db` into the catalog. A
 * repository whose artifacts do not download gets a warning, not a failure.
 */
async function coverage(argv: readonly string[]): Promise<number> {
  const option = (name: string): string | undefined => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const db = option("--db");
  const owner = option("--owner");
  const dir = option("--dir");
  if (db === undefined || owner === undefined || dir === undefined) {
    console.error(USAGE);
    return 2;
  }
  const catalog = new Catalog(db);
  try {
    const source = ghArtifacts(owner);
    const snapshots = catalog.db.prepare('SELECT id, repo, "commit" AS "commit" FROM current_snapshot ORDER BY repo').all() as { id: string; repo: string; commit: string | null }[];
    const pathsOf = catalog.db.prepare("SELECT path FROM file WHERE snapshot = ?");
    for (const s of snapshots) {
      try {
        const paths = new Set((pathsOf.all(s.id) as { path: string }[]).map((row) => row.path));
        const run = coverageOfRepo(source, s.repo, s.commit, paths, join(dir, s.repo));
        if (run !== undefined) catalog.putCoverage(s.id, run);
      } catch (error) {
        console.log(`::warning::The coverage of ${s.repo} did not read: ${String(error).split("\n")[0]}`);
      }
    }
    const result = await coverageReport(queryOf(catalog.db));
    const out = option("--out");
    const markdown = option("--markdown");
    if (out !== undefined) writeFileSync(out, `${JSON.stringify(result)}\n`);
    if (markdown !== undefined) writeFileSync(markdown, coverageMarkdown(result));
    console.error(`coverage: ${result.covered.length} of ${result.repos} repositories have a coverage artifact`);
    return 0;
  } finally {
    catalog.close();
  }
}

/** This function prints the annotations of the gates, and gives the exit code. */
function report(verdict: GateVerdict): number {
  for (const line of verdict.lines) console.log(line);
  return verdict.exit;
}

if (import.meta.main) {
  void Promise.resolve(main(process.argv.slice(2))).then((code) => {
    process.exitCode = code;
  });
}
