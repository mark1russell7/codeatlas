/**
 * Planned duplication (CA5 of `docs/ROADMAP.md`): two roadmap items in two repositories that plan the same thing.
 * The score is the cosine of the TF-IDF vectors of the words of the two titles, with the smooth IDF `ln((1 + n) / (1 + df)) + 1`. It costs no model tokens. A model or
 * an owner judges only the pairs with the highest scores.
 */
import { HOMES, RULES } from "@mark1russell7/conventions";
import { wordsOf } from "./atlas.ts";
import type { CatalogQuery } from "./query.ts";
import type { StatusClass } from "./roadmaps.ts";

export const PLANNED_VERSION: string = "planned/4";

/** The words that tell nothing about the thing that an item makes. */
export const PLAN_STOP_WORDS: ReadonlySet<string> = new Set(
  (
    "the and for with from that this each its into one two are not has have all any can only then than when what which " +
    "who will was were but use uses used new more most also our their them they there these those over under after " +
    "before about other same own per out off via thus now gives give makes make get gets"
  ).split(" "),
);

/** One item of a roadmap, with its place. */
export interface PlanItem {
  readonly repo: string;
  readonly path: string;
  readonly id: string;
  readonly title: string;
  readonly statusClass: StatusClass;
}

/** Two items of two repositories with words in common. */
export interface PlannedPair {
  /** The cosine of the two TF-IDF vectors, from 0 to 1, to 3 decimals. */
  readonly score: number;
  /** The words of both titles, the heaviest first. */
  readonly shared: readonly string[];
  readonly a: PlanItem;
  readonly b: PlanItem;
  /** `both open`: neither item is done. `one done`: one plan is made, so the other plan can use it. */
  readonly kind: "both open" | "one done";
  /** True when a title names the repository of the other item: a plan that uses the other, and not a second copy. */
  readonly names: boolean;
  /**
   * True when the title words of an item are in the titles of `rolloutRepos` or more repositories. Such an item is a
   * step of a shared rollout, as a rule of the template. Each repository does it, so it is not a copy.
   */
  readonly rollout: boolean;
  /**
   * The name of the first explainer whose words contain each shared word, or null. Such a pair shares only the words of
   * a rule or of a home. The owners judged such pairs as two different plans, so they are not a question for the owners.
   */
  readonly explained: string | null;
  /**
   * The modules of a home that already have a part of the plan, the best first. A module counts when its path and
   * exported names have 2 or more shared words. Its path must have 1 or more of them.
   */
  readonly homeHas: readonly HomeMatch[];
}

/** A module of a home repository, with its exported names. */
export interface HomeModule {
  readonly repo: string;
  readonly path: string;
  readonly names: readonly string[];
}

/** A module of a home with shared words of a pair. */
export interface HomeMatch {
  readonly repo: string;
  readonly path: string;
  /** The shared words of the pair that the module has. */
  readonly words: readonly string[];
}

/** A rule or a home whose words explain a pair: the two plans share only these words. */
export interface Explainer {
  readonly name: string;
  readonly text: string;
}

/** This function gives an explainer for each rule of the conventions and for each home of the map. */
export function explainersOf(): Explainer[] {
  return [
    ...RULES.map((rule) => ({ name: `rule ${rule.id}`, text: `${rule.id.replace(/-/g, " ")} ${rule.title}` })),
    ...HOMES.map((home) => ({
      name: `home ${home.area}`,
      text: [home.area, home.title, home.covers, ...(home.words ?? []), ...home.packages, home.repo.slice(home.repo.indexOf("/") + 1)].join(" "),
    })),
  ];
}

const stem = (word: string): string => word.replace(/ies$/, "y").replace(/(ed|es|s|d)$/, "");

/** The limits of `plannedPairs`. */
export interface PlannedOptions {
  /** The lowest score of a pair. The default is 0.25. */
  readonly minScore?: number;
  /** The fewest shared words of a pair. The default is 2. */
  readonly minShared?: number;
  /** The fewest repositories with the same title words for a rollout. The default is 3. */
  readonly rolloutRepos?: number;
  /** The rules and homes that explain a pair. The default is none. */
  readonly explainers?: readonly Explainer[];
  /** The modules of the homes, for `homeHas`. The default is none. */
  readonly homeModules?: readonly HomeModule[];
  /** The most modules in `homeHas`. The default is 3. */
  readonly homeTop?: number;
}

const PATH_STOP_WORDS: ReadonlySet<string> = new Set(["src", "index", "mts", "tsx", "lib", "util", "utils", "core", "types"]);

/** The words of a path after its last `src/`, without the words that every path has. */
const pathWords = (path: string): string[] => {
  const at = path.lastIndexOf("src/");
  return planWords(at < 0 ? path : path.slice(at + 4)).filter((word) => !PATH_STOP_WORDS.has(word) && word !== "ts");
};

