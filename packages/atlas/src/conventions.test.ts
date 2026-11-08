import { afterAll, describe, expect, it } from "vitest";
import { CONVENTIONS_VERSION, conventionsBreaks, conventionsCheckOfRepo, conventionsMarkdown, type ConventionsCheck } from "./conventions.ts";
import { factsOfRepo } from "./blobs.ts";
import { queryOf } from "./query.ts";
import { Catalog } from "./store.ts";
import { GitRepos } from "./testing/git-repo.ts";

const repos = new GitRepos();
afterAll(() => repos.removeAll());

const check = (rules: ConventionsCheck["rules"]): ConventionsCheck => ({ version: "0.35.0", rules });
const pass = { status: "pass" as const, ignored: 0, note: null, breaks: [] };

describe("conventionsCheckOfRepo", () => {
  it("gives the status of each rule and the breaks of a repository", () => {
    const root = repos.with({ "package.json": `${JSON.stringify({ name: "app", version: "0.1.0" })}\n` });
    const result = conventionsCheckOfRepo(root);
    if ("error" in result) throw new Error(result.error);
    expect(result.version).toBe(CONVENTIONS_VERSION);
    expect(result.rules.map((r) => r.rule)).toEqual([...result.rules.map((r) => r.rule)].sort());
    const license = result.rules.find((r) => r.rule === "license-file");
    expect(license?.status).toBe("break");
    expect(license?.breaks[0]).toMatchObject({ file: "package.json", fixable: expect.any(Boolean) });
    // The rules that examine a change have no base in the scan
    expect(result.rules.find((r) => r.rule === "home-package")?.status).toBe("skipped");
    // The clones of the scan have no install, so the rules that need one skip with a note
    expect(result.rules.find((r) => r.rule === "typed-files")).toEqual({ rule: "typed-files", status: "skipped", ignored: 0, note: expect.stringContaining("install"), breaks: [] });
  });
});

describe("conventionsBreaks", () => {
  it("counts the clean repositories, and the breaks of each rule and each repository", async () => {
    const catalog = new Catalog(":memory:");
    afterAll(() => catalog.close());
    const put = (name: string): string => {
      const root = repos.with({ "README.md": `# ${name}\n` });
      const result = factsOfRepo(name, root, catalog);
      return catalog.putSnapshot(name, "c0", "2026-11-08T00:00:00Z", "test", result.files, result.counts);
    };
    const broken = { file: ".github/workflows/ci.yml", line: 78, message: "A step has a pipe and no pipefail.", fixable: true };
    catalog.putConventionsCheck(put("clean"), check([{ rule: "pipe-fails", ...pass }]));
    catalog.putConventionsCheck(put("one"), check([{ rule: "pipe-fails", ...pass, status: "break", breaks: [broken, { ...broken, line: 90 }] }]));
    catalog.putConventionsCheck(
      put("two"),
      check([
        { rule: "pipe-fails", ...pass, status: "break", breaks: [{ ...broken, fixable: false }] },
        { rule: "license-file", ...pass, status: "break", breaks: [{ file: "package.json", line: null, message: "No license.", fixable: true }] },
      ]),
    );
    catalog.putConventionsCheck(put("threw"), check([{ rule: "runner-budget", ...pass, status: "error", note: "boom" }]));
    put("none");
    const result = await conventionsBreaks(queryOf(catalog.db));
    expect(result).toEqual({
      version: "0.35.0",
      checked: 4,
      clean: ["clean"],
      broken: [
        { repo: "one", breaks: 2, rules: 1 },
        { repo: "two", breaks: 2, rules: 2 },
      ],
      unchecked: ["none"],
      rules: [
        { rule: "pipe-fails", repos: ["one", "two"], breaks: 3, fixable: 2, errors: [] },
        { rule: "license-file", repos: ["two"], breaks: 1, fixable: 1, errors: [] },
        { rule: "runner-budget", repos: [], breaks: 0, fixable: 0, errors: ["threw"] },
      ],
      share: 1 / 4,
    });
    const markdown = conventionsMarkdown(result);
    expect(markdown).toContain("- Clean: **1 of 4** repositories (25%). In each clean repository, `conventions check` 0.35.0 finds no break, and no rule throws.");
    expect(markdown).toContain("- Not checked: `none`.");
    expect(markdown).toContain("- The rules that need an install of the packages skip, because the clones of the scan have none: `typed-files`.");
    expect(markdown).toContain("| `pipe-fails` | 2 | 3 | 2 |  |");
    expect(markdown).toContain("| `runner-budget` | 0 | 0 | 0 | threw |");
    expect(markdown).toContain("| one | 2 | 1 |");
  });

  it("drops the check of a snapshot when the snapshot is scanned again", async () => {
    const catalog = new Catalog(":memory:");
    const root = repos.with({ "README.md": "# again\n" });
    const scan = factsOfRepo("again", root, catalog);
    const snapshot = catalog.putSnapshot("again", "c0", "2026-11-08T00:00:00Z", "test", scan.files, scan.counts);
    catalog.putConventionsCheck(snapshot, check([{ rule: "pipe-fails", ...pass }]));
    catalog.putSnapshot("again", "c0", "2026-11-08T01:00:00Z", "test", scan.files, scan.counts);
    expect((await conventionsBreaks(queryOf(catalog.db))).unchecked).toEqual(["again"]);
    catalog.close();
  });
});
