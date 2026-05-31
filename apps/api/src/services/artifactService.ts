import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import type { AgentArtifactPayload, Artifact, BlueprintNodeRun } from "@hiveward/shared";
import type { HivewardStore } from "../store/hivewardStore";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const defaultDataRoot = join(repositoryRoot, "data");

type NormalizedArtifactPayload = AgentArtifactPayload & {
  declaration: Record<string, unknown>;
};

export function defaultArtifactRoot(): string {
  return join(defaultDataRoot, "artifacts");
}

export class ArtifactService {
  private readonly artifactRoot: string;
  private readonly artifactSourceRoot: string;
  private readonly downloadUrlPrefix: string;

  constructor(
    private readonly store: HivewardStore,
    options: { rootDir?: string; sourceRoot?: string; downloadUrlPrefix?: string } = {}
  ) {
    this.artifactRoot = resolve(options.rootDir ?? join(store.getDataDir(), "artifacts"));
    this.artifactSourceRoot = resolve(options.sourceRoot ?? repositoryRoot);
    this.downloadUrlPrefix = normalizeDownloadUrlPrefix(options.downloadUrlPrefix ?? "/artifacts");
  }

  async publishFromNodeRun(input: {
    runId: string;
    roundId?: string;
    nodeRun: BlueprintNodeRun;
  }): Promise<Artifact[]> {
    const artifacts = await this.prepareFromNodeRun(input);
    for (const artifact of artifacts) {
      await this.store.upsertArtifact(artifact);
    }
    return artifacts;
  }

  async prepareFromNodeRun(input: {
    runId: string;
    roundId?: string;
    nodeRun: BlueprintNodeRun;
  }): Promise<Artifact[]> {
    const payloads = readExplicitArtifactPayloads(input.nodeRun.output);
    if (payloads.length === 0) return [];
    return this.publishArtifacts({
      runId: input.runId,
      roundId: input.roundId,
      nodeRunId: input.nodeRun.id,
      defaultTitle: input.nodeRun.nodeLabel,
      artifacts: payloads
    });
  }

  async publishArtifacts(input: {
    runId: string;
    roundId?: string;
    nodeRunId?: string;
    defaultTitle: string;
    artifacts: AgentArtifactPayload[];
  }): Promise<Artifact[]> {
    const createdAt = new Date().toISOString();
    const artifacts: Artifact[] = [];
    for (const [index, payload] of input.artifacts.entries()) {
      artifacts.push(await this.publishArtifactPayload(input, payload, createdAt, index));
    }
    return artifacts;
  }

  private async publishArtifactPayload(
    input: {
      runId: string;
      roundId?: string;
      nodeRunId?: string;
      defaultTitle: string;
    },
    payload: AgentArtifactPayload,
    createdAt: string,
    index: number
  ): Promise<Artifact> {
    const artifactId = scopedArtifactId(input.nodeRunId, normalizeArtifactId(payload.id)) ??
      stableArtifactId(input.nodeRunId, payload.slot, index);
    if (payload.kind === "link") {
      const url = typeof payload.url === "string" && payload.url.trim() ? payload.url.trim() : undefined;
      if (url) {
        return {
          id: artifactId ?? `artifact-${nanoid(10)}`,
          runId: input.runId,
          roundId: input.roundId,
          nodeRunId: input.nodeRunId,
          slot: payload.slot,
          title: payload.title ?? input.defaultTitle,
          kind: "link",
          format: payload.format,
          downloadUrl: url,
          previewPolicy: payload.previewPolicy ?? "none",
          trusted: payload.trusted ?? false,
          status: "current",
          createdAt
        };
      }
    }

    if (payload.path) {
      const copied = await this.tryCopyArtifactFile({
        ...input,
        artifactId,
        slot: payload.slot,
        title: payload.title ?? input.defaultTitle
      }, payload, createdAt);
      if (copied) return copied;
    }

    if (payload.content !== undefined || payload.body !== undefined) {
      const body = serializeArtifactBody(payload);
      return this.writeArtifactBuffer(
        {
          ...input,
          artifactId,
          slot: payload.slot,
          title: payload.title ?? input.defaultTitle
        },
        Buffer.from(body, "utf8"),
        createdAt,
        resolveArtifactWriteOptions(payload)
      );
    }

    if (payload.url) {
      return {
        id: artifactId ?? `artifact-${nanoid(10)}`,
        runId: input.runId,
        roundId: input.roundId,
        nodeRunId: input.nodeRunId,
        slot: payload.slot,
        title: payload.title ?? input.defaultTitle,
        kind: "link",
        format: payload.format,
        downloadUrl: payload.url,
        previewPolicy: "none",
        trusted: payload.trusted ?? false,
        status: "current",
        createdAt
      };
    }

    return this.writeArtifactBuffer(
      {
        ...input,
        artifactId,
        slot: payload.slot,
        title: payload.title ?? input.defaultTitle
      },
      Buffer.from(serializeArtifactDeclaration(payload), "utf8"),
      createdAt,
      {
        extension: "json",
        kind: "json",
        format: "application/json",
        previewPolicy: "source",
        trusted: true
      }
    );
  }

