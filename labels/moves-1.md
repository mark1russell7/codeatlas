# Moves to check: the first run of Layer 2 on the functions with copies or shared names

This file lists the moves of `subset-1.jsonl` to a published home. A label is not a proof. The owners checked 50 of the first 157 moves, and 9 of them were right (`owners-1.jsonl`).

The file has no move of a function whose file imports the home. Such a function calls the home for its general part, and the rest is local policy. `moveOf` gives it the kind `uses the home`.

Before a move gets a pull request, the owner of the copy does these steps:

1. Open the copy and the function of the home.
2. Write a test that shows the same behavior of the two functions.
3. If the test passes, make the pull request to the home, or use the home function.

If the behavior is not the same, or the home has no such function, record the label as wrong.

## `highways`: 18 moves

| Function | File | Home | Copies | What it does |
| --- | --- | --- | --- | --- |
| `crossing` | `packages/core/src/highways/mesh/index.ts` | exact-math: `@mark1russell7/expression`, `@mark1russell7/rational` | 2 | This function finds the crossing of two segments and records the predicate call when a sink is set. |
| `freeSpace` | `packages/core/src/bench/measures/level-crossings.ts` | geometry: `@mark1russell7/layout-contract` | 1 | This function labels the free regions around boxes and tells which regions touch a box. |
| `samplesOf` | `packages/core/src/highways/frechet/index.ts` | geometry: `@mark1russell7/layout-contract` | 1 | This function samples points along a polyline at a given step length. |
| `simplify` | `packages/core/src/routers/physics.ts` | geometry: `@mark1russell7/layout-contract` | 1 | This function removes points of a polyline that lie within a tolerance of the line. |
| `resample` | `packages/core/src/routers/physics.ts` | geometry: `@mark1russell7/layout-contract` | 1 | This function resamples a polyline into a number of equal-length legs. |
| `sweepValues` | `packages/core/src/strategies/options.ts` | random: `@mark1russell7/rigor-generators` | 2 | This function lists the values to sweep for a number, integer, boolean or enum option. |
| `siteDataStamps` | `packages/site/src/stamps.ts` | repo-structure: `@mark1russell7/conventions`, `@mark1russell7/template-cli` | 1 | This function builds the data stamps of the site pages from verdict headers and the bench header. |
| `spreadOf` | `packages/core/scripts/case-order-verdict.ts` | statistics: `@mark1russell7/rigor-statistics` | 1 | This function gives the standard deviation of times over their median. |
| `quantileOf` | `packages/core/scripts/gates/paired.ts` | statistics: `@mark1russell7/rigor-statistics` | 1 | This function gives a quantile of numbers by linear interpolation between sorted values. |
| `timeRows` | `packages/core/scripts/portfolio-api-report.ts` | statistics: `@mark1russell7/rigor-statistics` | 1 | This function groups oracle records by band and strategy and computes median, 95th percentile and maximum times. |
| `bootstrap` | `packages/core/scripts/queue.ts` | statistics: `@mark1russell7/rigor-statistics` | 1 | This function gives a bootstrap interval of the Spearman correlation between predicted and measured values. |
| `spearman` | `packages/core/scripts/queue.ts` | statistics: `@mark1russell7/rigor-statistics` | 1 | This function gives the Spearman rank correlation of two lists with ties averaged. |
| `quantile` | `packages/core/src/bench/measures/stats.ts` | statistics: `@mark1russell7/rigor-statistics` | 1 | This function returns the quantile of a list of numbers by linear interpolation. |
| `kendallTau` | `packages/core/src/bench/measures/stats.ts` | statistics: `@mark1russell7/rigor-statistics` | 1 | This function gives the Kendall tau correlation of two lists, with a seeded sample for long lists. |
| `summarize` | `packages/core/src/bench/measures/stats.ts` | statistics: `@mark1russell7/rigor-statistics` | 1 | This function gives the count, median, quartiles, range and IQR of the numbers that are not NaN. |
| `bootstrapMedian` | `packages/core/src/bench/screen/gap.ts` | statistics: `@mark1russell7/rigor-statistics` | 1 | This function computes a median and a bootstrap interval of it with a seeded generator. |
| `signTestPower` | `packages/core/src/bench/screen/set.ts` | statistics: `@mark1russell7/rigor-statistics` | 1 | This function gives the smallest number of wins out of n families that a two-sided sign test finds significant. |
| `verdictFiles` | `packages/site/src/atlas-files.ts` | system-io: `@procedures/fs`, `@procedures/shell` | 2 | This function reads the sorted verdict snapshot files of a folder and gives their names and text. |

