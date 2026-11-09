# The labeled sample of functions

This folder holds the hand-labeled sample of Layer 2. `docs/SCHEMA.md` gives the label sets and the rules of the drafts and the audit. These files and rules are fixed before the first draft.

| File | What it holds |
| --- | --- |
| `sample.json` | The draw: 130 functions of 7,473, with the seed, the rule, the size of each task and the audit size. |
| `homes.json` | The map of homes of `@mark1russell7/conventions` 0.15.0 (`conventions map --json`). The task `home` labels an area of this map. |
| `draft-a.jsonl`, `draft-b.jsonl` | The two blind drafts of the 130 items: the area, the category and the sentence of each. |
| `rater-c.jsonl` | A third blind model rater of the 97 items of the audit: the home, the category and a verdict on the sentence. It is not a person. |
| `owners-1.jsonl` | The verdicts of the owners of the copies on 50 moves of `moves-1.md`, each with its reason. |
| `missed-1.jsonl` | The copies that the owners found and the atlas did not list. |
| `members-1.jsonl` | The other copies of each clone class of the subset, with their moves, and the owner verdict of each `pr` move. The lists named only one copy of each class. |
| `planned-1.jsonl`, `planned-2.jsonl` | The owner verdicts of the planned pairs of CA5, round 1 and round 2. |
| `owner-homes-1.jsonl` | The home of each of the 50 functions with an owner verdict, from that verdict. It is a labeled sample for CA12. |
| `pilot-1.jsonl` | The labels of the first pilot of Layer 2 (CA13): 172 functions of `otel-ts`, `page-lifecycle-tracker` and `ste-lint`, from one blind model. |

The command `codeatlas sample` wrote `sample.json` from the catalog of the CI run 42455568174, at the commit `1b710df` of this repository. The function of an item is at its `repo`, `commit`, `path` and lines `line` to `endLine`.

The drafts and the audit add their labels to this folder, one file for each source. No person labeled the sample. Thus `codeatlas reference` makes a provisional reference from the facts and the three raters (`docs/SCHEMA.md`, the provisional reference).

## The first pilot of Layer 2

The pilot labels each function of three repositories with the population rule of the sample. The rule is: exported, not a test, 40 nodes or more, and one item for each renamed hash.

- The model came from a test on the first 40 items of the sample. Two models labeled the same 40 items with the same input.
- The larger model had 6 home hits that the small model did not have. The small model had 1 such hit. Thus the pilot uses the larger model.
- On the 40 items, the precision of the model is 90.0 % for the home, from 76.9 % to 96.0 %. For the purpose it is 92.5 %, from 80.1 % to 97.4 %. Both are against the 3-rater majority, provisional, with the Wilson 95 % interval.
- The cost: 216,583 tokens for 4,303 lines of functions in two batches. This is 50,300 tokens for each 1000 lines. A batch of 100 items costs 41,500 tokens for each 1000 lines.
- Facts settle the home of 2 of the 172 items. The model labels most of the other items `none` or the area of the repository.
- The labels propose 26 moves. 20 of them go to homes that are planned and not made: `text`, `cli` and `test-generation`. Thus they are not pull requests yet. The owners of the homes review the other 6.

## The first run on the functions with copies or shared names

`subset-1.jsonl` has the labels of 999 functions. Each function is in a clone class with 2 or more copies, or it has a name that 2 or more packages share. One model labeled them in 10 batches. The 40 check items of the sample were in the first batch. The check items are not in the file.

