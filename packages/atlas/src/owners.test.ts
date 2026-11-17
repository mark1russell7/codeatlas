import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOGINS, OWNERS, sharedNames } from "./owners.ts";

describe("owners", () => {
  it("gives the personal account first, then the organization", () => {
    expect(LOGINS).toEqual(["mark1russell7", "metrograph-labs"]);
    expect(OWNERS.map((owner) => owner.kind)).toEqual(["user", "organization"]);
  });

  it("gives each name that more than one owner has, with no regard to case", () => {
    const repos = [
      { owner: "a", name: "codeatlas" },
      { owner: "B", name: "CodeAtlas" },
      { owner: "a", name: "vex" },
      { owner: "A", name: "Vex" },
    ];
    // Two owners have codeatlas. One owner has vex, in two cases of its login
    expect(sharedNames(repos)).toEqual(["codeatlas"]);
    expect(sharedNames(repos.slice(1))).toEqual([]);
  });

  // The copy of the list ends when the installed conventions exports the subpath ./owners. The test reads the export,
  // not a version number, so the end does not depend on the version that the release takes.
  it("keeps its copy of the list only while the installed conventions has no subpath ./owners", () => {
    // A missing file is a broken install: the read throws, and the test fails. It does not pass with no read
    const file = join(import.meta.dirname, "..", "..", "..", "node_modules", "@mark1russell7", "conventions", "package.json");
    const installed = JSON.parse(readFileSync(file, "utf8")) as { version?: string; exports?: Record<string, unknown> };
    const copy = readFileSync(join(import.meta.dirname, "owners.ts"), "utf8").includes("export const OWNERS: readonly Owner[] = [");
    // A change of the line of the copy must not let the test pass with no read
    expect(copy, "owners.ts has no marker of the copy. Remove this test with the copy, or change the marker with the line").toBe(true);
    expect(
      copy && installed.exports?.["./owners"] !== undefined,
      `conventions ${installed.version ?? "?"} has the subpath ./owners: import OWNERS from @mark1russell7/conventions/owners and remove the copy`,
    ).toBe(false);
  });
});
