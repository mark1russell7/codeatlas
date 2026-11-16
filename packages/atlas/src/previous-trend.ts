/**
 * The trend file of the last deploy, for the next build. A build reads the Pages site of each owner first. GitHub does
 * not redirect a Pages site after a move of the repository, so the site of the old owner then gives 404. The first
 * build of the new owner also gives 404. Thus the next source is the Pages artifact of the last deploy: the artifacts
 * move with the repository. Only a repository with no deploy starts a new history.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** The path of the trend file in the site. */
export const TREND_PATH: string = "data/trend.json";

/** The name of the Pages artifact of a deploy. */
export const PAGES_ARTIFACT: string = "github-pages";

/** The exit code of the command `previous-trend` when no source has a trend and the repository has no deploy. */
export const FIRST_DEPLOY_EXIT: number = 3;

/** The reply of a fetch: only the parts that the reader uses. */
export interface FetchReply {
  readonly status: number;
  text(): Promise<string>;
}

/** The access to the network and to the tools. The default uses the global fetch, the GitHub CLI and tar. The tests give fakes. */
export interface PreviousTrendIo {
  /** This function fetches a URL. */
  readonly fetch: (url: string) => Promise<FetchReply>;
  /** This function starts the GitHub CLI with the arguments, and gives its output. */
  readonly gh: (args: readonly string[]) => string;
  /** This function writes the files of the tar file `tar` into the folder `dir`. */
  readonly untar: (tar: string, dir: string) => void;
}

/** The sources of the trend. */
export interface PreviousTrendOptions {
  /** The logins of the owners. */
  readonly owners: readonly string[];
  /** The owner of the repository at this time. Its site comes first. */
  readonly current: string;
  /** The name of the repository: the path of its Pages site. */
  readonly repo: string;
  /** The repository as `owner/name`, for the runs and the artifacts. */
  readonly repository: string;
  /** The workflow file of the deploy. */
  readonly workflow: string;
  /** An empty folder for the artifact. */
  readonly dir: string;
}

/** The result: a trend and its source, a first deploy, or an error that stops the build. */
export type PreviousTrend =
  | { readonly kind: "found"; readonly source: string; readonly text: string }
  | { readonly kind: "first"; readonly tried: readonly string[] }
  | { readonly kind: "error"; readonly error: string };

/** This function gives the URL of the trend of the Pages site of each owner: the current owner first, then the others in order. */
export function trendUrls(owners: readonly string[], current: string, repo: string): string[] {
  const others = owners.filter((owner) => owner.toLowerCase() !== current.toLowerCase());
  return [current, ...others].map((owner) => `https://${owner.toLowerCase()}.github.io/${repo}/${TREND_PATH}`);
}

/**
 * The arguments of `gh run list` that give the newest successful deploys of the workflow on `main`. The list also has
 * each pull request from the branch `main` of a fork, so the reader skips the pull requests.
 */
export function lastRunArgs(repository: string, workflow: string): string[] {
  return ["run", "list", "-R", repository, "--workflow", workflow, "--branch", "main", "--status", "success", "--limit", "20", "--json", "databaseId,event"];
}

/** The arguments of `gh run download` that write the Pages artifact of the run `runId` into `dir`. */
export function artifactArgs(repository: string, runId: number, dir: string): string[] {
  return ["run", "download", String(runId), "-R", repository, "-n", PAGES_ARTIFACT, "-D", dir];
}

/** This function gives the first line of the reason of an error: the error output of a tool, else the message. */
function firstLine(error: unknown): string {
  const stderr = (error as { stderr?: unknown } | null)?.stderr;
  const output = typeof stderr === "string" ? stderr : Buffer.isBuffer(stderr) ? stderr.toString("utf8") : "";
  const text = output.trim() !== "" ? output : String(error instanceof Error ? error.message : error);
  return text.trim().split(/\r?\n/)[0] ?? "";
}

/**
 * This function reads the trend of the last deploy. It reads the site of each owner, and the first 200 wins. A 404
 * goes to the next site. Each other status and each failed fetch is an error.
 *
 * After a 404 of each site, it reads the Pages artifact of the newest successful deploy of the workflow on `main`.
 * With no such deploy, the result is a first deploy. A deploy whose artifact has no trend is an error, so a build does
 * not lose the history.
 */
export async function previousTrend(options: PreviousTrendOptions, io: PreviousTrendIo): Promise<PreviousTrend> {
  const urls = trendUrls(options.owners, options.current, options.repo);
  for (const url of urls) {
    let reply: FetchReply;
    try {
      reply = await io.fetch(url);
    } catch (error) {
      return { kind: "error", error: `The trend at ${url} did not load: ${firstLine(error)}` };
    }
    if (reply.status === 200) return { kind: "found", source: url, text: await reply.text() };
    if (reply.status !== 404) return { kind: "error", error: `The trend at ${url} gave HTTP ${reply.status}.` };
  }
  let runs: unknown;
  try {
    runs = JSON.parse(io.gh(lastRunArgs(options.repository, options.workflow)));
  } catch (error) {
    return { kind: "error", error: `The runs of ${options.workflow} did not read: ${firstLine(error)}` };
  }
  if (!Array.isArray(runs)) return { kind: "error", error: `The run list of ${options.workflow} is not a list.` };
  const deploys = (runs as ({ databaseId?: unknown; event?: unknown } | null)[]).filter((run) => run?.event !== "pull_request");
  if (deploys.length === 0) return { kind: "first", tried: urls };
  const runId = deploys[0]?.databaseId;
  if (typeof runId !== "number") return { kind: "error", error: `The run list of ${options.workflow} has no run id.` };
  const source = `the artifact ${PAGES_ARTIFACT} of the run ${runId}`;
  const named = `The artifact ${PAGES_ARTIFACT} of the run ${runId}`;
  try {
    io.gh(artifactArgs(options.repository, runId, options.dir));
  } catch (error) {
    return { kind: "error", error: `The run ${runId} of ${options.workflow} has a deploy, but ${source} did not download: ${firstLine(error)}` };
  }
  const tar = join(options.dir, "artifact.tar");
  if (!existsSync(tar)) return { kind: "error", error: `${named} has no artifact.tar.` };
  const site = join(options.dir, "site");
  mkdirSync(site, { recursive: true });
  try {
    io.untar(tar, site);
  } catch (error) {
    return { kind: "error", error: `The tar file of ${source} did not read: ${firstLine(error)}` };
  }
  const file = join(site, TREND_PATH);
  if (!existsSync(file)) return { kind: "error", error: `${named} has no ${TREND_PATH}.` };
  return { kind: "found", source, text: readFileSync(file, "utf8") };
}

/**
 * The default access: the global fetch with a time limit of 60 s, the GitHub CLI and tar. The tar file goes to tar as
 * a relative path from `dir`. GNU tar reads a path with a colon, as `D:\x`, as a path on a remote host.
 */
export const DEFAULT_IO: PreviousTrendIo = {
  fetch: (url) => fetch(url, { signal: AbortSignal.timeout(60_000) }),
  gh: (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
  untar: (tar, dir) => {
    execFileSync("tar", ["-xf", relative(dir, tar).split(sep).join("/")], { cwd: dir, stdio: ["ignore", "ignore", "pipe"] });
  },
};
