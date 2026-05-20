import type { StartAgentTaskInput } from "@hiveward/shared";

const secretKeyPattern = /(api[_-]?key|auth|credential|password|secret|token)/i;

export function buildPromptEnvelope(input: StartAgentTaskInput): string {
  const schemaText = input.outputSchema
    ? [
        "",
        "Output schema JSON:",
        stableStringify(input.outputSchema),
        "",
        "Return JSON that matches the supplied schema."
      ].join("\n")
    : "";

  return [
    "You are executing one Hiveward blueprint node.",
    "",
    `Blueprint run: ${input.blueprintRunId}`,
    `Node run: ${input.nodeRunId}`,
    `Agent name: ${input.agentName}`,
    "",
    "Task:",
    input.prompt,
    "",
    "Upstream input JSON:",
    stableStringify(redactSecrets(input.input)),
    schemaText,
    "",
    "Return only the node result."
  ].join("\n");
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value), null, 2);
}

export function formatStructuredOutput(output: unknown): string {
  return typeof output === "string" ? output : stableStringify(output);
}

export function toCodexOutputSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return schema ? strictJsonObjectSchema(schema) : undefined;
}

export function validateOutputSchema(output: string, schema: Record<string, unknown> | undefined): boolean {
  if (!schema) return true;

  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return false;
  }

  return matchesSchemaType(parsed, schema);
}

function matchesSchemaType(value: unknown, schema: Record<string, unknown>): boolean {
  const expectedType = typeof schema.type === "string" ? schema.type : undefined;
  if (expectedType && !matchesJsonType(value, expectedType)) return false;

  if (expectedType === "object" && isRecord(value)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (!required.every((key) => typeof key === "string" && Object.hasOwn(value, key))) return false;

    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!Object.hasOwn(value, key) || !isRecord(propertySchema)) continue;
      if (!matchesSchemaType(value[key], propertySchema)) return false;
    }
  }

  if (expectedType === "array" && Array.isArray(value) && isRecord(schema.items)) {
    return value.every((item) => matchesSchemaType(item, schema.items as Record<string, unknown>));
  }

  return true;
}

function strictJsonObjectSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const normalized = Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, strictJsonSchemaValue(value)]));
  const type = normalized.type;
  if (type === "object" || isRecord(normalized.properties)) {
    normalized.additionalProperties = false;
  }
  return normalized;
}

function strictJsonSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(strictJsonSchemaValue);
  }
  if (!isRecord(value)) {
    return value;
  }
  return strictJsonObjectSchema(value);
}

function matchesJsonType(value: unknown, expectedType: string): boolean {
  if (expectedType === "array") return Array.isArray(value);
  if (expectedType === "object") return isRecord(value);
  if (expectedType === "integer") return Number.isInteger(value);
  if (expectedType === "number") return typeof value === "number" && Number.isFinite(value);
  if (expectedType === "string") return typeof value === "string";
  if (expectedType === "boolean") return typeof value === "boolean";
  if (expectedType === "null") return value === null;
  return true;
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }
  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, secretKeyPattern.test(key) ? "<redacted>" : redactSecrets(item)])
  );
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJsonValue(value[key])])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
