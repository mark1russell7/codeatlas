/**
 * The freshness of the index (CA21 of `docs/ROADMAP.md`). `git ls-remote` gives the head of each repository with no
 * clone. A repository with a new head goes to the next scan. A head that waits more than 6 hours fails the gate.
 */
import { execFileSync } from "node:child_process";
import { quantile } from "@mark1russell7/rigor-statistics";
import type { CatalogQuery } from "./query.ts";

/** A head that waits this number of hours or more for the index fails the freshness gate. */
export const FRESHNESS_HOURS: number = 6;

/** The days of the window of the delay from the commit to the index. */
export const DELAY_DAYS: number = 7;

const HOUR = 3_600_000;

/** The head of the default branch of one repository, or null when `git ls-remote` gives none. */
export interface RemoteHead {
  readonly repo: string;
  readonly head: string | null;
}

/** The commit of the newest snapshot of one repository. */
export interface IndexedHead {
  readonly repo: string;
  readonly commit: string | null;
  readonly scannedAt: string;
  readonly indexedAt: string | null;
}

/** The arguments of `git ls-remote` that give the head of the default branch of `owner/name`. */
export function lsRemoteArgs(owner: string, name: string): string[] {
  return ["ls-remote", "--", `https://github.com/${owner}/${name}.git`, "HEAD"];
}

/** This function reads the head from the output of `lsRemoteArgs`, or gives null. */
export function headOfLsRemote(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (ref === "HEAD" && sha !== undefined && /^[0-9a-f]{40}$/.test(sha)) return sha;
  }
  return null;
}

/** This function gives the head of each repository of `names`. A repository that `git ls-remote` cannot read gets null. */
export function remoteHeads(owner: string, names: readonly string[], run: (args: readonly string[]) => string = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })): RemoteHead[] {
  return names.map((repo) => {
    try {
      return { repo, head: headOfLsRemote(run(lsRemoteArgs(owner, repo))) };
    } catch {
      return { repo, head: null };
    }
  });
}

/** This function gives the commit of the newest snapshot of each repository of the catalog. */
export async function indexedHeads(q: CatalogQuery): Promise<Map<string, IndexedHead>> {
  const rows = await q.selectFrom("current_snapshot").select(["repo", "commit", "scanned_at", "indexed_at"]).execute();
  return new Map(rows.map((row) => [row.repo, { repo: row.repo, commit: row.commit, scannedAt: row.scanned_at, indexedAt: row.indexed_at }]));
}

/** This function gives the repositories with a head that the index does not have, sorted. A repository with no head is not one. */
export function changedRepos(heads: readonly RemoteHead[], indexed: ReadonlyMap<string, IndexedHead>): string[] {
  return heads
    .filter((h) => h.head !== null && indexed.get(h.repo)?.commit !== h.head)
    .map((h) => h.repo)
    .sort();
}

/** The freshness of one repository with a head that the index does not have. */
export interface BehindRepo {
  readonly repo: string;
  readonly head: string;
  /** The commit of the newest snapshot, or null when the repository is not in the catalog. */
  readonly indexed: string | null;
  /** The commit time of the head, or null when it is not known. */
  readonly committedAt: string | null;
  /** The hours from the commit time of the head to `now`, or null when it is not known. */
  readonly hours: number | null;
  /** True when the head waits `FRESHNESS_HOURS` or more, or when its time is not known. */
  readonly fails: boolean;
}

/**
 * This function gives each repository with a head that the index does not have, with its wait. `timeOf` gives the
 * commit time of a head. A head with no known time fails, because a wait that the check cannot read is not a pass.
 */
export function staleRepos(heads: readonly RemoteHead[], indexed: ReadonlyMap<string, IndexedHead>, now: string, timeOf: (repo: string, sha: string) => string | null, limit: number = FRESHNESS_HOURS): BehindRepo[] {
  const changed = new Set(changedRepos(heads, indexed));
  return heads.flatMap((h): BehindRepo[] => {
    if (h.head === null || !changed.has(h.repo)) return [];
    const committedAt = timeOf(h.repo, h.head);
    const hours = committedAt === null ? null : (Date.parse(now) - Date.parse(committedAt)) / HOUR;
    return [{ repo: h.repo, head: h.head, indexed: indexed.get(h.repo)?.commit ?? null, committedAt, hours, fails: hours === null || hours >= limit }];
  });
}

/** The delay from the commit to the index over a window of days. */
export interface DelayStats {
  readonly days: number;
  /** The commits of the window with a commit time and a first index time. */
  readonly commits: number;
  /** The median of the delay in hours, or null with no commit. */
  readonly median: number | null;
  /** The 95th percentile of the delay in hours, or null with no commit. */
  readonly p95: number | null;
}

/** This function gives the delay from the commit time to the first index of each commit of the last `days` before `now`. */
export async function delayStats(q: CatalogQuery, now: string, days: number = DELAY_DAYS): Promise<DelayStats> {
  const since = new Date(Date.parse(now) - days * 24 * HOUR).toISOString();
  const rows = await q.selectFrom("snapshot").select(["committed_at", "indexed_at"]).where("committed_at", "is not", null).where("indexed_at", "is not", null).execute();
  const delays = rows
    .filter((row) => row.committed_at !== null && row.indexed_at !== null && Date.parse(row.committed_at) >= Date.parse(since))
    .map((row) => Math.max(0, (Date.parse(row.indexed_at ?? "") - Date.parse(row.committed_at ?? "")) / HOUR));
  if (delays.length === 0) return { days, commits: 0, median: null, p95: null };
  return { days, commits: delays.length, median: quantile(delays, 0.5), p95: quantile(delays, 0.95) };
}

/** The report of the command `fresh`. */
export interface FreshReport {
  readonly at: string;
  readonly repos: number;
  /** The repositories that `git ls-remote` could not read. */
  readonly unread: readonly string[];
  readonly changed: readonly string[];
  readonly stale: readonly BehindRepo[];
  readonly delay: DelayStats;
}

const hoursText = (hours: number | null): string => (hours === null ? "not known" : `${Math.round(hours * 10) / 10} h`);

/** This function writes the report as Markdown. */
export function freshMarkdown(report: FreshReport, limit: number = FRESHNESS_HOURS): string {
  const failing = report.stale.filter((s) => s.fails);
  const lines = [
    "## Freshness of the index",
    "",
    `${report.repos} repositories, ${report.changed.length} with a head that the index does not have, ${failing.length} that wait ${limit} hours or more.`,
    "",
    `The delay from the commit to the index over ${report.delay.days} days: ${report.delay.commits} commits, median ${hoursText(report.delay.median)}, 95th percentile ${hoursText(report.delay.p95)}.`,
    "",
  ];
  if (report.unread.length > 0) lines.push(`\`git ls-remote\` could not read: ${report.unread.join(", ")}.`, "");
  if (report.stale.length > 0) {
    lines.push("| Repository | Head | Index | Wait | Gate |", "| --- | --- | --- | --- | --- |");
    for (const s of report.stale) lines.push(`| ${s.repo} | \`${s.head.slice(0, 7)}\` | ${s.indexed === null ? "not in the catalog" : `\`${s.indexed.slice(0, 7)}\``} | ${hoursText(s.hours)} | ${s.fails ? "fails" : "passes"} |`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
