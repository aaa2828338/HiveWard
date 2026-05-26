import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ApplyHivewardUpdateResponse, HivewardUpdateStatus } from "@hiveward/shared";

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export type UpdateCommandRunner = (
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number }
) => Promise<CommandResult>;

export interface HivewardUpdateOptions {
  repositoryRoot?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  runner?: UpdateCommandRunner;
  fetcher?: typeof fetch;
}

interface RootPackageJson {
  version?: string;
}

interface NpmManifest {
  version?: unknown;
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

class CommandFailure extends Error {
  constructor(
    message: string,
    readonly stdout = "",
    readonly stderr = ""
  ) {
    super(message);
  }
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const defaultRepositoryUrl = "https://github.com/Chaunyzhang/HiveWard";
const defaultGitRemote = "origin";
const defaultGitBranch = "main";
const defaultRegistryUrl = "https://registry.npmjs.org";
const defaultDistTag = "latest";
const cliPackageName = "@hiveward/cli";

export async function getHivewardUpdateStatus(options: HivewardUpdateOptions = {}): Promise<HivewardUpdateStatus> {
  const root = options.repositoryRoot ?? repositoryRoot;
  const env = options.env ?? process.env;
  const checkedAt = (options.now?.() ?? new Date()).toISOString();
  const currentVersion = await readCurrentVersion(root);
  const runner = options.runner ?? runCommand;
  const repositoryUrl = normalizeRepositoryUrl(env.HIVEWARD_REPOSITORY_URL ?? defaultRepositoryUrl);

  if (await isGitCheckout(root, runner)) {
    try {
      return await getGitUpdateStatus({ root, env, checkedAt, currentVersion, repositoryUrl, runner });
    } catch (error) {
      return baseStatus({
        source: "git",
        checkedAt,
        currentVersion,
        repositoryUrl,
        applyCommand: "git pull --ff-only",
        restartRequired: true,
        error: errorMessage(error)
      });
    }
  }

  try {
    return await getNpmUpdateStatus({
      env,
      checkedAt,
      currentVersion,
      repositoryUrl,
      fetcher: options.fetcher ?? fetch
    });
  } catch (error) {
    return baseStatus({
      source: "npm",
      checkedAt,
      currentVersion,
      repositoryUrl,
      registryUrl: normalizeRegistryUrl(env.HIVEWARD_UPDATE_REGISTRY ?? defaultRegistryUrl),
      distTag: env.HIVEWARD_UPDATE_TAG ?? defaultDistTag,
      applyCommand: `npm install -g ${cliPackageName}@${env.HIVEWARD_UPDATE_TAG ?? defaultDistTag}`,
      restartRequired: true,
      error: errorMessage(error)
    });
  }
}

export async function applyHivewardUpdate(options: HivewardUpdateOptions = {}): Promise<ApplyHivewardUpdateResponse> {
  const root = options.repositoryRoot ?? repositoryRoot;
  const runner = options.runner ?? runCommand;
  const update = await getHivewardUpdateStatus({ ...options, repositoryRoot: root, runner });

  if (!update.updateAvailable) {
    return { update, applied: false, output: "Hiveward is already up to date." };
  }

  if (!update.canApply) {
    return {
      update,
      applied: false,
      output: update.error ?? "Automatic update cannot be applied in the current checkout."
    };
  }

  if (update.source === "git") {
    const remote = defaultGitRemote;
    const branch = update.remoteBranch ?? defaultGitBranch;
    const pull = await runner("git", ["pull", "--ff-only", remote, branch], { cwd: root, timeoutMs: 120000 });
    const install = await runner("npm", ["install"], { cwd: root, timeoutMs: 300000 });
    const nextUpdate = await getHivewardUpdateStatus({ ...options, repositoryRoot: root, runner });
    return {
      update: nextUpdate,
      applied: true,
      output: [pull.stdout, pull.stderr, install.stdout, install.stderr].filter(Boolean).join("\n").trim()
    };
  }

  const target = `${cliPackageName}@${update.distTag ?? defaultDistTag}`;
  const result = await runner("npm", ["install", "-g", target], { cwd: root, timeoutMs: 300000 });
  return {
    update: { ...update, canApply: false, restartRequired: true },
    applied: true,
    output: [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
  };
}

async function getGitUpdateStatus({
  root,
  env,
  checkedAt,
  currentVersion,
  repositoryUrl,
  runner
}: {
  root: string;
  env: NodeJS.ProcessEnv;
  checkedAt: string;
  currentVersion: string;
  repositoryUrl: string;
  runner: UpdateCommandRunner;
}): Promise<HivewardUpdateStatus> {
  const remote = env.HIVEWARD_UPDATE_GIT_REMOTE ?? defaultGitRemote;
  const remoteUrl = await readOptionalCommand(runner, "git", ["remote", "get-url", remote], root);
  const remoteBranch = await resolveRemoteBranch(root, remote, env, runner);
  await runner("git", ["fetch", "--quiet", remote, remoteBranch], { cwd: root, timeoutMs: 120000 });

  const currentBranch = await readOptionalCommand(runner, "git", ["branch", "--show-current"], root);
  const currentCommit = await readRequiredCommand(runner, "git", ["rev-parse", "HEAD"], root);
  const remoteRef = `${remote}/${remoteBranch}`;
  const latestCommit = await readRequiredCommand(runner, "git", ["rev-parse", remoteRef], root);
  const { ahead, behind } = await readGitAheadBehind(root, remoteRef, runner);
  const dirty = Boolean(await readOptionalCommand(runner, "git", ["status", "--porcelain"], root));
  const updateAvailable = behind > 0 || (behind === 0 && ahead === 0 && currentCommit !== latestCommit);
  const canApply = updateAvailable && !dirty && currentBranch === remoteBranch;

  return {
    source: "git",
    currentVersion,
    currentCommit,
    latestCommit,
    currentBranch,
    remoteBranch,
    remoteUrl,
    repositoryUrl: normalizeRepositoryUrl(remoteUrl ?? repositoryUrl),
    checkedAt,
    updateAvailable,
    canApply,
    applyCommand: `git pull --ff-only ${remote} ${remoteBranch} && npm install`,
    restartRequired: true,
    error: updateAvailable && dirty ? "Working tree has local changes; commit or stash them before applying an automatic update." : undefined
  };
}

async function getNpmUpdateStatus({
  env,
  checkedAt,
  currentVersion,
  repositoryUrl,
  fetcher
}: {
  env: NodeJS.ProcessEnv;
  checkedAt: string;
  currentVersion: string;
  repositoryUrl: string;
  fetcher: typeof fetch;
}): Promise<HivewardUpdateStatus> {
  const registryUrl = normalizeRegistryUrl(env.HIVEWARD_UPDATE_REGISTRY ?? defaultRegistryUrl);
  const distTag = env.HIVEWARD_UPDATE_TAG ?? defaultDistTag;
  const latestVersion = await fetchNpmPackageVersion(cliPackageName, distTag, registryUrl, fetcher);
  const updateAvailable = Boolean(latestVersion && isNewerVersion(latestVersion, currentVersion));

  return {
    source: "npm",
    currentVersion,
    latestVersion,
    repositoryUrl,
    registryUrl,
    distTag,
    checkedAt,
    updateAvailable,
    canApply: updateAvailable,
    applyCommand: `npm install -g ${cliPackageName}@${distTag}`,
    restartRequired: true
  };
}

async function isGitCheckout(root: string, runner: UpdateCommandRunner): Promise<boolean> {
  try {
    await runner("git", ["rev-parse", "--show-toplevel"], { cwd: root, timeoutMs: 10000 });
    return true;
  } catch {
    return false;
  }
}

async function resolveRemoteBranch(
  root: string,
  remote: string,
  env: NodeJS.ProcessEnv,
  runner: UpdateCommandRunner
): Promise<string> {
  const configuredRef = env.HIVEWARD_UPDATE_GIT_BRANCH ?? env.HIVEWARD_INSTALL_REF;
  if (configuredRef && !configuredRef.includes("/") && !configuredRef.startsWith("v")) return configuredRef;

  const symbolicRef = await readOptionalCommand(runner, "git", ["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`], root);
  if (symbolicRef?.startsWith(`${remote}/`)) return symbolicRef.slice(remote.length + 1);

  const currentBranch = await readOptionalCommand(runner, "git", ["branch", "--show-current"], root);
  return currentBranch || defaultGitBranch;
}

async function readGitAheadBehind(
  root: string,
  remoteRef: string,
  runner: UpdateCommandRunner
): Promise<{ ahead: number; behind: number }> {
  try {
    const raw = await readRequiredCommand(runner, "git", ["rev-list", "--left-right", "--count", `HEAD...${remoteRef}`], root);
    const [aheadRaw, behindRaw] = raw.split(/\s+/);
    const ahead = Number(aheadRaw);
    const behind = Number(behindRaw);
    return {
      ahead: Number.isFinite(ahead) ? ahead : 0,
      behind: Number.isFinite(behind) ? behind : 0
    };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

async function readCurrentVersion(root: string): Promise<string> {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as RootPackageJson;
  return packageJson.version ?? "0.0.0";
}

async function readOptionalCommand(
  runner: UpdateCommandRunner,
  command: string,
  args: string[],
  cwd: string
): Promise<string | undefined> {
  try {
    return await readRequiredCommand(runner, command, args, cwd);
  } catch {
    return undefined;
  }
}

async function readRequiredCommand(
  runner: UpdateCommandRunner,
  command: string,
  args: string[],
  cwd: string
): Promise<string> {
  const result = await runner(command, args, { cwd, timeoutMs: 30000 });
  return result.stdout.trim();
}

async function fetchNpmPackageVersion(
  packageName: string,
  tag: string,
  registryUrl: string,
  fetcher: typeof fetch
): Promise<string | undefined> {
  const response = await fetcher(`${registryUrl}/${encodeNpmPackageName(packageName)}/${encodeURIComponent(tag)}`, {
    headers: { accept: "application/json" }
  });

  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`npm registry returned ${response.status}.`);

  const manifest = (await response.json()) as NpmManifest;
  return typeof manifest.version === "string" ? manifest.version : undefined;
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {}
): Promise<CommandResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    execFile(resolveExecutable(command), args, { cwd: options.cwd, timeout: options.timeoutMs ?? 30000 }, (error, stdout, stderr) => {
      const stdoutText = stdout?.toString() ?? "";
      const stderrText = stderr?.toString() ?? "";
      if (error) {
        rejectCommand(new CommandFailure(error.message, stdoutText, stderrText));
        return;
      }
      resolveCommand({ stdout: stdoutText, stderr: stderrText });
    });
  });
}

function resolveExecutable(command: string): string {
  return process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
}

function baseStatus(input: {
  source: HivewardUpdateStatus["source"];
  checkedAt: string;
  currentVersion: string;
  repositoryUrl: string;
  registryUrl?: string;
  distTag?: string;
  applyCommand: string;
  restartRequired: boolean;
  error?: string;
}): HivewardUpdateStatus {
  return {
    source: input.source,
    currentVersion: input.currentVersion,
    repositoryUrl: input.repositoryUrl,
    registryUrl: input.registryUrl,
    distTag: input.distTag,
    checkedAt: input.checkedAt,
    updateAvailable: false,
    canApply: false,
    applyCommand: input.applyCommand,
    restartRequired: input.restartRequired,
    error: input.error
  };
}

function encodeNpmPackageName(packageName: string): string {
  return packageName.startsWith("@") ? packageName.replace("/", "%2f") : encodeURIComponent(packageName);
}

function normalizeRegistryUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeRepositoryUrl(value: string): string {
  return value
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\/+$/, "");
}

function isNewerVersion(candidate: string, current: string): boolean {
  return compareSemver(candidate, current) > 0;
}

function compareSemver(leftRaw: string, rightRaw: string): number {
  const left = parseSemver(leftRaw);
  const right = parseSemver(rightRaw);
  if (!left || !right) return leftRaw.localeCompare(rightRaw);

  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }

  if (left.prerelease.length === 0 && right.prerelease.length > 0) return 1;
  if (left.prerelease.length > 0 && right.prerelease.length === 0) return -1;

  const count = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < count; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumber = Number(leftPart);
    const rightNumber = Number(rightPart);
    const leftNumeric = Number.isInteger(leftNumber);
    const rightNumeric = Number.isInteger(rightNumber);
    if (leftNumeric && rightNumeric) return leftNumber > rightNumber ? 1 : -1;
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftPart > rightPart ? 1 : -1;
  }

  return 0;
}

function parseSemver(value: string): ParsedSemver | undefined {
  const match = value.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : []
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof CommandFailure) {
    return [error.message, error.stderr.trim(), error.stdout.trim()].filter(Boolean).join(" ");
  }
  return error instanceof Error ? error.message : String(error);
}
