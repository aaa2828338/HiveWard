import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type SqliteProcessLockInfo = {
  pid: number;
  sqlitePath: string;
  startedAt: string;
  command: string;
};

export type SqliteProcessLock = SqliteProcessLockInfo & {
  lockPath: string;
  release(): Promise<void>;
  releaseSync(): void;
};

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const defaultSqlitePath = "data/hiveward.sqlite";

export function resolveHivewardSqlitePathFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.HIVEWARD_SQLITE_PATH?.trim() || defaultSqlitePath;
  return isAbsolute(configured) ? configured : resolve(repositoryRoot, configured);
}

export function sqliteApiLockPath(sqlitePath: string): string {
  return join(dirname(resolve(sqlitePath)), ".hiveward-api.lock");
}

export function sqliteMaintenanceLockPath(sqlitePath: string): string {
  return join(dirname(resolve(sqlitePath)), ".hiveward-sqlite-maintenance.lock");
}

export async function acquireHivewardApiProcessLock(input: {
  sqlitePath?: string;
  command?: string;
  pid?: number;
} = {}): Promise<SqliteProcessLock> {
  const sqlitePath = resolve(input.sqlitePath ?? resolveHivewardSqlitePathFromEnv());
  return acquirePidLock({
    lockPath: sqliteApiLockPath(sqlitePath),
    sqlitePath,
    command: input.command ?? process.argv.join(" "),
    pid: input.pid ?? process.pid,
    label: "HiveWard API"
  });
}

export async function acquireSqliteMaintenanceLock(input: {
  sqlitePath: string;
  command?: string;
  pid?: number;
}): Promise<SqliteProcessLock> {
  const sqlitePath = resolve(input.sqlitePath);
  await assertNoLiveHivewardApiProcessLock(sqlitePath);
  return acquirePidLock({
    lockPath: sqliteMaintenanceLockPath(sqlitePath),
    sqlitePath,
    command: input.command ?? process.argv.join(" "),
    pid: input.pid ?? process.pid,
    label: "SQLite maintenance"
  });
}

export async function assertNoLiveHivewardApiProcessLock(sqlitePath: string): Promise<void> {
  const lockPath = sqliteApiLockPath(sqlitePath);
  const existing = await readLockFile(lockPath);
  if (!existing) return;
  if (!isProcessAlive(existing.pid)) {
    await rm(lockPath, { force: true });
    return;
  }
  throw sqliteProcessLockError("HiveWard API", lockPath, sqlitePath, existing);
}

async function acquirePidLock(input: {
  lockPath: string;
  sqlitePath: string;
  command: string;
  pid: number;
  label: string;
}): Promise<SqliteProcessLock> {
  await mkdir(dirname(input.lockPath), { recursive: true });
  const info: SqliteProcessLockInfo = {
    pid: input.pid,
    sqlitePath: resolve(input.sqlitePath),
    startedAt: new Date().toISOString(),
    command: input.command
  };

  while (true) {
    try {
      await writeFile(input.lockPath, `${JSON.stringify(info, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      return {
        ...info,
        lockPath: input.lockPath,
        release: async () => {
          await releaseLock(input.lockPath, info.pid);
        },
        releaseSync: () => {
          releaseLockSync(input.lockPath, info.pid);
        }
      };
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const existing = await readLockFile(input.lockPath);
      if (existing && !isProcessAlive(existing.pid)) {
        await rm(input.lockPath, { force: true });
        continue;
      }
      throw sqliteProcessLockError(input.label, input.lockPath, input.sqlitePath, existing);
    }
  }
}

async function readLockFile(lockPath: string): Promise<SqliteProcessLockInfo | undefined> {
  try {
    return parseLockFile(await readFile(lockPath, "utf8"));
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

function parseLockFile(raw: string): SqliteProcessLockInfo | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<SqliteProcessLockInfo>;
    if (typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return undefined;
    if (typeof parsed.sqlitePath !== "string" || !parsed.sqlitePath.trim()) return undefined;
    return {
      pid: parsed.pid,
      sqlitePath: parsed.sqlitePath,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
      command: typeof parsed.command === "string" ? parsed.command : ""
    };
  } catch {
    return undefined;
  }
}

function sqliteProcessLockError(
  label: string,
  lockPath: string,
  sqlitePath: string,
  existing: SqliteProcessLockInfo | undefined
): Error {
  const existingPid = existing?.pid ? String(existing.pid) : "unknown";
  const existingSqlitePath = existing?.sqlitePath || sqlitePath;
  return new Error([
    `${label} is already running for SQLite database: ${existingSqlitePath}`,
    `Existing pid: ${existingPid}`,
    `Lock file: ${lockPath}`,
    "Only one HiveWard API process may use the same SQLite database at a time.",
    "Run: npm run doctor:sqlite-lock",
    "Stop the duplicate dev server, then start HiveWard again."
  ].join("\n"));
}

async function releaseLock(lockPath: string, pid: number): Promise<void> {
  const existing = await readLockFile(lockPath);
  if (!existing || existing.pid === pid) {
    await rm(lockPath, { force: true });
  }
}

function releaseLockSync(lockPath: string, pid: number): void {
  if (!existsSync(lockPath)) return;
  try {
    const existing = parseLockFile(readFileSyncUtf8(lockPath));
    if (!existing || existing.pid === pid) {
      rmSync(lockPath, { force: true });
    }
  } catch {
    // Process shutdown should not be blocked by lock cleanup.
  }
}

function readFileSyncUtf8(path: string): string {
  return Buffer.from(readFileSync(path)).toString("utf8");
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      return error.code === "EPERM";
    }
    return false;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
