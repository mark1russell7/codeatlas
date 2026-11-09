/**
 * Formula skeletons (CA15 of `docs/ROADMAP.md`): the arithmetic expressions of each function, with each operand
 * replaced by one token. Two repositories with one skeleton of 3 or more arithmetic operators often have one formula.
 * Examples are a Gaussian draw, a hash step and a distance on a sphere. A class is a lead to read, not a move.
 * The scan costs no model tokens. The owners judge the leads, and their verdicts give the precision.
 */
import { createHash } from "node:crypto";
import { findHomes } from "@mark1russell7/conventions";
import { wilson } from "@mark1russell7/rigor-statistics";
import { wordsOf } from "./atlas.ts";
import type { CatalogQuery } from "./query.ts";
import { isNode, type AstNode } from "./shape.ts";

/** The version of the class report. A new version changes the classes, the stop list or the recall rule. */
export const FORMULAS_VERSION: string = "formulas/1";

/** The catalog keeps each expression with this many arithmetic operators or more. */
export const FORMULA_MIN_RECORD: number = 2;

/** A class with this many arithmetic operators or more is a lead for the owners. */
export const FORMULA_MIN_LEAD: number = 3;

/** The owners keep the scan in Layer 1 when the Wilson lower bound of the copy precision is this value or more. */
export const FORMULA_COPY_GATE: number = 0.5;

/** The leads name a home when the Wilson lower bound of the home precision is this value or more. */
export const FORMULA_HOME_GATE: number = 0.25;

/** The leads name all the members of a class when the Wilson lower bound of the member precision is this value or more. */
export const FORMULA_MEMBER_GATE: number = 0.5;

/** The longest skeleton text that the catalog keeps. The hash is of the full text. */
const MAX_SKELETON = 300;

/** The globals whose members stay in the skeleton: `Math.sqrt` tells more than a name. */
const GLOBALS: ReadonlySet<string> = new Set(["Math", "Number", "Object", "Array", "JSON", "Date", "String", "Promise"]);

/** The binary operators that count as arithmetic. */
const ARITHMETIC: ReadonlySet<string> = new Set(["**", "*", "/", "%", "-", "+", "^", "&", "|", "<<", ">>", ">>>"]);

/** The TypeScript nodes that wrap an expression and add nothing to its value. */
const WRAPPERS: ReadonlySet<string> = new Set(["ParenthesisExpression", "TsAsExpression", "TsNonNullExpression", "TsSatisfiesExpression", "TsTypeAssertion", "TsConstAssertion"]);

/** The skeleton of one expression. */
export interface Skeleton {
  readonly text: string;
  /** The arithmetic operators plus each member of `Math`. */
  readonly arith: number;
}

/** One expression of a file with 2 or more arithmetic operators. */
export interface FormulaFact {
  readonly line: number;
  /** The first 16 hexadecimal digits of the SHA-256 of the full skeleton text. */
  readonly hash: string;
  /** The skeleton text, at most 300 characters. */
  readonly skeleton: string;
  readonly arith: number;
}

const nameOf = (node: unknown): string => (isNode(node) ? String(node["value"] ?? "") : "");

/**
 * This function gives the skeleton of an expression. It gives `undefined` for a part that is not a name, a number,
 * an operator, a call or a condition. A string literal also gives `undefined`: `+` of a string joins text.
 */
