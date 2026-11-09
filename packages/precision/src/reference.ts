/**
 * The values of the reference tools for one file. One pass of ESLint, with the parser of typescript-eslint, gives each
 * function with its lines. The same pass gives the values of the ESLint rules `complexity`, `max-params` and
 * `max-depth`, and of the SonarJS rule `cognitive-complexity`. It also gives the callees of each function. The
 * TypeScript compiler gives the imports of the file and the last name of the callee of each call.
 */
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

/** A position in a file: the line from 1 and the column from 0, as ESLint gives it. */
export interface Position {
  readonly line: number;
  readonly column: number;
}

/** One function of the file, as the reference tools see it. */
export interface ReferenceFunction {
  /** The first line of the function, with its name, its key or its declarator. */
  readonly start: number;
  /** The last line of the function. */
  readonly end: number;
  /** The value of the rule `complexity` of ESLint. */
  readonly cyclomatic: number;
  /** The value of the rule `max-params` of ESLint. */
  readonly params: number;
  /** The value of the rule `cognitive-complexity` of SonarJS. */
  readonly cognitive: number;
  /** The highest value of the rule `max-depth` of ESLint in the function. */
  readonly depth: number;
  /** The different callees of the calls in the function, as written, from the syntax tree of typescript-eslint. */
  readonly fanOut: number;
}

/** The reference values of one file. */
export interface ReferenceFile {
  readonly functions: readonly ReferenceFunction[];
  /** The line of each type escape: an explicit `any`, a non-null assertion, `@ts-ignore` or `@ts-expect-error`. */
  readonly unsafeLines: readonly number[];
  /** The message of the parser when it cannot read the file, or null. */
  readonly error: string | null;
}

interface Located {
  readonly loc: { readonly start: Position; readonly end: Position };
}

interface FunctionNode extends Located {
  readonly type: string;
  readonly parent?: FunctionNode;
}

/** A node of the syntax tree of typescript-eslint, with the fields that the callee text reads. */
interface EsNode {
  readonly type: string;
  readonly name?: string;
  readonly computed?: boolean;
  readonly object?: EsNode;
  readonly property?: EsNode;
  readonly expression?: EsNode;
}

/**
 * This function gives the callee of a call as written, from the syntax tree of typescript-eslint: `name`, `a.b.c`,
 * `a[]`, `super`, `this` or `<expr>`. A computed member gives `[]`. A private name has no `#`, as in the atlas.
 */
export function esCalleeText(node: EsNode | undefined): string {
  if (node === undefined) return "<expr>";
  switch (node.type) {
    case "Identifier":
      return node.name ?? "<expr>";
    case "Super":
      return "super";
    case "ThisExpression":
      return "this";
    case "MemberExpression": {
      const property = node.property;
      const name = node.computed === true || property === undefined ? "[]" : (property.name ?? "[]");
      return `${esCalleeText(node.object)}${name === "[]" ? "[]" : `.${name}`}`;
    }
    case "ChainExpression":
    case "TSNonNullExpression":
    case "TSAsExpression":
      return esCalleeText(node.expression);
    default:
      return "<expr>";
  }
}

interface Report {
  readonly node?: Located;
  readonly loc?: { readonly start: Position };
  readonly data?: Readonly<Record<string, unknown>>;
}

interface RuleModule {
  readonly meta?: unknown;
  create(context: object): Record<string, (node: never) => void>;
}

/** The parents of a function that hold its name or its key, so its first line is their first line. */
const HOLDERS: ReadonlySet<string> = new Set(["MethodDefinition", "TSAbstractMethodDefinition", "Property", "PropertyDefinition", "AccessorProperty", "VariableDeclarator"]);

const before = (a: Position, b: Position): boolean => a.line < b.line || (a.line === b.line && a.column <= b.column);

/** This function wraps a rule, so that each report goes to `sink` and not to ESLint. */
function capture(rule: RuleModule, sink: (report: Report) => void): RuleModule {
  return {
    meta: rule.meta,
    create(context: object) {
      // The context is frozen, so the wrapper is a new object with the context as its prototype
      return rule.create(Object.create(context, { report: { value: sink } }) as object);
    },
  };
}

