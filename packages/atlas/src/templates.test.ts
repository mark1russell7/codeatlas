import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { factsOfRepo } from "./blobs.ts";
import { queryOf } from "./query.ts";
import { Catalog } from "./store.ts";
import {
  copyForm,
  driftMarkdown,
  fileOfTarget,
  keepListOf,
  localForm,
  pinFreshness,
  pinsOf,
  stampFreshness,
  stampRulesOf,
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
});

/** A short form of the stamp of the template, with the parts that `stampRulesOf` reads. */
const STAMP_RULES_TEXT = `export const KEEP: readonly string[] = [".github/workflows/ci.yml", "CI.md", "package.json", "notes.txt"];
export async function stamp({ name, template, out }: StampOptions): Promise<string> {
  for (const path of KEEP) {
    const target = join(out, path);
    const blob = git(template, "show", path);
    writeFileSync(target, path.startsWith(".github/workflows/") ? pinWorkflow(blob.toString("utf8"), sha) : blob);
  }
  const rootFile = join(out, "package.json");
  const root = JSON.parse(readFileSync(rootFile, "utf8")) as { name: string; scripts: Record<string, string> };
  root.name = \`\${name}-monorepo\`;
  root.scripts = rootScripts(root.scripts);
  writeFileSync(rootFile, JSON.stringify(root));
  execFileSync(process.execPath, [conventions, "fix", "--rule", "runner-budget"], { cwd: out });
  return sha;
}
`;

describe("stampRulesOf and copyForm", () => {
  const keep = keepListOf(STAMP_RULES_TEXT) ?? [];
  const rules = stampRulesOf(STAMP_RULES_TEXT, keep);

  it("reads the rule of the stamp for each file of KEEP, and the fixes that it starts", () => {
    expect(rules.rules).toEqual([
      { path: ".github/workflows/ci.yml", rule: "pinned", fields: [] },
      { path: "CI.md", rule: "whole", fields: [] },
      { path: "package.json", rule: "merged", fields: ["name", "scripts"] },
      { path: "notes.txt", rule: "whole", fields: [] },
    ]);
    expect(rules.fixes).toEqual(["runner-budget"]);
  });

  it("gives no rule when the stamp has no loop over KEEP", () => {
    expect(stampRulesOf("export const KEEP = [\"a\"];\n", ["a"]).rules).toEqual([]);
  });

  it("compares a merged file without the fields that the stamp sets", () => {
    const form = (json: object): string => copyForm("package.json", JSON.stringify(json), rules);
    expect(form({ name: "a-monorepo", scripts: { x: "1" }, type: "module" })).toBe(form({ type: "module", name: "template-monorepo" }));
    expect(form({ type: "module" })).not.toBe(form({ type: "commonjs" }));
  });

  it("compares a pinned workflow without the minute of its schedules, because the stamp starts the fix of the schedules", () => {
    const cron = (minute: string): string => `on:\n  schedule:\n    - cron: "${minute} 5 * * 1"\njobs: {}\n`;
    expect(copyForm(".github/workflows/ci.yml", cron("28"), rules)).toBe(copyForm(".github/workflows/ci.yml", cron("56"), rules));
    expect(copyForm(".github/workflows/ci.yml", cron("28"), { rules: rules.rules, fixes: [] })).not.toBe(copyForm(".github/workflows/ci.yml", cron("56"), { rules: rules.rules, fixes: [] }));
  });
});

describe("stampFreshness", () => {
  const repos = new GitRepos();
  afterAll(() => repos.removeAll());
  const keep = keepListOf(STAMP_RULES_TEXT) ?? [];
  const rules = stampRulesOf(STAMP_RULES_TEXT, keep);
  const workflow = (sha: string, minute: string): string =>
    `on:\n  schedule:\n    - cron: "${minute} 5 * * 1"\njobs:\n  ci:\n    uses: mark1russell7/template/.github/workflows/reusable-ci.yml@${sha} # main\n`;
  const roots = {
    template: repos.with({
      ".github/workflows/ci.yml": "on:\n  schedule:\n    - cron: \"28 5 * * 1\"\njobs:\n  ci:\n    uses: ./.github/workflows/reusable-ci.yml\n",
      "CI.md": "# CI\n",
      "package.json": '{"name":"template-monorepo","type":"module"}\n',
    }),
    fresh: repos.with({ ".github/workflows/ci.yml": workflow(SHA, "56"), "CI.md": "# CI\n", "package.json": '{"name":"fresh-monorepo","type":"module","scripts":{"a":"b"}}\n' }),
    edited: repos.with({ ".github/workflows/ci.yml": workflow(OLD, "10"), "CI.md": "# CI of edited\n" }),
  };
  const catalog = new Catalog(":memory:");
  let template = "";
  for (const [name, root] of Object.entries(roots)) {
    const result = factsOfRepo(name, root, catalog);
    const snapshot = catalog.putSnapshot(name, name === "template" ? SHA : "c0", "2026-11-08T00:00:00Z", "test", result.files, result.counts);
    catalog.putTemplateRecords(snapshot, templateRecordsOfRepo(root, keep, undefined, rules));
    if (name === "template") template = snapshot;
  }
  catalog.putStampRules(template, rules);
  const q = queryOf(catalog.db);
  afterAll(() => catalog.close());

  it("counts a repository as current when each copy with a rule is the same by that rule", async () => {
    const stamp = await stampFreshness(q);
    expect(stamp.current).toEqual(["fresh"]);
    expect(stamp.behind).toEqual([{ repo: "edited", files: [{ path: "CI.md", state: "changed" }, { path: "package.json", state: "missing" }] }]);
    expect(stamp.share).toBe(1 / 2);
    expect(stamp.fixes).toEqual(["runner-budget"]);
  });

  it("lists a file of KEEP with no rule as not known, and does not count it", async () => {
    const other = new Catalog(":memory:");
    for (const [name, root] of Object.entries(roots)) {
      const result = factsOfRepo(name, root, other);
      const snapshot = other.putSnapshot(name, name === "template" ? SHA : "c0", "2026-11-08T00:00:00Z", "test", result.files, result.counts);
      other.putTemplateRecords(snapshot, templateRecordsOfRepo(root, keep, undefined, rules));
      if (name === "template") other.putStampRules(snapshot, { rules: rules.rules.filter((r) => r.path !== "CI.md"), fixes: rules.fixes });
    }
    const stamp = await stampFreshness(queryOf(other.db));
    expect(stamp.unknown).toEqual(["CI.md"]);
    expect(stamp.behind).toEqual([{ repo: "edited", files: [{ path: "package.json", state: "missing" }] }]);
    other.close();
  });

  it("writes the rules of the stamp as Markdown", async () => {
    const markdown = driftMarkdown(await pinFreshness(q), await stampFreshness(q));
    expect(markdown).toContain("- Stamp freshness: **1 of 2** repositories (50%)");
    expect(markdown).toContain("| `package.json` | merged | `name`, `scripts` |");
    expect(markdown).toContain("| edited | `CI.md` (changed), `package.json` (missing) |");
  });
});
