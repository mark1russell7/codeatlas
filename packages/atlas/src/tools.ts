/**
 * The tools of agents over the catalog (CA16) are typed procedures of `@procedures/client`. They answer questions of the
 * catalog, so an agent asks the catalog in place of reading the code again. `codeatlas mcp` serves them as MCP
 * tools, and `codeatlas tool` calls one of them from the command line. Each tool reads the catalog and changes nothing,
 * except `atlas.rescan`. It is only in the package when the host gives a catalog that it can write.
 */
import { createProcedure, definePackage, type Effects, type PackageDefinition } from "@procedures/client";
import { sql } from "kysely";
import * as z from "zod";
import { homeOf } from "./atlas.ts";
import { homeCandidates, type HomeCandidate } from "./candidates.ts";
import { CLONE_LEVELS, copiesOf, importersOf, type CloneLevel, type FunctionPlace, type ImportPlace } from "./queries.ts";
import type { CatalogQuery } from "./query.ts";
import { rescanRepo, type RescanResult } from "./rescan.ts";
import type { Catalog } from "./store.ts";

/** The effects of each tool: it reads the catalog and changes nothing. */
export const CATALOG_READ_EFFECTS: Effects = Object.freeze({ reads: Object.freeze(["catalog"]), writes: Object.freeze([]), idempotent: true, destructive: false });

/** The effects of `atlas.rescan`: it reads a checkout and writes the catalog. A second call with no new commit changes nothing. */
export const CATALOG_WRITE_EFFECTS: Effects = Object.freeze({ reads: Object.freeze(["catalog", "fs"]), writes: Object.freeze(["catalog"]), idempotent: true, destructive: false });

/** The most rows that one answer of a tool gives. A larger answer costs the tokens of the agent. */
export const TOOL_ROW_LIMIT = 200;

/** One repository of the catalog, with its current snapshot. */
export interface CatalogRepo {
  readonly repo: string;
  readonly commit: string | null;
  readonly scannedAt: string;
  readonly files: number;
}

/** The copies of a function outside tests at each clone level, the function itself not included. */
export interface CopyCounts {
  readonly exact: number;
  readonly renamed: number;
  readonly shape: number;
}

/** One function that `atlas.find` gives. */
export interface FoundFunction extends FunctionPlace {
  readonly endLine: number;
  readonly kind: string;
  readonly exported: boolean;
  readonly test: boolean;
  readonly nodes: number | null;
  readonly copies: CopyCounts;
  /** The home of the map of homes whose signature the name has, when the repository is not that home. */
  readonly home: { readonly area: string; readonly title: string; readonly packages: readonly string[] } | null;
}

/** The kinds of match of a name for `atlas.find`. */
export const NAME_MATCHES = ["exact", "prefix", "contains"] as const;

export type NameMatch = (typeof NAME_MATCHES)[number];

/** The options of `findFunctions`. */
export interface FindOptions {
  readonly match?: NameMatch | undefined;
  readonly repo?: string | undefined;
  readonly limit?: number | undefined;
}

const HASH = { exact: "s.hash_exact", renamed: "s.hash_renamed", shape: "s.hash_shape" } as const;

/** This function gives the copies outside tests of each hash of one level, in one query. */
async function classSizes(q: CatalogQuery, level: CloneLevel, hashes: readonly string[]): Promise<Map<string, number>> {
  if (hashes.length === 0) return new Map();
  const rows = await q
    .selectFrom("current_file as f")
    .innerJoin("symbol as s", "s.blob", "f.blob")
    .where("f.test", "=", 0)
    .where(HASH[level], "in", [...hashes])
    .select([`${HASH[level]} as hash`, (eb) => eb.fn.countAll<number>().as("n")])
    .groupBy(HASH[level])
    .execute();
  return new Map(rows.map((row) => [String(row.hash), Number(row.n)]));
}

/**
 * This function gives the functions and methods whose name matches `name`, with their copies at each clone level and
 * the home of their name. The order is repository, path and line.
 */
