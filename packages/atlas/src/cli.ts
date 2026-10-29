#!/usr/bin/env node
/**
 * codeatlas build [--out atlas.json] [--markdown atlas.md] [--min-nodes 40] [--repos-dir <folder>] [<name>=<path> ...]
 * codeatlas clone --owner <owner> --into <folder>
 *
 * The command scans each repository (each folder of --repos-dir, and each name=path), and writes the
 * atlas as JSON and as Markdown.
 */
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildAtlas } from "./atlas.ts";
import { clonePublic } from "./clone.ts";
import { atlasMarkdown } from "./report.ts";
import { scanRepo, type RepoScan } from "./scan.ts";

export interface BuildArgs {
  readonly out: string;
  readonly markdown: string | undefined;
  readonly minNodes: number;
  readonly repos: readonly { readonly name: string; readonly path: string }[];
}

export function parseBuildArgs(argv: readonly string[], list: (dir: string) => string[] = subfolders): BuildArgs | { readonly error: string } {
  let out = "atlas.json";
  let markdown: string | undefined;
  let minNodes = 40;
  const repos: { name: string; path: string }[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const value = (): string | undefined => argv[++i];
    if (arg === "--out") out = value() ?? out;
    else if (arg === "--markdown") markdown = value();
    else if (arg === "--min-nodes") {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 1) return { error: "--min-nodes takes a whole number of 1 or more." };
      minNodes = n;
    } else if (arg === "--repos-dir") {
      const dir = value();
      if (dir === undefined) return { error: "--repos-dir takes a folder." };
      for (const name of list(dir)) repos.push({ name, path: join(dir, name) });
    } else if (arg.includes("=") && !arg.startsWith("-")) {
      const at = arg.indexOf("=");
      repos.push({ name: arg.slice(0, at), path: arg.slice(at + 1) });
    } else return { error: `Unknown argument: ${arg}` };
  }
  if (repos.length === 0) return { error: "Give one or more repositories: --repos-dir <folder> or <name>=<path>." };
  return { out, markdown, minNodes, repos };
}

function subfolders(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => !name.startsWith(".") && statSync(join(dir, name)).isDirectory())
    .sort();
}

const USAGE = `Usage:
  codeatlas build [--out atlas.json] [--markdown atlas.md] [--min-nodes 40] [--repos-dir <folder>] [<name>=<path> ...]
  codeatlas clone --owner <owner> --into <folder>`;

function main(argv: readonly string[]): number {
  const [command, ...rest] = argv;
  if (command === "clone") {
    const owner = rest[rest.indexOf("--owner") + 1];
    const into = rest[rest.indexOf("--into") + 1];
    if (!rest.includes("--owner") || !rest.includes("--into") || owner === undefined || into === undefined) {
      console.error(USAGE);
      return 2;
    }
    const { failed } = clonePublic(owner, into);
    for (const name of failed) console.log(`::warning::${name} did not clone`);
    return 0;
  }
  if (command !== "build") {
    console.error(USAGE);
    return 2;
  }
  const args = parseBuildArgs(rest);
  if ("error" in args) {
    console.error(args.error);
    return 2;
  }
  const scans: RepoScan[] = [];
  for (const repo of args.repos) {
    const scan = scanRepo(repo.name, repo.path);
    console.error(`${repo.name}: ${scan.files} files, ${scan.units.length} functions, ${scan.errors.length} parse errors`);
    scans.push(scan);
  }
  const atlas = buildAtlas(scans, { minNodes: args.minNodes });
  writeFileSync(args.out, `${JSON.stringify(atlas, null, 1)}\n`);
  if (args.markdown !== undefined) writeFileSync(args.markdown, atlasMarkdown(atlas));
  const { totals } = atlas;
  console.error(`atlas: ${totals.classes} clone classes, ${totals.crossRepoClasses} cross-repo, ${totals.duplicatedNodes} duplicated nodes of ${totals.nodes}`);
  return 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