/** This function gives a function that finds the modules of a home with the shared words of a pair. */
function homeMatcher(modules: readonly HomeModule[], top: number): (shared: readonly string[]) => HomeMatch[] {
  const indexed = modules.map((m) => {
    const path = new Set(pathWords(m.path).map(stem));
    const all = new Set([...path, ...planWords(m.names.join(" ")).map(stem)]);
    return { module: m, path, all };
  });
  const df = new Map<string, number>();
  for (const { path } of indexed) for (const word of path) df.set(word, (df.get(word) ?? 0) + 1);
  const idf = (word: string): number => Math.log((1 + indexed.length) / (1 + (df.get(word) ?? 0))) + 1;
  return (shared) => {
    const words = [...new Set(shared.map(stem))];
    const hits: { score: number; match: HomeMatch }[] = [];
    for (const { module, path, all } of indexed) {
      const had = words.filter((word) => all.has(word));
      if (had.length < 2 || !had.some((word) => path.has(word))) continue;
      hits.push({ score: had.reduce((sum, word) => sum + idf(word), 0), match: { repo: module.repo, path: module.path, words: had } });
    }
    hits.sort((x, y) => y.score - x.score || byText(x.match.repo, y.match.repo) || byText(x.match.path, y.match.path));
    return hits.slice(0, top).map((hit) => hit.match);
  };
}


/** This function gives the words of a title that tell what the item makes: 3 letters or more, no number, no stop word. */
export function planWords(title: string): string[] {
  return wordsOf(title).filter((word) => word.length >= 3 && !/^\d+$/.test(word) && !PLAN_STOP_WORDS.has(word));
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const placeOrder = (a: PlanItem, b: PlanItem): number => byText(a.repo, b.repo) || byText(a.path, b.path) || byText(a.id, b.id);

/**
 * This function gives each pair of items of two repositories with a score of `minScore` or more and `minShared` shared
 * words, the highest score first. A pair of two done items is history, not a plan, so it is not in the result.
 */
export function plannedPairs(items: readonly PlanItem[], options: PlannedOptions = {}): PlannedPair[] {
  const minScore = options.minScore ?? 0.25;
  const minShared = options.minShared ?? 2;
  const sorted = [...items].sort(placeOrder);
  const words = sorted.map((item) => planWords(item.title));
  const keys = words.map((list) => [...new Set(list)].sort().join(" "));
  const reposOfKey = new Map<string, Set<string>>();
  sorted.forEach((item, i) => reposOfKey.set(keys[i]!, (reposOfKey.get(keys[i]!) ?? new Set<string>()).add(item.repo)));
  const rolloutRepos = options.rolloutRepos ?? 3;
  const explainers = (options.explainers ?? []).map((e) => ({ name: e.name, words: new Set(planWords(e.text).map(stem)) }));
  const explainedBy = (shared: readonly string[]): string | null =>
    explainers.find((e) => shared.every((word) => e.words.has(stem(word))))?.name ?? null;
  const homeHas = homeMatcher(options.homeModules ?? [], options.homeTop ?? 3);
  const df = new Map<string, number>();
  for (const list of words) for (const word of new Set(list)) df.set(word, (df.get(word) ?? 0) + 1);
  const vectors = words.map((list) => {
    const tf = new Map<string, number>();
    for (const word of list) tf.set(word, (tf.get(word) ?? 0) + 1);
    const weights = [...tf].map(([word, count]) => [word, count * (Math.log((1 + sorted.length) / (1 + (df.get(word) ?? 0))) + 1)] as const);
    const norm = Math.hypot(...weights.map(([, weight]) => weight));
    return new Map(weights.map(([word, weight]) => [word, norm === 0 ? 0 : weight / norm]));
  });
  const pairs: PlannedPair[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      if (a.repo === b.repo || (a.statusClass === "done" && b.statusClass === "done")) continue;
      let score = 0;
      const shared: [string, number][] = [];
      for (const [word, x] of vectors[i]!) {
        const y = vectors[j]!.get(word);
        if (y === undefined || x * y === 0) continue;
        score += x * y;
        shared.push([word, x * y]);
      }
      if (score < minScore || shared.length < minShared) continue;
      const names = a.title.toLowerCase().includes(b.repo.toLowerCase()) || b.title.toLowerCase().includes(a.repo.toLowerCase());
      const words = shared.sort((x, y) => y[1] - x[1] || byText(x[0], y[0])).map(([word]) => word);
      pairs.push({
        score: Math.round(score * 1000) / 1000,
        shared: words,
        a,
        b,
        kind: a.statusClass === "done" || b.statusClass === "done" ? "one done" : "both open",
        names,
        rollout: reposOfKey.get(keys[i]!)!.size >= rolloutRepos || reposOfKey.get(keys[j]!)!.size >= rolloutRepos,
        explained: explainedBy(words),
        homeHas: homeHas(words),
      });
    }
  }
  return pairs.sort((x, y) => y.score - x.score || placeOrder(x.a, y.a) || placeOrder(x.b, y.b));
}

