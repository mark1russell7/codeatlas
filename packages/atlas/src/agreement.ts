/**
 * The agreement of the two blind drafts of the labeled sample (`docs/SCHEMA.md`, the drafts and the audit). The
 * kappa, its interval and the audit size come from `@mark1russell7/rigor-statistics`, the home of statistics.
 */
import { bootstrap, cohenKappa, type Interval, type Kappa } from "@mark1russell7/rigor-statistics";
import { auditOf, type SampleFile } from "./sample.ts";

/** The labels of one draft of the sample: one line of its file for each item. */
export interface DraftLabel {
  readonly subject: string;
  readonly area: string;
  readonly category: string;
  readonly sentence: string;
}

/** The largest share of the items of the task `purpose` that a draft puts in `other`. Above it, the list gets a new version. */
export const OTHER_LIMIT: number = 0.1;

/** One cell of a confusion table: the count of the items with the label `a` of one draft and `b` of the other. */
export interface ConfusionCell {
  readonly a: string;
  readonly b: string;
  readonly count: number;
}

/** The agreement of the two drafts on one task. */
export interface TaskAgreement {
  readonly task: string;
  readonly n: number;
  readonly kappa: Kappa;
  /** The percentile bootstrap interval of kappa over the items, with `bootstrap` of rigor-statistics. */
  readonly interval: Interval;
  /** Each pair of labels with its count, the most first. A cell with `a ≠ b` is a pair that the drafts mix. */
  readonly confusion: readonly ConfusionCell[];
  /** The subjects where the two drafts disagree, in the order of the sample. */
  readonly disagree: readonly string[];
  /** The seeded audit of the task: `audit` subjects of the agreed items, with `auditOf` and the seed `<seed>:<task>`. */
  readonly audit: readonly string[];
}

/** The share of `other` of each draft on the task `purpose`, and the verdict of the rule. */
export interface OtherCheck {
  readonly a: number;
  readonly b: number;
  readonly limit: number;
  /** True when each share is at or below the limit, so the kappa can be read. */
  readonly pass: boolean;
}

/** The agreement file. */
export interface AgreementFile {
  readonly seed: string;
  readonly other: OtherCheck;
  readonly tasks: readonly TaskAgreement[];
  /** The items that a person labels: each disagreement and each audited item of a task, in the order of the sample. */
  readonly person: readonly string[];
}

const LABEL_OF: Readonly<Record<string, (label: DraftLabel) => string>> = {
  home: (label) => label.area,
  purpose: (label) => label.category,
};

function byLabel(draft: readonly DraftLabel[]): Map<string, DraftLabel> {
  const map = new Map<string, DraftLabel>();
  for (const label of draft) {
    if (map.has(label.subject)) throw new RangeError(`The draft has two labels of ${label.subject}.`);
    map.set(label.subject, label);
  }
  return map;
}

/**
 * This function gives the agreement of two drafts on each task of the sample. Each task reads its first `n` items.
 * A draft with no label for an item of a task is an error: a missing label is not an agreement.
 */
export function agreementOf(sample: SampleFile, draftA: readonly DraftLabel[], draftB: readonly DraftLabel[], runs: number = 10_000): AgreementFile {
  const a = byLabel(draftA);
  const b = byLabel(draftB);
  const pairsOf = (task: string, n: number): [string, string, string][] => {
    const of = LABEL_OF[task];
    if (of === undefined) throw new RangeError(`The task ${task} has no label of a draft.`);
    return sample.items.slice(0, n).map((item) => {
      const la = a.get(item.subject);
      const lb = b.get(item.subject);
      if (la === undefined || lb === undefined) throw new RangeError(`A draft has no label of ${item.subject} for the task ${task}.`);
      return [item.subject, of(la), of(lb)];
    });
  };
  const tasks = sample.tasks.map((task): TaskAgreement => {
    const pairs = pairsOf(task.task, task.n);
    const kappaOf = (rows: readonly [string, string, string][]): Kappa => cohenKappa(rows.map((p) => p[1]), rows.map((p) => p[2]));
    const counts = new Map<string, ConfusionCell>();
    for (const [, x, y] of pairs) {
      const key = JSON.stringify([x, y]);
      counts.set(key, { a: x, b: y, count: (counts.get(key)?.count ?? 0) + 1 });
    }
    const confusion = [...counts.values()].sort((p, q) => q.count - p.count || (p.a + p.b < q.a + q.b ? -1 : 1));
    const interval = bootstrap(pairs, (rows) => kappaOf(rows).kappa ?? Number.NaN, { runs, seed: `${sample.seed}:kappa:${task.task}` });
    const disagree = pairs.filter((p) => p[1] !== p[2]).map((p) => p[0]);
    const agreed = pairs.filter((p) => p[1] === p[2]).map((p) => p[0]);
    const audit = auditOf(agreed, `${sample.seed}:${task.task}`, task.audit);
    return { task: task.task, n: pairs.length, kappa: kappaOf(pairs), interval, confusion, disagree, audit };
  });
  const purpose = sample.tasks.find((task) => task.task === "purpose");
  const share = (draft: Map<string, DraftLabel>): number => {
    if (purpose === undefined) return 0;
    const items = sample.items.slice(0, purpose.n);
    return items.filter((item) => draft.get(item.subject)?.category === "other").length / items.length;
  };
  const other = { a: share(a), b: share(b), limit: OTHER_LIMIT };
  const marked = new Set(tasks.flatMap((task) => [...task.disagree, ...task.audit]));
  const person = sample.items.map((item) => item.subject).filter((subject) => marked.has(subject));
  return { seed: sample.seed, other: { ...other, pass: other.a <= OTHER_LIMIT && other.b <= OTHER_LIMIT }, tasks, person };
}
