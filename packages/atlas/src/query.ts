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

const SNAPSHOT = {
  id: "text",
  repo: "text",
  commit: "text?",
  scanned_at: "text",
  scanner: "text",
  files: "integer",
  parsed: "integer",
  reused: "integer",
  errors: "integer",
} as const;

const FILE = { snapshot: "text", path: "text", blob: "text", oid: "text", bytes: "integer", test: "integer" } as const;

/** The columns of each table and view of the catalog, in the order of the DDL of `store.ts`. */
export const CATALOG_COLUMNS = {
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
  current_snapshot: SNAPSHOT,
  current_file: { repo: "text", ...FILE },
} as const satisfies Record<string, Record<string, ColumnType>>;

/** The names of the views. A view has the columns of its tables, and `PRAGMA table_info` does not give `NOT NULL`. */
export const CATALOG_VIEWS: ReadonlySet<string> = new Set(["current_snapshot", "current_file"]);

type Columns = typeof CATALOG_COLUMNS;

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
