/**
 * The tokens of a source file, for the dimension `tokens` (`dimensions.ts`). The tokenizer of `@babel/parser` reads the
 * file. The count follows the token model of the TypeScript compiler, so an independent check can compare the counts.
 *
 * - A template literal counts one token for each part: its head, each middle and its tail.
 * - A private name (`#name`) is one token.
 * - Comments and the text of JSX elements are not tokens.
 */
import { parse, type ParserPlugin } from "@babel/parser";

interface BabelToken {
  readonly type: string | { readonly label: string };
  readonly loc: { readonly start: { readonly line: number } };
}

const labelOf = (token: BabelToken): string => (typeof token.type === "string" ? token.type : token.type.label);

/** The labels of the tokens that are not in the count. */
const SKIPPED: ReadonlySet<string> = new Set(["CommentLine", "CommentBlock", "eof", "jsxText", "template", "${"]);

/** This function gives the plugins of the parser for the extension of `path`. */
function pluginsOf(path: string): ParserPlugin[] {
  if (/\.[cm]?tsx$/.test(path)) return ["typescript", "jsx"];
  if (/\.[cm]?ts$/.test(path)) return ["typescript"];
  return ["jsx"];
}

/**
 * This function gives the line of the start of each token of a file, in the order of the file. It gives null when
 * the parser cannot read the file.
 */
export function tokenLines(text: string, path: string): number[] | null {
  let tokens: readonly BabelToken[];
  try {
    const file = parse(text, { sourceType: "unambiguous", plugins: pluginsOf(path), tokens: true, errorRecovery: true, allowReturnOutsideFunction: true });
    tokens = (file as unknown as { readonly tokens?: readonly BabelToken[] }).tokens ?? [];
  } catch {
    return null;
  }
  const lines: number[] = [];
  // Each entry is "template" for an open template literal, "expr" for a substitution and "brace" for a brace
  const open: ("template" | "expr" | "brace")[] = [];
  let afterHash = false;
  for (const token of tokens) {
    const label = labelOf(token);
    const line = token.loc.start.line;
    if (afterHash) {
      // The name of a private name: the "#" before it is the token
      afterHash = false;
      continue;
    }
    if (label === "`") {
      if (open[open.length - 1] === "template") open.pop();
      else {
        // The head of a template literal starts at its opening backtick
        open.push("template");
        lines.push(line);
      }
      continue;
    }
    if (label === "${") open.push("expr");
    else if (label === "{" || label === "#{") open.push("brace");
    else if (label === "}") {
      // The "}" of a substitution is the start of the next part of the template, so it counts as one token
      open.pop();
    } else if (label === "#") afterHash = true;
    if (SKIPPED.has(label)) continue;
    lines.push(line);
  }
  return lines;
}

/**
 * This function counts the tokens that start in the lines from `line` to `endLine`. The lines come from `tokenLines`,
 * in the order of the file, so a binary search finds the two ends.
 */
export function tokensInLines(lines: readonly number[], line: number, endLine: number): number {
  return Math.max(0, firstAbove(lines, endLine) - firstAbove(lines, line - 1));
}

/** This function gives the index of the first entry of `lines` that is greater than `value`. */
function firstAbove(lines: readonly number[], value: number): number {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((lines[middle] ?? 0) <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}
