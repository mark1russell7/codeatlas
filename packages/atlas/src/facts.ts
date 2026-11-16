/**
 * Layer 1a of the catalog (`docs/SCHEMA.md`): the facts of one source file, from its syntax only. The facts
 * depend only on the bytes of the file, so the git blob id of the file is their key. A rescan reads only new blobs.
 */
import { parseSync } from "@swc/core";
import { formulaOf, type FormulaFact } from "./formulas.ts";
import { cloneHashes, typeHash } from "./hashes.ts";
import { lineOf, lineStarts, packageOf } from "./scan.ts";
import { isNode, type AstNode } from "./shape.ts";
import { tokenLines, tokensInLines } from "./tokens.ts";

/** The version of the facts. A new version makes the catalog read each blob again. */
export const FACTS_VERSION: string = "facts/5";

export type SymbolKind = "function" | "method" | "class" | "variable" | "type" | "interface" | "enum" | "namespace";

/** One declaration of a file. */
export interface SymbolFact {
  /** The chain of the names of the declarations that hold it, joined by `.`, unique in the file. */
  readonly qualifiedName: string;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly parent: string | null;
  readonly line: number;
  readonly endLine: number;
  readonly exported: boolean;
  /** Only for a function or a method. */
  readonly fn: FunctionFact | null;
  /** Only for a type or an interface: the hash of its members, sorted by name. */
  readonly typeHash: string | null;
}

/** The facts of a function or a method. */
export interface FunctionFact {
  readonly async: boolean;
  readonly generator: boolean;
  readonly params: number;
  /** The text from the start of the function to the start of its body, with single spaces, at most 300 characters. */
  readonly signature: string;
  /** The count of the nodes of the syntax tree of the parameters and the body. No independent tool checks this count. */
  readonly nodes: number;
  /**
   * The count of the tokens that start in the lines of the function, from `tokenLines`. It is null when the tokenizer
   * cannot read the file.
   */
  readonly tokens: number | null;
  readonly hashExact: string;
  readonly hashRenamed: string;
  readonly hashShape: string;
  /**
   * The decision points plus one, as the rule `complexity` of ESLint counts them: default values and optional chains
   * count. A nested function counts for itself, not for this one.
   */
  readonly cyclomatic: number;
  /** The deepest nesting of control statements (`if`, loops, `switch`, `try`) in the body. */
  readonly depth: number;
  /** The cognitive complexity of the body, from `cognitiveOf`. */
  readonly cognitive: number;
}

export type ImportKind = "static" | "type" | "dynamic" | "require" | "re-export";

export interface ImportFact {
  readonly ordinal: number;
  readonly specifier: string;
  /** The package name, or null for a relative, a built-in or a `#` import. */
  readonly package: string | null;
  readonly kind: ImportKind;
  /** Each binding: the imported name (`default`, `*` or a name) and the local name. */
  readonly names: readonly { readonly imported: string; readonly local: string }[];
  readonly line: number;
}

export interface ExportFact {
  readonly name: string;
  /** The qualified name of the symbol, or null for a re-export. */
  readonly symbol: string | null;
  /** The specifier of a re-export, or null. */
  readonly from: string | null;
  readonly typeOnly: boolean;
}

export interface CallSiteFact {
  readonly ordinal: number;
  /** The qualified name of the function that holds the call, or `<module>`. */
  readonly caller: string;
  /** The callee as written: `name`, `a.b.c`, `a[]`, `super`, or `<expr>`. */
  readonly callee: string;
  readonly isNew: boolean;
  readonly line: number;
}

/** The use of a name of the global scope: the callee of `new`, the callee of a call, the operand of `typeof`, or another use. */
export type GlobalUse = "new" | "call" | "typeof" | "read";

/** One name of the global scope that a file uses, with one use of it. */
export interface GlobalFact {
  readonly name: string;
  readonly use: GlobalUse;
  /** The line of the first use of the name with this use. */
  readonly line: number;
  /** The count of the uses of the name with this use in the file. */
  readonly count: number;
}

export type MarkerKind = "todo" | "fixme" | "hack" | "xxx" | "ts-ignore" | "ts-expect-error" | "eslint-disable" | "any" | "as-unknown-as" | "non-null";

export interface MarkerFact {
  readonly kind: MarkerKind;
  readonly line: number;
  /** The comment text, at most 200 characters, or the empty text for a marker of the syntax. */
  readonly text: string;
}

/** The facts of one file. */
export interface FileFacts {
  readonly version: string;
  readonly symbols: readonly SymbolFact[];
  readonly imports: readonly ImportFact[];
  readonly exports: readonly ExportFact[];
  readonly callSites: readonly CallSiteFact[];
  readonly markers: readonly MarkerFact[];
  /** The expressions inside functions with 2 or more arithmetic operators (`formulas.ts`). */
  readonly formulas: readonly FormulaFact[];
  /** The names of the global scope that the file uses, one for each name and use, sorted by name and then use (`globalsOf`). */
  readonly globals: readonly GlobalFact[];
}

const FUNCTIONS: ReadonlySet<string> = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassMethod",
  "PrivateMethod",
  "Constructor",
  "MethodProperty",
  "GetterProperty",
  "SetterProperty",
]);

