/**
 * The typed query layer of the catalog (Layer 3 of `docs/SCHEMA.md`). The columns of each table and view are data
 * in `CATALOG_COLUMNS`. The types of the queries come from that data, so a query of a column that does not exist
 * does not compile. A test compares the data with the tables of the database, so the data and the DDL agree.
 */
import type { DatabaseSync } from "node:sqlite";
import { Kysely, SqliteDialect, type SqliteDatabase } from "kysely";

/** The type of a column: its SQLite type, and `?` when it can be `NULL`. */
export type ColumnType = "text" | "text?" | "integer" | "integer?";

/** The value of a column of type `T`. An `integer` of a flag is 0 or 1. */
export type ValueOf<T> = T extends "text" ? string : T extends "text?" ? string | null : T extends "integer" ? number : T extends "integer?" ? number | null : never;

interface SnapshotColumns {
  readonly id: "text";
  readonly repo: "text";
  readonly commit: "text?";
  readonly scanned_at: "text";
  readonly scanner: "text";
  readonly files: "integer";
  readonly parsed: "integer";
  readonly reused: "integer";
  readonly errors: "integer";
}

interface FileColumns {
  readonly snapshot: "text";
  readonly path: "text";
  readonly blob: "text";
  readonly oid: "text";
  readonly bytes: "integer";
  readonly test: "integer";
}

/**
 * The type of `CATALOG_COLUMNS`. Each column has a literal type, so the compiler refuses a value that has a
 * different column or type.
 */
export interface CatalogColumns {
  readonly meta: { readonly key: "text"; readonly value: "text" };
  readonly repo: { readonly name: "text"; readonly owner: "text?"; readonly visibility: "text" };
  readonly snapshot: SnapshotColumns;
  readonly blob: { readonly key: "text"; readonly oid: "text"; readonly syntax: "text"; readonly version: "text"; readonly parse_error: "text?" };
  readonly file: FileColumns;
  readonly symbol: {
    readonly blob: "text";
    readonly qualified_name: "text";
    readonly name: "text";
    readonly kind: "text";
    readonly parent: "text?";
    readonly line: "integer";
    readonly end_line: "integer";
    readonly exported: "integer";
    readonly is_async: "integer?";
    readonly is_generator: "integer?";
    readonly params: "integer?";
    readonly signature: "text?";
    readonly nodes: "integer?";
    readonly hash_exact: "text?";
    readonly hash_renamed: "text?";
    readonly hash_shape: "text?";
    readonly cyclomatic: "integer?";
    readonly depth: "integer?";
    readonly type_hash: "text?";
  };
  readonly export: { readonly blob: "text"; readonly name: "text"; readonly symbol: "text?"; readonly from: "text?"; readonly type_only: "integer" };
  readonly import: {
    readonly blob: "text";
    readonly ordinal: "integer";
    readonly specifier: "text";
    readonly package: "text?";
    readonly kind: "text";
    readonly names: "text";
    readonly line: "integer";
  };
  readonly call_site: { readonly blob: "text"; readonly ordinal: "integer"; readonly caller: "text"; readonly callee: "text"; readonly is_new: "integer"; readonly line: "integer" };
  readonly marker: { readonly blob: "text"; readonly kind: "text"; readonly line: "integer"; readonly text: "text" };
  readonly manifest: ManifestColumns;
  readonly dependency: { readonly oid: "text"; readonly field: "text"; readonly name: "text"; readonly range: "text"; readonly kind: "text" };
  readonly lockfile: LockfileColumns;
  readonly resolution: { readonly oid: "text"; readonly manifest: "text"; readonly field: "text"; readonly name: "text"; readonly specifier: "text"; readonly version: "text" };
  readonly template_pin: TemplatePinColumns;
  readonly template_file: TemplateFileColumns;
  readonly label: { readonly subject: "text"; readonly task: "text"; readonly by: "text"; readonly label: "text"; readonly at: "text" };
  readonly current_snapshot: SnapshotColumns;
  readonly current_file: { readonly repo: "text" } & FileColumns;
  readonly current_manifest: { readonly repo: "text" } & ManifestColumns;
  readonly current_lockfile: { readonly repo: "text" } & LockfileColumns;
  readonly current_template_pin: { readonly repo: "text" } & TemplatePinColumns;
  readonly current_template_file: { readonly repo: "text" } & TemplateFileColumns;
}

interface TemplatePinColumns {
  readonly snapshot: "text";
  readonly path: "text";
  readonly line: "integer";
  readonly target: "text";
  readonly ref: "text";
}

const TEMPLATE_PIN: TemplatePinColumns = { snapshot: "text", path: "text", line: "integer", target: "text", ref: "text" };

interface TemplateFileColumns {
  readonly snapshot: "text";
  readonly path: "text";
  readonly oid: "text";
  readonly hash: "text";
}

