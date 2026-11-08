/**
 * The seeded sample of functions for the labels of Layer 2 (`docs/SCHEMA.md`, "Gates"). The sample is a file in
 * the repository, so a later catalog does not change it. Each label of a sample item measures the precision of a
 * judgment of its `renamed` class.
 */
import { random } from "@mark1russell7/rigor-generators";
import { sql } from "kysely";
import type { CatalogQuery } from "./query.ts";
import { CLASS_MIN_NODES } from "./summary.ts";

/** The version of the rules of the draw. A change of the rules gives a new version. */
export const SAMPLE_VERSION: string = "sample/1";

/** One function of the sample: the representative of one `renamed` class, at a fixed commit. */
export interface SampleItem {
  /** The `hash_renamed` of the function: the subject of a judgment and of its labels. */
  readonly subject: string;
  readonly repo: string;
  readonly commit: string | null;
  readonly path: string;
  readonly name: string;
  readonly line: number;
  readonly endLine: number;
  readonly nodes: number;
  /** The number of functions of the class in the current snapshots, outside tests. */
  readonly copies: number;
}

/**
 * This function gives the population of the sample, in the order of the subject. The population is one function
 * for each `renamed` class of exported functions outside tests, with `minNodes` nodes or more. The representative of
 * a class is its first function by repository, path and line.
 */
export async function populationOf(q: CatalogQuery, minNodes: number = CLASS_MIN_NODES): Promise<SampleItem[]> {
  const ranked = q
    .selectFrom("current_file as f")
    .innerJoin("current_snapshot as c", "c.id", "f.snapshot")
    .innerJoin("symbol as s", "s.blob", "f.blob")
    .where("f.test", "=", 0)
    .where("s.exported", "=", 1)
    .where("s.nodes", ">=", minNodes)
    .where("s.hash_renamed", "is not", null)
    .select([
      "s.hash_renamed as subject",
      "f.repo as repo",
      "c.commit as commit",
      "f.path as path",
      "s.qualified_name as name",
      "s.line as line",
      "s.end_line as endLine",
      "s.nodes as nodes",
      sql<number>`count(*) OVER (PARTITION BY s.hash_renamed)`.as("copies"),
      sql<number>`row_number() OVER (PARTITION BY s.hash_renamed ORDER BY f.repo, f.path, s.line, s.qualified_name)`.as("rank"),
    ])
    .as("r");
  const rows = await q.selectFrom(ranked).selectAll().where("rank", "=", 1).orderBy("subject").execute();
  return rows.map(({ rank: _rank, ...row }) => ({ ...row, subject: row.subject ?? "", nodes: row.nodes ?? 0, copies: Number(row.copies) }));
}

/**
 * This function draws `size` items of the population with the seed `seed`, in the order of the draw. A draw of a
 * larger size from the same population and seed starts with the items of a smaller one.
 */
export function drawSample(population: readonly SampleItem[], seed: string, size: number): SampleItem[] {
  return random(seed).sample(population, Math.min(size, population.length));
}
