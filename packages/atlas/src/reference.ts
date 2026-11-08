/**
 * The provisional reference of Layer 2 (`docs/SCHEMA.md`, the reference). No person labels the sample, so the
 * reference is a fact where a fact settles the label, else the majority of the three blind raters. An item with no
 * majority is unknown, and it is not a hit or a miss. The Wilson interval comes from `@mark1russell7/rigor-statistics`.
 */
import { wilson } from "@mark1russell7/rigor-statistics";
import { HOMES } from "@mark1russell7/conventions";
import type { DraftLabel } from "./agreement.ts";
import type { FunctionPlace } from "./queries.ts";
import type { CatalogQuery } from "./query.ts";
import type { SampleFile, SampleItem } from "./sample.ts";

export const REFERENCE_VERSION: string = "reference/1";

/** The words that go with each precision of the reference. The reference is models, so no figure is final. */
export const REFERENCE_NOTE: string = "against the 3-rater majority, provisional";

/** One label of one source: the subject, the task (`home` or `purpose`) and the label. */
export interface RaterLabel {
  readonly subject: string;
  readonly task: string;
  readonly label: string;
}

/** The labels of one blind rater. */
export interface Rater {
  readonly by: string;
  readonly labels: readonly RaterLabel[];
}

/** A label that a fact of Layer 1 settles, with the fact in words. */
export interface FactLabel extends RaterLabel {
  readonly fact: string;
  /** The kind of the move to the home that the fact gives. */
  readonly move?: MoveKind;
}

/**
 * The kind of a move of code to its home. `pr` is a pull request to the home. `planned` goes to the gap list of a
 * planned home. `blocked by the rule` is a move that the dependency rules forbid. `uses the home` is code whose body
 * calls a function of the home, so its own part is local policy. `none` is no move.
 */
export type MoveKind = "pr" | "planned" | "blocked by the rule" | "uses the home" | "none";

/** The package that holds the code of a move: its repository, its name, and true when it is an app (`private` in its manifest). */
export interface MoveCaller {
  readonly repo: string;
  readonly app: boolean;
  /** The name of the package. A package of the home is in its home, also in another repository of the home. */
  readonly name?: string;
  /** The packages whose imported functions the body of the code calls. An import that the body does not call is not in it. */
  readonly calls?: readonly string[];
}

/**
 * The repositories of a monorepo whose packages a general package must not use. A general package is a published
 * package in another repository. An app can use them.
 */
export const MONOREPOS: ReadonlySet<string> = new Set(["client"]);

const HOME_OF_AREA = new Map(HOMES.map((home) => [home.area, home] as const));

/**
 * This function gives the kind of the move of code in `caller` to the home of the area `area`. A label that names a
 * home must also obey the dependency rules. Thus a general package gets no move to a home in a monorepo. Code whose
 * body calls a function of the home gets no pull request. The owners found that such code uses the home for its
 * general part. An import that the body does not call is not a use: such a function can be a full copy.
 */
export function moveOf(caller: MoveCaller, area: string): MoveKind {
  const home = HOME_OF_AREA.get(area);
  if (home === undefined) return "none";
  const repo = home.repo.slice(home.repo.indexOf("/") + 1);
  if (repo === caller.repo || (caller.name !== undefined && home.packages.includes(caller.name))) return "none";
  if (caller.calls?.some((name) => home.packages.includes(name)) === true) return "uses the home";
  if (home.state === "planned" || home.state === "none") return "planned";
  if (MONOREPOS.has(repo) && !MONOREPOS.has(caller.repo) && !caller.app) return "blocked by the rule";
  return "pr";
}

/** The label of the reference for one item and one task. */
export interface ReferenceLabel {
  readonly subject: string;
  readonly task: string;
  /** The label, or null when no fact settles it and the raters have no majority. */
  readonly label: string | null;
  readonly by: "fact" | "raters" | "unknown";
  /** The count of the raters that give `label`, and the count of the raters with a label of the item. */
  readonly votes: number;
  readonly raters: number;
}

/** The counts of one task of the reference. */
export interface ReferenceTask {
  readonly task: string;
  readonly items: number;
  readonly fact: number;
  readonly raters: number;
  readonly unknown: number;
  /** The items that a fact settles and the raters have a majority: the count where the majority gives the label of the fact. */
  readonly factChecked: number;
  readonly factAgree: number;
}

/** The reference file. */
export interface ReferenceFile {
  readonly version: string;
  readonly seed: string;
  readonly note: string;
  readonly raters: readonly string[];
  readonly tasks: readonly ReferenceTask[];
  readonly labels: readonly ReferenceLabel[];
}

