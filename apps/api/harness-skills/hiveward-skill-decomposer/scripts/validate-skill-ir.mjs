#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const sourceArg = process.argv[2];

try {
  const text = sourceArg ? await readFile(sourceArg, "utf8") : await readStdin();
  const value = JSON.parse(text);
  const errors = validateSkillIr(value);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ valid: true, errors: [] }, null, 2)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

export function validateSkillIr(value) {
  const errors = [];
  if (!isRecord(value)) return ["Skill IR must be a JSON object."];
  requireEqual(errors, value.schema, "hiveward.skill-ir/v1", "schema");
  requireRecord(errors, value.source, "source");
  requireRecord(errors, value.identity, "identity");
  requireRecord(errors, value.classification, "classification");
  requireRecord(errors, value.packageInventory, "packageInventory");
  requireRecord(errors, value.operatingModel, "operatingModel");
  requireArray(errors, value.phases, "phases");
  requireArray(errors, value.scripts, "scripts");
  requireArray(errors, value.references, "references");
  requireArray(errors, value.assets, "assets");
  requireArray(errors, value.risks, "risks");
  requireArray(errors, value.validation, "validation");
  requireArray(errors, value.unresolved, "unresolved");

  if (isRecord(value.identity)) {
    requireString(errors, value.identity.name, "identity.name");
    requireString(errors, value.identity.description, "identity.description");
    requireArray(errors, value.identity.triggers, "identity.triggers");
  }

  if (isRecord(value.classification)) {
    requireEnum(errors, value.classification.primaryType, ["role", "process", "tooling", "domain", "reference", "composite"], "classification.primaryType");
    requireArray(errors, value.classification.traits, "classification.traits");
    requireEnum(errors, value.classification.confidence, ["high", "medium", "low"], "classification.confidence");
    requireString(errors, value.classification.reasoning, "classification.reasoning");
  }

  if (Array.isArray(value.phases)) {
    value.phases.forEach((phase, index) => validatePhase(errors, phase, `phases[${index}]`));
  }

  if (Array.isArray(value.scripts)) {
    value.scripts.forEach((script, index) => validateScriptAsset(errors, script, `scripts[${index}]`));
  }

  return errors;
}

function validatePhase(errors, phase, fieldName) {
  if (!isRecord(phase)) {
    errors.push(`${fieldName} must be an object.`);
    return;
  }
  requireString(errors, phase.id, `${fieldName}.id`);
  requireString(errors, phase.label, `${fieldName}.label`);
  requireString(errors, phase.purpose, `${fieldName}.purpose`);
  requireArray(errors, phase.inputs, `${fieldName}.inputs`);
  requireArray(errors, phase.outputs, `${fieldName}.outputs`);
  requireArray(errors, phase.validation, `${fieldName}.validation`);
  requireArray(errors, phase.dependencies, `${fieldName}.dependencies`);
  requireEnum(errors, phase.difficulty, ["trivial", "simple", "standard", "complex", "critical"], `${fieldName}.difficulty`);
  requireRecord(errors, phase.modelProfile, `${fieldName}.modelProfile`);
  if (isRecord(phase.modelProfile)) {
    requireEnum(errors, phase.modelProfile.modelClass, ["default", "small", "standard", "strong", "specialist"], `${fieldName}.modelProfile.modelClass`);
    requireEnum(errors, phase.modelProfile.thinkingEffort, ["off", "minimal", "low", "medium", "high", "adaptive", "xhigh", "max"], `${fieldName}.modelProfile.thinkingEffort`);
    requireString(errors, phase.modelProfile.reason, `${fieldName}.modelProfile.reason`);
  }
  if (phase.canRunInParallel !== true && phase.canRunInParallel !== false) {
    errors.push(`${fieldName}.canRunInParallel must be boolean.`);
  }
  if (phase.canRunInParallel === true && typeof phase.parallelGroupId !== "string") {
    errors.push(`${fieldName}.parallelGroupId is required for parallel phases.`);
  }
}

function validateScriptAsset(errors, script, fieldName) {
  if (!isRecord(script)) {
    errors.push(`${fieldName} must be an object.`);
    return;
  }
  requireString(errors, script.path, `${fieldName}.path`);
  requireEnum(errors, script.runtime, ["node", "python", "bash", "unknown"], `${fieldName}.runtime`);
  requireString(errors, script.purpose, `${fieldName}.purpose`);
  requireArray(errors, script.expectedInputs, `${fieldName}.expectedInputs`);
  requireArray(errors, script.expectedOutputs, `${fieldName}.expectedOutputs`);
  requireArray(errors, script.sideEffects, `${fieldName}.sideEffects`);
  requireArray(errors, script.requiredPermissions, `${fieldName}.requiredPermissions`);
  if (script.shouldExecuteByDefault !== false) {
    errors.push(`${fieldName}.shouldExecuteByDefault must be false.`);
  }
}

function requireRecord(errors, value, fieldName) {
  if (!isRecord(value)) errors.push(`${fieldName} must be an object.`);
}

function requireArray(errors, value, fieldName) {
  if (!Array.isArray(value)) errors.push(`${fieldName} must be an array.`);
}

function requireString(errors, value, fieldName) {
  if (typeof value !== "string" || !value.trim()) errors.push(`${fieldName} must be a non-empty string.`);
}

function requireEqual(errors, value, expected, fieldName) {
  if (value !== expected) errors.push(`${fieldName} must be ${expected}.`);
}

function requireEnum(errors, value, allowed, fieldName) {
  if (!allowed.includes(value)) errors.push(`${fieldName} must be one of: ${allowed.join(", ")}.`);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
