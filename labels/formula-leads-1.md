# The formula leads, round 1 (CA15)

These are the first 30 classes of `codeatlas formulas`, from the CI run 42553448106 at the commit of pull request 96. The order is the score of the scan.

- The home comes from `conventions map`, with the words of the member functions. It can be wrong.
- The owner of the home reads each lead and gives a verdict: `right`, `partial` or `wrong`.
- `right`: the members are copies of one formula, and the formula has its place in the home. Give the pull request that moves it, if there is one.
- `partial`: some members are copies, or the copies belong in a different home.
- `wrong`: the members only share a shape, as a sum of four values.
- Each verdict goes into `formulas-1.jsonl` with the hash, the verdict, the reason and the day.

## bench: `mark1russell7/rigor`

### `be06e35e26a747a7`

- Skeleton: `(+ (+ (+ V V ) V ) V )`
- 44 members in 11 repositories: AsyncBrowserContext, algebra, crawler, highways, lag, mark1russell7.github.io, packing, page-lifecycle-tracker, rigor, systems, vex
- Function names: strykerSummary, search, result, pages, fitOf, side

| Repository | Place | Function |
| --- | --- | --- |
| AsyncBrowserContext | `scripts/site-data.ts:145` | `strykerSummary` |
| AsyncBrowserContext | `site/src/search/match.ts:121` | `search` |
| algebra | `packages/predicate-census/src/census.ts:846` | `Tally.result` |
| crawler | `packages/polite-crawler/src/frontier.ts:594` | `crawlSite.pages` |
| highways | `packages/core/scripts/portfolio-sets.ts:278` | `fitOf` |
| highways | `packages/core/src/families/weekly.ts:534` | `make[9].side` |
| highways | `packages/core/src/highways/interchanges/index.ts:173` | `interchangePlan.tripOf` |
| highways | `packages/core/src/highways/interchanges/index.ts:186` | `interchangePlan.tripOf` |
| | 36 more in `formulas.json` | |

### `8a5ff41327c15467`

- Skeleton: `(/ (- V V ) (- V V ) )`
- 34 members in 11 repositories: algebra, client, headroom, highways, lag, layout-contract, packing, systems, template, typeset, vex
- Function names: crossing, xOf, theilSen, gainPerMinute, timelineOf, cell

| Repository | Place | Function |
| --- | --- | --- |
| algebra | `packages/polynomial-bench/src/report.ts:89` | `crossing` |
| client | `packages/site/src/lib/releases.ts:172` | `timelineLayout.xOf` |
| headroom | `packages/core/src/forecast.ts:142` | `theilSen` |
| headroom | `packages/core/src/handles.ts:113` | `gainPerMinute` |
| headroom | `packages/site/src/timeline.ts:57` | `timelineOf` |
| headroom | `packages/site/src/timeline.ts:62` | `timelineOf` |
| highways | `packages/core/scripts/ambiguity-read-rows.ts:63` | `keyedBoard.cell` |
| highways | `packages/core/scripts/bounds.ts:126` | `agreement` |
| | 26 more in `formulas.json` | |

### `40921d279bc181af`

- Skeleton: `(/ (+ (+ (* (- V V ) V ) (* V V ) ) (* V V ) ) N:1000000 )`
- 4 members in 4 repositories: highways, layout-contract, packing, template
- Function names: cost

| Repository | Place | Function |
| --- | --- | --- |
| highways | `scripts/ai-review/codex-review.ts:324` | `cost` |
| layout-contract | `scripts/ai-review/codex-review.ts:324` | `cost` |
| packing | `scripts/ai-review/codex-review.mjs:211` | `cost` |
| template | `scripts/ai-review/codex-review.ts:324` | `cost` |

### `c594648c234944ef`

- Skeleton: `(* call( G:Math.floor (/ V V ) ) V )`
- 16 members in 9 repositories: client, highways, ireko, layout-contract, packing, splay, systems, template, vex
- Function names: nextTime, utcDay, map(), make[7], forEach(), lineChart