const DECISIONS: ReadonlySet<string> = new Set([
  "IfStatement",
  "ConditionalExpression",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "CatchClause",
]);
const NESTING: ReadonlySet<string> = new Set([...DECISIONS].filter((type) => type !== "ConditionalExpression" && type !== "CatchClause").concat(["SwitchStatement", "TryStatement"]));
const LOGICAL: ReadonlySet<string> = new Set(["&&", "||", "??", "&&=", "||=", "??="]);

function identName(node: unknown): string | undefined {
  if (!isNode(node)) return undefined;
  if (node.type === "Identifier" || node.type === "PrivateName") return String(node["value"]);
  if (node.type === "StringLiteral" || node.type === "NumericLiteral") return String(node["value"]);
  if (node.type === "Computed") return "[]";
  return undefined;
}

/** The callee of a call as written. */
export function calleeText(node: unknown): string {
  if (!isNode(node)) return "<expr>";
  switch (node.type) {
    case "Identifier":
      return String(node["value"]);
    case "Super":
      return "super";
    case "ThisExpression":
      return "this";
    case "MemberExpression": {
      const property = node["property"];
      const name = isNode(property) && property.type === "Computed" ? "[]" : (identName(property) ?? "[]");
      return `${calleeText(node["object"])}${name === "[]" ? "[]" : `.${name}`}`;
    }
    case "SuperPropExpression":
      return `super.${identName(node["property"]) ?? "[]"}`;
    case "OptionalChainingExpression":
      return calleeText(node["base"]);
    case "ParenthesisExpression":
    case "TsNonNullExpression":
    case "TsAsExpression":
      return calleeText(node["expression"]);
    default:
      return "<expr>";
  }
}

const COMMENT_MARKERS: readonly (readonly [RegExp, MarkerKind])[] = [
  [/\bTODO\b/, "todo"],
  [/\bFIXME\b/, "fixme"],
  [/\bHACK\b/, "hack"],
  [/\bXXX\b/, "xxx"],
  [/@ts-ignore\b/, "ts-ignore"],
  [/@ts-expect-error\b/, "ts-expect-error"],
  [/\beslint-disable/, "eslint-disable"],
];

/**
 * This function gives the comments of a text, with the line of each. It skips strings and template
 * literals. A regular expression literal that holds `//` or `/*` can give a false comment: the labeled
 * sample measures this.
 */
export function commentsOf(text: string): { readonly line: number; readonly text: string }[] {
  const out: { line: number; text: string }[] = [];
  let line = 1;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === "\n") {
      line++;
      i++;
    } else if (c === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      out.push({ line, text: text.slice(i + 2, stop) });
      i = stop;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end;
      const body = text.slice(i + 2, stop);
      const lines = body.split("\n");
      lines.forEach((part, k) => out.push({ line: line + k, text: part }));
      line += lines.length - 1;
      i = stop + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < n && text[i] !== c) {
        if (text[i] === "\\") i++;
        else if (text[i] === "\n") {
          line++;
          if (c !== "`") break;
        }
        i++;
      }
      i++;
    } else i++;
  }
  return out;
}

interface Frame {
  readonly qualifiedName: string | null;
  /** The count of each name under this frame, for the ordinals of names that repeat. */
  readonly seen: Map<string, number>;
}

export type Syntax = "ts" | "tsx" | "js";

/** The syntax of a file from its extension. The facts of a blob depend on its bytes and on this syntax only. */
export function syntaxOf(file: string): Syntax {
  return /\.tsx$/.test(file) ? "tsx" : /\.[cm]?ts$/.test(file) ? "ts" : "js";
}

