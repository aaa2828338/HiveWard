export type AgentSdkErrorCode =
  | "workspace_not_allowed"
  | "permission_denied"
  | "timeout"
  | "cancelled"
  | "provider_error"
  | "invalid_output";

export class AgentSdkError extends Error {
  constructor(
    readonly code: AgentSdkErrorCode,
    message: string
  ) {
    super(`${code}: ${message}`);
    this.name = "AgentSdkError";
  }
}

export function formatAgentSdkError(code: AgentSdkErrorCode, detail: string): string {
  return `${code}: ${detail}`;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { name?: unknown; code?: unknown; message?: unknown };
  return record.name === "AbortError" || record.code === "ABORT_ERR" || String(record.message ?? "").toLowerCase().includes("abort");
}
