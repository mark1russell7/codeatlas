/**
 * The queries of the dependencies of the current manifests and lockfiles. They give the ranges and the resolved
 * versions of each dependency over the repositories, and the dependencies that a registry cannot resolve.
 */
import type { CatalogQuery } from "./query.ts";
import type { RangeKind } from "./manifests.ts";

/** One manifest that lists a dependency. */
export interface DependencyPlace {
  readonly repo: string;
  readonly path: string;
  readonly field: string;
}

/** One range of a dependency, with the manifests that give it. */
export interface DependencyRange {
  readonly range: string;
  readonly kind: string;
  readonly places: readonly DependencyPlace[];
}

/** A dependency with two ranges or more over the current manifests. */
export interface RangeDrift {
  readonly name: string;
  readonly repos: number;
  readonly ranges: readonly DependencyRange[];
}

/** The kinds of range that do not resolve from the registry. A release of a package with such a range does not install. */
export const UNRESOLVED_KINDS: readonly RangeKind[] = ["github", "git", "file", "link", "url"];

/** One dependency with a range that does not resolve from the registry. */
export interface PinnedDependency extends DependencyPlace {
  readonly name: string;
  readonly range: string;
  readonly kind: string;
  /** The manifest has `"private": true`: no release reads it. */
  readonly private: boolean;
}

function rows(q: CatalogQuery) {
  return q
    .selectFrom("current_manifest as m")
    .innerJoin("dependency as d", "d.oid", "m.oid")
    .select(["m.repo as repo", "m.path as path", "m.private as private", "d.field as field", "d.name as name", "d.range as range", "d.kind as kind"]);
}

/**
 * This function gives each dependency with two ranges or more of the kinds `semver` and `tag`, the most ranges
 * first. A range of a workspace or of a git commit is not a version of the registry, so it is out.
 */
export async function rangeDrift(q: CatalogQuery): Promise<RangeDrift[]> {
  const list = await rows(q).where("d.kind", "in", ["semver", "tag"]).orderBy("name").orderBy("range").orderBy("repo").orderBy("path").execute();
  const byName = new Map<string, Map<string, { kind: string; places: DependencyPlace[] }>>();
  for (const row of list) {
    const ranges = byName.get(row.name) ?? new Map<string, { kind: string; places: DependencyPlace[] }>();
    const entry = ranges.get(row.range) ?? { kind: row.kind, places: [] };
    entry.places.push({ repo: row.repo, path: row.path, field: row.field });
    ranges.set(row.range, entry);
    byName.set(row.name, ranges);
  }
  const drift: RangeDrift[] = [];
  for (const [name, ranges] of byName) {
    if (ranges.size < 2) continue;
    const all = [...ranges].map(([range, entry]) => ({ range, kind: entry.kind, places: entry.places }));
    drift.push({ name, repos: new Set(all.flatMap((r) => r.places.map((p) => p.repo))).size, ranges: all });
  }
  return drift.sort((a, b) => b.ranges.length - a.ranges.length || b.repos - a.repos || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** This function gives each dependency whose range does not resolve from the registry, in the order of repository, path and name. */
export async function pinnedDependencies(q: CatalogQuery): Promise<PinnedDependency[]> {
  const list = await rows(q).where("d.kind", "in", [...UNRESOLVED_KINDS]).orderBy("repo").orderBy("path").orderBy("name").execute();
  return list.map((row) => ({ repo: row.repo, path: row.path, field: row.field, name: row.name, range: row.range, kind: row.kind, private: row.private === 1 }));
}

/** One resolved version of a dependency, with the manifests that resolve to it. */
export interface ResolvedVersion {
  readonly version: string;
  readonly places: readonly DependencyPlace[];
}

/** A dependency that the current lockfiles resolve to two versions or more. */
export interface VersionDrift {
  readonly name: string;
  readonly repos: number;
  readonly versions: readonly ResolvedVersion[];
}

/** A resolved version that is not a version of the registry: a workspace link or a local file. */
const LOCAL = /^(link|file|workspace):/;

/**
 * This function gives each dependency that the current lockfiles resolve to two versions or more, the most versions
 * first. The path of each manifest is from the root of the repository.
 */
export async function versionDrift(q: CatalogQuery): Promise<VersionDrift[]> {
  const list = await q
    .selectFrom("current_lockfile as l")
    .innerJoin("resolution as r", "r.oid", "l.oid")
    .select(["l.repo as repo", "l.path as lockfile", "r.manifest as manifest", "r.field as field", "r.name as name", "r.version as version"])
    .orderBy("name")
    .orderBy("version")
    .orderBy("repo")
    .orderBy("manifest")
    .execute();
  const byName = new Map<string, Map<string, DependencyPlace[]>>();
  for (const row of list) {
    if (LOCAL.test(row.version)) continue;
    const dir = row.lockfile.includes("/") ? row.lockfile.slice(0, row.lockfile.lastIndexOf("/") + 1) : "";
    const versions = byName.get(row.name) ?? new Map<string, DependencyPlace[]>();
    const places = versions.get(row.version) ?? [];
    places.push({ repo: row.repo, path: `${dir}${row.manifest}`, field: row.field });
    versions.set(row.version, places);
    byName.set(row.name, versions);
  }
  const drift: VersionDrift[] = [];
  for (const [name, versions] of byName) {
    if (versions.size < 2) continue;
    const all = [...versions].map(([version, places]) => ({ version, places }));
    drift.push({ name, repos: new Set(all.flatMap((v) => v.places.map((p) => p.repo))).size, versions: all });
  }
  return drift.sort((a, b) => b.versions.length - a.versions.length || b.repos - a.repos || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
