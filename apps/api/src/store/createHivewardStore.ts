import { readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FileHivewardStore } from "./fileHivewardStore";
import type { HivewardStore } from "./hivewardStore";
import { migrateJsonToSqlite, verifySqliteMigration } from "./sqlite/jsonToSqliteMigration";
import { hasAppliedMigrationManifest } from "./sqlite/sqliteDriver";
import { SqliteHivewardStore } from "./sqlite/sqliteHivewardStore";

export type HivewardStoreBackend = "sqlite" | "json-readonly" | "json";
export type JsonMigrationMode = "off" | "dry-run" | "auto";

export type RuntimeStoreState = {
  hasLegacyIndex: boolean;
  hasLegacyChat: boolean;
  hasLegacyRunArchive: boolean;
  hasSqliteDb: boolean;
  hasSqliteWal: boolean;
  hasSqliteShm: boolean;
  hasAppliedMigrationManifest: boolean;
};

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const defaultSqlitePath = "data/hiveward.sqlite";

export async function createHivewardStore(env: NodeJS.ProcessEnv = process.env): Promise<HivewardStore> {
  const backend = readStoreBackend(env.HIVEWARD_STORE_BACKEND);
  const sqlitePath = resolveHivewardStorePath(env.HIVEWARD_SQLITE_PATH?.trim() || defaultSqlitePath);
  const dataDir = dirname(sqlitePath);

  if (backend === "sqlite") {
    const readonlyFallback = readBoolean(env.HIVEWARD_JSON_READONLY_FALLBACK);
    try {
      await enforceSqliteStartupGate({
        dataDir,
        sqlitePath,
        migrationMode: readMigrationMode(env.HIVEWARD_JSON_MIGRATION_MODE),
        readonlyFallback
      });
    } catch (error) {
      if (!readonlyFallback) throw error;
      return readonlyStore(new FileHivewardStore(join(dataDir, "hiveward-store.json"), { seedDefaults: false }));
    }
    return new SqliteHivewardStore(sqlitePath);
  }

  const fileStore = new FileHivewardStore(join(dataDir, "hiveward-store.json"), {
    seedDefaults: backend !== "json-readonly"
  });
  return backend === "json-readonly" ? readonlyStore(fileStore) : fileStore;
}

export function resolveHivewardStorePath(pathValue: string): string {
  return isAbsolute(pathValue) ? pathValue : resolve(repositoryRoot, pathValue);
}

export async function detectRuntimeStoreState(dataDir: string, sqlitePath: string): Promise<RuntimeStoreState> {
  const resolvedDataDir = resolve(dataDir);
  const resolvedSqlitePath = resolve(sqlitePath);
  const hasSqliteDb = await pathExists(resolvedSqlitePath);
  return {
    hasLegacyIndex: await pathExists(join(resolvedDataDir, "hiveward-store.json")),
    hasLegacyChat: await pathExists(join(resolvedDataDir, "hiveward-chat-store.json")),
    hasLegacyRunArchive: await hasJsonFiles(join(resolvedDataDir, "runs")),
    hasSqliteDb,
    hasSqliteWal: await pathExists(`${resolvedSqlitePath}-wal`),
    hasSqliteShm: await pathExists(`${resolvedSqlitePath}-shm`),
    hasAppliedMigrationManifest: hasSqliteDb ? hasAppliedMigrationManifest(resolvedSqlitePath) : false
  };
}

function readStoreBackend(value: string | undefined): HivewardStoreBackend {
  const normalized = value?.trim();
  if (normalized === undefined || normalized === "" || normalized === "sqlite") return "sqlite";
  if (normalized === "json" || normalized === "json-readonly") return normalized;
  throw new Error(`Unsupported HIVEWARD_STORE_BACKEND "${normalized}". Use sqlite, json-readonly, or json.`);
}

function readMigrationMode(value: string | undefined): JsonMigrationMode {
  const normalized = value?.trim();
  if (normalized === undefined || normalized === "" || normalized === "off") return "off";
  if (normalized === "dry-run" || normalized === "auto") return normalized;
  throw new Error(`Unsupported HIVEWARD_JSON_MIGRATION_MODE "${normalized}". Use off, dry-run, or auto.`);
}

function readBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

