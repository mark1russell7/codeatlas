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
});
