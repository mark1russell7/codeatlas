import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { callerOf } from "@procedures/client";
import { createMcpHost } from "@procedures/mcp-server";
import { afterAll, describe, expect, it } from "vitest";
import { queryOf } from "./query.ts";
import { repoOfRemote, rescanRepo, scanRepoInto } from "./rescan.ts";
import { Catalog } from "./store.ts";
import { GitRepos } from "./testing/git-repo.ts";
import { atlasTools } from "./tools.ts";

const repos = new GitRepos();
afterAll(() => repos.removeAll());

const git = (root: string, ...args: string[]): string =>
  execFileSync("git", ["-C", root, "-c", "user.name=atlas", "-c", "user.email=atlas@example.com", ...args], { encoding: "utf8" }).trim();

describe("repoOfRemote", () => {
  it("gives the name of the repository of a remote URL", () => {
    expect(repoOfRemote("https://github.com/o/codeatlas.git")).toBe("codeatlas");
    expect(repoOfRemote("https://github.com/o/codeatlas/")).toBe("codeatlas");
    expect(repoOfRemote("git@github.com:o/codeatlas.git")).toBe("codeatlas");
    expect(repoOfRemote("codeatlas")).toBe("codeatlas");
    expect(repoOfRemote("")).toBeUndefined();
  });
});

describe("rescanRepo", () => {
  const app = repos.with({ "src/a.ts": "export function first(x: number) { return x + 1; }\n", "src/b.ts": "export const b = 2;\n" });
  git(app, "remote", "add", "origin", "https://github.com/o/app.git");
  const other = repos.with({ "src/c.ts": "export const c = 3;\n" });
  git(other, "remote", "add", "origin", "https://github.com/o/other.git");
  const db = new Catalog(":memory:");
  afterAll(() => db.close());
  const first = scanRepoInto(db, "app", app, [], "2026-11-08T00:00:00Z");

  it("parses only the new blobs of a new commit, and makes the new snapshot current", () => {
    writeFileSync(join(app, "src/new.ts"), "export function second(y: number) { return y * 2; }\n");
    git(app, "add", "-A");
    git(app, "commit", "-q", "-m", "new");
    const result = rescanRepo(db, "app", app, "2026-11-08T01:00:00Z");
    expect(result).toMatchObject({ repo: "app", before: first.commit, commit: git(app, "rev-parse", "HEAD"), files: 3, parsed: 1, reused: 2, errors: 0 });
    expect(result.commit).not.toBe(first.commit);
  });

  it("refuses a repository that is not in the catalog, and a clone of another repository", () => {
    expect(() => rescanRepo(db, "other", other)).toThrow("The repository other is not in the catalog");
    expect(() => rescanRepo(db, "app", other)).toThrow("is not a clone of app");
  });

  it("is a tool only when the host gives a catalog that it can write", async () => {
    const q = queryOf(db.db);
    const names = (writable: Catalog | undefined, readOnly: boolean): string[] =>
      createMcpHost({ modules: [atlasTools(q, { writable }).module], surface: { namespaces: ["atlas"] }, readOnly, name: "codeatlas", version: "0.1.0" })
        .tools()
        .map((t) => t.name);
    expect(names(undefined, false)).not.toContain("atlas.rescan");
    expect(names(db, true)).not.toContain("atlas.rescan");
    expect(names(db, false)).toContain("atlas.rescan");
    const call = callerOf(atlasTools(q, { writable: db }).module);
    expect(await call(["atlas", "rescan"], { repo: "app", path: app })).toMatchObject({ repo: "app", parsed: 0, reused: 3 });
    const found = (await call(["atlas", "find"], { name: "second" })) as { functions: { repo: string; path: string }[] };
    expect(found.functions).toMatchObject([{ repo: "app", path: "src/new.ts" }]);
  });
});