| Repository | Place | Function |
| --- | --- | --- |
| client | `packages/schedule/src/cron.ts:420` | `nextTime` |
| client | `packages/site/src/lib/releases.ts:26` | `utcDay` |
| highways | `packages/core/src/families/coverage.ts:262` | `make[4].place.<expr>.map()` |
| highways | `packages/core/src/families/coverage.ts:397` | `make[7]` |
| highways | `packages/core/src/families/coverage.ts:496` | `make[9].ids.forEach()` |
| highways | `packages/core/src/families/weekly.ts:51` | `make.place.<expr>.forEach()` |
| highways | `packages/core/src/families/weekly.ts:97` | `make[2].ids.forEach()` |
| highways | `packages/core/src/families/weekly.ts:313` | `make[5].places.forEach()` |
| | 8 more in `formulas.json` | |

### `ce281ac2f0356af4`

- Skeleton: `(/ (+ (* (- V V ) (- V V ) ) (* (- V V ) (- V V ) ) ) (+ (** (- V V ) N:2 ) (** (- V V ) N:2 ) ) )`
- 2 members in 2 repositories: highways, packing
- Function names: leaveTrunk, wellInside

| Repository | Place | Function |
| --- | --- | --- |
| highways | `packages/core/src/routers/trunks.ts:166` | `leaveTrunk` |
| packing | `packages/packing/bench/raster-nofit.ts:163` | `wellInside` |

### `040cb680dd2aeddd`

- Skeleton: `(/ call( G:Math.round (* V N:10 ) ) N:10 )`
- 18 members in 8 repositories: headroom, highways, lag, layout-contract, packing, splay, systems, typeset
- Function names: round, coresText, tenth, read[18], joinShards, ms

| Repository | Place | Function |
| --- | --- | --- |
| headroom | `packages/core/src/counters.ts:115` | `round` |
| headroom | `packages/core/src/cpu.ts:183` | `coresText` |
| headroom | `packages/core/src/engine.ts:378` | `round` |
| headroom | `packages/core/src/gpu.ts:193` | `tenth` |
| headroom | `packages/core/src/resources.ts:1372` | `read[18]` |
| headroom | `packages/core/src/starts.ts:74` | `round` |
| headroom | `packages/core/src/thermal.ts:130` | `tenth` |
| highways | `packages/core/scripts/grammar-join.ts:113` | `joinShards` |
| | 10 more in `formulas.json` | |

### `d71f0088141ff3fe`

- Skeleton: `(+ V (* (/ (- V V ) (- V V ) ) (- V V ) ) )`
- 5 members in 4 repositories: client, packing, template, vex
- Function names: xOf, wellInside, flatMap(), toPixel

| Repository | Place | Function |
| --- | --- | --- |
| client | `packages/site/src/lib/releases.ts:172` | `timelineLayout.xOf` |
| packing | `packages/packing/bench/raster-nofit.ts:166` | `wellInside` |
| packing | `packages/packing/bench/raster-nofit.ts:176` | `probes.ring.flatMap()` |
| template | `packages/site-pages/src/render/timeline.ts:145` | `timelineLayout.xOf` |
| vex | `packages/sheet-app/src/chart.ts:259` | `toPixel` |

### `1d05167241992e45`

- Skeleton: `(? (=== (% V N:2 ) N:1 ) V (/ (+ V V ) N:2 ) )`
- 15 members in 7 repositories: AsyncBrowserContext, client, crawler, packing, rigor, systems, typeset
- Function names: median, medianOf, medianSide, judgeReconnects, failuresOf, report

