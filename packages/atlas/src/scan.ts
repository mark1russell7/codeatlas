/**
 * The scan of one repository: each function with its shape, each export, and each package that the
 * sources import. The scan reads the files that git keeps, so build output and node_modules stay out.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseSync } from "@swc/core";
import { isNode, shapeOf, type AstNode } from "./shape.ts";

/** One function of a repository. */
export interface Unit {
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly nodes: number;
  readonly hash: string;
  readonly exported: boolean;
  readonly test: boolean;
  /** The key (file:line) of the function that holds this one, or null at the top. */
  readonly parent: string | null;
}

/** One exported declaration of a source file (not of a test file, and not a re-export). */
export interface Export {
  readonly name: string;
  readonly kind: "function" | "class" | "variable" | "type" | "enum";
  readonly file: string;
}

/** The scan of one source file. */
export interface FileScan {
  readonly units: readonly Unit[];
  readonly exports: readonly Export[];
  readonly imports: readonly string[];
}

/** The scan of one repository. */
export interface RepoScan {
  readonly repo: string;
  /** The commit that the scan read, or null outside git. */
  readonly commit: string | null;
  readonly files: number;
  readonly nodes: number;
  readonly units: readonly Unit[];
  readonly exports: readonly Export[];
  /** Each package that a source imports, with the count of files that import it. */
  readonly imports: Readonly<Record<string, number>>;
  /** The files that swc could not parse, with the first line of the error. */
  readonly errors: readonly { readonly file: string; readonly error: string }[];
}

const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SKIP = /(?:^|\/)(?:node_modules|build|dist|coverage|vendor|\.next|out)\//;
const TEST = /(?:^|\/)(?:test|tests|__tests__|e2e|fixtures?)\/|\.(?:test|spec|bench)\.[cm]?[jt]sx?$/;
/** A larger file is a bundle or generated output. */
const MAX_BYTES = 400_000;

/** This function tells if the scan reads a file of the repository. */
export function isSource(file: string): boolean {
  return SOURCE.test(file) && !file.endsWith(".d.ts") && !SKIP.test(file) && !/\.min\.[cm]?js$/.test(file);
}

/** The files of a repository that git keeps, with forward slashes. */
export function gitFiles(root: string): string[] {
  const out = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return out.split("\0").filter((file) => file !== "");
}

/** The commit of HEAD in `root`, or null when `root` is not a git checkout. */
export function headOf(root: string): string | null {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** The byte offset of each line start, so that a swc position (a byte offset) gives a line. */
function lineStarts(bytes: Buffer): number[] {
  const starts = [0];
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 10) starts.push(i + 1);
  return starts;
}

