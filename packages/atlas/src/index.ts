export { buildAtlas, topicsOf, wordsOf, PURPOSES, TOPICS } from "./atlas.ts";
export type { Atlas, AtlasOptions, CloneClass, Member, PurposeRow, RepoRow, SharedName } from "./atlas.ts";
export { CHURN_DAYS, churnLogArgs, churnOfLog, churnOfRepo, isShallow } from "./churn.ts";
export type { FileChurn } from "./churn.ts";
export { CLONE_ARGS, clonePublic, listArgs, repoNames } from "./clone.ts";
export {
  changedRepos,
  DELAY_DAYS,
  delayStats,
  freshMarkdown,
  FRESHNESS_HOURS,
  headOfLsRemote,
  indexedHeads,
  lsRemoteArgs,
  remoteHeads,
  staleRepos,
  type DelayStats,
  type FreshReport,
  type IndexedHead,
  type RemoteHead,
  type BehindRepo,
} from "./fresh.ts";
export { atlasMarkdown } from "./report.ts";
export { commitTimeOf, gitFiles, headOf, isSource, lineOf, lineStarts, packageOf, scanRepo, scanSource, GENERATED, MAX_BYTES, SKIP, SOURCE, TEST } from "./scan.ts";
export type { Export, FileScan, RepoScan, Unit } from "./scan.ts";
export { shapeOf, shapeTokens } from "./shape.ts";
export type { AstNode, Shape } from "./shape.ts";
export { buildCorpus, corpusMarkdown, corpusOfRepo, countRepo, kindOf, lineCounts, FILE_KINDS } from "./corpus.ts";
export type { Corpus, CorpusFile, FileKind, KindCount, RepoCorpus } from "./corpus.ts";
export { calleeText, cognitiveOf, commentsOf, complexityOf, factsOf, syntaxOf, typeShapeOf, FACTS_VERSION } from "./facts.ts";
export type { CallSiteFact, ExportFact, FileFacts, FunctionFact, ImportFact, ImportKind, MarkerFact, MarkerKind, SymbolFact, SymbolKind, Syntax } from "./facts.ts";
export { cloneHashes, literalText, typeHash } from "./hashes.ts";
export type { CloneHashes } from "./hashes.ts";
export { cacheOf, factsKey, factsOfRepo, treeOf } from "./blobs.ts";
export type { BlobFacts, FactsCache, FactsLine, FileRecord, ScanCounts, TreeEntry } from "./blobs.ts";
export { factsMarkdown, factsSummary, gateVerdict, CLASS_MIN_NODES } from "./summary.ts";
export type { FactsSummary, GateVerdict, Unread } from "./summary.ts";
export { Catalog, CATALOG_SCHEMA, readOnlyCatalog } from "./store.ts";
export type { Label } from "./store.ts";
export { CATALOG_COLUMNS, CATALOG_VIEWS, queryOf } from "./query.ts";
export type { CatalogColumns, CatalogQuery, CatalogTables, ColumnType, ValueOf } from "./query.ts";
export { CLONE_LEVELS, cloneClasses, complexFunctions, copiesOf, duplication, importersOf, markerCounts, membersOf } from "./queries.ts";
export type { CloneLevel, CloneOptions, HashClass, ComplexFunction, Duplication, FunctionPlace, ImportPlace, LevelDuplication, MarkerCount } from "./queries.ts";
export { agreementOf, OTHER_LIMIT } from "./agreement.ts";
export type { AgreementFile, ConfusionCell, DraftLabel, OtherCheck, TaskAgreement } from "./agreement.ts";
export { verdictOf } from "./verdict.ts";
export type { PersonAnswer, TaskVerdict, TruthLabel, VerdictFile } from "./verdict.ts";
export { homeFacts, labelsOfLine, precisionOf, raterOfText, REFERENCE_NOTE, REFERENCE_VERSION, referenceMarkdown, referenceOf, TEST_SUPPORT, MONOREPOS, moveOf, packageCallsOf, placeKey } from "./reference.ts";
export type { FactLabel, LabelPrecision, MoveCaller, MoveKind, PrecisionFile, Rater, RaterLabel, ReferenceFile, ReferenceLabel, ReferenceTask } from "./reference.ts";
export { AUDIT_EXPECTED, SAMPLE_PLAN, SAMPLE_VERSION, auditOf, drawSample, populationOf, sampleFile, sizedTasks } from "./sample.ts";
export type { SampleFile, SampleItem, SizedTask, TaskTarget } from "./sample.ts";
export { TREND_VERSION, addPoint, filterTrend, pointTotals, trendPoint } from "./trend.ts";
export type { PointTotals, RepoPoint, Trend, TrendPoint } from "./trend.ts";
export { homeCandidates } from "./candidates.ts";
export type { HomeCandidate, HomeCopy } from "./candidates.ts";
export { CATALOG_READ_EFFECTS, CATALOG_WRITE_EFFECTS, NAME_MATCHES, TOOL_ROW_LIMIT, atlasTools, catalogRepos, findFunctions } from "./tools.ts";
export type { AtlasToolsOptions, CatalogRepo, CopyCounts, FindOptions, FoundFunction, NameMatch } from "./tools.ts";
export { MCP_INSTRUCTIONS, mcpCommand, toolCommand } from "./tools-cli.ts";
export { DEPENDENCY_FIELDS, manifestOf, manifestsOfRepo, rangeKind } from "./manifests.ts";
export type { DependencyFact, DependencyField, ManifestFacts, ManifestRecord, RangeKind } from "./manifests.ts";
export { UNRESOLVED_KINDS, pinnedDependencies, rangeDrift, versionDrift } from "./dependencies.ts";
export type { DependencyPlace, DependencyRange, PinnedDependency, RangeDrift, ResolvedVersion, VersionDrift } from "./dependencies.ts";
export { LOCK_FIELDS, MAX_LOCK_BYTES, bareVersion, lockfileOf, lockfilesOfRepo } from "./lockfiles.ts";
export { roadmapOf, roadmapsOfRepo } from "./roadmaps.ts";
export type { RoadmapItemFact, RoadmapRecord, StatusClass } from "./roadmaps.ts";
export { PLAN_STOP_WORDS, PLANNED_VERSION, planWords, plannedDuplication, plannedMarkdown, plannedPairs } from "./planned.ts";
export type { PlanItem, PlannedOptions, PlannedPair } from "./planned.ts";
export { DIMENSION_PRECISION_GATE, DIMENSIONS, DIMENSIONS_VERSION, codeIndex, dimensionCatalog, dimensionCounts, dimensionSummaries, dimensionsMarkdown } from "./dimensions.ts";
export type { CodeIndex, Dimension, DimensionCatalog, DimensionGap, DimensionPrecision, DimensionRow, DimensionScope, DimensionSummary, Extractor, FunctionIndexRow, ModuleIndexRow } from "./dimensions.ts";
export {
  CLAIM_MIN_JUDGED,
  FORMULA_MIN_LEAD,
  FORMULA_MIN_RECORD,
  FORMULA_COPY_GATE,
  FORMULA_HOME_GATE,
  FORMULA_MEMBER_GATE,
  FORMULAS_VERSION,
  GENERIC_FORMULAS,
  LABEL_CLAIMS,
  claimPrecision,
  fileKey,
  formulaClasses,
  formulaHash,
  formulaHome,
  formulaOf,
  formulaPrecision,
  formulaRecall,
  formulaReport,
  formulaRows,
  formulasMarkdown,
  skeletonOf,
} from "./formulas.ts";
export type {
  ClaimPrecision,
  FormulaClaim,
  FormulaClass,
  FormulaClassOptions,
  FormulaFact,
  FormulaHome,
  FormulaLabel,
  FormulaMember,
  FormulaPrecision,
  FormulaRecall,
  FormulaReport,
  FormulaRow,
  FormulaVerdict,
  GenericFormula,
  OwnerFind,
  Skeleton,
} from "./formulas.ts";
export type { LockfileFacts, LockfileRecord, ResolvedFact } from "./lockfiles.ts";
export {
  DRIFT_STATES,
  STAMP_PATH,
  STAMP_MAIN,
  TEMPLATE_CLONE,
  TEMPLATE_REPO,
  driftMarkdown,
  fileOfTarget,
  keepListOf,
  keepListOfRepo,
  localForm,
  pinAge,
  pinFreshness,
  pinLag,
  PIN_AGE_LIMIT,
  stampFreshness,
  stampCheckOfRepo,
  pinsOf,
  templateDrift,
  templateRecordsOfRepo,
  templateVersionsOfRepo,
  workflowForm,
} from "./templates.ts";
export type { DriftState, PinAgeOptions, PinAges, PinDrift, PinFreshness, PinLag, PinLags, RepoPinAge, StaleRepo, StampCheck, StampFileCheck, StampFreshness, TemplateChange, TemplateVersion, TemplateVersions, RepoDrift, TemplateDrift, TemplateFileRecord, TemplatePin, TemplateRecords } from "./templates.ts";
export { CONVENTIONS_VERSION, INSTALL_RULES, conventionsBreaks, conventionsCheckOfRepo, conventionsMarkdown } from "./conventions.ts";
export type { ConventionsBreak, ConventionsBreaks, ConventionsCheck, ConventionsRule, RuleBreaks, RuleStatus } from "./conventions.ts";
export { repoOfRemote, rescanRepo, scanRepoInto } from "./rescan.ts";
export type { RepoScanResult, RescanResult } from "./rescan.ts";
export { QUERY_SET_LIMITS, QUERY_SET_VERSION, querySet } from "./query-set.ts";
export type { ExactClass, QuerySet, QuerySetLimits, RepoCommit } from "./query-set.ts";
