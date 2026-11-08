/**
 * The first query set of the catalog: clone classes and their measures, importers, markers and complex functions.
 * Each query reads the current snapshot of each repository. A function of a test file is out of the clone classes.
 */
import { sql } from "kysely";
import type { CatalogQuery } from "./query.ts";
import { CLASS_MIN_NODES } from "./summary.ts";

/** A level of the chain of clone hashes. Each level forgets more than the level before it. */
export type CloneLevel = "exact" | "renamed" | "shape";

/** The levels of the chain, in order. */
export const CLONE_LEVELS: readonly CloneLevel[] = ["exact", "renamed", "shape"];

/** The options of a query of clone classes. */
export interface CloneOptions {
  /** The smallest function of a class, in syntax nodes. The default is `CLASS_MIN_NODES`. */
  readonly minNodes?: number;
  /** The most classes that the query gives. The default is 100. */
  readonly limit?: number;
}

/** One clone class: the functions with one hash at one level. */
export interface HashClass {
  readonly hash: string;
  readonly nodes: number;
  readonly copies: number;
  readonly repos: number;
  /** `nodes × (copies − 1)`: the nodes that one shared function removes. */
  readonly duplicatedNodes: number;
}

/** One function of the catalog, at its place in the current snapshot of its repository. */
export interface FunctionPlace {
  readonly repo: string;
  readonly path: string;
  readonly name: string;
  readonly line: number;
}

/** The duplication of one level. */
export interface LevelDuplication {
  readonly classes: number;
  readonly members: number;
  readonly duplicatedNodes: number;
}

/** The duplication measures of each level, and the nodes of the top functions. */
export interface Duplication {
  readonly levels: Readonly<Record<CloneLevel, LevelDuplication>>;
  /** The nodes of each function outside tests with `minNodes` nodes or more. */
  readonly topNodes: number;
  /** The duplicated nodes of each level, divided by `topNodes`. It is between 0 and 1. */
  readonly ratio: Readonly<Record<CloneLevel, number>>;
}

const column = (level: CloneLevel) => `s.hash_${level}` as const;

/** The top functions of the current snapshots: outside tests, with `minNodes` nodes or more. */
function topFunctions(q: CatalogQuery, minNodes: number) {
  return q
    .selectFrom("current_file as f")
    .innerJoin("symbol as s", "s.blob", "f.blob")
    .where("f.test", "=", 0)
    .where("s.nodes", ">=", minNodes);
}

/** This function gives the clone classes of one level, the largest duplication first. */
export async function cloneClasses(q: CatalogQuery, level: CloneLevel, options: CloneOptions = {}): Promise<HashClass[]> {
  const hash = column(level);
  const rows = await topFunctions(q, options.minNodes ?? CLASS_MIN_NODES)
    .where(hash, "is not", null)
    .select([
      `${hash} as hash`,
      sql<number>`max(s.nodes)`.as("nodes"),
      sql<number>`count(*)`.as("copies"),
      sql<number>`count(DISTINCT f.repo)`.as("repos"),
    ])
    .groupBy(hash)
    .having(sql`count(*)`, ">", 1)
    .orderBy(sql`max(s.nodes) * (count(*) - 1)`, "desc")
    .orderBy("hash")
    .limit(options.limit ?? 100)
    .execute();
  return rows.map((row) => ({
    hash: row.hash ?? "",
    nodes: Number(row.nodes),
    copies: Number(row.copies),
    repos: Number(row.repos),
    duplicatedNodes: Number(row.nodes) * (Number(row.copies) - 1),
  }));
}

/** This function gives the functions of one clone class, in the order of repository, path and line. */
export async function membersOf(q: CatalogQuery, level: CloneLevel, hash: string, options: CloneOptions = {}): Promise<FunctionPlace[]> {
  return topFunctions(q, options.minNodes ?? CLASS_MIN_NODES)
    .where(column(level), "=", hash)
    .select(["f.repo as repo", "f.path as path", "s.qualified_name as name", "s.line as line"])
    .orderBy("repo")
    .orderBy("path")
    .orderBy("line")
    .execute();
}

/**
 * This function gives the copies of one function at one level, the function itself not included. An empty list
 * tells that the function has no copy outside tests in the current snapshots.
 */
export async function copiesOf(q: CatalogQuery, place: Omit<FunctionPlace, "line">, level: CloneLevel): Promise<FunctionPlace[]> {
  const subject = await q
    .selectFrom("current_file as f")
    .innerJoin("symbol as s", "s.blob", "f.blob")
    .where("f.repo", "=", place.repo)
    .where("f.path", "=", place.path)
    .where("s.qualified_name", "=", place.name)
    .select(column(level))
    .executeTakeFirst();
  const hash = subject?.[`hash_${level}`];
  if (hash === undefined || hash === null) return [];
  const members = await membersOf(q, level, hash, { minNodes: 0 });
  return members.filter((member) => !(member.repo === place.repo && member.path === place.path && member.name === place.name));
}

