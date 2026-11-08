/**
 * The roadmaps of a repository (Layer 1c of `docs/SCHEMA.md`): each `ROADMAP.md` that git keeps, with its items. The
 * parse comes from `roadmapItems` of `@mark1russell7/site-pages`, the reader of the Status page of each site.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { roadmapItems } from "@mark1russell7/site-pages";
import { treeOf, type TreeEntry } from "./blobs.ts";
import { MAX_BYTES } from "./scan.ts";

/** The class of the status of an item, as `site-pages` gives it. */
export type StatusClass = "waiting" | "blocked" | "progress" | "open" | "later" | "done";

/** One item of a roadmap. */
export interface RoadmapItemFact {
  readonly id: string;
  readonly title: string;
  /** The text of the Status cell, as the roadmap has it. */
  readonly status: string;
  readonly statusClass: StatusClass;
  /** The nearest heading above the table. */
  readonly section: string;
  readonly line: number;
  readonly area: string | null;
}

/** One roadmap of a repository: its path, its blob, and its items or the error of its parse. */
export interface RoadmapRecord {
  readonly path: string;
  readonly oid: string;
  readonly items: readonly RoadmapItemFact[] | null;
  readonly error: string | null;
}

const ROADMAP = /(^|\/)ROADMAP\.md$/i;

/** This function gives the items of one roadmap text. It throws when a table row does not parse. */
export function roadmapOf(markdown: string): RoadmapItemFact[] {
  return roadmapItems(markdown).map((item) => ({
    id: item.id,
    title: item.title,
    status: item.status,
    statusClass: item.statusClass,
    section: item.section,
    line: item.line,
    area: item.area ?? null,
  }));
}

/** This function gives each roadmap of the repository at `root`, with its items. */
export function roadmapsOfRepo(root: string, tree: readonly TreeEntry[] = treeOf(root)): RoadmapRecord[] {
  const records: RoadmapRecord[] = [];
  for (const entry of tree) {
    if (!ROADMAP.test(entry.path) || entry.bytes > MAX_BYTES) continue;
    try {
      records.push({ path: entry.path, oid: entry.blob, items: roadmapOf(readFileSync(join(root, entry.path), "utf8")), error: null });
    } catch (error) {
      records.push({ path: entry.path, oid: entry.blob, items: null, error: String(error instanceof Error ? error.message : error).split("\n")[0] ?? "" });
    }
  }
  return records;
}
