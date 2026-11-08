/**
 * The corpus: the size of each repository that the atlas reads, as files, lines and bytes of each kind.
 * It is the base of each cost estimate: the scan time and the tokens per 1000 lines multiply these counts.
 */
import { readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { GENERATED, MAX_BYTES, SKIP, SOURCE, TEST, gitFiles, headOf } from "./scan.ts";

/**
 * The kind of a file. The atlas scans the kinds `source` and `test`. The other kinds tell where the rest of
 * the bytes are.
 */
export type FileKind =
  | "source"
  | "test"
  | "declaration"
  | "generated"
  | "bundle"
  | "skipped-path"
  | "lockfile"
  | "json"
  | "markdown"
  | "yaml"
  | "style"
  | "html"
  | "cue"
  | "shell"
  | "binary"
  | "other";

/** The order of the kinds in a report. */
export const FILE_KINDS: readonly FileKind[] = [
  "source",
  "test",
  "declaration",
  "generated",
  "bundle",
  "skipped-path",
  "lockfile",
  "json",
  "markdown",
  "yaml",
  "style",
  "html",
  "cue",
  "shell",
  "binary",
  "other",
];

const LOCKFILES: ReadonlySet<string> = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb", "Cargo.lock", "go.sum"]);
const BINARY = /\.(?:png|jpe?g|gif|webp|avif|ico|bmp|svgz|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|br|wasm|node|exe|dll|so|dylib|mp3|mp4|webm|wav|ogg|sqlite|db)$/i;
const BY_EXTENSION: readonly (readonly [RegExp, FileKind])[] = [
  [/\.json[c5]?$/i, "json"],
  [/\.mdx?$/i, "markdown"],
  [/\.ya?ml$/i, "yaml"],
  [/\.(?:css|scss|sass|less)$/i, "style"],
  [/\.html?$/i, "html"],
  [/\.cue$/i, "cue"],
  [/\.(?:sh|bash|ps1|psm1|cmd|bat)$/i, "shell"],
];

/**
 * This function gives the kind of a file from its path and its size in bytes. The rules for `source` and `test`
 * are the rules of the scan (`isSource`), so the corpus counts the lines that the scan reads.
 */
export function kindOf(file: string, bytes: number): FileKind {
  if (LOCKFILES.has(basename(file))) return "lockfile";
  if (BINARY.test(file)) return "binary";
  if (SKIP.test(file)) return "skipped-path";
  if (SOURCE.test(file)) {
    if (file.endsWith(".d.ts") || /\.d\.[cm]ts$/.test(file)) return "declaration";
    if (GENERATED.test(file) || /\.min\.[cm]?js$/.test(file)) return "generated";
    if (bytes > MAX_BYTES) return "bundle";
    return TEST.test(file) ? "test" : "source";
  }
  for (const [pattern, kind] of BY_EXTENSION) if (pattern.test(file)) return kind;
  return "other";
}

/** The counts of one kind of file. A binary file has no lines. */
export interface KindCount {
  readonly files: number;
  readonly lines: number;
  /** The lines with a character that is not a space. */
  readonly nonBlank: number;
  readonly bytes: number;
}

/** The corpus of one repository. */
export interface RepoCorpus {
  readonly repo: string;
  readonly commit: string | null;
  readonly files: number;
  readonly bytes: number;
  /** The counts of each kind that has one file or more. */
  readonly kinds: Readonly<Partial<Record<FileKind, KindCount>>>;
}

/** The corpus of all repositories. */
export interface Corpus {
  readonly schema: "codeatlas-corpus/1";
  readonly repos: readonly RepoCorpus[];
  readonly totals: {
    readonly repos: number;
    readonly files: number;
    readonly bytes: number;
    readonly kinds: Readonly<Partial<Record<FileKind, KindCount>>>;
  };
}

/** This function counts the lines and the lines that are not blank of a text. */
export function lineCounts(text: string): { readonly lines: number; readonly nonBlank: number } {
  if (text === "") return { lines: 0, nonBlank: 0 };
  let lines = 0;
  let nonBlank = 0;
  let filled = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10) {
      lines++;
      if (filled) nonBlank++;
      filled = false;
    } else if (code !== 32 && code !== 9 && code !== 13) filled = true;
  }
  // A last line with no newline is a line too
  if (text.charCodeAt(text.length - 1) !== 10) {
    lines++;
    if (filled) nonBlank++;
  }
  return { lines, nonBlank };
}

const EMPTY: KindCount = { files: 0, lines: 0, nonBlank: 0, bytes: 0 };

function add(a: KindCount, b: KindCount): KindCount {
  return { files: a.files + b.files, lines: a.lines + b.lines, nonBlank: a.nonBlank + b.nonBlank, bytes: a.bytes + b.bytes };
}

