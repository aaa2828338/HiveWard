import type { StartAgentTaskInput } from "@hiveward/shared";

const secretKeyPattern = /(api[_-]?key|auth|credential|password|secret|token)/i;

export function buildPromptEnvelope(input: StartAgentTaskInput): string {
  const skillText = input.skillIds?.length
    ? ["", "Selected skills:", ...input.skillIds.map((skillId) => `- ${skillId}`)].join("\n")
    : "";
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
    skillText,
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
  const expectedTypes = readSchemaTypes(schema.type);
  if (expectedTypes.length > 0 && !expectedTypes.some((type) => matchesJsonType(value, type))) return false;

  if (expectedTypes.includes("object") && isRecord(value)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (!required.every((key) => typeof key === "string" && Object.hasOwn(value, key))) return false;
    const requiredKeys = new Set(readRequiredKeys(required));

    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!Object.hasOwn(value, key) || !isRecord(propertySchema)) continue;
      if (!requiredKeys.has(key) && value[key] === null) continue;
      if (!matchesSchemaType(value[key], propertySchema)) return false;
    }
  }

  if (expectedTypes.includes("array") && Array.isArray(value) && isRecord(schema.items)) {
    return value.every((item) => matchesSchemaType(item, schema.items as Record<string, unknown>));
  }

  return true;
}

function strictJsonObjectSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const normalized = Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, strictJsonSchemaValue(value)]));
  const type = normalized.type;
  const properties = isRecord(normalized.properties) ? normalized.properties : undefined;
  if (type === "object" || properties) {
    normalized.additionalProperties = false;
    normalized.required = properties ? Object.keys(properties) : [];
    const originalRequired = new Set(readRequiredKeys(schema.required));
    if (properties) {
      normalized.properties = Object.fromEntries(
        Object.entries(properties).map(([key, value]) => [key, originalRequired.has(key) ? value : nullableJsonSchemaValue(value)])
      );
    }
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

function nullableJsonSchemaValue(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const normalized = { ...value };
  normalized.type = addNullSchemaType(normalized.type);
  if (Array.isArray(normalized.enum) && !normalized.enum.includes(null)) {
    normalized.enum = [...normalized.enum, null];
  }
  return normalized;
}

function addNullSchemaType(type: unknown): unknown {
  if (typeof type === "string") {
    return type === "null" ? type : [type, "null"];
  }
  if (Array.isArray(type)) {
    return type.includes("null") ? type : [...type, "null"];
  }
  return type;
}

function readSchemaTypes(type: unknown): string[] {
  if (typeof type === "string") return [type];
  if (!Array.isArray(type)) return [];
  return type.filter((item): item is string => typeof item === "string");
}

function readRequiredKeys(required: unknown): string[] {
  if (!Array.isArray(required)) return [];
  return required.filter((item): item is string => typeof item === "string");
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
