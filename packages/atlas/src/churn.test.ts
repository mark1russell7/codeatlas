import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { churnLogArgs, churnOfLog, churnOfRepo } from "./churn.ts";
import { GitRepos } from "./testing/git-repo.ts";

const repos = new GitRepos();
const folders: string[] = [];
afterAll(() => {
  repos.removeAll();
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

describe("churnOfLog", () => {
  it("counts the commits and the authors of each path of the tree, once for each commit", () => {
    const log = [
      "\x1eaaa\x1fAnn@example.com\x1f2026-11-08T10:00:00+00:00\n\nsrc/a.ts\nsrc/b.ts\nsrc/gone.ts\n",
      "\x1ebbb\x1fann@example.com\x1f2026-11-07T10:00:00+00:00\n\nsrc/a.ts\n",
      "\x1eccc\x1fbob@example.com\x1f2026-11-09T10:00:00+00:00\n\nsrc/a.ts\nsrc/a.ts\n",
    ].join("");
    expect(churnOfLog(log, new Set(["src/a.ts", "src/b.ts"]))).toEqual([
      { path: "src/a.ts", commits: 3, authors: 2, lastAt: "2026-11-09T10:00:00+00:00" },
      { path: "src/b.ts", commits: 1, authors: 1, lastAt: "2026-11-08T10:00:00+00:00" },
    ]);
  });

  it("gives the window of days that ends at the time of the scan", () => {
    const args = churnLogArgs("/r", "2026-11-09T00:00:00.000Z", 90);
    expect(args).toContain("--since=2026-08-11T00:00:00.000Z");
    expect(args).toContain("--until=2026-11-09T00:00:00.000Z");
  });
});

describe("churnOfRepo", () => {
  it("reads the history of a clone, and gives null for a shallow clone", () => {
    const root = repos.with({ "src/a.ts": "export const a = 1;\n", "README.md": "# r\n" });
    const now = new Date(Date.now() + 60_000).toISOString();
    const churn = churnOfRepo(root, new Set(["src/a.ts", "README.md"]), now);
    expect(churn?.map((c) => [c.path, c.commits, c.authors])).toEqual([
      ["README.md", 1, 1],
      ["src/a.ts", 1, 1],
    ]);
    // A window that ends before the commit has no commit
    expect(churnOfRepo(root, new Set(["src/a.ts"]), "2000-01-01T00:00:00Z")).toEqual([]);

    const folder = mkdtempSync(join(tmpdir(), "atlas-shallow-"));
    folders.push(folder);
    const shallow = join(folder, "r");
    execFileSync("git", ["clone", "--quiet", "--depth", "1", `file://${root.replace(/\\/g, "/")}`, shallow], { stdio: "pipe" });
    expect(churnOfRepo(shallow, new Set(["src/a.ts"]), now)).toBeNull();
  });
});