/** This function gives the facts of one source text. `file` is the path in the repository: only its extension counts. */
export function factsOf(file: string, text: string): FileFacts {
  const syntax = syntaxOf(file);
  const module = parseSync(text, syntax === "js" ? { syntax: "ecmascript", jsx: true } : { syntax: "typescript", tsx: syntax === "tsx", decorators: true });
  const bytes = Buffer.from(text, "utf8");
  const starts = lineStarts(bytes);
  // swc gives byte positions from 1 for each parse (scan.ts)
  const base = 1;
  const at = (node: AstNode, end = false): number => {
    const span = node["span"] as { readonly start?: number; readonly end?: number } | undefined;
    return lineOf(starts, Math.max(0, ((end ? span?.end : span?.start) ?? base) - base - (end ? 1 : 0)));
  };
  // The tokenizer reads the file only when the file has a function
  let lines: number[] | null | undefined;
  const tokensOf = (node: AstNode): number | null => {
    if (lines === undefined) lines = tokenLines(text, file);
    return lines === null ? null : tokensInLines(lines, at(node), at(node, true));
  };
  const sliceText = (from: number, to: number): string => bytes.subarray(Math.max(0, from - base), Math.max(0, to - base)).toString("utf8");

  const symbols: SymbolFact[] = [];
  const imports: ImportFact[] = [];
  const exports: ExportFact[] = [];
  const callSites: CallSiteFact[] = [];
  const markers: MarkerFact[] = [];
  const formulas: FormulaFact[] = [];
  const formulaKeys = new Set<string>();
  const exportedNodes = new Map<unknown, string | null>();

  const unique = (frame: Frame, name: string): string => {
    const count = (frame.seen.get(name) ?? 0) + 1;
    frame.seen.set(name, count);
    const local = count === 1 ? name : `${name}[${count}]`;
    return frame.qualifiedName === null ? local : `${frame.qualifiedName}.${local}`;
  };

  // The module items: imports, exports and the exported declarations
  for (const item of module.body as unknown as readonly AstNode[]) {
    if (item.type === "ImportDeclaration") {
      const names = ((item["specifiers"] as readonly AstNode[] | undefined) ?? []).map((spec) => ({
        imported: spec.type === "ImportDefaultSpecifier" ? "default" : spec.type === "ImportNamespaceSpecifier" ? "*" : (identName(spec["imported"]) ?? identName(spec["local"]) ?? ""),
        local: identName(spec["local"]) ?? "",
      }));
      addImport(String((item["source"] as AstNode)["value"]), item["typeOnly"] === true ? "type" : "static", names, at(item));
    } else if (item.type === "ExportNamedDeclaration") {
      const source = item["source"] as AstNode | null | undefined;
      const from = source ? String(source["value"]) : null;
      const names: { imported: string; local: string }[] = [];
      for (const spec of (item["specifiers"] as readonly AstNode[] | undefined) ?? []) {
        const orig = spec.type === "ExportNamespaceSpecifier" ? "*" : (identName(spec["orig"]) ?? "default");
        const exported = identName(spec["exported"]) ?? (spec.type === "ExportNamespaceSpecifier" ? identName(spec["name"]) ?? "*" : orig);
        exports.push({ name: exported, symbol: from === null ? orig : null, from, typeOnly: item["typeOnly"] === true || spec["isTypeOnly"] === true });
        names.push({ imported: orig, local: exported });
      }
      if (from !== null) addImport(from, "re-export", names, at(item));
    } else if (item.type === "ExportAllDeclaration") {
      const from = String((item["source"] as AstNode)["value"]);
      exports.push({ name: "*", symbol: null, from, typeOnly: item["typeOnly"] === true });
      addImport(from, "re-export", [{ imported: "*", local: "*" }], at(item));
    } else if (item.type === "ExportDeclaration") {
      exportedNodes.set(item["declaration"], null);
    } else if (item.type === "ExportDefaultDeclaration") {
      exportedNodes.set(item["decl"], "default");
    } else if (item.type === "ExportDefaultExpression") {
      exportedNodes.set(item["expression"], "default");
    }
  }

  function addImport(specifier: string, kind: ImportKind, names: { imported: string; local: string }[], line: number): void {
    imports.push({ ordinal: imports.length, specifier, package: packageOf(specifier) ?? null, kind, names, line });
  }

  const pushSymbol = (frame: Frame, name: string, kind: SymbolKind, node: AstNode, exported: boolean, fn: FunctionFact | null, hash: string | null): string => {
    const qualifiedName = unique(frame, name);
    symbols.push({ qualifiedName, name, kind, parent: frame.qualifiedName, line: at(node), endLine: at(node, true), exported, fn, typeHash: hash });
    return qualifiedName;
  };

  const exportName = (node: unknown, qualifiedName: string): void => {
    if (!exportedNodes.has(node)) return;
    const name = exportedNodes.get(node);
    exports.push({ name: name ?? qualifiedName, symbol: qualifiedName, from: null, typeOnly: false });
  };

  const functionFact = (node: AstNode): FunctionFact => {
    const fn = (node["function"] as AstNode | undefined) ?? node;
    const params = (fn["params"] as readonly unknown[] | undefined) ?? [];
    const body = fn["body"] as AstNode | null | undefined;
    const hashes = cloneHashes([params, body]);
    const span = node["span"] as { start: number; end: number };
    const bodySpan = isNode(body) ? (body["span"] as { start: number } | undefined) : undefined;
    const signature = sliceText(span.start, bodySpan?.start ?? span.end).replace(/\s+/g, " ").trim().slice(0, 300);
    const { cyclomatic, depth } = complexityOf([params, body]);
    return {
      async: fn["async"] === true,
      generator: fn["generator"] === true,
      params: params.length,
      signature,
      nodes: hashes.nodes,
      tokens: tokensOf(node),
      hashExact: hashes.exact,
      hashRenamed: hashes.renamed,
      hashShape: hashes.shape,
      cyclomatic,
      depth,
      cognitive: cognitiveOf(body),
    };
  };

  const visit = (node: unknown, hint: string, frame: Frame, caller: string): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, hint, frame, caller);
      return;
    }
    if (!isNode(node)) {
      if (typeof node === "object" && node !== null) for (const value of Object.values(node)) visit(value, hint, frame, caller);
      return;
    }
    const exported = exportedNodes.has(node);
    let inner = frame;
    let innerCaller = caller;
    let nextHint = hint;

    if (FUNCTIONS.has(node.type)) {
      const name = identName(node["identifier"]) ?? identName(node["key"]) ?? (node.type === "Constructor" ? "constructor" : hint);
      const kind: SymbolKind = node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression" ? "function" : "method";
      const qualifiedName = pushSymbol(frame, name, kind, node, exported, functionFact(node), null);
      exportName(node, qualifiedName);
      inner = { qualifiedName, seen: new Map() };
      innerCaller = qualifiedName;
      nextHint = "<anonymous>";
    } else if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      const qualifiedName = pushSymbol(frame, identName(node["identifier"]) ?? hint, "class", node, exported, null, null);
      exportName(node, qualifiedName);
      inner = { qualifiedName, seen: new Map() };
    } else if (node.type === "TsInterfaceDeclaration" || node.type === "TsTypeAliasDeclaration") {
      const kind: SymbolKind = node.type === "TsInterfaceDeclaration" ? "interface" : "type";
      const qualifiedName = pushSymbol(frame, identName(node["id"]) ?? hint, kind, node, exported, null, typeShapeOf(node));
      exportName(node, qualifiedName);
      markTypes(node);
      return;
    } else if (node.type === "TsEnumDeclaration") {
      exportName(node, pushSymbol(frame, identName(node["id"]) ?? hint, "enum", node, exported, null, null));
      return;
    } else if (node.type === "TsModuleDeclaration") {
      const qualifiedName = pushSymbol(frame, identName(node["id"]) ?? hint, "namespace", node, exported, null, null);
      exportName(node, qualifiedName);
      inner = { qualifiedName, seen: new Map() };
    } else if (node.type === "VariableDeclaration" && exported) {
      // An exported variable that is not a function: a function gets its symbol from its own node
      for (const declarator of (node["declarations"] as readonly AstNode[] | undefined) ?? []) {
        const init = declarator["init"];
        const name = identName(declarator["id"]);
        if (name === undefined) continue;
        if (isNode(init) && FUNCTIONS.has(init.type)) exportedNodes.set(init, null);
        else exports.push({ name, symbol: pushSymbol(frame, name, "variable", declarator, true, null, null), from: null, typeOnly: false });
      }
    } else if (node.type === "CallExpression" || node.type === "NewExpression") {
      const callee = node["callee"];
      const args = (node["arguments"] as readonly { readonly expression?: AstNode }[] | undefined) ?? [];
      if (isNode(callee) && callee.type === "Import") {
        const first = args[0]?.expression;
        if (first?.type === "StringLiteral") addImport(String(first["value"]), "dynamic", [{ imported: "*", local: "" }], at(node));
      } else {
        const text = calleeText(callee);
        if (text === "require" && args[0]?.expression?.type === "StringLiteral") addImport(String(args[0].expression["value"]), "require", [{ imported: "*", local: "" }], at(node));
        callSites.push({ ordinal: callSites.length, caller, callee: text, isNew: node.type === "NewExpression", line: at(node) });
        // A function given to a call gets a name from the call: it("does x", () => ...) gives `it("does x")`
        const label = args.find((arg) => arg.expression?.type === "StringLiteral")?.expression;
        nextHint = label === undefined ? `${text}()` : `${text}(${JSON.stringify(String(label["value"]).slice(0, 60))})`;
      }
    } else if (node.type === "TsAsExpression") {
      const expression = node["expression"];
      if (isNode(expression) && expression.type === "TsAsExpression" && isKeyword(expression["typeAnnotation"], "unknown")) markers.push({ kind: "as-unknown-as", line: at(node), text: "" });
    } else if (node.type === "TsNonNullExpression") {
      markers.push({ kind: "non-null", line: at(node), text: "" });
    } else if (node.type === "TsKeywordType" && node["kind"] === "any") {
      markers.push({ kind: "any", line: at(node), text: "" });
    }

    if (caller !== "<module>") {
      const formula = formulaOf(node, at(node));
      const key = formula === undefined ? "" : `${formula.line}:${formula.hash}`;
      if (formula !== undefined && !formulaKeys.has(key)) {
        formulaKeys.add(key);
        formulas.push(formula);
      }
    }

    for (const [field, value] of Object.entries(node)) {
      if (field === "span" || field === "ctxt" || typeof value !== "object" || value === null) continue;
      let next = nextHint;
      if (node.type === "VariableDeclarator" && field === "init") next = identName(node["id"]) ?? hint;
      else if ((node.type === "KeyValueProperty" || node.type === "ClassProperty") && field === "value") next = identName(node["key"]) ?? hint;
      else if (node.type === "AssignmentExpression" && field === "right") next = memberText(node["left"]) ?? hint;
      else if (!(node.type === "CallExpression" || node.type === "NewExpression") || field !== "arguments") next = FUNCTIONS.has(node.type) ? "<anonymous>" : hint;
      visit(value, next, inner, innerCaller);
    }
  };

  /** The `any` markers inside a type declaration: the walk of the declaration stops at its symbol. */
  const markTypes = (node: unknown): void => {
    if (Array.isArray(node)) for (const item of node) markTypes(item);
    else if (isNode(node)) {
      if (node.type === "TsKeywordType" && node["kind"] === "any") markers.push({ kind: "any", line: at(node), text: "" });
      for (const [field, value] of Object.entries(node)) if (field !== "span" && typeof value === "object" && value !== null) markTypes(value);
    } else if (typeof node === "object" && node !== null) for (const value of Object.values(node)) markTypes(value);
  };

  visit(module.body, "<anonymous>", { qualifiedName: null, seen: new Map() }, "<module>");

  for (const comment of commentsOf(text)) {
    for (const [pattern, kind] of COMMENT_MARKERS) {
      if (pattern.test(comment.text)) markers.push({ kind, line: comment.line, text: comment.text.trim().slice(0, 200) });
    }
  }

  const byLine = <T extends { readonly line: number }>(a: T, b: T): number => a.line - b.line;
  return {
    version: FACTS_VERSION,
    symbols: symbols.sort((a, b) => a.line - b.line || compare(a.qualifiedName, b.qualifiedName)),
    imports,
    exports: exports.sort((a, b) => compare(a.name, b.name) || compare(a.from ?? "", b.from ?? "")),
    callSites,
    markers: markers.sort((a, b) => byLine(a, b) || compare(a.kind, b.kind)),
    formulas: formulas.sort((a, b) => byLine(a, b) || compare(a.hash, b.hash)),
    globals: globalsOf(module.body, at),
  };
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function isKeyword(node: unknown, kind: string): boolean {
  return isNode(node) && node.type === "TsKeywordType" && node["kind"] === kind;
}

