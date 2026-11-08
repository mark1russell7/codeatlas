/**
 * The verdict of the audit of the labeled sample (`docs/SCHEMA.md`, the drafts and the audit). The Wilson interval
 * comes from `@mark1russell7/rigor-statistics`, the home of statistics.
 */
import { wilson } from "@mark1russell7/rigor-statistics";
import type { AgreementFile, DraftLabel } from "./agreement.ts";
import type { SampleFile } from "./sample.ts";

/** The answer of the person for one item: the label of each task that the person checked, and the verdict on the sentence. */
export interface PersonAnswer {
  readonly subject: string;
  readonly home?: string;
  readonly purpose?: string;
  readonly sentence?: "right" | "wrong";
}

/** The verdict of one task. */
export interface TaskVerdict {
  readonly task: string;
  readonly target: number;
  /** The count of the audited items with an answer of the person. */
  readonly audited: number;
  /** The count of the audited items where the person gives the agreed label of the drafts. */
  readonly agree: number;
  readonly low: number;
  readonly high: number;
  /** True when each audited item has an answer and the Wilson lower end is at or above the target. */
  readonly pass: boolean;
  /** The subjects of the task that need an answer of the person and have none. */
  readonly missing: readonly string[];
}

/** One label of the truth, with its source: `drafts` for an agreed label, `person` for an answer of the person. */
export interface TruthLabel {
  readonly subject: string;
  readonly task: string;
  readonly label: string;
  readonly by: "drafts" | "person";
}

/** The verdict file. */
export interface VerdictFile {
  readonly seed: string;
  readonly tasks: readonly TaskVerdict[];
  /** The sentences that the person checked, and the count that are right. No gate reads them. */
  readonly sentence: { readonly checked: number; readonly right: number };
  /** The labels of the truth of each task that passes. A task that fails has none: the person labels each of its items. */
  readonly truth: readonly TruthLabel[];
}

const LABEL_OF: Readonly<Record<string, (label: DraftLabel) => string>> = {
  home: (label) => label.area,
  purpose: (label) => label.category,
};

/**
 * This function gives the verdict of the audit. Each audited item of a task counts as agreement when the person gives
 * the label of draft `a`, which is the label of both drafts. An item of the task where the drafts disagree takes the
 * label of the person.
 */
export function verdictOf(sample: SampleFile, draftA: readonly DraftLabel[], agreement: AgreementFile, answers: readonly PersonAnswer[]): VerdictFile {
  const a = new Map(draftA.map((label) => [label.subject, label]));
  const person = new Map(answers.map((answer) => [answer.subject, answer]));
  const tasks: TaskVerdict[] = [];
  const truth: TruthLabel[] = [];
  for (const task of agreement.tasks) {
    const plan = sample.tasks.find((t) => t.task === task.task);
    const of = LABEL_OF[task.task];
    if (plan === undefined || of === undefined) throw new RangeError(`The sample has no task ${task.task}.`);
    const agreedOf = (subject: string): string => {
      const label = a.get(subject);
      if (label === undefined) throw new RangeError(`The draft has no label of ${subject}.`);
      return of(label);
    };
    const answerOf = (subject: string): string | undefined => {
      const answer = person.get(subject);
      return task.task === "home" ? answer?.home : answer?.purpose;
    };
    const missing = [...task.disagree, ...task.audit].filter((subject) => answerOf(subject) === undefined);
    const audited = task.audit.filter((subject) => answerOf(subject) !== undefined);
    const agree = audited.filter((subject) => answerOf(subject) === agreedOf(subject)).length;
    const interval = wilson(agree, audited.length);
    const pass = missing.length === 0 && interval.low >= plan.target;
    tasks.push({ task: task.task, target: plan.target, audited: audited.length, agree, low: interval.low, high: interval.high, pass, missing });
    if (!pass) continue;
    const disagree = new Set(task.disagree);
    for (const item of sample.items.slice(0, task.n)) {
      const answer = answerOf(item.subject);
      if (disagree.has(item.subject) || (answer !== undefined && answer !== agreedOf(item.subject))) {
        truth.push({ subject: item.subject, task: task.task, label: answer ?? "", by: "person" });
      } else {
        truth.push({ subject: item.subject, task: task.task, label: agreedOf(item.subject), by: "drafts" });
      }
    }
  }
  const checked = answers.filter((answer) => answer.sentence !== undefined);
  return { seed: sample.seed, tasks, sentence: { checked: checked.length, right: checked.filter((answer) => answer.sentence === "right").length }, truth };
}
