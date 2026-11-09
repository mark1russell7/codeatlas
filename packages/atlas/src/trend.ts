/**
 * The trend of the catalog: one point for each build, with the measures of each repository. The history is a file
 * of the site. Each build reads the file of the last deploy and adds its point, so the history needs no cache.
 */
import { sql } from "kysely";
import { CLONE_LEVELS, type CloneLevel } from "./queries.ts";
import type { CatalogQuery } from "./query.ts";
import { CLASS_MIN_NODES } from "./summary.ts";

/** The version of the trend file. A change of a measure gives a new version. */
export const TREND_VERSION: string = "trend/1";

/** The measures of one repository at one point. */
export interface RepoPoint {
  readonly repo: string;
  readonly commit: string | null;
  /** The files outside tests. */
  readonly files: number;
  /** The functions outside tests. */
  readonly functions: number;
  /** The nodes of the functions outside tests with `CLASS_MIN_NODES` nodes or more. */
  readonly nodes: number;
  /**
   * The duplicated nodes of each level. A class keeps its first function by repository, path and line. Each other
   * function of the class adds its nodes to its repository.
   */
  readonly duplicated: Readonly<Record<CloneLevel, number>>;
}

/** The totals of all repositories at one point. A total names no repository. */
export interface PointTotals {
  readonly files: number;
  readonly functions: number;
  readonly nodes: number;
  readonly duplicated: Readonly<Record<CloneLevel, number>>;
}

/** One point of the trend: the current snapshot of each repository at one build. */
export interface TrendPoint {
  readonly at: string;
  readonly scanner: string;
  readonly repos: readonly RepoPoint[];
  /**
   * The totals of the point before the filter removed rows. A point without this field has its totals in the
   * sum of its rows.
   */
  readonly totals?: PointTotals;
  /** The value `true` tells that the filter removed the rows of repositories that are not public. */
  readonly filtered?: boolean;
}

/** The trend file: the points in the order of time, one for each day. */
export interface Trend {
  readonly version: string;
  readonly points: readonly TrendPoint[];
}

const column = (level: CloneLevel) => `s.hash_${level}` as const;

/** This function gives the point of the current snapshots, with the repositories in the order of their names. */
export async function trendPoint(q: CatalogQuery, at: string, scanner: string, minNodes: number = CLASS_MIN_NODES): Promise<TrendPoint> {
  const snapshots = await q.selectFrom("current_snapshot").select(["repo", "commit"]).orderBy("repo").execute();
  const files = await q
    .selectFrom("current_file")
    .where("test", "=", 0)
    .select(["repo", sql<number>`count(*)`.as("n")])
    .groupBy("repo")
    .execute();
  const functions = await q
    .selectFrom("current_file as f")
    .innerJoin("symbol as s", "s.blob", "f.blob")
    .where("f.test", "=", 0)
    .where("s.nodes", "is not", null)
    .select(["f.repo as repo", sql<number>`count(*)`.as("n"), sql<number>`sum(CASE WHEN s.nodes >= ${minNodes} THEN s.nodes ELSE 0 END)`.as("nodes")])
    .groupBy("f.repo")
    .execute();
  const duplicated = new Map<string, Record<CloneLevel, number>>();
  for (const level of CLONE_LEVELS) {
    const hash = column(level);
    const ranked = q
      .selectFrom("current_file as f")
      .innerJoin("symbol as s", "s.blob", "f.blob")
      .where("f.test", "=", 0)
      .where("s.nodes", ">=", minNodes)
      .where(hash, "is not", null)
      .select([
        "f.repo as repo",
        "s.nodes as nodes",
        sql<number>`row_number() OVER (PARTITION BY ${sql.ref(hash)} ORDER BY f.repo, f.path, s.line, s.qualified_name)`.as("rank"),
      ])
      .as("r");
    const rows = await q.selectFrom(ranked).where("rank", ">", 1).select(["repo", sql<number>`sum(nodes)`.as("n")]).groupBy("repo").execute();
    for (const row of rows) {
      const levels = duplicated.get(row.repo) ?? { exact: 0, renamed: 0, shape: 0 };
      levels[level] = Number(row.n);
      duplicated.set(row.repo, levels);
    }
  }
  const fileCount = new Map(files.map((row) => [row.repo, Number(row.n)]));
  const functionCount = new Map(functions.map((row) => [row.repo, row]));
  const repos = snapshots.map((snapshot): RepoPoint => {
    const fn = functionCount.get(snapshot.repo);
    return {
      repo: snapshot.repo,
      commit: snapshot.commit,
      files: fileCount.get(snapshot.repo) ?? 0,
      functions: Number(fn?.n ?? 0),
      nodes: Number(fn?.nodes ?? 0),
      duplicated: duplicated.get(snapshot.repo) ?? { exact: 0, renamed: 0, shape: 0 },
    };
  });
  return { at, scanner, repos };
}

/**
 * This function adds a point to a trend. A point of the same day (UTC) replaces the earlier one. A trend of a
 * different version is an error, so a build does not lose the history in silence.
 */
export function addPoint(previous: unknown, point: TrendPoint): Trend {
  let points: TrendPoint[] = [];
  if (previous !== undefined) {
    const trend = previous as Partial<Trend> | null;
    if (trend === null || typeof trend !== "object" || trend.version !== TREND_VERSION || !Array.isArray(trend.points)) {
      throw new Error(`The previous trend is not a trend of the version ${TREND_VERSION}.`);
    }
    points = [...trend.points];
  }
  const day = point.at.slice(0, 10);
  points = points.filter((each) => each.at.slice(0, 10) !== day);
  points.push(point);
  points.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return { version: TREND_VERSION, points };
}

/** This function gives the totals of a point: the totals that it keeps, or else the sum of its rows. */
export function pointTotals(point: TrendPoint): PointTotals {
  if (point.totals !== undefined) return point.totals;
  const sum = (measure: (repo: RepoPoint) => number): number => point.repos.reduce((total, repo) => total + measure(repo), 0);
  return {
    files: sum((repo) => repo.files),
    functions: sum((repo) => repo.functions),
    nodes: sum((repo) => repo.nodes),
    duplicated: { exact: sum((repo) => repo.duplicated.exact), renamed: sum((repo) => repo.duplicated.renamed), shape: sum((repo) => repo.duplicated.shape) },
  };
}

/**
 * This function removes the row of each repository that is not in `keep` from each point. A point that loses a
 * row keeps its totals from before the filter, and gets `filtered: true`. An empty `keep` is an error, because a
 * failed list of names does not empty the history.
 */
export function filterTrend(trend: Trend, keep: readonly string[]): Trend {
  if (keep.length === 0) throw new Error("The list of the public repositories is empty.");
  const names = new Set(keep);
  const points = trend.points.map((point): TrendPoint => {
    const repos = point.repos.filter((repo) => names.has(repo.repo));
    if (repos.length === point.repos.length) return point;
    return { ...point, repos, totals: pointTotals(point), filtered: true };
  });
  return { version: trend.version, points };
}