## `packing`: 15 moves

| Function | File | Home | Copies | What it does |
| --- | --- | --- | --- | --- |
| `nodeAt` | `packages/packing/bench/gp-score.ts` | data-structures: `@procedures/collections`, `@procedures/dag` | 1 | This function finds the subtree of a binary tree at a preorder position. |
| `inputOf` | `packages/site/src/model.ts` | geometry: `@mark1russell7/layout-contract` | 1 | Converts site items, a width mode and a scene into a packing input. |
| `regionBounds` | `packages/site/src/region.ts` | geometry: `@mark1russell7/layout-contract` | 1 | This function gives the bounding box of a rectangle, circle, ellipse or polygon region. |
| `anchorCorpusText` | `packages/packing/bench/anchor.ts` | random: `@mark1russell7/rigor-generators` | 5 | Writes the text of the anchor corpus JSON file. |
| `randomTree` | `packages/packing/bench/gp-score.ts` | random: `@mark1russell7/rigor-generators` | 1 | This function draws a random expression tree up to a depth from a random source. |
| `inputOf` | `packages/packing/bench/gp-score.ts` | random: `@mark1russell7/rigor-generators` | 1 | This function makes a seeded packing input from a strip spec by choosing the generator. |
| `seedsOf` | `packages/packing/bench/nightly-plan.ts` | random: `@mark1russell7/rigor-generators` | 1 | Reads a JSON list of seeds and checks that they are enough different whole numbers. |
| `corpus` | `packages/packing/src/corpus.ts` | random: `@mark1russell7/rigor-generators` | 1 | This function makes a corpus of generated inputs and a manifest from specs with generators and seeds. |
| `moved` | `packages/packing/src/raster-nofit.ts` | random: `@mark1russell7/rigor-generators` | 1 | This function makes a random change of an order by a swap or a move of one item. |
| `generateInput` | `packages/site/src/corpus-input.ts` | random: `@mark1russell7/rigor-generators` | 1 | This function generates a seeded packing input from a family key and dimension values. |
| `wilson` | `packages/packing/bench/coverage.ts` | statistics: `@mark1russell7/rigor-statistics` | 1 | This function computes the Wilson score interval of a proportion. |
| `coverage` | `packages/packing/bench/coverage.ts` | statistics: `@mark1russell7/rigor-statistics` | 1 | This function measures how well a regression tree predicts benchmark results, with cross-validation and coverage of cells. |
| `bootstrapMedian` | `packages/packing/bench/promote.ts` | statistics: `@mark1russell7/rigor-statistics` | 1 | This function gives a seeded bootstrap confidence interval for the median of a list of ratios. |
| `quantile` | `packages/packing/src/measures.ts` | statistics: `@mark1russell7/rigor-statistics` | 1 | This function gives the quantile of a list of numbers with linear interpolation. |
| `annotateDiff` | `scripts/ai-review/codex-review.mjs` | system-io: `@procedures/fs`, `@procedures/shell` | 1 | Adds line numbers to a unified diff and collects the changed line numbers of each file. |

## `AsyncBrowserContext`: 17 moves

