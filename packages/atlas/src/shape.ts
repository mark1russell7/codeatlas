/**
 * The shape of a function: the sequence of its syntax node types, without names, literal values and
 * types. Two functions with one shape differ only in their identifiers, their literals or their
 * types (a type-2 clone). Thus a helper that two repos wrote on their own gets one hash.
 */
import { createHash } from "node:crypto";

/** A node of the swc AST: an object with a type, and other fields that hold nodes, arrays or values. */
export interface AstNode {
  readonly type: string;
  readonly [field: string]: unknown;
}

/** The fields that hold no syntax: positions and syntax contexts. */
const SKIP_FIELDS: ReadonlySet<string> = new Set(["span", "ctxt", "type"]);

/** The string fields whose value is part of the shape: an operator changes what the code does. */
const VALUE_FIELDS: ReadonlySet<string> = new Set(["operator", "kind"]);

/** The node types of literal values: the shape keeps the node, not its value. */
const LITERALS: ReadonlySet<string> = new Set([
  "StringLiteral",
  "NumericLiteral",
  "BigIntLiteral",
  "BooleanLiteral",
  "RegExpLiteral",
  "TemplateElement",
  "JSXText",
]);

export function isNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

/**
 * This function writes the shape tokens of a node to `out`. A TypeScript type node adds nothing. A
 * TypeScript node that wraps an expression (`as`, `!`, `satisfies`) adds only its expression.
 */
export function shapeTokens(node: AstNode, out: string[]): void {
  if (node.type.startsWith("Ts")) {
    const inner = node["expression"];
    if (isNode(inner)) shapeTokens(inner, out);
    return;
  }
  out.push(node.type);
  if (LITERALS.has(node.type) || node.type === "Identifier") return;
  for (const [field, value] of Object.entries(node)) {
    if (SKIP_FIELDS.has(field)) continue;
    if (typeof value === "string") {
      if (VALUE_FIELDS.has(field)) out.push(value);
    } else if (Array.isArray(value)) {
      out.push("[");
      for (const item of value) {
        if (isNode(item)) shapeTokens(item, out);
        else if (isWrapper(item)) shapeTokens(item.expression, out);
      }
      out.push("]");
    } else if (isNode(value)) {
      shapeTokens(value, out);
    } else if (isWrapper(value)) {
      shapeTokens(value.expression, out);
    }
  }
}

/** swc wraps arguments and spread elements in `{ spread, expression }` objects with no type. */
function isWrapper(value: unknown): value is { readonly expression: AstNode } {
  return typeof value === "object" && value !== null && isNode((value as { expression?: unknown }).expression);
}

/** The shape of a function: its tokens, its size (the count of node tokens) and a 16-hex hash. */
export interface Shape {
  readonly hash: string;
  readonly nodes: number;
}

export function shapeOf(parts: readonly unknown[]): Shape {
  const out: string[] = [];
  for (const part of parts) {
    if (isNode(part)) shapeTokens(part, out);
    else if (Array.isArray(part)) for (const item of part) if (isNode(item)) shapeTokens(item, out);
  }
  const nodes = out.filter((token) => token !== "[" && token !== "]").length;
  const hash = createHash("sha256").update(out.join(" ")).digest("hex").slice(0, 16);
  return { hash, nodes };
}
