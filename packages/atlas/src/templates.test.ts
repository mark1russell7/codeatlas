import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { factsOfRepo } from "./blobs.ts";
import { queryOf } from "./query.ts";
import { Catalog } from "./store.ts";
import { driftMarkdown, fileOfTarget, keepListOf, localForm, pinFreshness, pinsOf, templateDrift, templateRecordsOfRepo, templateVersionsOfRepo, workflowForm } from "./templates.ts";
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
  const repos = new GitRepos();
  afterAll(() => repos.removeAll());
  // The template: commit A, then B changes the action that reusable-ci uses, then C changes only reusable-other
  const CALLER = "jobs:\n  ci:\n    steps:\n      - uses: ./.github/actions/setup\n";
  const root = repos.with({ "README.md": "# template\n" });
  const commit = (date: string, files: Readonly<Record<string, string>>): string => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const env = { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
    const git = (...args: string[]): string => execFileSync("git", ["-C", root, "-c", "user.name=atlas", "-c", "user.email=atlas@example.com", "-c", "core.autocrlf=false", ...args], { env, encoding: "utf8" });
    git("add", "-A");
    git("commit", "-q", "-m", date);
    return git("rev-parse", "HEAD").trim();
  };
  const A = commit("2026-11-01T00:00:00Z", {
    ".github/workflows/reusable-ci.yml": CALLER,
    ".github/workflows/reusable-other.yml": "jobs: {}\n",
    ".github/actions/setup/action.yml": "runs:\n  using: composite\n  steps: []\n",
    "CI.md": "# CI\n",
  });
  const B = commit("2026-11-03T00:00:00Z", { ".github/actions/setup/action.yml": "runs:\n  using: composite\n  steps: [{ run: echo }]\n" });
  const C = commit("2026-11-05T00:00:00Z", { ".github/workflows/reusable-other.yml": "jobs: { a: {} }\n" });
  const UNKNOWN = "d".repeat(40);
  const pin = (target: string, ref: string, line = 1) => ({ path: ".github/workflows/ci.yml", line, target, ref });
  const ci = ".github/workflows/reusable-ci.yml";
  const other = ".github/workflows/reusable-other.yml";
  const copy = { path: "CI.md", oid: "x", hash: "y" };
  const records = {
    bumped: { pins: [pin(ci, B), pin(".github/actions/setup", C, 2)], files: [copy] },
    stale: { pins: [pin(ci, A)], files: [] },
    other: { pins: [pin(other, B), pin(ci, A, 2)], files: [] },
    unknown: { pins: [pin(ci, UNKNOWN)], files: [] },
  };
  const catalog = new Catalog(":memory:");
  const empty = repos.with({ "README.md": "# a\n" });
  const put = (name: string, head: string, root: string) => {
    const result = factsOfRepo(name, root, catalog);
    return catalog.putSnapshot(name, head, "2026-11-08T00:00:00Z", "test", result.files, result.counts);
  };
  const template = put("template", C, empty);
  for (const [name, record] of Object.entries(records)) catalog.putTemplateRecords(put(name, "c0", empty), record);
  const versions = templateVersionsOfRepo(root, [A, B, C, UNKNOWN, "--output=x"], ["CI.md"]);
  catalog.putTemplateVersions(template, versions);
  const q = queryOf(catalog.db);
  afterAll(() => catalog.close());

  it("reads the content of each ref, and the files that each shared workflow and action uses", () => {
    expect(versions.versions.map((v) => v.ref)).toEqual([C, A, B]);
    expect(versions.versions[0]?.files.map((f) => f.path)).toEqual([".github/actions/setup/action.yml", ci, other, "CI.md"]);
    expect(versions.uses.filter((u) => u.target === ci).map((u) => u.path)).toEqual([".github/actions/setup/action.yml", ci]);
  });

  it("gives the file of an action folder", () => {
    expect(fileOfTarget(".github/actions/setup", new Set())).toBe(".github/actions/setup/action.yml");
    expect(fileOfTarget(".github/actions/x", new Set([".github/actions/x/action.yaml"]))).toBe(".github/actions/x/action.yaml");
    expect(fileOfTarget(ci, new Set())).toBe(ci);
  });

  it("counts a pin as current when each file that it uses is the same as at the commit of the template", async () => {
    const freshness = await pinFreshness(q);
    expect(freshness.commit).toBe(C);
    expect(freshness.current).toEqual(["bumped"]);
    expect(freshness.share).toBe(1 / 4);
    expect(freshness.behind).toEqual([
      { repo: "unknown", ref: UNKNOWN, days: null, files: [".github/actions/setup/action.yml", ci] },
      { repo: "other", ref: A, days: 7, files: [".github/actions/setup/action.yml", other] },
      { repo: "stale", ref: A, days: 7, files: [".github/actions/setup/action.yml"] },
    ]);
  });

  it("writes the share and the repositories behind as Markdown", async () => {
    const markdown = driftMarkdown(await pinFreshness(q), await templateDrift(q));
    expect(markdown).toContain("Current: **1 of 4** repositories (25%)");
    expect(markdown).toContain(`| stale | \`${A.slice(0, 7)}\` | 7 | \`.github/actions/setup/action.yml\` |`);
    expect(markdown).toContain("| unknown | `ddddddd` | not known |");
  });
});