| Function | File | Home | Copies | What it does |
| --- | --- | --- | --- | --- |
| `useMediaQuery` | `site/src/lib/use-media-query.ts` | browser-monitoring: `@mark1russell7/lag`, `@mark1russell7/lag-hud` | 2 | This React hook subscribes to a CSS media query and returns whether it matches. |
| `Playground` | `site/src/playground/Playground.tsx` | browser-monitoring: `@mark1russell7/lag`, `@mark1russell7/lag-hud` | 1 | This React component renders a code playground that compiles, highlights and runs code and shows a debugger trace. |
| `resolveConfig` | `tools/ste-lint/src/config.ts` | prose: `@mark1russell7/ste-lint` | 1 | This function merges a lint config file with defaults and the environment into a resolved config. |
| `summarize` | `tools/ste-lint/src/format.ts` | prose: `@mark1russell7/ste-lint` | 1 | This function counts the lint findings by rule, severity and file. |
| `buildLexicon` | `tools/ste-lint/src/lexicon.ts` | prose: `@mark1russell7/ste-lint` | 1 | This function builds the word lexicon of nouns, verbs and phrases from the lint configuration and a dictionary. |
| `missingSubject` | `tools/ste-lint/src/rules/missing-subject.ts` | prose: `@mark1russell7/ste-lint` | 1 | This function finds a sentence that has no subject using word lists and verb forms. |
| `runCli` | `tools/ste-lint/src/run-cli.ts` | prose: `@mark1russell7/ste-lint` | 1 | Runs the ste-lint command line: reads options and config, lints the files and prints findings with an exit code. |
| `findBacktickRun` | `tools/ste-lint/src/source/blocks.ts` | prose: `@mark1russell7/ste-lint` | 1 | This function finds the next run of backticks of an exact length in a text. |
| `extractJsxText` | `tools/ste-lint/src/source/jsx.ts` | prose: `@mark1russell7/ste-lint` | 1 | Extracts the prose blocks and their line offsets from the text of JSX elements and attributes in a TSX file. |
| `stripFrontMatter` | `tools/ste-lint/src/source/markdown.ts` | prose: `@mark1russell7/ste-lint` | 1 | This function removes the front matter block from the lines of a Markdown file. |
| `extractMarkdown` | `tools/ste-lint/src/source/markdown.ts` | prose: `@mark1russell7/ste-lint` | 1 | This function extracts the text blocks and suppression directives from a Markdown or MDX document. |
| `scanSource` | `tools/ste-lint/src/source/tsdoc.ts` | prose: `@mark1russell7/ste-lint` | 1 | This function scans TypeScript source and finds the comment ranges and the code token positions. |
| `extractTsdoc` | `tools/ste-lint/src/source/tsdoc.ts` | prose: `@mark1russell7/ste-lint` | 1 | This function extracts the text blocks and suppression directives from the doc comments of TypeScript source. |
| `unitFromTokens` | `tools/ste-lint/src/units.ts` | prose: `@mark1russell7/ste-lint` | 1 | This function groups tokens into sentences with word counts and instruction marks for the prose linter. |
| `findFiles` | `tools/ste-lint/src/files.ts` | system-io: `@procedures/fs`, `@procedures/shell` | 1 | This function finds files that match include globs and are not ignored, and returns the sorted paths. |
| `globBase` | `tools/ste-lint/src/files.ts` | system-io: `@procedures/fs`, `@procedures/shell` | 1 | This function gives the base folder of a glob pattern, which is the part before the first wildcard. |
| `formatMs` | `site/src/lib/format.ts` | units: `@mark1russell7/quantity` | 1 | This function writes a time in milliseconds as ms, seconds or minutes with fitting precision. |

## `client`: 14 moves

| Function | File | Home | Copies | What it does |
| --- | --- | --- | --- | --- |
| `buildGraph` | `packages/site/src/lib/graph.ts` | graph-layout: `ireko` | 1 | This function builds a call graph of a program with nodes, edges and a tree layout of positions. |
| `hashOf` | `packages/client/src/procedures/manifest.ts` | random: `@mark1russell7/rigor-generators` | 1 | This function computes a 64-bit FNV-1a hash of the stable JSON text of a value. |
| `createHydrate` | `packages/client-splay/src/hydrate.ts` | reactive-ui: `@mark1russell7/render-dsl`, `@mark1russell7/render-node` | 1 | This function makes a hydrate function that builds components from a tree of descriptors. |
| `mountApp` | `packages/site/src/lib/prerender-handoff.ts` | reactive-ui: `@mark1russell7/render-dsl`, `@mark1russell7/render-node` | 1 | Mounts the app over a prerendered page and swaps the static page for the live one when ready. |
| `readReleases` | `packages/site/scripts/releases-data.ts` | releases:  | 1 | This function reads the releases of the repository and gives them with their group. |
| `releaseSummary` | `packages/site/src/lib/releases.ts` | releases:  | 1 | This function counts the releases by kind and finds the first and last release dates. |
| `compareVersions` | `packages/site/src/lib/versions.ts` | releases:  | 1 | This function compares two version strings by their major, minor and patch numbers. |
| `changelogSection` | `scripts/lib/workspace.mjs` | releases:  | 1 | This function reads the section of a version from the CHANGELOG file of a package. |
| `resolveFeatures` | `packages/client-cue/src/shared.ts` | repo-structure: `@mark1russell7/conventions`, `@mark1russell7/template-cli` | 1 | This function expands requested features into the full set with their dependencies, skipping unknown features. |
| `pageHtml` | `packages/site/src/build-time/snapshot.ts` | repo-structure: `@mark1russell7/conventions`, `@mark1russell7/template-cli` | 1 | This function builds the HTML of a prerendered page from a template, head, route and snapshot body. |
| `findingsOf` | `scripts/check-paths-and-writes.ts` | repo-structure: `@mark1russell7/conventions`, `@mark1russell7/template-cli` | 1 | This function parses source code and finds forbidden path, topic and write patterns, with allowing comment markers. |
| `backoffOf` | `packages/client-mongo/src/storage/storage-hints.ts` | service: `@mark1russell7/service`, `@procedures/peer` | 1 | This function checks backoff options and gives a function from attempt number to a jittered delay. |
| `bindingOf` | `packages/systems/src/lint.ts` | state-machines: `@mark1russell7/algebra` | 1 | This function works out the timer values of a binding from retry, heartbeat and timeout settings. |
| `quantileOf` | `scripts/lib/paired-time.ts` | statistics: `@mark1russell7/rigor-statistics` | 2 | This function gives a quantile of numbers by linear interpolation between sorted values. |

