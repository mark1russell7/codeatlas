/**
 * The lockfiles of a repository (Layer 1c of `docs/SCHEMA.md`): each `pnpm-lock.yaml` that git keeps, with the
 * resolved version of each dependency of each importer. The YAML parse comes from `@procedures/json`, the home of YAML.
 */
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { parseYaml } from "@procedures/json";
import { treeOf, type TreeEntry } from "./blobs.ts";

/** The fields of an importer of a lockfile that list the dependencies of the project. */
export const LOCK_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

/** The largest lockfile that the scan reads, in bytes. A lockfile is much larger than a source file. */
export const MAX_LOCK_BYTES: number = 20_000_000;

/** One resolved dependency of one importer of a lockfile. */
export interface ResolvedFact {
  /** The path of the `package.json` of the importer, from the folder of the lockfile: the facts depend on the blob only. */
  readonly manifest: string;
  readonly field: string;
  readonly name: string;
  readonly specifier: string;
  /** The version without its peer suffix: `0.2.0(@swc/core@1.16.20)` gives `0.2.0`. A `link:` stays as it is. */
  readonly version: string;
}

/** The facts of one lockfile text. */
export interface LockfileFacts {
  readonly version: string | null;
  readonly resolved: readonly ResolvedFact[];
}

/** One lockfile of a repository: its path, its blob, and its facts or the error of its parse. */
export interface LockfileRecord {
  readonly path: string;
  readonly oid: string;
  readonly facts: LockfileFacts | null;
  readonly error: string | null;
}

const LOCKFILE = /(^|\/)pnpm-lock\.yaml$/;

const objectOf = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** This function gives the version of a lockfile entry without its peer suffix. */
export function bareVersion(version: string): string {
  const paren = version.indexOf("(");
  return paren < 0 ? version : version.slice(0, paren);
}

/**
 * This function gives the facts of one `pnpm-lock.yaml` text. A lockfile of pnpm 11 or later has
 * two documents: the first has the tools of pnpm, and the second has the project. The function reads each one.
 */
export function lockfileOf(text: string): LockfileFacts {
  const documents = parseYaml(text, { all: true }) as unknown[];
  const resolved: ResolvedFact[] = [];
  let version: string | null = null;
  for (const document of documents) {
    const root = objectOf(document);
    if (root === undefined) continue;
    if (typeof root["lockfileVersion"] === "string") version = root["lockfileVersion"];
    for (const [importer, value] of Object.entries(objectOf(root["importers"]) ?? {})) {
      const manifest = posix.normalize(posix.join(importer, "package.json"));
      const entry = objectOf(value) ?? {};
      for (const field of LOCK_FIELDS) {
        for (const [name, dep] of Object.entries(objectOf(entry[field]) ?? {})) {
          const d = objectOf(dep);
          if (d === undefined || typeof d["version"] !== "string") continue;
          resolved.push({ manifest, field, name, specifier: typeof d["specifier"] === "string" ? d["specifier"] : "", version: bareVersion(d["version"]) });
        }
      }
    }
  }
  return { version, resolved };
}

/** This function gives each lockfile of a repository, in the order of the tree. The worktree must be a clean checkout of HEAD. */
export function lockfilesOfRepo(root: string, tree: readonly TreeEntry[] = treeOf(root)): LockfileRecord[] {
  const records: LockfileRecord[] = [];
  for (const entry of tree) {
    if (!LOCKFILE.test(entry.path) || entry.bytes > MAX_LOCK_BYTES) continue;
    try {
      records.push({ path: entry.path, oid: entry.blob, facts: lockfileOf(readFileSync(join(root, entry.path), "utf8")), error: null });
    } catch (error) {
      records.push({ path: entry.path, oid: entry.blob, facts: null, error: String(error instanceof Error ? error.message : error).split("\n")[0] ?? "" });
    }
  }
  return records;
}
