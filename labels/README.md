# The labeled sample of functions

This folder holds the hand-labeled sample of Layer 2. `docs/SCHEMA.md` gives the label sets and the rules of the drafts and the audit. These files and rules are fixed before the first draft.

| File | What it holds |
| --- | --- |
| `sample.json` | The draw: 130 functions of 7,473, with the seed, the rule, the size of each task and the audit size. |
| `homes.json` | The map of homes of `@mark1russell7/conventions` 0.15.0 (`conventions map --json`). The task `home` labels an area of this map. |
| `draft-a.jsonl`, `draft-b.jsonl` | The two blind drafts of the 130 items: the area, the category and the sentence of each. |
| `rater-c.jsonl` | A third blind model rater of the 97 items of the audit: the home, the category and a verdict on the sentence. It is not a person. |

The command `codeatlas sample` wrote `sample.json` from the catalog of the CI run 42455568174, at the commit `1b710df` of this repository. The function of an item is at its `repo`, `commit`, `path` and lines `line` to `endLine`.

The drafts and the audit add their labels to this folder, one file for each source. No person labeled the sample. Thus `codeatlas reference` makes a provisional reference from the facts and the three raters (`docs/SCHEMA.md`, the provisional reference).
