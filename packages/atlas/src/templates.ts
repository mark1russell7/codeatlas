/**
 * The drift from the template (Layer 1c of `docs/SCHEMA.md`). The template makes a new repository with its stamp. The
 * stamp copies the files that its list `KEEP` names, and it pins each shared workflow and action to a commit of the
 * template. This module reads the pins and the copied files of each repository. The query `templateDrift` compares
 * them with the template.
 */
import { median, quantile } from "@mark1russell7/rigor-statistics";
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

/**
 * The arguments of the clone of the template: all of its history, with no blobs. The scan reads the tree of each
 * pinned commit, and a tree gives the blob of each file.
 */
export const TEMPLATE_CLONE: readonly string[] = ["--filter=blob:none"];

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
}

/** The files of the template at one ref: the pinned commit of a repository, or the commit of the template. */
export interface TemplateVersion {
  readonly ref: string;
  /** The commit time of the ref, in ISO 8601 form. */
  readonly committedAt: string;
  /** The count of the commits of the template after the ref, up to the commit of the template: `git rev-list --count <ref>..HEAD`. */
  readonly behind: number;
  /** Each workflow and action of `.github/`, and each file of `KEEP`, with its blob. */
  readonly files: readonly { readonly path: string; readonly oid: string }[];
}

/** The template records that tell the content of each pin. Only the scan of the template makes them. */
export interface TemplateVersions {
  readonly versions: readonly TemplateVersion[];
  /** Each file that a shared workflow or action uses, at the commit of the template. A target uses itself. */
  readonly uses: readonly { readonly target: string; readonly path: string }[];
  /**
   * The oldest change of each file that differs at a ref and at the commit of the template. It is the oldest commit
   * after the ref that changes the file.
   */
  readonly changes: readonly TemplateChange[];
}

/** The oldest change of the template to one file after one ref. */
export interface TemplateChange {
  readonly ref: string;
  readonly path: string;
  /** The commit time of the oldest commit after `ref` that changes `path`, in ISO 8601 form. */
  readonly changedAt: string;
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
const yaml = (name: string | undefined): boolean => name !== undefined && (name.endsWith(".yml") || name.endsWith(".yaml"));

/**
 * This function tells if `path` is a shared file of the template: a workflow of `.github/workflows/`, or the
 * `action.yml` of an action of `.github/actions/`. It uses no regular expression, because its input comes from callers.
 */
const isSharedFile = (path: string): boolean => {
  const parts = path.split("/");
  if (parts[0] !== ".github") return false;
  if (parts[1] === "workflows") return parts.length === 3 && yaml(parts[2]);
  const last = parts.at(-1);
  return parts[1] === "actions" && parts.length >= 4 && (last === "action.yml" || last === "action.yaml");
};

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

const kept = (keep: readonly string[], path: string): boolean => keep.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry));

/**
 * This function gives the template records of one repository: each pin in its workflows, and each file of `keep`
 * that it has. The hash of a workflow is the hash of its `workflowForm`. The worktree must be a clean checkout of HEAD.
 */
