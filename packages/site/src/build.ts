#!/usr/bin/env node
/**
 * node src/build.ts --atlas <atlas.json> --out <folder> [--owner <owner>] [--markdown <atlas.md>]
 *
 * The command writes the site: index.html with the page (page.ts, compiled with swc), and the data
 * files data/atlas.json and data/atlas.md.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { transformSync } from "@swc/core";
import type { Atlas } from "@mark1russell7/codeatlas";

export interface SiteArgs {
  readonly atlas: string;
  readonly out: string;
  readonly owner: string;
  readonly markdown: string | undefined;
}

export function parseSiteArgs(argv: readonly string[], env: Readonly<Record<string, string | undefined>> = process.env): SiteArgs | { readonly error: string } {
  let atlas: string | undefined;
  let out: string | undefined;
  let markdown: string | undefined;
  let owner = env["GITHUB_REPOSITORY_OWNER"] ?? "mark1russell7";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[++i];
    if (value === undefined) return { error: `${arg} takes a value.` };
    if (arg === "--atlas") atlas = value;
    else if (arg === "--out") out = value;
    else if (arg === "--owner") owner = value;
    else if (arg === "--markdown") markdown = value;
    else return { error: `Unknown argument: ${arg}` };
  }
  if (atlas === undefined || out === undefined) return { error: "Give --atlas <atlas.json> and --out <folder>." };
  return { atlas, out, owner, markdown };
}

/** The atlas must have the schema of this version of the page. */
export function readAtlas(text: string): Atlas {
  const atlas = JSON.parse(text) as Partial<Atlas>;
  if (atlas.schema !== "codeatlas/1") throw new Error(`The atlas has the schema ${String(atlas.schema)}, not codeatlas/1.`);
  return atlas as Atlas;
}

export function compilePage(source: string): string {
  return transformSync(source, {
    filename: "page.ts",
    jsc: { parser: { syntax: "typescript" }, target: "es2022" },
    module: { type: "es6" },
  }).code;
}

const escapeHtml = (text: string): string => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