| Repository | Place | Function |
| --- | --- | --- |
| AsyncBrowserContext | `bench/run.ts:131` | `median` |
| client | `scripts/setup-profile.ts:163` | `median` |
| crawler | `packages/polite-crawler/bench/find.mts:604` | `median` |
| crawler | `packages/polite-crawler/eval/measure.mts:210` | `median` |
| crawler | `packages/site/src/lib/eval-b.ts:147` | `median` |
| packing | `packages/packing/bench/coverage.ts:311` | `medianOf` |
| packing | `packages/packing/bench/portfolio.ts:295` | `medianOf` |
| packing | `packages/packing/bench/sample-space.ts:645` | `medianSide` |
| | 7 more in `formulas.json` | |

### `4a73658942f7899d`

- Skeleton: `(* (/ (- V V ) (- V V ) ) (- V V ) )`
- 7 members in 4 repositories: client, packing, template, vex
- Function names: xOf, wellInside, flatMap(), yOf, toPixel

| Repository | Place | Function |
| --- | --- | --- |
| client | `packages/site/src/lib/releases.ts:172` | `timelineLayout.xOf` |
| packing | `packages/packing/bench/raster-nofit.ts:166` | `wellInside` |
| packing | `packages/packing/bench/raster-nofit.ts:176` | `probes.ring.flatMap()` |
| packing | `packages/site/src/model.ts:485` | `searchChart.yOf` |
| template | `packages/site-pages/src/render/timeline.ts:145` | `timelineLayout.xOf` |
| vex | `packages/sheet-app/src/chart.ts:259` | `toPixel` |
| vex | `packages/sheet-app/src/chart.ts:260` | `toPixel` |

### `5e214e81caec5a24`

- Skeleton: `(+ (* (- V V ) V ) (* V V ) )`
- 5 members in 5 repositories: highways, layout-contract, packing, rigor, template
- Function names: cost, runCost

| Repository | Place | Function |
| --- | --- | --- |
| highways | `scripts/ai-review/codex-review.ts:324` | `cost` |
| layout-contract | `scripts/ai-review/codex-review.ts:324` | `cost` |
| packing | `scripts/ai-review/codex-review.mjs:211` | `cost` |
| rigor | `packages/bench/src/run-cost.ts:239` | `runCost` |
| template | `scripts/ai-review/codex-review.ts:324` | `cost` |

### `77c0cb725e525cda`

- Skeleton: `(/ call( G:Math.log (/ V V ) ) call( G:Math.log (/ V V ) ) )`
- 4 members in 4 repositories: algebra, lag-hud, packing, rigor
- Function names: logPlace, scalePosition, logSlope, onLine

| Repository | Place | Function |
| --- | --- | --- |
| algebra | `packages/site/src/cost.ts:111` | `logPlace` |
| lag-hud | `packages/site/src/chart.ts:19` | `scalePosition` |
| packing | `packages/packing/bench/skyline-width.ts:151` | `logSlope` |
| rigor | `packages/bench/src/run-cost.ts:105` | `onLine` |

## exact-math: `@mark1russell7/expression`, `@mark1russell7/rational`

### `01aee560c6703fe9`

- Skeleton: `(- (* (- V V ) (- V V ) ) (* (- V V ) (- V V ) ) )`
- 15 members in 4 repositories: highways, layout-contract, packing, rigor
- Function names: orient, cornersOf, turns, kneeOf, tidyPoints, tidy

| Repository | Place | Function |
| --- | --- | --- |
| highways | `packages/core/scripts/predicate-dump.ts:59` | `orient` |
| highways | `packages/core/src/bench/measures/symmetry.ts:21` | `cornersOf` |
| highways | `packages/core/src/geom.ts:164` | `turns` |
| highways | `packages/core/src/highways/knee/index.ts:95` | `kneeOf` |
| highways | `packages/core/src/levels.ts:91` | `tidyPoints` |
| highways | `packages/core/src/levels/detail/index.ts:80` | `tidy` |
| highways | `packages/core/src/repair/walk.ts:44` | `straighten` |
| highways | `packages/core/src/routers/annealing/index.ts:55` | `properCross.o` |
| | 7 more in `formulas.json` | |

## web-crawling: `polite-crawler`, `polite-crawler-mcp`

### `6af85d0f71f89e7b`

