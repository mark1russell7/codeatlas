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
| 1c, outside sources | CI artifacts, lockfiles and the template give coverage, dependency versions, template drift and conventions breaks. | Small. | `(snapshot, source)` | For a new commit or a new CI run. |
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

A file is one place of a blob in a snapshot.

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
| `depth` | integer | The deepest nesting of blocks. |
| `test` | boolean | The symbol is in a test file. |

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
| `subject`, `task` | key | |
| `label` | JSON | The true answer. |
| `by`, `at` | text, time | |

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
