/**
 * Planned duplication (CA5 of `docs/ROADMAP.md`): two roadmap items in two repositories that plan the same thing.
 * The score is the cosine of the TF-IDF vectors of the words of the two titles, with the smooth IDF `ln((1 + n) / (1 + df)) + 1`. It costs no model tokens. A model or
 * an owner judges only the pairs with the highest scores.
 */
import { wordsOf } from "./atlas.ts";
import type { CatalogQuery } from "./query.ts";
import type { StatusClass } from "./roadmaps.ts";

export const PLANNED_VERSION: string = "planned/1";

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
}

/** The limits of `plannedPairs`. */
export interface PlannedOptions {
  /** The lowest score of a pair. The default is 0.25. */
  readonly minScore?: number;
  /** The fewest shared words of a pair. The default is 2. */
  readonly minShared?: number;
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
      pairs.push({
        score: Math.round(score * 1000) / 1000,
        shared: shared.sort((x, y) => y[1] - x[1] || byText(x[0], y[0])).map(([word]) => word),
        a,
        b,
        kind: a.statusClass === "done" || b.statusClass === "done" ? "one done" : "both open",
        names,
      });
    }
  }
  return pairs.sort((x, y) => y.score - x.score || placeOrder(x.a, y.a) || placeOrder(x.b, y.b));
}

/** This function gives the planned pairs of the roadmap items of the current snapshots of the catalog. */
export async function plannedDuplication(q: CatalogQuery, options: PlannedOptions = {}): Promise<PlannedPair[]> {
  const rows = await q.selectFrom("current_roadmap_item").select(["repo", "path", "id", "title", "status_class"]).execute();
  return plannedPairs(
    rows.map((row) => ({ repo: row.repo, path: row.path, id: row.id, title: row.title, statusClass: row.status_class as StatusClass })),
    options,
  );
}

const cell = (text: string): string => {
  const flat = text.replace(/[\\|]/g, (c) => `\\${c}`).replace(/\s+/g, " ");
  return flat.length > 160 ? `${flat.slice(0, 159)}…` : flat;
};

/** This function writes the pairs as a Markdown section: the pairs of two open plans first, then the others. */
export function plannedMarkdown(pairs: readonly PlannedPair[], limit = 40): string {
  const open = pairs.filter((p) => p.kind === "both open" && !p.names);
  const lines = [
    "## Planned duplication",
    "",
    `- Pairs: **${pairs.length}**. Two open plans: ${open.length}. One plan done: ${pairs.filter((p) => p.kind === "one done").length}. A title that names the other repository: ${pairs.filter((p) => p.names).length}.`,
    "- The score is the cosine of the words of the two titles. A high score is a question for the two owners, not a proof.",
  ];
  const table = (title: string, rows: readonly PlannedPair[]): void => {
    if (rows.length === 0) return;
    lines.push("", `### ${title}`, "", "| Score | Item | Other item | Shared words |", "| ---: | --- | --- | --- |");
    for (const p of rows.slice(0, limit)) {
      const item = (i: PlanItem): string => `\`${i.repo}\` ${i.id} (${i.statusClass}): ${cell(i.title)}`;
      lines.push(`| ${p.score.toFixed(3)} | ${item(p.a)} | ${item(p.b)} | ${p.shared.slice(0, 6).join(", ")} |`);
    }
  };
  table("Two open plans", open);
  table("One plan is done", pairs.filter((p) => p.kind === "one done" && !p.names));
  return `${lines.join("\n")}\n`;
}
