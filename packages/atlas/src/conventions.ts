/**
 * The breaks of the conventions in each repository (CA11). The scan starts each rule of `@mark1russell7/conventions`
 * on the checkout of each repository, and the catalog keeps the status of each rule and each break.
 */
import { createRequire } from "node:module";
import { RULES, runChecks } from "@mark1russell7/conventions";
import type { CatalogQuery } from "./query.ts";

/** The version of `@mark1russell7/conventions` that the scan uses. */
export const CONVENTIONS_VERSION: string = (createRequire(import.meta.url)("@mark1russell7/conventions/package.json") as { version: string }).version;

/**
 * The status of a rule: `pass`, `break`, `warn`, `off`, `skipped` or `error`, as `conventions check` gives it. A rule with the
 * status `warn` has breaks before the day that the rule starts to fail. The catalog counts these breaks as breaks.
 */
export type RuleStatus = "pass" | "break" | "warn" | "off" | "skipped" | "error";

/** One break of a rule. */
export interface ConventionsBreak {
  readonly file: string;
  readonly line: number | null;
  readonly message: string;
  /** True when `conventions fix` can write the fix. */
  readonly fixable: boolean;
}

/** The result of one rule in one repository. */
export interface ConventionsRule {
  readonly rule: string;
  readonly status: RuleStatus;
  readonly ignored: number;
  readonly note: string | null;
  readonly breaks: readonly ConventionsBreak[];
}

/** The result of the conventions check of one repository. */
export interface ConventionsCheck {
  readonly version: string;
  readonly rules: readonly ConventionsRule[];
}

/**
 * The rules that need an install of the packages of the repository. The clones of the scan have no install, so these
 * rules only find the missing packages. The scan skips them and keeps a note.
 */
export const INSTALL_RULES: readonly string[] = ["typed-files"];

const INSTALL_NOTE = "the rule needs an install of the packages, and the clone of the scan has none";

/**
 * This function starts each rule on the checkout `root`, except the rules of `INSTALL_RULES`. The environment is empty, so the variables of the CI job of
 * the scan do not change the rules. The rules that examine a change have no base, so they skip.
 */
export function conventionsCheckOfRepo(root: string): ConventionsCheck | { readonly error: string } {
  try {
    const result = runChecks({ root, env: {}, rules: RULES.filter((rule) => !INSTALL_RULES.includes(rule.id)) });
    const skipped = RULES.filter((rule) => INSTALL_RULES.includes(rule.id)).map(
      (rule): ConventionsRule => ({ rule: rule.id, status: "skipped", ignored: 0, note: INSTALL_NOTE, breaks: [] }),
    );
    const rules = result.rules.map(
      (rule): ConventionsRule => ({
        rule: rule.id,
        status: rule.status,
        ignored: rule.ignored,
        note: rule.note ?? null,
        breaks: rule.breaks.map((b) => ({ file: b.file, line: b.line ?? null, message: b.message, fixable: (b.edits?.length ?? 0) > 0 })),
      }),
    );
    return { version: CONVENTIONS_VERSION, rules: [...rules, ...skipped].sort((a, b) => a.rule.localeCompare(b.rule)) };
  } catch (error) {
    return { error: error instanceof Error ? error.message.split("\n")[0]! : String(error) };
  }
}

/** The breaks of one rule over the repositories. */
export interface RuleBreaks {
  readonly rule: string;
  /** The repositories with a break of the rule. */
  readonly repos: readonly string[];
  readonly breaks: number;
  /** The breaks that `conventions fix` can write. */
  readonly fixable: number;
  /** The repositories where the rule threw. */
  readonly errors: readonly string[];
}

/** The conventions breaks of the current snapshots. */
export interface ConventionsBreaks {
  /** The version of the conventions of the newest check. */
  readonly version: string | null;
  /** The count of the repositories with a check. */
  readonly checked: number;
  /** The repositories with a check, no break and no rule that threw. */
  readonly clean: readonly string[];
  /** The repositories with a break, with the count of their breaks. */
  readonly broken: readonly { readonly repo: string; readonly breaks: number; readonly rules: number }[];
  /** The repositories with no check. */
  readonly unchecked: readonly string[];
  /** The rules with a break or an error, the most repositories first. */
  readonly rules: readonly RuleBreaks[];
  /** The part of the checked repositories with no break, from 0 to 1. */
  readonly share: number;
}

