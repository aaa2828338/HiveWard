import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sqliteMigrations, sqliteSchemaVersion } from "./schema";
import { SqliteDriver } from "./sqliteDriver";

describe("SqliteDriver schema migrations", () => {
  it("applies empty database migrations and accepts the same checksum on reopen", () => {
    const sqlitePath = join(mkdtempSync(join(tmpdir(), "hiveward-schema-empty-")), "hiveward.sqlite");
    const first = new SqliteDriver(sqlitePath);
    first.migrate();
    expect(first.currentSchemaVersion()).toBe(sqliteSchemaVersion);
    first.close();

    const second = new SqliteDriver(sqlitePath);
    expect(() => second.migrate()).not.toThrow();
    second.close();
  });

  it("upgrades v1 databases with legacy migration compatibility columns", () => {
    const sqlitePath = join(mkdtempSync(join(tmpdir(), "hiveward-schema-v1-upgrade-")), "hiveward.sqlite");
    const first = new SqliteDriver(sqlitePath);
    const v1 = sqliteMigrations[0]!;
    for (const statement of v1.up) first.db.exec(statement);
    first.db.prepare(
      `INSERT INTO approval_requests (
        id, run_id, kind, status, title, body, revision, capabilities_json, requested_by_json, requested_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "approval-v1",
      "run-v1",
      "agent_proposal",
      "pending",
      "Review v1 output",
      "Approve the v1 output.",
      1,
      JSON.stringify({ approve: true, reject: true, reply: true, complete: false, terminate: false }),
      JSON.stringify({ type: "node", label: "Agent" }),
      "2026-05-29T00:00:00.000Z",
      "2026-05-29T00:00:00.000Z"
    );
    first.db.prepare(
      "INSERT INTO approval_replies (id, approval_request_id, message, actor, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(
      "reply-v1",
      "approval-v1",
      "Please revise.",
      "user",
      "2026-05-29T00:01:00.000Z"
    );
    first.db.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)"
    ).run(v1.version, v1.name, new Date().toISOString(), v1.checksum);
    expect(first.currentSchemaVersion()).toBe(1);
    first.close();

    const upgraded = new SqliteDriver(sqlitePath);
    upgraded.migrate();
    expect(upgraded.currentSchemaVersion()).toBe(sqliteSchemaVersion);
    expect(listColumnNames(upgraded, "artifacts")).toContain("declared_node_run_id");
    expect(listColumnNames(upgraded, "release_report_artifacts")).toContain("position");
    expect(listColumnNames(upgraded, "approval_replies")).toContain("thread_id");
    expect(listColumnNames(upgraded, "approval_replies")).toContain("metadata_json");
    expect(upgraded.db.prepare("SELECT status, current_request_id FROM approval_threads WHERE id = ?").get("approval-v1")).toMatchObject({
      status: "open",
      current_request_id: "approval-v1"
    });
    expect(upgraded.db.prepare("SELECT thread_id FROM approval_replies WHERE id = ?").get("reply-v1")).toMatchObject({
      thread_id: "approval-v1"
    });
    expect(JSON.parse((upgraded.db.prepare("SELECT metadata_json FROM approval_replies WHERE id = ?").get("reply-v1") as {
      metadata_json: string;
    }).metadata_json)).toMatchObject({
      legacySource: "approval_replies_v1",
      legacyAction: "reply",
      legacyMeaning: "message_only",
      requestKind: "agent_proposal"
    });
    upgraded.close();
  });

  it("fails closed when an applied migration checksum changes", () => {
    const sqlitePath = join(mkdtempSync(join(tmpdir(), "hiveward-schema-checksum-")), "hiveward.sqlite");
    const driver = new SqliteDriver(sqlitePath);
    driver.migrate();
    driver.db.prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 1").run("bad-checksum");
    expect(() => driver.migrate()).toThrow(/checksum mismatch/);
    driver.close();
  });

  it("fails closed when the database schema version is newer than code supports", () => {
    const sqlitePath = join(mkdtempSync(join(tmpdir(), "hiveward-schema-newer-")), "hiveward.sqlite");
    const driver = new SqliteDriver(sqlitePath);
    driver.migrate();
    driver.db.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)"
    ).run(99, "future", new Date().toISOString(), "future-checksum");
    expect(() => driver.migrate()).toThrow(/newer than supported/);
    driver.close();
  });

  it("rolls back DDL when a migration fails midway", () => {
    const sqlitePath = join(mkdtempSync(join(tmpdir(), "hiveward-schema-rollback-")), "hiveward.sqlite");
    const driver = new SqliteDriver(sqlitePath);
    expect(() => driver.migrate([{
      version: 1,
      name: "bad",
      checksum: "bad",
      up: [
        "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL, checksum TEXT NOT NULL)",
        "CREATE TABLE partial_table (id TEXT PRIMARY KEY)",
        "INSERT INTO missing_table (id) VALUES ('boom')"
      ]
    }])).toThrow();
    const tables = driver.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).not.toContain("partial_table");
    expect(tables.map((row) => row.name)).not.toContain("schema_migrations");
    driver.close();
  });

  it("does not silently pass an old user table without migration metadata", () => {
    const sqlitePath = join(mkdtempSync(join(tmpdir(), "hiveward-schema-drift-")), "hiveward.sqlite");
    const driver = new SqliteDriver(sqlitePath);
    driver.db.exec("CREATE TABLE companies (id TEXT PRIMARY KEY)");
    expect(() => driver.migrate()).toThrow(/metadata is missing/);
    driver.close();
  });

  it("fails closed when a required table is manually removed without changing migration rows", () => {
    const sqlitePath = join(mkdtempSync(join(tmpdir(), "hiveward-schema-missing-table-")), "hiveward.sqlite");
    const driver = new SqliteDriver(sqlitePath);
    driver.migrate();
    driver.db.exec("DROP TABLE artifacts");
    expect(() => driver.migrate()).toThrow(/SQLite schema drift detected; missing table artifacts/);
    driver.close();
  });

  it("fails closed when a required column is manually removed without changing migration rows", () => {
    const sqlitePath = join(mkdtempSync(join(tmpdir(), "hiveward-schema-missing-column-")), "hiveward.sqlite");
    const driver = new SqliteDriver(sqlitePath);
    driver.migrate();
    driver.db.exec("ALTER TABLE chat_messages DROP COLUMN content");
    expect(() => driver.migrate()).toThrow(/SQLite schema drift detected; missing column chat_messages\.content/);
    driver.close();
  });

  it("fails closed when the legacy artifact node run source column is missing", () => {
    const sqlitePath = join(mkdtempSync(join(tmpdir(), "hiveward-schema-missing-artifact-source-")), "hiveward.sqlite");
    const driver = new SqliteDriver(sqlitePath);
    driver.migrate();
    driver.db.exec("ALTER TABLE artifacts DROP COLUMN declared_node_run_id");
    expect(() => driver.migrate()).toThrow(/missing column artifacts\.declared_node_run_id/);
    driver.close();
  });

  it("fails closed when release report artifact ordering position is missing", () => {
    const sqlitePath = join(mkdtempSync(join(tmpdir(), "hiveward-schema-missing-release-position-")), "hiveward.sqlite");
    const driver = new SqliteDriver(sqlitePath);
    driver.migrate();
    driver.db.exec("ALTER TABLE release_report_artifacts DROP COLUMN position");
    expect(() => driver.migrate()).toThrow(/missing column release_report_artifacts\.position/);
    driver.close();
  });

  it("fails closed when a required index is missing", () => {
    const sqlitePath = join(mkdtempSync(join(tmpdir(), "hiveward-schema-missing-index-")), "hiveward.sqlite");
    const driver = new SqliteDriver(sqlitePath);
    driver.migrate();
    driver.db.exec("DROP INDEX idx_runs_company_started");
    expect(() => driver.migrate()).toThrow(/missing index idx_runs_company_started/);
    driver.close();
  });

  it("fails closed when a required UNIQUE constraint is missing", () => {
    const sqlitePath = join(mkdtempSync(join(tmpdir(), "hiveward-schema-missing-unique-")), "hiveward.sqlite");
    const driver = new SqliteDriver(sqlitePath);
    driver.migrate();
    driver.db.exec(`
      PRAGMA foreign_keys = OFF;
      DROP INDEX idx_run_events_run_created;
      ALTER TABLE run_events RENAME TO run_events_with_unique;
      CREATE TABLE run_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        node_run_id TEXT REFERENCES node_runs(id) ON DELETE SET NULL,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        payload_json TEXT,
        openclaw_ref_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_run_events_run_created ON run_events(run_id, created_at);
      DROP TABLE run_events_with_unique;
      PRAGMA foreign_keys = ON;
    `);
    expect(() => driver.migrate()).toThrow(/missing unique run_events\(run_id,sequence\)/);
    driver.close();
  });

  it("fails closed when a required foreign key is missing", () => {
    const sqlitePath = join(mkdtempSync(join(tmpdir(), "hiveward-schema-missing-fk-")), "hiveward.sqlite");
    const driver = new SqliteDriver(sqlitePath);
    driver.migrate();
    driver.db.exec(`
      PRAGMA foreign_keys = OFF;
      ALTER TABLE approval_decisions RENAME TO approval_decisions_with_fk;
      CREATE TABLE approval_decisions (
        id TEXT PRIMARY KEY,
        approval_request_id TEXT NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL CHECK (actor IN ('user','system','manager')),
        comment TEXT,
        selected_reply_id TEXT,
        resulting_status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      DROP TABLE approval_decisions_with_fk;
      PRAGMA foreign_keys = ON;
    `);
    expect(() => driver.migrate()).toThrow(/missing foreign key approval_decisions\.approval_request_id->approval_requests\.id/);
    driver.close();
  });

  it("fails closed when a required CHECK constraint is missing", () => {
    const sqlitePath = join(mkdtempSync(join(tmpdir(), "hiveward-schema-missing-check-")), "hiveward.sqlite");
    const driver = new SqliteDriver(sqlitePath);
    driver.migrate();
    driver.db.exec(`
      PRAGMA foreign_keys = OFF;
      DROP INDEX idx_approval_requests_status_created;
      DROP INDEX idx_approval_requests_run_round;
      ALTER TABLE approval_requests RENAME TO approval_requests_with_check;
      CREATE TABLE approval_requests (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        round_id TEXT,
        node_run_id TEXT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        payload_ref TEXT,
        source_type TEXT,
        source_id TEXT,
        thread_id TEXT,
        revision INTEGER NOT NULL,
        replaces_request_id TEXT,
        superseded_by_request_id TEXT,
        capabilities_json TEXT NOT NULL,
        requested_by_json TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE INDEX idx_approval_requests_status_created ON approval_requests(status, requested_at DESC);
      CREATE INDEX idx_approval_requests_run_round ON approval_requests(run_id, round_id);
      DROP TABLE approval_requests_with_check;
      PRAGMA foreign_keys = ON;
    `);
    expect(() => driver.migrate()).toThrow(/check approval_requests:status IN/);
    driver.close();
  });
});

function listColumnNames(driver: SqliteDriver, table: string): string[] {
  return (driver.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}
