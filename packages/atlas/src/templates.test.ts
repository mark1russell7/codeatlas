import { afterAll, describe, expect, it } from "vitest";
import { factsOfRepo } from "./blobs.ts";
import { queryOf } from "./query.ts";
import { Catalog } from "./store.ts";
import { driftMarkdown, historyOf, keepListOf, localForm, pinFreshness, pinsOf, templateDrift, templateRecordsOfRepo, workflowForm } from "./templates.ts";
import { GitRepos } from "./testing/git-repo.ts";

const STAMP = `import { join } from "node:path";
/** The files of a new repository. */
export const KEEP: readonly string[] = [
  ".github/workflows/ci.yml",
  "CI.md",
  "renovate.json",
];
export const OTHER = ["x"];
`;

const SHA = "a".repeat(40);
const OLD = "b".repeat(40);

/** The workflow of the template: a local path of the shared workflow. */
const CI_TEMPLATE = `name: CI
jobs:
  ci:
    uses: ./.github/workflows/reusable-ci.yml
`;

const ci = (sha: string): string => `name: CI
jobs:
  ci:
    uses: mark1russell7/template/.github/workflows/reusable-ci.yml@${sha} # main
`;

describe("keepListOf", () => {
  it("reads the strings of the export KEEP", () => {
    expect(keepListOf(STAMP)).toEqual([".github/workflows/ci.yml", "CI.md", "renovate.json"]);
  });

  it("gives undefined without KEEP, or when an element is not a string", () => {
    expect(keepListOf("export const OTHER = [1];")).toBeUndefined();
    expect(keepListOf("const x = 1;\nexport const KEEP = [x];")).toBeUndefined();
  });
});

