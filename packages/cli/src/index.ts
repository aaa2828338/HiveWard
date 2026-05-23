#!/usr/bin/env node
import { createServer } from "node:net";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isNewerVersion } from "./version.js";

interface CliPackageJson {
  name: string;
  version: string;
  engines?: {
    node?: string;
    npm?: string;
  };
}

interface ParsedArgs {
  command: string;
  options: Record<string, string | boolean>;
}

interface DoctorCheck {
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

const productName = "Hiveward";
const commandName = "hiveward";
const defaultRepositoryUrl = "https://github.com/Chaunyzhang/HiveWard.git";
const defaultRegistryUrl = "https://registry.npmjs.org";
const defaultInstallRef = "main";
const cliPackage = readCliPackageJson();

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  switch (parsed.command) {
    case "setup":
      await setupCommand(parsed.options);
      return;
    case "start":
      startCommand(parsed.options);
      return;
    case "doctor":
      await doctorCommand(parsed.options);
      return;
    case "update":
      await updateCommand(parsed.options);
      return;
    case "version":
    case "--version":
    case "-v":
      console.log(`${commandName} ${cliPackage.version}`);
      return;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      throw new Error(`Unknown command "${parsed.command}". Run "${commandName} help" for usage.`);
  }
}

async function setupCommand(options: Record<string, string | boolean>): Promise<void> {
  const installDir = resolveHivewardAppDir(options);
  const packageJsonPath = join(installDir, "package.json");

  console.log(`${productName} setup`);
  console.log(`Install directory: ${installDir}`);

  if (!existsSync(packageJsonPath)) {
    const repositoryUrl = readStringOption(options, "from") ?? process.env.HIVEWARD_REPOSITORY_URL ?? defaultRepositoryUrl;
    const ref = readStringOption(options, "ref") ?? process.env.HIVEWARD_INSTALL_REF ?? defaultInstallRef;
    mkdirSync(dirname(installDir), { recursive: true });
    console.log(`Cloning ${repositoryUrl} (${ref})...`);
    runChecked("git", ["clone", "--depth", "1", "--branch", ref, repositoryUrl, installDir]);
  } else {
    console.log("Existing Hiveward checkout detected.");
  }

  if (!options["skip-install"]) {
    console.log("Installing npm dependencies...");
    runChecked("npm", ["install"], { cwd: installDir });
  }

  console.log("Checking local toolchain...");
  runChecked("npm", ["run", "check:env"], { cwd: installDir });
  console.log(`Setup complete. Start Hiveward with "${commandName} start".`);
}

function startCommand(options: Record<string, string | boolean>): void {
  const installDir = resolveHivewardAppDir(options);
  assertHivewardCheckout(installDir);

  console.log(`${productName} starting from ${installDir}`);
  console.log("Local URL: http://localhost:5173");
  spawnLongRunning("npm", ["run", "dev"], installDir);
}

async function doctorCommand(options: Record<string, string | boolean>): Promise<void> {
  const installDir = resolveHivewardAppDir(options);
  const npmVersion = readCommandOutput("npm", ["-v"]);
  const checks: DoctorCheck[] = [
    {
      label: "Node.js",
      status: isSupportedNode(process.versions.node) ? "pass" : "fail",
      detail: `${process.version} required ${cliPackage.engines?.node ?? "^20.19.0 || >=22.12.0"}`
    },
    {
      label: "npm",
      status: npmVersion && isSupportedNpm(npmVersion) ? "pass" : "fail",
      detail: npmVersion ? `${npmVersion} required ${cliPackage.engines?.npm ?? ">=11.0.0 <12"}` : "npm was not found"
    },
    {
      label: "Install directory",
      status: existsSync(join(installDir, "package.json")) ? "pass" : "fail",
      detail: installDir
    },
    {
      label: "Dependencies",
      status: existsSync(join(installDir, "node_modules")) ? "pass" : "warn",
      detail: existsSync(join(installDir, "node_modules")) ? "node_modules exists" : `run "${commandName} setup"`
    },
    {
      label: "Environment template",
      status: existsSync(join(installDir, ".env.example")) ? "pass" : "warn",
      detail: existsSync(join(installDir, ".env.example")) ? ".env.example exists" : "environment template was not found"
    }
  ];

  const port5173Available = await isPortAvailable(5173);
  checks.push({
    label: "Port 5173",
    status: port5173Available ? "pass" : "warn",
    detail: port5173Available ? "available" : "already in use; Hiveward may already be running"
  });

  printDoctorChecks(checks);

  if (checks.some((check) => check.status === "fail")) {
    process.exitCode = 1;
  }
}