function memberText(node: unknown): string | undefined {
  if (!isNode(node)) return undefined;
  if (node.type === "MemberExpression") return identName(node["property"]);
  return identName(node);
}

/** The global objects. A member of one of them, as `globalThis.WebSocket`, is also a use of the member name. */
const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(["globalThis", "window", "self", "global"]);
/** The fields of the type positions of TypeScript. The walk of the globals does not go into them. */
const TYPE_FIELDS: ReadonlySet<string> = new Set(["typeAnnotation", "typeParameters", "typeParams", "typeArguments", "superTypeParams", "returnType", "implements"]);
/** The nodes with no use of a name in them: types, labels, private names, the export lists and the text of JSX. */
const NO_USES: ReadonlySet<string> = new Set([
  "TsInterfaceDeclaration",
  "TsTypeAliasDeclaration",
  "TsTypeAnnotation",
  "TsTypeParameterDeclaration",
  "TsTypeParameterInstantiation",
  "TsExpressionWithTypeArguments",
  "TsIndexSignature",
  "TsNamespaceExportDeclaration",
  "ExportNamedDeclaration",
  "ExportAllDeclaration",
  "BreakStatement",
  "ContinueStatement",
  "PrivateName",
  "JSXClosingElement",
  "JSXText",
  "JSXNamespacedName",
]);
/** The wrappers that keep the use of their expression: `(fetch)(u)` and `fetch!(u)` give the use `call` of `fetch`. */
const WRAPPERS: ReadonlySet<string> = new Set(["ParenthesisExpression", "TsNonNullExpression", "TsAsExpression", "TsSatisfiesExpression", "TsTypeAssertion", "TsConstAssertion", "TsInstantiation"]);