export async function findFunctions(q: CatalogQuery, name: string, options: FindOptions = {}): Promise<FoundFunction[]> {
  const match = options.match ?? "exact";
  let query = q
    .selectFrom("current_file as f")
    .innerJoin("symbol as s", "s.blob", "f.blob")
    .where("s.kind", "in", ["function", "method"]);
  if (match === "exact") query = query.where("s.name", "=", name);
  else if (match === "prefix") query = query.where(sql<number>`substr(s.name, 1, ${name.length}) = ${name}`, "=", 1);
  else query = query.where(sql<number>`instr(s.name, ${name})`, ">", 0);
  if (options.repo !== undefined) query = query.where("f.repo", "=", options.repo);
  const rows = await query
    .select([
      "f.repo as repo",
      "f.path as path",
      "f.test as test",
      "s.qualified_name as name",
      "s.line as line",
      "s.end_line as endLine",
      "s.kind as kind",
      "s.exported as exported",
      "s.nodes as nodes",
      "s.hash_exact as exact",
      "s.hash_renamed as renamed",
      "s.hash_shape as shape",
    ])
    .orderBy("repo")
    .orderBy("path")
    .orderBy("line")
    .limit(Math.min(options.limit ?? 50, TOOL_ROW_LIMIT))
    .execute();
  const sizes = new Map<CloneLevel, Map<string, number>>();
  for (const level of CLONE_LEVELS) {
    const hashes = [...new Set(rows.flatMap((row) => (row[level] === null ? [] : [row[level]])))];
    sizes.set(level, await classSizes(q, level, hashes));
  }
  const copies = (row: (typeof rows)[number], level: CloneLevel): number => {
    const hash = row[level];
    if (hash === null) return 0;
    const size = sizes.get(level)?.get(hash) ?? 0;
    return Math.max(0, size - (row.test === 0 ? 1 : 0));
  };
  return rows.map((row) => {
    const home = homeOf(row.name.slice(row.name.lastIndexOf(".") + 1), row.repo);
    return {
      repo: row.repo,
      path: row.path,
      name: row.name,
      line: row.line,
      endLine: row.endLine,
      kind: row.kind,
      exported: row.exported === 1,
      test: row.test === 1,
      nodes: row.nodes,
      copies: { exact: copies(row, "exact"), renamed: copies(row, "renamed"), shape: copies(row, "shape") },
      home: home === undefined ? null : { area: home.area, title: home.title, packages: [...home.packages] },
    };
  });
}

/** This function gives each repository of the catalog with its current snapshot, in name order. */
export async function catalogRepos(q: CatalogQuery): Promise<CatalogRepo[]> {
  const rows = await q.selectFrom("current_snapshot").select(["repo", "commit", "scanned_at", "files"]).orderBy("repo").execute();
  return rows.map((row) => ({ repo: row.repo, commit: row.commit, scannedAt: row.scanned_at, files: row.files }));
}

const place = z.object({ repo: z.string(), path: z.string(), name: z.string(), line: z.number() });

const ReposOutput: z.ZodType<{ repos: CatalogRepo[] }> = z.object({
  repos: z.array(z.object({ repo: z.string(), commit: z.string().nullable(), scannedAt: z.string(), files: z.number() })),
});

const FindInput = z.object({
  name: z.string().min(1).describe("The name of the function or method, without its class"),
  match: z.enum(NAME_MATCHES).optional().describe("How the name matches: exact (the default), prefix or contains"),
  repo: z.string().optional().describe("Only the functions of this repository"),
  limit: z.number().int().min(1).max(TOOL_ROW_LIMIT).optional().describe("The most functions to give. The default is 50"),
});

const FindOutput: z.ZodType<{ functions: FoundFunction[] }> = z.object({
  functions: z.array(
    place.extend({
      endLine: z.number(),
      kind: z.string(),
      exported: z.boolean(),
      test: z.boolean(),
      nodes: z.number().nullable(),
      copies: z.object({ exact: z.number(), renamed: z.number(), shape: z.number() }).describe("The copies outside tests at each clone level"),
      home: z.object({ area: z.string(), title: z.string(), packages: z.array(z.string()) }).nullable().describe("The home of the name, when it is another repository"),
    }),
  ),
});

const CopiesInput = z.object({
  repo: z.string().describe("The repository of the function"),
  path: z.string().describe("The path of the file of the function"),
  name: z.string().describe("The qualified name of the function, for example Class.method"),
  level: z.enum(["exact", "renamed", "shape"]).optional().describe("exact: the same code; renamed: the same code with other names; shape: the same structure. The default is renamed"),
});

const CopiesOutput: z.ZodType<{ copies: FunctionPlace[] }> = z.object({ copies: z.array(place) });

const HomesInput = z.object({
  area: z.string().optional().describe("Only this area of the map of homes, for example statistics"),
  limit: z.number().int().min(1).max(TOOL_ROW_LIMIT).optional().describe("The most copies to give for each area. The default is 20"),
});

interface HomesOutputValue {
  homes: (Omit<HomeCandidate, "copies" | "home" | "repos"> & { home: string[]; repos: string[]; copies: (FunctionPlace & { nodes: number })[]; more: number })[];
}