async function updateCommand(options: Record<string, string | boolean>): Promise<void> {
  const tag = readStringOption(options, "tag") ?? process.env.HIVEWARD_UPDATE_TAG ?? "latest";
  const registry = normalizeRegistryUrl(readStringOption(options, "registry") ?? process.env.HIVEWARD_UPDATE_REGISTRY ?? defaultRegistryUrl);
  const packageName = cliPackage.name;

  console.log(`${productName} update check`);
  console.log(`Installed CLI: ${packageName}@${cliPackage.version}`);
  console.log(`Registry: ${registry}`);
  console.log(`Channel: ${tag}`);
  console.log("Rule: update only when the registry channel points to a semver-newer CLI version.");

  const latest = await fetchNpmPackageVersion(packageName, tag, registry);
  if (!latest) {
    console.log("No published CLI version was found on this registry channel yet.");
    return;
  }

  console.log(`Registry CLI: ${packageName}@${latest}`);

  if (!isNewerVersion(latest, cliPackage.version)) {
    console.log("Hiveward CLI is up to date.");
    return;
  }

  const updateTarget = `${packageName}@${tag}`;
  console.log(`Update available. Recommended command: npm install -g ${updateTarget}`);

  if (options.apply) {
    console.log("Applying update...");
    runChecked("npm", ["install", "-g", updateTarget]);
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [first, ...rest] = argv;
  const command = first && !first.startsWith("--") ? first : first ? first : "help";
  const optionArgs = first && !first.startsWith("--") ? rest : argv.slice(1);
  const options: Record<string, string | boolean> = {};

  for (let index = 0; index < optionArgs.length; index += 1) {
    const arg = optionArgs[index];
    if (!arg?.startsWith("--")) continue;

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (!rawKey) continue;
    if (inlineValue !== undefined) {
      options[rawKey] = inlineValue;
      continue;
    }

    const next = optionArgs[index + 1];
    if (next && !next.startsWith("--")) {
      options[rawKey] = next;
      index += 1;
    } else {
      options[rawKey] = true;
    }
  }

  return { command, options };
}

function printHelp(): void {
  console.log(`Hiveward CLI ${cliPackage.version}

Usage:
  hiveward setup [--install-dir <path>] [--from <git-url>] [--ref <git-ref>] [--skip-install]
  hiveward start [--install-dir <path>]
  hiveward doctor [--install-dir <path>]
  hiveward update [--registry <url>] [--tag <npm-dist-tag>] [--apply]
  hiveward --version

Default install directory:
  ${defaultAppDir()}
`);
}

function printDoctorChecks(checks: DoctorCheck[]): void {
  console.log(`${productName} doctor`);
  for (const check of checks) {
    const marker = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
    console.log(`[${marker}] ${check.label}: ${check.detail}`);
  }
}

function resolveHivewardAppDir(options: Record<string, string | boolean>): string {
  const explicit = readStringOption(options, "install-dir") ?? process.env.HIVEWARD_INSTALL_DIR;
  if (explicit) return resolve(explicit);

  const localRoot = findHivewardRoot(process.cwd());
  return localRoot ?? defaultAppDir();
}

function findHivewardRoot(startDir: string): string | undefined {
  let current = resolve(startDir);

  while (true) {
    const packageJsonPath = join(current, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string; workspaces?: unknown };
        if (parsed.name === "hiveward" && Array.isArray(parsed.workspaces)) return current;
      } catch {
        return undefined;
      }
    }

    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function defaultAppDir(): string {
  const baseDir =
    process.platform === "win32"
      ? process.env.LOCALAPPDATA
        ? join(process.env.LOCALAPPDATA, "Hiveward")
        : join(homedir(), "AppData", "Local", "Hiveward")
      : join(homedir(), ".hiveward");
  return join(baseDir, "app");
}

function assertHivewardCheckout(installDir: string): void {
  const packageJsonPath = join(installDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    throw new Error(`Hiveward is not set up at ${installDir}. Run "${commandName} setup" first.`);
  }
}

function readCliPackageJson(): CliPackageJson {
  const packageJsonUrl = new URL("../package.json", import.meta.url);
  return JSON.parse(readFileSync(packageJsonUrl, "utf8")) as CliPackageJson;
}

function readStringOption(options: Record<string, string | boolean>, name: string): string | undefined {
  const value = options[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function runChecked(command: string, args: string[], options: { cwd?: string } = {}): void {
  const result = runCommand(command, args, { ...options, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

function readCommandOutput(command: string, args: string[]): string | undefined {
  const result = runCommand(command, args, { stdio: "pipe" });
  if (result.status !== 0 || !result.stdout) return undefined;
  return result.stdout.toString().trim();
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; stdio: "inherit" | "pipe" }
): ReturnType<typeof spawnSync> {
  if (process.platform === "win32") {
    return spawnSync("cmd.exe", ["/d", "/s", "/c", shellCommand(command, args)], {
      cwd: options.cwd,
      encoding: options.stdio === "pipe" ? "utf8" : undefined,
      stdio: options.stdio
    });
  }

  return spawnSync(command, args, {
    cwd: options.cwd,
    encoding: options.stdio === "pipe" ? "utf8" : undefined,
    stdio: options.stdio
  });
}

function spawnLongRunning(command: string, args: string[], cwd: string): void {
  const child =
    process.platform === "win32"
      ? spawn("cmd.exe", ["/d", "/s", "/c", shellCommand(command, args)], { cwd, stdio: "inherit" })
      : spawn(command, args, { cwd, stdio: "inherit" });

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
}

function shellCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

function isSupportedNode(rawVersion: string): boolean {
  const version = parseVersion(rawVersion);
  if (!version) return false;
  if (version.major === 20) return compareVersion(version, { major: 20, minor: 19, patch: 0 }) >= 0;
  if (version.major === 21) return false;
  if (version.major === 22) return compareVersion(version, { major: 22, minor: 12, patch: 0 }) >= 0;
  return version.major > 22;
}

function isSupportedNpm(rawVersion: string): boolean {
  const version = parseVersion(rawVersion);
  return Boolean(version && version.major === 11);
}

function parseVersion(rawVersion: string): { major: number; minor: number; patch: number } | undefined {
  const match = rawVersion.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function compareVersion(
  left: { major: number; minor: number; patch: number },
  right: { major: number; minor: number; patch: number }
): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  return 0;
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.once("error", () => resolvePort(false));
    server.once("listening", () => {
      server.close(() => resolvePort(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function fetchNpmPackageVersion(packageName: string, tag: string, registryUrl: string): Promise<string | undefined> {
  const url = `${registryUrl}/${encodeNpmPackageName(packageName)}/${encodeURIComponent(tag)}`;
  const response = await fetch(url, {
    headers: {
      accept: "application/json"
    }
  });

  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`npm registry returned ${response.status} for ${url}.`);
  }

  const manifest = (await response.json()) as { version?: unknown };
  return typeof manifest.version === "string" ? manifest.version : undefined;
}

function encodeNpmPackageName(packageName: string): string {
  return packageName.startsWith("@") ? packageName.replace("/", "%2f") : encodeURIComponent(packageName);
}

function normalizeRegistryUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Hiveward CLI error: ${message}`);
  process.exit(1);
});
