/**
 * The atlas: the scans of all repositories, joined. A clone class is a set of two or more functions
 * with one shape. The duplicated nodes of a class are its size times its members minus one: the code
 * that one shared function removes. The output is sorted, so one input gives one byte sequence.
 */
import type { RepoScan, Unit } from "./scan.ts";

/** The areas of direction 16: the shared rigor libraries that the atlas finds candidates for. */
export const TOPICS: Readonly<Record<string, readonly string[]>> = {
  generators: ["random", "rng", "prng", "seed", "seeded", "mulberry", "xorshift", "splitmix", "shuffle", "latin", "hypercube", "saltelli", "sobol", "halton", "fixture", "fixtures", "arbitrary", "shrink", "sample", "sampler"],
  statistics: ["resample", "resampling", "wilson", "holm", "bonferroni", "brier", "quantile", "percentile", "median", "stddev", "variance", "mean", "confidence", "interval", "regression", "histogram", "ci", "pvalue", "significance", "welch", "ttest", "mann", "whitney", "spearman", "pearson", "correlation"],
  gates: ["gate", "gates", "determinism", "deterministic", "baseline", "promote", "promotion", "budget", "regression", "ratchet", "threshold"],
  testgen: ["property", "fastcheck", "pairwise", "covering", "metamorphic", "combinations", "combinatorial", "permutations", "permute", "cartesian", "matrix", "cases", "generate"],
  "chaos-load": ["chaos", "fault", "faults", "inject", "injection", "latency", "jitter", "retry", "backoff", "load", "throughput", "soak", "stress", "rate", "limiter", "timeout"],
  measure: ["measure", "measures", "timer", "stopwatch", "benchmark", "bench", "perf", "profile", "elapsed", "hrtime"],
};

/** Packages by purpose: two repos that take two packages for one purpose are a planned duplication. */
export const PURPOSES: Readonly<Record<string, readonly string[]>> = {
  "seeded random": ["seedrandom", "pure-rand", "random-seed", "prando", "rand-seed", "@faker-js/faker", "chance"],
  "property tests": ["fast-check", "jsverify", "testcheck"],
  statistics: ["simple-statistics", "jstat", "mathjs", "d3-array", "stdlib", "@stdlib/stats"],
  "load tests": ["autocannon", "k6", "artillery", "loadtest", "tinybench", "mitata", "benchmark"],
  schemas: ["zod", "valibot", "ajv", "@sinclair/typebox", "yup", "joi", "arktype"],
  "test runners": ["vitest", "jest", "mocha", "ava", "uvu"],
  logging: ["pino", "winston", "bunyan", "debug", "consola"],
};

/** The words of a name or a path: camelCase, snake_case, kebab-case and path parts, in lower case. */
export function wordsOf(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
}

/** The topics of a set of names: each topic that has one of the words. */
export function topicsOf(names: readonly string[]): string[] {
  const words = new Set(names.flatMap(wordsOf));
  return Object.entries(TOPICS)
    .filter(([, keys]) => keys.some((key) => words.has(key)))
    .map(([topic]) => topic)
    .sort();
}

export interface Member {
  readonly repo: string;
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly exported: boolean;
  readonly test: boolean;
}

export interface CloneClass {
  readonly hash: string;
  readonly nodes: number;
  readonly repos: readonly string[];
  readonly members: readonly Member[];
  /** nodes × (members − 1): the nodes that one shared function removes. */
  readonly duplicatedNodes: number;
  readonly topics: readonly string[];
}

export interface RepoRow {
  readonly repo: string;
  readonly commit: string | null;
  readonly files: number;
  readonly functions: number;
  readonly nodes: number;
  /** The share of the duplicated nodes of each class that falls on the members in this repo. */
  readonly duplicatedNodes: number;
  /** duplicatedNodes / nodes, 0 when the repo has no functions. */
  readonly ratio: number;
  readonly crossRepoClasses: number;
  readonly parseErrors: number;
}

export interface SharedName {
  readonly name: string;
  readonly kinds: readonly string[];
  readonly repos: readonly string[];
  readonly topics: readonly string[];
}

export interface PurposeRow {
  readonly purpose: string;
  /** Each package of the purpose with the repos that import it. */
  readonly packages: Readonly<Record<string, readonly string[]>>;
}

export interface Atlas {
  readonly schema: "codeatlas/1";
  readonly minNodes: number;
  readonly totals: {
    readonly repos: number;
    readonly files: number;
    readonly functions: number;
    readonly nodes: number;
    readonly duplicatedNodes: number;
    readonly ratio: number;
    readonly classes: number;
    readonly crossRepoClasses: number;
  };
  readonly repos: readonly RepoRow[];
  readonly classes: readonly CloneClass[];
  readonly sharedNames: readonly SharedName[];
  readonly purposes: readonly PurposeRow[];
}

