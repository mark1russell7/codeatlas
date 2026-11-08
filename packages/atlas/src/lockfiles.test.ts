import { afterAll, describe, expect, it } from "vitest";
import { factsOfRepo } from "./blobs.ts";
import { versionDrift } from "./dependencies.ts";
import { bareVersion, lockfileOf, lockfilesOfRepo } from "./lockfiles.ts";
import { queryOf } from "./query.ts";
import { Catalog } from "./store.ts";
import { GitRepos } from "./testing/git-repo.ts";

/** A lockfile of pnpm 12: the document of the tools of pnpm, then the document of the project. */
const lock = (deps: string): string => `---
lockfileVersion: '9.0'

importers:

  .:
    packageManagerDependencies:
      pnpm:
        specifier: 12.10.1
        version: 12.10.1
---
lockfileVersion: '9.0'

importers:

${deps}
`;

const A = lock(`  .:
    devDependencies:
      vitest:
        specifier: ^5.0.3
        version: 5.0.3(@types/node@26.6.6)

  packages/x:
    dependencies:
      a:
        specifier: workspace:*
        version: link:../..
      kysely:
        specifier: ^0.29.8
        version: 0.29.8`);

const B = lock(`  .:
    dependencies:
      kysely:
        specifier: ^0.28.0
        version: 0.28.4
    devDependencies:
      vitest:
        specifier: ^5.0.0
        version: 5.0.3`);

describe("lockfileOf", () => {
  it("reads the importers of each document, and not the tools of pnpm", () => {
    const facts = lockfileOf(A);
    expect(facts.version).toBe("9.0");
    expect(facts.resolved).toEqual([
      { manifest: "package.json", field: "devDependencies", name: "vitest", specifier: "^5.0.3", version: "5.0.3" },
      { manifest: "packages/x/package.json", field: "dependencies", name: "a", specifier: "workspace:*", version: "link:../.." },
      { manifest: "packages/x/package.json", field: "dependencies", name: "kysely", specifier: "^0.29.8", version: "0.29.8" },
    ]);
  });

  it("removes the peer suffix of a version", () => {
    expect(bareVersion("0.2.0(@swc/core@1.16.20)(dependency-cruiser@18.7.0)")).toBe("0.2.0");
    expect(bareVersion("1.0.0")).toBe("1.0.0");
  });
});

describe("the lockfiles of the catalog", () => {
  const repos = new GitRepos();
  afterAll(() => repos.removeAll());
  const roots = {
    a: repos.with({ "pnpm-lock.yaml": A, "src/a.ts": "export const a = 1;\n" }),
    b: repos.with({ "tool/pnpm-lock.yaml": B, "bad/pnpm-lock.yaml": "a: [b\n" }),
  };
  const catalog = new Catalog(":memory:");
  for (const [name, root] of Object.entries(roots)) {
    const result = factsOfRepo(name, root, catalog);
    const snapshot = catalog.putSnapshot(name, "c0", "2026-11-08T00:00:00Z", "test", result.files, result.counts);
    catalog.putLockfiles(snapshot, lockfilesOfRepo(root));
  }
  const q = queryOf(catalog.db);
  afterAll(() => catalog.close());

  it("keeps each lockfile, with the parse error of a broken one", () => {
    const rows = catalog.db.prepare("SELECT repo, path, version, parse_error FROM current_lockfile ORDER BY repo, path").all();
    expect(rows.map((r) => [r["repo"], r["path"], r["version"], r["parse_error"] === null])).toEqual([
      ["a", "pnpm-lock.yaml", "9.0", true],
      ["b", "bad/pnpm-lock.yaml", null, false],
      ["b", "tool/pnpm-lock.yaml", "9.0", true],
    ]);
  });

  it("gives each dependency with two resolved versions, with the paths of the manifests, and no link", async () => {
    const drift = await versionDrift(q);
    expect(drift.map((d) => [d.name, d.repos, d.versions.map((v) => [v.version, v.places.map((p) => `${p.repo}/${p.path}`)])])).toEqual([
      ["kysely", 2, [["0.28.4", ["b/tool/package.json"]], ["0.29.8", ["a/packages/x/package.json"]]]],
    ]);
  });
});