## `template`: 14 moves

| Function | File | Home | Copies | What it does |
| --- | --- | --- | --- | --- |
| `treeRows` | `packages/site/src/model.ts` | data-structures: `@procedures/collections`, `@procedures/dag` | 1 | This function turns a list of file paths into sorted folder and file rows of a tree. |
| `evaluate` | `packages/site/src/expr.ts` | language-kernel: `@mark1russell7/coeval` | 1 | Evaluates a condition expression string with a lookup, and gives its value and references. |
| `releaseNotes` | `packages/conventions/src/release-text.ts` | releases:  | 2 | This function makes the release notes of a package version from its changelog, cut to a maximum length. |
| `minorsBehind` | `packages/site-pages/src/check/freshness.ts` | releases:  | 1 | This function counts how many minor versions a used version is behind the latest. |
| `latestAt` | `packages/site-pages/src/check/freshness.ts` | releases:  | 1 | This function finds the latest stable version of a package published at or before a date. |
| `kindOf` | `packages/site-pages/src/data/versions.ts` | releases:  | 1 | This function classifies a version as first, major, minor or patch release from its number. |
| `compareVersions` | `packages/site-pages/src/data/versions.ts` | releases:  | 1 | This function compares two semantic version strings by core numbers and prerelease identifiers. |
| `parseVersion` | `packages/site-pages/src/data/versions.ts` | releases:  | 1 | This function reads a version string into major, minor, patch and prerelease parts, or gives null. |
| `prBody` | `scripts/release/bump-pins.ts` | releases:  | 1 | Writes the Markdown body of a pull request that moves the template pins, with a table and commit list. |
| `parseVersion` | `scripts/release/workspace.ts` | releases:  | 1 | This function reads a semantic version string into its core numbers and prerelease parts. |
| `compareVersions` | `scripts/release/workspace.ts` | releases:  | 1 | This function compares two semantic versions, including prerelease parts, and throws on an invalid version. |
| `serve` | `packages/site-pages/src/check/serve.ts` | service: `@mark1russell7/service`, `@procedures/peer` | 1 | This function starts a local static file HTTP server for a site folder and returns its URL and close function. |
| `globToRegExp` | `.github/actions/changeset-check/check.ts` | system-io: `@procedures/fs`, `@procedures/shell` | 1 | This function converts a glob pattern into a regular expression. |
| `changedLines` | `.github/actions/security-scan/new-alerts.ts` | system-io: `@procedures/fs`, `@procedures/shell` | 1 | This function reads a git diff and gives the ranges of added lines for each file. |

## `lag`: 8 moves

