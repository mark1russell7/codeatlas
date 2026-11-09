/**
 * The churn of each file (CA20 of `docs/ROADMAP.md`): the commits of a window of days that changed the file. A shallow
 * clone has no history, so it gives no churn. The catalog clones each repository with no blobs of the history, but
 * with all of its commits and trees.
 */
import { execFileSync } from "node:child_process";

/** The days of the window of the churn, before the time of the scan. */
export const CHURN_DAYS: number = 90;

/** The churn of one file in the window. */
export interface FileChurn {
  readonly path: string;
  /** The commits of the window that changed the file. */
  readonly commits: number;
  /** The different authors of those commits. */
  readonly authors: number;
  /** The commit time of the last of those commits, as ISO 8601. */
  readonly lastAt: string;
}

const RECORD = "\x1e";
const FIELD = "\x1f";

/** This function gives the arguments of `git log` for the window that ends at `until`. */
export function churnLogArgs(root: string, until: string, days: number = CHURN_DAYS): string[] {
  const since = new Date(Date.parse(until) - days * 86_400_000).toISOString();
  return ["-C", root, "log", "HEAD", `--since=${since}`, `--until=${until}`, "--no-renames", "--no-merges", `--format=${RECORD}%H${FIELD}%aE${FIELD}%cI`, "--name-only"];
}

/** This function reads the output of `churnLogArgs` and gives the churn of each path of `paths`, sorted by path. */
export function churnOfLog(output: string, paths: ReadonlySet<string>): FileChurn[] {
  const byPath = new Map<string, { commits: number; authors: Set<string>; lastAt: string }>();
  for (const record of output.split(RECORD)) {
    const [header, ...names] = record.split(/\r?\n/);
    if (header === undefined || header.trim() === "") continue;
    const [, author = "", at = ""] = header.split(FIELD);
    for (const name of new Set(names.map((line) => line.trim()).filter((line) => line !== "" && paths.has(line)))) {
      const entry = byPath.get(name) ?? { commits: 0, authors: new Set<string>(), lastAt: "" };
      entry.commits++;
      entry.authors.add(author.toLowerCase());
      if (at > entry.lastAt) entry.lastAt = at;
      byPath.set(name, entry);
    }
  }
  return [...byPath.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, entry]) => ({ path, commits: entry.commits, authors: entry.authors.size, lastAt: entry.lastAt }));
}

/** This function tells if the clone at `root` has a cut history. */
export function isShallow(root: string): boolean {
  return execFileSync("git", ["-C", root, "rev-parse", "--is-shallow-repository"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() === "true";
}

/**
 * This function gives the churn of each file of `paths` in the clone at `root`, in the window that ends at `until`. It
 * gives null for a shallow clone, because its history is cut: a churn of 1 there is not a measure.
 */
export function churnOfRepo(root: string, paths: ReadonlySet<string>, until: string, days: number = CHURN_DAYS): FileChurn[] | null {
  if (isShallow(root)) return null;
  const output = execFileSync("git", churnLogArgs(root, until, days), { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  return churnOfLog(output, paths);
}
