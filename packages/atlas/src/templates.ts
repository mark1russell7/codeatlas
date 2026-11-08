/**
 * The drift from the template (Layer 1c of `docs/SCHEMA.md`). The template makes a new repository with its stamp. The
 * stamp copies the files that its list `KEEP` names, and it pins each shared workflow and action to a commit of the
 * template. This module reads the pins and the copied files of each repository. The query `templateDrift` compares
 * them with the template.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSync } from "@swc/core";
import { treeOf, type TreeEntry } from "./blobs.ts";
import type { CatalogQuery } from "./query.ts";
import { MAX_BYTES } from "./scan.ts";

/** The name of the template repository in the catalog. */
export const TEMPLATE_REPO = "template";

/** The path of the stamp of the template. Its export `KEEP` is the list of the files of a new repository. */
export const STAMP_PATH = "scripts/stamp/stamp.ts";

/** One pin of a shared workflow or action of the template, in a `uses:` line of a workflow. */
export interface TemplatePin {
  readonly path: string;
  readonly line: number;
  /** The path of the workflow or action in the template, for example `.github/workflows/reusable-ci.yml`. */
  readonly target: string;
  /** The ref after `@`: a commit, or a branch or tag name. */
  readonly ref: string;
}

/** One file of a repository that the stamp copies from the template. */
export interface TemplateFileRecord {
  readonly path: string;
  readonly oid: string;
  /** The SHA-256 of the text. Each pin of a workflow has the local form of the template first, so a pin is not a change. */
  readonly hash: string;
}

/** The template records of one repository. */
export interface TemplateRecords {
  readonly pins: readonly TemplatePin[];
  readonly files: readonly TemplateFileRecord[];
}

interface SwcNode {
  readonly type: string;
  readonly [key: string]: unknown;
}

const nodeOf = (value: unknown): SwcNode | undefined =>
  typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string" ? (value as SwcNode) : undefined;

/**
 * This function gives the list `KEEP` of the text of the stamp: the paths of the files of a new repository. A path
 * that ends with `/` is a folder. The function gives `undefined` when the text has no `export const KEEP` with an
 * array of strings.
 */
export function keepListOf(text: string): string[] | undefined {
  const module = parseSync(text, { syntax: "typescript" }) as unknown as { body: unknown[] };
  for (const item of module.body) {
    const declaration = nodeOf(nodeOf(item)?.["declaration"]);
    if (nodeOf(item)?.type !== "ExportDeclaration" || declaration?.type !== "VariableDeclaration") continue;
    for (const declarator of (declaration["declarations"] as unknown[]) ?? []) {
      const d = nodeOf(declarator);
      if (nodeOf(d?.["id"])?.["value"] !== "KEEP") continue;
      const init = nodeOf(d?.["init"]);
      const array = init?.type === "TsAsExpression" || init?.type === "TsConstAssertion" ? nodeOf(init["expression"]) : init;
      if (array?.type !== "ArrayExpression") return undefined;
      const paths: string[] = [];
      for (const element of (array["elements"] as unknown[]) ?? []) {
        // An element is an ExprOrSpread, which has no type of its own
        const literal = nodeOf((element as { expression?: unknown } | null)?.expression);
        if (literal?.type !== "StringLiteral" || typeof literal["value"] !== "string") return undefined;
        paths.push(literal["value"]);
      }
      return paths;
    }
  }
  return undefined;
}

/** This function gives the list `KEEP` of the template checkout `root`, or `undefined` when its stamp has none. */
export function keepListOfRepo(root: string): string[] | undefined {
  try {
    return keepListOf(readFileSync(join(root, STAMP_PATH), "utf8"));
  } catch {
    return undefined;
  }
}

// Each part has one way to match, so a long line cannot make the pattern backtrack
const PIN = /^[ \t]*(?:-[ \t]*)?uses:[ \t]*["']?mark1russell7\/template\/([\w./-]+)@([\w.-]+)/;
const WORKFLOW = /^\.github\/(?:workflows\/[^/]+|actions\/.+\/action)\.ya?ml$/;

/** This function gives each pin of a shared workflow or action of the template in the text of one workflow. */
export function pinsOf(path: string, text: string): TemplatePin[] {
  const pins: TemplatePin[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = PIN.exec(lines[i] ?? "");
    if (match?.[1] !== undefined && match[2] !== undefined) pins.push({ path, line: i + 1, target: match[1], ref: match[2] });
  }
  return pins;
}

/**
 * This function gives the text of a workflow with each pin in the local form of the template: the line
 * `uses: mark1russell7/template/<path>@<commit> # main` becomes `uses: ./<path>`.
 */
export function localForm(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const match = PIN.exec(line);
      return match === null ? line : `${line.slice(0, line.indexOf("uses:"))}uses: ./${match[1] ?? ""}`;
    })
    .join("\n");
}

