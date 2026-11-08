/**
 * The manifests of a repository (Layer 1c of `docs/SCHEMA.md`): each `package.json` that git keeps, with its
 * package and its dependencies. The dependencies of a manifest depend only on its blob, so the catalog keeps them
 * once for each blob.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { treeOf, type TreeEntry } from "./blobs.ts";
import { MAX_BYTES } from "./scan.ts";

/** The fields of a manifest that list dependencies. */
export const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

export type DependencyField = (typeof DEPENDENCY_FIELDS)[number];

/**
 * The kind of a range. `semver` is a version or a range of the registry, and `tag` is a dist-tag, for example `latest`.
 * `workspace`, `github`, `git`, `file`, `link`, `npm` (an alias) and `url` are values of their own.
 */
export type RangeKind = "semver" | "tag" | "workspace" | "github" | "git" | "file" | "link" | "npm" | "url";

/** One dependency of a manifest. */
export interface DependencyFact {
  readonly field: DependencyField;
  readonly name: string;
  readonly range: string;
  readonly kind: RangeKind;
}

/** The facts of one manifest text. */
export interface ManifestFacts {
  readonly name: string | null;
  readonly version: string | null;
  readonly private: boolean;
  readonly dependencies: readonly DependencyFact[];
}

/** One manifest of a repository: its path, its blob, and its facts or the error of its parse. */
export interface ManifestRecord {
  readonly path: string;
  readonly oid: string;
  readonly facts: ManifestFacts | null;
  readonly error: string | null;
}

const MANIFEST = /(^|\/)package\.json$/;
// Each part of these patterns has one way to match, so a long range cannot make them backtrack.
const SEMVER = /^[\s\d.xX*^~<>=|-]+$|^v?\d+\.\d+\.\d+(?:[-+][-+.\w]*)?$/;

/** This function gives the kind of a range of a dependency. */
export function rangeKind(range: string): RangeKind {
  if (range.startsWith("workspace:")) return "workspace";
  if (range.startsWith("github:") || /^[\w.-]+\/[\w.-]+(#.*)?$/.test(range)) return "github";
  if (/^git(\+[a-z]+)?:|^git@/.test(range) || range.endsWith(".git") || range.includes(".git#")) return "git";
  if (range.startsWith("file:")) return "file";
  if (range.startsWith("link:")) return "link";
  if (range.startsWith("npm:")) return "npm";
  if (/^https?:/.test(range)) return "url";
  return range === "" || SEMVER.test(range) ? "semver" : "tag";
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** This function gives the facts of one manifest text. It throws when the text is not a JSON object. */
export function manifestOf(source: string): ManifestFacts {
  const json: unknown = JSON.parse(source);
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new TypeError("The manifest is not a JSON object.");
  const record = json as Record<string, unknown>;
  const dependencies: DependencyFact[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const list = record[field];
    if (typeof list !== "object" || list === null || Array.isArray(list)) continue;
    for (const [name, range] of Object.entries(list as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (typeof range !== "string") continue;
      dependencies.push({ field, name, range, kind: rangeKind(range) });
    }
  }
  return { name: text(record["name"]), version: text(record["version"]), private: record["private"] === true, dependencies };
}

/** This function gives each manifest of a repository, in the order of the tree. The worktree must be a clean checkout of HEAD. */
export function manifestsOfRepo(root: string, tree: readonly TreeEntry[] = treeOf(root)): ManifestRecord[] {
  const records: ManifestRecord[] = [];
  for (const entry of tree) {
    if (!MANIFEST.test(entry.path) || entry.bytes > MAX_BYTES) continue;
    try {
      records.push({ path: entry.path, oid: entry.blob, facts: manifestOf(readFileSync(join(root, entry.path), "utf8")), error: null });
    } catch (error) {
      records.push({ path: entry.path, oid: entry.blob, facts: null, error: String(error instanceof Error ? error.message : error).split("\n")[0] ?? "" });
    }
  }
  return records;
}
