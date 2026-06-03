import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  ApprovalDiscussionBinding,
  NodeExecutionSession,
  NodeSessionTranscriptEvent,
  RunCommand,
  RunCommandStep
} from "@hiveward/shared";
import { FileHivewardStore } from "../fileHivewardStore";
import {
  contractNow,
  createContractApproval,
  createContractArtifact,
  createContractBlueprint,
  createContractEvent,
  createContractHandoff,
  createContractHumanReport,
  createContractNodeRun,
  createContractReleaseReport
} from "../storeContractFixtures";
import {
  cleanupSqliteOrphanArtifacts,
  listSqliteOrphanArtifacts,
  migrateJsonToSqlite,
  runJsonToSqliteMigrationCli,
  runVerifySqliteStoreCli,
  verifySqliteMigration
} from "./jsonToSqliteMigration";
import { SqliteDriver } from "./sqliteDriver";
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
    const approval = await source.upsertApprovalRequest(createContractApproval(run.id, nodeRun.id));
    await seedMigrationExecutionFacts(source, run.id, nodeRun, approval.id);
    await source.upsertArtifact(createContractArtifact(run.id, nodeRun.id));
    await source.upsertAgentHumanReport(createContractHumanReport(run.id, nodeRun.id));
    await source.upsertAgentHandoff(createContractHandoff(run.id, nodeRun.id));
    await source.createChatSession({ harnessId: "codex", title: "Migrated chat" });

    const sqlitePath = join(dataDir, "hiveward.sqlite");
    const migration = await migrateJsonToSqlite({ dataDir, sqlitePath });
    expect(migration.status).toBe("applied");
    expect(migration.counts.runs).toBeGreaterThanOrEqual(1);

    const verification = await verifySqliteMigration({ dataDir, sqlitePath });
    expect(verification).toMatchObject({
      ok: true,
      mismatches: [],
      source: expect.objectContaining({
        runCommands: 1,
        runCommandSteps: 1,
        nodeExecutionSessions: 1,
        nodeSessionTranscriptEvents: 1,
        approvalDiscussionBindings: 1
      }),
      sqlite: expect.objectContaining({
        runCommands: 1,
        runCommandSteps: 1,
        nodeExecutionSessions: 1,
        nodeSessionTranscriptEvents: 1,
        approvalDiscussionBindings: 1
      })
    });
  });

  it("backfills historical pending approvals with canonical unavailable discussion bindings", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-migration-approval-binding-backfill-"));
    const source = new FileHivewardStore(join(dataDir, "hiveward-store.json"));
    await source.init();
    const blueprint = await source.saveBlueprint(createContractBlueprint());
    const run = await source.createBlueprintRun(blueprint, "migration-user");
    const nodeRun = createContractNodeRun(run, { result: { migrated: true } }, "waiting_approval");
    await source.upsertNodeRun(nodeRun);
    const approval = await source.upsertApprovalRequest({
      ...createContractApproval(run.id, nodeRun.id),
      id: "approval-missing-discussion-binding",
      threadId: "thread-missing-discussion-binding"
    });

    const sqlitePath = join(dataDir, "hiveward.sqlite");
    await migrateJsonToSqlite({ dataDir, sqlitePath });

    const sqlite = new SqliteHivewardStore(sqlitePath, { seedDefaults: false });
    await sqlite.init();
    try {
      const view = await sqlite.getRunView(run.id);
      expect(view?.approvalDiscussionBindings).toEqual([
        expect.objectContaining({
          approvalRequestId: approval.id,
          threadId: approval.threadId,
          mode: "none",
          route: "none",
          canStreamReply: false,
          reason: "historical_discussion_binding_unavailable",
          resolverVersion: 1
        })
      ]);
      expect(view?.approvalRequestDiscussions).toEqual([
        expect.objectContaining({
          approvalRequestId: approval.id,
          discussion: {
            mode: "none",
            canStreamReply: false,
            reason: "historical_discussion_binding_unavailable"
          }
        })
      ]);
    } finally {
      sqlite.close();
    }
  });

  it("fails verification when migrated execution facts are missing", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-migration-execution-fact-drift-"));
    const source = new FileHivewardStore(join(dataDir, "hiveward-store.json"));
    await source.init();
    const blueprint = await source.saveBlueprint(createContractBlueprint());
    const run = await source.createBlueprintRun(blueprint, "migration-user");
    const nodeRun = createContractNodeRun(run, { result: { migrated: true } });
    await source.upsertNodeRun(nodeRun);
    const approval = await source.upsertApprovalRequest(createContractApproval(run.id, nodeRun.id));
    const facts = await seedMigrationExecutionFacts(source, run.id, nodeRun, approval.id);

    const sqlitePath = join(dataDir, "hiveward.sqlite");
    await migrateJsonToSqlite({ dataDir, sqlitePath });
    const driver = new SqliteDriver(sqlitePath);
    try {
      driver.db.prepare("DELETE FROM run_command_steps WHERE id = ?").run(facts.step.id);
    } finally {
      driver.close();
    }

    const verification = await verifySqliteMigration({ dataDir, sqlitePath });
    expect(verification.ok).toBe(false);
    expect(verification.mismatches).toContain("count:runCommandSteps: source=1 sqlite=0");
    expect(verification.identityMismatches).toEqual(expect.arrayContaining([
      expect.stringContaining("identity:runCommandSteps")
    ]));
  });

  it("preserves a legacy artifact nodeRunId that has no matching node_run row", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-migration-legacy-artifact-node-"));
    const source = new FileHivewardStore(join(dataDir, "hiveward-store.json"));
    await source.init();
    const blueprint = await source.saveBlueprint(createContractBlueprint());
    const run = await source.createBlueprintRun(blueprint, "migration-user");
    const missingNodeRunId = "legacy-missing-node-run";
    await source.upsertArtifact({
      ...createContractArtifact(run.id, missingNodeRunId),
      id: "artifact-legacy-missing-node-run",
      nodeRunId: missingNodeRunId
    });

    const sqlitePath = join(dataDir, "hiveward.sqlite");
    await migrateJsonToSqlite({ dataDir, sqlitePath });
    const verification = await verifySqliteMigration({ dataDir, sqlitePath });
    expect(verification).toMatchObject({ ok: true, mismatches: [] });

    const sqlite = new SqliteHivewardStore(sqlitePath, { seedDefaults: false });
    await sqlite.init();
    try {
      await expect(sqlite.listArtifacts()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "artifact-legacy-missing-node-run",
          nodeRunId: missingNodeRunId
        })
      ]));
    } finally {
      sqlite.close();
    }

    const driver = new SqliteDriver(sqlitePath);
    try {
      const row = driver.db.prepare(
        "SELECT node_run_id, declared_node_run_id FROM artifacts WHERE id = ?"
      ).get("artifact-legacy-missing-node-run") as { node_run_id: string | null; declared_node_run_id: string | null };
      expect(row).toEqual({
        node_run_id: null,
        declared_node_run_id: missingNodeRunId
      });
      expect(driver.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      driver.close();
    }
  });

  it("preserves release report artifactRefs order during migration", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-migration-release-order-"));
    const source = new FileHivewardStore(join(dataDir, "hiveward-store.json"));
    await source.init();
    const blueprint = await source.saveBlueprint(createContractBlueprint());
    const run = await source.createBlueprintRun(blueprint, "migration-user");
    const nodeRun = createContractNodeRun(run, { result: { migrated: true } });
    await source.upsertNodeRun(nodeRun);
    const artifactB = { ...createContractArtifact(run.id, nodeRun.id), id: "artifact-b", title: "B", relativePath: "runs/b.md" };
    const artifactA = { ...createContractArtifact(run.id, nodeRun.id), id: "artifact-a", title: "A", relativePath: "runs/a.md" };
    await source.upsertArtifact(artifactB);
    await source.upsertArtifact(artifactA);
    await source.upsertReleaseReport({
      ...createContractReleaseReport(run.id, "legacy-round", "legacy-approval"),
      artifactRefs: [
        { artifactId: artifactB.id, title: "B", location: "/artifacts/runs/b.md", current: true },
        { artifactId: artifactA.id, title: "A", location: "/artifacts/runs/a.md", current: true }
      ]
    });

    const sqlitePath = join(dataDir, "hiveward.sqlite");
    await migrateJsonToSqlite({ dataDir, sqlitePath });
    const verification = await verifySqliteMigration({ dataDir, sqlitePath });
    expect(verification).toMatchObject({ ok: true, mismatches: [] });

    const sqlite = new SqliteHivewardStore(sqlitePath, { seedDefaults: false });
    await sqlite.init();
    try {
      const reports = await sqlite.listReleaseReports(run.id);
      expect(reports).toHaveLength(1);
      expect(reports[0]?.artifactRefs.map((ref) => ref.artifactId)).toEqual(["artifact-b", "artifact-a"]);
    } finally {
      sqlite.close();
    }
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

  it("accepts --sqlite-path for migration and verification CLIs", async () => {
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

async function seedMigrationExecutionFacts(
  source: FileHivewardStore,
  runId: string,
  nodeRun: ReturnType<typeof createContractNodeRun>,
  approvalRequestId: string
): Promise<{
  command: RunCommand;
  step: RunCommandStep;
  session: NodeExecutionSession;
  transcriptEvent: NodeSessionTranscriptEvent;
  binding: ApprovalDiscussionBinding;
}> {
  const command: RunCommand = {
    id: "run-command-migration",
    commandKey: `migration:${runId}:execute`,
    blueprintId: nodeRun.blueprintId,
    runId,
    kind: "regular_run",
    status: "succeeded",
    currentRevision: 1,
    currentStep: "node_execution",
    createdAt: contractNow,
    updatedAt: contractNow
  };
  await source.createRunCommandIfAbsent(command);
  const step: RunCommandStep = {
    id: "run-command-step-migration",
    commandId: command.id,
    stepKey: `${command.commandKey}:node:${nodeRun.id}`,
    runId,
    revision: 1,
    mode: "node_execution",
    nodeId: nodeRun.nodeId,
    nodeRunId: nodeRun.id,
    status: "succeeded",
    createdAt: contractNow,
    updatedAt: contractNow
  };
  await source.createRunCommandStepIfAbsent(step);
  const session: NodeExecutionSession = {
    id: "node-execution-session-migration",
    runId,
    nodeRunId: nodeRun.id,
    nodeId: nodeRun.nodeId,
    agentSeatId: "migration-agent",
    harnessId: "codex",
    nativeSessionId: "native-migration",
    policy: "preserve_across_rounds",
    status: "completed",
    createdAt: contractNow,
    updatedAt: contractNow,
    lastUsedAt: contractNow
  };
  await source.createNodeExecutionSession(session);
  const transcriptEvent = await source.appendNodeSessionTranscriptEvent({
    id: "node-session-transcript-migration",
    sessionId: session.id,
    runId,
    nodeRunId: nodeRun.id,
    role: "runtime",
    kind: "runtime_done",
    content: "Runtime completed.",
    createdAt: contractNow
  });
  const binding: ApprovalDiscussionBinding = {
    approvalRequestId,
    threadId: approvalRequestId,
    mode: "executor",
    route: "agent_approval",
    executorActor: "agent",
    executorKind: "agent_approval",
    executorNodeId: nodeRun.nodeId,
    executorNodeRunId: nodeRun.id,
    executorSessionId: session.id,
    runtimeId: "codex",
    canStreamReply: true,
    resolverVersion: 1,
    createdAt: contractNow,
    updatedAt: contractNow
  };
  await source.createApprovalDiscussionBinding(binding);
  return { command, step, session, transcriptEvent, binding };
}
