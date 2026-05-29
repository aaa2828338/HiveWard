import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FileHivewardStore } from "../fileHivewardStore";
import {
  contractNow,
  createContractApproval,
  createContractArtifact,
  createContractBlueprint,
  createContractEvent,
  createContractHandoff,
  createContractHumanReport,
  createContractNodeRun
} from "../storeContractFixtures";
import {
  cleanupSqliteOrphanArtifacts,
  listSqliteOrphanArtifacts,
  migrateJsonToSqlite,
  runJsonToSqliteMigrationCli,
  runVerifySqliteStoreCli,
  verifySqliteMigration
} from "./jsonToSqliteMigration";
import { SqliteHivewardStore } from "./sqliteHivewardStore";

describe("JSON to SQLite migration", () => {
  it("migrates JSON runtime state and passes parity verification", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-migration-parity-"));
    const source = new FileHivewardStore(join(dataDir, "hiveward-store.json"));
    await source.init();
    const blueprint = await source.saveBlueprint(createContractBlueprint());
    const run = await source.createBlueprintRun(blueprint, "migration-user");
    const nodeRun = createContractNodeRun(run, {
      contractVersion: 2,
      humanReportMd: "## Migrated Report",
      handoffJson: { next: "manager" },
      result: { migrated: true },
      artifacts: [{ id: "artifact-contract", kind: "markdown", title: "Migrated", content: "# Migrated" }]
    });
    await source.upsertNodeRun(nodeRun);
    await source.appendEvent(createContractEvent(run.id, nodeRun.id, 1));
    await source.upsertApprovalRequest(createContractApproval(run.id, nodeRun.id));
    await source.upsertArtifact(createContractArtifact(run.id, nodeRun.id));
    await source.upsertAgentHumanReport(createContractHumanReport(run.id, nodeRun.id));
    await source.upsertAgentHandoff(createContractHandoff(run.id, nodeRun.id));
    await source.createChatSession({ harnessId: "codex", title: "Migrated chat" });

    const sqlitePath = join(dataDir, "hiveward.sqlite");
    const migration = await migrateJsonToSqlite({ dataDir, sqlitePath });
    expect(migration.status).toBe("applied");
    expect(migration.counts.runs).toBeGreaterThanOrEqual(1);

    const verification = await verifySqliteMigration({ dataDir, sqlitePath });
    expect(verification).toMatchObject({ ok: true, mismatches: [] });
  });

  it("detects deep view drift beyond counts", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-migration-drift-"));
    const source = new FileHivewardStore(join(dataDir, "hiveward-store.json"));
    await source.init();
    const blueprint = await source.saveBlueprint(createContractBlueprint());
    const run = await source.createBlueprintRun(blueprint, "migration-user");
    const nodeRun = createContractNodeRun(run, { result: { migrated: true } });
    await source.upsertNodeRun(nodeRun);

    const sqlitePath = join(dataDir, "hiveward.sqlite");
    await migrateJsonToSqlite({ dataDir, sqlitePath });
    const sqlite = new SqliteHivewardStore(sqlitePath);
    await sqlite.init();
    try {
      await sqlite.upsertNodeRun({ ...nodeRun, output: { result: { migrated: false } } });
    } finally {
      sqlite.close();
    }

    const verification = await verifySqliteMigration({ dataDir, sqlitePath });
    expect(verification.ok).toBe(false);
    expect(verification.viewMismatches).toContain("view:runs");
  });

  it("reports missing and orphan artifact files during verification", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-migration-artifacts-"));
    const source = new FileHivewardStore(join(dataDir, "hiveward-store.json"));
    await source.init();
    const blueprint = await source.saveBlueprint(createContractBlueprint());
    const run = await source.createBlueprintRun(blueprint, "migration-user");
    const nodeRun = createContractNodeRun(run, { result: { migrated: true } });
    await source.upsertNodeRun(nodeRun);
    await source.upsertArtifact({
      ...createContractArtifact(run.id, nodeRun.id),
      storagePath: join(dataDir, "artifacts", "runs", "missing.md"),
      relativePath: "runs/missing.md"
    });
    mkdirSync(join(dataDir, "artifacts", "runs"), { recursive: true });
    writeFileSync(join(dataDir, "artifacts", "runs", "orphan.md"), "# orphan\n");

    const sqlitePath = join(dataDir, "hiveward.sqlite");
    await migrateJsonToSqlite({ dataDir, sqlitePath });
    const verification = await verifySqliteMigration({
      dataDir,
      sqlitePath,
      checkArtifacts: true,
      listOrphanArtifacts: true
    });
    expect(verification.ok).toBe(false);
    expect(verification.missingArtifacts[0]).toContain("artifact-contract");
    expect(verification.orphanArtifacts).toEqual(["runs/orphan.md"]);
  });

  it("documents and accepts --sqlite-path for migration and verification CLIs", async () => {
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    expect(readme).toContain("--sqlite-path data/hiveward.sqlite");
    expect(readme).not.toMatch(/--sqlite\s+data\/hiveward\.sqlite/);

    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-migration-cli-"));
    const source = new FileHivewardStore(join(dataDir, "hiveward-store.json"));
    await source.init();
    const sqlitePath = join(dataDir, "custom.sqlite");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const previousExitCode = process.exitCode;
    try {
      await runJsonToSqliteMigrationCli(["--data-dir", dataDir, "--sqlite-path", sqlitePath, "--apply"]);
      await runVerifySqliteStoreCli(["--data-dir", dataDir, "--sqlite-path", sqlitePath]);
      expect(process.exitCode).toBe(previousExitCode);
    } finally {
      process.exitCode = previousExitCode;
      log.mockRestore();
    }
  });

  it("lists, dry-runs, and cleans up orphan artifact files without deleting referenced files", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-artifact-maintenance-"));
    const sqlitePath = join(dataDir, "hiveward.sqlite");
    const store = new SqliteHivewardStore(sqlitePath);
    await store.init();
    try {
      const blueprint = await store.saveBlueprint(createContractBlueprint());
      const run = await store.createBlueprintRun(blueprint, "maintenance-user");
      const referencedPath = join(dataDir, "artifacts", "objects", "sha256", "aa", "referenced.md");
      const orphanPath = join(dataDir, "artifacts", "objects", "sha256", "bb", "orphan.md");
      mkdirSync(join(dataDir, "artifacts", "objects", "sha256", "aa"), { recursive: true });
      mkdirSync(join(dataDir, "artifacts", "objects", "sha256", "bb"), { recursive: true });
      writeFileSync(referencedPath, "# referenced\n");
      writeFileSync(orphanPath, "# orphan\n");
      await store.upsertArtifact({
        ...createContractArtifact(run.id, "node-run-maintenance"),
        storagePath: referencedPath,
        relativePath: "objects/sha256/aa/referenced.md"
      });
    } finally {
      store.close();
    }

    const listed = await listSqliteOrphanArtifacts({ dataDir, sqlitePath });
    expect(listed.orphanArtifacts).toEqual(["objects/sha256/bb/orphan.md"]);

    const dryRun = await cleanupSqliteOrphanArtifacts({ dataDir, sqlitePath, dryRun: true });
    expect(dryRun.deletedArtifacts).toEqual([]);
    expect(existsSync(join(dataDir, "artifacts", "objects", "sha256", "bb", "orphan.md"))).toBe(true);

    const cleaned = await cleanupSqliteOrphanArtifacts({ dataDir, sqlitePath });
    expect(cleaned.deletedArtifacts).toEqual(["objects/sha256/bb/orphan.md"]);
    expect(existsSync(join(dataDir, "artifacts", "objects", "sha256", "bb", "orphan.md"))).toBe(false);
    expect(existsSync(join(dataDir, "artifacts", "objects", "sha256", "aa", "referenced.md"))).toBe(true);
  });
});