/** One scope of a file. A scope that hoists (a module, a function, a namespace or a static block) holds the `var` and function declarations. */
interface Scope {
  readonly parent: Scope | null;
  readonly hoists: boolean;
  readonly names: Set<string>;
}

/** One use of a name, before the walk knows all bindings. `via` is the global object of a member, as `globalThis`. */
interface NameUse {
  readonly name: string;
  readonly use: GlobalUse;
  readonly line: number;
  readonly scope: Scope;
  readonly via: string | undefined;
}

/**
 * This function gives the names of the global scope that the items of a module use. The walk keeps the bindings of each
 * scope and each use of a name. After the walk, a use is global when no scope that holds it binds the name. Thus a
 * `var` or a function that the code uses before its declaration is bound.
 */
function globalsOf(body: unknown, at: (node: AstNode) => number): GlobalFact[] {
  const uses: NameUse[] = [];
  const scopeOf = (parent: Scope | null, hoists: boolean, names: readonly string[] = []): Scope => ({ parent, hoists, names: new Set(names) });
  const hoisted = (scope: Scope): Scope => {
    let current = scope;
    while (!current.hoists && current.parent !== null) current = current.parent;
    return current;
  };
  const refer = (name: string, use: GlobalUse, node: AstNode, scope: Scope, via?: string): void => {
    uses.push({ name, use, line: at(node), scope, via });
  };
  const nameOf = (node: unknown): string | undefined => (isNode(node) && node.type === "Identifier" ? String(node["value"]) : undefined);
  const nodes = (value: unknown): readonly AstNode[] => (Array.isArray(value) ? value.filter(isNode) : []);
  const bind = (scope: Scope, name: string | undefined): void => {
    if (name !== undefined) scope.names.add(name);
  };
  const key = (node: unknown, scope: Scope): void => {
    if (isNode(node) && node.type === "Computed") walk(node["expression"], scope);
  };
  /** The name of a member: a name, or a string in brackets. */
  const memberName = (property: unknown): string | undefined => {
    if (!isNode(property)) return undefined;
    if (property.type === "Identifier") return String(property["value"]);
    const expression = property.type === "Computed" ? property["expression"] : undefined;
    return isNode(expression) && expression.type === "StringLiteral" ? String(expression["value"]) : undefined;
  };

  /** A pattern binds its names in `into`. With no `into`, the pattern is the target of an assignment, and each name in it is a use. */
  const pattern = (node: unknown, scope: Scope, into: Scope | null): void => {
    if (!isNode(node)) return;
    switch (node.type) {
      case "Identifier":
        if (into === null) refer(String(node["value"]), "read", node, scope);
        else into.names.add(String(node["value"]));
        return;
      case "ArrayPattern":
        for (const element of (node["elements"] as readonly unknown[] | undefined) ?? []) pattern(element, scope, into);
        return;
      case "ObjectPattern":
        for (const property of nodes(node["properties"])) {
          if (property.type === "KeyValuePatternProperty") {
            key(property["key"], scope);
            pattern(property["value"], scope, into);
          } else if (property.type === "AssignmentPatternProperty") {
            pattern(property["key"], scope, into);
            walk(property["value"], scope);
          } else pattern(property, scope, into);
        }
        return;
      case "RestElement":
        pattern(node["argument"], scope, into);
        return;
      case "AssignmentPattern":
        pattern(node["left"], scope, into);
        walk(node["right"], scope);
        return;
      case "Parameter":
      case "TsParameterProperty":
        walk(node["decorators"], scope);
        pattern(node["pat"] ?? node["param"], scope, into);
        return;
      default:
        // A member or another expression as the target of an assignment
        walk(node, scope);
    }
  };

  /** A function: its parameters and its body in a new scope. A function that is not an arrow also binds `arguments`. */
  const fn = (node: AstNode, scope: Scope, name: string | undefined): void => {
    const inner = scopeOf(scope, true, name === undefined ? [] : [name]);
    if (node.type !== "ArrowFunctionExpression") inner.names.add("arguments");
    walk(node["decorators"], scope);
    for (const param of (node["params"] as readonly unknown[] | undefined) ?? []) pattern(param, inner, inner);
    walk(node["body"], inner);
  };

  /** A class: its decorators and its base class in `scope`, and its members in a new scope that binds `name`. */
  const klass = (node: AstNode, scope: Scope, name: string | undefined): void => {
    walk(node["decorators"], scope);
    walk(node["superClass"], scope);
    const inner = scopeOf(scope, false, name === undefined ? [] : [name]);
    for (const member of nodes(node["body"])) {
      key(member["key"], inner);
      walk(member["decorators"], inner);
      if (member.type === "ClassMethod" || member.type === "PrivateMethod") fn(member["function"] as AstNode, inner, undefined);
      else if (member.type === "Constructor") fn(member, inner, undefined);
      else if (member.type === "StaticBlock") walk(member["body"], scopeOf(inner, true));
      else walk(member["value"], inner);
    }
  };

  /** A member: its object is a use. A member of a global object is also a use of the member name, if the file does not bind the object. */
  const member = (node: AstNode, scope: Scope, use: GlobalUse): void => {
    const via = nameOf(node["object"]);
    const name = memberName(node["property"]);
    if (via !== undefined && GLOBAL_OBJECTS.has(via) && name !== undefined) refer(name, use, node["property"] as AstNode, scope, via);
    walk(node["object"], scope);
    key(node["property"], scope);
  };

  /** The name of a JSX element. A name with a capital letter and the object of a member are uses. A name in lowercase is a tag of HTML. */
  const jsxName = (node: unknown, scope: Scope): void => {
    let root = node;
    while (isNode(root) && root.type === "JSXMemberExpression") root = root["object"];
    const name = nameOf(root);
    if (name !== undefined && name !== "this" && (root !== node || !/^[a-z]|-/.test(name))) refer(name, "read", root as AstNode, scope);
  };

  const walk = (node: unknown, scope: Scope, use: GlobalUse = "read"): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, scope);
      return;
    }
    if (!isNode(node)) {
      if (typeof node === "object" && node !== null) for (const value of Object.values(node)) walk(value, scope);
      return;
    }
    if (NO_USES.has(node.type)) return;
    if (WRAPPERS.has(node.type)) return walk(node["expression"], scope, use);
    switch (node.type) {
      case "Identifier":
        return refer(String(node["value"]), use, node, scope);
      case "MemberExpression":
        return member(node, scope, use);
      case "SuperPropExpression":
        return key(node["property"], scope);
      case "OptionalChainingExpression":
        return walk(node["base"], scope, use);
      case "SequenceExpression": {
        // The callee `(0, fetch)` of compiled code is a call of `fetch`
        const expressions = (node["expressions"] as readonly unknown[] | undefined) ?? [];
        expressions.forEach((expression, i) => walk(expression, scope, i === expressions.length - 1 ? use : "read"));
        return;
      }
      case "CallExpression":
      case "NewExpression":
        walk(node["callee"], scope, node.type === "NewExpression" ? "new" : "call");
        return walk(node["arguments"], scope);
      case "UnaryExpression":
        return walk(node["argument"], scope, node["operator"] === "typeof" ? "typeof" : "read");
      case "AssignmentExpression":
        pattern(node["left"], scope, null);
        return walk(node["right"], scope);
      case "VariableDeclaration":
      case "UsingDeclaration": {
        const into = node["kind"] === "var" ? hoisted(scope) : scope;
        for (const declarator of nodes(node["declarations"] ?? node["decls"])) {
          pattern(declarator["id"], scope, into);
          walk(declarator["init"], scope);
        }
        return;
      }
      case "FunctionDeclaration":
        bind(hoisted(scope), nameOf(node["identifier"]));
        return fn(node, scope, undefined);
      case "FunctionExpression":
        return fn(node, scope, nameOf(node["identifier"]));
      case "ArrowFunctionExpression":
        return fn(node, scope, undefined);
      case "MethodProperty":
        key(node["key"], scope);
        return fn(node, scope, undefined);
      case "GetterProperty":
      case "SetterProperty":
        key(node["key"], scope);
        return fn((node["function"] as AstNode | undefined) ?? node, scope, undefined);
      case "KeyValueProperty":
        key(node["key"], scope);
        return walk(node["value"], scope);
      case "ClassDeclaration":
        bind(scope, nameOf(node["identifier"]));
        return klass(node, scope, nameOf(node["identifier"]));
      case "ClassExpression":
        return klass(node, scope, nameOf(node["identifier"]));
      case "BlockStatement":
      case "FunctionBody":
        return walk(node["stmts"], scopeOf(scope, false));
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement": {
        const inner = scopeOf(scope, false);
        const left = node["left"];
        if (isNode(left) && left.type !== "VariableDeclaration" && left.type !== "UsingDeclaration") pattern(left, inner, null);
        else walk(left, inner);
        for (const field of ["init", "test", "update", "right", "body"]) walk(node[field], inner);
        return;
      }
      case "CatchClause": {
        const inner = scopeOf(scope, false);
        pattern(node["param"], inner, inner);
        return walk(node["body"], inner);
      }
      case "SwitchStatement":
        walk(node["discriminant"], scope);
        return walk(node["cases"], scopeOf(scope, false));
      case "LabeledStatement":
        return walk(node["body"], scope);
      case "ImportDeclaration":
        for (const specifier of nodes(node["specifiers"])) bind(scope, nameOf(specifier["local"]));
        return;
      case "ExportDefaultDeclaration": {
        // `export default function main() {}` binds `main` in the module
        const decl = node["decl"];
        bind(scope, isNode(decl) ? nameOf(decl["identifier"]) : undefined);
        return walk(decl, scope);
      }
      case "TsEnumDeclaration": {
        bind(scope, nameOf(node["id"]));
        const members = nodes(node["members"]);
        const inner = scopeOf(scope, false, members.map((m) => identName(m["id"]) ?? ""));
        for (const m of members) walk(m["init"], inner);
        return;
      }
      case "TsModuleDeclaration":
      case "TsNamespaceDeclaration":
        // `declare global` has the name `global`, but it binds nothing
        if (node["global"] !== true) bind(scope, nameOf(node["id"]));
        return walk(node["body"], scopeOf(scope, true));
      case "TsImportEqualsDeclaration": {
        bind(scope, nameOf(node["id"]));
        let ref = node["moduleRef"];
        while (isNode(ref) && ref.type === "TsQualifiedName") ref = ref["left"];
        if (isNode(ref) && ref.type === "Identifier") refer(String(ref["value"]), "read", ref, scope);
        return;
      }
      case "JSXOpeningElement":
        jsxName(node["name"], scope);
        return walk(node["attributes"], scope);
      case "JSXAttribute":
        return walk(node["value"], scope);
    }
    for (const [field, value] of Object.entries(node)) {
      if (field !== "span" && field !== "ctxt" && !TYPE_FIELDS.has(field) && typeof value === "object" && value !== null) walk(value, scope);
    }
  };

  walk(body, scopeOf(null, true));

  const bound = (name: string, scope: Scope): boolean => {
    for (let current: Scope | null = scope; current !== null; current = current.parent) if (current.names.has(name)) return true;
    return false;
  };
  const entries = new Map<string, { name: string; use: GlobalUse; line: number; count: number }>();
  for (const use of uses) {
    if (bound(use.via ?? use.name, use.scope)) continue;
    const id = `${use.name}\u0000${use.use}`;
    const entry = entries.get(id);
    if (entry === undefined) entries.set(id, { name: use.name, use: use.use, line: use.line, count: 1 });
    else {
      entry.count++;
      entry.line = Math.min(entry.line, use.line);
    }
  }
  return [...entries.values()].sort((a, b) => compare(a.name, b.name) || compare(a.use, b.use));
}

