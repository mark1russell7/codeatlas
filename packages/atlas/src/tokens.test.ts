import { describe, expect, it } from "vitest";
import { tokenLines, tokensInLines } from "./tokens.ts";

describe("tokenLines", () => {
  // The TypeScript compiler gives the same counts for these lines
  it("counts each part of a template literal and each private name as one token, and skips comments", () => {
    const text = [
      "const e = `${a}${b}` + `x${`in${z}`}y`; // a comment", // 1
      "class C { #p = 1; m() { return this.#p; } }", // 2
      "/* a block */ let k = a < b ? `` : 'q';", // 3
    ].join("\n");
    const lines = tokenLines(text, "src/x.ts");
    expect(lines).not.toBeNull();
    const at = (line: number) => tokensInLines(lines ?? [], line, line);
    // const e = and ; with the parts: head, middle, tail, a, b, +, head, tail, head, tail, z
    expect(at(1)).toBe(15);
    // class C { #p = 1 ; m ( ) { return this . #p ; } }
    expect(at(2)).toBe(18);
    // let k = a < b ? `` : 'q' ;
    expect(at(3)).toBe(11);
    expect(tokensInLines(lines ?? [], 1, 3)).toBe(44);
    expect(tokensInLines(lines ?? [], 4, 9)).toBe(0);
  });

  it("skips the text of JSX elements, and reads a JavaScript file with JSX", () => {
    const text = ["const j = <a href={u}>", "  two words {n} more", "</a>;"].join("\n");
    const lines = tokenLines(text, "src/x.jsx") ?? [];
    // const j = < a href = { u } >
    expect(tokensInLines(lines, 1, 1)).toBe(11);
    // { n }
    expect(tokensInLines(lines, 2, 2)).toBe(3);
    // < / a > ;
    expect(tokensInLines(lines, 3, 3)).toBe(5);
  });
});
