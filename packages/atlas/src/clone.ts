/**
 * The repositories that the atlas scans: each public repository of each owner that is not a fork and not archived.
 * The clone has each commit and each tree, but only the blobs of the newest commit. The scan reads the files of the
 * newest commit, and the churn reads the names of the files that each commit changed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { LOGINS, sharedNames } from "./owners.ts";

/** The arguments of `git clone` for a repository with no options: the history with no blobs, for the churn. */
export const CLONE_ARGS: readonly string[] = ["--filter=blob:none"];

/** The arguments of `gh repo list` that give the names of the repositories to scan. */
export function listArgs(owner: string): string[] {
  return ["repo", "list", owner, "--visibility", "public", "--no-archived", "--source", "--limit", "1000", "--json", "name", "--jq", ".[].name"];
}

/**
 * A name of a GitHub owner or repository: letters, digits, `-`, `_` and `.`, and no `-` or `.` at the start. A name
 * that starts with `-` could be read by git as an option, so the clone takes only names that match.
 */
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

export const isSafeName = (name: string): boolean => SAFE_NAME.test(name) && name !== "." && name !== "..";

/** This function gives the names of the `gh repo list` output, sorted. It drops a line that is not a safe name. */
export function repoNames(output: string): string[] {
  return output.split(/\r?\n/).map((line) => line.trim()).filter(isSafeName).sort();
}

/** This function gives the names of the public source repositories of `owner` that are not archived, through the GitHub CLI. */
export function publicNames(owner: string): string[] {
  if (!isSafeName(owner)) throw new Error(`The owner "${owner}" is not a GitHub name.`);
  return repoNames(execFileSync("gh", listArgs(owner), { encoding: "utf8" }));
}

/** A public repository of one owner. */
export interface OwnedRepo {
  readonly owner: string;
  readonly name: string;
}

/**
 * This function reads the owners of the options of a command. The flag `--owners` gives each owner of `LOGINS`.
 * The option `--owner` takes one login or a list with commas. Each login must be a GitHub name. The function gives
 * undefined when the options name no owner.
 */
export function ownersOption(argv: readonly string[]): { readonly owners: readonly string[] } | { readonly error: string } | undefined {
  const all = argv.includes("--owners");
  const at = argv.indexOf("--owner");
  if (all && at !== -1) return { error: "Give --owner or --owners, not the two." };
  if (all) return { owners: LOGINS };
  if (at === -1) return undefined;
  const logins = (argv[at + 1] ?? "")
    .split(",")
    .map((login) => login.trim())
    .filter((login) => login !== "");
  if (logins.length === 0) return { error: "--owner takes a login, or a list of logins with commas." };
  const unsafe = logins.find((login) => !isSafeName(login));
  if (unsafe !== undefined) return { error: `The owner "${unsafe}" is not a GitHub name.` };
  return { owners: [...new Set(logins)] };
}

/**
 * This function gives the public source repositories of each owner of `owners`, sorted by name. The catalog keys each
 * repository by its name. Thus a name that two owners have is an error that names the repository.
 */
export function ownedRepos(owners: readonly string[], list: (owner: string) => readonly string[] = publicNames): OwnedRepo[] {
  const repos = owners.flatMap((owner) => list(owner).map((name) => ({ owner, name })));
  const shared = sharedNames(repos);
  if (shared.length > 0) {
    const places = repos.filter((repo) => shared.includes(repo.name.toLowerCase())).map((repo) => `${repo.owner}/${repo.name}`);
    throw new Error(`More than one owner has a repository with the name ${shared.join(", ")} (${places.join(", ")}). The catalog keys each repository by its name, so the command stops.`);
  }
  return repos.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** This function gives the owner of each repository of `repos` by its name. */
export function ownerMap(repos: readonly OwnedRepo[]): Map<string, string> {
  return new Map(repos.map((repo) => [repo.name, repo.owner]));
}

/** This function gives the URL of `git clone` and `git ls-remote` of a repository. */
export function cloneUrl(repo: OwnedRepo): string {
  return `https://github.com/${repo.owner}/${repo.name}.git`;
}

/**
 * The forms of a GitHub remote: `https://github.com/<owner>/<name>`, `ssh://git@github.com/<owner>/<name>` and
 * `git@github.com:<owner>/<name>`, with or without `.git`.
 */
const GITHUB_REMOTE = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+)\/[^/]+?(?:\.git)?\/*$/;

/** This function gives the owner of the URL of a GitHub remote, or undefined for a URL of another form. */
export function ownerOfRemote(url: string): string | undefined {
  const owner = GITHUB_REMOTE.exec(url.trim())?.[1];
  return owner !== undefined && isSafeName(owner) ? owner : undefined;
}

/** This function gives the URL of the remote `origin` of the checkout at `root`, or undefined. */
export function originOf(root: string): string | undefined {
  try {
    return execFileSync("git", ["-C", root, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

/**
 * This function gives the owner of the checkout at `root` from its remote `origin`, or null. The clone sets the
 * remote, so the owner of a moved repository comes from its clone.
 */
export function ownerOfCheckout(root: string): string | null {
  const origin = originOf(root);
  return (origin === undefined ? undefined : ownerOfRemote(origin)) ?? null;
}

/**
 * This function clones each public repository of each owner of `owners` into `into/<name>`, and gives the names that
 * did not clone. A repository of `options` gets those arguments of `git clone`. Each other repository gets
 * `CLONE_ARGS`. With `only`, the function clones only the repositories of that set.
 */
export function clonePublic(
  owners: readonly string[],
  into: string,
  log: (line: string) => void = console.error,
  options: Readonly<Record<string, readonly string[]>> = {},
  only?: ReadonlySet<string>,
): { cloned: string[]; failed: string[] } {
  const all = ownedRepos(owners);
  const repos = only === undefined ? all : all.filter((repo) => only.has(repo.name));
  const of = owners.join(", ");
  log(only === undefined ? `${repos.length} public repositories of ${of}` : `${repos.length} of ${all.length} public repositories of ${of}`);
  mkdirSync(into, { recursive: true });
  const cloned: string[] = [];
  const failed: string[] = [];
  for (const repo of repos) {
    const target = join(into, repo.name);
    if (existsSync(target)) {
      cloned.push(repo.name);
      continue;
    }
    try {
      // "--" ends the options: git reads the URL and the folder only as arguments
      execFileSync("git", ["clone", "--quiet", ...(options[repo.name] ?? CLONE_ARGS), "--", cloneUrl(repo), target], { stdio: ["ignore", "ignore", "pipe"] });
      cloned.push(repo.name);
    } catch {
      failed.push(repo.name);
      log(`${repo.name} did not clone`);
    }
  }
  return { cloned, failed };
}
