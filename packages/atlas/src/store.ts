/**
 * The catalog database: the Layer 1a tables, and the manifests, lockfiles, roadmaps and template records of Layer 1c. It
 * is one SQLite file through `node:sqlite`. `docs/SCHEMA.md` tells the layers.
 * The blob tables are also the cache of the scan. A rescan with the database of the last run parses only new blobs.
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { factsKey, type BlobFacts, type FileRecord, type ScanCounts } from "./blobs.ts";
import type { FileChurn } from "./churn.ts";
import { CLASS_MIN_NODES, type FactsSummary, type Unread } from "./summary.ts";
import type { FileFacts, MarkerKind } from "./facts.ts";
import type { ManifestRecord } from "./manifests.ts";
import type { LockfileRecord } from "./lockfiles.ts";
import type { RoadmapRecord } from "./roadmaps.ts";
import type { StampCheck, TemplateRecords, TemplateVersions } from "./templates.ts";
import type { ConventionsCheck } from "./conventions.ts";
import type { CoverageRun } from "./coverage.ts";

/** The version of the tables. A database of another version gets new tables. */
export const CATALOG_SCHEMA: string = "codeatlas/2";

const DDL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS repo (name TEXT PRIMARY KEY, owner TEXT, visibility TEXT NOT NULL DEFAULT 'public');
CREATE TABLE IF NOT EXISTS snapshot (
  id TEXT PRIMARY KEY, repo TEXT NOT NULL REFERENCES repo(name), "commit" TEXT, scanned_at TEXT NOT NULL,
  scanner TEXT NOT NULL, files INTEGER NOT NULL, parsed INTEGER NOT NULL, reused INTEGER NOT NULL, errors INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS blob (key TEXT PRIMARY KEY, oid TEXT NOT NULL, syntax TEXT NOT NULL, version TEXT NOT NULL, parse_error TEXT);
CREATE INDEX IF NOT EXISTS blob_oid ON blob(oid);
CREATE TABLE IF NOT EXISTS file (
  snapshot TEXT NOT NULL REFERENCES snapshot(id), path TEXT NOT NULL, blob TEXT NOT NULL REFERENCES blob(key),
  oid TEXT NOT NULL, bytes INTEGER NOT NULL, test INTEGER NOT NULL, PRIMARY KEY (snapshot, path)
);
CREATE INDEX IF NOT EXISTS file_blob ON file(blob);
CREATE TABLE IF NOT EXISTS symbol (
  blob TEXT NOT NULL REFERENCES blob(key), qualified_name TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
  parent TEXT, line INTEGER NOT NULL, end_line INTEGER NOT NULL, exported INTEGER NOT NULL,
  is_async INTEGER, is_generator INTEGER, params INTEGER, signature TEXT, nodes INTEGER,
  hash_exact TEXT, hash_renamed TEXT, hash_shape TEXT, cyclomatic INTEGER, depth INTEGER, type_hash TEXT, cognitive INTEGER,
  PRIMARY KEY (blob, qualified_name)
);
CREATE INDEX IF NOT EXISTS symbol_exact ON symbol(hash_exact) WHERE hash_exact IS NOT NULL;
CREATE INDEX IF NOT EXISTS symbol_renamed ON symbol(hash_renamed) WHERE hash_renamed IS NOT NULL;
CREATE INDEX IF NOT EXISTS symbol_shape ON symbol(hash_shape) WHERE hash_shape IS NOT NULL;
CREATE INDEX IF NOT EXISTS symbol_type ON symbol(type_hash) WHERE type_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS symbol_name ON symbol(name);
CREATE TABLE IF NOT EXISTS "export" (blob TEXT NOT NULL REFERENCES blob(key), name TEXT NOT NULL, symbol TEXT, "from" TEXT, type_only INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS export_blob ON "export"(blob);
CREATE TABLE IF NOT EXISTS "import" (
  blob TEXT NOT NULL REFERENCES blob(key), ordinal INTEGER NOT NULL, specifier TEXT NOT NULL, package TEXT,
  kind TEXT NOT NULL, names TEXT NOT NULL, line INTEGER NOT NULL, PRIMARY KEY (blob, ordinal)
);
CREATE INDEX IF NOT EXISTS import_package ON "import"(package) WHERE package IS NOT NULL;
CREATE TABLE IF NOT EXISTS call_site (
  blob TEXT NOT NULL REFERENCES blob(key), ordinal INTEGER NOT NULL, caller TEXT NOT NULL, callee TEXT NOT NULL,
  is_new INTEGER NOT NULL, line INTEGER NOT NULL, PRIMARY KEY (blob, ordinal)
);
CREATE INDEX IF NOT EXISTS call_site_callee ON call_site(callee);
CREATE TABLE IF NOT EXISTS marker (blob TEXT NOT NULL REFERENCES blob(key), kind TEXT NOT NULL, line INTEGER NOT NULL, text TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS marker_blob ON marker(blob);
CREATE TABLE IF NOT EXISTS formula (blob TEXT NOT NULL REFERENCES blob(key), line INTEGER NOT NULL, hash TEXT NOT NULL, skeleton TEXT NOT NULL, arith INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS formula_blob ON formula(blob);
CREATE INDEX IF NOT EXISTS formula_hash ON formula(hash);
-- Layer 1c: the manifests of each snapshot, and the dependencies of each manifest blob
CREATE TABLE IF NOT EXISTS manifest (
  snapshot TEXT NOT NULL REFERENCES snapshot(id), path TEXT NOT NULL, oid TEXT NOT NULL, name TEXT, version TEXT,
  private INTEGER NOT NULL, parse_error TEXT, PRIMARY KEY (snapshot, path)
);
CREATE INDEX IF NOT EXISTS manifest_oid ON manifest(oid);
CREATE TABLE IF NOT EXISTS dependency (
  oid TEXT NOT NULL, field TEXT NOT NULL, name TEXT NOT NULL, "range" TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (oid, field, name)
);
CREATE INDEX IF NOT EXISTS dependency_name ON dependency(name);
CREATE TABLE IF NOT EXISTS lockfile (
  snapshot TEXT NOT NULL REFERENCES snapshot(id), path TEXT NOT NULL, oid TEXT NOT NULL, version TEXT, parse_error TEXT,
  PRIMARY KEY (snapshot, path)
);
CREATE TABLE IF NOT EXISTS resolution (
  oid TEXT NOT NULL, manifest TEXT NOT NULL, field TEXT NOT NULL, name TEXT NOT NULL, specifier TEXT NOT NULL, version TEXT NOT NULL,
  PRIMARY KEY (oid, manifest, field, name)
);
CREATE INDEX IF NOT EXISTS resolution_name ON resolution(name);
-- Layer 1c: the roadmaps of each snapshot, and the items of each roadmap blob
CREATE TABLE IF NOT EXISTS roadmap (
  snapshot TEXT NOT NULL REFERENCES snapshot(id), path TEXT NOT NULL, oid TEXT NOT NULL, parse_error TEXT, PRIMARY KEY (snapshot, path)
);
CREATE TABLE IF NOT EXISTS roadmap_item (
  oid TEXT NOT NULL, line INTEGER NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, status_class TEXT NOT NULL,
  section TEXT NOT NULL, area TEXT, PRIMARY KEY (oid, line)
);
CREATE TABLE IF NOT EXISTS template_pin (
  snapshot TEXT NOT NULL REFERENCES snapshot(id), path TEXT NOT NULL, line INTEGER NOT NULL, target TEXT NOT NULL, ref TEXT NOT NULL,
  PRIMARY KEY (snapshot, path, line)
);
CREATE TABLE IF NOT EXISTS template_version (
  snapshot TEXT NOT NULL REFERENCES snapshot(id), ref TEXT NOT NULL, committed_at TEXT NOT NULL, path TEXT NOT NULL, oid TEXT NOT NULL,
  PRIMARY KEY (snapshot, ref, path)
);
DROP TABLE IF EXISTS stamp_rule;
CREATE TABLE IF NOT EXISTS stamp_check (
  snapshot TEXT PRIMARY KEY REFERENCES snapshot(id), template TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stamp_check_file (
  snapshot TEXT NOT NULL REFERENCES snapshot(id), path TEXT NOT NULL, state TEXT NOT NULL, fields TEXT NOT NULL, PRIMARY KEY (snapshot, path)
);
CREATE TABLE IF NOT EXISTS conventions_check (
  snapshot TEXT PRIMARY KEY REFERENCES snapshot(id), version TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conventions_rule (
  snapshot TEXT NOT NULL REFERENCES snapshot(id), rule TEXT NOT NULL, status TEXT NOT NULL, ignored INTEGER NOT NULL, note TEXT,
  PRIMARY KEY (snapshot, rule)
);
CREATE TABLE IF NOT EXISTS conventions_break (
  snapshot TEXT NOT NULL REFERENCES snapshot(id), rule TEXT NOT NULL, n INTEGER NOT NULL, file TEXT NOT NULL, line INTEGER,
  message TEXT NOT NULL, fixable INTEGER NOT NULL, PRIMARY KEY (snapshot, rule, n)
);
CREATE TABLE IF NOT EXISTS template_ref (
  snapshot TEXT NOT NULL REFERENCES snapshot(id), ref TEXT NOT NULL, committed_at TEXT NOT NULL, behind INTEGER NOT NULL,
  PRIMARY KEY (snapshot, ref)
);
CREATE TABLE IF NOT EXISTS template_use (
  snapshot TEXT NOT NULL REFERENCES snapshot(id), target TEXT NOT NULL, path TEXT NOT NULL, PRIMARY KEY (snapshot, target, path)
);
CREATE TABLE IF NOT EXISTS template_file (
  snapshot TEXT NOT NULL REFERENCES snapshot(id), path TEXT NOT NULL, oid TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (snapshot, path)
);
CREATE TABLE IF NOT EXISTS coverage_run (
  snapshot TEXT PRIMARY KEY REFERENCES snapshot(id), run_id INTEGER NOT NULL, "commit" TEXT NOT NULL, created_at TEXT NOT NULL,
  artifacts TEXT NOT NULL, unmatched INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS coverage_file (
  snapshot TEXT NOT NULL REFERENCES snapshot(id), path TEXT NOT NULL, statements INTEGER NOT NULL, statements_covered INTEGER NOT NULL,
  branches INTEGER NOT NULL, branches_covered INTEGER NOT NULL, functions INTEGER NOT NULL, functions_covered INTEGER NOT NULL,
  lines INTEGER NOT NULL, lines_covered INTEGER NOT NULL, PRIMARY KEY (snapshot, path)
);
CREATE TABLE IF NOT EXISTS coverage_function (
  snapshot TEXT NOT NULL REFERENCES snapshot(id), path TEXT NOT NULL, line INTEGER NOT NULL, name TEXT NOT NULL, hits INTEGER NOT NULL,
  PRIMARY KEY (snapshot, path, line, name)
);
-- Layer 1c: the churn of each file in the window of days before the scan, from the git history
CREATE TABLE IF NOT EXISTS churn_run (
  snapshot TEXT PRIMARY KEY REFERENCES snapshot(id), days INTEGER NOT NULL, "until" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS churn (
  snapshot TEXT NOT NULL REFERENCES snapshot(id), path TEXT NOT NULL, commits INTEGER NOT NULL, authors INTEGER NOT NULL,
  last_at TEXT NOT NULL, PRIMARY KEY (snapshot, path)
);
CREATE TABLE IF NOT EXISTS label (
  subject TEXT NOT NULL, task TEXT NOT NULL, "by" TEXT NOT NULL, label TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (subject, task, "by")
);
-- The newest snapshot of each repository, and its files
CREATE VIEW IF NOT EXISTS current_snapshot AS
  SELECT s.* FROM snapshot s WHERE s.scanned_at = (SELECT max(t.scanned_at) FROM snapshot t WHERE t.repo = s.repo);
CREATE VIEW IF NOT EXISTS current_file AS
  SELECT s.repo, f.* FROM file f JOIN current_snapshot s ON s.id = f.snapshot;
CREATE VIEW IF NOT EXISTS current_manifest AS
  SELECT s.repo, m.* FROM manifest m JOIN current_snapshot s ON s.id = m.snapshot;
CREATE VIEW IF NOT EXISTS current_lockfile AS
  SELECT s.repo, l.* FROM lockfile l JOIN current_snapshot s ON s.id = l.snapshot;
CREATE VIEW IF NOT EXISTS current_roadmap AS
  SELECT s.repo, r.* FROM roadmap r JOIN current_snapshot s ON s.id = r.snapshot;
CREATE VIEW IF NOT EXISTS current_roadmap_item AS
  SELECT r.repo, r.path, i.* FROM current_roadmap r JOIN roadmap_item i ON i.oid = r.oid;
CREATE VIEW IF NOT EXISTS current_template_pin AS
  SELECT s.repo, p.* FROM template_pin p JOIN current_snapshot s ON s.id = p.snapshot;
CREATE VIEW IF NOT EXISTS current_template_file AS
  SELECT s.repo, t.* FROM template_file t JOIN current_snapshot s ON s.id = t.snapshot;
`;

/** The catalog database, with the statements of the scan. */
/** One label of the sample: the answer of one source for one subject and one task. */
export interface Label {
  /** The `hash_renamed` of a function, or the key of a package or a file. */
  readonly subject: string;
  readonly task: string;
  /** The source of the label: a person, or a draft of a session. */
  readonly by: string;
  /** The answer, in the schema of the task. */
  readonly label: unknown;
  readonly at: string;
}

export class Catalog {
  readonly db: DatabaseSync;
  readonly #has: StatementSync;
  readonly #blob: StatementSync;
  readonly #symbol: StatementSync;
  readonly #export: StatementSync;
  readonly #import: StatementSync;
  readonly #call: StatementSync;
  readonly #marker: StatementSync;
  readonly #formula: StatementSync;

  /** This constructor opens the file at `path`, or a database in memory for `:memory:`, and makes the tables. */
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;");
    const version = schemaOf(this.db);
    if (version !== undefined && version !== CATALOG_SCHEMA) {
      this.db.close();
      throw new Error(`The database has the schema ${version}, not ${CATALOG_SCHEMA}.`);
    }
    this.db.exec(DDL);
    addColumns(this.db);
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)").run(CATALOG_SCHEMA);
    this.#has = this.db.prepare("SELECT 1 AS found FROM blob WHERE key = ?");
    this.#blob = this.db.prepare("INSERT INTO blob (key, oid, syntax, version, parse_error) VALUES (?, ?, ?, ?, ?)");
    this.#symbol = this.db.prepare(
      "INSERT INTO symbol (blob, qualified_name, name, kind, parent, line, end_line, exported, is_async, is_generator, params, signature, nodes, hash_exact, hash_renamed, hash_shape, cyclomatic, depth, type_hash, cognitive) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    this.#export = this.db.prepare('INSERT INTO "export" (blob, name, symbol, "from", type_only) VALUES (?, ?, ?, ?, ?)');
    this.#import = this.db.prepare('INSERT INTO "import" (blob, ordinal, specifier, package, kind, names, line) VALUES (?, ?, ?, ?, ?, ?, ?)');
    this.#call = this.db.prepare("INSERT INTO call_site (blob, ordinal, caller, callee, is_new, line) VALUES (?, ?, ?, ?, ?, ?)");
    this.#marker = this.db.prepare("INSERT INTO marker (blob, kind, line, text) VALUES (?, ?, ?, ?)");
    this.#formula = this.db.prepare("INSERT INTO formula (blob, line, hash, skeleton, arith) VALUES (?, ?, ?, ?, ?)");
  }

  /** The cache of the scan (`factsOfRepo`): a key is known when the database has its blob. */
  has(key: string): boolean {
    return this.#has.get(key) !== undefined;
  }

  /** This method writes the facts of one blob. The key is `<oid>:<syntax>:<version>` (`factsKey`). */
  set(key: string, value: BlobFacts): this {
    const [oid = "", syntax = "", version = ""] = key.split(":");
    this.#transaction(() => {
      this.#blob.run(key, oid, syntax, version, value.ok ? null : value.error);
      if (value.ok) this.#facts(key, value.facts);
    });
    return this;
  }

  #facts(key: string, facts: FileFacts): void {
    const bool = (value: boolean): number => (value ? 1 : 0);
    for (const s of facts.symbols) {
      const fn = s.fn;
      this.#symbol.run(
        key, s.qualifiedName, s.name, s.kind, s.parent, s.line, s.endLine, bool(s.exported),
        fn === null ? null : bool(fn.async), fn === null ? null : bool(fn.generator), fn?.params ?? null, fn?.signature ?? null, fn?.nodes ?? null,
        fn?.hashExact ?? null, fn?.hashRenamed ?? null, fn?.hashShape ?? null, fn?.cyclomatic ?? null, fn?.depth ?? null, s.typeHash, fn?.cognitive ?? null,
      );
    }
    for (const e of facts.exports) this.#export.run(key, e.name, e.symbol, e.from, bool(e.typeOnly));
    for (const i of facts.imports) this.#import.run(key, i.ordinal, i.specifier, i.package, i.kind, JSON.stringify(i.names), i.line);
    for (const c of facts.callSites) this.#call.run(key, c.ordinal, c.caller, c.callee, bool(c.isNew), c.line);
    for (const m of facts.markers) this.#marker.run(key, m.kind, m.line, m.text);
    for (const f of facts.formulas) this.#formula.run(key, f.line, f.hash, f.skeleton, f.arith);
  }

  #snapshotRefs: readonly string[] | undefined;

  /** This method gives each table with a foreign key to `snapshot`, from the schema, so a new table is not missed. */
  #snapshotTables(): readonly string[] {
    this.#snapshotRefs ??= this.db
      .prepare(`SELECT m.name AS name FROM sqlite_master m, pragma_foreign_key_list(m.name) f WHERE m.type = 'table' AND f."table" = 'snapshot' ORDER BY m.name`)
      .all()
      .map((row) => String(row["name"]));
    return this.#snapshotRefs;
  }

  #transaction(work: () => void): void {
    this.db.exec("BEGIN");
    try {
      work();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * This method writes a snapshot of one repository and its files. Each blob of the files must be in the database.
   * A second scan of one commit replaces the rows of the first.
   */
  putSnapshot(repo: string, commit: string | null, scannedAt: string, scanner: string, files: readonly FileRecord[], counts: ScanCounts): string {
    const id = `${repo}@${commit ?? "worktree"}`;
    this.#transaction(() => {
      this.db.prepare("INSERT OR IGNORE INTO repo (name) VALUES (?)").run(repo);
      // The rows of each table that refers to the snapshot go first. The put method of each source writes them again
      for (const table of this.#snapshotTables()) this.db.prepare(`DELETE FROM ${table} WHERE snapshot = ?`).run(id);
      this.db.prepare("DELETE FROM snapshot WHERE id = ?").run(id);
      this.db
        .prepare('INSERT INTO snapshot (id, repo, "commit", scanned_at, scanner, files, parsed, reused, errors) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, repo, commit, scannedAt, scanner, counts.files, counts.parsed, counts.reused, counts.errors);
      const insert = this.db.prepare("INSERT INTO file (snapshot, path, blob, oid, bytes, test) VALUES (?, ?, ?, ?, ?, ?)");
      for (const file of files) insert.run(id, file.path, factsKey(file.blob, file.path), file.blob, file.bytes, file.test ? 1 : 0);
    });
    return id;
  }

  /**
   * The summary of the current snapshots, from SQL. It has the fields of `factsSummary`, so the two agree.
   * The time and the parse counts come from the caller.
   */
  summary(counts: Pick<FactsSummary, "parsed" | "reused" | "errors" | "bytesParsed" | "ms">): FactsSummary {
    const one = (sql: string): number => Number((this.db.prepare(sql).get() as { n?: number } | undefined)?.n ?? 0);
    // Each fact counts once for each file that holds its blob, as factsSummary counts it
    const perFile = (table: string): number => one(`SELECT count(*) AS n FROM current_file f JOIN ${table} t ON t.blob = f.blob`);
    const markers: Partial<Record<MarkerKind, number>> = {};
    for (const row of this.db.prepare("SELECT m.kind AS kind, count(*) AS n FROM current_file f JOIN marker m ON m.blob = f.blob GROUP BY m.kind ORDER BY m.kind").all() as { kind: MarkerKind; n: number }[]) {
      markers[row.kind] = Number(row.n);
    }
    const classes = (column: string) => {
      const row = this.db
        .prepare(
          `SELECT count(*) AS classes, coalesce(sum(size), 0) AS members FROM (
             SELECT count(*) AS size FROM current_file f JOIN symbol s ON s.blob = f.blob
             WHERE s.${column} IS NOT NULL AND s.nodes >= ${CLASS_MIN_NODES} AND f.test = 0
             GROUP BY s.${column} HAVING count(*) >= 2)`,
        )
        .get() as { classes: number; members: number };
      return { classes: Number(row.classes), members: Number(row.members) };
    };
    const breaks = (from: string, to: string): number =>
      one(`SELECT count(*) AS n FROM (SELECT ${from} FROM symbol WHERE ${from} IS NOT NULL GROUP BY ${from} HAVING count(DISTINCT ${to}) > 1)`);
    return {
      repos: one("SELECT count(*) AS n FROM current_snapshot"),
      files: one("SELECT count(*) AS n FROM current_file"),
      ...counts,
      symbols: perFile("symbol"),
      functions: one("SELECT count(*) AS n FROM current_file f JOIN symbol s ON s.blob = f.blob WHERE s.hash_shape IS NOT NULL"),
      callSites: perFile("call_site"),
      imports: perFile('"import"'),
      exports: perFile('"export"'),
      markers,
      classes: { exact: classes("hash_exact"), renamed: classes("hash_renamed"), shape: classes("hash_shape") },
      lawBreaks: breaks("hash_exact", "hash_renamed") + breaks("hash_renamed", "hash_shape"),
    };
  }

  /**
   * This method writes labels of the sample. A label of one subject, task and source replaces the earlier one. The
   * labels come from the files of the repository, so a new database gets them again.
   */
  putLabels(labels: readonly Label[]): void {
    const insert = this.db.prepare('INSERT OR REPLACE INTO label (subject, task, "by", label, at) VALUES (?, ?, ?, ?, ?)');
    this.#transaction(() => {
      for (const label of labels) insert.run(label.subject, label.task, label.by, JSON.stringify(label.label), label.at);
    });
  }

  /** The files of the current snapshots that the scan could not read, with the error of the parser. */
/**
   * This method puts the manifests of the snapshot `snapshot` in place of its old ones. The dependencies of a
   * manifest blob that the catalog knows stay as they are: they depend on the blob only.
   */
  putManifests(snapshot: string, manifests: readonly ManifestRecord[]): void {
    this.#transaction(() => {
      this.db.prepare("DELETE FROM manifest WHERE snapshot = ?").run(snapshot);
      const manifest = this.db.prepare("INSERT INTO manifest (snapshot, path, oid, name, version, private, parse_error) VALUES (?, ?, ?, ?, ?, ?, ?)");
      const dependency = this.db.prepare('INSERT OR IGNORE INTO dependency (oid, field, name, "range", kind) VALUES (?, ?, ?, ?, ?)');
      for (const m of manifests) {
        manifest.run(snapshot, m.path, m.oid, m.facts?.name ?? null, m.facts?.version ?? null, m.facts?.private === true ? 1 : 0, m.error);
        for (const d of m.facts?.dependencies ?? []) dependency.run(m.oid, d.field, d.name, d.range, d.kind);
      }
    });
  }

/** This method puts the lockfiles of the snapshot `snapshot` in place of its old ones, as `putManifests` does. */
  putLockfiles(snapshot: string, lockfiles: readonly LockfileRecord[]): void {
    this.#transaction(() => {
      this.db.prepare("DELETE FROM lockfile WHERE snapshot = ?").run(snapshot);
      const lockfile = this.db.prepare("INSERT INTO lockfile (snapshot, path, oid, version, parse_error) VALUES (?, ?, ?, ?, ?)");
      const resolution = this.db.prepare("INSERT OR IGNORE INTO resolution (oid, manifest, field, name, specifier, version) VALUES (?, ?, ?, ?, ?, ?)");
      for (const l of lockfiles) {
        lockfile.run(snapshot, l.path, l.oid, l.facts?.version ?? null, l.error);
        for (const r of l.facts?.resolved ?? []) resolution.run(l.oid, r.manifest, r.field, r.name, r.specifier, r.version);
      }
    });
  }

  /**
   * This method puts the roadmaps of the snapshot `snapshot` in place of its old ones. It writes the items of each
   * roadmap blob again, so a new version of the parser corrects them.
   */
  putRoadmaps(snapshot: string, roadmaps: readonly RoadmapRecord[]): void {
    this.#transaction(() => {
      this.db.prepare("DELETE FROM roadmap WHERE snapshot = ?").run(snapshot);
      const roadmap = this.db.prepare("INSERT INTO roadmap (snapshot, path, oid, parse_error) VALUES (?, ?, ?, ?)");
      const clear = this.db.prepare("DELETE FROM roadmap_item WHERE oid = ?");
      const item = this.db.prepare("INSERT OR IGNORE INTO roadmap_item (oid, line, id, title, status, status_class, section, area) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      for (const r of roadmaps) {
        roadmap.run(snapshot, r.path, r.oid, r.error);
        if (r.items === null) continue;
        clear.run(r.oid);
        for (const i of r.items) item.run(r.oid, i.line, i.id, i.title, i.status, i.statusClass, i.section, i.area);
      }
    });
  }

  /** This method puts the template records of the snapshot `snapshot` in place of its old ones, as `putManifests` does. */
  putTemplateRecords(snapshot: string, records: TemplateRecords): void {
    this.#transaction(() => {
      this.db.prepare("DELETE FROM template_pin WHERE snapshot = ?").run(snapshot);
      this.db.prepare("DELETE FROM template_file WHERE snapshot = ?").run(snapshot);
      const pin = this.db.prepare("INSERT INTO template_pin (snapshot, path, line, target, ref) VALUES (?, ?, ?, ?, ?)");
      const file = this.db.prepare("INSERT INTO template_file (snapshot, path, oid, hash) VALUES (?, ?, ?, ?)");
      for (const p of records.pins) pin.run(snapshot, p.path, p.line, p.target, p.ref);
      for (const f of records.files) file.run(snapshot, f.path, f.oid, f.hash);
    });
  }

  /** This method replaces the content of the pins of the template snapshot `snapshot`. */
  putTemplateVersions(snapshot: string, records: TemplateVersions): void {
    this.#transaction(() => {
      this.db.prepare("DELETE FROM template_version WHERE snapshot = ?").run(snapshot);
      this.db.prepare("DELETE FROM template_use WHERE snapshot = ?").run(snapshot);
      this.db.prepare("DELETE FROM template_ref WHERE snapshot = ?").run(snapshot);
      const ref = this.db.prepare("INSERT INTO template_ref (snapshot, ref, committed_at, behind) VALUES (?, ?, ?, ?)");
      for (const v of records.versions) ref.run(snapshot, v.ref, v.committedAt, v.behind);
      const version = this.db.prepare("INSERT INTO template_version (snapshot, ref, committed_at, path, oid) VALUES (?, ?, ?, ?, ?)");
      const use = this.db.prepare("INSERT INTO template_use (snapshot, target, path) VALUES (?, ?, ?)");
      for (const v of records.versions) for (const f of v.files) version.run(snapshot, v.ref, v.committedAt, f.path, f.oid);
      for (const u of records.uses) use.run(snapshot, u.target, u.path);
    });
  }

  /** This method replaces the result of `stamp --check` for the snapshot `snapshot`. */
  putStampCheck(snapshot: string, check: StampCheck): void {
    this.#transaction(() => {
      this.db.prepare("DELETE FROM stamp_check WHERE snapshot = ?").run(snapshot);
      this.db.prepare("DELETE FROM stamp_check_file WHERE snapshot = ?").run(snapshot);
      this.db.prepare("INSERT INTO stamp_check (snapshot, template) VALUES (?, ?)").run(snapshot, check.template);
      const file = this.db.prepare("INSERT OR REPLACE INTO stamp_check_file (snapshot, path, state, fields) VALUES (?, ?, ?, ?)");
      for (const f of check.files) file.run(snapshot, f.path, f.state, JSON.stringify(f.fields));
    });
  }

  /** This method replaces the result of the conventions check for the snapshot `snapshot`. */
  putConventionsCheck(snapshot: string, check: ConventionsCheck): void {
    this.#transaction(() => {
      for (const table of ["conventions_check", "conventions_rule", "conventions_break"]) this.db.prepare(`DELETE FROM ${table} WHERE snapshot = ?`).run(snapshot);
      this.db.prepare("INSERT INTO conventions_check (snapshot, version) VALUES (?, ?)").run(snapshot, check.version);
      const rule = this.db.prepare("INSERT INTO conventions_rule (snapshot, rule, status, ignored, note) VALUES (?, ?, ?, ?, ?)");
      const broken = this.db.prepare("INSERT INTO conventions_break (snapshot, rule, n, file, line, message, fixable) VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const r of check.rules) {
        rule.run(snapshot, r.rule, r.status, r.ignored, r.note);
        r.breaks.forEach((b, n) => broken.run(snapshot, r.rule, n, b.file, b.line, b.message, b.fixable ? 1 : 0));
      }
    });
  }

  /** This method replaces the coverage of the snapshot `snapshot`. */
  /**
   * This method writes the churn of the files of a snapshot in the window of `days` that ends at `until`. A file with
   * no row in a snapshot with a `churn_run` row has no commit in the window.
   */
  putChurn(snapshot: string, days: number, until: string, churn: readonly FileChurn[]): void {
    this.#transaction(() => {
      for (const table of ["churn_run", "churn"]) this.db.prepare(`DELETE FROM ${table} WHERE snapshot = ?`).run(snapshot);
      this.db.prepare('INSERT INTO churn_run (snapshot, days, "until") VALUES (?, ?, ?)').run(snapshot, days, until);
      const insert = this.db.prepare("INSERT INTO churn (snapshot, path, commits, authors, last_at) VALUES (?, ?, ?, ?, ?)");
      for (const c of churn) insert.run(snapshot, c.path, c.commits, c.authors, c.lastAt);
    });
  }

  putCoverage(snapshot: string, run: CoverageRun): void {
    this.#transaction(() => {
      for (const table of ["coverage_run", "coverage_file", "coverage_function"]) this.db.prepare(`DELETE FROM ${table} WHERE snapshot = ?`).run(snapshot);
      this.db
        .prepare('INSERT INTO coverage_run (snapshot, run_id, "commit", created_at, artifacts, unmatched) VALUES (?, ?, ?, ?, ?, ?)')
        .run(snapshot, run.runId, run.commit, run.createdAt, JSON.stringify(run.artifacts), run.unmatched);
      const file = this.db.prepare(
        "INSERT INTO coverage_file (snapshot, path, statements, statements_covered, branches, branches_covered, functions, functions_covered, lines, lines_covered) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const f of run.files) {
        file.run(snapshot, f.path, f.statements.total, f.statements.covered, f.branches.total, f.branches.covered, f.functions.total, f.functions.covered, f.lines.total, f.lines.covered);
      }
      const fn = this.db.prepare("INSERT OR IGNORE INTO coverage_function (snapshot, path, line, name, hits) VALUES (?, ?, ?, ?, ?)");
      for (const f of run.functions) fn.run(snapshot, f.path, f.line, f.name, f.hits);
    });
  }

  unread(): Unread[] {
    return (
      this.db
        .prepare("SELECT f.repo AS repo, f.path AS path, b.parse_error AS error FROM current_file f JOIN blob b ON b.key = f.blob WHERE b.parse_error IS NOT NULL ORDER BY f.repo, f.path")
        .all() as unknown as Unread[]
    ).map((row) => ({ repo: row.repo, path: row.path, error: row.error }));
  }

  close(): void {
    this.db.close();
  }
}

/** The columns that came after the first release of a schema, by table. A new facts version fills them. */
const ADDED_COLUMNS: readonly { readonly table: string; readonly column: string; readonly type: string }[] = [{ table: "symbol", column: "cognitive", type: "INTEGER" }];

/** This function adds each column of `ADDED_COLUMNS` that an older database of the same schema does not have. */
function addColumns(db: DatabaseSync): void {
  for (const { table, column, type } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/** This function gives the schema of the catalog in `db`, or undefined for a database without the table `meta`. */
function schemaOf(db: DatabaseSync): string | undefined {
  const table = db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
  if (table === undefined) return undefined;
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value?: string } | undefined;
  return row?.value;
}

/**
 * This function opens the catalog file at `path` to read only, for the tools of agents. It throws when the file has
 * no catalog or a catalog of another schema. A read-only connection cannot change the file.
 */
export function readOnlyCatalog(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly: true });
  const version = schemaOf(db);
  if (version !== CATALOG_SCHEMA) {
    db.close();
    throw new Error(version === undefined ? `The file ${path} has no catalog.` : `The database has the schema ${version}, not ${CATALOG_SCHEMA}.`);
  }
  return db;
}