const TEMPLATE_FILE: TemplateFileColumns = { snapshot: "text", path: "text", oid: "text", hash: "text" };

interface LockfileColumns {
  readonly snapshot: "text";
  readonly path: "text";
  readonly oid: "text";
  readonly version: "text?";
  readonly parse_error: "text?";
}

const LOCKFILE: LockfileColumns = { snapshot: "text", path: "text", oid: "text", version: "text?", parse_error: "text?" };

interface ManifestColumns {
  readonly snapshot: "text";
  readonly path: "text";
  readonly oid: "text";
  readonly name: "text?";
  readonly version: "text?";
  readonly private: "integer";
  readonly parse_error: "text?";
}

const MANIFEST: ManifestColumns = { snapshot: "text", path: "text", oid: "text", name: "text?", version: "text?", private: "integer", parse_error: "text?" };

const SNAPSHOT: SnapshotColumns = {
  id: "text",
  repo: "text",
  commit: "text?",
  scanned_at: "text",
  scanner: "text",
  files: "integer",
  parsed: "integer",
  reused: "integer",
  errors: "integer",
};

const FILE: FileColumns = { snapshot: "text", path: "text", blob: "text", oid: "text", bytes: "integer", test: "integer" };

/** The columns of each table and view of the catalog, in the order of the DDL of `store.ts`. */
export const CATALOG_COLUMNS: CatalogColumns = {
  meta: { key: "text", value: "text" },
  repo: { name: "text", owner: "text?", visibility: "text" },
  snapshot: SNAPSHOT,
  blob: { key: "text", oid: "text", syntax: "text", version: "text", parse_error: "text?" },
  file: FILE,
  symbol: {
    blob: "text",
    qualified_name: "text",
    name: "text",
    kind: "text",
    parent: "text?",
    line: "integer",
    end_line: "integer",
    exported: "integer",
    is_async: "integer?",
    is_generator: "integer?",
    params: "integer?",
    signature: "text?",
    nodes: "integer?",
    hash_exact: "text?",
    hash_renamed: "text?",
    hash_shape: "text?",
    cyclomatic: "integer?",
    depth: "integer?",
    type_hash: "text?",
  },
  export: { blob: "text", name: "text", symbol: "text?", from: "text?", type_only: "integer" },
  import: { blob: "text", ordinal: "integer", specifier: "text", package: "text?", kind: "text", names: "text", line: "integer" },
  call_site: { blob: "text", ordinal: "integer", caller: "text", callee: "text", is_new: "integer", line: "integer" },
  marker: { blob: "text", kind: "text", line: "integer", text: "text" },
  manifest: MANIFEST,
  dependency: { oid: "text", field: "text", name: "text", range: "text", kind: "text" },
  lockfile: LOCKFILE,
  resolution: { oid: "text", manifest: "text", field: "text", name: "text", specifier: "text", version: "text" },
  template_pin: TEMPLATE_PIN,
  template_file: TEMPLATE_FILE,
  label: { subject: "text", task: "text", by: "text", label: "text", at: "text" },
  current_snapshot: SNAPSHOT,
  current_file: { repo: "text", ...FILE },
  current_manifest: { repo: "text", ...MANIFEST },
  current_lockfile: { repo: "text", ...LOCKFILE },
  current_template_pin: { repo: "text", ...TEMPLATE_PIN },
  current_template_file: { repo: "text", ...TEMPLATE_FILE },
};

/** The names of the views. A view has the columns of its tables, and `PRAGMA table_info` does not give `NOT NULL`. */
export const CATALOG_VIEWS: ReadonlySet<string> = new Set(["current_snapshot", "current_file", "current_manifest", "current_lockfile", "current_template_pin", "current_template_file"]);

type Columns = CatalogColumns;

/** The rows of each table and view, for `Kysely`. */
export type CatalogTables = { [T in keyof Columns]: { [C in keyof Columns[T]]: ValueOf<Columns[T][C]> } };

/** The query builder of a catalog. */
export type CatalogQuery = Kysely<CatalogTables>;

/**
 * This function gives a typed query builder over an open database. The builder does not close the database:
 * the owner of the database closes it.
 */
export function queryOf(db: DatabaseSync): CatalogQuery {
  const database: SqliteDatabase = {
    close: () => undefined,
    prepare(text) {
      const statement = db.prepare(text);
      return {
        reader: statement.columns().length > 0,
        all: (parameters) => statement.all(...(parameters as never[])),
        run: (parameters) => statement.run(...(parameters as never[])),
        iterate: (parameters) => statement.iterate(...(parameters as never[])),
      };
    },
  };
  return new Kysely<CatalogTables>({ dialect: new SqliteDialect({ database }) });
}
