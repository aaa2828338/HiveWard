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

  it("stores missing and out-of-bounds path declarations without reading unsafe files", async () => {
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

    const [missing] = await service.prepareFromNodeRun({
      runId: "run-missing-file",
      nodeRun: createNodeRun({
        id: "node-run-missing-file",
        output: { artifacts: [{ kind: "file", title: "Missing", path: "missing.txt" }] }
      })
    });
    expect(missing).toMatchObject({
      kind: "json",
      title: "Missing",
      relativePath: expect.stringMatching(/\.json$/)
    });
    expect(readFileSync(missing!.storagePath!, "utf8")).toContain("missing.txt");

    const [escaped] = await service.prepareFromNodeRun({
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
    });
    expect(escaped).toMatchObject({
      kind: "json",
      title: "Escaped",
      relativePath: expect.stringMatching(/\.json$/)
    });
    expect(readFileSync(escaped!.storagePath!, "utf8")).toContain("outside.txt");
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

  it("writes html artifact payloads when agents use the body alias", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hiveward-artifact-html-body-"));
    const store = new FileHivewardStore(join(tempDir, "hiveward-store.json"));
    await store.init();
    const service = new ArtifactService(store, { rootDir: join(tempDir, "artifacts"), sourceRoot: tempDir });
    const html = "<!doctype html><html><body>self dispatch page</body></html>";

    const [artifact] = await service.publishFromNodeRun({
      runId: "run-html-body",
      nodeRun: createNodeRun({
        id: "node-run-html-body",
        output: {
          artifacts: [{
            kind: "html",
            title: "Self dispatch page",
            format: "text/html",
            previewPolicy: "sandboxed_iframe",
            trusted: true,
            body: html
          }]
        }
      })
    });

    expect(artifact).toMatchObject({
      kind: "html",
      format: "text/html",
      previewPolicy: "sandboxed_iframe",
      trusted: true,
      relativePath: expect.stringMatching(/\.html$/),
      bytes: Buffer.byteLength(html)
    });
    expect(readFileSync(artifact!.storagePath!, "utf8")).toBe(html);
  });

  it("publishes kind:html path artifacts as clickable html artifacts", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hiveward-artifact-html-path-"));
    const sourceRoot = join(tempDir, "workspace");
    const dataDir = join(tempDir, "data");
    const sourcePath = join(sourceRoot, "deliverables", "report.html");
    const html = "<!doctype html><html><body>real html file</body></html>";
    mkdirSync(join(sourceRoot, "deliverables"), { recursive: true });
    writeFileSync(sourcePath, html, { encoding: "utf8", flag: "w" });
    const store = new FileHivewardStore(join(dataDir, "hiveward-store.json"));
    await store.init();
    const service = new ArtifactService(store, {
      rootDir: join(dataDir, "artifacts"),
      sourceRoot
    });

    const [artifact] = await service.prepareFromNodeRun({
      runId: "run-html-path",
      nodeRun: createNodeRun({
        id: "node-run-html-path",
        output: {
          artifacts: [{
            kind: "html",
            title: "Path HTML",
            path: "deliverables/report.html"
          }]
        }
      })
    });

    expect(artifact).toMatchObject({
      kind: "html",
      format: "text/html",
      previewPolicy: "sandboxed_iframe",
      relativePath: expect.stringMatching(/\.html$/),
      downloadUrl: expect.stringMatching(/\/artifacts\/.*\.html$/),
      bytes: Buffer.byteLength(html)
    });
    expect(readFileSync(artifact!.storagePath!, "utf8")).toBe(html);
  });

  it("accepts artifact payloads that mix path with content fields", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hiveward-artifact-ambiguous-source-"));
    const sourceRoot = join(tempDir, "workspace");
    const dataDir = join(tempDir, "data");
    mkdirSync(join(sourceRoot, "deliverables"), { recursive: true });
    writeFileSync(
      join(sourceRoot, "deliverables", "report.html"),
      "<!doctype html><html><body>real html file</body></html>",
      { encoding: "utf8", flag: "w" }
    );
    const store = new FileHivewardStore(join(dataDir, "hiveward-store.json"));
    await store.init();
    const service = new ArtifactService(store, {
      rootDir: join(dataDir, "artifacts"),
      sourceRoot
    });

    const [artifact] = await service.prepareFromNodeRun({
      runId: "run-ambiguous-source",
      nodeRun: createNodeRun({
        id: "node-run-ambiguous-source",
        output: {
          artifacts: [{
            kind: "file",
            title: "Ambiguous file",
            path: "deliverables/report.html",
            content: "完整单文件 HTML 报告"
          }]
        }
      })
    });
    expect(artifact).toMatchObject({
      kind: "file",
      title: "Ambiguous file",
      relativePath: expect.stringMatching(/\.html$/)
    });
    expect(readFileSync(artifact!.storagePath!, "utf8")).toContain("real html file");
  });

  it("publishes html artifact payloads even when they are prose instead of complete documents", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hiveward-artifact-invalid-html-"));
    const store = new FileHivewardStore(join(tempDir, "hiveward-store.json"));
    await store.init();
    const service = new ArtifactService(store, { rootDir: join(tempDir, "artifacts"), sourceRoot: tempDir });

    const [artifact] = await service.prepareFromNodeRun({
      runId: "run-invalid-html",
      nodeRun: createNodeRun({
        id: "node-run-invalid-html",
        output: {
          artifacts: [{
            kind: "html",
            title: "AI Agent report",
            body: "完整单文件 HTML，主题：AI Agent 与多 Agent 工作流进入企业运营"
          }]
        }
      })
    });
    expect(artifact).toMatchObject({
      kind: "html",
      title: "AI Agent report",
      relativePath: expect.stringMatching(/\.html$/)
    });
    expect(readFileSync(artifact!.storagePath!, "utf8")).toContain("AI Agent");
  });

  it("scopes agent-provided artifact ids by node run to avoid cross-run collisions", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hiveward-artifact-id-scope-"));
    const store = new FileHivewardStore(join(tempDir, "hiveward-store.json"));
    await store.init();
    const service = new ArtifactService(store, { rootDir: join(tempDir, "artifacts"), sourceRoot: tempDir });

    const [first] = await service.publishFromNodeRun({
      runId: "run-first",
      nodeRun: createNodeRun({
        id: "node-run-first",
        output: {
          artifacts: [{
            id: "preview",
            kind: "html",
            title: "Preview",
            body: "<!doctype html><html><body>first</body></html>"
          }]
        }
      })
    });
    const [second] = await service.publishFromNodeRun({
      runId: "run-second",
      nodeRun: createNodeRun({
        id: "node-run-second",
        output: {
          artifacts: [{
            id: "preview",
            kind: "html",
            title: "Preview",
            body: "<!doctype html><html><body>second</body></html>"
          }]
        }
      })
    });

    expect(first?.id).toContain("node-run-first");
    expect(second?.id).toContain("node-run-second");
    expect(first?.id).not.toBe(second?.id);
    expect(await store.listArtifacts("run-first")).toHaveLength(1);
    expect(await store.listArtifacts("run-second")).toHaveLength(1);
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
