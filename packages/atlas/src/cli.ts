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
 * - `codeatlas verdict --sample <sample.json> --a <a.jsonl> --agreement <agreement.json> --answers <answers.jsonl> --out <verdict.json>`
 * - `codeatlas trend --db <catalog.sqlite> [--previous <trend.json>] --out <trend.json>`
 * - `codeatlas clone --owner <owner> --into <folder>`
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
 */
import { closeSync, openSync, readFileSync, readdirSync, statSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { buildAtlas } from "./atlas.ts";
import { cacheOf, factsKey, factsOfRepo, treeOf, type BlobFacts, type FactsLine } from "./blobs.ts";
import { manifestsOfRepo } from "./manifests.ts";
import { lockfilesOfRepo } from "./lockfiles.ts";
import { queryOf } from "./query.ts";
import { agreementOf, type AgreementFile, type DraftLabel } from "./agreement.ts";
import { verdictOf, type PersonAnswer } from "./verdict.ts";
import { populationOf, sampleFile, SAMPLE_PLAN, type SampleFile } from "./sample.ts";
import { Catalog } from "./store.ts";
import { addPoint, trendPoint } from "./trend.ts";
import { querySet } from "./query-set.ts";
import { factsMarkdown, factsSummary, gateVerdict, type GateVerdict } from "./summary.ts";
import { clonePublic } from "./clone.ts";
import { buildCorpus, corpusMarkdown, corpusOfRepo } from "./corpus.ts";
import { atlasMarkdown } from "./report.ts";
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
  codeatlas trend --db <catalog.sqlite> [--previous <trend.json>] --out <trend.json>
  codeatlas queries --db <catalog.sqlite> --out <queries.json>
  codeatlas facts [--out facts.jsonl] [--markdown facts.md] [--cache <facts.jsonl>] [--repos-dir <folder>] [<name>=<path> ...]
  codeatlas clone --owner <owner> --into <folder>`;

function main(argv: readonly string[]): number | Promise<number> {
  const [command, ...rest] = argv;
  if (command === "clone") {
    const owner = rest[rest.indexOf("--owner") + 1];
    const into = rest[rest.indexOf("--into") + 1];
    if (!rest.includes("--owner") || !rest.includes("--into") || owner === undefined || into === undefined) {
      console.error(USAGE);
      return 2;
    }
    const { failed } = clonePublic(owner, into);
    for (const name of failed) console.log(`::warning::${name} did not clone`);
    return 0;
  }
  if (command === "corpus") return corpus(rest);
  if (command === "facts") return facts(rest);
  if (command === "catalog") return catalog(rest);
  if (command === "sample") return sample(rest);
  if (command === "agreement") return agreement(rest);
  if (command === "verdict") return verdict(rest);
  if (command === "trend") return trend(rest);
  if (command === "queries") return queries(rest);
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
  for (const repo of args.repos) {
    const tree = treeOf(repo.path);
    const scan = factsOfRepo(repo.name, repo.path, db, tree);
    const snapshot = db.putSnapshot(repo.name, headOf(repo.path), scannedAt, FACTS_VERSION, scan.files, scan.counts);
    db.putManifests(snapshot, manifestsOfRepo(repo.path, tree));
    db.putLockfiles(snapshot, lockfilesOfRepo(repo.path, tree));
    totals.parsed += scan.counts.parsed;
    totals.reused += scan.counts.reused;
    totals.errors += scan.counts.errors;
    totals.bytesParsed += scan.counts.bytesParsed;
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
