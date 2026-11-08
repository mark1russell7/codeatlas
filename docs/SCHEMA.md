# The schema of the catalog

Status: reviewed, 2026-11-07. The review changes are in the section [Review](#review). Schema version: `codeatlas/2`.

The catalog keeps all code of all repositories in one database. Each fact is a row of a typed relation. Questions about quality, features and duplication are then queries of these relations.

This document gives the layers, the keys, the relations, the measures and their laws, and the gates. It is the base of the items of the scanner (Layer 1), the judgment of agents (Layer 2) and the query layer (Layer 3).

## Principles

1. **A parser does each part that it can.** Layer 1 uses no model tokens. An agent gives only a judgment that no parser can give.
2. **Each fact has a key that does not change.** The key of a fact of a file is the git blob id of the file. A git blob id is the hash of the file content, so the same file in two repositories or two commits has one key.
3. **The catalog computes nothing two times.** The scanner does not read a blob that the database has. The key of an agent result is its subject, its task and its prompt version. A new prompt version or a new file content starts a new result.
4. **Each measure has a definition and a law.** A law is a property that a test examines, for example "an exact clone pair is also a renamed clone pair".
5. **Each judgment has a measured precision.** A hand-labeled sample gives the precision and the recall of each category of Layer 2. A category without a sample does not go to the site.
6. **One input gives one output.** The scanner sorts each list, so two scans of one commit give the same bytes.

## Layers

| Layer | What it does | Cost | Key of its facts | When it starts again |
| --- | --- | --- | --- | --- |
| 1a, syntax | The TypeScript parser reads one file and writes its declarations, imports, exports, call sites, shapes, measures and markers. | CPU only. No install of dependencies. | `(blob, scanner version)` | For a new blob, or a new scanner version. |
| 1b, program | The TypeScript type checker reads a package with its installed dependencies. It finds the target of each import and each method use, and it writes signatures with their types. | CPU and an install for each repository. | `(snapshot, scanner version)` | For a new commit of the repository. |
| 1c, outside sources | CI artifacts, lockfiles, roadmaps and the template give coverage, dependency versions, plans, template drift and conventions breaks. | Small. | `(snapshot, source)` | For a new commit or a new CI run. |
| 2, judgment | An agent gives the purpose of a function, the features of a package, the home of a helper and findings that need judgment. | Model tokens. | `(subject, task, prompt version, model)` | For a new subject content or a new prompt version. |
| 3, algebra | Typed queries over the relations of layers 1 and 2, and the measures of the site. | Small. | Not stored. A query is a function of the relations. | Each build of the site. |

Layer 1a is the bulk of the facts and its cache is perfect: a blob does not change. Layer 1b costs more, so it operates only on repositories whose commit changed. Layer 1a resolves most call sites without 1b: a call site of an imported name goes to the file of the import.

## Keys

| Key | Form | Example |
| --- | --- | --- |
| Blob | The git blob id of the file, 40 hex characters. `git ls-tree -r` gives it with no read of the file. | `3b18e512dba79e4c8300dd08aeb37f8e728b8dad` |
| Snapshot | `<repo>@<commit>` | `packing@0933cc0d…` |
| Symbol | `<blob>#<path in the file>`. The path is the chain of the names of the declarations that hold the symbol, with an ordinal for each anonymous one. | `3b18e5…#Shelf.place`, `3b18e5…#default/arrow[2]` |
| Package | `<snapshot>/<folder of package.json>` | `packing@0933cc0d…/packages/core` |
| Lineage | `(repo, path, qualified name)` | `(packing, src/shelf.ts, Shelf.place)` |
| Finding | The hash of `(subject, category, rule, source)` | |
| Judgment of a function | `(hash_renamed, task, prompt version, model)` | `(9f2c41…, purpose+home, purpose-home/1, <model id>)` |
| Judgment of another subject | `(subject, task, prompt version, model)` | `(packing@0933cc0d…/packages/core, features, features/1, <model id>)` |

A symbol key does not change when the file moves or when another file changes. It changes only when its own file changes.

The lineage key follows one function over commits: its repository, its path and its qualified name. A symbol key changes at each edit of its file, but its lineage key stays. The trend reads the lineage key. A move or a rename of the function starts a new lineage.

The key of a judgment of a function is its `hash_renamed`, not its symbol key. Each copy of a `renamed` class then reuses one judgment, and an edit that keeps the hash pays nothing.

## Entities

### `repo`

| Column | Type | Meaning |
| --- | --- | --- |
| `name` | text, key | The name of the repository on GitHub. |
| `owner` | text | The owner on GitHub. |
| `visibility` | `public` or `private` | A private repository goes only to the private database. |
| `archived`, `fork` | boolean | The scan reads no archived repository and no fork by default. |
| `default_branch` | text | |

### `snapshot`

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | text, key | `<repo>@<commit>` |
| `repo` | text | |
| `commit` | text | |
| `committed_at` | time | The time of the commit. |
| `scanned_at` | time | The time of the scan. |
| `scanner` | text | The version of the scanner. |

### `blob`

| Column | Type | Meaning |
| --- | --- | --- |
| `oid` | text, key | The git blob id. |
| `bytes`, `lines`, `non_blank` | integer | The size. A binary blob has no lines. |
| `language` | text | `ts`, `tsx`, `js`, `jsx`, `json`, `md` and the other kinds of the corpus. |
| `parse_error` | text or null | The first line of the error of the parser. |

### `file`

A file is one place of a blob in a snapshot. The kind of a file tells if it is a test. One blob can be a test in one path and a source in another, so a symbol has no test column.

| Column | Type | Meaning |
| --- | --- | --- |
| `snapshot`, `path` | text, key | |
| `blob` | text | |
| `kind` | text | The kind of the corpus: `source`, `test`, `declaration`, `generated`, `bundle`, `skipped-path`, `lockfile` and the other kinds. |
| `package` | text or null | The package that holds the file. |

### `package`

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | text, key | `<snapshot>/<folder>` |
| `name`, `version` | text | From `package.json`. |
| `private` | boolean | |
| `entry` | text | `main` or the root entry of `exports`. |

### `symbol`

A declaration of a file: a function, a method, a class, a variable, a type, an interface, an enum or a namespace.

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | text, key | `<blob>#<path>` |
| `blob` | text | |
| `name` | text | The name, or the name of the variable or the property that holds an anonymous function. |
| `kind` | text | `function`, `method`, `class`, `variable`, `type`, `interface`, `enum`, `namespace` |
| `parent` | text or null | The symbol that holds this one. |
| `qualified_name` | text | The chain of the names, as in the key. With the repository and the path of a file, it is the lineage key. |
| `line`, `end_line` | integer | |
| `exported` | boolean | An export of its file. |
| `async`, `generator` | boolean | |
| `params` | integer | The number of parameters. |
| `signature` | text | The text of the signature, with the types as they are written. |
| `nodes` | integer | The size: the syntax nodes of the parameters and the body. |
| `hash_exact` | text | Refer to [Clone levels](#clone-levels). |
| `hash_renamed` | text | |
| `hash_shape` | text | The hash of the atlas of today (`codeatlas/1`). |
| `cyclomatic` | integer | The decision points plus one. |
| `depth` | integer | The deepest nesting of control statements: `if`, the loops, `switch` and `try`. |

### `export`

| Column | Type | Meaning |
| --- | --- | --- |
| `blob`, `name` | text, key | The exported name. |
| `symbol` | text or null | The symbol of the export, or null for a re-export. |
| `from` | text or null | The specifier of a re-export. |
| `type_only` | boolean | |

### `import`

| Column | Type | Meaning |
| --- | --- | --- |
| `blob`, `ordinal` | key | |
| `specifier` | text | As written. |
| `package` | text or null | The package name, or null for a relative import. |
| `kind` | text | `static`, `dynamic`, `type`, `re-export`, `require` |
| `names` | text list | The imported names, with `*` for a namespace import. |

### `call_site`

| Column | Type | Meaning |
| --- | --- | --- |
| `blob`, `ordinal` | key | |
| `caller` | text | The symbol that holds the call. |
| `callee` | text | The callee as written, for example `fs.readFileSync` or `mean`. |
| `line` | integer | |

### `type_shape`

For each interface and type alias: the hash of its members, with the names sorted and the types normalized. Two types with one hash are one structure with two names.

### `marker`

A debt marker of a file: `TODO`, `FIXME`, `HACK`, `XXX`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, an explicit `any`, `as unknown as`, and a non-null assertion. Each row has the blob, the line, the kind and the text of the comment.

### `dependency`

From each `package.json` and its lockfile: the package, the dependency name, the range, the resolved version, and the field (`dependencies`, `devDependencies`, `peerDependencies`). A `github:` or `workspace:` range is a value of its own.

- The table `manifest` has one row for each `package.json` of a snapshot: the path, the blob, the package name, the version, `private` and a parse error.
- The table `dependency` has the dependencies of each manifest blob: the field, the name, the range and the kind of the range (`rangeKind`).
- The view `current_manifest` gives the manifests of the current snapshots.
- The query `rangeDrift` gives each dependency with two registry ranges or more. The query `pinnedDependencies` gives each range that the registry does not resolve.
- The new tables do not change `CATALOG_SCHEMA`: a database of `codeatlas/2` gets them, and its blobs stay the cache.
- The table `lockfile` has one row for each `pnpm-lock.yaml` of a snapshot: the path, the blob, the lockfile version and a parse error.
- The table `resolution` has the resolved version of each dependency of each importer of a lockfile blob. The path of the manifest is from the folder of the lockfile.
- The query `versionDrift` gives each dependency that the current lockfiles resolve to two versions or more.
- A lockfile of npm (`package-lock.json`) is not read yet.

### `roadmap` and `roadmap_item`

The plans of each repository, from each `ROADMAP.md` that git keeps. The parse is `roadmapItems` of `@mark1russell7/site-pages`, the reader of the Status page of each site.

- The table `roadmap` has one row for each roadmap of a snapshot: the path, the blob and a parse error.
- The table `roadmap_item` has the items of each roadmap blob: the line, the ID, the title, the status, the class of the status, the section and the area.
- The views `current_roadmap` and `current_roadmap_item` give the roadmaps and the items of the current snapshots.
- The query `plannedDuplication` (CA5) gives each pair of items of two repositories with words in common. The score is the cosine of the TF-IDF vectors of the two titles.
- A pair of two done items is history, so the query does not give it. A pair with one done item tells that one plan can use the other.
- A title that names the repository of the other item is a plan that uses the other. Such a pair is not a copy.

### `template_pin`, `template_file`, `template_version`, `template_use` and `stamp_check`

The template makes a new repository with its stamp. The stamp copies the files of its list `KEEP` and pins each shared workflow and action to a commit of the template.

- The table `template_pin` has each `uses: mark1russell7/template/<path>@<ref>` line of the workflows and actions of a snapshot: the path, the line, the target and the ref.
- The table `template_file` has each file of `KEEP` that a snapshot has: the path, the blob and a hash of the text.
- The hash of a workflow is the hash of its parsed YAML, with sorted keys. Each pin gets the local form `uses: ./<path>`. A call of a shared workflow loses its `with` and `secrets`, and a step of a shared action loses its `with`. A job that runs only in the template goes.
- The table `stamp_check` has the commit of the template for each snapshot where `stamp --check` of the template gave a result. The table `stamp_check_file` has each file of `KEEP` that the stamp changes, with its state and the JSON fields that differ.
- The scan starts `node scripts/stamp/main.ts --check <repository> --ref <commit>` of the template checkout on each repository that pins the template. Thus the stamp applies its own rules for each file. The catalog job installs the packages of the template for it.
- The table `template_version` has the content of each ref that a repository pins, and of the commit of the template. It has the blob of each workflow and action of `.github/` and of each file of `KEEP`, and the commit time of the ref. The clone of the template has all of its history and no blobs.
- The table `template_ref` has each ref of `template_version` with its commit time and the count of the commits of the template after it, from `git rev-list --count`.
- The table `template_use` has each file that a shared workflow or action uses, through its `uses: ./.github/...` lines. A target uses itself.
- The scan reads `KEEP` from `scripts/stamp/stamp.ts` of the template checkout. Without the template in the scan, only the pins count.
- The query `templateDrift` gives each repository that pins the template. It gives each pin with a mark for the commit of the template, and each file of `KEEP` as `same`, `changed` or `missing`.
- The query `pinFreshness` gives the pin freshness. A repository uses its pinned workflows and actions, and the files that they use. It is current when each of these files is the same at each pin and at the commit of the template. Thus a pin to an old commit with no real change is current.
- The query `stampFreshness` gives the stamp freshness. A repository is current when `stamp --check` changes no file. A repository with no result of the check does not count.
- The query `pinLag` gives the lag of the oldest pin of each repository, in commits and in days behind the commit of the template, and the median of each. The share of `pinFreshness` falls at each new commit of the template, so it measures the activity of the template. The lag measures the delay of the repositories.
- For each repository that is not current, `pinFreshness` gives the files that differ and the age in days of the oldest pin with a change. The command `codeatlas drift` writes it, and the catalog job adds it to the summary.

### `conventions_check`, `conventions_rule` and `conventions_break`

The scan starts each rule of `@mark1russell7/conventions` on the checkout of each repository, with `runChecks` in the scan process.

- The table `conventions_check` has the version of the conventions for each snapshot with a result.
- The table `conventions_rule` has the status of each rule: `pass`, `break`, `off`, `skipped` or `error`. It also has the count of the ignored breaks, and the note of the rule.
- The table `conventions_break` has each break: the rule, the file, the line, the message, and a mark when `conventions fix` can write the fix.
- The environment of the rules is empty, so the variables of the CI job of the scan do not change them. The rules that examine a change have no base, so they skip.
- The clones of the scan have no install of their packages. Thus the rules of `INSTALL_RULES` skip with a note, because they only find the missing packages. Today this is `typed-files`.
- The version of the conventions is the version in the lockfile of codeatlas. A new rule comes into the catalog with an update of that version.
- The query `conventionsBreaks` gives the clean repositories, the breaks of each rule and the breaks of each repository. A repository is clean when it has no break and no rule throws.
- The command `codeatlas breaks` writes it, and the catalog job adds it to the summary. The tool `atlas.rescan` checks the repository again too.

### `home`

The areas of the map of homes, from `conventions map`: the area, its home packages, its home repository and its signatures.

### `feature` (Layer 2)

A capability of a package in plain words, for example "rectangle packing with the skyline strategy". Each row has the package, a name, a description and the judgment that made it.

### `finding`

A fact about a subject that tells of a problem or a risk.

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | text, key | |
| `subject` | text | A symbol, a file, a package or a snapshot. |
| `category` | text | Refer to [Categories](#categories). |
| `rule` | text | The rule inside the category, for example `shell-string`. |
| `source` | text | `layer1`, `conventions`, `ci` or `judgment`. |
| `severity` | text | `error`, `warning`, `note` |
| `evidence` | text | The line or the value that shows it. |
| `judgment` | text or null | The judgment that made it, for a finding of Layer 2. |

### `judgment` (Layer 2 cache)

| Column | Type | Meaning |
| --- | --- | --- |
| `subject`, `task`, `prompt`, `model` | key | For a function, `subject` is its `hash_renamed`. For a package or a file, it is the key of the package or the file. `prompt` is the version of the prompt. |
| `result` | JSON | The answer, in the schema of the task. |
| `input_tokens`, `output_tokens` | integer | The cost. |
| `at` | time | |

### `label` (the hand-labeled sample)

| Column | Type | Meaning |
| --- | --- | --- |
| `subject`, `task`, `by` | key | The `hash_renamed` of a function, the task, and the source of the label. |
| `label` | JSON | The answer of the source. |
| `at` | time | |

The sample file in the repository holds the draw: its seed, its rule, the size of each task and the items. The command `codeatlas sample` writes it from a catalog. Each source labels blind. Two drafts and an audit by a person give the true answer of each item, and the key keeps each source apart.

#### The label sets

These rules are fixed before the first draft. A change of a rule gives a new version of the label sets, and all drafts of the sample run again.

The task `home` labels the first `n` items of the sample, and the task `purpose` labels its first `n` items. The sample file gives each `n`.

A label of the task `home` is `{ "area": <id> }`. The id is the area of `conventions map` that covers the main job of the function. The function can be in that home now, or outside it. The id `none` tells that no area covers the job: the code belongs to its own repository. The labels file records the version of `@mark1russell7/conventions` that gave the map.

A label of the task `purpose` is `{ "category": <id>, "sentence": <text> }`. The sentence tells the purpose of the function in 25 words or fewer. The category is one of the 13 below. A function with two or more jobs gets the category of the reason that it exists: its main output.

| Category | Definition | Example |
| --- | --- | --- |
| `parse` | It makes structured values from text or bytes. | A function that reads a version string into its major, minor and patch numbers. |
| `format-text` | It makes text for a person or a file from values. | A function that writes the results as a Markdown table. |
| `validate` | It examines a value against rules, and reports or throws on a break. | A function that throws a `TypeError` when a stored record has no path. |
| `transform-data` | It changes the form of data in memory, with no domain calculation. | A function that groups the rows by repository and sorts each group. |
| `compute` | It calculates a value: numbers, geometry, statistics, hashes or an algorithm. | A function that gives a quantile, or the positions of the boxes of a layout. |
| `file-io` | It reads or writes files and folders. | A function that writes a JSON file atomically. |
| `process-io` | It starts processes, runs commands, or reads the environment of the process. | A function that runs `git log` and gives its lines. |
| `network-io` | It sends or receives data over a network: HTTP, WebSocket or a socket. | A function that fetches a page, with a retry on a timeout. |
| `state-control` | It controls state, time or order: state machines, queues, schedules, retries, events and life cycles. | A function that runs a loop with a backoff until a check passes. |
| `config-build` | It makes or reads the configuration, the build, the CI or the structure of a project. | A function that writes a `tsconfig.json` from presets. |
| `ui-render` | It makes or changes a user interface: DOM, SVG, canvas or terminal output. | A function that draws a chart as SVG elements. |
| `test-support` | Its job is a test: fixtures, fakes, input generators or assertions. | A fake shell that a test gives to the code under test. |
| `other` | No category above tells its job. | A function whose job is none of the above. |

The rule for `other`: if a draft puts more than 10% of the items of the task `purpose` in `other`, the list is not complete. The list then gets a new version, and both drafts run again before a reader sees the agreement.

#### The drafts and the audit

- Two drafts label each item blind. Each draft reads the items in its own order, and neither draft sees the other draft or a result.
- The agreement of the two drafts is Cohen's kappa of each task, with a bootstrap interval over the items. A confusion table shows each pair of labels that the drafts mix. Both come from `@mark1russell7/rigor-statistics`.
- A person labels each item where the drafts disagree, and a seeded audit of the agreed items (`auditOf`).
- The audit size of a task is `wilsonSampleSize` of its target and the expected agreement `AUDIT_EXPECTED` (0.97). The sample file keeps the largest.
- If the audit agrees with the drafts at a Wilson lower end at or above the target of the task, the agreed drafts are the truth. If not, the person labels each item of the task.
- The person also marks the sentence of each audited item as right or wrong. The site reports that share, and no gate reads it.
- The command `codeatlas verdict` reads the answers of the person and writes the verdict file (`verdictOf`). A task with a missing answer does not pass.
- The verdict file keeps the labels of the truth of each task that passes. An answer of the person replaces the label of the drafts.

#### The provisional reference

No person labels the sample. Thus the reference of Layer 2 comes from facts and from three blind raters, and each figure against it is provisional.

- A fact of Layer 1 settles a label first. For the home: the item has the renamed hash of an exported function of a home package, at another place. The item then has the area of that package. An item with copies in two areas gets no fact.
- Else the strict majority of the raters with a label of the item settles it, with two votes or more.
- An item with no fact and no majority is unknown. It is not a hit or a miss.
- The command `codeatlas reference` writes the reference (`referenceOf`) and the precision of each labeler against it (`precisionOf`).
- Each precision has the words "against the 3-rater majority, provisional" and a Wilson 95 % interval.
- The file also gives the share of the hits and misses that a fact settles, and the share that the raters settle.
- A move of code that a label proposes is a pull request to its home, and the owner of the home reviews it.
- A move also obeys the dependency rules (`moveOf`). A general package must not use a package of the `client` monorepo. Such a move is "blocked by the rule", not a pull request.
- A function whose body calls a function of the home gets the kind "uses the home", not a pull request. It uses the home for its general part, and its own part is local policy.
- The query `packageCallsOf` finds these calls. A call site is in the body when its caller is the function or a function inside it. An import that the body does not call is not a use.
- A move to a planned home goes to the gap list of that home, not to a pull request.
- The label sets keep a slot for a sample of a person. Then the verdict compares the raters with that sample.

The home rule: the logic of a function decides its home, not the package that holds it. The package of each file is a fact of Layer 1. Thus a label that copies the package cannot find code outside its home in a home package.

### `run` and `measure`

Each scan and each gate is a `run` (kind, commit, time, CI run link, CPU model). Each number of a run is a `measure` (run, name, value). The trend of the site reads these two relations.

## Relations

| Relation | From | To | Layer | Meaning |
| --- | --- | --- | --- | --- |
| `contains` | snapshot, package, file | file, symbol | 1a | The tree of the code. |
| `imports` | file | file or package | 1a, 1b | A resolved import. 1a resolves relative paths, and it maps a package name to a package of the catalog through the `exports` of its `package.json`, with no install. 1b resolves the paths of `tsconfig` and the chains of re-exports. |
| `calls` | symbol | symbol | 1a, 1b | A resolved call. 1a resolves a call of an imported or a local name. 1b resolves a method call with the types. |
| `clones` | symbol | symbol | 3 | Two symbols with one hash at one level, of 40 nodes or more. |
| `tests` | test symbol or test file | symbol or file | 1a, 1c | The test imports the subject or has a call site of it, or the coverage of the test reaches it. |
| `implements` | symbol | feature | 2 | |
| `belongs_to` | symbol | home | 1a, 2 | The symbol is a copy of a function of a home. 1a gives it from the signatures of the map. 2 gives it from the purpose. |
| `depends_on` | package | package | 1a | A dependency of `package.json`, resolved to a package of the catalog where one exists. |
| `drifts_from` | file | template file | 1c | The file differs from its copy in the template. |

## Clone levels

The levels make a chain. Each level forgets more than the level before it.

| Level | The hash reads | It forgets |
| --- | --- | --- |
| `exact` | The tokens of the function. | Spaces, line breaks and comments. |
| `renamed` | The tokens, with each identifier replaced by the index of its first use in the function, and each literal replaced by its kind. | The names and the values. One name stays one index, so `a + a` and `a + b` differ. |
| `shape` | The sequence of the syntax node types. | All names, all values and all types. This is the hash of `codeatlas/1`. |
| `purpose` (Layer 2) | The purpose that an agent gives. | The code. Two functions with one purpose and two shapes are a clone of purpose. |

**Law of the chain.** If two symbols have one `exact` hash, they have one `renamed` hash. If they have one `renamed` hash, they have one `shape` hash. A property test examines this law over generated functions.

## Categories

Each category is a set of rules. The column "Layer" tells which layer finds it.

| Category | Rules (first set) | Layer |
| --- | --- | --- |
| Duplication | exact, renamed, shape and purpose clones, one structure with two type names | 1a, 2 |
| Code outside its home | a copy of a function of a home, a local helper of an area that has a home | 1a, 2 |
| Features | the capabilities of each package | 2 |
| Public API | exports with no test, exports with no user, a change of a signature between two snapshots (break risk) | 1a, 1b |
| Tests | test kinds (unit, property, metamorphic, end-to-end, bench), exports with no test, coverage gaps | 1a, 1c |
| Gates | each gate of CI and the source of its limit (a number from runs, or a number with no source) | 1c, 2 |
| Security | a shell command as one string, a regular expression that can take exponential time, a path that can leave its folder, a secret in the code | 1a |
| Leaks | a private name in a public repository (refer to [Private names](#private-names)) | 1a |
| Async and performance | a promise with no `await` and no handler, `await` in a loop, a sync file call in a server path | 1a, 1b |
| Debt | the markers, a function above a limit of size or of decision points, a dead export | 1a, 1b |
| Prose | a doc comment or a README that breaks a rule of STE | 1c |
| Numbers with no source | a numeric limit or a constant of a gate with no comment or link that gives its source | 1a, 2 |
| Dependencies | one purpose with two packages, a `github:` range, versions of one package that differ between repositories | 1a, 1c |
| Template drift | a file of the template that differs or is missing | 1c |

A new category gets a rule set, a layer, and, for Layer 2, a labeled sample before it goes to the site.

## Measures and their laws

A measure is a function of the relations. Each one has a definition and one or more laws that a test examines.

| Measure | Definition | Laws |
| --- | --- | --- |
| Duplicated nodes of a class | `nodes × (copies − 1)` | 0 for a class of one copy. |
| Duplicated nodes of a level | The sum over the classes of the level that no larger class of the same level holds. | Monotone in the chain: `exact ≤ renamed ≤ shape`. |
| Duplication ratio | Duplicated nodes divided by the nodes of the top functions. | Between 0 and 1. |
| Reach of a symbol | The symbols at the end of its `calls` chains, at any depth. | The transitive closure of `calls`. A symbol reaches each symbol that its callees reach. |
| Users of an export | The files of other packages that import it. | 0 users and no test gives a dead export. Until 1b exists, the measure is a 1a bound: a re-export chain can hide a user. |
| Test gap | The exports with no `tests` relation. | A subset of the exports. |
| Freshness of a repository | The time from its newest commit to its newest scan. | 0 or more. A gate limits it. |
| Cost per 1000 lines | The tokens of the judgments of a task, divided by the lines of their subjects, times 1000. | Measured on the pilot. A gate limits it. |
| Precision and recall of a category | Against the hand-labeled sample. | Between 0 and 1. A gate limits each. |

The algebra is the relational algebra over these relations: selection, projection, join, union, difference, grouping, and the transitive closure for `calls`, `imports` and `depends_on`. The typed query layer builds each query from the declared columns, so a query of a column that does not exist does not compile.

## Storage

- SQLite, through `node:sqlite` of Node 24. It needs no native dependency.
- One file for the public catalog. A private catalog is a separate file that does not go to public CI or the public site.
- The tables of Layer 1a are the cache. CI keeps the database of the last run, so a rescan reads only new blobs.
- The site and the agents read the same file.

## Gates

| Gate | Measure | Limit |
| --- | --- | --- |
| Determinism | Two scans of one commit | The same bytes. |
| Scan errors | Files with a parse error, of each repository | Taken from 5 runs or more. |
| Freshness | Freshness of each repository | One week plus the time of one scan. |
| Cost | Cost per 1000 lines of each task | Taken from the pilot. |
| Precision | Precision of each category of Layer 2 | The lower end of the Wilson 95 % interval is at or above the target of the category. |

A limit comes from measured runs, with the run ids and the formula next to the number.

The precision gate decides the size of the sample. For a target `p` and an expected precision above it, the sample must be large enough that the Wilson lower end can reach `p`. The Wilson interval comes from `@mark1russell7/rigor-statistics`, its home. The catalog has no local copy of it.

## Private names

The list of private names is not in this repository. The scan reads it at scan time from a private source, a secret of CI. The public data keeps only a salted hash of each name. The public site removes the evidence line of a leak finding and of a secret finding.

## Scale

The corpus count gives the scale (`data/corpus.json` of the site). On 2026-11-07, GitHub gives 40 active public repositories with 63 MB of code, of which 59 MB is TypeScript and JavaScript. The atlas of today reads 6,830 files with 141,356 functions.

The cost of Layer 2 is the main cost. Two choices make it smaller:

- An agent reads each `renamed` class one time, not each copy.
- An agent reads only the symbols of a task: for the purpose, the exported functions outside tests with 40 nodes or more.
- One judgment of a class gives two answers: the purpose and the home. One read then costs approximately half of two reads.

The pilot also measures the models. The same labeled sample goes to two or three models. Each task then gets the cheapest model that passes its precision gate. The model is a part of the key of a judgment, so the results of two models do not mix.

## Order of the judgments

1. Purpose and home, in one judgment of a class.
2. The features of each package.
3. The findings that need judgment.

## Queries as tools for agents

Layer 3 is also a tool for agents. The queries are procedures, served as MCP tools through `@procedures`. A session then asks the catalog "does this function have a home?" before it writes a helper. It asks the catalog and does not read the code again, so a repeat of a question is fast and cheap.

## Review

The review of 2026-11-07 answered the three questions of the draft.

1. The git blob id is the key of the facts of a file. It is a content hash with no read of the file, and the corpus is not hostile.
2. Layer 1a comes first. Layer 1b comes second, for method calls and chains of re-exports. A measure that needs 1b says "1a bound" until then.
3. Purpose and home come first, in one judgment of a class. Then features, then the findings that need judgment.

It also added six changes:

1. The key of a judgment of a function is its `hash_renamed`.
2. The lineage key.
3. The private names stay out of public data.
4. The Wilson precision gate.
5. The pilot measures the models.
6. The queries are tools for agents.