- Skeleton: `(+ (+ (+ (+ V V ) V ) V ) V )`
- 10 members in 7 repositories: crawler, highways, lag, mark1russell7.github.io, packing, rigor, systems
- Function names: pages, tripOf, cpuTimes, mutantCounts, project, sha256Hex

| Repository | Place | Function |
| --- | --- | --- |
| crawler | `packages/polite-crawler/src/frontier.ts:594` | `crawlSite.pages` |
| highways | `packages/core/src/highways/interchanges/index.ts:173` | `interchangePlan.tripOf` |
| highways | `packages/core/src/highways/interchanges/index.ts:186` | `interchangePlan.tripOf` |
| lag | `packages/experiments/src/e8-async-context/runner/measure.ts:129` | `cpuTimes` |
| lag | `packages/site/src/results/model/mutation.ts:32` | `mutantCounts` |
| mark1russell7.github.io | `packages/site/src/pond/fluid.ts:229` | `Fluid.project` |
| packing | `packages/packing/src/sha256.ts:70` | `sha256Hex` |
| packing | `packages/site/src/results-model.ts:110` | `skipsHtml` |
| | 2 more in `formulas.json` | |

## geometry: `@mark1russell7/layout-contract`

### `bb23b77b50aff42e`

- Skeleton: `call( G:Math.hypot (- V V ) (- V V ) )`
- 58 members in 9 repositories: algebra, coeval, highways, ireko, layout-contract, mark1russell7.github.io, packing, systems, vex
- Function names: renderScene, renderSceneNote, arrowShape, forEach(), unit, resample

| Repository | Place | Function |
| --- | --- | --- |
| algebra | `packages/site/src/explorer.ts:513` | `Explorer.renderScene` |
| algebra | `packages/site/src/explorer.ts:542` | `Explorer.renderScene` |
| algebra | `packages/site/src/explorer.ts:551` | `Explorer.renderScene` |
| algebra | `packages/site/src/explorer.ts:581` | `Explorer.renderSceneNote` |
| coeval | `packages/site/src/components/TreeSvg.tsx:78` | `arrowShape` |
| highways | `packages/core/scripts/predicate-dump.ts:138` | `twoNearest.centres.forEach()` |
| highways | `packages/core/src/bench/curves.ts:230` | `tangents.unit` |
| highways | `packages/core/src/bench/curves.ts:275` | `resample` |
| | 50 more in `formulas.json` | |

### `66d81ec051420e12`

- Skeleton: `(+ V (* (- V V ) V ) )`
- 41 members in 9 repositories: algebra, client, crawler, highways, ireko, layout-contract, packing, strategy-space, vex
- Function names: X, Y, setStep, cellOffset, step, resample

| Repository | Place | Function |
| --- | --- | --- |
| algebra | `packages/site/src/explorer.ts:522` | `Explorer.renderScene.X` |
| algebra | `packages/site/src/explorer.ts:525` | `Explorer.renderScene.Y` |
| algebra | `packages/site/src/explorer.ts:601` | `Explorer.setStep` |
| algebra | `packages/site/src/grid.ts:115` | `cellOffset` |
| client | `packages/site/src/components/Onion.tsx:148` | `Onion.useEffect().step` |
| crawler | `packages/site/src/components/HybridRanks.tsx:106` | `useTween.useEffect().step` |
| highways | `packages/core/src/bench/curves.ts:278` | `resample` |
| highways | `packages/core/src/channels.ts:52` | `channelWidth` |
| | 33 more in `formulas.json` | |

### `9829068bf507dcce`

- Skeleton: `(+ (* V V ) (* V V ) )`
- 160 members in 8 repositories: algebra, highways, ireko, layout-contract, mark1russell7.github.io, packing, rigor, vex
- Function names: addR, signAt, add, incircleFirstOrder, incirclePermanent, incircleCode