| Function | File | Home | Copies | What it does |
| --- | --- | --- | --- | --- |
| `refusal` | `packages/scripts/src/package-template.ts` | repo-structure: `@mark1russell7/conventions`, `@mark1russell7/template-cli` | 1 | This function gives a refusal message when a new package name or folder already exists. |
| `packageFiles` | `packages/scripts/src/package-template.ts` | repo-structure: `@mark1russell7/conventions`, `@mark1russell7/template-cli` | 1 | This function makes the package.json and tsconfig contents of a new package from its preset. |
| `segmentsOf` | `packages/site/src/explainers/lifecycle/lifecycle-model.ts` | state-machines: `@mark1russell7/algebra` | 1 | Builds the state segments of a lifecycle from transitions, clipped to a time window. |
| `quantile` | `packages/experiments/src/e8-async-context/runner/stats.ts` | statistics: `@mark1russell7/rigor-statistics` | 1 | Gives the quantile of a list of numbers by the nearest-rank rule. |
| `spread` | `packages/experiments/src/e8-async-context/runner/stats.ts` | statistics: `@mark1russell7/rigor-statistics` | 1 | This function gives the median, minimum, maximum and count of the finite values. |
| `samplesOf` | `packages/site/src/explainers/histogram/histogram-model.ts` | statistics: `@mark1russell7/rigor-statistics` | 1 | This function makes sample values from a log-normal load by using normal quantiles. |
| `summarize` | `packages/site/src/lib/stats.ts` | statistics: `@mark1russell7/rigor-statistics` | 1 | This function gives the count, minimum, maximum, mean and percentiles of a list of numbers. |
| `formatBytes` | `packages/site/src/lib/format.ts` | units: `@mark1russell7/quantity` | 1 | This function writes a byte count with a unit such as KB or MB. |

## `layout-contract`: 6 moves

| Function | File | Home | Copies | What it does |
| --- | --- | --- | --- | --- |
| `routeConfig` | `packages/site/src/catalog.ts` | edge-routing: `@mark1russell7/highways` | 1 | This function makes a strategy configuration for a chosen router and throws when the router is unknown. |
| `packConfig` | `packages/site/src/catalog.ts` | packing: `@mark1russell7/packing` | 1 | This function makes a strategy configuration for a pack choice, with nested member strategies. |
| `loadSplit` | `packages/joint/src/split.ts` | random: `@mark1russell7/rigor-generators` | 1 | Loads the split file of a corpus by its hash and gives its folds, with a clear error if missing. |
| `canonicalJson` | `packages/layout-contract/src/hash.ts` | random: `@mark1russell7/rigor-generators` | 1 | This function writes a value as canonical JSON with sorted keys. |
| `inputOf` | `packages/site/src/jobs.ts` | random: `@mark1russell7/rigor-generators` | 1 | Rebuilds a layout input and its cell from a reference to a corpus entry or recorded dimensions, and checks its hash. |
| `verdict` | `packages/layout-contract/src/verdict.ts` | statistics: `@mark1russell7/rigor-statistics` | 1 | This function gives a verdict on paired records by bootstrap intervals, a permutation test and a sign test. |

## `ireko`: 7 moves

| Function | File | Home | Copies | What it does |
| --- | --- | --- | --- | --- |
| `moveShape` | `packages/ireko/src/core/engine/shape.ts` | geometry: `@mark1russell7/layout-contract` | 2 | This function moves a shape by an x and a y offset. |
| `inflate` | `packages/ireko/src/core/geometry.ts` | geometry: `@mark1russell7/layout-contract` | 3 | This function grows a rectangle by a padding on every side. |
| `contains` | `packages/ireko/src/core/geometry.ts` | geometry: `@mark1russell7/layout-contract` | 2 | This function tells whether one rectangle lies inside another within a tolerance. |
| `overlaps` | `packages/ireko/src/core/geometry.ts` | geometry: `@mark1russell7/layout-contract` | 1 | This function tells whether two rectangles overlap by more than a tolerance. |
| `resample` | `packages/ireko/src/render/tween.ts` | geometry: `@mark1russell7/layout-contract` | 1 | This function resamples a polyline to a given count of points spaced evenly along its length. |
| `parse` | `packages/ireko/src/text/parse.ts` | language-kernel: `@mark1russell7/coeval` | 1 | Parses the text of a layout document into an input, and gives an error result on a parse failure. |
| `randomTree` | `packages/site/src/playground/fuzz.ts` | random: `@mark1russell7/rigor-generators` | 1 | This function makes a random layout tree from a seed with grid, radial and tree layouts. |

## `algebra`: 6 moves

