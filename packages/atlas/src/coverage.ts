/**
 * The coverage of the tests, from the CI artifacts of each repository (Layer 1c). An artifact whose name starts with
 * `coverage` has Istanbul reports: `coverage-summary.json` and, in the template standard, `coverage-final.json`.
 * The catalog keeps the measures of each file and the hits of each function, with the commit of the CI run.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CatalogQuery } from "./query.ts";
import { TEMPLATE_REPO } from "./templates.ts";

/** One measure of a file: the count of the items and the count of the items that a test reached. */
export interface Measure {
  readonly total: number;
  readonly covered: number;
}

/** The coverage of one file of a repository. */
export interface CoverageFile {
  readonly path: string;
  readonly statements: Measure;
  readonly branches: Measure;
  readonly functions: Measure;
  readonly lines: Measure;
}

/** The hits of one function of a file. The line is the line of the name of the function. */
export interface CoverageFunction {
  readonly path: string;
  readonly line: number;
  readonly name: string;
  readonly hits: number;
}

/** The coverage of one CI run of a repository. */
export interface CoverageRun {
  readonly runId: number;
  readonly commit: string;
  readonly createdAt: string;
  readonly artifacts: readonly string[];
  readonly files: readonly CoverageFile[];
  readonly functions: readonly CoverageFunction[];
  /** The report keys that match no file of the snapshot. */
  readonly unmatched: number;
}

/** One CI artifact of a repository, as the GitHub API gives it. */
export interface ArtifactInfo {
  readonly name: string;
  readonly runId: number;
  readonly branch: string;
  readonly commit: string;
  readonly createdAt: string;
  readonly expired: boolean;
}

/** The access to the CI artifacts. The default uses the GitHub CLI. Tests give a fake. */
export interface ArtifactSource {
  artifacts(repo: string): ArtifactInfo[];
  /** This method writes the artifact `name` of the run `runId` into the folder `dir`. */
  download(repo: string, runId: number, name: string, dir: string): void;
}

/** This function gives the artifact source of the owner `owner` through the GitHub CLI. */
export function ghArtifacts(owner: string): ArtifactSource {
  return {
    artifacts(repo) {
      const out = execFileSync("gh", ["api", `repos/${owner}/${repo}/actions/artifacts?per_page=100`, "--jq", ".artifacts"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      const rows = JSON.parse(out) as { name: string; expired: boolean; created_at: string; workflow_run: { id: number; head_branch: string; head_sha: string } }[];
      return rows.map((a) => ({ name: a.name, runId: a.workflow_run.id, branch: a.workflow_run.head_branch, commit: a.workflow_run.head_sha, createdAt: a.created_at, expired: a.expired }));
    },
    download(repo, runId, name, dir) {
      execFileSync("gh", ["run", "download", String(runId), "-R", `${owner}/${repo}`, "-n", name, "-D", dir], { stdio: ["ignore", "ignore", "pipe"] });
    },
  };
}

/**
 * This function chooses the CI run of a repository for its coverage. It takes the run of the commit `commit` on
 * `main`, or else the newest run of `main`. It gives the run and its artifacts whose name starts with `coverage`.
 */
export function coverageRunOf(artifacts: readonly ArtifactInfo[], commit: string | null): { runId: number; commit: string; createdAt: string; names: string[] } | undefined {
  const usable = artifacts.filter((a) => !a.expired && a.branch === "main" && a.name.startsWith("coverage"));
  if (usable.length === 0) return undefined;
  const newest = [...usable].sort((x, y) => (x.createdAt < y.createdAt ? 1 : x.createdAt > y.createdAt ? -1 : y.runId - x.runId));
  const chosen = newest.find((a) => a.commit === commit) ?? newest[0]!;
  const names = [...new Set(usable.filter((a) => a.runId === chosen.runId).map((a) => a.name))].sort();
  return { runId: chosen.runId, commit: chosen.commit, createdAt: chosen.createdAt, names };
}

/**
 * This function gives the path of the snapshot that a report key names. A key is an absolute path of the CI runner.
 * The longest tail of the key that is a path of `paths` wins.
 */
export function pathOfKey(key: string, paths: ReadonlySet<string>): string | undefined {
  const parts = key.replace(/\\/g, "/").split("/");
  for (let i = 0; i < parts.length; i++) {
    const tail = parts.slice(i).join("/");
    if (paths.has(tail)) return tail;
  }
  return undefined;
}

const measure = (value: unknown): Measure => {
  const m = value as { total?: unknown; covered?: unknown } | undefined;
  return { total: Number(m?.total ?? 0), covered: Number(m?.covered ?? 0) };
};

/** This function reads a `coverage-summary.json` text. It skips the key `total` and each key with no path. */
export function filesOfSummary(text: string, paths: ReadonlySet<string>): { files: CoverageFile[]; unmatched: number } {
  const json = JSON.parse(text) as Record<string, Record<string, unknown>>;
  const files: CoverageFile[] = [];
  let unmatched = 0;
  for (const [key, value] of Object.entries(json)) {
    if (key === "total") continue;
    const path = pathOfKey(key, paths);
    if (path === undefined) {
      unmatched++;
      continue;
    }
    files.push({ path, statements: measure(value["statements"]), branches: measure(value["branches"]), functions: measure(value["functions"]), lines: measure(value["lines"]) });
  }
  return { files, unmatched };
}

/** This function reads the hits of each function of a `coverage-final.json` text. */
export function functionsOfFinal(text: string, paths: ReadonlySet<string>): CoverageFunction[] {
  const json = JSON.parse(text) as Record<string, { fnMap?: Record<string, { name: string; decl?: { start?: { line?: number } }; loc?: { start?: { line?: number } } }>; f?: Record<string, number> }>;
  const out: CoverageFunction[] = [];
  for (const [key, value] of Object.entries(json)) {
    const path = pathOfKey(key, paths);
    if (path === undefined) continue;
    for (const [id, fn] of Object.entries(value.fnMap ?? {})) {
      const line = fn.decl?.start?.line ?? fn.loc?.start?.line;
      if (line === undefined) continue;
      out.push({ path, line, name: fn.name, hits: value.f?.[id] ?? 0 });
    }
  }
  return out;
}

/** This function gives each file named `name` in the folder `dir` and its folders. */
function filesNamed(dir: string, name: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name === name) out.push(join(entry.parentPath, entry.name));
  }
  return out.sort();
}