/** This function gives the conventions breaks of the current snapshots. */
export async function conventionsBreaks(q: CatalogQuery): Promise<ConventionsBreaks> {
  const snapshots = await q.selectFrom("current_snapshot").select(["id", "repo"]).orderBy("repo").execute();
  const checks = new Map((await q.selectFrom("conventions_check").select(["snapshot", "version"]).execute()).map((row) => [row.snapshot, row.version]));
  const repoOf = new Map(snapshots.map((s) => [s.id, s.repo]));
  const rules = new Map<string, { repos: Set<string>; breaks: number; fixable: number; errors: Set<string> }>();
  const ofRule = (rule: string) => rules.get(rule) ?? rules.set(rule, { repos: new Set(), breaks: 0, fixable: 0, errors: new Set() }).get(rule)!;
  const perRepo = new Map<string, { breaks: number; rules: Set<string> }>();
  for (const row of await q.selectFrom("conventions_break").select(["snapshot", "rule", "fixable"]).execute()) {
    const repo = repoOf.get(row.snapshot);
    if (repo === undefined || !checks.has(row.snapshot)) continue;
    const entry = ofRule(row.rule);
    entry.repos.add(repo);
    entry.breaks++;
    entry.fixable += row.fixable;
    const mine = perRepo.get(repo) ?? perRepo.set(repo, { breaks: 0, rules: new Set() }).get(repo)!;
    mine.breaks++;
    mine.rules.add(row.rule);
  }
  const failing = new Set<string>();
  for (const row of await q.selectFrom("conventions_rule").select(["snapshot", "rule"]).where("status", "=", "error").execute()) {
    const repo = repoOf.get(row.snapshot);
    if (repo === undefined || !checks.has(row.snapshot)) continue;
    ofRule(row.rule).errors.add(repo);
    failing.add(repo);
  }
  const checked = snapshots.filter((s) => checks.has(s.id));
  const versions = [...new Set(checked.map((s) => checks.get(s.id)!))].sort();
  const clean = checked.filter((s) => !perRepo.has(s.repo) && !failing.has(s.repo)).map((s) => s.repo);
  const broken = [...perRepo]
    .map(([repo, v]) => ({ repo, breaks: v.breaks, rules: v.rules.size }))
    .sort((a, b) => b.breaks - a.breaks || a.repo.localeCompare(b.repo));
  return {
    version: versions.at(-1) ?? null,
    checked: checked.length,
    clean,
    broken,
    unchecked: snapshots.filter((s) => !checks.has(s.id)).map((s) => s.repo),
    rules: [...rules]
      .map(([rule, v]) => ({ rule, repos: [...v.repos].sort(), breaks: v.breaks, fixable: v.fixable, errors: [...v.errors].sort() }))
      .sort((a, b) => b.repos.length - a.repos.length || b.breaks - a.breaks || a.rule.localeCompare(b.rule)),
    share: checked.length === 0 ? 0 : clean.length / checked.length,
  };
}

const percent = (share: number): string => `${Math.round(share * 100)}%`;

/** This function writes the conventions breaks as Markdown for the summary of the CI job. */
export function conventionsMarkdown(breaks: ConventionsBreaks): string {
  const version = breaks.version === null ? "" : ` ${breaks.version}`;
  const lines = [
    "## Conventions breaks",
    "",
    `- Clean: **${breaks.clean.length} of ${breaks.checked}** repositories (${percent(breaks.share)}). In each clean repository, \`conventions check\`${version} finds no break, and no rule throws.`,
  ];
  if (breaks.unchecked.length > 0) lines.push(`- Not checked: ${breaks.unchecked.map((r) => `\`${r}\``).join(", ")}.`);
  lines.push("- The rules that examine a change skip, because the scan gives them no base.");
  lines.push(`- The rules that need an install of the packages skip, because the clones of the scan have none: ${INSTALL_RULES.map((r) => `\`${r}\``).join(", ")}.`);
  if (breaks.rules.length > 0) {
    lines.push("", "### Breaks of each rule", "", "| Rule | Repositories | Breaks | Fixable | Errors |", "| --- | ---: | ---: | ---: | --- |");
    for (const r of breaks.rules) lines.push(`| \`${r.rule}\` | ${r.repos.length} | ${r.breaks} | ${r.fixable} | ${r.errors.join(", ")} |`);
  }
  if (breaks.broken.length > 0) {
    lines.push("", "### Breaks of each repository", "", "| Repository | Breaks | Rules |", "| --- | ---: | ---: |");
    for (const r of breaks.broken) lines.push(`| ${r.repo} | ${r.breaks} | ${r.rules} |`);
  }
  return `${lines.join("\n")}\n`;
}
