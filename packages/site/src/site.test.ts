import { describe, expect, it } from "vitest";
import type { Atlas, CloneClass, Member, QuerySet, RepoPoint, Trend } from "@mark1russell7/codeatlas";
import { ATLAS_LIMIT, atlasStamps, compilePage, dataLine, pageHtml, parseSiteArgs, readAtlas, scrollCueCss } from "./build.ts";
import { levelRows, markerTable, matches, NO_FILTER, NO_TOPIC, pairShares, placeOf, repoChanges, sourceUrl, stepOf, titleOf, topicRows, trendRows } from "./page.ts";

const member = (repo: string, name: string, test = false): Member => ({ repo, file: `src/${name}.ts`, line: 3, name, exported: true, test });

const klass = (hash: string, nodes: number, members: Member[], topics: string[] = []): CloneClass => ({
  hash,
  nodes,
  repos: [...new Set(members.map((m) => m.repo))].sort(),
  members,
  duplicatedNodes: nodes * (members.length - 1),
  topics,
  homes: [],
});

const repoRow = (repo: string, crossRepoClasses: number) => ({
  repo, commit: null, files: 1, functions: 1, nodes: 100, duplicatedNodes: 0, ratio: 0, crossRepoClasses, parseErrors: 0,
});

const ATLAS: Atlas = {
  schema: "codeatlas/1",
  minNodes: 40,
  totals: { repos: 3, files: 3, functions: 3, nodes: 300, duplicatedNodes: 150, ratio: 0.5, classes: 3, crossRepoClasses: 2 },
  repos: [repoRow("a", 2), repoRow("b", 1), repoRow("c", 1), repoRow("d", 0)],
  classes: [
    klass("1", 100, [member("a", "seeded"), member("b", "mulberry")], ["generators"]),
    klass("2", 50, [member("a", "tabs"), member("c", "tabs")]),
    klass("3", 40, [member("d", "x", true), member("d", "y", true)]),
  ],
  sharedNames: [],
  purposes: [],
  homed: [],
};

describe("matches", () => {
  it("keeps the cross-repo classes by default", () => {
    expect(ATLAS.classes.filter((c) => matches(c, NO_FILTER)).map((c) => c.hash)).toEqual(["1", "2"]);
  });
  it("filters by a pair of repositories, a topic and a search", () => {
    const pick = (f: Partial<typeof NO_FILTER>): string[] => ATLAS.classes.filter((c) => matches(c, { ...NO_FILTER, ...f })).map((c) => c.hash);
    expect(pick({ repo: "a", repo2: "c" })).toEqual(["2"]);
    expect(pick({ topic: "generators" })).toEqual(["1"]);
    expect(pick({ topic: NO_TOPIC })).toEqual(["2"]);
    expect(pick({ query: "MULBERRY" })).toEqual(["1"]);
    expect(pick({ crossOnly: false })).toEqual(["1", "2", "3"]);
    expect(pick({ crossOnly: false, hideTests: true })).toEqual(["1", "2"]);
  });
});

describe("pairShares", () => {
  it("sums the size of each class that two repositories both have, and leaves out the repositories with no shared class", () => {
    const p = pairShares(ATLAS);
    expect(p.repos).toEqual(["a", "b", "c"]);
    expect(p.shared).toEqual([
      [0, 100, 50],
      [100, 0, 0],
      [50, 0, 0],
    ]);
    expect(p.max).toBe(100);
  });
});

describe("topicRows", () => {
  it("counts the cross-repo classes of each topic, the largest first", () => {
    expect(topicRows(ATLAS)).toEqual([
      { topic: "generators", classes: 1, duplicatedNodes: 100 },
      { topic: NO_TOPIC, classes: 1, duplicatedNodes: 50 },
    ]);
  });
});

describe("stepOf", () => {
  it("puts a value on a log scale, and gives no color to 0", () => {
    expect(stepOf(0, 1000, 7)).toBe(-1);
    expect(stepOf(1000, 1000, 7)).toBe(6);
    expect(stepOf(1, 1000, 7)).toBe(0);
    expect(stepOf(31, 1000, 7)).toBe(3);
    expect(stepOf(1, 1, 7)).toBe(6);
  });
});

describe("titleOf", () => {
  it("takes the first member with a name, else the file name", () => {
    expect(titleOf(klass("4", 40, [member("a", "<anonymous>"), member("b", "seeded")]))).toBe("seeded");
    expect(titleOf(klass("5", 40, [member("a", "<anonymous>"), member("b", "<anonymous>")]))).toBe("<anonymous> in <anonymous>.ts");
  });
});

describe("sourceUrl", () => {
  it("links to the line at the commit of the scan", () => {
    expect(sourceUrl("o", "abc", { ...member("r", "f"), file: "a b/c.ts" })).toBe("https://github.com/o/r/blob/abc/a%20b/c.ts#L3");
    expect(sourceUrl("o", null, member("r", "f"))).toBe("https://github.com/o/r/blob/HEAD/src/f.ts#L3");
  });
});

