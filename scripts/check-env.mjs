import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const packageJson = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));

const nodeVersion = parseVersion(process.versions.node);
const npmVersion = parseVersion(readNpmVersion());
const failures = [];

if (!isSupportedNode(nodeVersion)) {
  failures.push(`Node ${formatVersion(nodeVersion)} does not satisfy ${packageJson.engines.node}.`);
}

if (!isSupportedNpm(npmVersion)) {
  failures.push(`npm ${formatVersion(npmVersion)} does not satisfy ${packageJson.engines.npm}.`);
}

if (failures.length > 0) {
  console.error("Hiveward environment check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error("Use Node 24.13.1 from .nvmrc with npm 11.x for the known-good local setup.");
  process.exit(1);
}

console.log(`Hiveward environment ok: Node ${formatVersion(nodeVersion)}, npm ${formatVersion(npmVersion)}.`);

function readNpmVersion() {
  const userAgentVersion = process.env.npm_config_user_agent?.match(/\bnpm\/([^\s]+)/)?.[1];
  if (userAgentVersion) return userAgentVersion;

  if (process.env.npm_execpath) {
    return execFileSync(process.execPath, [process.env.npm_execpath, "-v"], { encoding: "utf8" }).trim();
  }

  if (process.platform === "win32") {
    return execFileSync("cmd.exe", ["/d", "/s", "/c", "npm -v"], { encoding: "utf8" }).trim();
  }

  return execFileSync("npm", ["-v"], { encoding: "utf8" }).trim();
}

function parseVersion(raw) {
  const match = raw.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return { major: 0, minor: 0, patch: 0, raw };
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw
  };
}

function isSupportedNode(version) {
  if (version.major === 20) return compareVersion(version, { major: 20, minor: 19, patch: 0 }) >= 0;
  if (version.major === 21) return false;
  if (version.major === 22) return compareVersion(version, { major: 22, minor: 12, patch: 0 }) >= 0;
  return version.major > 22;
}

function isSupportedNpm(version) {
  return version.major === 11;
}

function compareVersion(left, right) {
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  return 0;
}

function formatVersion(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}