/** One line of a rater file: a draft (`area`, `category`) or an answer (`home`, `purpose`). */
interface RaterLine {
  readonly subject: string;
  readonly area?: string;
  readonly category?: string;
  readonly home?: string;
  readonly purpose?: string;
}

/** This function gives the labels of one line of a rater file. A draft and an answer use different names of the fields. */
export function labelsOfLine(line: RaterLine | DraftLabel): RaterLabel[] {
  const raw = line as RaterLine;
  const home = raw.home ?? raw.area;
  const purpose = raw.purpose ?? raw.category;
  return [
    ...(home === undefined ? [] : [{ subject: raw.subject, task: "home", label: home }]),
    ...(purpose === undefined ? [] : [{ subject: raw.subject, task: "purpose", label: purpose }]),
  ];
}

/** This function reads a rater file in JSON Lines form. */
export function raterOfText(by: string, text: string): Rater {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  return { by, labels: lines.flatMap((line) => labelsOfLine(JSON.parse(line) as RaterLine)) };
}

const key = (subject: string, task: string): string => `${subject}\u0000${task}`;

/**
 * This function gives the reference of each item of each task of the sample. A fact settles a label first. Else
 * the label of a strict majority of the raters with a label of the item, and at least two, is the reference.
 */
export function referenceOf(sample: SampleFile, raters: readonly Rater[], facts: readonly FactLabel[] = []): ReferenceFile {
  const votes = new Map<string, string[]>();
  for (const rater of raters) {
    for (const label of rater.labels) votes.set(key(label.subject, label.task), [...(votes.get(key(label.subject, label.task)) ?? []), label.label]);
  }
  const factOf = new Map(facts.map((fact) => [key(fact.subject, fact.task), fact]));
  const labels: ReferenceLabel[] = [];
  const tasks: ReferenceTask[] = [];
  for (const plan of sample.tasks) {
    const counts = { fact: 0, raters: 0, unknown: 0, factChecked: 0, factAgree: 0 };
    for (const item of sample.items.slice(0, plan.n)) {
      const given = votes.get(key(item.subject, plan.task)) ?? [];
      const tally = new Map<string, number>();
      for (const label of given) tally.set(label, (tally.get(label) ?? 0) + 1);
      const [top, count] = [...tally].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0] ?? ["", 0];
      const majority = count >= 2 && 2 * count > given.length ? top : null;
      const fact = factOf.get(key(item.subject, plan.task));
      if (fact !== undefined) {
        counts.fact++;
        if (majority !== null) {
          counts.factChecked++;
          if (majority === fact.label) counts.factAgree++;
        }
        labels.push({ subject: item.subject, task: plan.task, label: fact.label, by: "fact", votes: tally.get(fact.label) ?? 0, raters: given.length });
      } else if (majority !== null) {
        counts.raters++;
        labels.push({ subject: item.subject, task: plan.task, label: majority, by: "raters", votes: count, raters: given.length });
      } else {
        counts.unknown++;
        labels.push({ subject: item.subject, task: plan.task, label: null, by: "unknown", votes: count, raters: given.length });
      }
    }
    tasks.push({ task: plan.task, items: plan.n, ...counts });
  }
  return { version: REFERENCE_VERSION, seed: sample.seed, note: REFERENCE_NOTE, raters: raters.map((rater) => rater.by), tasks, labels };
}

/** The precision of one label of a labeler against the reference. */
export interface LabelPrecision {
  readonly label: string;
  readonly hits: number;
  readonly misses: number;
  readonly low: number;
  readonly high: number;
}

/** The precision of a labeler for one task against the reference. */
export interface TaskPrecision {
  readonly task: string;
  readonly note: string;
  readonly hits: number;
  readonly misses: number;
  /** The items where the reference is unknown. They are not a hit or a miss. */
  readonly unknown: number;
  /** The items of the task with no label of the labeler. */
  readonly missing: number;
  readonly precision: number | null;
  readonly low: number;
  readonly high: number;
  /** The share of the hits and misses that a fact settles, and the share that the raters settle. */
  readonly settled: { readonly fact: number; readonly raters: number };
  /** The precision of each label that the labeler gives, the most items first. */
  readonly labels: readonly LabelPrecision[];
}

/** The precision file of one labeler. */
export interface PrecisionFile {
  readonly version: string;
  readonly by: string;
  readonly note: string;
  readonly tasks: readonly TaskPrecision[];
}

/**
 * This function gives the precision of a labeler against the reference, with a Wilson interval. A hit is an item
 * where the labeler gives the label of the reference. An unknown item of the reference does not count.
 */
