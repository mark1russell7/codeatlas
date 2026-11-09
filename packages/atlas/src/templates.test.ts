import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { factsOfRepo } from "./blobs.ts";
import { queryOf } from "./query.ts";
import { Catalog } from "./store.ts";
import {
  driftMarkdown,
  fileOfTarget,
  keepListOf,
  localForm,
  pinFreshness,
  pinAge,
  pinLag,
  pinsOf,
  stampCheckOfRepo,
  stampFreshness,
  templateDrift,
  templateRecordsOfRepo,
  templateVersionsOfRepo,
  workflowForm,
} from "./templates.ts";
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
    const markdown = driftMarkdown(await pinFreshness(q), await stampFreshness(q));
    expect(markdown).toContain("- Pin freshness: **1 of 4** repositories (25%)");
    expect(markdown).toContain(`| stale | \`${A.slice(0, 7)}\` | 7 | \`.github/actions/setup/action.yml\` |`);
    expect(markdown).toContain("| unknown | `ddddddd` | not known |");
  });

  it("gives the lag of the oldest pin of each repository in commits and in days, and their median", async () => {
    expect(versions.versions.map((v) => v.behind)).toEqual([0, 2, 1]);
    const lag = await pinLag(q);
    expect(lag).toEqual({
      commit: C,
      repos: [
        { repo: "other", ref: A, behind: 2, days: 4 },
        { repo: "stale", ref: A, behind: 2, days: 4 },
        { repo: "bumped", ref: B, behind: 1, days: 2 },
      ],
      unknown: ["unknown"],
      median: { behind: 2, days: 4 },
    });
    const markdown = driftMarkdown(await pinFreshness(q), await stampFreshness(q), lag);
    expect(markdown).toContain(`- Pin lag: with its oldest pin, the median repository is **2 commits** and **4 days** behind \`${C.slice(0, 7)}\` of the template. The worst is other, with 2 commits and 4 days.`);
    expect(markdown).toContain("- Lag not known: `unknown`.");
    expect(markdown).toContain(`| bumped | \`${B.slice(0, 7)}\` | 1 | 2 |`);
  });

  it("finds the oldest change after each ref of each file that differs at the commit of the template", () => {
    const setup = ".github/actions/setup/action.yml";
    const expected = [
      { ref: A, path: setup, changedAt: "2026-11-03T00:00:00.000Z" },
      { ref: A, path: other, changedAt: "2026-11-05T00:00:00.000Z" },
      { ref: B, path: other, changedAt: "2026-11-05T00:00:00.000Z" },
    ];
    const key = (c: { ref: string; path: string }): string => `${c.ref} ${c.path}`;
    expect([...versions.changes].sort((a, b) => key(a).localeCompare(key(b)))).toEqual(expected.sort((a, b) => key(a).localeCompare(key(b))));
  });

  it("gives the age of the oldest change that each repository does not have, its quantiles and the gate", async () => {
    const age = await pinAge(q);
    const setup = { ref: A, path: ".github/actions/setup/action.yml", changedAt: "2026-11-03T00:00:00.000Z" };
    expect(age).toEqual({
      commit: C,
      at: "2026-11-08T00:00:00Z",
      limit: 3,
      repos: [
        { repo: "other", days: 5, oldest: setup },
        { repo: "stale", days: 5, oldest: setup },
        { repo: "bumped", days: 0, oldest: null },
      ],
      unknown: ["unknown"],
      p50: 5,
      p90: 5,
      over: [
        { repo: "other", days: 5, oldest: setup },
        { repo: "stale", days: 5, oldest: setup },
      ],
      pass: false,
    });
    // The age grows with the time of the measure, and not with the count of the commits of the template
    const early = await pinAge(q, { at: "2026-11-06T00:00:00Z" });
    expect([early.p90, early.pass, early.over]).toEqual([3, true, []]);
    expect((await pinAge(q, { limit: 5 })).pass).toBe(true);
    expect(await pinAge(q, { template: "none" })).toMatchObject({ repos: [], p50: null, p90: null, pass: false });
    const markdown = driftMarkdown(await pinFreshness(q), await stampFreshness(q), await pinLag(q), age);
    expect(markdown).toContain("- Pin age, the measure of the gate: p50 **5 days**, p90 **5 days** over 3 repositories. The gate is p90 at most 3 days: **fail**.");
    expect(markdown).toContain("- Age not known: `unknown`.");
    expect(markdown).toContain(`| other | 5 | \`.github/actions/setup/action.yml\`, 2026-11-03 | \`${A.slice(0, 7)}\` |`);
    expect(markdown.indexOf("Pin age")).toBeLessThan(markdown.indexOf("Pin freshness"));
  });
});

