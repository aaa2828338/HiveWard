import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import type { Artifact, BlueprintNodeRun } from "@hiveward/shared";
import { FileHivewardStore } from "../store/fileHivewardStore";
import { ArtifactService } from "./artifactService";

class FailingArtifactStore extends FileHivewardStore {
  override async upsertArtifact(_artifact: Artifact): Promise<Artifact> {
    throw new Error("simulated artifact metadata failure");
  }
}

describe("ArtifactService", () => {
  it("copies kind:file path artifacts into the artifact object store with bytes and sha256", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hiveward-artifact-file-"));
    const sourceRoot = join(tempDir, "workspace");
    const dataDir = join(tempDir, "data");
    const sourcePath = join(sourceRoot, "deliverables", "report.txt");
    mkdirSync(join(sourceRoot, "deliverables"), { recursive: true });
    writeFileSync(sourcePath, "copied file artifact\n", { encoding: "utf8", flag: "w" });
    const store = new FileHivewardStore(join(dataDir, "hiveward-store.json"));
    await store.init();
    const service = new ArtifactService(store, {
      rootDir: join(dataDir, "artifacts"),
      sourceRoot
    });

    const [artifact] = await service.publishFromNodeRun({
      runId: "run-file",
      roundId: "round-file",
      nodeRun: createNodeRun({
        id: "node-run-file",
        output: {
          artifacts: [{
            slot: "bundle",
            title: "Copied report",
            kind: "file",
            path: "deliverables/report.txt"
          }]
        }
      })
    });

    expect(artifact).toMatchObject({
      kind: "file",
      bytes: Buffer.byteLength("copied file artifact\n"),
      sha256: createHash("sha256").update("copied file artifact\n").digest("hex"),
      relativePath: expect.stringMatching(/^objects\/sha256\/[a-f0-9]{2}\/.+\.txt$/),
      downloadUrl: expect.stringContaining("/artifacts/objects/sha256/")
    });
    expect(artifact?.storagePath).toBeDefined();
    expect(artifact?.storagePath).not.toBe(sourcePath);
    expect(readFileSync(artifact!.storagePath!, "utf8")).toBe("copied file artifact\n");
  });

  it("rejects missing and out-of-bounds kind:file path artifacts", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hiveward-artifact-path-"));
    const sourceRoot = join(tempDir, "workspace");
    const dataDir = join(tempDir, "data");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(tempDir, "outside.txt"), "outside", "utf8");
    writeFileSync(join(sourceRoot, ".keep"), "", { encoding: "utf8", flag: "w" });
    const store = new FileHivewardStore(join(dataDir, "hiveward-store.json"));
    await store.init();
    const service = new ArtifactService(store, {
      rootDir: join(dataDir, "artifacts"),
      sourceRoot
    });

    await expect(service.prepareFromNodeRun({
      runId: "run-missing-file",
      nodeRun: createNodeRun({
        id: "node-run-missing-file",
        output: { artifacts: [{ kind: "file", title: "Missing", path: "missing.txt" }] }
      })
    })).rejects.toThrow(/does not exist/);

    await expect(service.prepareFromNodeRun({
      runId: "run-escaped-file",
      nodeRun: createNodeRun({
        id: "node-run-escaped-file",
        output: {
          artifacts: [{
            kind: "file",
            title: "Escaped",
            path: relative(sourceRoot, join(tempDir, "outside.txt"))
          }]
        }
      })
    })).rejects.toThrow(/escaped artifact source root/);
  });

  it("writes kind:file content payloads as text files without using path copy semantics", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hiveward-artifact-file-body-"));
    const store = new FileHivewardStore(join(tempDir, "hiveward-store.json"));
    await store.init();
    const service = new ArtifactService(store, { rootDir: join(tempDir, "artifacts"), sourceRoot: tempDir });

    const [artifact] = await service.publishFromNodeRun({
      runId: "run-file-body",
      nodeRun: createNodeRun({
        id: "node-run-file-body",
        output: {
          artifacts: [{
            kind: "file",
            title: "Text payload",
            content: "text body file"
          }]
        }
      })
    });

    expect(artifact).toMatchObject({
      kind: "file",
      format: "text/plain",
      relativePath: expect.stringMatching(/\.txt$/),
      bytes: Buffer.byteLength("text body file")
    });
    expect(readFileSync(artifact!.storagePath!, "utf8")).toBe("text body file");
  });

  it("does not leave run-scoped published files when artifact metadata publish fails", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hiveward-artifact-orphan-"));
    const store = new FailingArtifactStore(join(tempDir, "hiveward-store.json"));
    await store.init();
    const service = new ArtifactService(store, { rootDir: join(tempDir, "artifacts"), sourceRoot: tempDir });

    await expect(service.publishFromNodeRun({
      runId: "run-metadata-fails",
      roundId: "round-metadata-fails",
      nodeRun: createNodeRun({
        id: "node-run-metadata-fails",
        output: {
          artifacts: [{
            kind: "markdown",
            title: "Metadata fails",
            content: "# orphan is detectable"
          }]
        }
      })
    })).rejects.toThrow(/metadata failure/);

    const artifactFiles = await listFiles(join(tempDir, "artifacts"));
    expect(artifactFiles.some((file) => file.startsWith("runs/"))).toBe(false);
    expect(artifactFiles.some((file) => file.startsWith("objects/sha256/"))).toBe(true);
  });
});

function createNodeRun(input: { id: string; output: unknown }): BlueprintNodeRun {
  const now = new Date().toISOString();
  return {
    id: input.id,
    blueprintRunId: "run-artifact",
    blueprintId: "blueprint-artifact",
    nodeId: "node-artifact",
    nodeLabel: "Artifact Node",
    nodeType: "agent",
    status: "succeeded",
    queuedAt: now,
    startedAt: now,
    endedAt: now,
    output: input.output
  };
}

async function listFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)).map((file) => `${entry.name}/${file}`));
    } else if (entry.isFile()) {
      files.push(entry.name);
    }
  }
  return files.map((file) => file.replace(/\\/g, "/")).sort();
}