- The cost was 1,290,881 tokens for 25,076 lines.
- On the 40 check items, the home precision was 0.900 [0.769, 0.960] and the purpose precision was 0.875 [0.739, 0.945]. This precision is against the 3-rater majority and it is provisional.
- `moveOf` gives 154 pull requests, 127 moves to planned homes, 13 moves that the dependency rules block, and 705 cases with no move.
- Three of the blocked moves (`canonicalJson` two times, `stableStringify`) have a home now: `@mark1russell7/rigor-generators` 0.1.7. Thus the file has 157 pull requests and 10 blocked moves.
- That was 12.2 pull requests for each 100k tokens. The owners of the copies then checked the moves, and the precision of the raters did not hold.
- The owner precision: the owners checked 50 of the 157 moves with a test or a read of the home. 8 were right: 0.160 [0.083, 0.285]. 2 more were right in part, 4 are right after a change of the home, and 4 are real copies with another home. 32 were wrong. `owners-1.jsonl` has each verdict with its reason.
- The precision of the 3 raters (0.900) and the owner precision measure different things. A rater sees only the function. An owner sees the home too. Report both, each with its count.
- A cause of the wrong moves: some functions call a function of the home for the general part, and the rest is local policy. 8 of the 157 do so. All 6 of them with a verdict were wrong. `moveOf` now gives them the kind `uses the home`, and no pull request.
- A first rule took off each function in a file that imports the home: 21 functions. The owner of 6 of them found full local copies. An import alone is not a use, so the rule now reads the calls of the body.
- Thus the file has 149 pull requests, 8 functions that use the home, and 10 blocked moves. The owners checked 44 of the 149, and 8 were right: 0.182 [0.095, 0.320].
- The map of homes has two new planned areas: `files` (`mark1russell7/files`) and `plain-text` (`mark1russell7/text`). Thus 6 blocked moves go to them as planned moves, with the field `relabel`. The file has 133 planned moves and 4 blocked moves.
- The 4 blocked moves are `commitOf`, two `stopTree` functions and `writeZip`. Their home is a package of the monorepo, so the dependency rule still blocks them. Each has the reason in the field `reason`. No home has a plain layer for commands, git and process trees yet.
- At that precision, about 27 of the 149 are right, from 14 to 48. That is about 2.1 correct pull requests for each 100k tokens.
- The owner recall: the owners found 7 copies that the atlas did not list. The field `cause` of `missed-1.jsonl` gives the cause of each miss.
- `inline` (5): a formula inside a larger function, with no function of its own. Layer 1 hashes functions, so it does not see them.
- `listing` (1): the subset keeps one item of each clone class. The moves list named only that item, so the other copy of the class reached no owner.
- `unique` (1): a copy with a unique name and unique hashes. The subset rule needs a clone class or a shared name, so it does not see such a copy.
- Of the 15 real copies that the owners moved, the atlas listed 8: 0.533 [0.301, 0.752]. This recall is only for the code of the owners that answered.
- `moves-1.md` lists the 149 moves by repository. The owner of each copy checks each move with a test before a pull request.
- The labels have a text kind. There are 157 plain string helpers in 25 repositories, 12 Markdown parsers, 7 text measurement functions and 3 functions for English word forms.
- No two of the 157 plain string helpers have the same shape. Thus 157 is a count by purpose, not a count of clones.

## The owner sample for CA12

The owners of the copies are the agents that keep each repository. They read the home and test the behavior. Thus their verdicts give a labeled sample of the task `home`. `owner-homes-1.jsonl` has this sample.

- The rule: a verdict `right`, `partial` or `later` keeps the area of the model. `wrong-home` gives the other area of the reason. `wrong` gives the home `none`.
- The model labeled the home of 14 of the 50 correctly: 0.280 [0.175, 0.417]. The move precision is lower (0.160), because a correct area can wait for its home.
- 32 of the 50 have the home `none`. The model sees a general helper. The owner sees local policy that the home does not cover.
- The sample is not random. It has only functions with a proposed move. Thus it measures the precision of the moves, not the recall.
- No person labeled it. The owners are agents with tests, so it is better evidence than a blind rater, but it is not a human truth set.
- `raterOfText` reads the file as a rater, with the field `home` of each line.

## Gaps of the map

A gap is code with no allowed home. The pilot found these gaps:

- File helpers for general packages. The home of file helpers is `@procedures/fs`, in the `client` monorepo. A general package must not use it. Thus the four file helpers of `ste-lint` (`resolvePath`, `findConfigFile`, `globBase`, `findFiles`) stay in `ste-lint`, with the home `none`.
- JSON, glob and process helpers for general packages. `moveOf` blocks 10 moves to `system-io` from general packages. Examples are `globToRegExp`, `stopTree` and `packageFolders`.

## The planned pairs (CA5)

`planned-1.jsonl` has the owner verdicts of the 10 pairs of two open plans with the highest scores. The scores came from the catalog of 2026-11-08.

- The question to the owners of the two items: merge, split or keep. A split is one shared part and two local parts.
- A pair is right when both owners give merge or split. A pair is a negative label when both owners give keep.
- 4 of the 10 pairs are right, all splits: 0.400 [0.168, 0.687]. The 6 others are keeps, with no dispute.
- In each split, the shared part goes to a home: the rigor bench harness two times, `site-pages` one time and the packing engine one time.
- The scorer uses no model tokens. The owners used tokens for the verdicts, but the atlas does not count them.
- A keep pair shares a rule or a general word, for example `typed-scripts`, `model` or `api`. The words of the rule have a home already, so the two items do different work.
- `split if` is a split that depends on a fact. In `CA5-P8` the other owner gave the fact, so the pair is a keep.
- The filter `explained` comes from these keeps. A pair is explained when one rule or one home has each of its shared words.
- On the 10 pairs, the filter explains 5 of the 6 keeps and none of the 4 splits. The 10 pairs made the filter, so this is not an independent test.
- Of the 36 other pairs of two open plans, the filter explains 5. The 31 others go to their owners.

### Round 2

`planned-2.jsonl` has the owner verdicts of the 31 other pairs of two open plans.

