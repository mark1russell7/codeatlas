/**
 * The three clone levels of a function, from one walk of its syntax tree.
 *
 * - `shape`: the node types only. It is the hash of `codeatlas/1` (`shapeOf`), with the same bytes.
 * - `renamed`: the shape, plus the index of the first use of each identifier, and the spread markers.
 * - `exact`: the renamed tokens with the names, the literal values and the type annotations.
 *
 * Each stream is a function of the stream below it in the list. Thus one `exact` hash gives one `renamed`
 * hash, and one `renamed` hash gives one `shape` hash. This is the law of the chain.
 */
import { createHash } from "node:crypto";
import { isNode, type AstNode } from "./shape.ts";

const SKIP_FIELDS: ReadonlySet<string> = new Set(["span", "ctxt", "type"]);
const VALUE_FIELDS: ReadonlySet<string> = new Set(["operator", "kind"]);
const LITERALS: ReadonlySet<string> = new Set([
  "StringLiteral",
  "NumericLiteral",
  "BigIntLiteral",
  "BooleanLiteral",
  "RegExpLiteral",
  "TemplateElement",
  "JSXText",
]);

/** The hashes of the three clone levels of a function, and its size in nodes. */
export interface CloneHashes {
  readonly nodes: number;
  readonly shape: string;
  readonly renamed: string;
  readonly exact: string;
}

/** The text of a literal value, for the `exact` level. */
export function literalText(node: AstNode): string {
  if (node.type === "RegExpLiteral") return `/${String(node["pattern"])}/${String(node["flags"])}`;
  if (node.type === "TemplateElement") return String(node["raw"] ?? node["cooked"] ?? "");
  if (node.type === "BigIntLiteral") return String(node["raw"] ?? node["value"]);
  return JSON.stringify(node["value"] ?? node["raw"] ?? null);
}

interface Streams {
  readonly shape: string[];
  readonly renamed: string[];
  readonly exact: string[];
  readonly names: Map<string, number>;
}

function walk(node: AstNode, inType: boolean, out: Streams): void {
  const both = (token: string): void => {
    if (!inType) {
      out.shape.push(token);
      out.renamed.push(token);
    }
    out.exact.push(inType ? `T|${token}` : token);
  };
  if (node.type.startsWith("Ts")) {
    // A type node adds nothing to shape and renamed. A node that wraps an expression (as, !, satisfies)
    // adds its expression. The exact level keeps the whole node.
    out.exact.push(`T|(${node.type}`);
    for (const [field, value] of Object.entries(node)) {
      if (SKIP_FIELDS.has(field)) continue;
      const keep = field === "expression" && isNode(value) ? inType : true;
      walkValue(field, value, keep, out);
    }
    out.exact.push("T|)");
    return;
  }
  both(node.type);
  if (node.type === "Identifier") {
    const name = String(node["value"]);
    if (!inType) {
      let index = out.names.get(name);
      if (index === undefined) {
        index = out.names.size;
        out.names.set(name, index);
      }
      out.renamed.push(`#${index}`);
    }
    out.exact.push(inType ? `T|=${name}` : `=${name}`);
    // swc keeps the type of a parameter on its identifier. Only the exact level reads it.
    const annotation = node["typeAnnotation"];
    if (isNode(annotation)) walk(annotation, true, out);
    return;
  }
  if (LITERALS.has(node.type)) {
    out.exact.push(`${inType ? "T|" : ""}=${literalText(node)}`);
    return;
  }
  for (const [field, value] of Object.entries(node)) {
    if (SKIP_FIELDS.has(field)) continue;
    walkValue(field, value, inType, out);
  }
}

function walkValue(field: string, value: unknown, inType: boolean, out: Streams): void {
  const both = (token: string): void => {
    if (!inType) {
      out.shape.push(token);
      out.renamed.push(token);
    }
    out.exact.push(inType ? `T|${token}` : token);
  };
  if (typeof value === "string") {
    if (VALUE_FIELDS.has(field)) both(value);
  } else if (Array.isArray(value)) {
    both("[");
    for (const item of value) {
      if (isNode(item)) walk(item, inType, out);
      else if (isWrapper(item)) walkWrapper(item, inType, out);
    }
    both("]");
  } else if (isNode(value)) {
    walk(value, inType, out);
  } else if (isWrapper(value)) {
    walkWrapper(value, inType, out);
  }
}

/** swc wraps arguments and spread elements in `{ spread, expression }` objects with no type. */
function isWrapper(value: unknown): value is { readonly expression: AstNode; readonly spread?: unknown } {
  return typeof value === "object" && value !== null && isNode((value as { expression?: unknown }).expression);
}

function walkWrapper(value: { readonly expression: AstNode; readonly spread?: unknown }, inType: boolean, out: Streams): void {
  // The spread marker is not in shape: codeatlas/1 has no token for it
  if (value.spread !== undefined && value.spread !== null) {
    if (!inType) out.renamed.push("...");
    out.exact.push(inType ? "T|..." : "...");
  }
  walk(value.expression, inType, out);
}

const hex = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** This function gives the three clone hashes of the parts of a function (its parameters and its body). */
export function cloneHashes(parts: readonly unknown[]): CloneHashes {
  const out: Streams = { shape: [], renamed: [], exact: [], names: new Map() };
  for (const part of parts) {
    if (isNode(part)) walk(part, false, out);
    else if (Array.isArray(part)) for (const item of part) if (isNode(item)) walk(item, false, out);
  }
  const nodes = out.shape.filter((token) => token !== "[" && token !== "]").length;
  return {
    nodes,
    // The same bytes as shapeOf, so the classes of codeatlas/1 and codeatlas/2 compare
    shape: hex(out.shape.join(" ")),
    renamed: hex(JSON.stringify(out.renamed)),
    exact: hex(JSON.stringify(out.exact)),
  };
}

/** This function gives the hash of a type: its tokens with names and literals, as the `exact` level writes them. */
export function typeHash(node: unknown): string {
  const out: Streams = { shape: [], renamed: [], exact: [], names: new Map() };
  if (isNode(node)) walk(node, true, out);
  return hex(JSON.stringify(out.exact));
}
