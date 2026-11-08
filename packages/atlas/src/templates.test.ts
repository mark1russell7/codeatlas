import { afterAll, describe, expect, it } from "vitest";
import { factsOfRepo } from "./blobs.ts";
import { queryOf } from "./query.ts";
import { Catalog } from "./store.ts";
import { keepListOf, localForm, pinsOf, templateDrift, templateRecordsOfRepo } from "./templates.ts";
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
