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
  /** Each workflow and action of `.github/`, and each file of `KEEP`, with its blob. */
  readonly files: readonly { readonly path: string; readonly oid: string }[];
}

/** The template records that tell the content of each pin. Only the scan of the template makes them. */
export interface TemplateVersions {
  readonly versions: readonly TemplateVersion[];
  /** Each file that a shared workflow or action uses, at the commit of the template. A target uses itself. */
  readonly uses: readonly { readonly target: string; readonly path: string }[];
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

/** The kinds of the rule of the stamp for one file of `KEEP`. */
export const STAMP_RULES = ["whole", "pinned", "merged"] as const;

export type StampRuleKind = (typeof STAMP_RULES)[number];

/**
 * The rule of the stamp for one file of `KEEP`. A `whole` file is a copy. A `pinned` file is a workflow with its
 * pins to the commit of the template. A `merged` file is a JSON copy where the stamp sets `fields` for each repository.
 */
export interface StampRule {
  readonly path: string;
  readonly rule: StampRuleKind;
  readonly fields: readonly string[];
}

/** The rules of the stamp. A file of `KEEP` with no rule has a state that is not known. */
export interface StampRules {
  readonly rules: readonly StampRule[];
  /** The fixes of the conventions that the stamp starts on a new repository, for example `runner-budget`. */
  readonly fixes: readonly string[];
}

/** The fix of the conventions that sets the minutes of the schedules of each repository. */
export const SCHEDULE_FIX = "runner-budget";

const walk = (value: unknown, visit: (node: SwcNode) => void): void => {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const node = nodeOf(value);
  if (node !== undefined) visit(node);
  for (const child of Object.values(value)) walk(child, visit);
};

const unwrap = (value: unknown): SwcNode | undefined => {
  const node = nodeOf(value);
  return node?.type === "TsAsExpression" || node?.type === "TsConstAssertion" || node?.type === "ParenthesisExpression" ? unwrap(node["expression"]) : node;
};

const argumentOf = (call: SwcNode | undefined, index: number): SwcNode | undefined => unwrap((call?.["arguments"] as { expression?: unknown }[] | undefined)?.[index]?.expression);

const nameOf = (value: unknown): string | undefined => {
  const node = unwrap(value);
  return node?.type === "Identifier" && typeof node["value"] === "string" ? node["value"] : undefined;
};

const stringOf = (value: unknown): string | undefined => {
  const node = unwrap(value);
  return node?.type === "StringLiteral" && typeof node["value"] === "string" ? node["value"] : undefined;
};

/** This function gives the name of a call `object.name(...)`, or of a call `name(...)`. */
const calleeOf = (call: SwcNode | undefined): string | undefined => {
  if (call?.type !== "CallExpression") return undefined;
  const callee = unwrap(call["callee"]);
  return callee?.type === "MemberExpression" ? nameOf(callee["property"]) : nameOf(callee);
};

/**
 * This function reads the rules of the stamp from its text. The loop over `KEEP` copies each file whole, or
 * through `pinWorkflow` for the paths of a `startsWith` test. A file that the stamp reads with `JSON.parse` and
 * changes gets the fields that the stamp sets.
 */
export function stampRulesOf(text: string, keep: readonly string[]): StampRules {
  const module = parseSync(text, { syntax: "typescript" });
  let copied = false;
  const pinned: string[] = [];
  const fileOf = new Map<string, string>();
  const jsonOf = new Map<string, string>();
  const fields = new Map<string, Set<string>>();
  const fixes: string[] = [];
  walk(module, (node) => {
    if (node.type === "ForOfStatement" && nameOf(node["right"]) === "KEEP") {
      walk(node["body"], (inner) => {
        if (inner.type !== "ConditionalExpression") return;
        const test = unwrap(inner["test"]);
        const prefix = calleeOf(test) === "startsWith" ? stringOf(argumentOf(test, 0)) : undefined;
        if (prefix !== undefined && calleeOf(unwrap(inner["consequent"])) === "pinWorkflow") pinned.push(prefix);
      });
      copied = true;
    }
    if (node.type === "VariableDeclarator") {
      const id = nameOf(node["id"]);
      const init = unwrap(node["init"]);
      const last = (init?.["arguments"] as unknown[] | undefined)?.length ?? 0;
      const path = calleeOf(init) === "join" ? stringOf(argumentOf(init, last - 1)) : undefined;
      if (id !== undefined && path !== undefined && keep.includes(path)) fileOf.set(id, path);
      const read = calleeOf(init) === "parse" ? argumentOf(init, 0) : undefined;
      const file = calleeOf(read) === "readFileSync" ? fileOf.get(nameOf(argumentOf(read, 0)) ?? "") : undefined;
      if (id !== undefined && file !== undefined) jsonOf.set(id, file);
    }
    if (node.type === "AssignmentExpression") {
      const left = unwrap(node["left"]);
      const file = left?.type === "MemberExpression" ? jsonOf.get(nameOf(left["object"]) ?? "") : undefined;
      const field = left?.type === "MemberExpression" ? nameOf(left["property"]) : undefined;
      if (file !== undefined && field !== undefined) fields.set(file, (fields.get(file) ?? new Set<string>()).add(field));
    }
    if (node.type === "ArrayExpression") {
      const items = ((node["elements"] as ({ expression?: unknown } | null)[] | undefined) ?? []).map((element) => stringOf(element?.expression));
      items.forEach((item, index) => {
        const rule = items[index + 1];
        if (item === "--rule" && rule !== undefined) fixes.push(rule);
      });
    }
  });
  const rules: StampRule[] = copied
    ? keep.map((path) => {
        const set = fields.get(path);
        if (set !== undefined) return { path, rule: "merged", fields: [...set].sort(byText) };
        return { path, rule: pinned.some((prefix) => path.startsWith(prefix)) ? "pinned" : "whole", fields: [] };
      })
    : [];
  return { rules, fixes: [...new Set(fixes)].sort(byText) };
}

/** This function gives the rules of the stamp of the template checkout `root`. */
export function stampRulesOfRepo(root: string, keep: readonly string[]): StampRules {
  try {
    return stampRulesOf(readFileSync(join(root, STAMP_PATH), "utf8"), keep);
  } catch {
    return { rules: [], fixes: [] };
  }
}

/**
 * This function gives the form of a copy of a file of `KEEP` that the stamp freshness compares, by the rule of the
 * stamp. A pinned workflow gives its `workflowForm`. A merged JSON file loses the fields that the stamp sets. A whole
 * file gives its text.
 */
export function copyForm(path: string, text: string, rules: StampRules | undefined): string {
  const rule = rules?.rules.find((r) => r.path === path);
  if (rule === undefined) return isSharedFile(path) ? workflowForm(text) : text;
  if (rule.rule === "pinned") return workflowForm(text, { schedules: rules?.fixes.includes(SCHEDULE_FIX) ?? false });
  if (rule.rule === "merged") {
    try {
      const json = objectOf(JSON.parse(text));
      if (json === undefined) return text;
      for (const field of rule.fields) delete json[field];
      return JSON.stringify(sorted(json));
    } catch {
      return text;
    }
  }
  return text;
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
 * template goes, with its name in each `needs`. With `schedules`, the minute of each cron goes. A text that does not
 * parse gives its `localForm`.
 */
export function workflowForm(text: string, options: { readonly schedules?: boolean } = {}): string {
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
  // The fix of the schedules sets the minute of each cron for each repository
  const schedules = options.schedules === true ? objectOf(objectOf(workflow)?.["on"])?.["schedule"] : undefined;
  for (const entry of Array.isArray(schedules) ? schedules : []) {
    const e = objectOf(entry);
    if (e !== undefined && typeof e["cron"] === "string") e["cron"] = e["cron"].trim().replace(/^\S+/, "*");
  }
  return JSON.stringify(sorted(workflow));
}

const kept = (keep: readonly string[], path: string): boolean => keep.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry));