| Function | File | Home | Copies | What it does |
| --- | --- | --- | --- | --- |
| `seedsOf` | `packages/expression-bench/src/cases.ts` | random: `@mark1russell7/rigor-generators` | 1 | This function parses a list of seeds and seed ranges from comma-separated text. |
| `random` | `packages/expression/src/generate.ts` | random: `@mark1russell7/rigor-generators` | 7 | This function makes a seeded random number generator of the mulberry32 kind. |
| `findFiles` | `packages/predicate-census/src/report.ts` | system-io: `@procedures/fs`, `@procedures/shell` | 1 | This function walks the given paths and returns the sorted list of all JSONL files found. |
| `readRecords` | `packages/site/src/study.ts` | system-io: `@procedures/fs`, `@procedures/shell` | 1 | This function reads a gzip file and parses each line as a JSON record. |
| `packageFiles` | `scripts/rules.ts` | system-io: `@procedures/fs`, `@procedures/shell` | 1 | Reads the package.json files of the root and each package folder, skipping unreadable ones. |
| `casesFor` | `packages/rational-bench/src/cases.ts` | units: `@mark1russell7/quantity` | 1 | This function builds the benchmark cases of unit conversions with exact rationals and their expected values. |

## `crawler`: 6 moves

| Function | File | Home | Copies | What it does |
| --- | --- | --- | --- | --- |
| `stableStringify` | `packages/polite-crawler/src/record.ts` | random: `@mark1russell7/rigor-generators` | 1 | This function makes JSON text with sorted object keys so equal values give equal text. |
| `readPlan` | `scripts/eval-gate.ts` | releases:  | 1 | This function reads a plan of release tags from a JSON file and checks its shape. |
| `compareVersions` | `scripts/version.ts` | releases:  | 1 | This function compares two semantic versions, including prerelease identifiers. |
| `decide` | `scripts/eval-gate.ts` | repo-structure: `@mark1russell7/conventions`, `@mark1russell7/template-cli` | 1 | This function decides whether the eval job runs, from the event and the release plan. |
| `summarize` | `packages/polite-crawler/eval/session-result.mts` | statistics: `@mark1russell7/rigor-statistics` | 1 | This function sums up session records for each arm into counts, costs and medians. |
| `median` | `packages/site/src/lib/eval-b.ts` | statistics: `@mark1russell7/rigor-statistics` | 2 | This function gives the median of a list of numbers. |

## `headroom`: 6 moves

| Function | File | Home | Copies | What it does |
| --- | --- | --- | --- | --- |
| `refusal` | `packages/core/src/worktrees.ts` | system-io: `@procedures/fs`, `@procedures/shell` | 1 | Gives the reason a worktree path is unsafe to remove, or null when it is safe. |
| `pnpmStorePath` | `packages/daemon/src/disk-report.ts` | system-io: `@procedures/fs`, `@procedures/shell` | 1 | This function runs pnpm store path and gives the last non-empty line of its output, or null. |
| `runProgram` | `packages/daemon/src/disk-report.ts` | system-io: `@procedures/fs`, `@procedures/shell` | 1 | This function runs a program with arguments and a timeout, and gives its output or null on error. |
| `killTree` | `packages/daemon/src/gateway.ts` | system-io: `@procedures/fs`, `@procedures/shell` | 1 | This function stops a process and all its descendants, with taskkill on Windows and signals elsewhere. |
| `windowsArg` | `packages/daemon/src/service.ts` | system-io: `@procedures/fs`, `@procedures/shell` | 1 | This function quotes an argument for a Windows command line with the correct backslash rules. |
| `systemdArg` | `packages/daemon/src/service.ts` | system-io: `@procedures/fs`, `@procedures/shell` | 1 | This function quotes and escapes an argument for a systemd unit file. |

## `vex`: 6 moves

| Function | File | Home | Copies | What it does |
| --- | --- | --- | --- | --- |
| `columnOrder` | `packages/core/src/sheet.ts` | data-structures: `@procedures/collections`, `@procedures/dag` | 1 | This function orders the columns of a sheet so each follows the columns it reads, breaking cycles. |
| `layersOf` | `packages/pilots/src/ireko-layers.ts` | graph-layout: `ireko` | 2 | This function assigns a layer to each node of a directed graph, after it breaks cycles. |
| `mergeBands` | `packages/pilots/src/ireko-shapes.ts` | graph-layout: `ireko` | 1 | This function merges overlapping bands into disjoint bands with their minimum and maximum, and limits their number. |
| `tokenize` | `packages/formula/src/syntax.ts` | language-kernel: `@mark1russell7/coeval` | 1 | This function splits formula text into tokens with spans, throwing on syntax errors. |
| `quantile` | `packages/core/bench/measure.ts` | statistics: `@mark1russell7/rigor-statistics` | 1 | This function gives a quantile of numbers by linear interpolation between sorted values. |
| `parseCsv` | `packages/sheet-app/src/io.ts` | system-io: `@procedures/fs`, `@procedures/shell` | 1 | This function reads CSV text with quoted fields into rows of fields. |