export function precisionOf(reference: ReferenceFile, labeler: Rater): PrecisionFile {
  const given = new Map(labeler.labels.map((label) => [key(label.subject, label.task), label.label]));
  const tasks = reference.tasks.map((task): TaskPrecision => {
    const rows = reference.labels.filter((row) => row.task === task.task);
    let [hits, misses, unknown, missing, byFact] = [0, 0, 0, 0, 0];
    const perLabel = new Map<string, { hits: number; misses: number }>();
    for (const row of rows) {
      const label = given.get(key(row.subject, row.task));
      if (label === undefined) {
        missing++;
        continue;
      }
      if (row.label === null) {
        unknown++;
        continue;
      }
      const hit = label === row.label;
      if (hit) hits++;
      else misses++;
      if (row.by === "fact") byFact++;
      const cell = perLabel.get(label) ?? { hits: 0, misses: 0 };
      if (hit) cell.hits++;
      else cell.misses++;
      perLabel.set(label, cell);
    }
    const counted = hits + misses;
    const interval = wilson(hits, counted);
    return {
      task: task.task,
      note: REFERENCE_NOTE,
      hits,
      misses,
      unknown,
      missing,
      precision: counted === 0 ? null : hits / counted,
      low: interval.low,
      high: interval.high,
      settled: { fact: counted === 0 ? 0 : byFact / counted, raters: counted === 0 ? 0 : (counted - byFact) / counted },
      labels: [...perLabel]
        .map(([label, cell]) => ({ label, ...cell, ...pick(wilson(cell.hits, cell.hits + cell.misses)) }))
        .sort((a, b) => b.hits + b.misses - (a.hits + a.misses) || (a.label < b.label ? -1 : 1)),
    };
  });
  return { version: REFERENCE_VERSION, by: labeler.by, note: REFERENCE_NOTE, tasks };
}

const pick = (interval: { readonly low: number; readonly high: number }): { low: number; high: number } => ({ low: interval.low, high: interval.high });

/** The area of each home package of the map of homes. */
const AREA_OF_PACKAGE = new Map(HOMES.flatMap((home) => home.packages.map((name) => [name, home.area] as const)));

/**
 * This pattern finds the files of test support outside the test folders: fakes, mocks and stubs. A copy in such a file
 * is not a home fact. The logic of a fake is test support, and its home is test generation.
 */
export const TEST_SUPPORT: RegExp = /(?:^|\/)(?:testing|fakes?|mocks?|stubs?)\/|(?:^|[/._-])(?:fakes?|mocks?|stubs?)\.[cm]?[jt]sx?$/;

/**
 * This function gives the home facts of the items. An item can have the renamed hash of an exported function of a
 * home package, at another place. Then the item has the area of that package. The function of the home does the same
 * work, so the home is a fact and not a judgment. An item with copies in two areas gets no fact.
 */
export async function homeFacts(q: CatalogQuery, items: readonly SampleItem[]): Promise<FactLabel[]> {
  const subjects = [...new Set(items.map((item) => item.subject))];
  if (subjects.length === 0) return [];
  const manifests = await q.selectFrom("current_manifest").select(["repo", "path", "name", "private"]).where("name", "is not", null).execute();
  const manifestOf = (repo: string, path: string): { readonly name: string; readonly app: boolean } | undefined => {
    let best: { readonly name: string; readonly app: boolean; readonly depth: number } | undefined;
    for (const manifest of manifests) {
      if (manifest.repo !== repo || manifest.name === null) continue;
      const folder = manifest.path.slice(0, manifest.path.length - "package.json".length);
      if (path.startsWith(folder) && (best === undefined || folder.length > best.depth)) best = { name: manifest.name, app: manifest.private === 1, depth: folder.length };
    }
    return best;
  };
  const packageOf = (repo: string, path: string): string | undefined => manifestOf(repo, path)?.name;
  const callsOf = await packageCallsOf(q, items);
  const copies = await q
    .selectFrom("current_file as f")
    .innerJoin("symbol as s", "s.blob", "f.blob")
    .where("f.test", "=", 0)
    .where("s.exported", "=", 1)
    .where("s.hash_renamed", "in", subjects)
    .select(["s.hash_renamed as subject", "f.repo as repo", "f.path as path", "s.line as line"])
    .execute();
  const placeOf = new Map(items.map((item) => [item.subject, item]));
  const areas = new Map<string, Map<string, string>>();
  for (const copy of copies) {
    if (copy.subject === null) continue;
    const item = placeOf.get(copy.subject);
    if (item !== undefined && item.repo === copy.repo && item.path === copy.path) continue;
    if (TEST_SUPPORT.test(copy.path)) continue;
    const name = packageOf(copy.repo, copy.path);
    const area = name === undefined ? undefined : AREA_OF_PACKAGE.get(name);
    if (name === undefined || area === undefined) continue;
    const found = areas.get(copy.subject) ?? new Map<string, string>();
    if (!found.has(area)) found.set(area, `an exported copy in ${name} (${copy.repo}/${copy.path}:${copy.line})`);
    areas.set(copy.subject, found);
  }
  return [...areas]
    .filter(([, found]) => found.size === 1)
    .map(([subject, found]) => {
      const [area, fact] = [...found][0]!;
      const item = placeOf.get(subject)!;
      const manifest = manifestOf(item.repo, item.path);
      const calls = callsOf.get(placeKey(item)) ?? [];
      const move = moveOf({ repo: item.repo, app: manifest?.app ?? false, calls, ...(manifest === undefined ? {} : { name: manifest.name }) }, area);
      return { subject, task: "home", label: area, fact, move };
    })
    .sort((a, b) => (a.subject < b.subject ? -1 : 1));
}