/** This function gives the reference values of the file `filename` with the text `text`. */
export function referenceOf(text: string, filename: string): ReferenceFile {
  const { Linter } = require("eslint") as typeof import("eslint");
  const { builtinRules } = require("eslint/use-at-your-own-risk") as { builtinRules: Map<string, RuleModule> };
  const tseslint = require("typescript-eslint") as { parser: unknown; plugin: { rules: Record<string, RuleModule> } };
  const sonar = require("eslint-plugin-sonarjs") as { rules: Record<string, RuleModule> };

  const nodes: { node: FunctionNode; outer: Located }[] = [];
  const values = new Map<Located, { cyclomatic: number; params: number; depth: number }>();
  const cognitive: { at: Position; value: number }[] = [];
  const depths: { at: Located; value: number }[] = [];
  const unsafeLines: number[] = [];
  const calls: { at: Position; callee: string }[] = [];
  const entry = (node: Located): { cyclomatic: number; params: number; depth: number } => {
    const found = values.get(node) ?? { cyclomatic: 1, params: 0, depth: 0 };
    values.set(node, found);
    return found;
  };
  const rule = (id: string): RuleModule => {
    const found = builtinRules.get(id);
    if (found === undefined) throw new Error(`ESLint has no rule ${id}.`);
    return found;
  };
  const functions: RuleModule = {
    create: () => {
      const visit = (node: FunctionNode): void => {
        const parent = node.parent;
        nodes.push({ node, outer: parent !== undefined && HOLDERS.has(parent.type) ? parent : node });
      };
      return { FunctionDeclaration: visit, FunctionExpression: visit, ArrowFunctionExpression: visit };
    },
  };
  const callSites: RuleModule = {
    create: () => {
      const visit = (node: Located & { readonly callee: EsNode }): void => {
        calls.push({ at: node.loc.start, callee: esCalleeText(node.callee) });
      };
      return { CallExpression: visit, NewExpression: visit };
    },
  };
  const unsafe = (report: Report): void => {
    const line = report.loc?.start.line ?? report.node?.loc.start.line;
    if (line !== undefined) unsafeLines.push(line);
  };
  const plugin = {
    rules: {
      functions,
      calls: callSites,
      complexity: capture(rule("complexity"), (r) => {
        if (r.node !== undefined) entry(r.node).cyclomatic = Number(r.data?.["complexity"]);
      }),
      params: capture(rule("max-params"), (r) => {
        if (r.node !== undefined) entry(r.node).params = Number(r.data?.["count"]);
      }),
      depth: capture(rule("max-depth"), (r) => {
        if (r.node !== undefined) depths.push({ at: r.node, value: Number(r.data?.["depth"]) });
      }),
      cognitive: capture(sonar.rules["cognitive-complexity"] as RuleModule, (r) => {
        if (r.loc !== undefined) cognitive.push({ at: r.loc.start, value: Number(r.data?.["complexityAmount"]) });
      }),
      any: capture(tseslint.plugin.rules["no-explicit-any"] as RuleModule, unsafe),
      nonNull: capture(tseslint.plugin.rules["no-non-null-assertion"] as RuleModule, unsafe),
      comments: capture(tseslint.plugin.rules["ban-ts-comment"] as RuleModule, unsafe),
    },
  };
  const linter = new Linter({ configType: "flat" });
  const messages = linter.verify(
    text,
    [
      {
        files: ["**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}"],
        // A comment in the file must not turn off a rule of the check
        linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
        languageOptions: { parser: tseslint.parser as never, parserOptions: { ecmaFeatures: { jsx: /\.[jt]sx$/.test(filename) } } },
        plugins: { reference: plugin as never },
        rules: {
          "reference/functions": "error",
          "reference/calls": "error",
          "reference/complexity": ["error", 0],
          "reference/params": ["error", 0],
          "reference/depth": ["error", 0],
          "reference/cognitive": ["error", 0],
          "reference/any": "error",
          "reference/nonNull": "error",
          "reference/comments": ["error", { "ts-ignore": true, "ts-expect-error": true, "ts-nocheck": false, "ts-check": false }],
        },
      },
    ],
    { filename },
  );
  // A file that no configuration matches gives one warning with no rule, and no values
  const fatal = messages.find((m) => m.fatal === true || m.message.startsWith("No matching configuration"));
  if (fatal !== undefined) return { functions: [], unsafeLines: [], error: fatal.message };

  // A report at a position goes to the innermost function whose outer node holds the position
  const innermost = (at: Position): FunctionNode | undefined => {
    let best: { node: FunctionNode; outer: Located } | undefined;
    for (const item of nodes) {
      if (!before(item.outer.loc.start, at) || !before(at, item.outer.loc.end)) continue;
      if (best === undefined || before(best.outer.loc.start, item.outer.loc.start)) best = item;
    }
    return best?.node;
  };
  const cognitiveOf = new Map<Located, number>();
  for (const report of cognitive) {
    const node = innermost(report.at);
    if (node !== undefined) cognitiveOf.set(node, report.value);
  }
  const calleesOf = new Map<Located, Set<string>>();
  for (const call of calls) {
    const node = innermost(call.at);
    if (node === undefined) continue;
    const callees = calleesOf.get(node) ?? new Set<string>();
    callees.add(call.callee);
    calleesOf.set(node, callees);
  }
  for (const report of depths) {
    const node = innermost(report.at.loc.start);
    if (node !== undefined) entry(node).depth = Math.max(entry(node).depth, report.value);
  }
  return {
    functions: nodes.map(({ node, outer }): ReferenceFunction => {
      const found = values.get(node) ?? { cyclomatic: 1, params: 0, depth: 0 };
      return { start: outer.loc.start.line, end: outer.loc.end.line, cyclomatic: found.cyclomatic, params: found.params, cognitive: cognitiveOf.get(node) ?? 0, depth: found.depth, fanOut: calleesOf.get(node)?.size ?? 0 };
    }),
    unsafeLines: unsafeLines.sort((a, b) => a - b),
    error: null,
  };
}

