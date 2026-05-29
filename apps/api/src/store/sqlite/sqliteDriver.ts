import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import {
  sqliteMigrations,
  sqliteRequiredChecks,
  sqliteRequiredForeignKeys,
  sqliteRequiredIndexes,
  sqliteRequiredSchema,
  sqliteRequiredUniqueConstraints,
  type SqliteMigration
} from "./schema";

export type SqliteDatabase = Database.Database;

export class SqliteDriver {
  readonly db: SqliteDatabase;

  constructor(readonly path: string) {
    const resolved = resolve(path);
    mkdirSync(dirname(resolved), { recursive: true });
    this.db = new Database(resolved);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("synchronous = NORMAL");
  }

  migrate(migrations: SqliteMigration[] = sqliteMigrations): void {
    const latestSupportedVersion = migrations.at(-1)?.version ?? 0;
    const hasMigrationTable = this.hasTable("schema_migrations");
    if (!hasMigrationTable && this.listUserTables().length > 0) {
      throw new Error("SQLite schema migration metadata is missing for a non-empty database; refusing to repair schema drift automatically.");
    }

    if (hasMigrationTable) {
      this.validateRequiredTableColumns("schema_migrations", sqliteRequiredSchema.schema_migrations);
    }
    const applied = hasMigrationTable ? this.readAppliedMigrations() : [];
    const knownByVersion = new Map(migrations.map((migration) => [migration.version, migration]));
    for (const row of applied) {
      if (row.version > latestSupportedVersion) {
        throw new Error(`SQLite database schema version ${row.version} is newer than supported version ${latestSupportedVersion}.`);
      }
      const known = knownByVersion.get(row.version);
      if (!known) {
        throw new Error(`SQLite database contains unsupported migration version ${row.version}.`);
      }
      if (known.checksum !== row.checksum) {
        throw new Error(`SQLite schema migration checksum mismatch for version ${row.version}; refusing to start.`);
      }
    }

    const appliedVersions = new Set(applied.map((row) => row.version));
    const pending = migrations.filter((migration) => !appliedVersions.has(migration.version));
    if (pending.length > 0) {
      const apply = this.db.transaction(() => {
        for (const migration of pending) {
          for (const statement of migration.up) {
            this.db.exec(statement);
          }
          this.db.prepare(
            `INSERT INTO schema_migrations (version, name, applied_at, checksum)
             VALUES (?, ?, ?, ?)`
          ).run(migration.version, migration.name, new Date().toISOString(), migration.checksum);
        }
      });
      apply();
    }

    this.validateRequiredSchema();
  }

  currentSchemaVersion(): number {
    if (!this.hasTable("schema_migrations")) return 0;
    const row = this.db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version?: number };
    return Number(row.version ?? 0);
  }

  transaction<T>(operation: () => T): T {
    return this.db.transaction(operation)();
  }

  close(): void {
    this.db.close();
  }

  private hasTable(name: string): boolean {
    const row = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
    return Boolean(row);
  }

  private listUserTables(): string[] {
    return (this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all() as Array<{ name: string }>).map((row) => row.name);
  }

  private readAppliedMigrations(): Array<{ version: number; checksum: string }> {
    return (this.db.prepare("SELECT version, checksum FROM schema_migrations ORDER BY version").all() as Array<{
      version: number;
      checksum: string;
    }>).map((row) => ({ version: Number(row.version), checksum: row.checksum }));
  }

  private validateRequiredSchema(): void {
    const missing: string[] = [];
    for (const [table, columns] of Object.entries(sqliteRequiredSchema)) {
      if (!this.hasTable(table)) {
        missing.push(`table ${table}`);
        continue;
      }
      const tableMissing = this.missingColumns(table, columns);
      missing.push(...tableMissing.map((column) => `column ${table}.${column}`));
    }
    for (const [table, indexes] of Object.entries(sqliteRequiredIndexes)) {
      const existing = this.listIndexes(table);
      missing.push(...indexes.filter((index) => !existing.has(index)).map((index) => `index ${index}`));
    }
    for (const constraint of sqliteRequiredUniqueConstraints) {
      if (!this.hasUniqueConstraint(constraint.table, constraint.columns)) {
        missing.push(`unique ${constraint.table}(${constraint.columns.join(",")})`);
      }
    }
    for (const foreignKey of sqliteRequiredForeignKeys) {
      if (!this.hasForeignKey(foreignKey.table, foreignKey.from, foreignKey.targetTable, foreignKey.to)) {
        missing.push(`foreign key ${foreignKey.table}.${foreignKey.from}->${foreignKey.targetTable}.${foreignKey.to}`);
      }
    }
    for (const check of sqliteRequiredChecks) {
      if (!this.hasCheckConstraint(check.table, check.contains)) {
        missing.push(`check ${check.table}:${check.contains}`);
      }
    }
    if (missing.length > 0) {
      throw new Error(`SQLite schema drift detected; missing ${missing.join(", ")}.`);
    }
  }

  private validateRequiredTableColumns(table: string, columns: string[]): void {
    if (!this.hasTable(table)) {
      throw new Error(`SQLite schema drift detected; missing table ${table}.`);
    }
    const missing = this.missingColumns(table, columns);
    if (missing.length > 0) {
      throw new Error(`SQLite schema drift detected; missing ${missing.map((column) => `column ${table}.${column}`).join(", ")}.`);
    }
  }

  private missingColumns(table: string, columns: string[]): string[] {
    const rows = this.db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>;
    const existing = new Set(rows.map((row) => row.name));
    return columns.filter((column) => !existing.has(column));
  }

  private listIndexes(table: string): Set<string> {
    const rows = this.db.prepare(`PRAGMA index_list(${quoteIdentifier(table)})`).all() as Array<{ name: string }>;
    return new Set(rows.map((row) => row.name));
  }

  private hasUniqueConstraint(table: string, columns: string[]): boolean {
    const indexes = this.db.prepare(`PRAGMA index_list(${quoteIdentifier(table)})`).all() as Array<{
      name: string;
      unique: number;
    }>;
    for (const index of indexes) {
      if (!index.unique) continue;
      const info = this.db.prepare(`PRAGMA index_info(${quoteIdentifier(index.name)})`).all() as Array<{
        seqno: number;
        name: string;
      }>;
      const indexColumns = info.sort((left, right) => left.seqno - right.seqno).map((row) => row.name);
      if (indexColumns.length === columns.length && indexColumns.every((column, index) => column === columns[index])) {
        return true;
      }
    }
    return false;
  }

  private hasForeignKey(table: string, from: string, targetTable: string, to: string): boolean {
    const rows = this.db.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`).all() as Array<{
      table: string;
      from: string;
      to: string;
    }>;
    return rows.some((row) => row.table === targetTable && row.from === from && row.to === to);
  }

  private hasCheckConstraint(table: string, contains: string): boolean {
    const row = this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as {
      sql?: string;
    } | undefined;
    return normalizeSql(row?.sql ?? "").includes(normalizeSql(contains));
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function hasAppliedMigrationManifest(sqlitePath: string): boolean {
  try {
    const db = new Database(resolve(sqlitePath), { readonly: true, fileMustExist: true });
    try {
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_manifests'").get();
      if (!table) return false;
      const row = db.prepare("SELECT COUNT(*) AS count FROM migration_manifests WHERE status = 'applied'").get() as {
        count?: number;
      };
      return Number(row.count ?? 0) > 0;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}
