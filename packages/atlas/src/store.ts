/**
 * The catalog database: the Layer 1a tables, and the manifests, lockfiles and template records of Layer 1c of `docs/SCHEMA.md`, in one SQLite file through `node:sqlite`.
 * The blob tables are also the cache of the scan. A rescan with the database of the last run parses only new blobs.
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { factsKey, type BlobFacts, type FileRecord, type ScanCounts } from "./blobs.ts";
import { CLASS_MIN_NODES, type FactsSummary, type Unread } from "./summary.ts";
import type { FileFacts, MarkerKind } from "./facts.ts";
import type { ManifestRecord } from "./manifests.ts";
import type { LockfileRecord } from "./lockfiles.ts";
import type { TemplateRecords } from "./templates.ts";

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
  hash_exact TEXT, hash_renamed TEXT, hash_shape TEXT, cyclomatic INTEGER, depth INTEGER, type_hash TEXT,
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
CREATE TABLE IF NOT EXISTS template_pin (
  snapshot TEXT NOT NULL REFERENCES snapshot(id), path TEXT NOT NULL, line INTEGER NOT NULL, target TEXT NOT NULL, ref TEXT NOT NULL,
  PRIMARY KEY (snapshot, path, line)
);
CREATE TABLE IF NOT EXISTS template_file (
  snapshot TEXT NOT NULL REFERENCES snapshot(id), path TEXT NOT NULL, oid TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (snapshot, path)
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
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)").run(CATALOG_SCHEMA);
    this.#has = this.db.prepare("SELECT 1 AS found FROM blob WHERE key = ?");
    this.#blob = this.db.prepare("INSERT INTO blob (key, oid, syntax, version, parse_error) VALUES (?, ?, ?, ?, ?)");
    this.#symbol = this.db.prepare(
      "INSERT INTO symbol (blob, qualified_name, name, kind, parent, line, end_line, exported, is_async, is_generator, params, signature, nodes, hash_exact, hash_renamed, hash_shape, cyclomatic, depth, type_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    this.#export = this.db.prepare('INSERT INTO "export" (blob, name, symbol, "from", type_only) VALUES (?, ?, ?, ?, ?)');
    this.#import = this.db.prepare('INSERT INTO "import" (blob, ordinal, specifier, package, kind, names, line) VALUES (?, ?, ?, ?, ?, ?, ?)');
    this.#call = this.db.prepare("INSERT INTO call_site (blob, ordinal, caller, callee, is_new, line) VALUES (?, ?, ?, ?, ?, ?)");
    this.#marker = this.db.prepare("INSERT INTO marker (blob, kind, line, text) VALUES (?, ?, ?, ?)");
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
        fn?.hashExact ?? null, fn?.hashRenamed ?? null, fn?.hashShape ?? null, fn?.cyclomatic ?? null, fn?.depth ?? null, s.typeHash,
      );
    }
    for (const e of facts.exports) this.#export.run(key, e.name, e.symbol, e.from, bool(e.typeOnly));
    for (const i of facts.imports) this.#import.run(key, i.ordinal, i.specifier, i.package, i.kind, JSON.stringify(i.names), i.line);
    for (const c of facts.callSites) this.#call.run(key, c.ordinal, c.caller, c.callee, bool(c.isNew), c.line);
    for (const m of facts.markers) this.#marker.run(key, m.kind, m.line, m.text);
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
      this.db.prepare("DELETE FROM file WHERE snapshot = ?").run(id);
      // The rows of the other sources of the snapshot refer to it. Their put methods write them again
      this.db.prepare("DELETE FROM manifest WHERE snapshot = ?").run(id);
      this.db.prepare("DELETE FROM lockfile WHERE snapshot = ?").run(id);
      this.db.prepare("DELETE FROM template_pin WHERE snapshot = ?").run(id);
      this.db.prepare("DELETE FROM template_file WHERE snapshot = ?").run(id);
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
