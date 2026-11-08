/**
 * The scan of one repository into the catalog. The command `catalog` scans each repository with it, and the tool
 * `atlas.rescan` scans one repository again (CA16). The facts are keyed by the blob, so a rescan parses only new blobs.
 */
import { execFileSync } from "node:child_process";
import { factsOfRepo, treeOf, type ScanCounts } from "./blobs.ts";
import { FACTS_VERSION } from "./facts.ts";
import { lockfilesOfRepo } from "./lockfiles.ts";
import { manifestsOfRepo } from "./manifests.ts";
import { headOf } from "./scan.ts";
import type { Catalog } from "./store.ts";
import { TEMPLATE_REPO, templateRecordsOfRepo, type TemplateRecords } from "./templates.ts";

/** The result of the scan of one repository. */
export interface RepoScanResult {
  readonly snapshot: string;
  readonly commit: string | null;
  readonly records: TemplateRecords;
  readonly counts: ScanCounts;
}

/**
 * This function scans the repository `name` at the clean checkout `root` into the catalog. It writes its snapshot,
 * its manifests, its lockfiles and its template records. `keep` is the list of the files that the stamp copies.
 */
export function scanRepoInto(db: Catalog, name: string, root: string, keep: readonly string[], scannedAt: string): RepoScanResult {
  const tree = treeOf(root);
  const scan = factsOfRepo(name, root, db, tree);
  const commit = headOf(root);
  const snapshot = db.putSnapshot(name, commit, scannedAt, FACTS_VERSION, scan.files, scan.counts);
  db.putManifests(snapshot, manifestsOfRepo(root, tree));
  db.putLockfiles(snapshot, lockfilesOfRepo(root, tree));
  const records = templateRecordsOfRepo(root, keep, tree);
  db.putTemplateRecords(snapshot, records);
  return { snapshot, commit, records, counts: scan.counts };
}

/** The answer of `atlas.rescan`. */
export interface RescanResult {
  readonly repo: string;
  readonly commit: string | null;
  /** The commit of the snapshot before the rescan. */
  readonly before: string | null;
  readonly files: number;
  readonly parsed: number;
  readonly reused: number;
  readonly errors: number;
  readonly ms: number;
}

/** This function gives the name of the repository of the URL of a remote, for example `codeatlas` of `https://github.com/o/codeatlas.git`. */
export function repoOfRemote(url: string): string | undefined {
  const text = url.trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === "/") end--;
  const path = text.slice(0, end);
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf(":")) + 1);
  const bare = name.endsWith(".git") ? name.slice(0, -4) : name;
  return bare === "" ? undefined : bare;
}

const originOf = (root: string): string | undefined => {
  try {
    return execFileSync("git", ["-C", root, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
};

/**
 * This function scans the repository `repo` again from the clean checkout `root`. The repository must be in the
 * catalog, and the remote `origin` of the checkout must have its name. Thus a rescan cannot add a new repository.
 * The list `KEEP` comes from the template snapshot. The stamp check and the content of new pins wait for the next catalog run.
 */
export function rescanRepo(db: Catalog, repo: string, root: string, scannedAt: string = new Date().toISOString()): RescanResult {
  const before = db.db.prepare('SELECT "commit" AS "commit" FROM current_snapshot WHERE repo = ?').get(repo) as { commit: string | null } | undefined;
  if (before === undefined) throw new Error(`The repository ${repo} is not in the catalog. A rescan does not add a repository: the catalog job adds it.`);
  const origin = originOf(root);
  if (origin === undefined || repoOfRemote(origin) !== repo) throw new Error(`The checkout ${root} is not a clone of ${repo}: its remote origin is ${origin ?? "not set"}.`);
  const template = db.db.prepare("SELECT id FROM current_snapshot WHERE repo = ?").get(TEMPLATE_REPO) as { id: string } | undefined;
  const keep = (db.db.prepare("SELECT path FROM template_file WHERE snapshot = ? ORDER BY path").all(template?.id ?? "") as { path: string }[]).map((row) => row.path);
  const started = performance.now();
  const result = scanRepoInto(db, repo, root, keep, scannedAt);
  return {
    repo,
    commit: result.commit,
    before: before.commit,
    files: result.counts.files,
    parsed: result.counts.parsed,
    reused: result.counts.reused,
    errors: result.counts.errors,
    ms: Math.round(performance.now() - started),
  };
}
