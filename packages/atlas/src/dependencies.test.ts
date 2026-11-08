import { afterAll, describe, expect, it } from "vitest";
import { factsOfRepo } from "./blobs.ts";
import { pinnedDependencies, rangeDrift } from "./dependencies.ts";
import { manifestOf, manifestsOfRepo, rangeKind } from "./manifests.ts";
import { queryOf } from "./query.ts";
import { Catalog } from "./store.ts";
import { GitRepos } from "./testing/git-repo.ts";

const repos = new GitRepos();
afterAll(() => repos.removeAll());

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const roots = {
  a: repos.with({
    "package.json": json({ name: "a", version: "1.0.0", dependencies: { kysely: "^0.29.8", left: "github:o/left#abc" }, devDependencies: { vitest: "^5.0.3" } }),
    "packages/x/package.json": json({ name: "@a/x", private: true, dependencies: { a: "workspace:*", kysely: "^0.28.0" } }),
    "src/a.ts": "export const a = 1;\n",
  }),
  b: repos.with({
    "package.json": json({ name: "b", dependencies: { kysely: "^0.29.8" }, devDependencies: { vitest: "^4.1.0" } }),
    "broken/package.json": "{ not json",
  }),
};
const catalog = new Catalog(":memory:");
for (const [name, root] of Object.entries(roots)) {
  const result = factsOfRepo(name, root, catalog);
  const snapshot = catalog.putSnapshot(name, "c0", "2026-11-08T00:00:00Z", "test", result.files, result.counts);
  catalog.putManifests(snapshot, manifestsOfRepo(root));
}
const q = queryOf(catalog.db);
afterAll(() => catalog.close());

describe("rangeKind", () => {
  it("gives the kind of each form of range", () => {
    const cases: [string, string][] = [
      ["^1.2.3", "semver"],
      [">=1 <2 || 3.x", "semver"],
      ["1.2.3-rc.1", "semver"],
      ["*", "semver"],
      ["latest", "tag"],
      ["workspace:*", "workspace"],
      ["github:o/r#abc", "github"],
      ["o/r#abc", "github"],
      ["git+https://x.org/r.git", "git"],
      ["file:../x", "file"],
      ["link:../x", "link"],
      ["npm:other@^1", "npm"],
      ["https://x.org/r.tgz", "url"],
    ];
    expect(cases.map(([range]) => [range, rangeKind(range)])).toEqual(cases);
  });
});

describe("manifestOf", () => {
  it("gives the package and the dependencies of each field, in name order", () => {
    const facts = manifestOf(json({ name: "p", version: "0.1.0", private: true, peerDependencies: { z: "^1", y: "^2" }, dependencies: { n: 3 } }));
    expect(facts).toEqual({
      name: "p",
      version: "0.1.0",
      private: true,
      dependencies: [
        { field: "peerDependencies", name: "y", range: "^2", kind: "semver" },
        { field: "peerDependencies", name: "z", range: "^1", kind: "semver" },
      ],
    });
  });

  it("throws for a text that is not a JSON object", () => {
    expect(() => manifestOf("[]")).toThrow(TypeError);
  });
});

describe("the dependencies of the catalog", () => {
  it("keeps each manifest of the snapshots, with the parse error of a broken one", () => {
    const rows = catalog.db.prepare("SELECT repo, path, name, private, parse_error FROM current_manifest ORDER BY repo, path").all();
    expect(rows.map((r) => [r["repo"], r["path"], r["name"], r["private"], r["parse_error"] === null])).toEqual([
      ["a", "package.json", "a", 0, true],
      ["a", "packages/x/package.json", "@a/x", 1, true],
      ["b", "broken/package.json", null, 0, false],
      ["b", "package.json", "b", 0, true],
    ]);
  });

  it("gives each dependency with two registry ranges, the most ranges first, and no workspace range", async () => {
    const drift = await rangeDrift(q);
    expect(drift.map((d) => [d.name, d.repos, d.ranges.map((r) => [r.range, r.places.map((p) => `${p.repo}/${p.path}`)])])).toEqual([
      ["kysely", 2, [["^0.28.0", ["a/packages/x/package.json"]], ["^0.29.8", ["a/package.json", "b/package.json"]]]],
      ["vitest", 2, [["^4.1.0", ["b/package.json"]], ["^5.0.3", ["a/package.json"]]]],
    ]);
  });

  it("gives each dependency that the registry does not resolve", async () => {
    expect(await pinnedDependencies(q)).toEqual([{ repo: "a", path: "package.json", field: "dependencies", name: "left", range: "github:o/left#abc", kind: "github", private: false }]);
  });
});
