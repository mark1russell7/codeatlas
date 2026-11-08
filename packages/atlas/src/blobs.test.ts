import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { cacheOf, factsKey, factsOfRepo, treeOf, type BlobFacts, type FactsLine } from "./blobs.ts";
import { factsMarkdown, factsSummary } from "./summary.ts";
import { GitRepos } from "./testing/git-repo.ts";

const repos = new GitRepos();
const repoWith = (files: Readonly<Record<string, string>>): string => repos.with(files);

afterAll(() => repos.removeAll());

const HELPER = "export function clamp(x: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, x)); }\n";

describe("factsOfRepo", () => {
  const a = repoWith({ "src/clamp.ts": HELPER, "src/clamp.test.ts": "clamp(1, 0, 2);\n", "README.md": "# a\n", "dist/out.js": "x();\n" });
  const b = repoWith({ "lib/util/clamp.ts": HELPER, "lib/broken.ts": "function (\n" });

  it("gives the blob id of git for each file of the tree", () => {
    const tree = treeOf(a);
    const blob = execFileSync("git", ["-C", a, "hash-object", "src/clamp.ts"], { encoding: "utf8" }).trim();
    expect(tree.find((entry) => entry.path === "src/clamp.ts")).toEqual({ path: "src/clamp.ts", blob, bytes: HELPER.length });
    expect(tree.map((entry) => entry.path).sort()).toEqual(["README.md", "dist/out.js", "src/clamp.test.ts", "src/clamp.ts"]);
  });

  it("parses one blob once over two repositories", () => {
    const cache = new Map<string, BlobFacts>();
    const first = factsOfRepo("a", a, cache);
    expect(first.files.map((file) => [file.path, file.test])).toEqual([
      ["src/clamp.test.ts", true],
      ["src/clamp.ts", false],
    ]);
    expect(first.counts).toMatchObject({ files: 2, parsed: 2, reused: 0, errors: 0 });
    const second = factsOfRepo("b", b, cache);
    expect(second.counts).toMatchObject({ files: 2, parsed: 1, reused: 1, errors: 1 });
    const helper = cache.get(factsKey(second.files.find((file) => file.path === "lib/util/clamp.ts")?.blob ?? "", "x.ts"));
    expect(helper?.ok && helper.facts.symbols.map((symbol) => symbol.qualifiedName)).toEqual(["clamp"]);
    const broken = cache.get(factsKey(second.files.find((file) => file.path === "lib/broken.ts")?.blob ?? "", "x.ts"));
    expect(broken?.ok).toBe(false);
  });

  it("reads a cache back from the output lines, and parses nothing again", () => {
    const cache = new Map<string, BlobFacts>();
    factsOfRepo("a", a, cache);
    const lines = [...cache].map(([key, facts]) => JSON.stringify({ kind: "blob", key, facts } satisfies FactsLine));
    lines.push(JSON.stringify({ kind: "blob", key: "0000:ts:facts/0", facts: { ok: false, error: "old" } } satisfies FactsLine), "");
    const again = cacheOf(lines);
    expect(again.size).toBe(cache.size);
    expect(factsOfRepo("a", a, again).counts).toMatchObject({ parsed: 0, reused: 2 });
  });
});

describe("factsSummary", () => {
  // A function of more than 40 nodes, in two repositories with two names: one renamed class, no exact class
  const big = (name: string, v: string) =>
    `export function ${name}(${v}: number[]) { let s = 0; for (const x of ${v}) { if (x > 0) s += x * 2; else s -= x; } return ${v}.length === 0 ? 0 : s / ${v}.length + Math.max(...${v}); }\n`;
  const a = repoWith({ "src/a.ts": big("score", "values") + "// TODO: one\n" });
  const b = repoWith({ "src/b.ts": big("rate", "xs") });

  it("counts the classes of each level and finds no break of the law", () => {
    const cache = new Map<string, BlobFacts>();
    const scans = [factsOfRepo("a", a, cache), factsOfRepo("b", b, cache)];
    const summary = factsSummary(scans, cache, 10);
    expect(summary).toMatchObject({ repos: 2, files: 2, parsed: 2, functions: 2, lawBreaks: 0, markers: { todo: 1 } });
    expect(summary.classes.exact).toEqual({ classes: 0, members: 0 });
    expect(summary.classes.renamed).toEqual({ classes: 1, members: 2 });
    expect(summary.classes.shape).toEqual({ classes: 1, members: 2 });
    expect(factsMarkdown(summary)).toContain("| renamed | 1 | 2 |");
  });
});