  private async tryCopyArtifactFile(
    input: {
      runId: string;
      roundId?: string;
      nodeRunId?: string;
      artifactId?: string;
      slot?: string;
      title: string;
    },
    payload: AgentArtifactPayload,
    createdAt: string
  ): Promise<Artifact | undefined> {
    try {
      return await this.copyArtifactFile(input, payload, createdAt);
    } catch {
      return undefined;
    }
  }

  private async copyArtifactFile(
    input: {
      runId: string;
      roundId?: string;
      nodeRunId?: string;
      artifactId?: string;
      slot?: string;
      title: string;
    },
    payload: AgentArtifactPayload,
    createdAt: string
  ): Promise<Artifact> {
    if (!payload.path) throw new Error("Artifact path payload requires path.");
    const sourcePath = await this.resolveArtifactSourcePath(payload.path);
    const bytes = await readFile(sourcePath);
    const options = payload.kind === "file"
      ? {
          extension: extensionFromPath(sourcePath),
          kind: "file" as const,
          format: payload.format ?? "application/octet-stream",
          previewPolicy: payload.previewPolicy ?? "source",
          trusted: payload.trusted ?? true
        }
      : resolveArtifactWriteOptions(payload);
    return this.writeArtifactBuffer(input, bytes, createdAt, options);
  }

  private async writeArtifactBuffer(
    input: {
      runId: string;
      roundId?: string;
      nodeRunId?: string;
      artifactId?: string;
      slot?: string;
      title: string;
    },
    body: Buffer,
    createdAt: string,
    options: {
      extension: string;
      kind: Artifact["kind"];
      format: string;
      previewPolicy: Artifact["previewPolicy"];
      trusted: boolean;
    }
  ): Promise<Artifact> {
    const id = input.artifactId ?? `artifact-${nanoid(10)}`;
    const sha256 = createHash("sha256").update(body).digest("hex");
    const relativePath = join("objects", "sha256", sha256.slice(0, 2), `${sha256}.${sanitizeExtension(options.extension)}`);
    const storagePath = join(this.artifactRoot, relativePath);
    const resolved = resolve(storagePath);
    if (!isPathInside(resolved, this.artifactRoot)) {
      throw new Error("Artifact path escaped artifact root.");
    }
    await this.writeContentAddressedFile(resolved, body);
    const fileStat = await stat(resolved);
    const publicRelativePath = relative(this.artifactRoot, resolved).replace(/\\/g, "/");
    return {
      id,
      runId: input.runId,
      roundId: input.roundId,
      nodeRunId: input.nodeRunId,
      slot: input.slot,
      title: input.title,
      kind: options.kind,
      format: options.format,
      storagePath: resolved,
      relativePath: publicRelativePath,
      downloadUrl: `${this.downloadUrlPrefix}/${publicRelativePath}`,
      previewPolicy: options.previewPolicy,
      trusted: options.trusted,
      status: "current",
      bytes: fileStat.size,
      sha256,
      createdAt
    };
  }

  private async resolveArtifactSourcePath(payloadPath: string): Promise<string> {
    const candidate = resolve(this.artifactSourceRoot, payloadPath);
    let sourceRootReal: string;
    let sourceReal: string;
    try {
      [sourceRootReal, sourceReal] = await Promise.all([
        realpath(this.artifactSourceRoot),
        realpath(candidate)
      ]);
    } catch {
      throw new Error(`File artifact path does not exist: ${payloadPath}`);
    }
    if (!isPathInside(sourceReal, sourceRootReal)) {
      throw new Error("File artifact path escaped artifact source root.");
    }
    const sourceStat = await stat(sourceReal);
    if (!sourceStat.isFile()) {
      throw new Error(`File artifact path is not a file: ${payloadPath}`);
    }
    return sourceReal;
  }

  private async writeContentAddressedFile(resolved: string, body: Buffer): Promise<void> {
    if (await isReadableFile(resolved)) return;
    await mkdir(dirname(resolved), { recursive: true });
    const stagingDir = join(this.artifactRoot, ".staging");
    await mkdir(stagingDir, { recursive: true });
    const stagingPath = join(stagingDir, `artifact-${nanoid(12)}.tmp`);
    await writeFile(stagingPath, body);
    try {
      await rename(stagingPath, resolved);
    } catch (error) {
      if (await isReadableFile(resolved)) return;
      throw error;
    } finally {
      await rm(stagingPath, { force: true });
    }
  }
}

