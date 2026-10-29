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

export function repoNames(output: string): string[] {
  return output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "").sort();
}

/** This function clones each repository into `into/<name>`, and gives the names that did not clone. */
export function clonePublic(owner: string, into: string, log: (line: string) => void = console.error): { cloned: string[]; failed: string[] } {
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
      execFileSync("git", ["clone", "--quiet", "--depth", "1", `https://github.com/${owner}/${name}.git`, target], { stdio: ["ignore", "ignore", "pipe"] });
      cloned.push(name);
    } catch {
      failed.push(name);
      log(`${name} did not clone`);
    }
  }
  return { cloned, failed };
}