/**
 * This function gives the template records of one repository: each pin in its workflows, and each file of `keep`
 * that it has. The hash of a copy is the hash of its `copyForm`. The worktree must be a clean checkout of HEAD.
 */
export function templateRecordsOfRepo(root: string, keep: readonly string[], tree: readonly TreeEntry[] = treeOf(root), rules?: StampRules): TemplateRecords {
  const pins: TemplatePin[] = [];
  const files: TemplateFileRecord[] = [];
  for (const entry of tree) {
    const workflow = isSharedFile(entry.path);
    const copy = kept(keep, entry.path);
    if ((!workflow && !copy) || entry.bytes > MAX_BYTES) continue;
    const text = readFileSync(join(root, entry.path), "utf8").replace(/\r\n/g, "\n");
    if (workflow) pins.push(...pinsOf(entry.path, text));
    if (copy) files.push({ path: entry.path, oid: entry.blob, hash: createHash("sha256").update(copyForm(entry.path, text, rules)).digest("hex") });
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
      const files = git("ls-tree", "-r", "--end-of-options", ref)
        .split("\n")
        .flatMap((line) => {
          const match = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line);
          return match?.[1] !== undefined && match[2] !== undefined && (isSharedFile(match[2]) || kept(keep, match[2])) ? [{ path: match[2], oid: match[1] }] : [];
        });
      versions.push({ ref, committedAt, files });
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
  return { versions, uses };
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

/** The stamp freshness: the share of the repositories with copies of `KEEP` that are the same as the template by the rules of the stamp. */
export interface StampFreshness {
  readonly rules: readonly StampRule[];
  readonly fixes: readonly string[];
  readonly current: readonly string[];
  /** Each repository with a copy that is changed or missing. */
  readonly behind: readonly { readonly repo: string; readonly files: readonly { readonly path: string; readonly state: DriftState }[] }[];
  /** The files of `KEEP` with no rule of the stamp. Their state is not known, so they do not count. */
  readonly unknown: readonly string[];
  readonly share: number;
}

/**
 * This function gives the stamp freshness. Each copy of a file of `KEEP` with a rule of the stamp is compared by that
 * rule. A repository is current when each of these copies is the same as the template. The most changes come first.
 */
export async function stampFreshness(q: CatalogQuery, template: string = TEMPLATE_REPO): Promise<StampFreshness> {
  const snapshot = await q.selectFrom("current_snapshot").select("id").where("repo", "=", template).executeTakeFirst();
  const rows = await q.selectFrom("stamp_rule").select(["path", "rule", "fields"]).where("snapshot", "=", snapshot?.id ?? "").orderBy("path").execute();
  const rules = rows.filter((r) => r.path !== "").map((r) => ({ path: r.path, rule: r.rule as StampRuleKind, fields: JSON.parse(r.fields) as string[] }));
  const fixes = rows.filter((r) => r.path === "").map((r) => r.rule);
  const ruled = new Set(rules.map((r) => r.path));
  const drift = await templateDrift(q, template);
  const unknown = new Set<string>();
  const current: string[] = [];
  const behind: { repo: string; files: { path: string; state: DriftState }[] }[] = [];
  for (const repo of drift.repos) {
    for (const f of repo.files) if (!ruled.has(f.path)) unknown.add(f.path);
    const files = repo.files.filter((f) => ruled.has(f.path) && f.state !== "same");
    if (files.length === 0) current.push(repo.repo);
    else behind.push({ repo: repo.repo, files });
  }
  return {
    rules,
    fixes,
    current: current.sort(byText),
    behind: behind.sort((a, b) => b.files.length - a.files.length || byText(a.repo, b.repo)),
    unknown: [...unknown].sort(byText),
    share: drift.repos.length === 0 ? 0 : current.length / drift.repos.length,
  };
}

const short = (ref: string): string => (/^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref);

const code = (text: string): string => `\`${text}\``;

/** This function gives the Markdown of the drift from the template: the pin freshness, the stamp freshness and the changed copies. */
export function driftMarkdown(pins: PinFreshness, stamp: StampFreshness): string {
  const share = (current: number, behind: number, value: number): string => `**${current} of ${current + behind}** repositories (${Math.round(value * 100)}%)`;
  const at = pins.commit === null ? "the template" : `${code(short(pins.commit))} of the template`;
  const lines = [
    "## Drift from the template",
    "",
    `- Pin freshness: ${share(pins.current.length, pins.behind.length, pins.share)}. Each pinned workflow and action, and each file that it uses, is the same at the pins and at ${at}.`,
    `- Stamp freshness (provisional: the rules come from the syntax tree of the stamp): ${share(stamp.current.length, stamp.behind.length, stamp.share)}. Each copy of a file of the stamp is the same as the template, by the rule of the stamp for the file.`,
    "",
  ];
  if (pins.behind.length > 0) {
    lines.push("### Pins behind", "", "| Repository | Oldest pin with a change | Age in days | Files that differ |", "| --- | --- | ---: | --- |");
    for (const b of pins.behind) lines.push(`| ${b.repo} | ${code(short(b.ref))} | ${b.days ?? "not known"} | ${b.files.map(code).join(", ")} |`);
    lines.push("");
  }
  if (stamp.behind.length > 0) {
    lines.push("### Copies behind", "", "| Repository | Copies that differ |", "| --- | --- |");
    for (const b of stamp.behind) lines.push(`| ${b.repo} | ${b.files.map((f) => `${code(f.path)} (${f.state})`).join(", ")} |`);
    lines.push("");
  }
  lines.push("### The rules of the stamp", "", "| File | Rule | Fields that the stamp sets |", "| --- | --- | --- |");
  for (const r of stamp.rules) lines.push(`| ${code(r.path)} | ${r.rule} | ${r.fields.map(code).join(", ")} |`);
  for (const path of stamp.unknown) lines.push(`| ${code(path)} | not known | |`);
  lines.push("");
  if (stamp.fixes.includes(SCHEDULE_FIX)) lines.push(`The stamp starts the fix ${code(SCHEDULE_FIX)}, so the minute of each schedule of a pinned workflow does not count.`, "");
  return lines.join("\n");
}