const kept = (keep: readonly string[], path: string): boolean => keep.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry));

/**
 * This function gives the template records of one repository: each pin in its workflows, and each file of
 * `keep` that it has. The worktree must be a clean checkout of HEAD.
 */
export function templateRecordsOfRepo(root: string, keep: readonly string[], tree: readonly TreeEntry[] = treeOf(root)): TemplateRecords {
  const pins: TemplatePin[] = [];
  const files: TemplateFileRecord[] = [];
  for (const entry of tree) {
    const workflow = WORKFLOW.test(entry.path);
    const copy = kept(keep, entry.path);
    if ((!workflow && !copy) || entry.bytes > MAX_BYTES) continue;
    const text = readFileSync(join(root, entry.path), "utf8").replace(/\r\n/g, "\n");
    if (workflow) pins.push(...pinsOf(entry.path, text));
    if (copy) files.push({ path: entry.path, oid: entry.blob, hash: createHash("sha256").update(workflow ? localForm(text) : text).digest("hex") });
  }
  return { pins, files };
}

/** The states of a copied file against the template. */
export const DRIFT_STATES = ["same", "changed", "missing"] as const;

export type DriftState = (typeof DRIFT_STATES)[number];

/** One pin of a repository. `current` is true if the pin is at the commit of the template in the catalog. */
export interface PinDrift extends TemplatePin {
  readonly current: boolean;
}

/** The drift of one repository that pins the template. */
export interface RepoDrift {
  readonly repo: string;
  readonly pins: readonly PinDrift[];
  /** The pins that are not at the commit of the template. */
  readonly behind: number;
  readonly files: readonly { readonly path: string; readonly state: DriftState }[];
  /** The copied files that are not the same as the template. */
  readonly changed: number;
}

/** The drift from the template of each repository that pins it. */
export interface TemplateDrift {
  /** The template in the catalog, or `null` when the catalog does not have it. */
  readonly template: { readonly repo: string; readonly commit: string | null } | null;
  /** Each ref of the pins, with the repositories that pin it, the most repositories first. */
  readonly refs: readonly { readonly ref: string; readonly current: boolean; readonly repos: readonly string[] }[];
  readonly repos: readonly RepoDrift[];
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * This function gives the drift from the template of each repository that pins it, the most pins behind first.
 * A file is `same` when its text is the text of the template, with each pin in the local form.
 */
export async function templateDrift(q: CatalogQuery, template: string = TEMPLATE_REPO): Promise<TemplateDrift> {
  const head = await q.selectFrom("current_snapshot").select(["repo", "commit"]).where("repo", "=", template).executeTakeFirst();
  const pins = await q.selectFrom("current_template_pin").select(["repo", "path", "line", "target", "ref"]).orderBy("repo").orderBy("path").orderBy("line").execute();
  const files = await q.selectFrom("current_template_file").select(["repo", "path", "hash"]).orderBy("repo").orderBy("path").execute();
  const reference = new Map(files.filter((f) => f.repo === template).map((f) => [f.path, f.hash]));
  const commit = head?.commit ?? null;
  const isCurrent = (ref: string): boolean => commit !== null && ref === commit;
  const pinsOfRepo = new Map<string, PinDrift[]>();
  for (const pin of pins) {
    if (pin.repo === template) continue;
    const list = pinsOfRepo.get(pin.repo) ?? [];
    list.push({ path: pin.path, line: pin.line, target: pin.target, ref: pin.ref, current: isCurrent(pin.ref) });
    pinsOfRepo.set(pin.repo, list);
  }
  const hashes = new Map<string, Map<string, string>>();
  for (const file of files) hashes.set(file.repo, (hashes.get(file.repo) ?? new Map<string, string>()).set(file.path, file.hash));
  const repos: RepoDrift[] = [...pinsOfRepo].map(([repo, list]) => {
    const own = hashes.get(repo) ?? new Map<string, string>();
    const states = [...reference].map(([path, hash]) => ({ path, state: (own.has(path) ? (own.get(path) === hash ? "same" : "changed") : "missing") as DriftState }));
    return { repo, pins: list, behind: list.filter((p) => !p.current).length, files: states, changed: states.filter((s) => s.state !== "same").length };
  });
  const refRepos = new Map<string, Set<string>>();
  for (const r of repos) for (const p of r.pins) refRepos.set(p.ref, (refRepos.get(p.ref) ?? new Set<string>()).add(r.repo));
  return {
    template: head === undefined ? null : { repo: head.repo, commit },
    refs: [...refRepos]
      .map(([ref, set]) => ({ ref, current: isCurrent(ref), repos: [...set].sort(byText) }))
      .sort((a, b) => b.repos.length - a.repos.length || byText(a.ref, b.ref)),
    repos: repos.sort((a, b) => b.behind - a.behind || b.changed - a.changed || byText(a.repo, b.repo)),
  };
}
