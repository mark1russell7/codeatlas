/**
 * The seeded sample of functions for the labels of Layer 2 (`docs/SCHEMA.md`, "Gates"). The sample is a file in
 * the repository, so a later catalog does not change it. Each label of a sample item measures the precision of a
 * judgment of its `renamed` class.
 */
import { random } from "@mark1russell7/rigor-generators";
import { wilsonSampleSize } from "@mark1russell7/rigor-statistics";
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

/** The precision target of one task of Layer 2, and the precision that the pilot expects. */
export interface TaskTarget {
  readonly task: string;
  readonly target: number;
  readonly expected: number;
}

/** A task with its sample size: the smallest `n` at which the Wilson 95 % lower end reaches the target. */
export interface SizedTask extends TaskTarget {
  readonly n: number;
}

/** The sample file of the repository: the draw, its rules and the size of each task. */
export interface SampleFile {
  readonly version: string;
  readonly seed: string;
  /** The rule that gives each `n`. */
  readonly rule: string;
  readonly tasks: readonly SizedTask[];
  readonly population: number;
  readonly size: number;
  readonly items: readonly SampleItem[];
}

const RULE =
  "n = wilsonSampleSize(target, expected) of @mark1russell7/rigor-statistics: the smallest n at which the Wilson 95 % lower end of round(expected * n) of n reaches the target";

/** This function gives the size of each task from its target, with `wilsonSampleSize`. */
export function sizedTasks(tasks: readonly TaskTarget[]): SizedTask[] {
  return tasks.map((task) => {
    const n = wilsonSampleSize(task.target, task.expected);
    if (n === undefined) throw new RangeError(`The task ${task.task} has an expected precision ${task.expected} that is not above its target ${task.target}.`);
    return { ...task, n };
  });
}

/**
 * This function gives the sample file. Its size is the larger of `size` and the largest `n` of the tasks, so one
 * sample serves each task.
 */
export function sampleFile(population: readonly SampleItem[], seed: string, tasks: readonly TaskTarget[], size = 0): SampleFile {
  const sized = sizedTasks(tasks);
  const want = Math.max(size, ...sized.map((task) => task.n));
  if (want > population.length) throw new RangeError(`The sample needs ${want} items, and the population has ${population.length}.`);
  const items = drawSample(population, seed, want);
  return { version: SAMPLE_VERSION, seed, rule: RULE, tasks: sized, population: population.length, size: items.length, items };
}

/**
 * This function gives the items of the audit of a person: a seeded draw of `size` subjects of `agreed`, in the order
 * of the draw. The stream of the audit is a fork of the stream of the sample, so the two draws do not share numbers.
 */
export function auditOf(agreed: readonly string[], seed: string, size: number): string[] {
  const sorted = [...agreed].sort();
  return random(seed).fork("audit").sample(sorted, Math.min(size, sorted.length));
}