export interface AtlasOptions {
  /** The smallest function shape that counts, in nodes. A small default finds one-line getters everywhere. */
  readonly minNodes?: number;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const memberOrder = (a: Member, b: Member): number => byText(a.repo, b.repo) || byText(a.file, b.file) || a.line - b.line;

export function buildAtlas(scans: readonly RepoScan[], options: AtlasOptions = {}): Atlas {
  const minNodes = options.minNodes ?? 40;
  const groups = new Map<string, { nodes: number; members: (Member & { readonly key: string; readonly parent: string | null })[] }>();
  for (const scan of scans) {
    for (const unit of scan.units as readonly Unit[]) {
      if (unit.nodes < minNodes) continue;
      const group = groups.get(unit.hash) ?? { nodes: unit.nodes, members: [] };
      group.members.push({
        repo: scan.repo,
        file: unit.file,
        line: unit.line,
        name: unit.name,
        exported: unit.exported,
        test: unit.test,
        key: `${scan.repo}:${unit.file}:${unit.line}`,
        parent: unit.parent === null ? null : `${scan.repo}:${unit.parent}`,
      });
      groups.set(unit.hash, group);
    }
  }
  const cloned = new Set<string>();
  for (const group of groups.values()) if (group.members.length > 1) for (const member of group.members) cloned.add(member.key);

  const classes: CloneClass[] = [];
  for (const [hash, group] of groups) {
    if (group.members.length < 2) continue;
    // A class whose each member is inside a cloned function is a part of the bigger class
    if (group.members.every((member) => member.parent !== null && cloned.has(member.parent))) continue;
    const members = group.members.map(({ repo, file, line, name, exported, test }) => ({ repo, file, line, name, exported, test })).sort(memberOrder);
    const repos = [...new Set(members.map((member) => member.repo))].sort(byText);
    classes.push({
      hash,
      nodes: group.nodes,
      repos,
      members,
      duplicatedNodes: group.nodes * (members.length - 1),
      topics: topicsOf(members.flatMap((member) => [member.name, member.file])),
    });
  }
  classes.sort((a, b) => b.duplicatedNodes - a.duplicatedNodes || b.repos.length - a.repos.length || byText(a.hash, b.hash));

  const repos: RepoRow[] = scans
    .map((scan): RepoRow => {
      let duplicatedNodes = 0;
      let crossRepoClasses = 0;
      for (const cls of classes) {
        const here = cls.members.filter((member) => member.repo === scan.repo).length;
        if (here === 0) continue;
        duplicatedNodes += (cls.duplicatedNodes * here) / cls.members.length;
        if (cls.repos.length > 1) crossRepoClasses++;
      }
      return {
        repo: scan.repo,
        commit: scan.commit,
        files: scan.files,
        functions: scan.units.length,
        nodes: scan.nodes,
        duplicatedNodes: Math.round(duplicatedNodes),
        ratio: scan.nodes === 0 ? 0 : round(duplicatedNodes / scan.nodes),
        crossRepoClasses,
        parseErrors: scan.errors.length,
      };
    })
    .sort((a, b) => byText(a.repo, b.repo));

  const names = new Map<string, { kinds: Set<string>; repos: Set<string> }>();
  for (const scan of scans) {
    for (const entry of scan.exports) {
      if (entry.name === "default") continue;
      const row = names.get(entry.name) ?? { kinds: new Set(), repos: new Set() };
      row.kinds.add(entry.kind);
      row.repos.add(scan.repo);
      names.set(entry.name, row);
    }
  }
  const sharedNames: SharedName[] = [...names]
    .filter(([, row]) => row.repos.size > 1)
    .map(([name, row]) => ({ name, kinds: [...row.kinds].sort(byText), repos: [...row.repos].sort(byText), topics: topicsOf([name]) }))
    .sort((a, b) => b.repos.length - a.repos.length || byText(a.name, b.name));

  const purposes: PurposeRow[] = Object.entries(PURPOSES).map(([purpose, list]) => {
    const packages: Record<string, readonly string[]> = {};
    for (const name of list) {
      const users = scans.filter((scan) => (scan.imports[name] ?? 0) > 0).map((scan) => scan.repo).sort(byText);
      if (users.length > 0) packages[name] = users;
    }
    return { purpose, packages };
  });

  const nodes = repos.reduce((sum, row) => sum + row.nodes, 0);
  const duplicatedNodes = classes.reduce((sum, cls) => sum + cls.duplicatedNodes, 0);
  return {
    schema: "codeatlas/1",
    minNodes,
    totals: {
      repos: repos.length,
      files: repos.reduce((sum, row) => sum + row.files, 0),
      functions: repos.reduce((sum, row) => sum + row.functions, 0),
      nodes,
      duplicatedNodes,
      ratio: nodes === 0 ? 0 : round(duplicatedNodes / nodes),
      classes: classes.length,
      crossRepoClasses: classes.filter((cls) => cls.repos.length > 1).length,
    },
    repos,
    classes,
    sharedNames,
    purposes,
  };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
