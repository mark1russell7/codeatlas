/**
 * The summary of a run of Layer 1a: the counts, the cost and the clone classes of each level. It also checks the
 * law of the chain over the whole corpus. A break of the law makes the command fail.
 */
import { factsKey, type BlobFacts, type FileRecord, type ScanCounts } from "./blobs.ts";
import type { MarkerKind } from "./facts.ts";

/** The smallest function, in nodes, that a clone class counts. The atlas of `codeatlas/1` uses the same limit. */
export const CLASS_MIN_NODES = 40;

export interface FactsSummary {
  readonly repos: number;
  readonly files: number;
  readonly parsed: number;
  readonly reused: number;
  readonly errors: number;
  readonly bytesParsed: number;
  readonly ms: number;
  readonly symbols: number;
  readonly functions: number;
  readonly callSites: number;
  readonly imports: number;
  readonly exports: number;
  readonly markers: Readonly<Partial<Record<MarkerKind, number>>>;
  /** For each level: the classes of two or more functions of `CLASS_MIN_NODES` nodes or more, and the functions in them. */
  readonly classes: Readonly<Record<"exact" | "renamed" | "shape", { readonly classes: number; readonly members: number }>>;
  /** The hashes that break the law: an exact hash with two renamed hashes, or a renamed hash with two shape hashes. */
  readonly lawBreaks: number;
}

/** This function gives the summary of the scans of a run, with the facts of the cache. */
export function factsSummary(scans: readonly { readonly files: readonly FileRecord[]; readonly counts: ScanCounts }[], cache: ReadonlyMap<string, BlobFacts>, ms: number): FactsSummary {
  const sum = (field: keyof ScanCounts): number => scans.reduce((total, scan) => total + scan.counts[field], 0);
  let symbols = 0;
  let functions = 0;
  let callSites = 0;
  let imports = 0;
  let exports = 0;
  const markers: Partial<Record<MarkerKind, number>> = {};
  const groups = { exact: new Map<string, number>(), renamed: new Map<string, number>(), shape: new Map<string, number>() };
  const up = { exact: new Map<string, Set<string>>(), renamed: new Map<string, Set<string>>() };
  const add = (map: Map<string, Set<string>>, key: string, value: string): void => {
    const set = map.get(key) ?? new Set<string>();
    set.add(value);
    map.set(key, set);
  };
  for (const scan of scans) {
    for (const file of scan.files) {
      const entry = cache.get(factsKey(file.blob, file.path));
      if (entry === undefined || !entry.ok) continue;
      const { facts } = entry;
      symbols += facts.symbols.length;
      callSites += facts.callSites.length;
      imports += facts.imports.length;
      exports += facts.exports.length;
      for (const marker of facts.markers) markers[marker.kind] = (markers[marker.kind] ?? 0) + 1;
      for (const symbol of facts.symbols) {
        const fn = symbol.fn;
        if (fn === null) continue;
        functions++;
        add(up.exact, fn.hashExact, fn.hashRenamed);
        add(up.renamed, fn.hashRenamed, fn.hashShape);
        // A class counts the test code out, as the atlas does
        if (fn.nodes < CLASS_MIN_NODES || file.test) continue;
        for (const [level, hash] of [["exact", fn.hashExact], ["renamed", fn.hashRenamed], ["shape", fn.hashShape]] as const) {
          groups[level].set(hash, (groups[level].get(hash) ?? 0) + 1);
        }
      }
    }
  }
  const classesOf = (map: ReadonlyMap<string, number>) => {
    const sizes = [...map.values()].filter((size) => size >= 2);
    return { classes: sizes.length, members: sizes.reduce((total, size) => total + size, 0) };
  };
  const breaks = (map: ReadonlyMap<string, ReadonlySet<string>>): number => [...map.values()].filter((set) => set.size > 1).length;
  return {
    repos: scans.length,
    files: sum("files"),
    parsed: sum("parsed"),
    reused: sum("reused"),
    errors: sum("errors"),
    bytesParsed: sum("bytesParsed"),
    ms,
    symbols,
    functions,
    callSites,
    imports,
    exports,
    markers,
    classes: { exact: classesOf(groups.exact), renamed: classesOf(groups.renamed), shape: classesOf(groups.shape) },
    lawBreaks: breaks(up.exact) + breaks(up.renamed),
  };
}

const n = (value: number): string => value.toLocaleString("en-US");

/** The summary as a Markdown section, for the summary of a CI step. */
export function factsMarkdown(summary: FactsSummary): string {
  const mb = summary.bytesParsed / 1_000_000;
  const rows = [
    ["Repositories", n(summary.repos)],
    ["Source files", n(summary.files)],
    ["Blobs parsed", n(summary.parsed)],
    ["Blobs from the cache or a second copy", n(summary.reused)],
    ["Parse errors", n(summary.errors)],
    ["Time", `${(summary.ms / 1000).toFixed(1)} s (${mb > 0 ? Math.round(summary.ms / mb) : 0} ms for each MB parsed)`],
    ["Symbols", n(summary.symbols)],
    ["Functions", n(summary.functions)],
    ["Call sites", n(summary.callSites)],
    ["Imports", n(summary.imports)],
    ["Exports", n(summary.exports)],
    ["Breaks of the law of the chain", n(summary.lawBreaks)],
  ];
  const levels = (["exact", "renamed", "shape"] as const).map((level) => `| ${level} | ${n(summary.classes[level].classes)} | ${n(summary.classes[level].members)} |`);
  const markers = Object.entries(summary.markers)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([kind, count]) => `| ${kind} | ${n(count ?? 0)} |`);
  return [
    "## Layer 1a facts",
    "",
    "| Measure | Value |",
    "| --- | --- |",
    ...rows.map(([name, value]) => `| ${name} | ${value} |`),
    "",
    `### Clone classes (functions of ${CLASS_MIN_NODES} nodes or more, no tests)`,
    "",
    "| Level | Classes | Functions |",
    "| --- | --- | --- |",
    ...levels,
    "",
    "### Markers",
    "",
    "| Kind | Count |",
    "| --- | --- |",
    ...markers,
    "",
  ].join("\n");
}