export function skeletonOf(node: AstNode): Skeleton | undefined {
  const out: string[] = [];
  let arith = 0;
  const walk = (n: AstNode): boolean => {
    if (WRAPPERS.has(n.type)) return isNode(n["expression"]) && walk(n["expression"]);
    switch (n.type) {
      case "Identifier":
      case "ThisExpression":
      case "BooleanLiteral":
      case "NullLiteral":
      case "BigIntLiteral":
        out.push("V");
        return true;
      case "NumericLiteral":
        out.push(`N:${String(n["value"])}`);
        return true;
      case "MemberExpression": {
        const object = n["object"];
        if (isNode(object) && object.type === "Identifier" && GLOBALS.has(nameOf(object))) {
          const member = `${nameOf(object)}.${nameOf(n["property"])}`;
          if (nameOf(object) === "Math") arith += 1;
          out.push(`G:${member}`);
        } else out.push("V");
        return true;
      }
      case "BinaryExpression": {
        const operator = String(n["operator"]);
        if (ARITHMETIC.has(operator)) arith += 1;
        out.push(`(${operator}`);
        if (!isNode(n["left"]) || !walk(n["left"]) || !isNode(n["right"]) || !walk(n["right"])) return false;
        out.push(")");
        return true;
      }
      case "UnaryExpression": {
        out.push(`u${String(n["operator"])}`);
        return isNode(n["argument"]) && walk(n["argument"]);
      }
      case "ConditionalExpression": {
        out.push("(?");
        for (const field of ["test", "consequent", "alternate"]) if (!isNode(n[field]) || !walk(n[field] as AstNode)) return false;
        out.push(")");
        return true;
      }
      case "CallExpression": {
        out.push("call(");
        if (!isNode(n["callee"]) || !walk(n["callee"])) return false;
        for (const arg of (n["arguments"] as readonly { readonly spread?: unknown; readonly expression?: unknown }[] | undefined) ?? []) {
          if (arg.spread !== undefined && arg.spread !== null) return false;
          if (!isNode(arg.expression) || !walk(arg.expression)) return false;
        }
        out.push(")");
        return true;
      }
      default:
        return false;
    }
  };
  if (!walk(node)) return undefined;
  return { text: out.join(" "), arith };
}

/** This function gives the hash of a skeleton text: the first 16 hexadecimal digits of its SHA-256. */
export function formulaHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** This function gives the formula fact of an expression, or `undefined` when it has fewer than 2 arithmetic operators. */
export function formulaOf(node: AstNode, line: number): FormulaFact | undefined {
  if (!node.type.endsWith("Expression") || WRAPPERS.has(node.type)) return undefined;
  const skeleton = skeletonOf(node);
  if (skeleton === undefined || skeleton.arith < FORMULA_MIN_RECORD) return undefined;
  return { line, hash: formulaHash(skeleton.text), skeleton: skeleton.text.slice(0, MAX_SKELETON), arith: skeleton.arith };
}

/** A generic form: many repositories write it on their own, so a class of it is not a copy. */
export interface GenericFormula {
  readonly skeleton: string;
  readonly reason: string;
}

/** The stop list: the generic forms of the prototype read (CA15). A class with one of these skeletons is not a lead. */
export const GENERIC_FORMULAS: readonly GenericFormula[] = [
  { skeleton: "(* (/ (- V V ) V ) N:100 )", reason: "The percent change of two values." },
  { skeleton: "call( G:Math.floor (/ (- V V ) V ) )", reason: "The number of whole steps between two values." },
  { skeleton: "(+ call( G:Math.floor (/ V V ) ) N:1 )", reason: "A count of pages or buckets." },
  { skeleton: "(- (/ V V ) (/ V V ) )", reason: "The difference of two ratios." },
  { skeleton: "(* (- V V ) (- V V ) )", reason: "The product of two differences, as in an area or a square." },
  { skeleton: "call( G:Math.round (/ (- call( G:Date.now ) V ) N:1000 ) )", reason: "The seconds since a time." },
  { skeleton: "call( G:Math.min (- V N:1 ) call( G:Math.max N:0 (+ V V ) ) )", reason: "An index clamped to a list." },
  { skeleton: "(* (/ (- V V ) V ) V )", reason: "A linear scale of a value from one range to another." },
];

/** One place of a formula in the current snapshots. */
export interface FormulaMember {
  readonly repo: string;
  readonly path: string;
  readonly line: number;
  /** The qualified name of the innermost function that holds the formula, or null. */
  readonly fn: string | null;
  /** The first and the last line of that function, or null. */
  readonly fnLines: readonly [number, number] | null;
}

/** A formula row of the catalog, with its place. */
export interface FormulaRow extends FormulaMember {
  readonly hash: string;
  readonly skeleton: string;
  readonly arith: number;
}

