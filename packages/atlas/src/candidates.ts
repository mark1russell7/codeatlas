/**
 * The home candidates: for each home of the map of homes (`@mark1russell7/conventions`), the functions outside the
 * home whose names are signatures of the home. An import of the home removes each of them. The rule of a signature
 * is `homeOf` of the atlas, the rule home-package of conventions.
 */
import { homeOf } from "./atlas.ts";
import type { FunctionPlace } from "./queries.ts";
import type { CatalogQuery } from "./query.ts";

/** One function outside its home. */
export interface HomeCopy extends FunctionPlace {
  readonly nodes: number;
  readonly exported: boolean;
  /** The shape hash of the function: the copies with one shape hash are one clone class. */
  readonly shape: string | null;
}

/** The functions of one home that are outside it. */
export interface HomeCandidate {
  readonly area: string;
  readonly title: string;
  /** The packages of the home, or its repository when the home has no package. */
  readonly home: readonly string[];
  readonly repo: string;
  readonly state: string;
  readonly repos: readonly string[];
  readonly copies: readonly HomeCopy[];
  /** The nodes of each copy: the size that the imports of the home remove. */
  readonly nodes: number;
  /** The shape hashes with two copies or more: the clone classes that one function of the home replaces. */
  readonly classes: number;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * This function gives the home candidates of the current snapshots, the most nodes first. Each function and method
 * outside tests counts, of any size: one copy of a function of a home is one too many.
 */
export async function homeCandidates(q: CatalogQuery): Promise<HomeCandidate[]> {
  const rows = await q
    .selectFrom("current_file as f")
    .innerJoin("symbol as s", "s.blob", "f.blob")
    .where("f.test", "=", 0)
    .where("s.kind", "in", ["function", "method"])
    .select(["f.repo as repo", "f.path as path", "s.name as simple", "s.qualified_name as name", "s.line as line", "s.nodes as nodes", "s.exported as exported", "s.hash_shape as shape"])
    .orderBy("repo")
    .orderBy("path")
    .orderBy("line")
    .execute();
  const groups = new Map<string, { home: NonNullable<ReturnType<typeof homeOf>>; copies: HomeCopy[] }>();
  for (const row of rows) {
    const home = homeOf(row.simple, row.repo);
    if (home === undefined) continue;
    const group = groups.get(home.area) ?? { home, copies: [] };
    group.copies.push({ repo: row.repo, path: row.path, name: row.name, line: row.line, nodes: row.nodes ?? 0, exported: row.exported === 1, shape: row.shape });
    groups.set(home.area, group);
  }
  return [...groups.values()]
    .map(({ home, copies }): HomeCandidate => {
      const shapes = new Map<string, number>();
      for (const copy of copies) if (copy.shape !== null) shapes.set(copy.shape, (shapes.get(copy.shape) ?? 0) + 1);
      return {
        area: home.area,
        title: home.title,
        home: home.packages.length === 0 ? [home.repo] : [...home.packages],
        repo: home.repo,
        state: home.state,
        repos: [...new Set(copies.map((copy) => copy.repo))].sort(byText),
        copies,
        nodes: copies.reduce((sum, copy) => sum + copy.nodes, 0),
        classes: [...shapes.values()].filter((count) => count > 1).length,
      };
    })
    .sort((a, b) => b.nodes - a.nodes || b.repos.length - a.repos.length || byText(a.area, b.area));
}
