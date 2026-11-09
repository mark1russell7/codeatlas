# Roadmap

This file lists the items of the roadmap of this repository. The status page of the site reads it.

The goal: a catalog of all code of all repositories in one database, as an algebra. Questions about quality, features and duplication are then queries. [SCHEMA.md](SCHEMA.md) gives the layers, the keys and the relations.

## In progress

| ID | Status | Priority | Title |
| --- | --- | --- | --- |
| CA15 | in progress: the formula skeletons are in Layer 1. The first 30 leads have two precisions: real copies 24 of 30 (lower bound 0.63, gate 0.5), the right home 7 of 24 (0.15, gate 0.25). They decide on 11-16 | P2 | Layer 2 fan-out over all public repositories, after the formula skeletons |
| CA20 | in progress: 14 dimensions are built. 10 of them passed the precision check against ESLint, SonarJS, git and the TypeScript compiler, with the size in tokens and the fan-out. The catalog page shows the gap of each other dimension, target 11-16 | P1 | A catalog of dimensions as data: the definition, the extractor, the unit and the measured precision of each. The first 10 come from the parser |
| CA19 | in progress: 10 of 43 repositories have a function report on `main`. The coverage report gives the cause of each other repository, target 11-16 | P2 | Coverage everywhere: a function report (`coverage-final.json`) on `main` for each repository with `@vitest/coverage-v8` |

## Next

| ID | Status | Priority | Title |
| --- | --- | --- | --- |
| CA21 | next: target 11-20 | P1 | The index on each push: a push to `main` scans the changed files again, so new code is in the catalog on the same day |
| CA22 | next: target 11-20 | P1 | Findings as issues: one issue for each finding, with a stable key, an update, a close and an owner verdict |
| CA18 | next: target 11-23 | P1 | The ratchet: a new function over the limit fails CI, and the total of a repository cannot rise |
| CA25 | next | P1 | The fan-in passes its precision check: the TypeScript compiler finds the declaration of each call, so a count is not by name |
| CA26 | next: after CA19 | P2 | The coverage passes a precision check: the tests of a sample run again with coverage, and the hits agree with the report |
| CA27 | next: after CA26 | P2 | The hotspot counts when its three parts count, and the ratchet uses it |

## Later

| ID | Status | Priority | Title |
| --- | --- | --- | --- |
| CA23 | later: first entry 11-30 | P2 | The automation ledger: each month, the judgment task with the most volume goes into the parser |
| CA12 | later: an owner sample of 50 gives a home precision of 0.28, a human sample is next | P1 | A hand-labeled sample, for the precision and recall of each judgment category |
| CA6 | later | P3 | Near copies: functions with one shape after small edits (type-3 clones) |

## Done

| ID | Status | Priority | Title |
| --- | --- | --- | --- |
| CA24 | done 2026-11-09 | P1 | The fan-out passes its precision check: 194 of 200 agree with `typescript-eslint` |
| CA11 | done 2026-11-09 | P2 | Layer 1, more sources: coverage from the CI artifacts, dependency versions, template drift, conventions breaks |
| CA4 | done 2026-11-08 | P2 | The private repositories: a local scan into a separate private database, on this machine only |
| CA5 | done 2026-11-08 | P2 | Planned duplication: 18 of 41 pairs are right (0.44) and 17 of 47 `homeHas` hits are right (0.36), so both give leads to read |
| CA14 | done 2026-11-08 | P1 | Layer 2 on 999 functions with copies or shared names: 149 moves to check, owner precision 0.16 and owner recall 0.50 |
| CA13 | done 2026-11-08 | P1 | Layer 2 pilot on 3 repositories: 50,300 tokens for each 1000 lines, and the precision against the 3-rater majority, provisional |
| CA16 | done 2026-11-08 | P2 | Tools for agents: query the catalog and scan again, fast and cheap |
| CA3 | done 2026-11-08 | P2 | The rigor candidates: for each topic, the classes that a shared library removes |
| CA17 | done 2026-11-08 | P1 | The query set on the site: quality, features and duplication |
| CA2 | done 2026-11-08 | P2 | The trend: the catalog of each week as history, by repository |
| CA10 | done 2026-11-08 | P1 | Layer 3: the algebra, a SQLite schema with a typed query layer |
| CA9 | done 2026-11-08 | P1 | Layer 1 in CI over all public repositories, into one SQLite database |
| CA8 | done 2026-11-08 | P1 | Layer 1: a parser scan of each file, with no model tokens |
| CA7 | done 2026-11-08 | P0 | Phase 0: count the corpus and write the schema of the catalog |
| CA1 | done 2026-11-05 | P1 | The site: the atlas as a page to explore, built each week |
