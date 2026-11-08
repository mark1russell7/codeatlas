/**
 * The drift from the template (Layer 1c of `docs/SCHEMA.md`). The template makes a new repository with its stamp. The
 * stamp copies the files that its list `KEEP` names, and it pins each shared workflow and action to a commit of the
 * template. This module reads the pins and the copied files of each repository. The query `templateDrift` compares
 * them with the template.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseYaml } from "@procedures/json";
import { parseSync } from "@swc/core";
import { treeOf, type TreeEntry } from "./blobs.ts";
import type { CatalogQuery } from "./query.ts";
import { MAX_BYTES } from "./scan.ts";

/** The name of the template repository in the catalog. */
export const TEMPLATE_REPO = "template";

/** The path of the stamp of the template. Its export `KEEP` is the list of the files of a new repository. */
export const STAMP_PATH = "scripts/stamp/stamp.ts";

/** The count of the commits of the history of the template that the catalog keeps. The clone of the template gets this depth. */
export const TEMPLATE_HISTORY = 30;

/** A repository is current when each of its pins is at one of this count of the newest commits of the template. */
export const FRESH_COMMITS = 2;

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
  /**
   * The SHA-256 of the text. For a workflow, it is the hash of `workflowForm`, so a pin or an input of a shared
   * workflow or action is not a change.
   */
  readonly hash: string;
}

/** The template records of one repository. */
export interface TemplateRecords {
  readonly pins: readonly TemplatePin[];
  readonly files: readonly TemplateFileRecord[];
  /** The commits of the first-parent history of HEAD, the newest first. Only the scan of the template reads them. */
  readonly commits: readonly string[];
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

const objectOf = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** This function gives the value with the keys of each object in order, so two equal values give one JSON text. */
const sorted = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sorted);
  const object = objectOf(value);
  if (object === undefined) return value;
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, sorted(object[key])]));
};

const isShared = (uses: unknown): boolean => typeof uses === "string" && uses.startsWith("./.github/");

/** The condition of a job that runs only in the template. Such a job does nothing in another repository. */
const TEMPLATE_ONLY = /^\s*(?:\$\{\{\s*)?github\.repository\s*==\s*'mark1russell7\/template'\s*(?:\}\})?\s*$/;

const isTemplateOnly = (condition: unknown): boolean => typeof condition === "string" && TEMPLATE_ONLY.test(condition);

/**
 * This function gives the form of a workflow that the drift compares: its parsed YAML as JSON with sorted keys. Each
 * pin has the local form of the template. A call of a shared workflow loses its `with` and `secrets`. A step of a
 * shared action loses its `with`. Thus the inputs of a repository are not drift. A job that runs only in the
 * template goes, with its name in each `needs`. A text that does not parse gives its `localForm`.
 */
export function workflowForm(text: string): string {
  let workflow: unknown;
  try {
    workflow = parseYaml(localForm(text));
  } catch {
    return localForm(text);
  }
  const jobs = objectOf(objectOf(workflow)?.["jobs"]) ?? {};
  const only = Object.keys(jobs).filter((name) => isTemplateOnly(objectOf(jobs[name])?.["if"]));
  for (const name of only) delete jobs[name];
  for (const job of Object.values(jobs)) {
    const j = objectOf(job);
    if (j === undefined) continue;
    if (Array.isArray(j["needs"])) j["needs"] = j["needs"].filter((need) => !only.includes(need as string));
    if (isShared(j["uses"])) {
      delete j["with"];
      delete j["secrets"];
    }
    for (const step of Array.isArray(j["steps"]) ? j["steps"] : []) {
      const s = objectOf(step);
      if (s !== undefined && isShared(s["uses"])) delete s["with"];
    }
  }
  return JSON.stringify(sorted(workflow));
}