/**
 * The hash of the members of an interface or of an object type: each member as `name?:type`, sorted by name.
 * Two types with one hash are one structure with two names. Another type alias hashes its type.
 */
export function typeShapeOf(node: AstNode): string {
  const body = node.type === "TsInterfaceDeclaration" ? (node["body"] as AstNode | undefined)?.["body"] : (node["typeAnnotation"] as AstNode | undefined)?.type === "TsTypeLiteral" ? (node["typeAnnotation"] as AstNode)["members"] : undefined;
  if (!Array.isArray(body)) return typeHash(node["typeAnnotation"]);
  const members = (body as readonly AstNode[]).map((member) => {
    const name = identName(member["key"]) ?? member.type;
    const optional = member["optional"] === true ? "?" : "";
    return `${name}${optional}:${typeHash(member["typeAnnotation"] ?? member)}`;
  });
  return typeHash({ type: "TsMembers", members: members.sort().map((value) => ({ type: "StringLiteral", value })) });
}

/** The decision points and the deepest nesting of control statements of a function body, without its nested functions. */
export function complexityOf(body: unknown): { readonly cyclomatic: number; readonly depth: number } {
  // The caller gives the parameters with the body, so a default value of a parameter counts
  let decisions = 0;
  let deepest = 0;
  const walk = (node: unknown, depth: number): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth);
      return;
    }
    if (!isNode(node)) {
      if (typeof node === "object" && node !== null) for (const value of Object.values(node)) walk(value, depth);
      return;
    }
    if (FUNCTIONS.has(node.type)) return;
    if (DECISIONS.has(node.type)) decisions++;
    else if (node.type === "SwitchCase" && node["test"] !== null && node["test"] !== undefined) decisions++;
    else if ((node.type === "BinaryExpression" || node.type === "AssignmentExpression") && LOGICAL.has(String(node["operator"]))) decisions++;
    // A default value and an optional chain are decisions too, as the rule `complexity` of ESLint counts them
    else if (node.type === "AssignmentPattern" || (node.type === "AssignmentPatternProperty" && isNode(node["value"]))) decisions++;
    else if (node.type === "OptionalChainingExpression" && node["optional"] === true) decisions++;
    const next = NESTING.has(node.type) ? depth + 1 : depth;
    deepest = Math.max(deepest, next);
    for (const [field, value] of Object.entries(node)) if (field !== "span" && typeof value === "object" && value !== null) walk(value, next);
  };
  // A body with no control statement has depth 0. An `else if` is one more level, as it is in the syntax.
  walk(body, 0);
  return { cyclomatic: decisions + 1, depth: deepest };
}

