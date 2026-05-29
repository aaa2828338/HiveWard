import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BlueprintRun } from "@hiveward/shared";
import { contractNow, createContractBlueprint } from "../storeContractFixtures";
import { SqliteDriver } from "./sqliteDriver";
import { SqliteHivewardStore } from "./sqliteHivewardStore";

describe("SqliteHivewardStore run sequence counters", () => {
  it("claims unique stable event sequences across multiple SQLite connections", async () => {
    const sqlitePath = join(mkdtempSync(join(tmpdir(), "hiveward-event-sequence-")), "hiveward.sqlite");
    const { run, stores } = await createSequenceStores(sqlitePath);
    try {
      await Promise.all(Array.from({ length: 100 }, (_, index) =>
        stores[index % stores.length]!.appendEvent({
          id: `event-concurrent-${index}`,
          blueprintRunId: run.id,
          type: "node.run.started",
          message: `Concurrent event ${index}`,
          createdAt: new Date(Date.parse(contractNow) + index).toISOString()
        })
      ));

      const sequences = readSequences(sqlitePath, "run_events", run.id);
      expect(sequences).toHaveLength(100);
      expect(new Set(sequences).size).toBe(100);
      expect(sequences).toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
    } finally {
      closeStores(stores);
    }
  });

  it("claims unique stable timeline sequences across multiple SQLite connections", async () => {
    const sqlitePath = join(mkdtempSync(join(tmpdir(), "hiveward-timeline-sequence-")), "hiveward.sqlite");
    const { run, stores } = await createSequenceStores(sqlitePath);
    try {
      await Promise.all(Array.from({ length: 100 }, (_, index) =>
        stores[index % stores.length]!.appendRunTimelineItem({
          id: `timeline-concurrent-${index}`,
          runId: run.id,
          createdAt: new Date(Date.parse(contractNow) + index).toISOString(),
          actorLabel: "Sequence test",
          kind: "node_output",
          title: `Concurrent timeline ${index}`
        })
      ));

      const timeline = await stores[0]!.listRunTimeline(run.id);
      expect(timeline).toHaveLength(100);
      expect(new Set(timeline.map((item) => item.sequence)).size).toBe(100);
      expect(timeline.map((item) => item.sequence)).toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
      expect(timeline.map((item) => item.id)).toEqual(Array.from({ length: 100 }, (_, index) => `timeline-concurrent-${index}`));
    } finally {
      closeStores(stores);
    }
  });

  it("initializes counters from existing imported event and timeline rows", async () => {
    const sqlitePath = join(mkdtempSync(join(tmpdir(), "hiveward-imported-sequence-")), "hiveward.sqlite");
    const store = new SqliteHivewardStore(sqlitePath);
    await store.init();
    try {
      const blueprint = await store.saveBlueprint(createContractBlueprint());
      const run = await store.createBlueprintRun(blueprint, "sequence-user");
      const driver = new SqliteDriver(sqlitePath);
      try {
        driver.db.prepare(
          `INSERT INTO run_events (id, run_id, sequence, type, message, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run("event-imported-40", run.id, 40, "node.run.started", "Imported event", contractNow);
        driver.db.prepare(
          `INSERT INTO run_timeline_items (id, run_id, sequence, created_at, actor_label, kind, title)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run("timeline-imported-25", run.id, 25, contractNow, "Importer", "node_output", "Imported timeline");
      } finally {
        driver.close();
      }

      await store.appendEvent({
        id: "event-after-import",
        blueprintRunId: run.id,
        type: "node.run.completed",
        message: "After import",
        createdAt: contractNow
      });
      await store.appendRunTimelineItem({
        id: "timeline-after-import",
        runId: run.id,
        createdAt: contractNow,
        actorLabel: "Sequence test",
        kind: "node_output",
        title: "After import"
      });

      expect(readEventSequence(sqlitePath, "event-after-import")).toBe(41);
      expect((await store.listRunTimeline(run.id)).find((item) => item.id === "timeline-after-import")?.sequence).toBe(26);
    } finally {
      store.close();
    }
  });
});

async function createSequenceStores(sqlitePath: string): Promise<{ run: BlueprintRun; stores: SqliteHivewardStore[] }> {
  const primary = new SqliteHivewardStore(sqlitePath);
  await primary.init();
  const blueprint = await primary.saveBlueprint(createContractBlueprint());
  const run = await primary.createBlueprintRun(blueprint, "sequence-user");
  const secondary = new SqliteHivewardStore(sqlitePath);
  await secondary.init();
  return { run, stores: [primary, secondary] };
}

function closeStores(stores: SqliteHivewardStore[]): void {
  for (const store of stores) store.close();
}

function readSequences(sqlitePath: string, table: "run_events" | "run_timeline_items", runId: string): number[] {
  const driver = new SqliteDriver(sqlitePath);
  try {
    const rows = driver.db.prepare(`SELECT sequence FROM ${table} WHERE run_id = ? ORDER BY sequence`).all(runId) as Array<{ sequence: number }>;
    return rows.map((row) => row.sequence);
  } finally {
    driver.close();
  }
}

function readEventSequence(sqlitePath: string, eventId: string): number | undefined {
  const driver = new SqliteDriver(sqlitePath);
  try {
    const row = driver.db.prepare("SELECT sequence FROM run_events WHERE id = ?").get(eventId) as { sequence?: number } | undefined;
    return row?.sequence;
  } finally {
    driver.close();
  }
}
