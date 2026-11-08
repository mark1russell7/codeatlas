/**
 * The repositories that the atlas scans: each public repository of an owner that is not a fork and
 * not archived, as a shallow clone. The scan reads only the newest commit.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

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

/**
 * This function clones each repository into `into/<name>`, and gives the names that did not clone. A repository
 * of `options` gets those arguments of `git clone`. Each other repository gets `--depth 1`.
 */
export function clonePublic(
  owner: string,
  into: string,
  log: (line: string) => void = console.error,
  options: Readonly<Record<string, readonly string[]>> = {},
): { cloned: string[]; failed: string[] } {
  if (!isSafeName(owner)) throw new Error(`The owner "${owner}" is not a GitHub name.`);
  const names = repoNames(execFileSync("gh", listArgs(owner), { encoding: "utf8" }));
  log(`${names.length} public repositories of ${owner}`);
  mkdirSync(into, { recursive: true });
  const cloned: string[] = [];
  const failed: string[] = [];
  for (const name of names) {
    const target = join(into, name);
    if (existsSync(target)) {
      cloned.push(name);
      continue;
    }
    try {
      // "--" ends the options: git reads the URL and the folder only as arguments
      execFileSync("git", ["clone", "--quiet", ...(options[name] ?? ["--depth", "1"]), "--", `https://github.com/${owner}/${name}.git`, target], { stdio: ["ignore", "ignore", "pipe"] });
      cloned.push(name);
    } catch {
      failed.push(name);
      log(`${name} did not clone`);
    }
  }
  return { cloned, failed };
}