/** One function at its place: the repository, the path of its file and its qualified name. */
type Place = Pick<FunctionPlace, "repo" | "path" | "name">;

/** This function gives the key of a function place in the result of `packageCallsOf`. */
export function placeKey(place: Place): string {
  return `${place.repo}/${place.path}#${place.name}`;
}

/**
 * This function gives the packages whose imported functions the body of each function calls, by `placeKey`. A call
 * site is in the body when its caller is the function or a function inside it. A call `a.b()` counts the import `a`.
 */
export async function packageCallsOf(q: CatalogQuery, places: readonly Place[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (places.length === 0) return result;
  const paths = [...new Set(places.map((place) => place.path))];
  const imports = await q
    .selectFrom("current_file as f")
    .innerJoin("import as i", "i.blob", "f.blob")
    .where("f.path", "in", paths)
    .where("i.package", "is not", null)
    .select(["f.repo as repo", "f.path as path", "i.package as package", "i.names as names"])
    .execute();
  const packageOfLocal = new Map<string, Map<string, string>>();
  for (const row of imports) {
    const file = `${row.repo}/${row.path}`;
    const locals = packageOfLocal.get(file) ?? new Map<string, string>();
    for (const name of JSON.parse(row.names) as { local: string }[]) locals.set(name.local, row.package!);
    packageOfLocal.set(file, locals);
  }
  const calls = await q
    .selectFrom("current_file as f")
    .innerJoin("call_site as c", "c.blob", "f.blob")
    .where("f.path", "in", paths)
    .select(["f.repo as repo", "f.path as path", "c.caller as caller", "c.callee as callee"])
    .execute();
  const callsOfFile = new Map<string, { caller: string; callee: string }[]>();
  for (const row of calls) {
    const file = `${row.repo}/${row.path}`;
    callsOfFile.set(file, [...(callsOfFile.get(file) ?? []), row]);
  }
  for (const place of places) {
    const file = `${place.repo}/${place.path}`;
    const locals = packageOfLocal.get(file);
    if (locals === undefined) continue;
    const called = new Set<string>();
    for (const call of callsOfFile.get(file) ?? []) {
      if (call.caller !== place.name && !call.caller.startsWith(`${place.name}.`)) continue;
      const found = locals.get(call.callee.split(".")[0]!);
      if (found !== undefined) called.add(found);
    }
    if (called.size > 0) result.set(placeKey(place), [...called].sort());
  }
  return result;
}

/** This function writes the reference and the precision of each labeler as Markdown. */
export function referenceMarkdown(reference: ReferenceFile, precisions: readonly PrecisionFile[]): string {
  const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;
  const lines = ["## The provisional reference of Layer 2", ""];
  lines.push(`No person labels the sample. A fact of Layer 1 settles a label first. Else the majority of the raters (${reference.raters.join(", ")}) settles it. An item with no majority is unknown.`);
  lines.push("", "| Task | Items | By a fact | By the raters | Unknown |", "| --- | ---: | ---: | ---: | ---: |");
  for (const t of reference.tasks) lines.push(`| ${t.task} | ${t.items} | ${t.fact} | ${t.raters} | ${t.unknown} |`);
  lines.push("");
  for (const file of precisions) {
    lines.push(`### Precision of ${file.by}`, "", `Each figure is ${file.note}, with the Wilson 95 % interval.`, "");
    lines.push("| Task | Precision | Interval | Hits | Misses | Unknown | Settled by a fact |", "| --- | ---: | --- | ---: | ---: | ---: | ---: |");
    for (const t of file.tasks) {
      const value = t.precision === null ? "not known" : pct(t.precision);
      lines.push(`| ${t.task} | ${value} | ${pct(t.low)} to ${pct(t.high)} | ${t.hits} | ${t.misses} | ${t.unknown} | ${pct(t.settled.fact)} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