/** The home of a class, from `findHomes` of `@mark1russell7/conventions`. */
export interface FormulaHome {
  readonly area: string;
  readonly packages: readonly string[];
}

/** One skeleton in two repositories or more: a lead to read. */
export interface FormulaClass {
  readonly hash: string;
  readonly skeleton: string;
  readonly arith: number;
  readonly repos: readonly string[];
  readonly members: readonly FormulaMember[];
  /** The number of repositories times the arithmetic operators. A high score is a long formula in many places. */
  readonly score: number;
  /** The first home of the words of the paths and the function names, or null. */
  readonly home: FormulaHome | null;
}

export interface FormulaClassOptions {
  readonly minArith?: number;
  readonly minRepos?: number;
  readonly generic?: readonly GenericFormula[];
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * This function gives the formula rows of the current snapshots outside the tests, each with the innermost function
 * that holds it.
 */
export async function formulaRows(q: CatalogQuery, minArith: number = FORMULA_MIN_RECORD): Promise<FormulaRow[]> {
  const rows = await q
    .selectFrom("current_file as f")
    .innerJoin("formula as x", "x.blob", "f.blob")
    .leftJoin("symbol as s", (join) =>
      join.onRef("s.blob", "=", "f.blob").onRef("s.line", "<=", "x.line").onRef("s.end_line", ">=", "x.line").on("s.kind", "in", ["function", "method"]),
    )
    .where("f.test", "=", 0)
    .where("x.arith", ">=", minArith)
    .select(["f.repo as repo", "f.path as path", "x.line as line", "x.hash as hash", "x.skeleton as skeleton", "x.arith as arith", "s.qualified_name as fn", "s.line as fnLine", "s.end_line as fnEnd"])
    .orderBy("repo")
    .orderBy("path")
    .orderBy("line")
    .execute();
  // A nested function gives a row for each function that holds the line: keep the innermost
  const best = new Map<string, FormulaRow>();
  for (const row of rows) {
    const key = `${row.repo}\0${row.path}\0${row.line}\0${row.hash}`;
    const fnLines: readonly [number, number] | null = row.fnLine === null || row.fnEnd === null ? null : [row.fnLine, row.fnEnd];
    const seen = best.get(key);
    if (seen === undefined || (fnLines !== null && fnLines[0] > (seen.fnLines?.[0] ?? -1))) {
      best.set(key, { repo: row.repo, path: row.path, line: row.line, fn: row.fn, fnLines, hash: row.hash, skeleton: row.skeleton, arith: row.arith });
    }
  }
  return [...best.values()];
}

/** This function gives the home of a class from the words of its paths and function names, or null. */
export function formulaHome(members: readonly FormulaMember[]): FormulaHome | null {
  const words = new Set<string>();
  for (const member of members) {
    for (const word of wordsOf(member.path.replace(/\.[^./]+$/, "").replace(/^(packages|src|lib)\//, ""))) words.add(word);
    if (member.fn !== null) for (const word of wordsOf(member.fn)) words.add(word);
  }
  const home = findHomes([...words].join(" "))[0];
  return home === undefined ? null : { area: home.area, packages: home.packages.length === 0 ? [home.repo] : [...home.packages] };
}

/**
 * This function groups the rows by skeleton. A class has members in `minRepos` repositories or more and `minArith`
 * operators or more. Its skeleton is not on the stop list. A class with the places of a longer class is a part of
 * that formula. It is not a class of its own. The classes come with the highest score first.
 */
export function formulaClasses(rows: readonly FormulaRow[], options: FormulaClassOptions = {}): FormulaClass[] {
  const minArith = options.minArith ?? FORMULA_MIN_LEAD;
  const minRepos = options.minRepos ?? 2;
  const generic = new Set((options.generic ?? GENERIC_FORMULAS).map((form) => formulaHash(form.skeleton)));
  const groups = new Map<string, { skeleton: string; arith: number; members: FormulaMember[] }>();
  for (const row of rows) {
    if (row.arith < minArith || generic.has(row.hash)) continue;
    const group = groups.get(row.hash) ?? { skeleton: row.skeleton, arith: row.arith, members: [] };
    group.members.push({ repo: row.repo, path: row.path, line: row.line, fn: row.fn, fnLines: row.fnLines });
    groups.set(row.hash, group);
  }
  const candidates = [...groups.entries()]
    .map(([hash, group]) => ({ hash, ...group, repos: [...new Set(group.members.map((m) => m.repo))].sort(byText) }))
    .filter((group) => group.repos.length >= minRepos)
    .sort((a, b) => b.arith - a.arith || byText(a.hash, b.hash));
  const places = new Set<string>();
  const kept: FormulaClass[] = [];
  for (const group of candidates) {
    const key = group.members
      .map((m) => `${m.repo}\0${m.path}\0${m.line}`)
      .sort(byText)
      .join("\n");
    if (places.has(key)) continue;
    places.add(key);
    const members = [...group.members].sort((a, b) => byText(a.repo, b.repo) || byText(a.path, b.path) || a.line - b.line);
    kept.push({ hash: group.hash, skeleton: group.skeleton, arith: group.arith, repos: group.repos, members, score: group.repos.length * group.arith, home: formulaHome(members) });
  }
  return kept.sort((a, b) => b.score - a.score || b.members.length - a.members.length || byText(a.skeleton, b.skeleton));
}

/** One copy that an owner found: a row of the fixed recall benchmark `labels/finds-1.jsonl`. */
export interface OwnerFind {
  readonly repo: string;
  readonly path: string;
  readonly line: number | null;
  readonly name: string;
  readonly home: string;
}

/** The recall of the classes at one floor of arithmetic operators. */
export interface FormulaRecall {
  readonly floor: number;
  readonly recalled: number;
  /** The finds whose file is in the current snapshots. */
  readonly present: number;
  readonly total: number;
  /** The `repo:path` of each find that a class has, with the hash of the class. */
  readonly hits: readonly { readonly find: string; readonly hash: string }[];
}

/**
 * This function counts the finds that a class has at the floor. A member matches a find with a line when its line or
 * its function holds that line. It matches a find with no line when its function has the name of the find. A find with
 * a description and not a name takes a line of a member in its file. Each line of a member matches one find.
 *
 * The finds whose `repo` and `path` are in `files` are present. By default these are the files of the rows.
 */
export function formulaRecall(
  rows: readonly FormulaRow[],
  finds: readonly OwnerFind[],
  floor: number,
  files: ReadonlySet<string> = new Set(rows.map((row) => fileKey(row.repo, row.path))),
): FormulaRecall {
  const byFile = new Map<string, { member: FormulaMember; hash: string }[]>();
  for (const formula of formulaClasses(rows, { minArith: floor })) {
    for (const member of formula.members) {
      const key = fileKey(member.repo, member.path);
      byFile.set(key, [...(byFile.get(key) ?? []), { member, hash: formula.hash }]);
    }
  }
  const hits: { find: string; hash: string }[] = [];
  const used = new Set<string>();
  const sameName = (fn: string | null, name: string): boolean => fn !== null && (fn === name || fn.endsWith(`.${name}`));
  // The finds with a line take their members first
  const ordered = [...finds].sort((a, b) => (a.line === null ? 1 : 0) - (b.line === null ? 1 : 0));
  let present = 0;
  for (const find of ordered) {
    const key = fileKey(find.repo, find.path);
    if (files.has(key)) present += 1;
    const members = (byFile.get(key) ?? []).filter((entry) => !used.has(`${key}\0${entry.member.line}`));
    const line = find.line;
    const match =
      line !== null
        ? members.find((entry) => entry.member.line === line || holds(entry.member.fnLines, line))
        : (members.find((entry) => sameName(entry.member.fn, find.name)) ?? (/\s/.test(find.name) ? members[0] : undefined));
    if (match === undefined) continue;
    used.add(`${key}\0${match.member.line}`);
    hits.push({ find: `${find.repo}:${find.path}`, hash: match.hash });
  }
  return { floor, recalled: hits.length, present, total: finds.length, hits };
}

/** This function gives the key of a file of a repository in the sets of `formulaRecall`. */
export const fileKey = (repo: string, path: string): string => `${repo}\0${path}`;

const holds = (range: readonly [number, number] | null, line: number): boolean => range !== null && range[0] <= line && line <= range[1];

/**
 * The label of an owner verdict. `right`: each member is a copy, and the home is right. `partial-home`: each member
 * is a copy, and the home is wrong. `partial-members`: some members are not copies. `wrong`: no member is a copy.
 * `partial` is the label of the first round, before the split into `partial-home` and `partial-members`.
 */
export type FormulaLabel = "right" | "partial-home" | "partial-members" | "partial" | "wrong";

/** The claims of a lead: the class is a copy, the home is right, and each named member is a copy. */
export type FormulaClaim = "copy" | "home" | "members";

/**
 * This table gives the answer of each label to each claim. `null` means that the label does not test the claim, so
 * the verdict does not count for the claim or against it. The first-round label `partial` counts against the home.
 */
export const LABEL_CLAIMS: Readonly<Record<FormulaLabel, Readonly<Record<FormulaClaim, boolean | null>>>> = {
  right: { copy: true, home: true, members: true },
  "partial-home": { copy: true, home: false, members: true },
  "partial-members": { copy: true, home: null, members: false },
  partial: { copy: true, home: false, members: null },
  wrong: { copy: false, home: null, members: null },
};

/** The verdict of an owner on one class: a row of `labels/formulas-1.jsonl`. */
export interface FormulaVerdict {
  readonly hash: string;
  readonly verdict: FormulaLabel;
  readonly reason: string;
  readonly at: string;
  /** The pull request that moved the copy, when the verdict is right. */
  readonly moved?: string;
}

/** The precision of one claim of the leads, and the decision of its gate. */
export interface ClaimPrecision {
  /** The leads that make the claim and have a verdict. */
  readonly judged: number;
  /** The leads with a right claim. */
  readonly right: number;
  readonly low: number;
  readonly high: number;
  readonly gate: number;
  /** `keep`: the lower bound is at the gate or more. `cut`: it is below. `open`: no verdict yet. */
  readonly decision: "keep" | "cut" | "open";
}

/**
 * The precision of the leads from the owner verdicts. A lead makes three claims, so it has three precisions. Each
 * precision counts only the verdicts that test its claim, from `LABEL_CLAIMS`. Thus a better choice of the home
 * changes only the home precision.
 */
export interface FormulaPrecision {
  readonly judged: number;
  /** Is the class a real copy? */
  readonly copy: ClaimPrecision;
  /** Is the home right, among the real copies? */
  readonly home: ClaimPrecision;
  /** Is each named member a copy, among the real copies? */
  readonly members: ClaimPrecision;
  /** The model tokens of the scan: Layer 1 costs none. */
  readonly tokens: number;
  /** The model tokens for each right move, or null with no right move. */
  readonly tokensPerRightMove: number | null;
}

/** This function gives the precision of one claim, with its Wilson interval and the decision of `gate`. */
export function claimPrecision(right: number, judged: number, gate: number): ClaimPrecision {
  if (judged === 0) return { judged, right, low: 0, high: 1, gate, decision: "open" };
  const interval = wilson(right, judged);
  return {
    judged,
    right,
    low: Number(interval.low.toFixed(3)),
    high: Number(interval.high.toFixed(3)),
    gate,
    decision: interval.low >= gate ? "keep" : "cut",
  };
}

/** This function gives the precision of each claim of the leads, from the answers of `LABEL_CLAIMS`. */
export function formulaPrecision(verdicts: readonly FormulaVerdict[], tokens: number = 0): FormulaPrecision {
  const claim = (name: FormulaClaim, gate: number): ClaimPrecision => {
    const answers = verdicts.map((v) => LABEL_CLAIMS[v.verdict][name]).filter((a) => a !== null);
    return claimPrecision(answers.filter((a) => a).length, answers.length, gate);
  };
  const right = verdicts.filter((v) => v.verdict === "right").length;
  return {
    judged: verdicts.length,
    copy: claim("copy", FORMULA_COPY_GATE),
    home: claim("home", FORMULA_HOME_GATE),
    members: claim("members", FORMULA_MEMBER_GATE),
    tokens,
    tokensPerRightMove: right === 0 ? null : Math.round(tokens / right),
  };
}

/** The class report: the leads, the recall at each floor and the precision. */
export interface FormulaReport {
  readonly version: string;
  readonly classes: readonly FormulaClass[];
  readonly recall: readonly FormulaRecall[];
  readonly precision: FormulaPrecision;
  readonly generic: number;
}

/** This function gives the class report of the catalog. The recall is at the floors 2 and 3. */
export async function formulaReport(q: CatalogQuery, finds: readonly OwnerFind[], verdicts: readonly FormulaVerdict[]): Promise<FormulaReport> {
  const rows = await formulaRows(q);
  const current = await q.selectFrom("current_file").select(["repo", "path"]).where("repo", "in", [...new Set(finds.map((f) => f.repo)), ""]).execute();
  const files = new Set(current.map((row) => fileKey(row.repo, row.path)));
  return {
    version: FORMULAS_VERSION,
    classes: formulaClasses(rows),
    recall: [2, 3].map((floor) => formulaRecall(rows, finds, floor, files)),
    precision: formulaPrecision(verdicts),
    generic: GENERIC_FORMULAS.length,
  };
}

const cell = (text: string): string => text.replaceAll("|", "\\|");

/** This function writes one row of the table of the claims. */
const claimRow = (claim: string, c: ClaimPrecision): string =>
  `| ${claim} | ${c.right} of ${c.judged} | ${c.judged === 0 ? "none" : (c.right / c.judged).toFixed(3)} | [${c.low.toFixed(3)}, ${c.high.toFixed(3)}] | ${c.gate} | ${c.decision} |`;

/** This function writes the report as Markdown, with the first `top` classes. */
export function formulasMarkdown(report: FormulaReport, top: number = 30): string {
  const { precision } = report;
  const lines = [
    "## Formula skeletons",
    "",
    `The atlas found ${report.classes.length} skeletons with ${FORMULA_MIN_LEAD} or more arithmetic operators in 2 or more repositories. The stop list has ${report.generic} generic forms.`,
    "Each class is a lead to read, not a move.",
    "",
    "| Floor | Owner finds in a class | Finds in the catalog |",
    "| --- | --- | --- |",
    ...report.recall.map((r) => `| ${r.floor} | ${r.recalled} of ${r.total} | ${r.present} |`),
    "",
    ...(precision.judged === 0
      ? ["The owners have not judged a lead yet."]
      : [
          "A lead makes three claims: the class is a real copy, the home is right, and each named member is a copy. Each claim counts only the verdicts that test it.",
          "",
          "| Claim | Right | Precision | 95% interval | Gate | Decision |",
          "| --- | --- | --- | --- | --- | --- |",
          claimRow("A real copy", precision.copy),
          claimRow("The right home, among the real copies", precision.home),
          claimRow("Each member a copy, among the real copies", precision.members),
          "",
        ]),
    `The scan used ${precision.tokens} model tokens. Tokens for each right move: ${precision.tokensPerRightMove ?? "none yet"}.`,
    "",
    "| Rank | Repositories | Operators | Skeleton | Places | Home |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.classes.slice(0, top).map((c, index) => {
      const places = c.members
        .slice(0, 4)
        .map((m) => `\`${m.repo}:${m.path}:${m.line}\``)
        .join(" ");
      const more = c.members.length > 4 ? ` and ${c.members.length - 4} more` : "";
      return `| ${index + 1} | ${c.repos.length} | ${c.arith} | \`${cell(c.skeleton)}\` | ${places}${more} | ${c.home?.area ?? "none"} |`;
    }),
    "",
  ];
  return `${lines.join("\n")}\n`;
}
