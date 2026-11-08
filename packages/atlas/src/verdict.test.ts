import { describe, expect, it } from "vitest";
import { agreementOf, type DraftLabel } from "./agreement.ts";
import type { SampleFile, SampleItem } from "./sample.ts";
import { verdictOf, type PersonAnswer } from "./verdict.ts";

const item = (k: number): SampleItem => ({ subject: `s${k}`, repo: "r", commit: null, path: "a.ts", name: `f${k}`, line: 1, endLine: 2, nodes: 50, copies: 1 });
/** A sample of 40 items. The task home reads all of them and audits 30 agreed items. The task purpose reads 20 and audits 10. */
const sample: SampleFile = {
  version: "sample/1",
  seed: "test",
  rule: "test",
  tasks: [
    { task: "home", target: 0.8, expected: 0.95, n: 40, audit: 30 },
    { task: "purpose", target: 0.7, expected: 0.92, n: 20, audit: 10 },
  ],
  audit: 30,
  population: 40,
  size: 40,
  items: Array.from({ length: 40 }, (_, k) => item(k)),
};
const a: DraftLabel[] = sample.items.map((_, k) => ({ subject: `s${k}`, area: k % 2 === 0 ? "statistics" : "none", category: k % 3 === 0 ? "compute" : "parse", sentence: "" }));
const b: DraftLabel[] = a.map((l) => (l.subject === "s1" ? { ...l, area: "random", category: "other" } : l));
const agreement = agreementOf(sample, a, b, 100);
const label = (subject: string): DraftLabel => a.find((l) => l.subject === subject) as DraftLabel;

/** Each answer of the person: the agreed label, the label `random` for the disagreement s1, and a sentence. */
function answers(wrongHome: readonly string[] = []): PersonAnswer[] {
  return agreement.person.map((subject) => ({
    subject,
    home: subject === "s1" ? "random" : wrongHome.includes(subject) ? "layout" : label(subject).area,
    purpose: subject === "s1" ? "parse" : label(subject).category,
    sentence: subject === "s2" ? "wrong" : "right",
  }));
}

describe("verdictOf", () => {
  it("passes a task when the person agrees with each audited item, and the agreed drafts are its truth", () => {
    const verdict = verdictOf(sample, a, agreement, answers());
    const home = verdict.tasks.find((t) => t.task === "home");
    expect(home).toMatchObject({ audited: 30, agree: 30, pass: true, missing: [] });
    expect(home?.low).toBeGreaterThan(0.8);
    const truth = verdict.truth.filter((t) => t.task === "home");
    expect(truth).toHaveLength(40);
    expect(truth.find((t) => t.subject === "s1")).toEqual({ subject: "s1", task: "home", label: "random", by: "person" });
    expect(truth.filter((t) => t.by === "drafts")).toHaveLength(39);
    expect(verdict.truth.filter((t) => t.task === "purpose")).toHaveLength(20);
    expect(verdict.sentence.right).toBe(verdict.sentence.checked - (agreement.person.includes("s2") ? 1 : 0));
  });

  it("fails a task when the person rejects too many agreed labels, and gives it no truth", () => {
    const home = agreement.tasks.find((t) => t.task === "home");
    const verdict = verdictOf(sample, a, agreement, answers(home?.audit.slice(0, 5)));
    expect(verdict.tasks.find((t) => t.task === "home")).toMatchObject({ agree: 25, pass: false });
    expect(verdict.truth.some((t) => t.task === "home")).toBe(false);
    expect(verdict.tasks.find((t) => t.task === "purpose")?.pass).toBe(true);
  });

  it("does not pass a task with a missing answer", () => {
    const verdict = verdictOf(sample, a, agreement, answers().filter((x) => x.subject !== "s1"));
    expect(verdict.tasks.find((t) => t.task === "home")).toMatchObject({ pass: false, missing: ["s1"] });
  });
});
