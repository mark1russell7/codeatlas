#!/usr/bin/env node
/**
 * The commands:
 *
 * - `codeatlas build [--out atlas.json] [--markdown atlas.md] [--min-nodes 40] [--repos-dir <folder>] [<name>=<path> ...]`
 * - `codeatlas corpus [--out corpus.json] [--markdown corpus.md] [--repos-dir <folder>] [<name>=<path> ...]`
 * - `codeatlas catalog [--out catalog.sqlite] [--markdown catalog.md] [--repos-dir <folder>] [<name>=<path> ...]`
 * - `codeatlas facts [--out facts.jsonl] [--markdown facts.md] [--cache <facts.jsonl>] [--files sources|published] [--repos-dir <folder>] [<name>=<path> ...]`
 * - `codeatlas sample --db <catalog.sqlite> --out <sample.json>`
 * - `codeatlas agreement --sample <sample.json> --a <a.jsonl> --b <b.jsonl> --out <agreement.json>`
 * - `codeatlas reference --sample <sample.json> --rater <name>=<labels.jsonl> ... [--labeler <name>=<labels.jsonl> ...] [--db <catalog.sqlite>] --out <reference.json> [--markdown <reference.md>]`
 * - `codeatlas verdict --sample <sample.json> --a <a.jsonl> --agreement <agreement.json> --answers <answers.jsonl> --out <verdict.json>`
 * - `codeatlas trend --db <catalog.sqlite> [--previous <trend.json>] [--owner <owners> | --owners] --out <trend.json>`
 * - `codeatlas previous-trend (--owner <owners> | --owners) --repo <name> --out <trend.json> [--workflow pages.yml]`
 * - `codeatlas drift --db <catalog.sqlite> [--out drift.json] [--markdown drift.md] [--gate]`
 * - `codeatlas coverage --db <catalog.sqlite> (--owner <owners> | --owners) --dir <folder> [--out coverage.json] [--markdown coverage.md]`
 * - `codeatlas clone (--owner <owners> | --owners) --into <folder>`
 * - `codeatlas prune --db <catalog.sqlite> (--owner <owners> | --owners)`
 * - `codeatlas mcp --db <catalog.sqlite>`
 * - `codeatlas tool <name> [<json input>] --db <catalog.sqlite>`
 *
 * The option `--owner` takes one login or a list of logins with commas. The flag `--owners` gives each owner of `LOGINS`.
 * A repository name that two owners have stops the command, because the catalog keys each repository by its name.
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
 *
 * The command trend adds the point of a catalog to the trend file of the last build.
 * With the owners, it removes the rows of each repository that is not public at this time from each point.
 * The command previous-trend writes the trend of the last deploy. It reads the Pages site of each owner, then the
 * Pages artifact of the last deploy. Its exit code is 3 (`FIRST_DEPLOY_EXIT`) when the repository has no deploy.
 *
 * The command queries writes the answers of the query set of a catalog as JSON, for the site.
 * The command coverage reads the coverage artifacts of the CI of each repository into the catalog, and writes the report.
 * The command drift writes the drift of each repository from the template, and the share of the current repositories.
 * The command mcp serves the tools of agents over a catalog as MCP tools. The command tool calls one of them.
 */
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkpoint } from "@mark1russell7/sqlite";
import { buildAtlas } from "./atlas.ts";
import { cacheOf, factsKey, factsOfRepo, treeOf, type BlobFacts, type FactsLine } from "./blobs.ts";
import {
  driftMarkdown,
  keepListOfRepo,
  pinFreshness,
  pinAge,
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
import { addPoint, filterTrend, trendPoint } from "./trend.ts";
import { querySet } from "./query-set.ts";
import { factsMarkdown, factsSummary, gateVerdict, type GateVerdict } from "./summary.ts";
import { clonePublic, isSafeName, ownedRepos, ownerMap, ownersOption, repoNames, type OwnedRepo } from "./clone.ts";
import { DEFAULT_IO, FIRST_DEPLOY_EXIT, previousTrend } from "./previous-trend.ts";
import { changedRepos, DELAY_DAYS, delayStats, freshMarkdown, FRESHNESS_HOURS, indexedHeads, remoteHeads, staleRepos, type FreshReport } from "./fresh.ts";
import { coverageGaps, coverageGapsMarkdown, coverageMarkdown, coverageOfRepo, coverageReport, ghArtifacts } from "./coverage.ts";
import { buildCorpus, corpusMarkdown, corpusOfRepo } from "./corpus.ts";
import { atlasMarkdown } from "./report.ts";
import { mcpCommand, toolCommand } from "./tools-cli.ts";
import { scanRepoInto } from "./rescan.ts";
import { conventionsBreaks, conventionsMarkdown } from "./conventions.ts";
import { codeIndex, dimensionCatalog, dimensionSummaries, dimensionsMarkdown } from "./dimensions.ts";
import { formulaReport, formulasMarkdown, type FormulaVerdict, type OwnerFind } from "./formulas.ts";
import { plannedDuplication, plannedMarkdown } from "./planned.ts";
import { FACTS_VERSION } from "./facts.ts";
import { FILE_CHOICES, headOf, isFileChoice, scanRepo, type RepoScan } from "./scan.ts";

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
  codeatlas trend --db <catalog.sqlite> [--previous <trend.json>] [--owner <owners> | --owners] --out <trend.json>
  codeatlas previous-trend (--owner <owners> | --owners) --repo <name> --out <trend.json> [--workflow pages.yml]
  codeatlas queries --db <catalog.sqlite> --out <queries.json>
  codeatlas facts [--out facts.jsonl] [--markdown facts.md] [--cache <facts.jsonl>] [--files sources|published] [--repos-dir <folder>] [<name>=<path> ...]
  codeatlas drift --db <catalog.sqlite> [--out drift.json] [--markdown drift.md] [--gate]
  codeatlas breaks --db <catalog.sqlite> [--out breaks.json] [--markdown breaks.md]
  codeatlas planned --db <catalog.sqlite> [--out planned.json] [--markdown planned.md] [--min 0.25]
  codeatlas dimensions --db <catalog.sqlite> [--out dimensions.json] [--markdown dimensions.md] [--catalog site-dimensions.json]
  codeatlas formulas --db <catalog.sqlite> --finds <finds.jsonl> [--verdicts <verdicts.jsonl>] [--out formulas.json] [--markdown formulas.md] [--top 30]
  codeatlas coverage --db <catalog.sqlite> (--owner <owners> | --owners) --dir <folder> [--out coverage.json] [--markdown coverage.md]
  codeatlas clone (--owner <owners> | --owners) --into <folder> [--only <names.txt>]
  codeatlas prune --db <catalog.sqlite> (--owner <owners> | --owners)
  codeatlas fresh (--owner <owners> | --owners) --db <catalog.sqlite> [--changed <names.txt>] [--out fresh.json] [--markdown fresh.md] [--gate]

  <owners> is one login, or a list of logins with commas. --owners gives each owner of the atlas.
  codeatlas mcp --db <catalog.sqlite> [--write]
  codeatlas tool <name> [<json input>] --db <catalog.sqlite>`;

/**
 * This function reads the owners of a command. It prints the error or the usage, and gives the exit code 2, when the
 * options name no owner or a wrong one.
 */
function ownersOrExit(argv: readonly string[]): readonly string[] | number {
  const owners = ownersOption(argv);
  if (owners !== undefined && "owners" in owners) return owners.owners;
  console.error(owners?.error ?? USAGE);
  return 2;
}

/**
 * This function lists the public repositories of each owner. When the list fails, or when two owners have one name,
 * it prints the error and gives undefined.
 */
function listOwned(owners: readonly string[]): OwnedRepo[] | undefined {
  try {
    return ownedRepos(owners);
  } catch (error) {
    console.log(`::error::${String(error instanceof Error ? error.message : error).split("\n")[0]}`);
    return undefined;
  }
}

function main(argv: readonly string[]): number | Promise<number> {
  const [command, ...rest] = argv;
  if (command === "clone") {
    const owners = ownersOrExit(rest);
    if (typeof owners === "number") return owners;
    const into = rest.includes("--into") ? rest[rest.indexOf("--into") + 1] : undefined;
    if (into === undefined) {
      console.error(USAGE);
      return 2;
    }
    // With --only, the clone takes the repositories of that file, one name on each line, and the template
    const onlyFile = rest.includes("--only") ? rest[rest.indexOf("--only") + 1] : undefined;
    const only = onlyFile === undefined ? undefined : new Set([TEMPLATE_REPO, ...repoNames(readFileSync(onlyFile, "utf8"))]);
    let failed: string[];
    try {
      // The template gets its history, so the drift reads the content of each pin
      ({ failed } = clonePublic(owners, into, console.error, { [TEMPLATE_REPO]: TEMPLATE_CLONE }, only));
    } catch (error) {
      console.log(`::error::${String(error instanceof Error ? error.message : error).split("\n")[0]}`);
      return 1;
    }
    for (const name of failed) console.log(`::warning::${name} did not clone`);
    return 0;
  }
  if (command === "previous-trend") return previousTrendCommand(rest);
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
  if (command === "prune") return prune(rest);
  if (command === "planned") return planned(rest);
  if (command === "formulas") return formulas(rest);
  if (command === "dimensions") return dimensions(rest);
  if (command === "fresh") return fresh(rest);
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

/**
 * This function takes one option with its value from the arguments, and gives the value and the other arguments. An
 * option with no value gives an error that tells `what` the option takes.
 */
export function takeOption(argv: readonly string[], name: string, what: string): { readonly value: string | undefined; readonly rest: readonly string[] } | { readonly error: string } {
  const at = argv.indexOf(name);
  if (at === -1) return { value: undefined, rest: argv };
  const value = argv[at + 1];
  if (value === undefined) return { error: `${name} takes ${what}.` };
  return { value, rest: [...argv.slice(0, at), ...argv.slice(at + 2)] };
}

function facts(argv: readonly string[]): number {
  const cacheOption = takeOption(argv, "--cache", "a file");
  if ("error" in cacheOption) {
    console.error(cacheOption.error);
    return 2;
  }
  const choices = FILE_CHOICES.join(" or ");
  const filesOption = takeOption(cacheOption.rest, "--files", choices);
  if ("error" in filesOption) {
    console.error(filesOption.error);
    return 2;
  }
  const choice = filesOption.value ?? "sources";
  if (!isFileChoice(choice)) {
    console.error(`--files takes ${choices}, not ${choice}.`);
    return 2;
  }
  const cachePath = cacheOption.value;
  const args = parseBuildArgs(filesOption.rest, subfolders, "facts.jsonl");
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
    const scan = factsOfRepo(repo.name, repo.path, cache, treeOf(repo.path), choice);
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
  const tooLarge = scans.reduce((total, scan) => total + scan.counts.tooLarge, 0);
  console.error(`facts: ${summary.repos} repositories, ${summary.files} files (${choice}), ${tooLarge} over the size limit, ${summary.parsed} parsed, ${summary.reused} from the cache (${known.size} known), ${summary.errors} errors, ${Math.round(ms)} ms`);
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
  // A database of the last run with another schema starts again from empty
  const db = new Catalog(args.out, { rebuild: true });
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
    // An empty repository has no commit, so it has nothing to scan. It must not stop the scan of the others
    if (headOf(repo.path) === null) {
      console.log(`::warning::${repo.name} has no commit, so the scan skips it`);
      continue;
    }
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
  // The time of each part after the scan. The scan of a full cache takes about 18 s, but the step took 6 min (run 43824483658)
  const parts: string[] = [];
  const timed = <T>(part: string, f: () => T): T => {
    const start = performance.now();
    const value = f();
    parts.push(`${part} ${Math.round(performance.now() - start)} ms`);
    return value;
  };
  const summary = timed("summary", () => db.summary({ ...totals, ms }, (part, t) => parts.push(`summary ${part} ${Math.round(t)} ms`)));
  const unread = timed("unread", () => db.unread());
  // CI keeps only the file, so the log must be empty
  if (timed("checkpoint", () => checkpoint(db.db, "TRUNCATE").busy)) console.error("catalog: a different connection had the file, so the file can lack the last commits");
  timed("close", () => db.close());
  console.error(`catalog: after the scan: ${parts.join(", ")}`);
  if (args.markdown !== undefined) writeFileSync(args.markdown, factsMarkdown(summary));
  console.error(`catalog: ${summary.repos} repositories, ${summary.files} files, ${summary.parsed} parsed, ${summary.reused} from the cache (${known} blobs known), ${summary.errors} errors, ${Math.round(ms)} ms`);
  return report(gateVerdict(summary, unread));
}

/**
 * This function removes from the catalog `--db` each repository that is not a public source repository of an owner
 * at this time. A repository that becomes private thus leaves the catalog, and the artifacts of the next run do not have it.
 */
function prune(argv: readonly string[]): number {
  const path = argv.includes("--db") ? argv[argv.indexOf("--db") + 1] : undefined;
  const owners = ownersOrExit(argv);
  if (typeof owners === "number") return owners;
  if (path === undefined) {
    console.error(USAGE);
    return 2;
  }
  const repos = listOwned(owners);
  if (repos === undefined) return 1;
  const names = repos.map((repo) => repo.name);
  if (names.length === 0) {
    console.error(`prune: the list of the public repositories of ${owners.join(", ")} is empty, so nothing is removed`);
    return 1;
  }
  // The prune comes before the scan, so a restored database of another schema must not stop it
  const catalog = new Catalog(path, { rebuild: true });
  try {
    const removed = catalog.pruneRepos(names);
    if (checkpoint(catalog.db, "TRUNCATE").busy) console.error("prune: a different connection had the file, so the file can lack the last commits");
    console.error(`prune: ${names.length} public repositories, ${removed.length} removed from the catalog`);
    return 0;
  } finally {
    catalog.close();
  }
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

/**
 * This function adds the point of the catalog `--db` to the trend `--previous`, and writes the trend `--out`. With
 * `--owner` or `--owners`, each point keeps only the rows of the public repositories of the owners.
 */
async function trend(argv: readonly string[]): Promise<number> {
  const option = (name: string): string | undefined => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const db = option("--db");
  const out = option("--out");
  const previous = option("--previous");
  const owners = ownersOption(argv);
  if (db === undefined || out === undefined || (owners !== undefined && "error" in owners)) {
    console.error(owners !== undefined && "error" in owners ? owners.error : USAGE);
    return 2;
  }
  const repos = owners === undefined ? undefined : listOwned(owners.owners);
  if (owners !== undefined && repos === undefined) return 1;
  const keep = repos?.map((repo) => repo.name);
  const catalog = new Catalog(db);
  try {
    const point = await trendPoint(queryOf(catalog.db), new Date().toISOString(), FACTS_VERSION);
    const added = addPoint(previous === undefined ? undefined : JSON.parse(readFileSync(previous, "utf8")), point);
    const file = keep === undefined ? added : filterTrend(added, keep);
    if (keep !== undefined) console.error(`trend: ${file.points.filter((each) => each.filtered === true).length} points have filtered rows`);
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
/**
 * This function writes the drift from the template of the catalog `--db` as JSON and as Markdown. With `--gate`, it
 * fails when the p90 of the pin age is over the limit.
 */
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
    const age = await pinAge(q, { at: new Date().toISOString() });
    const out = option("--out");
    const markdown = option("--markdown");
    if (out !== undefined) writeFileSync(out, `${JSON.stringify({ age, pins: freshness, stamp, lag, drift: all })}\n`);
    if (markdown !== undefined) writeFileSync(markdown, driftMarkdown(freshness, stamp, lag, age));
    const line = (current: number, behind: number): string => `${current} of ${current + behind}`;
    const median = lag.median === null ? "not known" : `${lag.median.behind} commits, ${lag.median.days} days`;
    const days = (value: number | null): string => (value === null ? "not known" : `${value} days`);
    console.error(`drift: pin age p50 ${days(age.p50)}, p90 ${days(age.p90)} (${age.pass ? "pass" : "fail"}), pins ${line(freshness.current.length, freshness.behind.length)} current, copies ${line(stamp.current.length, stamp.behind.length)} current, median pin lag ${median}`);
    if (!argv.includes("--gate") || age.pass) return 0;
    console.error(`::error::The p90 of the pin age is ${days(age.p90)}, over the limit of ${age.limit} days. Over the line: ${age.over.map((r) => `${r.repo} (${r.days} days)`).join(", ") || "none"}.`);
    return 1;
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

/**
 * This function compares the head of each public repository of the owners with the catalog `--db`. It writes the
 * repositories with a new head to `--changed`. With `--gate`, it fails when a head waits 6 hours or more.
 */
async function fresh(argv: readonly string[]): Promise<number> {
  const option = (name: string): string | undefined => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const owners = ownersOrExit(argv);
  if (typeof owners === "number") return owners;
  const db = option("--db");
  if (db === undefined) {
    console.error(USAGE);
    return 2;
  }
  const repos = listOwned(owners);
  if (repos === undefined) return 1;
  const ownerOf = ownerMap(repos);
  const heads = remoteHeads(repos);
  const now = new Date().toISOString();
  const catalog = existsSync(db) ? readOnlyCatalog(db) : undefined;
  try {
    const q = catalog === undefined ? undefined : queryOf(catalog);
    const indexed = q === undefined ? new Map() : await indexedHeads(q);
    // The commit time of a head comes from the API only for the heads that the index does not have
    const timeOf = (repo: string, sha: string): string | null => {
      try {
        const owner = ownerOf.get(repo);
        if (owner === undefined) return null;
        return execFileSync("gh", ["api", `repos/${owner}/${repo}/commits/${sha}`, "--jq", ".commit.committer.date"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
      } catch {
        return null;
      }
    };
    const report: FreshReport = {
      at: now,
      repos: repos.length,
      unread: heads.filter((h) => h.head === null).map((h) => h.repo),
      changed: changedRepos(heads, indexed),
      stale: staleRepos(heads, indexed, now, timeOf),
      delay: q === undefined ? { days: DELAY_DAYS, commits: 0, median: null, p95: null } : await delayStats(q, now),
    };
    const changedFile = option("--changed");
    if (changedFile !== undefined) writeFileSync(changedFile, report.changed.map((name) => `${name}
`).join(""));
    const out = option("--out");
    if (out !== undefined) writeFileSync(out, `${JSON.stringify(report, null, 2)}
`);
    const markdown = freshMarkdown(report);
    const markdownFile = option("--markdown");
    if (markdownFile !== undefined) writeFileSync(markdownFile, markdown);
    const failing = report.stale.filter((s) => s.fails);
    console.error(`fresh: ${report.repos} repositories, ${report.changed.length} changed, ${failing.length} wait ${FRESHNESS_HOURS} hours or more, ${report.unread.length} not read`);
    if (!argv.includes("--gate")) return 0;
    for (const s of failing) console.log(`::error::${s.repo} has the head ${s.head.slice(0, 7)} that the index does not have, for ${s.hours === null ? "a time that is not known" : `${Math.round(s.hours)} hours`}.`);
    for (const name of report.unread) console.log(`::warning::git ls-remote could not read ${name}.`);
    return failing.length > 0 ? 1 : 0;
  } finally {
    catalog?.close();
  }
}

/** This function writes the index of the dimensions of the catalog `--db` as JSON `--out`, and their distributions as Markdown `--markdown`. */
async function dimensions(argv: readonly string[]): Promise<number> {
  const option = (name: string): string | undefined => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const db = option("--db");
  if (db === undefined) {
    console.error(USAGE);
    return 2;
  }
  const catalog = readOnlyCatalog(db);
  try {
    const index = await codeIndex(queryOf(catalog));
    const summaries = dimensionSummaries(index);
    const out = option("--out");
    const markdown = option("--markdown");
    if (out !== undefined) writeFileSync(out, `${JSON.stringify({ ...index, summaries })}\n`);
    if (markdown !== undefined) writeFileSync(markdown, dimensionsMarkdown(summaries));
    const site = option("--catalog");
    if (site !== undefined) writeFileSync(site, `${JSON.stringify(dimensionCatalog(summaries))}\n`);
    console.error(`dimensions: ${index.functions.length} functions, ${index.modules.length} modules, ${summaries.filter((s) => s.counts).length} of ${summaries.length} dimensions checked`);
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
    console.error(`formulas: ${report.classes.length} classes, recall ${recall}, copy ${report.precision.copy.decision}, home ${report.precision.home.decision}`);
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
 * This function reads the coverage artifacts of each current snapshot of the catalog `--db` into the catalog. The
 * artifacts of a repository come from its owner. A repository whose artifacts do not download gets a warning, not a failure.
 */
async function coverage(argv: readonly string[]): Promise<number> {
  const option = (name: string): string | undefined => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const db = option("--db");
  const owners = ownersOrExit(argv);
  if (typeof owners === "number") return owners;
  const dir = option("--dir");
  if (db === undefined || dir === undefined) {
    console.error(USAGE);
    return 2;
  }
  const repos = listOwned(owners);
  if (repos === undefined) return 1;
  const catalog = new Catalog(db);
  try {
    const source = ghArtifacts(ownerMap(repos));
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
    const gaps = await coverageGaps(queryOf(catalog.db));
    const out = option("--out");
    const markdown = option("--markdown");
    if (out !== undefined) writeFileSync(out, `${JSON.stringify({ ...result, gaps })}\n`);
    if (markdown !== undefined) writeFileSync(markdown, `${coverageMarkdown(result)}\n${coverageGapsMarkdown(gaps)}`);
    console.error(`coverage: ${result.covered.length} of ${result.repos} repositories have a coverage artifact, ${gaps.length} have no function report`);
    return 0;
  } finally {
    catalog.close();
  }
}

/**
 * This function writes the trend of the last deploy to `--out`. It reads the Pages site of each owner, the current
 * owner first, then the Pages artifact of the last deploy of `--workflow`. The exit code is `FIRST_DEPLOY_EXIT` when
 * the repository has no deploy, and 1 on each other miss.
 */
async function previousTrendCommand(argv: readonly string[]): Promise<number> {
  const option = (name: string): string | undefined => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const owners = ownersOrExit(argv);
  if (typeof owners === "number") return owners;
  const repo = option("--repo");
  const out = option("--out");
  const workflow = option("--workflow") ?? "pages.yml";
  if (repo === undefined || out === undefined || !isSafeName(repo)) {
    console.error(USAGE);
    return 2;
  }
  // In CI the current owner and the repository come from GitHub. Each other run takes the first owner of the list
  const fromEnv = process.env["GITHUB_REPOSITORY_OWNER"];
  const current = fromEnv !== undefined && isSafeName(fromEnv) ? fromEnv : (owners[0] ?? "");
  const repository = process.env["GITHUB_REPOSITORY"] ?? `${current}/${repo}`;
  const dir = mkdtempSync(join(tmpdir(), "atlas-trend-"));
  try {
    const result = await previousTrend({ owners, current, repo, repository, workflow, dir }, DEFAULT_IO);
    if (result.kind === "found") {
      writeFileSync(out, result.text);
      console.error(`previous-trend: the trend comes from ${result.source}`);
      return 0;
    }
    if (result.kind === "first") {
      console.error(`previous-trend: ${repository} has no successful run of ${workflow} on main, and no site has a trend: ${result.tried.join(", ")}`);
      return FIRST_DEPLOY_EXIT;
    }
    console.log(`::error::${result.error}`);
    return 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
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
