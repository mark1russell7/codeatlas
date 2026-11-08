#!/usr/bin/env node
/**
 * The commands:
 *
 * - `codeatlas build [--out atlas.json] [--markdown atlas.md] [--min-nodes 40] [--repos-dir <folder>] [<name>=<path> ...]`
 * - `codeatlas corpus [--out corpus.json] [--markdown corpus.md] [--repos-dir <folder>] [<name>=<path> ...]`
 * - `codeatlas catalog [--out catalog.sqlite] [--markdown catalog.md] [--repos-dir <folder>] [<name>=<path> ...]`
 * - `codeatlas facts [--out facts.jsonl] [--markdown facts.md] [--cache <facts.jsonl>] [--repos-dir <folder>] [<name>=<path> ...]`
 * - `codeatlas trend --db <catalog.sqlite> [--previous <trend.json>] --out <trend.json>`
 * - `codeatlas clone --owner <owner> --into <folder>`
 *
 * The command build scans each repository (each folder of --repos-dir, and each name=path), and writes the
 * atlas as JSON and as Markdown. The command corpus counts the files, lines and bytes of each kind in the same repositories.
 *
 * The command catalog writes the same facts into a SQLite database. Its blobs are the cache of the next run.
 * The command facts writes the Layer 1a facts of each blob as JSON Lines. A cache from an earlier output saves each parse of a known blob.
 * The command trend adds the point of a catalog to the trend file of the last build.
 */
import { closeSync, openSync, readFileSync, readdirSync, statSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { buildAtlas } from "./atlas.ts";
import { cacheOf, factsKey, factsOfRepo, type BlobFacts, type FactsLine } from "./blobs.ts";
import { queryOf } from "./query.ts";
import { Catalog } from "./store.ts";
import { addPoint, trendPoint } from "./trend.ts";
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
  codeatlas trend --db <catalog.sqlite> [--previous <trend.json>] --out <trend.json>
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
  if (command === "trend") return trend(rest);
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
    const scan = factsOfRepo(repo.name, repo.path, db);
    db.putSnapshot(repo.name, headOf(repo.path), scannedAt, FACTS_VERSION, scan.files, scan.counts);
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
