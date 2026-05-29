import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createHivewardStore, detectRuntimeStoreState, resolveHivewardStorePath } from "./createHivewardStore";
import { FileHivewardStore } from "./fileHivewardStore";
import { migrateJsonToSqlite } from "./sqlite/jsonToSqliteMigration";
import { SqliteHivewardStore } from "./sqlite/sqliteHivewardStore";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("resolveHivewardStorePath", () => {
  it("resolves relative store paths from the repository root instead of process cwd", () => {
    const originalCwd = process.cwd();
    const unrelatedCwd = mkdtempSync(resolve(tmpdir(), "hiveward-store-cwd-"));
    process.chdir(unrelatedCwd);
    try {
      expect(resolveHivewardStorePath("data/hiveward.sqlite")).toBe(resolve(repositoryRoot, "data/hiveward.sqlite"));
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("keeps absolute store paths unchanged", () => {
    const absolutePath = resolve(tmpdir(), "custom-hiveward.sqlite");
    expect(resolveHivewardStorePath(absolutePath)).toBe(absolutePath);
  });
});

describe("createHivewardStore startup migration gate", () => {
  it("auto-migrates legacy JSON by default when SQLite is missing", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-startup-default-auto-"));
    const sqlitePath = join(dataDir, "hiveward.sqlite");
    await seedLegacyJson(dataDir);

    const store = await createHivewardStore({
      HIVEWARD_SQLITE_PATH: sqlitePath
    } as NodeJS.ProcessEnv);
    await store.init();
    await expect(store.listCompanies()).resolves.toMatchObject({
      companies: expect.arrayContaining([expect.objectContaining({ id: "company-hiveward-studio" })])
    });
    (store as SqliteHivewardStore).close?.();
    expect(await detectRuntimeStoreState(dataDir, sqlitePath)).toMatchObject({
      hasSqliteDb: true,
      hasAppliedMigrationManifest: true
    });
  });

  it("fails closed when legacy JSON exists without SQLite and auto migration is disabled", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-startup-gate-"));
    await seedLegacyJson(dataDir);

    await expect(createHivewardStore({
      HIVEWARD_SQLITE_PATH: join(dataDir, "hiveward.sqlite"),
      HIVEWARD_JSON_MIGRATION_MODE: "off"
    } as NodeJS.ProcessEnv)).rejects.toThrow(/Refusing to create an empty SQLite runtime store/);
    expect(existsSync(join(dataDir, "hiveward.sqlite"))).toBe(false);
  });

  it("runs dry-run without creating the formal SQLite database", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-startup-dry-run-"));
    await seedLegacyJson(dataDir);

    await expect(createHivewardStore({
      HIVEWARD_SQLITE_PATH: join(dataDir, "hiveward.sqlite"),
      HIVEWARD_JSON_MIGRATION_MODE: "dry-run"
    } as NodeJS.ProcessEnv)).rejects.toThrow(/dry-run completed successfully/);
    expect(existsSync(join(dataDir, "hiveward.sqlite"))).toBe(false);
  });

  it("auto-migrates legacy JSON before returning a SQLite store when explicitly requested", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-startup-auto-"));
    const sqlitePath = join(dataDir, "hiveward.sqlite");
    await seedLegacyJson(dataDir);

    const store = await createHivewardStore({
      HIVEWARD_SQLITE_PATH: sqlitePath,
      HIVEWARD_JSON_MIGRATION_MODE: "auto"
    } as NodeJS.ProcessEnv);
    await store.init();
    expect(await detectRuntimeStoreState(dataDir, sqlitePath)).toMatchObject({
      hasSqliteDb: true,
      hasAppliedMigrationManifest: true
    });
    (store as SqliteHivewardStore).close?.();
  });

  it("repairs an incompatible migrated SQLite database from legacy JSON during init", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-startup-repair-"));
    const sqlitePath = join(dataDir, "hiveward.sqlite");
    await seedLegacyJson(dataDir);
    await migrateJsonToSqlite({ dataDir, sqlitePath });
    const stale = new Database(sqlitePath);
    try {
      stale.prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 1").run("stale-checksum");
    } finally {
      stale.close();
    }

    const store = await createHivewardStore({
      HIVEWARD_SQLITE_PATH: sqlitePath
    } as NodeJS.ProcessEnv);
    await store.init();
    await expect(store.listCompanies()).resolves.toMatchObject({
      companies: expect.arrayContaining([expect.objectContaining({ id: "company-hiveward-studio" })])
    });
    (store as SqliteHivewardStore).close?.();

    const repaired = new Database(sqlitePath, { readonly: true, fileMustExist: true });
    try {
      expect(repaired.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toMatchObject({ version: 2 });
      expect(repaired.prepare("SELECT checksum FROM schema_migrations WHERE version = 1").get()).not.toMatchObject({ checksum: "stale-checksum" });
    } finally {
      repaired.close();
    }
    expect(await detectRuntimeStoreState(dataDir, sqlitePath)).toMatchObject({
      hasSqliteDb: true,
      hasAppliedMigrationManifest: true
    });
  });

  it("allows a fresh SQLite install to seed defaults when no legacy JSON exists", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-startup-fresh-"));
    const sqlitePath = join(dataDir, "hiveward.sqlite");
    const store = await createHivewardStore({
      HIVEWARD_SQLITE_PATH: sqlitePath
    } as NodeJS.ProcessEnv);
    await store.init();
    await expect(store.listCompanies()).resolves.toMatchObject({
      companies: expect.arrayContaining([expect.objectContaining({ id: "company-hiveward-studio" })])
    });
    (store as SqliteHivewardStore).close?.();
  });

  it("auto-rebuilds mixed legacy JSON and SQLite state when no applied migration manifest exists", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-startup-mixed-"));
    const sqlitePath = join(dataDir, "hiveward.sqlite");
    await seedLegacyJson(dataDir);
    const sqlite = new SqliteHivewardStore(sqlitePath);
    await sqlite.init();
    sqlite.close();

    const store = await createHivewardStore({
      HIVEWARD_SQLITE_PATH: sqlitePath
    } as NodeJS.ProcessEnv);
    await store.init();
    await expect(store.listCompanies()).resolves.toMatchObject({
      companies: expect.arrayContaining([expect.objectContaining({ id: "company-hiveward-studio" })])
    });
    (store as SqliteHivewardStore).close?.();
    expect(await detectRuntimeStoreState(dataDir, sqlitePath)).toMatchObject({
      hasSqliteDb: true,
      hasAppliedMigrationManifest: true
    });
  });

  it("keeps json-readonly init from seeding missing JSON and rejects writes", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-json-readonly-"));
    const store = await createHivewardStore({
      HIVEWARD_STORE_BACKEND: "json-readonly",
      HIVEWARD_SQLITE_PATH: join(dataDir, "hiveward.sqlite")
    } as NodeJS.ProcessEnv);
    await store.init();
    expect(existsSync(join(dataDir, "hiveward-store.json"))).toBe(false);
    await expect(store.createCompany({ name: "No write" })).rejects.toThrow(/read-only/);
  });
});

async function seedLegacyJson(dataDir: string): Promise<void> {
  const store = new FileHivewardStore(join(dataDir, "hiveward-store.json"));
  await store.init();
}