function sortedKinds(kinds: Partial<Record<FileKind, KindCount>>): Partial<Record<FileKind, KindCount>> {
  const out: Partial<Record<FileKind, KindCount>> = {};
  for (const kind of FILE_KINDS) {
    const count = kinds[kind];
    if (count !== undefined) out[kind] = count;
  }
  return out;
}

/** One file to count: its path in the repository, and a function that reads its bytes. */
export interface CorpusFile {
  readonly file: string;
  readonly bytes: number;
  readonly read: () => Buffer;
}

/** This function counts the files of one repository. A text file of 8 MB or more counts its bytes, but no lines. */
export function countRepo(repo: string, commit: string | null, files: Iterable<CorpusFile>): RepoCorpus {
  const kinds: Partial<Record<FileKind, KindCount>> = {};
  let count = 0;
  let total = 0;
  for (const entry of files) {
    const kind = kindOf(entry.file, entry.bytes);
    let lines = 0;
    let nonBlank = 0;
    if (kind !== "binary" && entry.bytes < 8_000_000) {
      const buffer = entry.read();
      // A NUL byte in the first 8 KB marks a binary file with an extension that the list does not know
      if (!buffer.subarray(0, 8192).includes(0)) ({ lines, nonBlank } = lineCounts(buffer.toString("utf8")));
    }
    kinds[kind] = add(kinds[kind] ?? EMPTY, { files: 1, lines, nonBlank, bytes: entry.bytes });
    count++;
    total += entry.bytes;
  }
  return { repo, commit, files: count, bytes: total, kinds: sortedKinds(kinds) };
}

/** This function counts each file that git keeps in `root`. */
export function corpusOfRepo(repo: string, root: string, files: readonly string[] = gitFiles(root)): RepoCorpus {
  const entries: CorpusFile[] = [];
  for (const file of files) {
    const path = join(root, file);
    let bytes: number;
    try {
      const stat = statSync(path);
      // A submodule or a link to a folder is not a file of this repository
      if (!stat.isFile()) continue;
      bytes = stat.size;
    } catch {
      continue;
    }
    entries.push({ file, bytes, read: () => readFileSync(path) });
  }
  return countRepo(repo, headOf(root), entries);
}

/** This function adds the corpus of each repository into one corpus, sorted by the name of the repository. */
export function buildCorpus(repos: readonly RepoCorpus[]): Corpus {
  const sorted = [...repos].sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0));
  const kinds: Partial<Record<FileKind, KindCount>> = {};
  for (const repo of sorted) for (const kind of FILE_KINDS) {
    const count = repo.kinds[kind];
    if (count !== undefined) kinds[kind] = add(kinds[kind] ?? EMPTY, count);
  }
  return {
    schema: "codeatlas-corpus/1",
    repos: sorted,
    totals: {
      repos: sorted.length,
      files: sorted.reduce((sum, repo) => sum + repo.files, 0),
      bytes: sorted.reduce((sum, repo) => sum + repo.bytes, 0),
      kinds: sortedKinds(kinds),
    },
  };
}

const scanned = (kinds: RepoCorpus["kinds"]): KindCount => add(kinds.source ?? EMPTY, kinds.test ?? EMPTY);

/** The corpus as Markdown, for the summary of a CI run. */
export function corpusMarkdown(corpus: Corpus): string {
  const { totals } = corpus;
  const all = scanned(totals.kinds);
  const megabytes = (bytes: number): string => (bytes / 1_000_000).toFixed(1);
  const lines: string[] = [
    "# Corpus",
    "",
    `${totals.repos} repositories, ${totals.files} files, ${megabytes(totals.bytes)} MB.`,
    `The scan reads ${all.files} files: ${all.lines} lines, ${all.nonBlank} of them not blank (source ${totals.kinds.source?.lines ?? 0}, test ${totals.kinds.test?.lines ?? 0}).`,
    "",
    "## Kinds",
    "",
    "| Kind | Files | Lines | Not blank | MB |",
    "|---|---:|---:|---:|---:|",
    ...FILE_KINDS.flatMap((kind) => {
      const count = totals.kinds[kind];
      return count === undefined ? [] : [`| ${kind} | ${count.files} | ${count.lines} | ${count.nonBlank} | ${megabytes(count.bytes)} |`];
    }),
    "",
    "## Repositories",
    "",
    "| Repository | Files | Source lines | Test lines | Other text lines | MB |",
    "|---|---:|---:|---:|---:|---:|",
    ...[...corpus.repos]
      .sort((a, b) => scanned(b.kinds).lines - scanned(a.kinds).lines)
      .map((repo) => {
        const text = FILE_KINDS.filter((kind) => kind !== "source" && kind !== "test").reduce((sum, kind) => sum + (repo.kinds[kind]?.lines ?? 0), 0);
        return `| ${repo.repo} | ${repo.files} | ${repo.kinds.source?.lines ?? 0} | ${repo.kinds.test?.lines ?? 0} | ${text} | ${megabytes(repo.bytes)} |`;
      }),
    "",
  ];
  return lines.join("\n");
}
