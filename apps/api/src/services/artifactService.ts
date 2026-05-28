import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import type { Artifact, BlueprintNodeRun } from "@hiveward/shared";
import type { FileHivewardStore } from "../store/fileHivewardStore";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const defaultDataRoot = join(repositoryRoot, "data");

export function defaultArtifactRoot(): string {
  return join(defaultDataRoot, "artifacts");
}
export class ArtifactService {
  private readonly artifactRoot: string;
  private readonly downloadUrlPrefix: string;

  constructor(
    private readonly store: FileHivewardStore,
    options: { rootDir?: string; downloadUrlPrefix?: string } = {}
  ) {
    this.artifactRoot = resolve(options.rootDir ?? join(store.getDataDir(), "artifacts"));
    this.downloadUrlPrefix = normalizeDownloadUrlPrefix(options.downloadUrlPrefix ?? "/artifacts");
  }

  async publishFromNodeRun(input: {
    runId: string;
    roundId?: string;
    nodeRun: BlueprintNodeRun;
  }): Promise<Artifact[]> {
    if (input.nodeRun.output === undefined || input.nodeRun.output === null) return [];
    const artifacts = await this.extractArtifacts({
      runId: input.runId,
      roundId: input.roundId,
      nodeRunId: input.nodeRun.id,
      title: input.nodeRun.nodeLabel,
      output: input.nodeRun.output
    });
    for (const artifact of artifacts) {
      await this.store.upsertArtifact(artifact);
    }
    return artifacts;
  }

  private async extractArtifacts(input: {
    runId: string;
    roundId?: string;
    nodeRunId?: string;
    title: string;
    output: unknown;
  }): Promise<Artifact[]> {
    const createdAt = new Date().toISOString();
    const stringOutput = typeof input.output === "string" ? input.output.trim() : "";
    const html = extractHtml(stringOutput);
    if (html) {
      const artifact = await this.writeArtifactFile(input, html, createdAt, {
        extension: "html",
        kind: "html",
        format: "text/html",
        previewPolicy: "sandboxed_iframe",
        trusted: false
      });
      return [artifact];
    }
    if (stringOutput) {
      return [await this.writeArtifactFile(input, stringOutput, createdAt, {
        extension: "md",
        kind: "markdown",
        format: "text/markdown",
        previewPolicy: "source",
        trusted: true
      })];
    }
    return [await this.writeArtifactFile(input, JSON.stringify(input.output, null, 2), createdAt, {
      extension: "json",
      kind: "json",
      format: "application/json",
      previewPolicy: "source",
      trusted: true
    })];
  }

  private async writeArtifactFile(
    input: { runId: string; roundId?: string; nodeRunId?: string; title: string },
    body: string,
    createdAt: string,
    options: {
      extension: "html" | "md" | "json";
      kind: Artifact["kind"];
      format: string;
      previewPolicy: Artifact["previewPolicy"];
      trusted: boolean;
    }
  ): Promise<Artifact> {
    const id = `artifact-${nanoid(10)}`;
    const relativePath = join("runs", input.runId, input.roundId ?? "unscoped", `${id}.${options.extension}`);
    const storagePath = join(this.artifactRoot, relativePath);
    const resolved = resolve(storagePath);
    if (!isPathInside(resolved, this.artifactRoot)) {
      throw new Error("Artifact path escaped artifact root.");
    }
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, body, "utf8");
    const publicRelativePath = relative(this.artifactRoot, resolved).replace(/\\/g, "/");
    return {
      id,
      runId: input.runId,
      roundId: input.roundId,
      nodeRunId: input.nodeRunId,
      title: input.title,
      kind: options.kind,
      format: options.format,
      storagePath: resolved,
      relativePath: publicRelativePath,
      downloadUrl: `${this.downloadUrlPrefix}/${relativePath.replace(/\\/g, "/")}`,
      previewPolicy: options.previewPolicy,
      trusted: options.trusted,
      status: "current",
      createdAt
    };
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

function extractHtml(value: string): string | undefined {
  if (!value) return undefined;
  const fenced = /```html\s*([\s\S]*?)```/i.exec(value);
  if (fenced?.[1]?.trim()) return fenced[1].trim();
  if (/<!doctype html/i.test(value) || /<html[\s>]/i.test(value)) return value;
  return undefined;
}