/** The loops: each one adds 1 plus its nesting, and its body is one level deeper. */
const LOOPS: ReadonlySet<string> = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);
/** The fields of a structure that are one level deeper than the structure. */
const NESTED_FIELDS: ReadonlySet<string> = new Set(["body", "consequent", "alternate", "cases"]);
/** The logical operators of one chain. The rule of SonarJS 4 counts only a run of `&&`, so `||` and `??` add nothing. */
const BOOLEAN: ReadonlySet<string> = new Set(["&&", "||", "??"]);
const SAME_LEVEL: ReadonlySet<string> = new Set();

/**
 * This function gives the cognitive complexity of a body, after the specification of G. Ann Campbell (SonarSource, 2017).
 * Each `if`, `else if`, `else`, conditional, `switch`, loop and `catch` adds 1. A structure that nests also adds its
 * nesting level. Each `break` or `continue` to a label adds 1. A nested function counts for itself, as in `complexityOf`.
 *
 * The logical operators follow the rule of SonarJS 4. Each run of `&&` adds 1. A chain of one operator in a JSX
 * expression adds nothing. The recursion increment is not counted.
 */
export function cognitiveOf(body: unknown): number {
  let total = 0;
  const walkFields = (node: AstNode, nesting: number, deeper: ReadonlySet<string>): void => {
    for (const [field, value] of Object.entries(node)) if (field !== "span" && typeof value === "object" && value !== null) walk(value, deeper.has(field) ? nesting + 1 : nesting);
  };
  const walkIf = (node: AstNode, nesting: number, elseIf: boolean): void => {
    total += elseIf ? 1 : 1 + nesting;
    walk(node["test"], nesting);
    walk(node["consequent"], nesting + 1);
    const alternate = node["alternate"];
    if (isNode(alternate) && alternate.type === "IfStatement") walkIf(alternate, nesting, true);
    else if (isNode(alternate)) {
      total += 1;
      walk(alternate, nesting + 1);
    }
  };
  const walk = (node: unknown, nesting: number): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, nesting);
      return;
    }
    if (!isNode(node)) {
      if (typeof node === "object" && node !== null) for (const value of Object.values(node)) walk(value, nesting);
      return;
    }
    if (FUNCTIONS.has(node.type)) return;
    if (node.type === "IfStatement") return walkIf(node, nesting, false);
    if (node.type === "ConditionalExpression" || node.type === "SwitchStatement" || node.type === "CatchClause" || LOOPS.has(node.type)) {
      total += 1 + nesting;
      return walkFields(node, nesting, NESTED_FIELDS);
    }
    if ((node.type === "BreakStatement" || node.type === "ContinueStatement") && isNode(node["label"])) total += 1;
    if (node.type === "JSXExpressionContainer") {
      const operators: string[] = [];
      const leaves: unknown[] = [];
      flattenBoolean(node["expression"], operators, leaves);
      // SonarJS does not count a short circuit in JSX: a chain of one operator with no conditional in it
      const shortCircuit = operators.length > 0 && operators.every((operator) => operator === operators[0]) && !leaves.some((leaf) => isNode(leaf) && leaf.type === "ConditionalExpression");
      if (shortCircuit) return walk(leaves, nesting);
    }
    if (node.type === "BinaryExpression" && BOOLEAN.has(String(node["operator"]))) {
      const operators: string[] = [];
      const leaves: unknown[] = [];
      flattenBoolean(node, operators, leaves);
      total += operators.filter((operator, i) => operator === "&&" && operators[i - 1] !== "&&").length;
      return walk(leaves, nesting);
    }
    walkFields(node, nesting, SAME_LEVEL);
  };
  walk(body, 0);
  return total;
}

/** This function puts the boolean operators of a chain in their order in the text, and the operands that are not boolean chains. */
function flattenBoolean(node: unknown, operators: string[], leaves: unknown[]): void {
  let inner = node;
  while (isNode(inner) && inner.type === "ParenthesisExpression") inner = inner["expression"];
  if (isNode(inner) && inner.type === "BinaryExpression" && BOOLEAN.has(String(inner["operator"]))) {
    flattenBoolean(inner["left"], operators, leaves);
    operators.push(String(inner["operator"]));
    flattenBoolean(inner["right"], operators, leaves);
    return;
  }
  leaves.push(inner);
}