- 13 pairs are right, all splits: 0.419 [0.264, 0.592]. 18 are keeps. With round 1, 17 of 41 are right: 0.415.
- In 3 pairs the two owners did not agree. The field `tieBreak` gives the verdict of a maintainer or of this repository, with the reason.
- The shared parts go to the rigor bench harness, `rigor-statistics`, `strategy-space`, `layout-contract` and `site-pages`.
- In 9 of the 13 splits, a home already had the shared part, or a part of it. The owners did not know this.
- Thus the field `homeHas` of `planned/4` names the modules of a home with shared words of the pair.
- A module counts when its path and its exported names have 2 or more shared words, and its path has 1 or more.
- For 5 of the 9 splits, the right module is in the first 3 of `homeHas`. The 4 splits with a new part get no module.
- `homeHas` does not find a module that has only one shared word, for example the explorer of `site-pages` for `CA5-P19`.
- After round 2, the owner of `vex` changed `CA5-P40` from keep to split. Thus round 2 has 14 splits: 0.452 [0.292, 0.622]. Both rounds have 18 of 41: 0.439 [0.299, 0.590].

### The precision of `homeHas`

`homehas-1.jsonl` has a label for each of the 47 modules that `homeHas` gives for 19 pairs. The two owners of each pair read each module at the current `main`.

- The question: does the module have a part that both items need? The answer is right, wrong or no part. A label is right or wrong, and no part counts as wrong.
- In 14 hits the two owners did not agree. Then the owner of the repository of the module decides. The field `tieBreak` gives the reason.
- In 6 of the 14 tie-breaks, the owner of the module was also an owner of the pair. The field `party` marks them.

| Measure | Count | Rate and Wilson interval |
| --- | --- | --- |
| Each hit is right | 17 of 47 | 0.362 [0.240, 0.505] |
| The first hit of a pair is right | 6 of 19 | 0.316 [0.154, 0.540] |
| A pair has 1 or more right hits | 13 of 19 | 0.684 [0.460, 0.846] |
| A split has a right hit | 9 of 18 | 0.500 [0.290, 0.710] |
| A split with a module that an owner names has a right hit | 9 of 11 | 0.818 [0.523, 0.949] |

- If the 6 party tie-breaks go the other way, the hit precision is between 13 of 47 (0.277) and 19 of 47 (0.404).
- Thus a hit is a lead to read, not a fact. The first hit is not better than the others, so the order of the hits is weak.
- Most right hits have specific words, for example `arm`, `order`, `sobol`, `probe` or `budget`. Most wrong hits have only general words, for example `model`, `run`, `route` or `data`.
- A hit in a repository of the pair is right 11 of 20 times. A hit in a third repository is right 6 of 27 times.
- In 4 of 8 keep pairs, a module of a home has a part that both items need. The owners keep the plans, but each plan can use that module.
- The owners name modules that `homeHas` misses: `check/measure.ts` of `site-pages` for `CA5-P1`, its explorer for `CA5-P19`, and the field `supports` of `strategy-space.ts` in `layout-contract` for `CA5-P25`.
- The owners also name `countOperators` of the package `strategy-space` for `CA5-P14` and `CA5-P37`. The homes list of `conventions` 0.38.3 does not have that package, so `homeHas` does not read it.
- With `conventions` 0.38.4, the homes list has `strategy-space`. A rerun on the stored titles finds `operators.ts` as the second hit of `CA5-P37`.
- `CA5-P14` shares only the word `operators` with that module, so the rule of 2 shared words does not match it.

### Two changes of the order that the labels do not support

We tried two changes of `homeHas` on the 47 labels. Neither change is in the code, because the gain is in the noise.

- A hit in a repository of the pair goes first: the first hit is right for 7 of 19 pairs, not 6 of 19.
- A hit must have a specific word: a stem in 20 or fewer of the 2,289 home modules. Then 10 of 21 hits are right, 0.476 [0.283, 0.676]. But 5 pairs lose all their right hits.
- At 30 or fewer modules, 12 of 34 hits are right, 0.353 [0.215, 0.521]. That is the same as no rule.
- The labels give the rule its limit. Thus the rates are in-sample, and a new sample is necessary to test the rule.
- `homeHas` stays as it is: it gives 3 leads for the owners to read.
- There is no new round of labels. Each owner answer from the normal work goes into `homehas-1.jsonl` with the same fields.
- At about 100 labels, we test the two changes again on the new labels only.

## The owner verdicts of the class members (CA14)

The field `owner` of `members-1.jsonl` has the verdict of the owner of each of the 26 `pr` moves.

- 18 are moves to the home of the atlas: 0.692 [0.500, 0.835].
- 4 are a right merge with the wrong home. The writers of a corpus manifest go to `layout-contract`, not `rigor-generators`.
- 3 are keeps, and 1 is wrong: a frozen copy that a test uses as the oracle of the home.
- Thus 22 of the 26 are real copies: 0.846 [0.665, 0.938].
- The owners found 4 more copies of the manifest writer with a different shape. They are near copies, for CA6.
