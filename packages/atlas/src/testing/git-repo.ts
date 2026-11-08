/**
 * A helper of the tests: git repositories in the temporary folder, each with one commit of the files given.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The repositories of one test file. `removeAll` deletes them. */
export class GitRepos {
  readonly #roots: string[] = [];

  /** This method makes a git repository with the files given, in one commit, and gives its folder. */
  with(files: Readonly<Record<string, string>>): string {
    const root = mkdtempSync(join(tmpdir(), "atlas-repo-"));
    this.#roots.push(root);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const git = (...args: string[]): void => {
      execFileSync("git", ["-C", root, "-c", "user.name=atlas", "-c", "user.email=atlas@example.com", "-c", "core.autocrlf=false", ...args], { stdio: "pipe" });
    };
    git("init", "-q");
    git("add", "-A");
    git("commit", "-q", "-m", "files");
    return root;
  }

  removeAll(): void {
    for (const root of this.#roots.splice(0)) rmSync(root, { recursive: true, force: true });
  }
}
