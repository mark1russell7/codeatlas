/**
 * The scan of Layer 1a over repositories, keyed by the git blob id of each file. One blob in two repositories
 * (a template file, a copied helper) gets one parse. A cache from an earlier run makes a rescan read only new blobs.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { factsOf, syntaxOf, FACTS_VERSION, type FileFacts } from "./facts.ts";
import { headOf, isSource, MAX_BYTES, TEST } from "./scan.ts";

/** One file of the tree of a commit. */
export interface TreeEntry {
  readonly path: string;
  /** The git blob id: the SHA-1 of the bytes of the file, with the header of git. */
  readonly blob: string;
  readonly bytes: number;
}

/** One file of a repository in the catalog. */
export interface FileRecord {
  readonly repo: string;
  readonly path: string;
  readonly blob: string;
  readonly bytes: number;
  readonly test: boolean;
}

/** The facts of one blob, or the first line of the parse error. */
export type BlobFacts = { readonly ok: true; readonly facts: FileFacts } | { readonly ok: false; readonly error: string };

/** The key of the facts of a blob: the blob id, the syntax and the version of the facts. */
export function factsKey(blob: string, path: string): string {
  return `${blob}:${syntaxOf(path)}:${FACTS_VERSION}`;
}

/** The cache of the facts: a `Map`, or the catalog database (`Catalog` of `store.ts`). */
export interface FactsCache {
  has(key: string): boolean;
  set(key: string, value: BlobFacts): unknown;
}

/** The counts of one scan, for the cost gate: each blob that a parse read, and each blob that the cache gave. */
export interface ScanCounts {
  readonly files: number;
  readonly parsed: number;
  readonly reused: number;
  readonly errors: number;
  readonly bytesParsed: number;
}

/**
 * The files of the tree of HEAD, from `git ls-tree`. The blob id comes from git, so the scan hashes nothing.
 * A link (mode 120000) and a submodule (a commit) are not blobs of source: the function skips them. An empty
 * repository has no HEAD, so its tree is empty.
 */
export function treeOf(root: string): TreeEntry[] {
  if (headOf(root) === null) return [];
  const out = execFileSync("git", ["-C", root, "ls-tree", "-r", "-z", "--long", "HEAD"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const entries: TreeEntry[] = [];
  for (const line of out.split("\0")) {
    // <mode> SP <type> SP <object> SP+ <size> TAB <path>
    const match = /^(\d+) (\w+) ([0-9a-f]+) +(\S+)\t(.*)$/s.exec(line);
    if (match === null) continue;
    const [, mode, type, blob, size, path] = match as unknown as [string, string, string, string, string, string];
    if (type !== "blob" || mode === "120000") continue;
    entries.push({ path, blob, bytes: Number(size) });
  }
  return entries;
}

/**
 * This function gives the file records of the sources of one repository, and puts the facts of each new blob in
 * `cache`. The text of a blob comes from the worktree, which must be a clean checkout of HEAD.
 */
export function factsOfRepo(repo: string, root: string, cache: FactsCache, tree: readonly TreeEntry[] = treeOf(root)): { readonly files: FileRecord[]; readonly counts: ScanCounts } {
  const files: FileRecord[] = [];
  let parsed = 0;
  let reused = 0;
  let errors = 0;
  let bytesParsed = 0;
  for (const entry of tree) {
    if (!isSource(entry.path) || entry.bytes > MAX_BYTES) continue;
    files.push({ repo, path: entry.path, blob: entry.blob, bytes: entry.bytes, test: TEST.test(entry.path) });
    const key = factsKey(entry.blob, entry.path);
    if (cache.has(key)) {
      reused++;
      continue;
    }
    let result: BlobFacts;
    try {
      result = { ok: true, facts: factsOf(entry.path, readFileSync(join(root, entry.path), "utf8")) };
    } catch (error) {
      result = { ok: false, error: String(error instanceof Error ? error.message : error).split("\n")[0] ?? "" };
      errors++;
    }
    cache.set(key, result);
    parsed++;
    bytesParsed += entry.bytes;
  }
  return { files, counts: { files: files.length, parsed, reused, errors, bytesParsed } };
}

/** One line of the JSON Lines output of the `facts` command. */
export type FactsLine =
  | { readonly kind: "blob"; readonly key: string; readonly facts: BlobFacts }
  | ({ readonly kind: "file" } & FileRecord)
  | { readonly kind: "repo"; readonly repo: string; readonly commit: string | null; readonly counts: ScanCounts };

/** This function reads the blob lines of an earlier output into a cache. Lines of another version stay out. */
export function cacheOf(lines: Iterable<string>): Map<string, BlobFacts> {
  const cache = new Map<string, BlobFacts>();
  for (const line of lines) {
    if (line === "") continue;
    const record = JSON.parse(line) as FactsLine;
    if (record.kind === "blob" && record.key.endsWith(`:${FACTS_VERSION}`)) cache.set(record.key, record.facts);
  }
  return cache;
}