/** A command of the stamp for the tests. It gives the result of the check from the files of the repository. */
const STAMP_MAIN_TEXT = `import { existsSync } from "node:fs";
import { join } from "node:path";
const repo = process.argv[process.argv.indexOf("--check") + 1];
const ref = process.argv[process.argv.indexOf("--ref") + 1];
if (existsSync(join(repo, "broken"))) {
  console.error("node:internal/modules/package_json_reader:331");
  console.error("Error [ERR_MODULE_NOT_FOUND]: Cannot find package");
  process.exit(1);
}
if (existsSync(join(repo, "edited"))) {
  console.log(JSON.stringify({ path: "package.json", state: "differs", fields: ["scripts.typecheck"], template: ref }));
  console.log(JSON.stringify({ path: "CI.md", state: "differs", template: ref }));
  process.exit(1);
}
`;

describe("stampCheckOfRepo and stampFreshness", () => {
  const repos = new GitRepos();
  afterAll(() => repos.removeAll());
  const template = repos.with({ "scripts/stamp/main.ts": STAMP_MAIN_TEXT });
  const roots = { fresh: repos.with({ "README.md": "# fresh\n" }), edited: repos.with({ edited: "\n" }), broken: repos.with({ broken: "\n" }) };
  const EDITED = [
    { path: "CI.md", state: "differs", fields: [] },
    { path: "package.json", state: "differs", fields: ["scripts.typecheck"] },
  ];

  it("reads the files that the stamp changes, and an error for each other result", () => {
    expect(stampCheckOfRepo(template, roots.fresh, SHA)).toEqual({ template: SHA, files: [] });
    expect(stampCheckOfRepo(template, roots.edited, SHA)).toEqual({ template: SHA, files: EDITED });
    expect(stampCheckOfRepo(template, roots.broken, SHA)).toEqual({ error: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package" });
    expect(stampCheckOfRepo(template, roots.fresh, "--output=x")).toEqual({ error: "the ref --output=x is not safe" });
  });

  it("counts a repository as current when the stamp changes no file, and leaves out a repository with no result", async () => {
    const catalog = new Catalog(":memory:");
    const put = (name: string, root: string): string => {
      const result = factsOfRepo(name, root, catalog);
      return catalog.putSnapshot(name, "c0", "2026-11-08T00:00:00Z", "test", result.files, result.counts);
    };
    put("template", template);
    for (const [name, root] of Object.entries(roots)) {
      const snapshot = put(name, root);
      catalog.putTemplateRecords(snapshot, { pins: [{ path: ".github/workflows/ci.yml", line: 1, target: ".github/workflows/reusable-ci.yml", ref: SHA }], files: [] });
      const check = stampCheckOfRepo(template, root, SHA);
      if (!("error" in check)) catalog.putStampCheck(snapshot, check);
    }
    const q = queryOf(catalog.db);
    const stamp = await stampFreshness(q);
    expect(stamp).toEqual({ commit: SHA, current: ["fresh"], behind: [{ repo: "edited", files: EDITED }], unchecked: ["broken"], share: 1 / 2 });
    const markdown = driftMarkdown(await pinFreshness(q), stamp);
    expect(markdown).toContain("- Stamp freshness: **1 of 2** repositories (50%). For each current repository, `stamp --check` at `aaaaaaa` of the template changes no file.");
    expect(markdown).toContain("- Not checked: `broken`.");
    expect(markdown).toContain("| edited | `CI.md` (differs), `package.json` (differs: `scripts.typecheck`) |");
    catalog.close();
  });
});
