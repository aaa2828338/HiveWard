#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const sourceArg = process.argv[2];

if (!sourceArg) {
  console.error("Usage: node scripts/inspect-skill-package.mjs <skill-package-root|SKILL.md|markdown-file>");
  process.exit(1);
}

try {
  const result = await inspectSkillPackage(sourceArg);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

export async function inspectSkillPackage(inputPath) {
  const resolvedInput = resolve(inputPath);
  const inputStat = await stat(resolvedInput);
  const inputIsDirectory = inputStat.isDirectory();
  const root = inputIsDirectory ? resolvedInput : dirname(resolvedInput);
  const inputName = basename(resolvedInput);
  const hasSkillMd = inputIsDirectory
    ? await isReadableFile(join(root, "SKILL.md"))
    : inputName.toLowerCase() === "skill.md";
  const markdownOnly = !inputIsDirectory && extname(inputName).toLowerCase() === ".md" && inputName.toLowerCase() !== "skill.md";
  const sourceCompleteness = inputIsDirectory && hasSkillMd
    ? "full_package"
    : markdownOnly
      ? "markdown_only"
      : hasSkillMd
        ? "partial_package"
        : "unknown";
  const files = {
    skillMd: hasSkillMd ? "SKILL.md" : markdownOnly ? inputName : undefined,
    references: inputIsDirectory ? await listFiles(root, "references") : [],
    scripts: inputIsDirectory ? await listFiles(root, "scripts") : [],
    assets: inputIsDirectory ? await listFiles(root, "assets") : [],
    metadata: inputIsDirectory ? await listFiles(root, "agents") : []
  };
  const scriptCandidates = await Promise.all(files.scripts.map(async (path) => {
    const absolutePath = join(root, path);
    const scriptStat = await stat(absolutePath);
    return {
      path,
      runtime: inferScriptRuntime(path),
      sizeBytes: scriptStat.size,
      sha256: await hashFile(absolutePath),
      shouldExecuteByDefault: false
    };
  }));
  const sourceFiles = [
    files.skillMd,
    ...files.references,
    ...files.scripts,
    ...files.assets,
    ...files.metadata
  ].filter(Boolean);
  const fileHashes = {};
  for (const file of sourceFiles) {
    const absolutePath = inputIsDirectory || file === "SKILL.md" ? join(root, file) : resolvedInput;
    fileHashes[file] = await hashFile(absolutePath);
  }

  return {
    schema: "hiveward.skill-package-inventory/v1",
    input: resolvedInput,
    root,
    sourceCompleteness,
    hasPackageRoot: inputIsDirectory,
    hasSkillMd,
    files,
    sourceFiles,
    fileHashes,
    scriptCandidates,
    unresolved: buildUnresolved(sourceCompleteness)
  };
}

async function listFiles(root, folderName) {
  const folder = join(root, folderName);
  if (!(await isReadableDirectory(folder))) return [];
  return (await walkFiles(folder))
    .map((file) => toPosixPath(relative(root, file)))
    .sort((left, right) => left.localeCompare(right));
}

async function walkFiles(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const childPath = join(folder, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(childPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(childPath);
    }
  }
  return files;
}

async function isReadableFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isReadableDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function hashFile(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function inferScriptRuntime(path) {
  const extension = extname(path).toLowerCase();
  if (extension === ".mjs" || extension === ".js" || extension === ".cjs" || extension === ".ts") return "node";
  if (extension === ".py") return "python";
  if (extension === ".sh" || extension === ".bash" || extension === ".zsh") return "bash";
  return "unknown";
}

function buildUnresolved(sourceCompleteness) {
  if (sourceCompleteness !== "partial_package") return [];
  return [{
    item: "references/scripts/assets inventory",
    reason: "only SKILL.md was supplied",
    requiredUserInput: "Provide the full skill package root if references, scripts, or assets should be included."
  }];
}

function toPosixPath(path) {
  return path.split("\\").join("/");
}