| Repository | Place | Function |
| --- | --- | --- |
| algebra | `packages/expression/src/exact.test-helper.ts:43` | `addR` |
| algebra | `packages/polynomial/src/sturm.ts:68` | `signAt` |
| algebra | `packages/predicate-census/src/oracle.test-helper.ts:41` | `add` |
| algebra | `packages/predicates/src/incircle.ts:139` | `incircleFirstOrder` |
| algebra | `packages/predicates/src/incircle.ts:140` | `incircleFirstOrder` |
| algebra | `packages/predicates/src/incircle.ts:141` | `incircleFirstOrder` |
| algebra | `packages/predicates/src/incircle.ts:142` | `incircleFirstOrder` |
| algebra | `packages/predicates/src/incircle.ts:143` | `incircleFirstOrder` |
| | 152 more in `formulas.json` | |

### `c9b49cb7eb83c21f`

- Skeleton: `(+ V (* V (- V V ) ) )`
- 24 members in 8 repositories: algebra, highways, lag, layout-contract, packing, rigor, strategy-space, vex
- Function names: nearLine, grow, hdbscanLabels, candidatesOf, lerp, map()

| Repository | Place | Function |
| --- | --- | --- |
| algebra | `packages/predicates/src/corpus.test-helper.ts:43` | `nearLine` |
| highways | `packages/core/src/highways/bronchial/index.ts:122` | `bronchialPlan.grow` |
| highways | `packages/core/src/highways/hdbscan/index.ts:163` | `hdbscanLabels` |
| highways | `packages/core/src/highways/manifolds/index.ts:89` | `candidatesOf` |
| highways | `packages/core/src/highways/mingle/index.ts:54` | `lerp` |
| highways | `packages/core/src/highways/sbeb/index.ts:276` | `sbebLines.g.edges.forEach().l.map()` |
| highways | `packages/core/src/routers/fan.ts:107` | `balancedFan` |
| highways | `packages/core/src/routers/trunks.ts:168` | `leaveTrunk` |
| | 16 more in `formulas.json` | |

### `e5930e993fdd02f2`

- Skeleton: `call( G:Math.hypot (- (+ V (/ V N:2 ) ) (+ V (/ V N:2 ) ) ) (- (+ V (/ V N:2 ) ) (+ V (/ V N:2 ) ) ) )`
- 2 members in 2 repositories: layout-contract, vex
- Function names: frameMove, auditReference

| Repository | Place | Function |
| --- | --- | --- |
| layout-contract | `packages/layout-contract/src/frame.ts:144` | `frameMove` |
| vex | `packages/pilots/src/layout-audit.ts:151` | `auditReference` |

### `d9e5d170e37a1ef3`

- Skeleton: `call( G:Math.sqrt (+ (* V V ) (* V V ) ) )`
- 23 members in 5 repositories: highways, layout-contract, mark1russell7.github.io, packing, rigor
- Function names: clipLength, dist, hitsRect, at, unit, forEach()[2]

| Repository | Place | Function |
| --- | --- | --- |
| highways | `packages/core/scripts/predicate-dump.ts:117` | `clipLength` |
| highways | `packages/core/src/geom.ts:30` | `dist` |
| highways | `packages/core/src/geom.ts:128` | `hitsRect` |
| highways | `packages/core/src/highways/interchanges/index.ts:59` | `nearestOfSegments.at` |
| highways | `packages/core/src/lane-room.ts:54` | `unit` |
| highways | `packages/core/src/routers/adam/index.ts:154` | `adamRoutes.first.forEach()[2]` |
| highways | `packages/core/src/routers/adam/index.ts:213` | `adamRoutes.legs.forEach()[2]` |
| highways | `packages/core/src/routers/adam/index.ts:224` | `adamRoutes.legs.forEach()[2]` |
| | 15 more in `formulas.json` | |

### `e4e1990cfbfa096c`

- Skeleton: `(/ (* (- V V ) (- V V ) ) (- V V ) )`
- 5 members in 4 repositories: highways, layout-contract, packing, typeset
- Function names: representative, pointInRings, pointInRing, xAt, mapSegment

