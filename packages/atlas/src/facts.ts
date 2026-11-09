/**
 * Layer 1a of the catalog (`docs/SCHEMA.md`): the facts of one source file, from its syntax only. The facts
 * depend only on the bytes of the file, so the git blob id of the file is their key. A rescan reads only new blobs.
 */
import { parseSync } from "@swc/core";
import { formulaOf, type FormulaFact } from "./formulas.ts";
import { cloneHashes, typeHash } from "./hashes.ts";
import { lineOf, lineStarts, packageOf } from "./scan.ts";
import { isNode, type AstNode } from "./shape.ts";

/** The version of the facts. A new version makes the catalog read each blob again. */
export const FACTS_VERSION: string = "facts/3";

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
  readonly nodes: number;
  readonly hashExact: string;
  readonly hashRenamed: string;
  readonly hashShape: string;
  /** The decision points plus one. A nested function counts for itself, not for this one. */
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
    const { cyclomatic, depth } = complexityOf(body);
    return {
      async: fn["async"] === true,
      generator: fn["generator"] === true,
      params: params.length,
      signature,
      nodes: hashes.nodes,
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
const BOOLEAN: ReadonlySet<string> = new Set(["&&", "||", "??"]);
const SAME_LEVEL: ReadonlySet<string> = new Set();

/**
 * This function gives the cognitive complexity of a body, after the specification of G. Ann Campbell (SonarSource, 2017).
 * Each `if`, `else if`, `else`, conditional, `switch`, loop and `catch` adds 1. A structure that nests also adds its
 * nesting level. Each run of one boolean operator adds 1, and each `break` or `continue` to a label adds 1. A nested
 * function counts for itself, not for this one, as in `complexityOf`. The recursion increment is not counted.
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
    if (node.type === "BinaryExpression" && BOOLEAN.has(String(node["operator"]))) {
      const operators: string[] = [];
      const leaves: unknown[] = [];
      flattenBoolean(node, operators, leaves);
      total += operators.filter((operator, i) => i === 0 || operator !== operators[i - 1]).length;
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