export function templateRecordsOfRepo(root: string, keep: readonly string[], tree: readonly TreeEntry[] = treeOf(root)): TemplateRecords {
  const pins: TemplatePin[] = [];
  const files: TemplateFileRecord[] = [];
  for (const entry of tree) {
    const workflow = isSharedFile(entry.path);
    const copy = kept(keep, entry.path);
    if ((!workflow && !copy) || entry.bytes > MAX_BYTES) continue;
    const text = readFileSync(join(root, entry.path), "utf8").replace(/\r\n/g, "\n");
    if (workflow) pins.push(...pinsOf(entry.path, text));
    if (copy) files.push({ path: entry.path, oid: entry.blob, hash: createHash("sha256").update(workflow ? workflowForm(text) : text).digest("hex") });
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

/** A ref that git can read safely: no `-` at the start, so git does not read it as an option. */
const SAFE_REF = /^[A-Za-z0-9_][\w.-]*$/;

/** A `uses:` line with a local path of a shared workflow or action of the template. */
const LOCAL_USE = /^[ \t]*(?:-[ \t]*)?uses:[ \t]*["']?\.\/(\.github\/[\w./-]+?)["']?[ \t]*(?:#.*)?$/gm;


/** This function gives the file of a target: a workflow is a file, and an action is a folder with its `action.yml`. */
export function fileOfTarget(target: string, paths: ReadonlySet<string>): string {
  if (yaml(target)) return target;
  let end = target.length;
  while (end > 0 && target[end - 1] === "/") end--;
  const folder = target.slice(0, end);
  return paths.has(`${folder}/action.yaml`) && !paths.has(`${folder}/action.yml`) ? `${folder}/action.yaml` : `${folder}/action.yml`;
}

/**
 * This function gives the content of each ref of `refs` in the template at `root`, and of its HEAD. It also gives
 * each file that each shared workflow and action uses at HEAD. A ref that git cannot read gives no version.
 */
export function templateVersionsOfRepo(root: string, refs: readonly string[], keep: readonly string[]): TemplateVersions {
  const git = (...args: string[]): string => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
  const head = git("rev-parse", "HEAD").trim();
  const versions: TemplateVersion[] = [];
  for (const ref of new Set([head, ...refs])) {
    if (!SAFE_REF.test(ref)) continue;
    try {
      const committedAt = git("log", "-1", "--format=%cI", "--end-of-options", ref).trim();
      const behind = Number(git("rev-list", "--count", "--end-of-options", `${ref}..${head}`).trim());
      const files = git("ls-tree", "-r", "--end-of-options", ref)
        .split("\n")
        .flatMap((line) => {
          const match = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line);
          return match?.[1] !== undefined && match[2] !== undefined && (isSharedFile(match[2]) || kept(keep, match[2])) ? [{ path: match[2], oid: match[1] }] : [];
        });
      versions.push({ ref, committedAt, behind, files });
    } catch {
      // A ref that is not in the history of the template: its content is not known
    }
  }
  const paths = new Set((versions[0]?.files ?? []).map((f) => f.path));
  const direct = new Map<string, string[]>();
  for (const path of paths) {
    if (!isSharedFile(path)) continue;
    const text = readFileSync(join(root, path), "utf8");
    direct.set(path, [...text.matchAll(LOCAL_USE)].flatMap((m) => (m[1] === undefined ? [] : [fileOfTarget(m[1], paths)])));
  }
  const uses: { target: string; path: string }[] = [];
  for (const target of direct.keys()) {
    const seen = new Set<string>([target]);
    const queue = [target];
    for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
      for (const used of direct.get(next) ?? []) {
        if (seen.has(used)) continue;
        seen.add(used);
        queue.push(used);
      }
    }
    for (const path of [...seen].sort(byText)) uses.push({ target, path });
  }
  return { versions, uses, changes: changesOf(git, versions) };
}

/**
 * This function gives the oldest change of each file that differs at a ref and at HEAD, the first version. It reads
 * one log for each ref, the oldest commit first, so the first commit with a file is its oldest change.
 */
function changesOf(git: (...args: string[]) => string, versions: readonly TemplateVersion[]): TemplateChange[] {
  const [head, ...refs] = versions;
  if (head === undefined) return [];
  const main = new Map(head.files.map((f) => [f.path, f.oid]));
  const changes: TemplateChange[] = [];
  for (const version of refs) {
    const oids = new Map(version.files.map((f) => [f.path, f.oid]));
    const differ = new Set([...main].filter(([path, oid]) => oids.get(path) !== oid).map(([path]) => path));
    if (differ.size === 0) continue;
    const log = git("log", "--reverse", "--no-renames", "--name-only", "--format=%x00%cI", "--end-of-options", `${version.ref}..${head.ref}`);
    for (const commit of log.split("\0")) {
      const [at, ...paths] = commit.split("\n").map((line) => line.trim());
      for (const path of paths) {
        if (at === undefined || !differ.delete(path)) continue;
        // The form of %cI differs by the version of git, so the time gets one form
        changes.push({ ref: version.ref, path, changedAt: new Date(at).toISOString() });
      }
    }
  }
  return changes.sort((a, b) => byText(a.ref, b.ref) || byText(a.path, b.path));
}

/** One repository that is not current, with the template files that differ from the commit of the template. */
export interface StaleRepo {
  readonly repo: string;
  /** The oldest pin with a file that differs. */
  readonly ref: string;
  /** The age of the commit of `ref` in days at the time of the scan, or `null` when the catalog does not know the ref. */
  readonly days: number | null;
  readonly files: readonly string[];
}

/** The share of the repositories that pin the template and are current. */
export interface PinFreshness {
  /** The commit of the template that the pins are compared with. */
  readonly commit: string | null;
  readonly current: readonly string[];
  readonly behind: readonly StaleRepo[];
  /** The count of the current repositories over the count of the repositories that pin the template. It is zero when no repository pins it. */
  readonly share: number;
}

const DAY_MS = 86_400_000;

/**
 * This function gives the pin freshness: the share of the current repositories. A repository uses its pinned
 * workflows and actions, and the files that they use. It is current when each of these files is the same at each
 * pin and at the commit of the template. The oldest repository comes first.
 */
export async function pinFreshness(q: CatalogQuery, template: string = TEMPLATE_REPO): Promise<PinFreshness> {
  const snapshot = await q.selectFrom("current_snapshot").select(["id", "commit", "scanned_at"]).where("repo", "=", template).executeTakeFirst();
  const id = snapshot?.id ?? "";
  const rows = await q.selectFrom("template_version").select(["ref", "committed_at", "path", "oid"]).where("snapshot", "=", id).execute();
  const versions = new Map<string, { committedAt: string; oids: Map<string, string> }>();
  for (const row of rows) {
    const version = versions.get(row.ref) ?? { committedAt: row.committed_at, oids: new Map<string, string>() };
    version.oids.set(row.path, row.oid);
    versions.set(row.ref, version);
  }
  const main = versions.get(snapshot?.commit ?? "");
  const paths = new Set(main?.oids.keys() ?? []);
  const usesOf = new Map<string, string[]>();
  for (const row of await q.selectFrom("template_use").select(["target", "path"]).where("snapshot", "=", id).execute()) usesOf.set(row.target, [...(usesOf.get(row.target) ?? []), row.path]);
  const pinsOfRepo = new Map<string, Map<string, Set<string>>>();
  for (const pin of await q.selectFrom("current_template_pin").select(["repo", "ref", "target"]).where("repo", "!=", template).execute()) {
    const refs = pinsOfRepo.get(pin.repo) ?? new Map<string, Set<string>>();
    const file = fileOfTarget(pin.target, paths);
    pinsOfRepo.set(pin.repo, refs.set(pin.ref, (refs.get(pin.ref) ?? new Set<string>()).add(file)));
  }
  const scanned = Date.parse(snapshot?.scanned_at ?? "");
  const daysOf = (ref: string): number | null => {
    const at = Date.parse(versions.get(ref)?.committedAt ?? "");
    return Number.isNaN(at) || Number.isNaN(scanned) ? null : Math.floor((scanned - at) / DAY_MS);
  };
  // An unknown ref is older than each known ref
  const age = (ref: string): number => daysOf(ref) ?? Number.POSITIVE_INFINITY;
  const current: string[] = [];
  const behind: StaleRepo[] = [];
  for (const [repo, refs] of pinsOfRepo) {
    const stale = new Map<string, string[]>();
    for (const [ref, targets] of refs) {
      const used = new Set([...targets].flatMap((target) => usesOf.get(target) ?? [target]));
      const version = versions.get(ref);
      const differ = [...used].filter((path) => version === undefined || version.oids.get(path) !== main?.oids.get(path));
      if (differ.length > 0) stale.set(ref, differ);
    }
    if (stale.size === 0) {
      current.push(repo);
      continue;
    }
    const ref = [...stale.keys()].sort((a, b) => age(b) - age(a) || byText(a, b))[0] ?? "";
    behind.push({ repo, ref, days: daysOf(ref), files: [...new Set([...stale.values()].flat())].sort(byText) });
  }
  return {
    commit: snapshot?.commit ?? null,
    current: current.sort(byText),
    behind: behind.sort((a, b) => (b.days ?? Number.POSITIVE_INFINITY) - (a.days ?? Number.POSITIVE_INFINITY) || byText(a.repo, b.repo)),
    share: pinsOfRepo.size === 0 ? 0 : current.length / pinsOfRepo.size,
  };
}

/** The lag of the oldest pin of one repository behind the commit of the template. */
export interface PinLag {
  readonly repo: string;
  /** The pin with the most commits of the template after it. */
  readonly ref: string;
  /** The count of the commits of the template after `ref`. */
  readonly behind: number;
  /** The days from the commit of `ref` to the commit of the template. */
  readonly days: number;
}

/** The lag of the pins of each repository that pins the template. */
export interface PinLags {
  readonly commit: string | null;
  /** The lag of each repository, the most commits behind first. */
  readonly repos: readonly PinLag[];
  /** The repositories with a pin that the catalog does not know. Their lag is not known. */
  readonly unknown: readonly string[];
  readonly median: { readonly behind: number; readonly days: number } | null;
}

/**
 * This function gives the lag of the pins. For each repository, it takes the pin with the most commits of the
 * template after it. It gives that lag in commits and in days. A new commit of the template adds one to each lag.
 * Thus the median measures the delay of the repositories, and not the activity of the template.
 */
export async function pinLag(q: CatalogQuery, template: string = TEMPLATE_REPO): Promise<PinLags> {
  const snapshot = await q.selectFrom("current_snapshot").select(["id", "commit"]).where("repo", "=", template).executeTakeFirst();
  const rows = await q.selectFrom("template_ref").select(["ref", "committed_at", "behind"]).where("snapshot", "=", snapshot?.id ?? "").execute();
  const refs = new Map(rows.map((r) => [r.ref, r]));
  const head = Date.parse(refs.get(snapshot?.commit ?? "")?.committed_at ?? "");
  const pinsOfRepo = new Map<string, Set<string>>();
  for (const pin of await q.selectFrom("current_template_pin").select(["repo", "ref"]).where("repo", "!=", template).execute()) {
    pinsOfRepo.set(pin.repo, (pinsOfRepo.get(pin.repo) ?? new Set<string>()).add(pin.ref));
  }
  const repos: PinLag[] = [];
  const unknown: string[] = [];
  for (const [repo, pins] of pinsOfRepo) {
    const known = [...pins].flatMap((ref) => {
      const row = refs.get(ref);
      return row === undefined ? [] : [row];
    });
    const oldest = known.sort((a, b) => b.behind - a.behind || byText(a.ref, b.ref))[0];
    if (known.length < pins.size || oldest === undefined || Number.isNaN(head)) {
      unknown.push(repo);
      continue;
    }
    const days = Math.max(0, Math.floor((head - Date.parse(oldest.committed_at)) / DAY_MS));
    repos.push({ repo, ref: oldest.ref, behind: oldest.behind, days });
  }
  repos.sort((a, b) => b.behind - a.behind || b.days - a.days || byText(a.repo, b.repo));
  return {
    commit: snapshot?.commit ?? null,
    repos,
    unknown: unknown.sort(byText),
    median: repos.length === 0 ? null : { behind: median(repos.map((r) => r.behind)), days: median(repos.map((r) => r.days)) },
  };
}

/** The limit of the gate of the pin age: the p90 of the repositories is at most this count of days. */
export const PIN_AGE_LIMIT = 3;

/** The pin age of one repository: the age of the oldest change of the template that it does not have. */
export interface RepoPinAge {
  readonly repo: string;
  /** The age in days of the oldest change that the repository does not have. It is 0 when the repository is current. */
  readonly days: number;
  /** The oldest change that the repository does not have, or `null` when the repository is current. */
  readonly oldest: { readonly ref: string; readonly path: string; readonly changedAt: string } | null;
}

/** The pin age of the repositories that pin the template, and the result of its gate. */
export interface PinAges {
  readonly commit: string | null;
  /** The time of the measure, in ISO 8601 form. */
  readonly at: string | null;
  readonly limit: number;
  /** The age of each repository, the oldest first. */
  readonly repos: readonly RepoPinAge[];
  /** The repositories with a pin that the catalog does not know. Their age is not known, so they do not count. */
  readonly unknown: readonly string[];
  /** The nearest-rank quantiles of the days of `repos`, or `null` when no repository counts. */
  readonly p50: number | null;
  readonly p90: number | null;
  /** The repositories with an age over `limit`, the oldest first. The sync of the template goes to them first. */
  readonly over: readonly RepoPinAge[];
  /** The gate passes when `p90` is at most `limit`. With no repository that counts, it fails. */
  readonly pass: boolean;
}

/** The options of `pinAge`. */
export interface PinAgeOptions {
  /** The time of the measure. The default is the time of the scan of the template. */
  readonly at?: string;
  readonly limit?: number;
  readonly template?: string;
}

/**
 * This function gives the pin age of each repository that pins the template. For each pin, it takes each used file
 * that differs at the pin and at the commit of the template. The age of the file is the age of the oldest commit of
 * the template after the pin that changes it. The age of a repository is the age of its oldest file, or 0.
 */
export async function pinAge(q: CatalogQuery, options: PinAgeOptions = {}): Promise<PinAges> {
  const template = options.template ?? TEMPLATE_REPO;
  const limit = options.limit ?? PIN_AGE_LIMIT;
  const snapshot = await q.selectFrom("current_snapshot").select(["id", "commit", "scanned_at"]).where("repo", "=", template).executeTakeFirst();
  const id = snapshot?.id ?? "";
  const versions = new Map<string, { committedAt: string; oids: Map<string, string> }>();
  for (const row of await q.selectFrom("template_version").select(["ref", "committed_at", "path", "oid"]).where("snapshot", "=", id).execute()) {
    const version = versions.get(row.ref) ?? { committedAt: row.committed_at, oids: new Map<string, string>() };
    versions.set(row.ref, version);
    version.oids.set(row.path, row.oid);
  }
  const changes = new Map<string, string>();
  for (const row of await q.selectFrom("template_change").select(["ref", "path", "changed_at"]).where("snapshot", "=", id).execute()) changes.set(`${row.ref}\n${row.path}`, row.changed_at);
  const main = versions.get(snapshot?.commit ?? "");
  const paths = new Set(main?.oids.keys() ?? []);
  const usesOf = new Map<string, string[]>();
  for (const row of await q.selectFrom("template_use").select(["target", "path"]).where("snapshot", "=", id).execute()) usesOf.set(row.target, [...(usesOf.get(row.target) ?? []), row.path]);
  const pinsOfRepo = new Map<string, Map<string, Set<string>>>();
  for (const pin of await q.selectFrom("current_template_pin").select(["repo", "ref", "target"]).where("repo", "!=", template).execute()) {
    const refs = pinsOfRepo.get(pin.repo) ?? new Map<string, Set<string>>();
    pinsOfRepo.set(pin.repo, refs.set(pin.ref, (refs.get(pin.ref) ?? new Set<string>()).add(fileOfTarget(pin.target, paths))));
  }
  const at = options.at ?? snapshot?.scanned_at ?? null;
  const now = Date.parse(at ?? "");
  const repos: RepoPinAge[] = [];
  const unknown: string[] = [];
  for (const [repo, refs] of pinsOfRepo) {
    if (main === undefined || Number.isNaN(now) || [...refs.keys()].some((ref) => !versions.has(ref))) {
      unknown.push(repo);
      continue;
    }
    let oldest: RepoPinAge["oldest"] = null;
    for (const [ref, targets] of refs) {
      const version = versions.get(ref);
      for (const path of new Set([...targets].flatMap((target) => usesOf.get(target) ?? [target]))) {
        if (version === undefined || version.oids.get(path) === main.oids.get(path)) continue;
        // A file with no change row is a file that git did not tell: the commit time of the pin is its upper bound
        const changedAt = changes.get(`${ref}\n${path}`) ?? version.committedAt;
        const older = oldest === null || Date.parse(changedAt) < Date.parse(oldest.changedAt) || (changedAt === oldest.changedAt && byText(`${ref} ${path}`, `${oldest.ref} ${oldest.path}`) < 0);
        if (older) oldest = { ref, path, changedAt };
      }
    }
    const days = oldest === null ? 0 : Math.max(0, Math.floor((now - Date.parse(oldest.changedAt)) / DAY_MS));
    repos.push({ repo, days, oldest });
  }
  repos.sort((a, b) => b.days - a.days || byText(a.repo, b.repo));
  const days = repos.map((r) => r.days);
  const p90 = days.length === 0 ? null : quantile(days, 0.9, "nearest-rank");
  return {
    commit: snapshot?.commit ?? null,
    at,
    limit,
    repos,
    unknown: unknown.sort(byText),
    p50: days.length === 0 ? null : quantile(days, 0.5, "nearest-rank"),
    p90,
    over: repos.filter((r) => r.days > limit),
    pass: p90 !== null && p90 <= limit,
  };
}

/** The path of the command of the stamp. Its option `--check` tells which files of `KEEP` the stamp changes in a repository. */
export const STAMP_MAIN = "scripts/stamp/main.ts";

/** One file of `KEEP` that the stamp changes in a repository, as `stamp --check` tells it. */
export interface StampFileCheck {
  readonly path: string;
  /** The state of the copy: `differs` or `missing`. */
  readonly state: string;
  /** The fields of a JSON copy that differ, for example `scripts.typecheck`. */
  readonly fields: readonly string[];
}

/** The result of `stamp --check` for one repository at one commit of the template. */
export interface StampCheck {
  readonly template: string;
  readonly files: readonly StampFileCheck[];
}

const linesOf = (out: unknown): string[] =>
  String(out ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

const fileCheckOf = (line: string): StampFileCheck | undefined => {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  const file = objectOf(value);
  const path = file?.["path"];
  const state = file?.["state"];
  const fields = file?.["fields"];
  if (typeof path !== "string" || typeof state !== "string") return undefined;
  return { path, state, fields: Array.isArray(fields) ? fields.filter((field): field is string => typeof field === "string") : [] };
};

/**
 * This function starts `stamp --check` of the template checkout `templateRoot` at the commit `sha` on the repository
 * `repoRoot`. Exit code 0 tells that the stamp changes no file. Exit code 1 gives one JSON line for each file that the
 * stamp changes. Each other result is an error.
 */
export function stampCheckOfRepo(templateRoot: string, repoRoot: string, sha: string): StampCheck | { readonly error: string } {
  if (!SAFE_REF.test(sha)) return { error: `the ref ${sha} is not safe` };
  try {
    execFileSync(process.execPath, [join(templateRoot, STAMP_MAIN), "--check", repoRoot, "--ref", sha], { cwd: templateRoot, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
    return { template: sha, files: [] };
  } catch (error) {
    const result = error as { readonly status?: number | null; readonly stdout?: unknown; readonly stderr?: unknown };
    const files = linesOf(result.stdout).flatMap((line) => fileCheckOf(line) ?? []);
    if (result.status === 1 && files.length > 0) return { template: sha, files: files.sort((x, y) => byText(x.path, y.path)) };
    const stderr = linesOf(result.stderr);
    return { error: stderr.find((line) => line.includes("Error")) ?? stderr[0] ?? `exit code ${result.status ?? "none"}` };
  }
}

/** The stamp freshness: the share of the repositories where `stamp --check` at the commit of the template changes no file. */
export interface StampFreshness {
  /** The commit of the template of the checks, or `null` when no repository has a check. */
  readonly commit: string | null;
  readonly current: readonly string[];
  /** Each repository where the stamp changes a file. */
  readonly behind: readonly { readonly repo: string; readonly files: readonly StampFileCheck[] }[];
  /** The repositories that pin the template and have no result of `stamp --check`. They do not count. */
  readonly unchecked: readonly string[];
  readonly share: number;
}

/**
 * This function gives the stamp freshness of the repositories that pin the template. A repository is current when
 * `stamp --check` changes no file. The repository with the most changes comes first.
 */
export async function stampFreshness(q: CatalogQuery, template: string = TEMPLATE_REPO): Promise<StampFreshness> {
  const drift = await templateDrift(q, template);
  const snapshots = new Map((await q.selectFrom("current_snapshot").select(["id", "repo"]).execute()).map((row) => [row.repo, row.id]));
  const checks = new Map((await q.selectFrom("stamp_check").select(["snapshot", "template"]).execute()).map((row) => [row.snapshot, row.template]));
  const files = new Map<string, StampFileCheck[]>();
  for (const row of await q.selectFrom("stamp_check_file").select(["snapshot", "path", "state", "fields"]).orderBy("path").execute()) {
    files.set(row.snapshot, [...(files.get(row.snapshot) ?? []), { path: row.path, state: row.state, fields: JSON.parse(row.fields) as string[] }]);
  }
  let commit: string | null = null;
  const current: string[] = [];
  const unchecked: string[] = [];
  const behind: { repo: string; files: StampFileCheck[] }[] = [];
  for (const { repo } of drift.repos) {
    const snapshot = snapshots.get(repo) ?? "";
    const sha = checks.get(snapshot);
    if (sha === undefined) {
      unchecked.push(repo);
      continue;
    }
    commit ??= sha;
    const changed = files.get(snapshot) ?? [];
    if (changed.length === 0) current.push(repo);
    else behind.push({ repo, files: changed });
  }
  const counted = current.length + behind.length;
  return {
    commit,
    current: current.sort(byText),
    behind: behind.sort((x, y) => y.files.length - x.files.length || byText(x.repo, y.repo)),
    unchecked: unchecked.sort(byText),
    share: counted === 0 ? 0 : current.length / counted,
  };
}

const short = (ref: string): string => (/^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref);

const code = (text: string): string => `\`${text}\``;

/**
 * This function gives the Markdown of the drift from the template. The pin age and its gate come first. The pin
 * freshness, the stamp freshness and the pin lag are readings beside it.
 */
export function driftMarkdown(pins: PinFreshness, stamp: StampFreshness, lag?: PinLags, age?: PinAges): string {
  const share = (current: number, behind: number, value: number): string => `**${current} of ${current + behind}** repositories (${Math.round(value * 100)}%)`;
  const at = pins.commit === null ? "the template" : `${code(short(pins.commit))} of the template`;
  const lines = ["## Drift from the template", ""];
  if (age !== undefined) {
    const value = (days: number | null): string => (days === null ? "not known" : `**${days} days**`);
    lines.push(
      `- Pin age, the measure of the gate: p50 ${value(age.p50)}, p90 ${value(age.p90)} over ${age.repos.length} repositories. The gate is p90 at most ${age.limit} days: **${age.pass ? "pass" : "fail"}**.`,
      `  The age of a repository is the age of the oldest change of the template to a pinned file that it does not have. It is 0 when the repository is current.`,
    );
    if (age.unknown.length > 0) lines.push(`- Age not known: ${age.unknown.map(code).join(", ")}. The catalog does not know a pin of these repositories, so they do not count.`);
  }
  lines.push(
    `- Pin freshness: ${share(pins.current.length, pins.behind.length, pins.share)}. Each pinned workflow and action, and each file that it uses, is the same at the pins and at ${at}.`,
    `- Stamp freshness: ${share(stamp.current.length, stamp.behind.length, stamp.share)}. For each current repository, ${code("stamp --check")} at ${stamp.commit === null ? "the template" : `${code(short(stamp.commit))} of the template`} changes no file.`,
  );
  if (stamp.unchecked.length > 0) lines.push(`- Not checked: ${stamp.unchecked.map(code).join(", ")}. ${code("stamp --check")} gave no result, so these repositories do not count.`);
  const worst = lag?.repos[0];
  if (lag?.median !== undefined && lag.median !== null && worst !== undefined) {
    lines.push(
      `- Pin lag: with its oldest pin, the median repository is **${lag.median.behind} commits** and **${lag.median.days} days** behind ${at}. The worst is ${worst.repo}, with ${worst.behind} commits and ${worst.days} days.`,
    );
  }
  if (lag !== undefined && lag.unknown.length > 0) lines.push(`- Lag not known: ${lag.unknown.map(code).join(", ")}. The catalog does not know a pin of these repositories.`);
  lines.push("");
  if (age !== undefined && age.over.length > 0) {
    lines.push(`### Over the line of ${age.limit} days`, "", "The sync of the template goes to these repositories first.", "", "| Repository | Age in days | Oldest change that it does not have | Pin |", "| --- | ---: | --- | --- |");
    for (const r of age.over) lines.push(`| ${r.repo} | ${r.days} | ${r.oldest === null ? "" : `${code(r.oldest.path)}, ${r.oldest.changedAt.slice(0, 10)}`} | ${r.oldest === null ? "" : code(short(r.oldest.ref))} |`);
    lines.push("");
  }
  if (lag !== undefined && lag.repos.length > 0) {
    lines.push("### Pin lag", "", "| Repository | Oldest pin | Commits behind | Days behind |", "| --- | --- | ---: | ---: |");
    for (const r of lag.repos) lines.push(`| ${r.repo} | ${code(short(r.ref))} | ${r.behind} | ${r.days} |`);
    lines.push("");
  }
  if (pins.behind.length > 0) {
    lines.push("### Pins behind", "", "| Repository | Oldest pin with a change | Age in days | Files that differ |", "| --- | --- | ---: | --- |");
    for (const b of pins.behind) lines.push(`| ${b.repo} | ${code(short(b.ref))} | ${b.days ?? "not known"} | ${b.files.map(code).join(", ")} |`);
    lines.push("");
  }
  if (stamp.behind.length > 0) {
    lines.push("### Copies behind", "", "| Repository | Files that the stamp changes |", "| --- | --- |");
    const file = (f: StampFileCheck): string => `${code(f.path)} (${f.state}${f.fields.length > 0 ? `: ${f.fields.map(code).join(", ")}` : ""})`;
    for (const b of stamp.behind) lines.push(`| ${b.repo} | ${b.files.map(file).join(", ")} |`);
    lines.push("");
  }
  return lines.join("\n");
}