/**
 * This function gives the modules of the home repositories of the map. Each module is a source file with its exported
 * names. Tests and site packages are not modules.
 */
export async function homeModulesOf(q: CatalogQuery, repos: readonly string[] = HOMES.map((home) => home.repo.slice(home.repo.indexOf("/") + 1))): Promise<HomeModule[]> {
  if (repos.length === 0) return [];
  const rows = await q
    .selectFrom("current_file as f")
    .innerJoin("symbol as s", "s.blob", "f.blob")
    .where("f.test", "=", 0)
    .where("s.exported", "=", 1)
    .where("f.repo", "in", [...new Set(repos)])
    .select(["f.repo as repo", "f.path as path", "s.name as name"])
    .orderBy("repo")
    .orderBy("path")
    .orderBy("name")
    .execute();
  const modules = new Map<string, { repo: string; path: string; names: string[] }>();
  for (const row of rows) {
    if (!row.path.includes("src/") || /(^|\/)site\//.test(row.path)) continue;
    const key = `${row.repo}:${row.path}`;
    const module = modules.get(key) ?? { repo: row.repo, path: row.path, names: [] };
    if (!module.names.includes(row.name)) module.names.push(row.name);
    modules.set(key, module);
  }
  return [...modules.values()];
}

/**
 * This function gives the planned pairs of the roadmap items of the current snapshots of the catalog. The default
 * explainers are the rules and the homes of `explainersOf`. The default home modules are those of `homeModulesOf`.
 */
export async function plannedDuplication(q: CatalogQuery, options: PlannedOptions = {}): Promise<PlannedPair[]> {
  const rows = await q.selectFrom("current_roadmap_item").select(["repo", "path", "id", "title", "status_class"]).execute();
  return plannedPairs(
    rows.map((row) => ({ repo: row.repo, path: row.path, id: row.id, title: row.title, statusClass: row.status_class as StatusClass })),
    { explainers: explainersOf(), homeModules: options.homeModules ?? (await homeModulesOf(q)), ...options },
  );
}

const cell = (text: string): string => {
  const flat = text.replace(/[\\|]/g, (c) => `\\${c}`).replace(/\s+/g, " ");
  return flat.length > 160 ? `${flat.slice(0, 159)}…` : flat;
};

/** This function writes the pairs as a Markdown section: the pairs of two open plans first, then the others. */
export function plannedMarkdown(pairs: readonly PlannedPair[], limit = 40): string {
  const asked = (p: PlannedPair): boolean => !p.names && !p.rollout && p.explained === null;
  const open = pairs.filter((p) => p.kind === "both open" && asked(p));
  const lines = [
    "## Planned duplication",
    "",
    `- Pairs: **${pairs.length}**. Two open plans: ${open.length}. One plan done: ${pairs.filter((p) => p.kind === "one done").length}. A title that names the other repository: ${pairs.filter((p) => p.names).length}. A step of a shared rollout: ${pairs.filter((p) => p.rollout).length}. Shared words of a rule or a home only: ${pairs.filter((p) => p.explained !== null).length}.`,
    "- The score is the cosine of the words of the two titles. A high score is a question for the two owners, not a proof.",
    `- A module of a home with shared words of the pair: ${open.filter((p) => p.homeHas.length > 0).length} of the ${open.length} pairs of two open plans. Show it to the owners with the pair.`,
  ];
  const table = (title: string, rows: readonly PlannedPair[]): void => {
    if (rows.length === 0) return;
    lines.push("", `### ${title}`, "", "| Score | Item | Other item | Shared words | The home has |", "| ---: | --- | --- | --- | --- |");
    for (const p of rows.slice(0, limit)) {
      const item = (i: PlanItem): string => `\`${i.repo}\` ${i.id} (${i.statusClass}): ${cell(i.title)}`;
      const has = p.homeHas.map((m) => `\`${m.repo}\` ${cell(m.path)}`).join("<br>");
      lines.push(`| ${p.score.toFixed(3)} | ${item(p.a)} | ${item(p.b)} | ${p.shared.slice(0, 6).join(", ")} | ${has} |`);
    }
  };
  table("Two open plans", open);
  table("One plan is done", pairs.filter((p) => p.kind === "one done" && asked(p)));
  return `${lines.join("\n")}\n`;
}
