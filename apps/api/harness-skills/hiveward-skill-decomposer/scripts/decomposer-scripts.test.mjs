import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const skillRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(skillRoot, "../../../..");
const fixturesRoot = join(repoRoot, "fixtures", "skill-packages");
const inspectScript = join(skillRoot, "scripts", "inspect-skill-package.mjs");
const validateScript = join(skillRoot, "scripts", "validate-skill-ir.mjs");

function runJson(script, ...args) {
  return JSON.parse(execFileSync(process.execPath, [script, ...args], { encoding: "utf8" }));
}

test("inspect-skill-package classifies standalone markdown as markdown_only", () => {
  const result = runJson(inspectScript, join(fixturesRoot, "markdown-only-skill.md"));

  expect(result.sourceCompleteness).toBe("markdown_only");
  expect(result.hasSkillMd).toBe(false);
  expect(result.files.skillMd).toBe("markdown-only-skill.md");
  expect(result.files.references).toEqual([]);
  expect(result.files.scripts).toEqual([]);
  expect(result.scriptCandidates).toEqual([]);
});

test("inspect-skill-package treats direct SKILL.md input as partial package", () => {
  const result = runJson(inspectScript, join(fixturesRoot, "partial-skill-md-only", "SKILL.md"));

  expect(result.sourceCompleteness).toBe("partial_package");
  expect(result.hasSkillMd).toBe(true);
  expect(result.files.skillMd).toBe("SKILL.md");
  expect(result.unresolved.some((item) => item.item === "references/scripts/assets inventory")).toBe(true);
});

test("inspect-skill-package inventories full packages without executing scripts", () => {
  const markerPath = join(fixturesRoot, "script-backed-skill", "generated-marker.json");
  rmSync(markerPath, { force: true });

  const result = runJson(inspectScript, join(fixturesRoot, "script-backed-skill"));

  expect(result.sourceCompleteness).toBe("full_package");
  expect(result.hasSkillMd).toBe(true);
  expect(result.files.references).toEqual(["references/contract.md"]);
  expect(result.files.scripts).toEqual(["scripts/generate.mjs"]);
  expect(result.scriptCandidates[0].runtime).toBe("node");
  expect(result.scriptCandidates[0].shouldExecuteByDefault).toBe(false);
  expect(existsSync(markerPath)).toBe(false);
});

test("validate-skill-ir accepts valid IR and rejects scripts that execute by default", () => {
  const valid = {
    schema: "hiveward.skill-ir/v1",
    source: {
      kind: "markdown_text",
      label: "inline markdown",
      completeness: "markdown_only",
      sourceFiles: ["inline.md"]
    },
    identity: {
      name: "Markdown Only Skill",
      description: "Summarize supplied material.",
      triggers: ["summarize material"]
    },
    classification: {
      primaryType: "process",
      traits: ["multi_phase"],
      confidence: "high",
      reasoning: "The material defines ordered process steps."
    },
    packageInventory: {
      hasPackageRoot: false,
      hasSkillMd: false,
      references: [],
      scripts: [],
      assets: [],
      metadataFiles: []
    },
    operatingModel: {
      summary: "Summarize and validate material.",
      inputs: ["source material"],
      outputs: ["validated summary"],
      requiredTools: [],
      requiredPermissions: ["read_only"],
      sideEffects: []
    },
    phases: [
      {
        id: "inspect",
        label: "Inspect Material",
        purpose: "Identify supported points.",
        inputs: ["source material"],
        outputs: ["candidate points"],
        tools: [],
        permissions: ["read_only"],
        validation: ["Every point cites source material."],
        dependencies: [],
        difficulty: "simple",
        modelProfile: {
          modelClass: "standard",
          thinkingEffort: "low",
          reason: "Short extraction."
        },
        canRunInParallel: false
      }
    ],
    scripts: [],
    references: [],
    assets: [],
    risks: [],
    validation: [
      {
        id: "supported-points",
        description: "Every point is grounded in input.",
        appliesToPhaseIds: ["inspect"]
      }
    ],
    unresolved: []
  };

  const accepted = spawnSync(process.execPath, [validateScript], {
    input: JSON.stringify(valid),
    encoding: "utf8"
  });
  expect(accepted.status, accepted.stderr).toBe(0);

  const rejected = spawnSync(process.execPath, [validateScript], {
    input: JSON.stringify({
      ...valid,
      scripts: [
        {
          path: "scripts/generate.mjs",
          runtime: "node",
          purpose: "Generate output.",
          expectedInputs: [],
          expectedOutputs: [],
          sideEffects: ["writes files"],
          requiredPermissions: ["workspace_write"],
          shouldExecuteByDefault: true
        }
      ]
    }),
    encoding: "utf8"
  });

  expect(rejected.status).not.toBe(0);
  expect(rejected.stderr).toMatch(/shouldExecuteByDefault must be false/);
});