## `systems`: 1 move

| Function | File | Home | Copies | What it does |
| --- | --- | --- | --- | --- |
| `parseExpr` | `packages/algebra/src/algebra.ts` | exact-math: `@mark1russell7/expression`, `@mark1russell7/rational` | 1 | This function parses an arithmetic expression with functions and knobs into a tree of nodes. |

## `codeatlas`: 1 move

| Function | File | Home | Copies | What it does |
| --- | --- | --- | --- | --- |
| `treeOf` | `packages/atlas/src/blobs.ts` | system-io: `@procedures/fs`, `@procedures/shell` | 1 | This function runs git ls-tree and parses its output into blob entries with path and size. |

## `coeval`: 2 moves

| Function | File | Home | Copies | What it does |
| --- | --- | --- | --- | --- |
| `components` | `packages/core/src/graph.ts` | data-structures: `@procedures/collections`, `@procedures/dag` | 1 | This function gives the strongly connected components of a graph that have named members. |
| `random` | `packages/core/src/generate.ts` | random: `@mark1russell7/rigor-generators` | 1 | Makes a seeded random generator with next, int, chance and pick functions. |

## `lag-hud`: 2 moves

| Function | File | Home | Copies | What it does |
| --- | --- | --- | --- | --- |
| `layoutThrash` | `packages/site/src/loads.ts` | browser-monitoring: `@mark1russell7/lag`, `@mark1russell7/lag-hud` | 1 | This function forces layout again and again on elements for some milliseconds to make a layout load. |
| `quantile` | `packages/hud/src/meter.ts` | statistics: `@mark1russell7/rigor-statistics` | 1 | Gives the quantile of a sorted list of numbers by the nearest-rank rule. |

## `release-train`: 2 moves

| Function | File | Home | Copies | What it does |
| --- | --- | --- | --- | --- |
| `globToRegExp` | `packages/release-train/src/parse.ts` | system-io: `@procedures/fs`, `@procedures/shell` | 1 | This function converts a glob pattern into a regular expression. |
| `formatJson` | `packages/release-train/src/sync.ts` | system-io: `@procedures/fs`, `@procedures/shell` | 1 | This function writes JSON text that keeps the indent, line endings and final newline of an original file. |

## `collections`: 1 move

| Function | File | Home | Copies | What it does |
| --- | --- | --- | --- | --- |
| `fanIn` | `packages/collections/src/async/channels.ts` | service: `@mark1russell7/service`, `@procedures/peer` | 1 | This function merges many channels into one output channel and closes it when all inputs end. |

## `concat-src`: 1 move

| Function | File | Home | Copies | What it does |
| --- | --- | --- | --- | --- |
| `formatBytes` | `site/src/reasons.ts` | units: `@mark1russell7/quantity` | 1 | This function writes a byte count as B, KB or MB. |

## `grafana-infra`: 1 move

| Function | File | Home | Copies | What it does |
| --- | --- | --- | --- | --- |
| `walk` | `site/src/stack/alloy.ts` | data-structures: `@procedures/collections`, `@procedures/dag` | 1 | This function follows the output of a signal through Alloy components and returns the route without cycles. |

## `splay`: 1 move

| Function | File | Home | Copies | What it does |
| --- | --- | --- | --- | --- |
| `listLayout` | `src/layout.ts` | geometry: `@mark1russell7/layout-contract` | 1 | Gives the positions and sizes of items stacked in one column in a container. |

## `ts-base`: 1 move

| Function | File | Home | Copies | What it does |
| --- | --- | --- | --- | --- |
| `layersOf` | `site/src/model.ts` | repo-structure: `@mark1russell7/conventions`, `@mark1russell7/template-cli` | 1 | This function resolves a tsconfig file into the ordered layers of its base chain. |