export function pageHtml(script: string, atlas: Atlas, owner: string, built: string): string {
  const t = atlas.totals;
  const description = `A duplication atlas of ${t.repos} public repositories: ${(t.ratio * 100).toFixed(1)}% of the code is a copy, in ${t.crossRepoClasses} clone classes that span repositories.`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>codeatlas</title>
<meta name="description" content="${escapeHtml(description)}">
<style>${CSS}</style>
</head>
<body>
<header>
  <h1>codeatlas</h1>
  <p class="sub">The code that the repositories of ${escapeHtml(owner)} write again and again. The atlas scans each public repository every week. Built ${escapeHtml(built)}.</p>
  <nav><a href="#topics">Topics</a><a href="#pairs">Pairs</a><a href="#repos">Repositories</a><a href="#classes">Classes</a><a href="#names">Names</a><a href="#purposes">Purposes</a><a href="data/atlas.json">Data</a><a href="status/">Status</a><a href="releases/">Releases</a><a href="https://github.com/${escapeHtml(owner)}/codeatlas">Source</a></nav>
</header>
<main id="app" data-owner="${escapeHtml(owner)}"><p class="empty">Loading the atlas.</p></main>
<script type="module">${script.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>
`;
}

const CSS = `
:root{--bg:#f6f6f3;--surface:#fcfcfb;--surface-2:#efeee9;--ink:#1d1d1b;--ink-2:#55554f;--ink-3:#7b7b73;--line:#deddd6;--accent:#2a78d6;--flag:#a3520c;
--s0:#cde2fb;--s1:#9ec5f4;--s2:#86b6ef;--s3:#5598e7;--s4:#3987e5;--s5:#256abf;--s6:#104281;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121211;--surface:#1a1a19;--surface-2:#262624;--ink:#ecebe6;--ink-2:#b4b3ab;--ink-3:#8b8a83;--line:#33332f;--accent:#3987e5;--flag:#e8964a;
--s0:#163a66;--s1:#1c5cab;--s2:#256abf;--s3:#3987e5;--s4:#5598e7;--s5:#86b6ef;--s6:#cde2fb;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#121211;--surface:#1a1a19;--surface-2:#262624;--ink:#ecebe6;--ink-2:#b4b3ab;--ink-3:#8b8a83;--line:#33332f;--accent:#3987e5;--flag:#e8964a;
--s0:#163a66;--s1:#1c5cab;--s2:#256abf;--s3:#3987e5;--s4:#5598e7;--s5:#86b6ef;--s6:#cde2fb;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
header,main{max-width:1080px;margin:0 auto;padding:0 16px}
header{padding-top:32px}
h1{margin:0;font-size:28px;letter-spacing:-.01em}
.sub{color:var(--ink-2);margin:6px 0 12px;max-width:70ch}
nav{display:flex;flex-wrap:wrap;gap:4px 14px;padding-bottom:12px;border-bottom:1px solid var(--line)}
nav a,a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
section{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:18px;margin:18px 0}
h2{margin:0;font-size:18px}
.lead{color:var(--ink-2);margin:4px 0 14px;font-size:14px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr));gap:12px;margin-top:18px}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.kpi-value{font-size:30px;font-weight:650;font-variant-numeric:tabular-nums}
.kpi-label{font-weight:550}
.kpi-detail{color:var(--ink-3);font-size:13px}
.bars{display:grid;gap:4px}
.bar-row{display:grid;grid-template-columns:minmax(90px,150px) 1fr auto;gap:10px;align-items:center;background:none;border:0;border-radius:6px;padding:5px 6px;color:inherit;font:inherit;text-align:left;cursor:pointer}
.bar-row:hover,.bar-row:focus-visible{background:var(--surface-2)}
.bar-label{font-size:14px}
.bar-track{height:12px}
.bar{display:block;height:12px;background:var(--accent);border-radius:0 4px 4px 0}
.bar-value{font-variant-numeric:tabular-nums;color:var(--ink-2);font-size:13px;min-width:5ch;text-align:right}
.scroll{overflow-x:auto;max-width:100%}
svg .axis{font-size:11px;fill:var(--ink-2)}
.cell{cursor:pointer;stroke:none}.cell.none{fill:var(--surface-2);cursor:default}
.cell:hover,.cell:focus{outline:none;stroke:var(--ink);stroke-width:1.5}
.s0{fill:var(--s0);background:var(--s0)}.s1{fill:var(--s1);background:var(--s1)}.s2{fill:var(--s2);background:var(--s2)}.s3{fill:var(--s3);background:var(--s3)}.s4{fill:var(--s4);background:var(--s4)}.s5{fill:var(--s5);background:var(--s5)}.s6{fill:var(--s6);background:var(--s6)}
.legend{display:flex;align-items:center;gap:3px;color:var(--ink-3);font-size:12px;margin-top:8px}
.swatch{width:16px;height:10px;border-radius:2px;display:inline-block}
.table{border-collapse:collapse;width:100%;font-size:14px}
.table th,.table td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.table th{font-weight:600;color:var(--ink-2);white-space:nowrap}
.table th button{background:none;border:0;color:inherit;font:inherit;cursor:pointer;padding:0}
.sortable tbody tr{cursor:pointer}.sortable tbody tr:hover,.sortable tbody tr:focus-visible{background:var(--surface-2);outline:none}
.num{text-align:right!important;font-variant-numeric:tabular-nums;white-space:nowrap}
.ratio{display:inline-flex;align-items:center;gap:8px;justify-content:flex-end}
.track{display:inline-block;width:70px;height:8px}
.mini{display:block;height:8px;background:var(--accent);border-radius:0 3px 3px 0}
.rest{margin:10px 0 0;font-size:14px}
.link{background:none;border:0;padding:0;font:inherit;color:var(--accent);cursor:pointer;text-align:left}
.link:hover{text-decoration:underline}
.flag{margin-left:8px;font-size:12px;color:var(--flag);border:1px solid currentColor;border-radius:999px;padding:0 7px}
.flag.quiet,.tag.quiet{color:var(--ink-3)}
.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}
.filters select,.filters input[type=search]{font:inherit;font-size:14px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink);max-width:100%}
.filters label{font-size:14px;color:var(--ink-2)}
.reset,.more{font:inherit;font-size:14px;padding:6px 12px;border:1px solid var(--line);border-radius:6px;background:var(--surface-2);color:var(--ink);cursor:pointer}
.more{margin-top:10px}
.count{color:var(--ink-3);font-size:13px;margin:4px 0 8px}
.card{border:1px solid var(--line);border-radius:8px;margin:6px 0;background:var(--surface)}
.card summary{cursor:pointer;padding:8px 12px;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}
.card[open] summary{border-bottom:1px solid var(--line)}
.card-title{font-weight:600;font-family:ui-monospace,Consolas,monospace;font-size:14px;word-break:break-all}
.card-meta{color:var(--ink-3);font-size:13px}
.tag{font-size:12px;color:var(--ink-2);background:var(--surface-2);border-radius:999px;padding:0 8px}
.card ul{margin:0;padding:8px 12px 10px 28px;font-size:13px}
.card li{margin:3px 0;word-break:break-all}
code{font-family:ui-monospace,Consolas,monospace;font-size:12.5px;color:var(--ink-2)}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{font-family:ui-monospace,Consolas,monospace;font-size:13px;background:var(--surface-2);border-radius:6px;padding:2px 8px}
.chip b{margin-left:6px;color:var(--ink-3);font-weight:500}
.tip{position:absolute;display:none;z-index:10;max-width:320px;background:var(--ink);color:var(--surface);font-size:13px;padding:6px 9px;border-radius:6px;pointer-events:none}
.empty{color:var(--ink-3)}
@media (max-width:560px){.kpi-value{font-size:24px}section{padding:14px}.bar-row{grid-template-columns:minmax(80px,110px) 1fr auto}}
`;

function main(argv: readonly string[]): number {
  const args = parseSiteArgs(argv);
  if ("error" in args) {
    console.error(args.error);
    return 2;
  }
  const atlas = readAtlas(readFileSync(args.atlas, "utf8"));
  const script = compilePage(readFileSync(new URL("./page.ts", import.meta.url), "utf8"));
  mkdirSync(join(args.out, "data"), { recursive: true });
  writeFileSync(join(args.out, "index.html"), pageHtml(script, atlas, args.owner, new Date().toISOString().slice(0, 10)));
  copyFileSync(args.atlas, join(args.out, "data", "atlas.json"));
  if (args.markdown !== undefined) copyFileSync(args.markdown, join(args.out, "data", "atlas.md"));
  console.error(`site: ${args.out} (${atlas.totals.repos} repositories, ${atlas.classes.length} classes)`);
  return 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