/**
 * This function gives the duplication measures of each level. By the law of the chain, the duplicated nodes of a
 * level are at most those of the next level: `exact ≤ renamed ≤ shape`.
 */
export async function duplication(q: CatalogQuery, options: Pick<CloneOptions, "minNodes"> = {}): Promise<Duplication> {
  const minNodes = options.minNodes ?? CLASS_MIN_NODES;
  const levels = {} as Record<CloneLevel, LevelDuplication>;
  for (const level of CLONE_LEVELS) {
    const hash = column(level);
    const classes = topFunctions(q, minNodes)
      .where(hash, "is not", null)
      .select([sql<number>`max(s.nodes)`.as("nodes"), sql<number>`count(*)`.as("copies")])
      .groupBy(hash)
      .having(sql`count(*)`, ">", 1)
      .as("c");
    const row = await q
      .selectFrom(classes)
      .select([
        sql<number>`count(*)`.as("classes"),
        sql<number>`coalesce(sum(c.copies), 0)`.as("members"),
        sql<number>`coalesce(sum(c.nodes * (c.copies - 1)), 0)`.as("duplicated"),
      ])
      .executeTakeFirstOrThrow();
    levels[level] = { classes: Number(row.classes), members: Number(row.members), duplicatedNodes: Number(row.duplicated) };
  }
  const top = await topFunctions(q, minNodes).select(sql<number>`coalesce(sum(s.nodes), 0)`.as("nodes")).executeTakeFirstOrThrow();
  const topNodes = Number(top.nodes);
  const ratio = {} as Record<CloneLevel, number>;
  for (const level of CLONE_LEVELS) ratio[level] = topNodes === 0 ? 0 : levels[level].duplicatedNodes / topNodes;
  return { levels, topNodes, ratio };
}

/** One import of a specifier. */
export interface ImportPlace {
  readonly repo: string;
  readonly path: string;
  readonly line: number;
  readonly kind: string;
}

/** This function gives each import of `specifier` in the current snapshots, test files included. */
export async function importersOf(q: CatalogQuery, specifier: string): Promise<ImportPlace[]> {
  return q
    .selectFrom("current_file as f")
    .innerJoin("import as i", "i.blob", "f.blob")
    .where("i.specifier", "=", specifier)
    .select(["f.repo as repo", "f.path as path", "i.line as line", "i.kind as kind"])
    .orderBy("repo")
    .orderBy("path")
    .orderBy("line")
    .execute();
}

/** The count of one kind of marker in one repository. */
export interface MarkerCount {
  readonly repo: string;
  readonly kind: string;
  readonly count: number;
}

/** This function gives the count of each kind of marker in each repository, test files included. */
export async function markerCounts(q: CatalogQuery): Promise<MarkerCount[]> {
  const rows = await q
    .selectFrom("current_file as f")
    .innerJoin("marker as m", "m.blob", "f.blob")
    .select(["f.repo as repo", "m.kind as kind", sql<number>`count(*)`.as("count")])
    .groupBy(["f.repo", "m.kind"])
    .orderBy("repo")
    .orderBy("kind")
    .execute();
  return rows.map((row) => ({ repo: row.repo, kind: row.kind, count: Number(row.count) }));
}

/** One function with its measures of complexity. */
export interface ComplexFunction extends FunctionPlace {
  readonly cyclomatic: number;
  readonly depth: number;
  readonly nodes: number;
}

/** This function gives the functions outside tests with a cyclomatic complexity of `min` or more, the largest first. */
export async function complexFunctions(q: CatalogQuery, min: number, limit = 100): Promise<ComplexFunction[]> {
  const rows = await q
    .selectFrom("current_file as f")
    .innerJoin("symbol as s", "s.blob", "f.blob")
    .where("f.test", "=", 0)
    .where("s.cyclomatic", ">=", min)
    .select(["f.repo as repo", "f.path as path", "s.qualified_name as name", "s.line as line", "s.cyclomatic as cyclomatic", "s.depth as depth", "s.nodes as nodes"])
    .orderBy("cyclomatic", "desc")
    .orderBy("repo")
    .orderBy("path")
    .orderBy("line")
    .limit(limit)
    .execute();
  return rows.map((row) => ({ ...row, cyclomatic: row.cyclomatic ?? 0, depth: row.depth ?? 0, nodes: row.nodes ?? 0 }));
}
