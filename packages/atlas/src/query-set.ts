/**
 * The answers of the query set, as one file for the site. The file has the duplication of each level, the exact
 * copies with their functions, the complex functions and the markers of each repository. It also has the copies
 * outside their homes. Each function has its repository and path, and the file has the commit of each repository, so
 * each finding links to its code.
 */
import { cloneClasses, complexFunctions, duplication, markerCounts, membersOf, type ComplexFunction, type Duplication, type FunctionPlace, type HashClass, type MarkerCount } from "./queries.ts";
import type { CatalogQuery } from "./query.ts";
import { homeCandidates, type HomeCandidate } from "./candidates.ts";

/** The version of the query-set file. A change of a query or of a limit gives a new version. */
export const QUERY_SET_VERSION: string = "queries/2";

/** The limits of the query set. */
export interface QuerySetLimits {
  /** The most exact classes in the file. */
  readonly exactClasses: number;
  /** The smallest cyclomatic complexity of a complex function. */
  readonly complexMin: number;
  /** The most complex functions in the file. */
  readonly complexLimit: number;
}

/** The limits of the site. A complexity of 15 or more is high in most style guides. */
export const QUERY_SET_LIMITS: QuerySetLimits = { exactClasses: 25, complexMin: 15, complexLimit: 100 };

/** One exact class with its functions. */
export interface ExactClass extends HashClass {
  readonly members: readonly FunctionPlace[];
}

/** The repository and the commit that the scan read. */
export interface RepoCommit {
  readonly repo: string;
  readonly commit: string | null;
}

/** The query-set file. */
export interface QuerySet {
  readonly version: string;
  readonly at: string;
  readonly scanner: string;
  readonly limits: QuerySetLimits;
  readonly repos: readonly RepoCommit[];
  readonly duplication: Duplication;
  /** The exact classes, the largest duplication first: the same code, character for character after the format. */
  readonly exact: readonly ExactClass[];
  /** The functions outside their homes of the map of homes, for each home, the most nodes first. */
  readonly homes: readonly HomeCandidate[];
  readonly complex: readonly ComplexFunction[];
  readonly markers: readonly MarkerCount[];
}

/** This function gives the answers of the query set over the current snapshots. */
export async function querySet(q: CatalogQuery, at: string, scanner: string, limits: QuerySetLimits = QUERY_SET_LIMITS): Promise<QuerySet> {
  const repos = await q.selectFrom("current_snapshot").select(["repo", "commit"]).orderBy("repo").execute();
  const classes = await cloneClasses(q, "exact", { limit: limits.exactClasses });
  const exact: ExactClass[] = [];
  for (const c of classes) exact.push({ ...c, members: await membersOf(q, "exact", c.hash) });
  return {
    version: QUERY_SET_VERSION,
    at,
    scanner,
    limits,
    repos,
    duplication: await duplication(q),
    exact,
    homes: await homeCandidates(q),
    complex: await complexFunctions(q, limits.complexMin, limits.complexLimit),
    markers: await markerCounts(q),
  };
}