function lineOf(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function spanStart(node: AstNode): number {
  const span = node["span"] as { readonly start?: number } | undefined;
  return span?.start ?? 0;
}

function identName(node: unknown): string | undefined {
  if (!isNode(node)) return undefined;
  if (node.type === "Identifier" || node.type === "PrivateName") return String(node["value"]);
  if (node.type === "StringLiteral") return String(node["value"]);
  return undefined;
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

/**
 * This function scans one source text. `file` is the path in the repository. It decides the syntax
 * (TypeScript, JSX) and if the file is a test.
 */
export function scanSource(file: string, text: string): FileScan {
  const tsx = /\.tsx$/.test(file);
  const typescript = /\.[cm]?tsx?$/.test(file);
  const module = parseSync(text, typescript ? { syntax: "typescript", tsx, decorators: true } : { syntax: "ecmascript", jsx: true });
  const bytes = Buffer.from(text, "utf8");
  const starts = lineStarts(bytes);
  // swc gives byte positions from 1 for each parse; a different base gives lines out of the file
  const base = 1;
  const test = TEST.test(file);
  const units: Unit[] = [];
  const exports: Export[] = [];
  const imports = new Set<string>();
  const exportedNodes = new Set<unknown>();

  for (const item of module.body as unknown as readonly AstNode[]) {
    if (item.type === "ImportDeclaration" || item.type === "ExportAllDeclaration" || item.type === "ExportNamedDeclaration") {
      const source = item["source"] as { readonly value?: string } | null | undefined;
      if (source?.value !== undefined) addImport(imports, source.value);
    }
    if (item.type === "ExportDeclaration" || item.type === "ExportDefaultDeclaration") {
      const declaration = (item["declaration"] ?? item["decl"]) as AstNode | undefined;
      if (declaration === undefined) continue;
      exportedNodes.add(declaration);
      if (test) continue;
      for (const entry of exportsOf(declaration, file, item.type === "ExportDefaultDeclaration")) exports.push(entry);
    }
  }

  const visit = (node: unknown, hint: string, exported: boolean, parent: string | null): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, hint, exported, parent);
      return;
    }
    if (!isNode(node)) {
      if (typeof node === "object" && node !== null) for (const value of Object.values(node)) visit(value, hint, exported, parent);
      return;
    }
    const isExported = exported || exportedNodes.has(node);
    if (node.type === "CallExpression" && isNode(node["callee"]) && node["callee"].type === "Import") {
      const first = (node["arguments"] as readonly { readonly expression?: AstNode }[] | undefined)?.[0]?.expression;
      if (first?.type === "StringLiteral") addImport(imports, String(first["value"]));
    }
    let inner = parent;
    if (FUNCTIONS.has(node.type)) {
      const name = identName(node["identifier"]) ?? identName(node["key"]) ?? (node.type === "Constructor" ? "constructor" : hint);
      const fn = (node["function"] as AstNode | undefined) ?? node;
      const shape = shapeOf([fn["params"], fn["body"]]);
      const line = lineOf(starts, spanStart(node) - base);
      units.push({ name, file, line, nodes: shape.nodes, hash: shape.hash, exported: isExported, test, parent });
      inner = `${file}:${line}`;
    }
    for (const [field, value] of Object.entries(node)) {
      if (field === "span" || field === "ctxt" || typeof value !== "object" || value === null) continue;
      let next = hint;
      if (node.type === "VariableDeclarator" && field === "init") next = identName(node["id"]) ?? hint;
      else if ((node.type === "KeyValueProperty" || node.type === "ClassProperty") && field === "value") next = identName(node["key"]) ?? hint;
      else if (node.type === "AssignmentExpression" && field === "right") next = memberName(node["left"]) ?? hint;
      visit(value, next, isExported && !FUNCTIONS.has(node.type), inner);
    }
  };
  visit(module.body, "<anonymous>", false, null);
  return { units, exports, imports: [...imports].sort() };
}

function memberName(node: unknown): string | undefined {
  if (!isNode(node)) return undefined;
  if (node.type === "MemberExpression") return identName(node["property"]);
  return identName(node);
}

/** The package name of an import specifier, or nothing for a relative or a built-in import. */
export function packageOf(specifier: string): string | undefined {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:") || specifier.startsWith("#")) return undefined;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function addImport(imports: Set<string>, specifier: string): void {
  const name = packageOf(specifier);
  if (name !== undefined && name !== "") imports.add(name);
}

function exportsOf(declaration: AstNode, file: string, isDefault: boolean): Export[] {
  const named = (kind: Export["kind"], node: unknown): Export[] => {
    const name = identName(node) ?? (isDefault ? "default" : undefined);
    return name === undefined ? [] : [{ name, kind, file }];
  };
  switch (declaration.type) {
    case "FunctionDeclaration":
    case "FunctionExpression":
      return named("function", declaration["identifier"]);
    case "ClassDeclaration":
    case "ClassExpression":
      return named("class", declaration["identifier"]);
    case "TsInterfaceDeclaration":
    case "TsTypeAliasDeclaration":
      return named("type", declaration["id"]);
    case "TsEnumDeclaration":
      return named("enum", declaration["id"]);
    case "VariableDeclaration":
      return ((declaration["declarations"] as readonly AstNode[] | undefined) ?? []).flatMap((d) => named("variable", d["id"]));
    default:
      return [];
  }
}

/** This function scans each source file that git keeps in `root`. */
export function scanRepo(repo: string, root: string, files: readonly string[] = gitFiles(root)): RepoScan {
  const units: Unit[] = [];
  const exports: Export[] = [];
  const imports: Record<string, number> = {};
  const errors: { file: string; error: string }[] = [];
  let count = 0;
  for (const file of files) {
    if (!isSource(file)) continue;
    const path = join(root, file);
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      continue;
    }
    if (size > MAX_BYTES) continue;
    try {
      const scan = scanSource(file, readFileSync(path, "utf8"));
      count++;
      units.push(...scan.units);
      exports.push(...scan.exports);
      for (const name of scan.imports) imports[name] = (imports[name] ?? 0) + 1;
    } catch (error) {
      errors.push({ file, error: String(error instanceof Error ? error.message : error).split("\n")[0] ?? "" });
    }
  }
  // The nodes of the top functions: a nested function is a part of the function that holds it
  const nodes = units.reduce((sum, unit) => (unit.parent === null ? sum + unit.nodes : sum), 0);
  return { repo, commit: headOf(root), files: count, nodes, units, exports, imports, errors };
}