describe("pinsOf and localForm", () => {
  it("gives each pin with its line, its target and its ref", () => {
    const text = `${ci(SHA)}  security:\n    steps:\n      - uses: "mark1russell7/template/.github/actions/security-scan@main"\n      - uses: actions/checkout@v6\n`;
    expect(pinsOf("w.yml", text)).toEqual([
      { path: "w.yml", line: 4, target: ".github/workflows/reusable-ci.yml", ref: SHA },
      { path: "w.yml", line: 7, target: ".github/actions/security-scan", ref: "main" },
    ]);
  });

  it("gives the local form of the template for a pinned workflow", () => {
    expect(localForm(ci(SHA))).toBe(CI_TEMPLATE);
  });

  it("reads a long crafted line in linear time", () => {
    const line = `uses: mark1russell7/template/${"a/".repeat(50_000)}`;
    const started = performance.now();
    expect(pinsOf("w.yml", line)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe("templateDrift", () => {
  const repos = new GitRepos();
  afterAll(() => repos.removeAll());
  const roots = {
    template: repos.with({ "scripts/stamp/stamp.ts": STAMP, ".github/workflows/ci.yml": CI_TEMPLATE, "CI.md": "# CI\n", "renovate.json": "{}\n" }),
    current: repos.with({ ".github/workflows/ci.yml": ci(SHA), "CI.md": "# CI\n", "renovate.json": "{}\n" }),
    old: repos.with({ ".github/workflows/ci.yml": ci(OLD), "CI.md": "# CI of old\n" }),
    other: repos.with({ "README.md": "# other\n" }),
  };
  const keep = keepListOf(STAMP) ?? [];
  const catalog = new Catalog(":memory:");
  for (const [name, root] of Object.entries(roots)) {
    const result = factsOfRepo(name, root, catalog);
    const snapshot = catalog.putSnapshot(name, name === "template" ? SHA : "c0", "2026-11-08T00:00:00Z", "test", result.files, result.counts);
    catalog.putTemplateRecords(snapshot, templateRecordsOfRepo(root, keep));
  }
  const q = queryOf(catalog.db);
  afterAll(() => catalog.close());

  it("gives each repository that pins the template, with its pins and the states of its copied files", async () => {
    const drift = await templateDrift(q);
    expect(drift.template).toEqual({ repo: "template", commit: SHA });
    expect(drift.repos.map((r) => [r.repo, r.behind, r.changed, r.files.map((f) => `${f.path}:${f.state}`)])).toEqual([
      ["old", 1, 2, [".github/workflows/ci.yml:same", "CI.md:changed", "renovate.json:missing"]],
      ["current", 0, 0, [".github/workflows/ci.yml:same", "CI.md:same", "renovate.json:same"]],
    ]);
    expect(drift.refs).toEqual([
      { ref: SHA, current: true, repos: ["current"] },
      { ref: OLD, current: false, repos: ["old"] },
    ]);
  });

  it("scans a snapshot again over its template records", () => {
    const again = new Catalog(":memory:");
    for (let i = 0; i < 2; i++) {
      const result = factsOfRepo("old", roots.old, again);
      const snapshot = again.putSnapshot("old", "c0", "2026-11-08T00:00:00Z", "test", result.files, result.counts);
      again.putTemplateRecords(snapshot, templateRecordsOfRepo(roots.old, keep));
    }
    expect(again.db.prepare("SELECT count(*) AS n FROM current_template_pin").get()).toEqual({ n: 1 });
    again.close();
  });
});

describe("workflowForm", () => {
  const called = (sha: string, inputs: string): string => `name: CI
on: push
jobs:
  ci:
    uses: mark1russell7/template/.github/workflows/reusable-ci.yml@${sha} # main
${inputs}  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: mark1russell7/template/.github/actions/gate-summary@${sha} # main
        with:
          needs: x
`;
  const template = called(SHA, "").replace(/mark1russell7\/template\/(\S+)@\S+ # main/g, "./$1");

  it("ignores the pins and the inputs of the shared workflows and actions", () => {
    const own = called(OLD, `    with:
      node: 24
    secrets: inherit
`);
    expect(workflowForm(own)).toBe(workflowForm(template));
  });

  it("sees a change outside the inputs", () => {
    expect(workflowForm(called(SHA, "").replace("on: push", "on: pull_request"))).not.toBe(workflowForm(template));
  });

  it("keeps the inputs of a step that does not use the template", () => {
    const step = (version: string): string => `jobs:
  a:
    steps:
      - uses: actions/setup-node@v6
        with:
          node-version: ${version}
`;
    expect(workflowForm(step("22"))).not.toBe(workflowForm(step("24")));
  });

  it("drops a job that runs only in the template, and its name in each needs", () => {
    const jobs = (extra: string, needs: string): string =>
      `jobs:\n  a:\n    runs-on: ubuntu-latest\n${extra}  ok:\n    needs: [${needs}]\n    runs-on: ubuntu-latest\n`;
    const only = "  stamp:\n    if: github.repository == 'mark1russell7/template'\n    runs-on: ubuntu-latest\n";
    expect(workflowForm(jobs(only, "a, stamp"))).toBe(workflowForm(jobs("", "a")));
    expect(workflowForm(jobs(only.replace("if: github", "if: ${{ github").replace("template'", "template' }}"), "a, stamp"))).toBe(workflowForm(jobs("", "a")));
  });

  it("gives the local form of a text that does not parse", () => {
    const text = "jobs: [\n";
    expect(workflowForm(text)).toBe(localForm(text));
  });
});

describe("pinFreshness", () => {
  const NEW = "c".repeat(40);
  const repos = new GitRepos();
  afterAll(() => repos.removeAll());
  const root = repos.with({ "README.md": "# a\n" });
  const catalog = new Catalog(":memory:");
  const pin = (ref: string, line = 1) => ({ path: ".github/workflows/ci.yml", line, target: ".github/workflows/reusable-ci.yml", ref });
  const records = {
    template: { pins: [], files: [], commits: [NEW, SHA, OLD] },
    newest: { pins: [pin(NEW)], files: [], commits: [] },
    second: { pins: [pin(SHA), pin(NEW, 2)], files: [], commits: [] },
    third: { pins: [pin(OLD), pin(NEW, 2)], files: [], commits: [] },
    unknown: { pins: [pin("d".repeat(40)), pin(OLD, 2)], files: [], commits: [] },
    branch: { pins: [pin("main")], files: [], commits: [] },
  };
  for (const [name, record] of Object.entries(records)) {
    const result = factsOfRepo(name, root, catalog);
    const snapshot = catalog.putSnapshot(name, "c0", "2026-11-08T00:00:00Z", "test", result.files, result.counts);
    catalog.putTemplateRecords(snapshot, record);
  }
  const q = queryOf(catalog.db);
  afterAll(() => catalog.close());

  it("counts a repository as current when each pin is at one of the newest commits", async () => {
    const freshness = await pinFreshness(q);
    expect(freshness.commits).toEqual([NEW, SHA]);
    expect(freshness.current).toEqual(["newest", "second"]);
    expect(freshness.share).toBe(2 / 5);
    expect(freshness.behind).toEqual([
      { repo: "branch", ref: "main", age: null },
      { repo: "unknown", ref: "d".repeat(40), age: null },
      { repo: "third", ref: OLD, age: 2 },
    ]);
  });

  it("takes the count of the newest commits as a parameter", async () => {
    expect((await pinFreshness(q, 3)).current).toEqual(["newest", "second", "third"]);
  });

  it("writes the share and the repositories behind as Markdown", async () => {
    const markdown = driftMarkdown(await pinFreshness(q), await templateDrift(q));
    expect(markdown).toContain("Current: **2 of 5** repositories (40%)");
    expect(markdown).toContain("| third | `bbbbbbb` | 2 | 0 |");
    expect(markdown).toContain("| branch | `main` | more than the history | 0 |");
  });

  it("reads the first-parent history of a repository", () => {
    expect(historyOf(root, 30)).toHaveLength(1);
    expect(historyOf(root, 0)).toEqual([]);
  });
});