export function isPathInside(candidatePath: string, rootPath: string): boolean {
  const root = resolve(rootPath);
  const candidate = resolve(candidatePath);
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

function normalizeDownloadUrlPrefix(value: string): string {
  const trimmed = value.trim().replace(/\/+$/g, "");
  return trimmed.startsWith("/") ? trimmed || "/artifacts" : `/${trimmed || "artifacts"}`;
}

function readExplicitArtifactPayloads(output: unknown): NormalizedArtifactPayload[] {
  const record = readOutputRecord(output);
  if (!Array.isArray(record?.artifacts)) return [];
  return record.artifacts.flatMap((item) => normalizeArtifactPayload(item));
}

function stableArtifactId(nodeRunId: string | undefined, slot: string | undefined, index: number): string | undefined {
  if (!nodeRunId) return undefined;
  const suffix = (slot?.trim() || String(index + 1)).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `artifact-${nodeRunId}-${suffix || index + 1}`;
}

function normalizeArtifactId(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || undefined;
}

function scopedArtifactId(nodeRunId: string | undefined, artifactId: string | undefined): string | undefined {
  if (!artifactId) return undefined;
  if (!nodeRunId) return artifactId;
  if (artifactId.includes(nodeRunId)) return artifactId;
  return normalizeArtifactId(`artifact-${nodeRunId}-${artifactId}`);
}

function normalizeArtifactPayload(value: unknown): NormalizedArtifactPayload[] {
  if (!isRecord(value)) return [];
  const kind = normalizeArtifactKind(value.kind);
  return [{
    id: readString(value.id),
    slot: readString(value.slot),
    title: readString(value.title),
    kind,
    format: readString(value.format),
    previewPolicy: normalizePreviewPolicy(value.previewPolicy),
    trusted: typeof value.trusted === "boolean" ? value.trusted : undefined,
    content: value.content,
    body: value.body,
    path: readString(value.path),
    url: readString(value.url),
    declaration: value
  }];
}

function normalizeArtifactKind(value: unknown): Artifact["kind"] {
  return value === "html" || value === "markdown" || value === "json" || value === "file" || value === "link"
    ? value
    : "json";
}

function serializeArtifactBody(payload: AgentArtifactPayload): string {
  const body = payload.content ?? payload.body;
  if (payload.kind === "json") {
    return typeof body === "string" ? body : JSON.stringify(body ?? {}, null, 2);
  }
  if (body === undefined || body === null) {
    throw new Error(`Artifact payload ${payload.title ?? payload.slot ?? payload.kind} requires content.`);
  }
  return typeof body === "string" ? body : JSON.stringify(body, null, 2);
}

function serializeArtifactDeclaration(payload: AgentArtifactPayload): string {
  const declaration = "declaration" in payload && isRecord(payload.declaration)
    ? payload.declaration
    : {
        id: payload.id,
        slot: payload.slot,
        title: payload.title,
        kind: payload.kind,
        format: payload.format,
        previewPolicy: payload.previewPolicy,
        trusted: payload.trusted,
        path: payload.path,
        url: payload.url
      };
  return JSON.stringify({
    note: "HiveWard stored this artifact declaration as returned because no readable inline body, URL, or safe file path was available.",
    declaration
  }, null, 2);
}

function resolveArtifactWriteOptions(payload: AgentArtifactPayload): {
  extension: string;
  kind: Artifact["kind"];
  format: string;
  previewPolicy: Artifact["previewPolicy"];
  trusted: boolean;
} {
  if (payload.kind === "html") {
    return {
      extension: "html",
      kind: "html",
      format: payload.format ?? "text/html",
      previewPolicy: payload.previewPolicy ?? "sandboxed_iframe",
      trusted: payload.trusted ?? false
    };
  }
  if (payload.kind === "json") {
    return {
      extension: "json",
      kind: "json",
      format: payload.format ?? "application/json",
      previewPolicy: payload.previewPolicy ?? "source",
      trusted: payload.trusted ?? true
    };
  }
  if (payload.kind === "file") {
    return {
      extension: "txt",
      kind: "file",
      format: payload.format ?? "text/plain",
      previewPolicy: payload.previewPolicy ?? "source",
      trusted: payload.trusted ?? true
    };
  }
  return {
    extension: "md",
    kind: "markdown",
    format: payload.format ?? "text/markdown",
    previewPolicy: payload.previewPolicy ?? "source",
    trusted: payload.trusted ?? true
  };
}

function extensionFromPath(path: string): string {
  return sanitizeExtension(extname(path).replace(/^\./, "") || "bin");
}

function sanitizeExtension(extension: string): string {
  return extension.trim().replace(/[^a-zA-Z0-9]+/g, "").slice(0, 16) || "bin";
}

async function isReadableFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function readOutputRecord(output: unknown): Record<string, unknown> | undefined {
  if (isRecord(output)) return output;
  if (typeof output !== "string") return undefined;
  const trimmed = output.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizePreviewPolicy(value: unknown): Artifact["previewPolicy"] | undefined {
  return value === "none" || value === "source" || value === "sandboxed_iframe" ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
