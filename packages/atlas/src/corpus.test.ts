import { describe, expect, it } from "vitest";
import { buildCorpus, corpusMarkdown, countRepo, kindOf, lineCounts, type CorpusFile } from "./corpus.ts";
import { isSource } from "./scan.ts";

const file = (path: string, text: string | Buffer): CorpusFile => {
  const buffer = typeof text === "string" ? Buffer.from(text, "utf8") : text;
  return { file: path, bytes: buffer.length, read: () => buffer };
};

describe("lineCounts", () => {
  it("counts a last line with no newline", () => {
    expect(lineCounts("")).toEqual({ lines: 0, nonBlank: 0 });
    expect(lineCounts("a")).toEqual({ lines: 1, nonBlank: 1 });
    expect(lineCounts("a\n")).toEqual({ lines: 1, nonBlank: 1 });
    expect(lineCounts("a\n\n  \t\r\nb")).toEqual({ lines: 4, nonBlank: 2 });
    expect(lineCounts("\r\n\r\n")).toEqual({ lines: 2, nonBlank: 0 });
  });
});

describe("kindOf", () => {
  it("gives the kinds that the scan reads, with the rules of isSource", () => {
    const cases: readonly (readonly [string, number])[] = [
      ["src/a.ts", 10],
      ["src/a.test.ts", 10],
      ["test/b.mjs", 10],
      ["src/a.d.ts", 10],
      ["src/a.generated.ts", 10],
      ["dist/a.js", 10],
      ["src/big.js", 500_000],
      ["src/a.min.js", 10],
    ];
    for (const [path, bytes] of cases) {
      const kind = kindOf(path, bytes);
      // The scan also skips a file over its byte limit, so a bundle is out of it
      const read = isSource(path) && bytes <= 400_000;
      expect([path, kind === "source" || kind === "test"]).toEqual([path, read]);
    }
    expect(kindOf("src/a.test.ts", 10)).toBe("test");
    expect(kindOf("src/a.d.mts", 10)).toBe("declaration");
    expect(kindOf("src/big.js", 500_000)).toBe("bundle");
  });

  it("gives the kinds of the other files", () => {
    expect(kindOf("pnpm-lock.yaml", 10)).toBe("lockfile");
    expect(kindOf("packages/x/package-lock.json", 10)).toBe("lockfile");
    expect(kindOf("package.json", 10)).toBe("json");
    expect(kindOf("README.md", 10)).toBe("markdown");
    expect(kindOf(".github/workflows/ci.yml", 10)).toBe("yaml");
    expect(kindOf("site/a.css", 10)).toBe("style");
    expect(kindOf("site/index.html", 10)).toBe("html");
    expect(kindOf("cue.mod/a.cue", 10)).toBe("cue");
    expect(kindOf("scripts/run.ps1", 10)).toBe("shell");
    expect(kindOf("logo.PNG", 10)).toBe("binary");
    expect(kindOf("LICENSE", 10)).toBe("other");
  });
});

describe("countRepo and buildCorpus", () => {
  const one = countRepo("one", "abc", [
    file("src/a.ts", "export const a = 1;\n\nexport const b = 2;\n"),
    file("src/a.test.ts", "it('a', () => {});\n"),
    file("README.md", "# one\n"),
    file("logo.png", Buffer.from([1, 2, 3])),
    file("data.bin", Buffer.from([65, 0, 10, 66])),
  ]);
  const two = countRepo("two", null, [file("index.js", "a\nb\nc")]);

  it("counts each kind of one repository", () => {
    expect(one.files).toBe(5);
    expect(one.kinds.source).toEqual({ files: 1, lines: 3, nonBlank: 2, bytes: 41 });
    expect(one.kinds.test).toEqual({ files: 1, lines: 1, nonBlank: 1, bytes: 19 });
    expect(one.kinds.binary).toEqual({ files: 1, lines: 0, nonBlank: 0, bytes: 3 });
    // A file with a NUL byte has no lines, also with an extension that the list does not know
    expect(one.kinds.other).toEqual({ files: 1, lines: 0, nonBlank: 0, bytes: 4 });
    expect(Object.keys(one.kinds)).toEqual(["source", "test", "markdown", "binary", "other"]);
  });

  it("adds the repositories, sorted by name, so one input gives one output", () => {
    const corpus = buildCorpus([two, one]);
    expect(corpus.repos.map((repo) => repo.repo)).toEqual(["one", "two"]);
    expect(corpus.totals.repos).toBe(2);
    expect(corpus.totals.files).toBe(6);
    expect(corpus.totals.kinds.source).toEqual({ files: 2, lines: 6, nonBlank: 5, bytes: 46 });
    expect(JSON.stringify(buildCorpus([one, two]))).toBe(JSON.stringify(corpus));
  });

  it("writes Markdown with the totals and a row for each repository", () => {
    const text = corpusMarkdown(buildCorpus([one, two]));
    expect(text).toContain("2 repositories, 6 files");
    expect(text).toContain("The scan reads 3 files: 7 lines, 6 of them not blank (source 6, test 1).");
    expect(text).toContain("| one | 5 | 3 | 1 | 1 | 0.0 |");
    expect(text).toContain("| two | 1 | 3 | 0 | 0 | 0.0 |");
  });
});
