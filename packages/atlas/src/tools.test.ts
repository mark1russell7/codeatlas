import { callerOf } from "@procedures/client";
import { createMcpHost } from "@procedures/mcp-server";
import { afterAll, describe, expect, it } from "vitest";
import { factsOfRepo } from "./blobs.ts";
import { queryOf } from "./query.ts";
import { Catalog, readOnlyCatalog } from "./store.ts";
import { GitRepos } from "./testing/git-repo.ts";
import { atlasTools, type FoundFunction } from "./tools.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repos = new GitRepos();
afterAll(() => repos.removeAll());

/** A function with the name `name` and the parameter `v`. */
const fn = (name: string, v: string): string =>
  `export function ${name}(${v}: number[]) { const s = [...${v}].sort((x, y) => x - y); return s.length === 0 ? 0 : s[Math.floor(s.length / 2)]; }\n`;

const roots = {
  app: repos.with({ "src/stats.ts": `${fn("median", "values")}${fn("medianOf", "xs")}`, "src/stats.test.ts": fn("median", "values"), "src/db.ts": 'import { DatabaseSync } from "node:sqlite";\nexport const d = DatabaseSync;\n' }),
  tool: repos.with({ "src/m.ts": fn("median", "list") }),
};
const folder = mkdtempSync(join(tmpdir(), "codeatlas-tools-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));
const file = join(folder, "catalog.sqlite");
const writer = new Catalog(file);
for (const [name, root] of Object.entries(roots)) {
  const result = factsOfRepo(name, root, writer);
  writer.putSnapshot(name, "c0", "2026-11-08T00:00:00Z", "test", result.files, result.counts);
}
writer.close();
const db = readOnlyCatalog(file);
afterAll(() => db.close());
const tools = atlasTools(queryOf(db));
const call = callerOf(tools.module);

describe("the tools of agents", () => {
  it("gives the repositories of the catalog", async () => {
    expect(await call(["atlas", "repos"], {})).toEqual({
      repos: [
        { repo: "app", commit: "c0", scannedAt: "2026-11-08T00:00:00Z", files: 3 },
        { repo: "tool", commit: "c0", scannedAt: "2026-11-08T00:00:00Z", files: 1 },
      ],
    });
  });

  it("finds a function by name, with its copies outside tests and the home of its name", async () => {
    // A test copy is not a copy of the others. The copies of the test copy itself are the 3 functions outside tests
    const { functions } = await call<{ functions: FoundFunction[] }>(["atlas", "find"], { name: "median" });
    expect(functions.map((f) => [f.repo, f.path, f.test, f.copies, f.home?.area])).toEqual([
      ["app", "src/stats.test.ts", true, { exact: 1, renamed: 3, shape: 3 }, "statistics"],
      ["app", "src/stats.ts", false, { exact: 0, renamed: 2, shape: 2 }, "statistics"],
      ["tool", "src/m.ts", false, { exact: 0, renamed: 2, shape: 2 }, "statistics"],
    ]);
    const prefix = await call<{ functions: FoundFunction[] }>(["atlas", "find"], { name: "medianO", match: "prefix" });
    expect(prefix.functions.map((f) => f.name)).toEqual(["medianOf"]);
    const contains = await call<{ functions: FoundFunction[] }>(["atlas", "find"], { name: "dian", match: "contains", repo: "tool" });
    expect(contains.functions.map((f) => `${f.repo}:${f.name}`)).toEqual(["tool:median"]);
  });

  it("gives the copies of one function, and the importers of a specifier", async () => {
    expect(await call(["atlas", "copies"], { repo: "tool", path: "src/m.ts", name: "median" })).toEqual({
      // medianOf is the same code with other names, so it is a copy at the level renamed
      copies: [
        { repo: "app", path: "src/stats.ts", name: "median", line: 1 },
        { repo: "app", path: "src/stats.ts", name: "medianOf", line: 2 },
      ],
    });
    expect(await call(["atlas", "importers"], { specifier: "node:sqlite" })).toMatchObject({ importers: [{ repo: "app", path: "src/db.ts", line: 1 }] });
  });

  it("gives the copies of each home with a limit", async () => {
    const { homes } = await call<{ homes: { area: string; copies: unknown[]; more: number }[] }>(["atlas", "homes"], { area: "statistics", limit: 1 });
    expect(homes.map((h) => [h.area, h.copies.length, h.more])).toEqual([["statistics", 1, 2]]);
  });

  it("refuses a bad input", async () => {
    await expect(call(["atlas", "find"], { name: "" })).rejects.toThrow();
  });

  it("serves each tool over MCP, and each one changes nothing", () => {
    const host = createMcpHost({ modules: [tools.module], surface: { namespaces: ["atlas"] }, readOnly: true, name: "codeatlas", version: "0.1.0" });
    expect(host.tools().map((t) => t.name).sort()).toEqual(["atlas.copies", "atlas.find", "atlas.homes", "atlas.importers", "atlas.repos"]);
  });

  it("opens the catalog to read only", () => {
    expect(() => db.exec("DELETE FROM snapshot")).toThrow();
    expect(() => readOnlyCatalog(join(folder, "none.sqlite"))).toThrow();
  });
});
