import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { factsOfRepo, type BlobFacts } from "./blobs.ts";
import { Catalog } from "./store.ts";
import { factsSummary } from "./summary.ts";
import { GitRepos } from "./testing/git-repo.ts";

const repos = new GitRepos();
const folders: string[] = [];
afterAll(() => {
  repos.removeAll();
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

const big = (name: string, v: string): string =>
  `export function ${name}(${v}: number[]) { let s = 0; for (const x of ${v}) { if (x > 0) s += x * 2; else s -= x; } return ${v}.length === 0 ? 0 : s / ${v}.length + Math.max(...${v}); }\n`;

const a = repos.with({
  "src/a.ts": `${big("score", "values")}// TODO: one\nimport { join } from "node:path";\nexport const p = join("a", "b")!;\n`,
  "src/a.test.ts": big("score", "values"),
  "src/broken.ts": "function (\n",
});
const b = repos.with({ "src/b.ts": big("rate", "xs"), "lib/same.ts": big("score", "values") });

/** The scan of both repositories into one cache, with each snapshot in the catalog when the cache is one. */
function scan(cache: Map<string, BlobFacts> | Catalog) {
  return [
    ["a", a],
    ["b", b],
  ].map(([name = "", root = ""]) => {
    const result = factsOfRepo(name, root, cache);
    if (cache instanceof Catalog) cache.putSnapshot(name, "c0", "2026-11-08T00:00:00Z", "test", result.files, result.counts);
    return result;
  });
}

describe("Catalog", () => {
  it("gives the summary of factsSummary, from SQL", () => {
    const map = new Map<string, BlobFacts>();
    const scans = scan(map);
    const expected = factsSummary(scans, map, 5);
    const catalog = new Catalog(":memory:");
    const catalogScans = scan(catalog);
    const counts = factsSummary(catalogScans, map, 5);
    const actual = catalog.summary({ parsed: counts.parsed, reused: counts.reused, errors: counts.errors, bytesParsed: counts.bytesParsed, ms: 5 });
    expect(actual).toEqual(expected);
    // The test copy is out of the classes: score in a.ts and in same.ts is one exact class, rate joins at renamed
    expect(actual.classes.exact).toEqual({ classes: 1, members: 2 });
    expect(actual.classes.renamed).toEqual({ classes: 1, members: 3 });
    expect(actual.lawBreaks).toBe(0);
    catalog.close();
  });

  it("keeps the blobs as the cache of the next run, in a file", () => {
    const folder = mkdtempSync(join(tmpdir(), "atlas-db-"));
    folders.push(folder);
    const path = join(folder, "catalog.sqlite");
    const first = new Catalog(path);
    const firstCounts = scan(first).map((result) => result.counts);
    first.close();
    // b has one blob of a: lib/same.ts has the bytes of src/a.test.ts
    expect(firstCounts.map((counts) => [counts.parsed, counts.reused])).toEqual([
      [3, 0],
      [1, 1],
    ]);
    const second = new Catalog(path);
    expect(scan(second).map((result) => result.counts.parsed)).toEqual([0, 0]);
    const rows = second.db.prepare("SELECT count(*) AS n FROM snapshot").get() as { n: number };
    expect(Number(rows.n)).toBe(2);
    const error = second.db.prepare("SELECT count(*) AS n FROM blob WHERE parse_error IS NOT NULL").get() as { n: number };
    expect(Number(error.n)).toBe(1);
    second.close();
  });

  it("answers the queries of the schema: who imports a package, and where a function has copies", () => {
    const catalog = new Catalog(":memory:");
    scan(catalog);
    const importers = catalog.db
      .prepare('SELECT DISTINCT f.repo, f.path FROM current_file f JOIN "import" i ON i.blob = f.blob WHERE i.specifier = ? ORDER BY f.repo, f.path')
      .all("node:path");
    expect(importers).toEqual([{ repo: "a", path: "src/a.ts" }]);
    const copies = catalog.db
      .prepare(
        "SELECT f.repo, f.path, s.qualified_name AS name FROM current_file f JOIN symbol s ON s.blob = f.blob WHERE s.hash_renamed = (SELECT hash_renamed FROM symbol WHERE name = 'rate') AND f.test = 0 ORDER BY f.repo, f.path",
      )
      .all();
    expect(copies).toEqual([
      { repo: "a", path: "src/a.ts", name: "score" },
      { repo: "b", path: "lib/same.ts", name: "score" },
      { repo: "b", path: "src/b.ts", name: "rate" },
    ]);
    const markers = catalog.db.prepare("SELECT m.kind AS kind FROM current_file f JOIN marker m ON m.blob = f.blob ORDER BY m.kind").all();
    expect(markers).toEqual([{ kind: "non-null" }, { kind: "todo" }]);
    catalog.close();
  });

  it("refuses a database of another schema", () => {
    const folder = mkdtempSync(join(tmpdir(), "atlas-db-"));
    folders.push(folder);
    const path = join(folder, "old.sqlite");
    const catalog = new Catalog(path);
    catalog.db.prepare("UPDATE meta SET value = 'codeatlas/0' WHERE key = 'schema'").run();
    catalog.close();
    expect(() => new Catalog(path)).toThrow(/codeatlas\/0/);
  });
});