/** This function gives the different import specifiers of a file, from the TypeScript compiler. */
export function importsOf(text: string): string[] {
  const info = ts.preProcessFile(text, true, true);
  return [...new Set(info.importedFiles.map((file) => file.fileName))].sort();
}

/**
 * This function gives the function of `functions` that is the function from `line` to `end` of the atlas. The last
 * lines must be equal. The first lines must be equal, or one line apart. With two candidates, the longer one wins.
 */
export function matchFunction(functions: readonly ReferenceFunction[], line: number, end: number): ReferenceFunction | undefined {
  const candidates = functions.filter((f) => f.end === end && Math.abs(f.start - line) <= 1);
  const exact = candidates.filter((f) => f.start === line);
  const pool = exact.length > 0 ? exact : candidates;
  return [...pool].sort((a, b) => a.start - b.start)[0];
}

/** This function gives the last name of a callee from the TypeScript compiler: the name after the last `.`. */
function lastNameOf(node: ts.Expression): string {
  if (ts.isIdentifier(node)) return node.text;
  if (node.kind === ts.SyntaxKind.SuperKeyword) return "super";
  if (node.kind === ts.SyntaxKind.ThisKeyword) return "this";
  // A private name has no `#`, as in the atlas
  if (ts.isPropertyAccessExpression(node)) return node.name.text.replace(/^#/, "");
  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isAsExpression(node)) return lastNameOf(node.expression);
  return "<expr>";
}

const SCRIPT_KINDS: Readonly<Record<string, ts.ScriptKind>> = { tsx: ts.ScriptKind.TSX, jsx: ts.ScriptKind.JSX, js: ts.ScriptKind.JS, mjs: ts.ScriptKind.JS, cjs: ts.ScriptKind.JS };

/**
 * This function gives the last name of the callee of each call and each `new` of a file, from the TypeScript compiler.
 * A dynamic `import()` is not a call.
 */
export function calleeNamesOf(text: string, filename: string): string[] {
  const extension = filename.slice(filename.lastIndexOf(".") + 1);
  const file = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, false, SCRIPT_KINDS[extension] ?? ts.ScriptKind.TS);
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind !== ts.SyntaxKind.ImportKeyword) names.push(lastNameOf(node.expression));
    else if (ts.isNewExpression(node)) names.push(lastNameOf(node.expression));
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}

/**
 * This function gives the line of the start of each token of a file, from the leaves of the syntax tree of the
 * TypeScript compiler. A leaf with no width, the end of the file, the text of a JSX element and a JSDoc comment are not
 * tokens.
 */
export function tokenLinesOf(text: string, filename: string): number[] {
  const extension = filename.slice(filename.lastIndexOf(".") + 1);
  const file = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, SCRIPT_KINDS[extension] ?? ts.ScriptKind.TS);
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    const children = node.getChildren(file);
    if (children.length > 0) {
      for (const child of children) if (!ts.isJSDoc(child)) visit(child);
      return;
    }
    if (node.kind === ts.SyntaxKind.EndOfFileToken || node.kind === ts.SyntaxKind.JsxText) return;
    const start = node.getStart(file);
    if (node.end > start) lines.push(file.getLineAndCharacterOfPosition(start).line + 1);
  };
  visit(file);
  return lines.sort((a, b) => a - b);
}