/** This function gives the first-parent history of HEAD of `root`, the newest first, at most `count` commits. */
export function historyOf(root: string, count: number): string[] {
  if (count <= 0) return [];
  try {
    return execFileSync("git", ["-C", root, "log", "--first-parent", "--format=%H", "-n", String(count)], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

const kept = (keep: readonly string[], path: string): boolean => keep.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry));

/**
 * This function gives the template records of one repository: the pins of its workflows, its files of `keep`, and
 * `history` commits of its history. The worktree must be a clean checkout of HEAD.
 */
export function templateRecordsOfRepo(root: string, keep: readonly string[], tree: readonly TreeEntry[] = treeOf(root), history = 0): TemplateRecords {
  const pins: TemplatePin[] = [];
  const files: TemplateFileRecord[] = [];
  for (const entry of tree) {
    const workflow = WORKFLOW.test(entry.path);
    const copy = kept(keep, entry.path);
    if ((!workflow && !copy) || entry.bytes > MAX_BYTES) continue;
    const text = readFileSync(join(root, entry.path), "utf8").replace(/\r\n/g, "\n");
    if (workflow) pins.push(...pinsOf(entry.path, text));
    if (copy) files.push({ path: entry.path, oid: entry.blob, hash: createHash("sha256").update(workflow ? workflowForm(text) : text).digest("hex") });
  }
  return { pins, files, commits: historyOf(root, history) };
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

/** The share of the repositories that pin the template and are current. */
export interface PinFreshness {
  /** The newest commits of the template that count as current, the newest first. */
  readonly commits: readonly string[];
  readonly current: readonly string[];
  /**
   * Each repository that is not current, with its oldest pin. `age` is the count of newer commits of the template,
   * or `null` when the catalog does not keep the commit of the pin.
   */
  readonly behind: readonly { readonly repo: string; readonly ref: string; readonly age: number | null }[];
  /** The count of the current repositories over the count of the repositories that pin the template. It is zero when no repository pins it. */
  readonly share: number;
}

/**
 * This function gives the share of the current repositories. A repository is current when each pin is at one of
 * the `last` newest commits of the template. A pin to a branch or tag name is not current. The oldest pin comes first.
 */
export async function pinFreshness(q: CatalogQuery, last: number = FRESH_COMMITS, template: string = TEMPLATE_REPO): Promise<PinFreshness> {
  const history = await q
    .selectFrom("current_snapshot as s")
    .innerJoin("template_commit as c", "c.snapshot", "s.id")
    .where("s.repo", "=", template)
    .select(["c.ordinal as ordinal", "c.sha as sha"])
    .orderBy("ordinal")
    .execute();
  const ages = new Map(history.map((row) => [row.sha, row.ordinal]));
  const commits = history.slice(0, last).map((row) => row.sha);
  const pins = await q.selectFrom("current_template_pin").select(["repo", "ref"]).where("repo", "!=", template).execute();
  const refsOf = new Map<string, Set<string>>();
  for (const pin of pins) refsOf.set(pin.repo, (refsOf.get(pin.repo) ?? new Set<string>()).add(pin.ref));
  // An unknown ref is older than each commit of the history that the catalog keeps
  const age = (ref: string): number => ages.get(ref) ?? Number.POSITIVE_INFINITY;
  const current: string[] = [];
  const behind: { repo: string; ref: string; age: number | null }[] = [];
  for (const [repo, refs] of refsOf) {
    const stale = [...refs].filter((ref) => !commits.includes(ref));
    if (stale.length === 0) {
      current.push(repo);
      continue;
    }
    const oldest = stale.sort((a, b) => age(b) - age(a) || byText(a, b))[0] ?? "";
    behind.push({ repo, ref: oldest, age: ages.get(oldest) ?? null });
  }
  return {
    commits,
    current: current.sort(byText),
    behind: behind.sort((a, b) => age(b.ref) - age(a.ref) || byText(a.repo, b.repo)),
    share: refsOf.size === 0 ? 0 : current.length / refsOf.size,
  };
}

const short = (ref: string): string => (/^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref);

/** This function gives the Markdown of the drift from the template: the share of current repositories, the repositories behind, and the changed copies. */
export function driftMarkdown(freshness: PinFreshness, drift: TemplateDrift): string {
  const total = freshness.current.length + freshness.behind.length;
  const percent = Math.round(freshness.share * 100);
  const lines = [
    "## Drift from the template",
    "",
    `Current: **${freshness.current.length} of ${total}** repositories (${percent}%) pin only the ${freshness.commits.length} newest commits of the template (${freshness.commits.map(short).join(", ") || "none known"}).`,
    "",
  ];
  if (freshness.behind.length > 0) {
    lines.push("| Repository | Oldest pin | Newer commits of the template | Changed copies |", "| --- | --- | ---: | ---: |");
    const changed = new Map(drift.repos.map((r) => [r.repo, r.files.filter((f) => f.state === "changed").length]));
    for (const b of freshness.behind) lines.push(`| ${b.repo} | \`${short(b.ref)}\` | ${b.age ?? "more than the history"} | ${changed.get(b.repo) ?? 0} |`);
    lines.push("");
  }
  const files = new Map<string, number>();
  for (const r of drift.repos) for (const f of r.files) if (f.state === "changed") files.set(f.path, (files.get(f.path) ?? 0) + 1);
  if (files.size > 0) {
    lines.push("A changed copy differs from the template outside the inputs of the shared workflows and actions.", "", "| Copied file | Repositories with a change |", "| --- | ---: |");
    for (const [path, count] of [...files].sort((a, b) => b[1] - a[1] || byText(a[0], b[0]))) lines.push(`| \`${path}\` | ${count} |`);
    lines.push("");
  }
  return lines.join("\n");
}
