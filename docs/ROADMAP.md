# Roadmap

This file lists the items of the roadmap of this repository. The status page of the site reads it.

The goal: a catalog of all code of all repositories in one database, as an algebra. Questions about quality, features and duplication are then queries. [SCHEMA.md](SCHEMA.md) gives the layers, the keys and the relations.

## In progress

| ID | Status | Priority | Title |
| --- | --- | --- | --- |
| CA11 | in progress | P2 | Layer 1, more sources: coverage, dependency versions, template drift, conventions breaks |
| CA4 | in progress | P2 | The private repositories: a local scan into a separate private database |

## Next

| ID | Status | Priority | Title |
| --- | --- | --- | --- |

## Later

| ID | Status | Priority | Title |
| --- | --- | --- | --- |
| CA15 | later | P2 | Layer 2 fan-out over all public repositories |
| CA18 | later | P2 | Gates: freshness of each repository, cost per 1000 lines, precision of each category |
| CA12 | later: a third blind model agrees, a human sample is next | P1 | A hand-labeled sample, for the precision and recall of each judgment category |
| CA5 | later | P2 | Planned duplication: two roadmap items in two repositories that make the same thing |
| CA6 | later | P3 | Near copies: functions with one shape after small edits (type-3 clones) |

## Done

| ID | Status | Priority | Title |
| --- | --- | --- | --- |
| CA14 | done 2026-11-08 | P1 | Layer 2 on 999 functions with copies or shared names: 12.2 pull requests for each 100k tokens |
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