async function enforceSqliteStartupGate(input: {
  dataDir: string;
  sqlitePath: string;
  migrationMode: JsonMigrationMode;
  readonlyFallback: boolean;
}): Promise<void> {
  const state = await detectRuntimeStoreState(input.dataDir, input.sqlitePath);
  const hasLegacyJson = state.hasLegacyIndex || state.hasLegacyChat || state.hasLegacyRunArchive;

  if (!hasLegacyJson) return;

  if (state.hasSqliteDb && state.hasAppliedMigrationManifest) return;

  if (state.hasSqliteDb && !state.hasAppliedMigrationManifest) {
    throw migrationGateError(
      state,
      "Legacy JSON and SQLite both exist, but no applied migration manifest was found. Refusing to trust mixed runtime state."
    );
  }

  if (input.migrationMode === "dry-run") {
    const dryRun = await migrateJsonToSqlite({ dataDir: input.dataDir, sqlitePath: input.sqlitePath, dryRun: true });
    const verification = await verifySqliteMigration({ dataDir: input.dataDir, sqlitePath: dryRun.sqlitePath, checkArtifacts: true, listOrphanArtifacts: true });
    if (!verification.ok) {
      throw migrationGateError(state, `JSON to SQLite dry-run verification failed: ${verification.mismatches.join(", ") || "unknown mismatch"}.`);
    }
    throw migrationGateError(state, "JSON to SQLite dry-run completed successfully. SQLite was not enabled; run with HIVEWARD_JSON_MIGRATION_MODE=auto to apply.");
  }

  if (input.migrationMode === "auto") {
    const dryRun = await migrateJsonToSqlite({ dataDir: input.dataDir, sqlitePath: input.sqlitePath, dryRun: true });
    const dryRunVerification = await verifySqliteMigration({ dataDir: input.dataDir, sqlitePath: dryRun.sqlitePath, checkArtifacts: true, listOrphanArtifacts: true });
    if (!dryRunVerification.ok) {
      throw migrationGateError(state, `JSON to SQLite dry-run verification failed: ${dryRunVerification.mismatches.join(", ") || "unknown mismatch"}.`);
    }
    await migrateJsonToSqlite({ dataDir: input.dataDir, sqlitePath: input.sqlitePath, dryRun: false });
    const verification = await verifySqliteMigration({ dataDir: input.dataDir, sqlitePath: input.sqlitePath, checkArtifacts: true, listOrphanArtifacts: true });
    if (!verification.ok) {
      throw migrationGateError(state, `JSON to SQLite migration verification failed: ${verification.mismatches.join(", ") || "unknown mismatch"}.`);
    }
    return;
  }

  if (input.readonlyFallback) {
    throw migrationGateError(
      state,
      "Legacy JSON exists without SQLite; set HIVEWARD_STORE_BACKEND=json-readonly for explicit read-only fallback."
    );
  }
  throw migrationGateError(
    state,
    "Legacy JSON exists without SQLite. Refusing to create an empty SQLite runtime store until migration is run."
  );
}

function migrationGateError(state: RuntimeStoreState, reason: string): Error {
  return new Error([
    reason,
    "Migration entrypoints:",
    "  node scripts/migrate-json-store-to-sqlite.mjs --data-dir data --dry-run",
    "  node scripts/migrate-json-store-to-sqlite.mjs --data-dir data --apply",
    "  node scripts/verify-sqlite-store.mjs --data-dir data --check-artifacts",
    `Detected state: ${JSON.stringify(state)}`
  ].join("\n"));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function hasJsonFiles(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".tmp"));
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function readonlyStore(store: HivewardStore): HivewardStore {
  const writablePrefixes = [
    "append",
    "apply",
    "approve",
    "cancel",
    "claim",
    "complete",
    "create",
    "delete",
    "end",
    "fail",
    "import",
    "publish",
    "reject",
    "renew",
    "replace",
    "reply",
    "save",
    "select",
    "start",
    "store",
    "update",
    "upsert"
  ];
  const initOnlyWriteMethods = new Set(["init"]);
  return new Proxy(store, {
    get(target, property, receiver) {
      if (typeof property !== "string") return Reflect.get(target, property, receiver);
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      const isWrite = initOnlyWriteMethods.has(property)
        ? false
        : writablePrefixes.some((prefix) => property.startsWith(prefix));
      if (!isWrite) return value.bind(target);
      return async () => {
        throw new Error(`JSON fallback store is read-only; ${property} cannot be used as a runtime write path.`);
      };
    }
  });
}
