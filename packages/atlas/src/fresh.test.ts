import { afterAll, describe, expect, it } from "vitest";
import { changedRepos, delayStats, freshMarkdown, headOfLsRemote, indexedHeads, lsRemoteArgs, remoteHeads, staleRepos, type IndexedHead } from "./fresh.ts";
import { queryOf } from "./query.ts";
import { Catalog } from "./store.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

const catalog = new Catalog(":memory:");
afterAll(() => catalog.close());
const counts = { files: 0, parsed: 0, reused: 0, errors: 0, bytesParsed: 0 };

describe("headOfLsRemote", () => {
  it("reads the sha of HEAD, and gives null for no HEAD", () => {
    expect(headOfLsRemote(`${A}\tHEAD\n`)).toBe(A);
    expect(headOfLsRemote(`${B}\trefs/heads/x\n${A}\tHEAD\r\n`)).toBe(A);
    expect(headOfLsRemote("")).toBeNull();
    expect(headOfLsRemote("not-a-sha\tHEAD\n")).toBeNull();
  });

  it("asks only for HEAD, with the URL after --", () => {
    expect(lsRemoteArgs("o", "r")).toEqual(["ls-remote", "--", "https://github.com/o/r.git", "HEAD"]);
  });

  it("gives null for a repository that git cannot read", () => {
    const run = (args: readonly string[]): string => {
      if (args[2]?.includes("/gone.git") === true) throw new Error("not found");
      return `${A}\tHEAD\n`;
    };
    expect(remoteHeads("o", ["r", "gone"], run)).toEqual([
      { repo: "r", head: A },
      { repo: "gone", head: null },
    ]);
  });
});

describe("changedRepos and staleRepos", () => {
  const indexed = new Map<string, IndexedHead>([
    ["same", { repo: "same", commit: A, scannedAt: "2026-11-09T00:00:00Z", indexedAt: "2026-11-09T00:00:00Z" }],
    ["moved", { repo: "moved", commit: A, scannedAt: "2026-11-09T00:00:00Z", indexedAt: "2026-11-09T00:00:00Z" }],
    ["late", { repo: "late", commit: A, scannedAt: "2026-11-09T00:00:00Z", indexedAt: "2026-11-09T00:00:00Z" }],
  ]);
  const heads = [
    { repo: "same", head: A },
    { repo: "moved", head: B },
    { repo: "late", head: C },
    { repo: "new", head: B },
    { repo: "unread", head: null },
  ];

  it("gives the repositories with a new head, and the repositories that are not in the catalog", () => {
    expect(changedRepos(heads, indexed)).toEqual(["late", "moved", "new"]);
  });

  it("fails a head that waits 6 hours or more, and a head with no known time", () => {
    const times: Record<string, string | null> = { moved: "2026-11-09T10:00:00Z", late: "2026-11-09T05:00:00Z", new: null };
    const stale = staleRepos(heads, indexed, "2026-11-09T12:00:00Z", (repo) => times[repo] ?? null);
    expect(stale.map((s) => [s.repo, s.hours, s.fails, s.indexed])).toEqual([
      ["moved", 2, false, A],
      ["late", 7, true, A],
      ["new", null, true, null],
    ]);
    const markdown = freshMarkdown({ at: "x", repos: 5, unread: ["unread"], changed: changedRepos(heads, indexed), stale, delay: { days: 7, commits: 2, median: 1.5, p95: 2.85 } });
    expect(markdown).toContain("5 repositories, 3 with a head that the index does not have, 2 that wait 6 hours or more.");
    expect(markdown).toContain("median 1.5 h, 95th percentile 2.9 h");
    expect(markdown).toContain("| late | `ccccccc` | `aaaaaaa` | 7 h | fails |");
    expect(markdown).toContain("| new | `bbbbbbb` | not in the catalog | not known | fails |");
  });
});

describe("the index time of a commit", () => {
  it("keeps the first scan of a commit when a scan writes the snapshot again, and gives the delay from the commit", async () => {
    catalog.putSnapshot("r", A, "2026-11-09T02:00:00Z", "test", [], counts, "2026-11-09T01:00:00Z");
    catalog.putSnapshot("r", A, "2026-11-09T05:00:00Z", "test", [], counts, "2026-11-09T01:00:00Z");
    catalog.putSnapshot("s", B, "2026-11-09T06:00:00Z", "test", [], counts, "2026-11-09T03:00:00Z");
    // A commit before the window does not count
    catalog.putSnapshot("t", C, "2026-11-09T06:00:00Z", "test", [], counts, "2026-10-01T00:00:00Z");
    const q = queryOf(catalog.db);
    const indexed = await indexedHeads(q);
    expect(indexed.get("r")).toEqual({ repo: "r", commit: A, scannedAt: "2026-11-09T05:00:00Z", indexedAt: "2026-11-09T02:00:00Z" });
    // The delays are 1 and 3 hours
    const delay = await delayStats(q, "2026-11-09T12:00:00Z");
    expect(delay).toMatchObject({ days: 7, commits: 2, median: 2 });
    expect(delay.p95).toBeCloseTo(2.9, 10);
  });
});