/**
 * This function reads the reports in the folder `dir` against the paths of a snapshot. A file in two reports keeps
 * the measures of the first report.
 */
export function coverageOfDir(dir: string, paths: ReadonlySet<string>): { files: CoverageFile[]; functions: CoverageFunction[]; unmatched: number } {
  const files = new Map<string, CoverageFile>();
  let unmatched = 0;
  for (const file of filesNamed(dir, "coverage-summary.json")) {
    const read = filesOfSummary(readFileSync(file, "utf8"), paths);
    unmatched += read.unmatched;
    for (const f of read.files) if (!files.has(f.path)) files.set(f.path, f);
  }
  const functions = new Map<string, CoverageFunction>();
  for (const file of filesNamed(dir, "coverage-final.json")) {
    for (const f of functionsOfFinal(readFileSync(file, "utf8"), paths)) {
      const key = `${f.path}:${f.line}:${f.name}`;
      if (!functions.has(key)) functions.set(key, f);
    }
  }
  const byPath = (x: { path: string }, y: { path: string }): number => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0);
  return { files: [...files.values()].sort(byPath), functions: [...functions.values()].sort((x, y) => byPath(x, y) || x.line - y.line), unmatched };
}

/**
 * This function gives the coverage of one repository: it chooses a CI run, downloads its coverage artifacts into
 * `dir`, and reads them. It gives undefined for a repository with no coverage artifact on `main`.
 */
export function coverageOfRepo(source: ArtifactSource, repo: string, commit: string | null, paths: ReadonlySet<string>, dir: string): CoverageRun | undefined {
  const run = coverageRunOf(source.artifacts(repo), commit);
  if (run === undefined) return undefined;
  for (const name of run.names) {
    const target = join(dir, name);
    mkdirSync(target, { recursive: true });
    source.download(repo, run.runId, name, target);
  }
  const read = coverageOfDir(dir, paths);
  return { runId: run.runId, commit: run.commit, createdAt: run.createdAt, artifacts: run.names, ...read };
}

/** The coverage of one repository in the report. */
export interface RepoCoverage {
  readonly repo: string;
  readonly commit: string;
  /** True when the run is of the commit of the snapshot. */
  readonly current: boolean;
  readonly files: number;
  readonly lines: Measure;
  readonly functions: Measure;
  /** The functions of `coverage-final.json`. The value is 0 when the artifact has no such report. */
  readonly reported: number;
  /** The exported functions of the snapshot that the report has, and those with no hit. */
  readonly exported: number;
  readonly exportedUnhit: number;
}

/** The coverage report of the catalog. */
export interface CoverageReport {
  readonly repos: number;
  readonly covered: readonly RepoCoverage[];
}

const sum = (rows: readonly { total: number; covered: number }[]): Measure => ({
  total: rows.reduce((s, r) => s + r.total, 0),
  covered: rows.reduce((s, r) => s + r.covered, 0),
});