| Repository | Place | Function |
| --- | --- | --- |
| highways | `packages/core/src/highways/traclus/index.ts:190` | `representative` |
| layout-contract | `packages/layout-contract/src/rules.ts:542` | `pointInRings` |
| packing | `packages/packing/src/overflow.ts:87` | `pointInRing` |
| packing | `packages/packing/src/space.ts:115` | `xAt` |
| typeset | `packages/typeset/src/fonts/variations.ts:76` | `mapSegment` |

## strategy-space: `@mark1russell7/strategy-space`

### `384fc87b37f69d00`

- Skeleton: `(/ call( G:Math.round (* V N:1000 ) ) N:1000 )`
- 21 members in 9 repositories: codeatlas, crawler, headroom, highways, ireko, lag, layout-contract, packing, systems
- Function names: plannedPairs, serializeBare, rounded, round, addLaneShape, round3

| Repository | Place | Function |
| --- | --- | --- |
| codeatlas | `packages/atlas/src/planned.ts:194` | `plannedPairs` |
| crawler | `packages/polite-crawler/src/webbotauth.ts:329` | `serializeBare` |
| headroom | `packages/core/src/store.ts:486` | `Store.saveSample.rounded` |
| highways | `packages/core/scripts/queue.ts:180` | `round` |
| highways | `packages/core/scripts/through-check-rows.ts:221` | `addLaneShape` |
| highways | `packages/core/scripts/through-check-rows.ts:222` | `addLaneShape` |
| highways | `packages/core/src/bench/screen/hash.ts:49` | `round3` |
| ireko | `packages/ireko/src/core/geometry.ts:103` | `round3` |
| | 13 more in `formulas.json` | |

### `0ab882fdca454546`

- Skeleton: `(** N:10 call( G:Math.floor call( G:Math.log10 V ) ) )`
- 11 members in 7 repositories: crawler, lag, layout-contract, packing, systems, template, vex
- Function names: logTicks, niceCeiling, niceStep, roundTicks, searchChart, niceCeil

| Repository | Place | Function |
| --- | --- | --- |
| crawler | `packages/site/src/lib/eval-a.ts:158` | `logTicks` |
| lag | `packages/site/src/playground/timeline/draw.ts:124` | `niceCeiling` |
| layout-contract | `packages/site/src/sweep.ts:122` | `niceStep` |
| packing | `packages/site/src/model.ts:457` | `roundTicks` |
| packing | `packages/site/src/model.ts:496` | `searchChart` |
| packing | `packages/site/src/results-model.ts:283` | `niceCeil` |
| systems | `packages/quantity/src/format.ts:350` | `placesNear` |
| systems | `packages/site/src/components/RequestPath.tsx:258` | `niceStep` |
| | 3 more in `formulas.json` | |

### `987f9419309b590b`

- Skeleton: `call( G:Math.exp (+ call( G:Math.log V ) (* V (- call( G:Math.log V ) call( G:Math.log V ) ) ) ) )`
- 3 members in 3 repositories: layout-contract, packing, strategy-space
- Function names: dimensionAt, realAt, at01

| Repository | Place | Function |
| --- | --- | --- |
| layout-contract | `packages/layout-contract/src/families.ts:394` | `dimensionAt` |
| packing | `packages/packing/bench/sample-space.ts:156` | `realAt` |
| strategy-space | `packages/strategy-space/src/strategy-space.ts:679` | `at01` |

## random: `@mark1russell7/rigor-generators`

### `a74c34b4b3512523`

- Skeleton: `(+ V call( G:Math.floor (* call( V ) (+ (- V V ) N:1 ) ) ) )`
- 9 members in 5 repositories: algebra, highways, layout-contract, packing, rigor
- Function names: int, randomInt, sleatorCase, shuffleRange, shuffle