const HomesOutput: z.ZodType<HomesOutputValue> = z.object({
  homes: z.array(
    z.object({
      area: z.string(),
      title: z.string(),
      home: z.array(z.string()),
      repo: z.string(),
      state: z.string(),
      repos: z.array(z.string()).describe("The repositories with copies"),
      nodes: z.number(),
      classes: z.number(),
      copies: z.array(place.extend({ nodes: z.number() })),
      more: z.number().describe("The copies of the area that the limit leaves out"),
    }),
  ),
});

const ImportersInput = z.object({ specifier: z.string().min(1).describe("The import specifier, for example node:sqlite or kysely") });

const ImportersOutput: z.ZodType<{ importers: ImportPlace[] }> = z.object({
  importers: z.array(z.object({ repo: z.string(), path: z.string(), line: z.number(), kind: z.string() })),
});

const meta = (description: string, effects: Effects = CATALOG_READ_EFFECTS) => ({ description, args: [], shorts: {}, output: "json", effects });

const RescanInput = z.object({
  repo: z.string().min(1).describe("The name of a repository of the catalog, for example codeatlas"),
  path: z.string().min(1).describe("The absolute path of a clean clone of the repository. Its remote origin must have the name of the repository"),
});

const RescanOutput: z.ZodType<RescanResult> = z.object({
  repo: z.string(),
  commit: z.string().nullable(),
  before: z.string().nullable().describe("The commit of the snapshot before the rescan"),
  files: z.number(),
  parsed: z.number().describe("The blobs that the rescan parsed. The other files come from the cache"),
  reused: z.number(),
  errors: z.number(),
  ms: z.number(),
});

/** The options of `atlasTools`. */
export interface AtlasToolsOptions {
  /** A catalog that the tools can write. With it, the package has `atlas.rescan`. */
  readonly writable?: Catalog | undefined;
}

/** This function gives the package of the tools over the catalog that `q` reads. */
export function atlasTools(q: CatalogQuery, options: AtlasToolsOptions = {}): PackageDefinition {
  const writable = options.writable;
  const rescan =
    writable === undefined
      ? []
      : [
          createProcedure()
            .path(["atlas", "rescan"])
            .input(RescanInput)
            .output(RescanOutput)
            .meta(meta("Scan one repository of the catalog again from a local clone. Only new blobs are parsed", CATALOG_WRITE_EFFECTS))
            .handler(async (input) => rescanRepo(writable, input.repo, input.path))
            .build(),
        ];
  return definePackage("codeatlas", [
    ...rescan,
    createProcedure()
      .path(["atlas", "repos"])
      .input(z.object({}))
      .output(ReposOutput)
      .meta(meta("Give each repository of the catalog with the commit and the time of its scan"))
      .handler(async () => ({ repos: await catalogRepos(q) }))
      .build(),
    createProcedure()
      .path(["atlas", "find"])
      .input(FindInput)
      .output(FindOutput)
      .meta(meta("Find functions by name in all repositories, with their copies at each clone level and the home of the name"))
      .handler(async (input) => ({ functions: await findFunctions(q, input.name, input) }))
      .build(),
    createProcedure()
      .path(["atlas", "copies"])
      .input(CopiesInput)
      .output(CopiesOutput)
      .meta(meta("Give the copies of one function in all repositories at one clone level"))
      .handler(async (input) => ({ copies: (await copiesOf(q, input, input.level ?? "renamed")).slice(0, TOOL_ROW_LIMIT) }))
      .build(),
    createProcedure()
      .path(["atlas", "homes"])
      .input(HomesInput)
      .output(HomesOutput)
      .meta(meta("Give the functions outside their home of the map of homes, for each home, the most nodes first"))
      .handler(async (input) => {
        const limit = input.limit ?? 20;
        const all = await homeCandidates(q);
        const homes = all.filter((home) => input.area === undefined || home.area === input.area);
        return {
          homes: homes.map((home) => ({
            ...home,
            home: [...home.home],
            repos: [...home.repos],
            copies: home.copies.slice(0, limit).map((copy) => ({ repo: copy.repo, path: copy.path, name: copy.name, line: copy.line, nodes: copy.nodes })),
            more: Math.max(0, home.copies.length - limit),
          })),
        };
      })
      .build(),
    createProcedure()
      .path(["atlas", "importers"])
      .input(ImportersInput)
      .output(ImportersOutput)
      .meta(meta("Give each import of a specifier in all repositories, test files included"))
      .handler(async (input) => ({ importers: (await importersOf(q, input.specifier)).slice(0, TOOL_ROW_LIMIT) }))
      .build(),
  ]);
}
