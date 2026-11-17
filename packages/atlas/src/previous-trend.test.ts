import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { artifactArgs, lastRunArgs, previousTrend, trendUrls, type FetchReply, type PreviousTrendIo, type PreviousTrendOptions } from "./previous-trend.ts";

const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** The options of a read in a new empty folder. The repository moved to the organization. */
function options(): PreviousTrendOptions {
  const dir = mkdtempSync(join(tmpdir(), "atlas-previous-"));
  folders.push(dir);
  return { owners: ["mark1russell7", "metrograph-labs"], current: "metrograph-labs", repo: "codeatlas", repository: "metrograph-labs/codeatlas", workflow: "pages.yml", dir };
}

const reply = (status: number, text = ""): FetchReply => ({ status, text: async () => text });

/** The fake access. `sites` gives the reply of each URL, `runs` the output of `gh run list`, and `trend` the trend of the artifact. */
function fakeIo(sites: Record<string, FetchReply | Error>, runs: string, trend?: string): PreviousTrendIo & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(url);
      const answer = sites[url] ?? reply(404);
      if (answer instanceof Error) throw answer;
      return answer;
    },
    gh: (args) => {
      calls.push(`gh ${args.slice(0, 2).join(" ")}`);
      if (args[1] === "list") return runs;
      // The download writes the tar file of the artifact into the folder of -D
      writeFileSync(join(args[args.indexOf("-D") + 1] ?? "", "artifact.tar"), "tar");
      return "";
    },
    untar: (_tar, dir) => {
      calls.push("untar");
      if (trend === undefined) return;
      mkdirSync(join(dir, "data"), { recursive: true });
      writeFileSync(join(dir, "data", "trend.json"), trend);
    },
  };
}

const NEW = "https://metrograph-labs.github.io/codeatlas/data/trend.json";
const OLD = "https://mark1russell7.github.io/codeatlas/data/trend.json";

describe("previousTrend", () => {
  it("reads the site of the current owner first, then the site of each other owner", () => {
    expect(trendUrls(["mark1russell7", "metrograph-labs"], "metrograph-labs", "codeatlas")).toEqual([NEW, OLD]);
    expect(trendUrls(["mark1russell7", "metrograph-labs"], "Mark1russell7", "codeatlas")).toEqual([OLD, NEW]);
    expect(lastRunArgs("o/r", "pages.yml")).toEqual(["run", "list", "-R", "o/r", "--workflow", "pages.yml", "--branch", "main", "--status", "success", "--limit", "20", "--json", "databaseId,event"]);
    expect(artifactArgs("o/r", 7, "d")).toEqual(["run", "download", "7", "-R", "o/r", "-n", "github-pages", "-D", "d"]);
  });

  it("takes the first site that gives 200", async () => {
    const io = fakeIo({ [NEW]: reply(200, "new") }, "[]");
    expect(await previousTrend(options(), io)).toEqual({ kind: "found", source: NEW, text: "new" });
    expect(io.calls).toEqual([NEW]);
  });

  it("goes to the next site after a 404, so the first build after a move reads the old site", async () => {
    const io = fakeIo({ [OLD]: reply(200, "old") }, "[]");
    expect(await previousTrend(options(), io)).toEqual({ kind: "found", source: OLD, text: "old" });
    expect(io.calls).toEqual([NEW, OLD]);
  });

  it("reads the Pages artifact of the last deploy when each site gives 404", async () => {
    const io = fakeIo({}, '[{"databaseId":43,"event":"pull_request"},{"databaseId":42,"event":"push"}]', "artifact");
    expect(await previousTrend(options(), io)).toEqual({ kind: "found", source: "the artifact github-pages of the run 42", text: "artifact" });
    expect(io.calls).toEqual([NEW, OLD, "gh run list", "gh run download", "untar"]);
  });

  it("gives a first deploy only when the repository has no successful run of the workflow", async () => {
    const io = fakeIo({}, "[]");
    expect(await previousTrend(options(), io)).toEqual({ kind: "first", tried: [NEW, OLD] });
    // A pull request from the branch main of a fork is not a deploy
    const fork = fakeIo({}, '[{"databaseId":43,"event":"pull_request"}]');
    expect(await previousTrend(options(), fork)).toEqual({ kind: "first", tried: [NEW, OLD] });
  });

  it("fails when a deploy exists but no source has its trend, so the build does not lose the history", async () => {
    const result = await previousTrend(options(), fakeIo({}, '[{"databaseId":43,"event":"pull_request"},{"databaseId":42,"event":"push"}]'));
    expect(result).toEqual({ kind: "error", error: "The artifact github-pages of the run 42 has no data/trend.json." });
    const expired = fakeIo({}, '[{"databaseId":43,"event":"pull_request"},{"databaseId":42,"event":"push"}]');
    const failing: PreviousTrendIo = {
      ...expired,
      gh: (args) => {
        if (args[1] === "list") return '[{"databaseId":43,"event":"pull_request"},{"databaseId":42,"event":"push"}]';
        // The tool gives its reason on its error output, not in the message
        throw Object.assign(new Error("Command failed: gh run download 42"), { stderr: "\nno valid artifacts found to download\nmore" });
      },
    };
    expect(await previousTrend(options(), failing)).toMatchObject({ kind: "error", error: expect.stringContaining("did not download: no valid artifacts found to download") });
  });

  it("fails on each other status and on a fetch that throws, and reads no more sources", async () => {
    const io = fakeIo({ [NEW]: reply(500), [OLD]: reply(200, "old") }, "[]");
    expect(await previousTrend(options(), io)).toEqual({ kind: "error", error: `The trend at ${NEW} gave HTTP 500.` });
    expect(io.calls).toEqual([NEW]);
    const down = fakeIo({ [NEW]: new Error("The operation was aborted due to timeout") }, "[]");
    expect(await previousTrend(options(), down)).toEqual({ kind: "error", error: `The trend at ${NEW} did not load: The operation was aborted due to timeout` });
    const broken = fakeIo({}, "not json");
    expect(await previousTrend(options(), broken)).toMatchObject({ kind: "error", error: expect.stringContaining("The runs of pages.yml did not read") });
  });
});
