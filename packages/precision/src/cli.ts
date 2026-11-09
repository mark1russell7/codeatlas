#!/usr/bin/env node
/**
 * The command `codeatlas-precision`. It reads the index of the command `dimensions` and the clones of the scan. It
 * writes the precision of each dimension that has an independent tool.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { checkIndex, PRECISION_VERSION, precisionMarkdown, SAMPLE_SIZE, type CodeIndexFile } from "./check.ts";

const USAGE = `codeatlas-precision --index <dimensions.json> --repos-dir <folder> [--db <catalog.sqlite>] [--out precision.json] [--markdown precision.md] [--size ${SAMPLE_SIZE}] [--seed ${PRECISION_VERSION}]`;

/** This function reads the end of the churn window of each repository from the table `churn_run` of the catalog. */
export function churnWindows(db: string): Map<string, { until: string; days: number }> {
  const sqlite = new DatabaseSync(db, { readOnly: true });
  try {
    const rows = sqlite.prepare('SELECT DISTINCT f.repo AS repo, r."until" AS "until", r.days AS days FROM current_file f JOIN churn_run r ON r.snapshot = f.snapshot').all() as { repo: string; until: string; days: number }[];
    return new Map(rows.map((row) => [row.repo, { until: row.until, days: Number(row.days) }]));
  } finally {
    sqlite.close();
  }
}

/** This function starts the command with the arguments `argv`, and gives the exit code. */
export function main(argv: readonly string[]): number {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      index: { type: "string" },
      "repos-dir": { type: "string" },
      db: { type: "string" },
      out: { type: "string" },
      markdown: { type: "string" },
      size: { type: "string" },
      seed: { type: "string" },
    },
  });
  if (values.index === undefined || values["repos-dir"] === undefined) {
    console.error(USAGE);
    return 2;
  }
  const index = JSON.parse(readFileSync(values.index, "utf8")) as CodeIndexFile;
  const report = checkIndex(index, {
    reposDir: values["repos-dir"],
    seed: values.seed ?? PRECISION_VERSION,
    size: values.size === undefined ? SAMPLE_SIZE : Number(values.size),
    at: new Date().toISOString(),
    ...(values.db === undefined ? {} : { churnUntil: churnWindows(values.db) }),
  });
  if (values.out !== undefined) writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`);
  const markdown = precisionMarkdown(report);
  if (values.markdown !== undefined) writeFileSync(values.markdown, markdown);
  else process.stdout.write(markdown);
  const summary = report.checks.map((c) => `${c.dimension} ${c.agree}/${c.checked}`).join(", ");
  console.error(`precision: ${report.checks.filter((c) => c.counts).length} of ${report.checks.length} dimensions pass the gate (${summary})`);
  return 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
