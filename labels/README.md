# The labeled sample of functions

This folder holds the hand-labeled sample of Layer 2. `docs/SCHEMA.md` gives the label sets and the rules of the drafts and the audit. These files and rules are fixed before the first draft.

| File | What it holds |
| --- | --- |
| `sample.json` | The draw: 130 functions of 7,473, with the seed, the rule, the size of each task and the audit size. |
| `homes.json` | The map of homes of `@mark1russell7/conventions` 0.15.0 (`conventions map --json`). The task `home` labels an area of this map. |
| `draft-a.jsonl`, `draft-b.jsonl` | The two blind drafts of the 130 items: the area, the category and the sentence of each. |
| `rater-c.jsonl` | A third blind model rater of the 97 items of the audit: the home, the category and a verdict on the sentence. It is not a person. |
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
- That is 11.9 pull requests for each 100k tokens. At a precision of 0.9, about 10.7 of them are correct.
- `moves-1.md` lists the 154 moves by repository. The owner of each copy checks each move with a test before a pull request.
- The labels have a text kind. There are 157 plain string helpers in 25 repositories, 12 Markdown parsers, 7 text measurement functions and 3 functions for English word forms.

## Gaps of the map

A gap is code with no allowed home. The pilot found these gaps:

- File helpers for general packages. The home of file helpers is `@procedures/fs`, in the `client` monorepo. A general package must not use it. Thus the four file helpers of `ste-lint` (`resolvePath`, `findConfigFile`, `globBase`, `findFiles`) stay in `ste-lint`, with the home `none`.
- JSON, glob and process helpers for general packages. `moveOf` blocks 13 moves to `system-io` from general packages. Examples are `canonicalJson`, `stableStringify`, `globToRegExp` and `stopTree`.