/** This function gives the coverage of each current snapshot of the catalog. */
export async function coverageReport(q: CatalogQuery): Promise<CoverageReport> {
  const repos = await q.selectFrom("current_snapshot").select(["repo"]).execute();
  const runs = await q
    .selectFrom("current_snapshot as s")
    .innerJoin("coverage_run as r", "r.snapshot", "s.id")
    .select(["s.repo as repo", "s.commit as snapshotCommit", "r.commit as commit"])
    .orderBy("repo")
    .execute();
  const files = await q
    .selectFrom("current_snapshot as s")
    .innerJoin("coverage_file as f", "f.snapshot", "s.id")
    .select(["s.repo as repo", "f.lines as lines", "f.lines_covered as linesCovered", "f.functions as functions", "f.functions_covered as functionsCovered"])
    .execute();
  const reported = await q
    .selectFrom("current_snapshot as s")
    .innerJoin("coverage_function as c", "c.snapshot", "s.id")
    .select(["s.repo as repo"])
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .groupBy("s.repo")
    .execute();
  const exported = await q
    .selectFrom("current_file as f")
    .innerJoin("coverage_function as c", (join) => join.onRef("c.snapshot", "=", "f.snapshot").onRef("c.path", "=", "f.path"))
    .innerJoin("symbol as s", (join) => join.onRef("s.blob", "=", "f.blob").onRef("s.line", "=", "c.line"))
    .where("s.exported", "=", 1)
    .where("s.kind", "in", ["function", "method"])
    .select(["f.repo as repo", "c.hits as hits"])
    .execute();
  const covered = runs.map((run) => {
    const mine = files.filter((f) => f.repo === run.repo);
    const fns = exported.filter((e) => e.repo === run.repo);
    return {
      repo: run.repo,
      commit: run.commit,
      current: run.commit === run.snapshotCommit,
      files: mine.length,
      lines: sum(mine.map((f) => ({ total: f.lines, covered: f.linesCovered }))),
      functions: sum(mine.map((f) => ({ total: f.functions, covered: f.functionsCovered }))),
      reported: Number(reported.find((r) => r.repo === run.repo)?.n ?? 0),
      exported: fns.length,
      exportedUnhit: fns.filter((e) => e.hits === 0).length,
    };
  });
  return { repos: repos.length, covered };
}

const percent = (m: Measure): string => (m.total === 0 ? "-" : `${((100 * m.covered) / m.total).toFixed(1)}%`);