describe("the build", () => {
  it("reads the arguments, with the owner of the CI run as the default", () => {
    expect(parseSiteArgs(["--atlas", "a.json", "--out", "dist"], { GITHUB_REPOSITORY_OWNER: "o" })).toEqual({ atlas: "a.json", out: "dist", owner: "o", markdown: undefined });
    expect(parseSiteArgs(["--out", "dist"], {})).toHaveProperty("error");
    expect(parseSiteArgs(["--atlas"], {})).toHaveProperty("error");
  });
  it("refuses an atlas of a different schema", () => {
    expect(() => readAtlas('{"schema":"codeatlas/2"}')).toThrow(/codeatlas\/2/);
    expect(readAtlas(JSON.stringify(ATLAS)).totals.repos).toBe(3);
  });
  it("compiles the page to JavaScript with no types and no imports", () => {
    const js = compilePage("import type { A } from \"x\";\nexport const f = (a: A): number => 1;\n");
    expect(js).not.toMatch(/import|: number/);
    expect(js).toMatch(/export const f/);
  });
  it("writes a page with the script, and escapes the owner", () => {
    const html = pageHtml("console.log('</script>')", ATLAS, "o<x>", dataLine(undefined, "2026-10-29"));
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("o&lt;x&gt;");
    expect(html).not.toContain("console.log('</script>')");
    expect(html).toContain("50.0% of the code is a copy");
  });
  it("inlines the scroll cue of site-pages before the CSS of the page", () => {
    const html = pageHtml("", ATLAS, "o", dataLine(undefined, "2026-10-29"));
    const cue = scrollCueCss();
    expect(cue).toContain(".scroll-cue {");
    expect(html).toContain(cue);
    expect(html.indexOf(cue)).toBeLessThan(html.indexOf(".scroll{max-width:100%;--scroll-cue-bg:var(--surface)}"));
  });
  it("stamps the page with the run, the engine and the limit in a CI run", () => {
    const env = { GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/codeatlas", GITHUB_RUN_ID: "7" };
    const stamps = atlasStamps(env, "0.1.0", "2026-11-05T00:00:00.000Z");
    expect(stamps?.pages[0]).toEqual({
      page: "index.html",
      runs: [{ id: "7", url: "https://github.com/o/codeatlas/actions/runs/7", date: "2026-11-05T00:00:00.000Z", engines: { "@mark1russell7/codeatlas": "0.1.0" } }],
      limit: ATLAS_LIMIT,
    });
    const html = pageHtml("", ATLAS, "o", dataLine(stamps?.pages[0], "2026-11-05"));
    expect(html).toContain('href="https://github.com/o/codeatlas/actions/runs/7"');
    expect(html).toContain("The age limit of this data is 8 days.");
    expect(html).toContain("codeatlas 0.1.0");
  });
  it("gives no stamps for a build with no run, and the page says so", () => {
    expect(atlasStamps({}, "0.1.0", "2026-11-05T00:00:00.000Z")).toBeUndefined();
    expect(dataLine(undefined, "2026-11-05")).toContain("This build has no run.");
  });
});

describe("the trend", () => {
  const repo = (name: string, nodes: number, renamed: number): RepoPoint => ({
    repo: name,
    commit: "c",
    files: 1,
    functions: 1,
    nodes,
    duplicated: { exact: 0, renamed, shape: renamed },
  });
  const trend: Trend = {
    version: "trend/1",
    points: [
      { at: "2026-11-09T06:40:00Z", scanner: "facts/1", repos: [repo("a", 100, 10), repo("b", 100, 30)] },
      { at: "2026-11-16T06:40:00Z", scanner: "facts/1", repos: [repo("a", 200, 10), repo("b", 100, 40), repo("c", 50, 0)] },
    ],
  };

  it("gives the ratio of all repositories at each point", () => {
    expect(trendRows(trend).map((row) => [row.nodes, row.duplicated, row.ratio])).toEqual([
      [200, 40, 0.2],
      [350, 50, 50 / 350],
    ]);
    expect(trendRows(trend, "exact").map((row) => row.ratio)).toEqual([0, 0]);
  });

  it("gives the change of each repository since its first point, the largest growth first", () => {
    expect(repoChanges(trend).map((row) => [row.repo, row.first, row.last])).toEqual([
      ["b", 0.3, 0.4],
      ["c", 0, 0],
      ["a", 0.1, 0.05],
    ]);
    expect(repoChanges({ version: "trend/1", points: [] })).toEqual([]);
  });
});

describe("the query set", () => {
  const level = (classes: number, duplicatedNodes: number) => ({ classes, members: classes * 2, duplicatedNodes });
  const set: QuerySet = {
    version: "queries/2",
    at: "2026-11-09T06:40:00Z",
    scanner: "facts/1",
    limits: { exactClasses: 25, complexMin: 15, complexLimit: 100 },
    repos: [{ repo: "a", commit: "c1" }],
    duplication: { levels: { exact: level(1, 50), renamed: level(3, 150), shape: level(4, 200) }, topNodes: 1000, ratio: { exact: 0.05, renamed: 0.15, shape: 0.2 } },
    exact: [],
    homes: [],
    complex: [],
    markers: [
      { repo: "a", kind: "todo", count: 1 },
      { repo: "b", kind: "non-null", count: 4 },
      { repo: "b", kind: "todo", count: 2 },
    ],
  };

  it("gives one row for each level, in the order of the chain", () => {
    expect(levelRows(set).map((r) => [r.level, r.classes, r.duplicatedNodes, r.ratio])).toEqual([
      ["exact", 1, 50, 0.05],
      ["renamed", 3, 150, 0.15],
      ["shape", 4, 200, 0.2],
    ]);
  });

  it("gives the markers as a table, the repository with the most first", () => {
    const table = markerTable(set);
    expect(table.kinds).toEqual(["non-null", "todo"]);
    expect(table.rows).toEqual([
      { repo: "b", counts: { "non-null": 4, todo: 2 }, total: 6 },
      { repo: "a", counts: { todo: 1 }, total: 1 },
    ]);
  });

  it("links a function of the catalog to its line at the commit", () => {
    expect(sourceUrl("o", "c1", placeOf({ repo: "a", path: "src/x y.ts", name: "f", line: 7 }))).toBe("https://github.com/o/a/blob/c1/src/x%20y.ts#L7");
  });
});
