const RUNTIME_LABEL_MAX_LENGTH = 160;

export function runtimeLabelFromRecord(record: Record<string, unknown>, fallback: string): string {
  const command = readString(record.command);
  if (command) return compactRuntimeLabel(command);

  const toolName =
    readString(record.tool_name) ??
    readString(record.toolName) ??
    readString(record.name) ??
    readString(record.title);
  const detail = readRuntimeDetail(record);
  if (toolName && detail && detail !== toolName) return compactRuntimeLabel(`${toolName} ${detail}`);
  return compactRuntimeLabel(toolName ?? detail ?? fallback);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readRuntimeDetail(record: Record<string, unknown>): string | undefined {
  const directPath =
    readString(record.path) ??
    readString(record.file_path) ??
    readString(record.filePath) ??
    readString(record.relative_path) ??
    readString(record.relativePath);
  if (directPath) return directPath;

  for (const key of ["input", "arguments", "args", "params", "parameters"]) {
    const nested = readRecord(record[key]);
    if (!nested) continue;
    const nestedDetail =
      readString(nested.path) ??
      readString(nested.file_path) ??
      readString(nested.filePath) ??
      readString(nested.relative_path) ??
      readString(nested.relativePath) ??
      readString(nested.command) ??
      readString(nested.cmd);
    if (nestedDetail) return nestedDetail;
  }
  return undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  const raw = readString(value);
  if (!raw || raw.length > 2_000 || (!raw.startsWith("{") && !raw.startsWith("["))) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function compactRuntimeLabel(label: string): string {
  const compacted = label.replace(/\s+/g, " ").trim();
  if (compacted.length <= RUNTIME_LABEL_MAX_LENGTH) return compacted;
  return `${compacted.slice(0, RUNTIME_LABEL_MAX_LENGTH - 1)}...`;
}