| Repository | Place | Function |
| --- | --- | --- |
| algebra | `packages/expression/src/generate.ts:73` | `int` |
| highways | `packages/core/src/families/coverage.ts:47` | `int` |
| layout-contract | `packages/layout-contract/src/random.ts:26` | `randomInt` |
| packing | `packages/packing/bench/adversary.ts:162` | `int` |
| packing | `packages/packing/bench/sleator.ts:45` | `sleatorCase` |
| packing | `packages/packing/src/generators.ts:89` | `int` |
| packing | `packages/packing/src/restarts.ts:101` | `shuffleRange` |
| packing | `packages/packing/src/ruin-recreate.ts:109` | `shuffle` |
| | 1 more in `formulas.json` | |

### `c57044fe1e64eb75`

- Skeleton: `(+ V call( G:Math.imul (^ V (>>> V N:7 ) ) (| V N:61 ) ) )`
- 9 members in 5 repositories: crawler, grafana-infra, ireko, packing, rigor
- Function names: <anonymous>

| Repository | Place | Function |
| --- | --- | --- |
| crawler | `packages/polite-crawler/bench/find.mts:71` | `random.<anonymous>` |
| crawler | `packages/site/src/lib/daemon-sim.ts:199` | `seeded.<anonymous>` |
| crawler | `packages/site/src/lib/pace-compare.ts:113` | `seeded.<anonymous>` |
| crawler | `packages/site/src/lib/site-visit.ts:177` | `seeded.<anonymous>` |
| grafana-infra | `scripts/send-sample-data.mjs:76` | `mulberry32.<anonymous>` |
| ireko | `packages/site/src/playground/fuzz.ts:14` | `random.<anonymous>` |
| packing | `packages/packing/bench/coverage.ts:447` | `mulberry32.<anonymous>` |
| packing | `packages/site/src/model.ts:150` | `random.<anonymous>` |
| | 1 more in `formulas.json` | |

### `c4d9f11f81d0af6a`

- Skeleton: `(/ (>>> (^ V (>>> V N:14 ) ) N:0 ) N:4294967296 )`
- 9 members in 5 repositories: crawler, grafana-infra, ireko, packing, rigor
- Function names: <anonymous>

| Repository | Place | Function |
| --- | --- | --- |
| crawler | `packages/polite-crawler/bench/find.mts:72` | `random.<anonymous>` |
| crawler | `packages/site/src/lib/daemon-sim.ts:200` | `seeded.<anonymous>` |
| crawler | `packages/site/src/lib/pace-compare.ts:114` | `seeded.<anonymous>` |
| crawler | `packages/site/src/lib/site-visit.ts:178` | `seeded.<anonymous>` |
| grafana-infra | `scripts/send-sample-data.mjs:77` | `mulberry32.<anonymous>` |
| ireko | `packages/site/src/playground/fuzz.ts:15` | `random.<anonymous>` |
| packing | `packages/packing/bench/coverage.ts:448` | `mulberry32.<anonymous>` |
| packing | `packages/site/src/model.ts:151` | `random.<anonymous>` |
| | 1 more in `formulas.json` | |

### `5f4e11676bad7bd7`

- Skeleton: `call( G:Math.imul (^ V (>>> V N:15 ) ) (| V N:1 ) )`
- 9 members in 5 repositories: crawler, grafana-infra, ireko, packing, rigor
- Function names: <anonymous>

| Repository | Place | Function |
| --- | --- | --- |
| crawler | `packages/polite-crawler/bench/find.mts:70` | `random.<anonymous>` |
| crawler | `packages/site/src/lib/daemon-sim.ts:198` | `seeded.<anonymous>` |
| crawler | `packages/site/src/lib/pace-compare.ts:112` | `seeded.<anonymous>` |
| crawler | `packages/site/src/lib/site-visit.ts:176` | `seeded.<anonymous>` |
| grafana-infra | `scripts/send-sample-data.mjs:75` | `mulberry32.<anonymous>` |
| ireko | `packages/site/src/playground/fuzz.ts:13` | `random.<anonymous>` |
| packing | `packages/packing/bench/coverage.ts:446` | `mulberry32.<anonymous>` |
| packing | `packages/site/src/model.ts:149` | `random.<anonymous>` |
| | 1 more in `formulas.json` | |