/** This function writes the coverage report as Markdown, for the summary of the CI job. */
export function coverageMarkdown(report: CoverageReport): string {
  const lines = ["## Coverage", ""];
  const current = report.covered.filter((r) => r.current).length;
  const read = report.covered.filter((r) => r.files > 0).length;
  lines.push(`- Repositories with a coverage artifact on \`main\`: **${report.covered.length}** of ${report.repos}. Of the current commit: ${current}.`);
  lines.push(`- With an Istanbul report (\`coverage-summary.json\`): ${read}. The others have their own format.`);
  lines.push(`- With a function report (\`coverage-final.json\`): ${report.covered.filter((r) => r.reported > 0).length}.`);
  lines.push(`- Lines: ${percent(sum(report.covered.map((r) => r.lines)))}. Functions: ${percent(sum(report.covered.map((r) => r.functions)))}.`);
  const exported = report.covered.reduce((s, r) => s + r.exported, 0);
  const unhit = report.covered.reduce((s, r) => s + r.exportedUnhit, 0);
  lines.push(`- Exported functions in a report: ${exported}. With no hit of a test: ${unhit}.`);
  if (report.covered.length > 0) {
    lines.push("", "| Repository | Commit | Files | Lines | Functions | Exported, no hit |", "| --- | --- | ---: | ---: | ---: | ---: |");
    for (const r of report.covered) {
      lines.push(`| \`${r.repo}\` | \`${r.commit.slice(0, 7)}\`${r.current ? "" : " (older)"} | ${r.files === 0 ? "no report" : r.files} | ${percent(r.lines)} | ${percent(r.functions)} | ${r.reported === 0 ? "no function report" : `${r.exportedUnhit} of ${r.exported}`} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** The shared CI workflow of the template. Its action `coverage` writes the artifact `coverage` on `main`. */
const SHARED_CI = ".github/workflows/reusable-ci.yml";

/**
 * The cause of a repository with no function report on `main`, in the order that the function `coverageGaps` examines:
 * - `no-tests`: the repository has no test file.
 * - `no-coverage-v8`: no manifest has the dependency `@vitest/coverage-v8`.
 * - `summary-only`: the artifact has no `coverage-final.json`. The reporter `json` of Vitest is not set.
 * - `no-shared-ci`: no workflow uses the shared CI of the template, and no artifact `coverage` is on `main`.
 * - `old-ci`: the pinned shared CI is not the one on `main` of the template. The sync of the template moves the pin.
 * - `no-artifact`: the CI of `main` gave no artifact. The run failed, did not end, or its artifact expired.
 */
export type CoverageCause = "no-tests" | "no-coverage-v8" | "summary-only" | "no-shared-ci" | "old-ci" | "no-artifact";

/** One repository with no function report, and its cause. `ref` is the pin of the shared CI, when the cause is `old-ci`. */
export interface CoverageGap {
  readonly repo: string;
  readonly cause: CoverageCause;
  readonly ref?: string;
}

/** This function gives the cause of each current snapshot with no function report, from the facts of the catalog. */
export async function coverageGaps(q: CatalogQuery, template: string = TEMPLATE_REPO): Promise<CoverageGap[]> {
  const snapshots = await q.selectFrom("current_snapshot").select(["repo", "id", "commit"]).orderBy("repo").execute();
  const reported = new Set((await q.selectFrom("current_snapshot as s").innerJoin("coverage_function as c", "c.snapshot", "s.id").select("s.repo as repo").distinct().execute()).map((r) => r.repo));
  const runs = new Set((await q.selectFrom("current_snapshot as s").innerJoin("coverage_run as r", "r.snapshot", "s.id").select("s.repo as repo").distinct().execute()).map((r) => r.repo));
  const tested = new Set((await q.selectFrom("current_file").select("repo").where("test", "=", 1).distinct().execute()).map((r) => r.repo));
  const withV8 = new Set(
    (await q.selectFrom("current_manifest as m").innerJoin("dependency as d", "d.oid", "m.oid").select("m.repo as repo").where("d.name", "=", "@vitest/coverage-v8").distinct().execute()).map((r) => r.repo),
  );
  const pins = await q.selectFrom("current_template_pin").select(["repo", "ref"]).where("target", "=", SHARED_CI).execute();
  const head = snapshots.find((s) => s.repo === template);
  const versions = head === undefined ? [] : await q.selectFrom("template_version").select(["ref", "oid"]).where("snapshot", "=", head.id).where("path", "=", SHARED_CI).execute();
  const oidAt = new Map(versions.map((v) => [v.ref, v.oid]));
  const current = head?.commit == null ? undefined : oidAt.get(head.commit);
  const gaps: CoverageGap[] = [];
  for (const { repo } of snapshots) {
    if (reported.has(repo)) continue;
    const own = pins.filter((p) => p.repo === repo);
    const old = own.find((p) => current !== undefined && oidAt.get(p.ref) !== current);
    if (!tested.has(repo)) gaps.push({ repo, cause: "no-tests" });
    else if (!withV8.has(repo)) gaps.push({ repo, cause: "no-coverage-v8" });
    else if (runs.has(repo)) gaps.push({ repo, cause: "summary-only" });
    else if (own.length === 0) gaps.push({ repo, cause: "no-shared-ci" });
    else if (old !== undefined) gaps.push({ repo, cause: "old-ci", ref: old.ref });
    else gaps.push({ repo, cause: "no-artifact" });
  }
  return gaps;
}

/** The step that closes each cause, for the report. */
const NEXT_STEP: Readonly<Record<CoverageCause, string>> = {
  "no-tests": "Write tests.",
  "no-coverage-v8": "Add `@vitest/coverage-v8` at the range of Vitest. The sync of the template adds it.",
  "summary-only": "Add the reporter `json` to the coverage of Vitest.",
  "no-shared-ci": "Use the shared CI of the template, or upload an artifact `coverage` on `main`.",
  "old-ci": "Merge the sync of the template. It moves the pin of the shared CI.",
  "no-artifact": "Read the last CI run of `main`.",
};

/** This function writes the causes of the repositories with no function report as Markdown. */
export function coverageGapsMarkdown(gaps: readonly CoverageGap[]): string {
  if (gaps.length === 0) return "";
  const lines = ["### No function report", "", "| Cause | Repositories | Next step |", "| --- | --- | --- |"];
  for (const cause of Object.keys(NEXT_STEP) as CoverageCause[]) {
    const list = gaps.filter((g) => g.cause === cause);
    if (list.length > 0) lines.push(`| \`${cause}\` | ${list.map((g) => `\`${g.repo}\`${g.ref === undefined ? "" : ` (\`${g.ref.slice(0, 7)}\`)`}`).join(", ")} | ${NEXT_STEP[cause]} |`);
  }
  return `${lines.join("\n")}\n`;
}