## statistics: `@mark1russell7/rigor-statistics`

### `48c82a1ffeba0ef5`

- Skeleton: `(/ call( G:Math.round (* V N:100 ) ) N:100 )`
- 13 members in 7 repositories: client, crawler, headroom, highways, lag-hud, packing, template
- Function names: getMetadata, setInterval(), round, <anonymous>, point, recordPeakCores

| Repository | Place | Function |
| --- | --- | --- |
| client | `packages/client-store/src/storage/hybrid.ts:2592` | `HybridStorage.getMetadata` |
| client | `packages/client/src/client/middleware/cache.ts:306` | `createCacheMiddleware.setInterval()` |
| crawler | `packages/polite-crawler/bench/find.mts:610` | `round` |
| crawler | `packages/site/src/lib/eval-a.ts:151` | `logScale.<anonymous>` |
| crawler | `packages/site/src/lib/eval-b.ts:216` | `linearScale.<anonymous>` |
| headroom | `packages/core/src/engine.ts:404` | `point` |
| headroom | `packages/core/src/engine.ts:1346` | `Engine.recordPeakCores` |
| headroom | `packages/core/src/forecast.ts:105` | `round2` |
| | 5 more in `formulas.json` | |

## graph-layout: `ireko`

### `ce5e2afb516b88a0`

- Skeleton: `(+ V (* V (+ V V ) ) )`
- 12 members in 7 repositories: client, highways, lag, mark1russell7.github.io, release-train, systems, typeset
- Function names: place, tripOf, LiveStrip, map()[2], map()[3], fillRows

| Repository | Place | Function |
| --- | --- | --- |
| client | `packages/site/src/lib/graph.ts:199` | `buildGraph.place` |
| highways | `packages/core/src/highways/interchanges/index.ts:173` | `interchangePlan.tripOf` |
| lag | `packages/site/src/home/hero/LiveStrip.tsx:39` | `LiveStrip` |
| lag | `packages/site/src/home/hero/LiveStrip.tsx:54` | `LiveStrip.lanes.map()[2]` |
| lag | `packages/site/src/home/hero/LiveStrip.tsx:68` | `LiveStrip.lanes.map()[3]` |
| mark1russell7.github.io | `packages/site/src/board/places.ts:72` | `fillRows` |
| release-train | `packages/site/src/layout.ts:41` | `place.groups.forEach().items.forEach()` |
| release-train | `packages/site/src/main.ts:192` | `renderCanvas` |
| | 4 more in `formulas.json` | |

## data-structures: `@mark1russell7/collections`, `@procedures/collections`, `@procedures/dag`

### `7b9ed84e7523057c`

- Skeleton: `(% (+ (+ V V ) V ) V )`
- 7 members in 7 repositories: AsyncBrowserContext, Meds, cue, lag-hud, optional, page-lifecycle-tracker, ste-lint
- Function names: setActive(), shift, onkeydown, addEventListener("keydown")

| Repository | Place | Function |
| --- | --- | --- |
| AsyncBrowserContext | `site/src/search/Search.tsx:62` | `SearchDialog.onKeyDown.setActive()` |
| Meds | `site/src/controls.ts:42` | `Controls.shift` |
| cue | `site/src/playground.ts:222` | `Playground.render.onkeydown` |
| lag-hud | `packages/site/src/chrome.ts:93` | `Segmented.constructor.container.addEventListener("keydown")` |
| optional | `site/src/playground.ts:76` | `radios.container.addEventListener("keydown")` |
| page-lifecycle-tracker | `packages/site/src/search/Search.tsx:63` | `SearchDialog.onKeyDown.setActive()` |
| ste-lint | `site/src/chrome.ts:88` | `Segmented.constructor.container.addEventListener("keydown")` |
