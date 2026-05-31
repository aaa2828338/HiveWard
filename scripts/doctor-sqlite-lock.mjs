import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sqlitePath = resolveSqlitePath();
const lockPath = join(dirname(sqlitePath), ".hiveward-api.lock");
const killApi = process.argv.includes("--kill-api");

const lock = readApiLock(lockPath);
const processes = await listProcesses();
const suspectedHiveward = processes.filter(isLikelyHivewardProcess);
const apiDevProcesses = suspectedHiveward.filter((item) => item.commandLine.includes("npm run dev -w @hiveward/api"));
const tsxWatchProcesses = suspectedHiveward.filter((item) => item.commandLine.includes("tsx watch src/server.ts"));
const lockPidAlive = lock?.pid ? isPidInList(processes, lock.pid) || isProcessAlive(lock.pid) : false;

if (killApi) {
  const killTargets = new Map();
  for (const processInfo of [...apiDevProcesses, ...tsxWatchProcesses]) {
    if (processInfo.pid !== process.pid) killTargets.set(processInfo.pid, processInfo);
  }
  for (const processInfo of killTargets.values()) {
    try {
      process.kill(processInfo.pid, "SIGTERM");
      processInfo.killStatus = "sent SIGTERM";
    } catch (error) {
      processInfo.killStatus = `failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

console.log(`SQLite path: ${sqlitePath}`);
console.log(`API lock file: ${lockPath}`);
console.log(`API lock exists: ${lock ? "yes" : "no"}`);
if (lock) {
  console.log(`API lock pid: ${lock.pid}`);
  console.log(`API lock pid alive: ${lockPidAlive ? "yes" : "no"}`);
  console.log(`API lock sqlitePath: ${lock.sqlitePath ?? "unknown"}`);
  console.log(`API lock command: ${lock.command ?? "unknown"}`);
  console.log(`API lock startedAt: ${lock.startedAt ?? "unknown"}`);
}

console.log("");
console.log(`Suspected HiveWard node processes: ${suspectedHiveward.length}`);
for (const processInfo of suspectedHiveward) {
  console.log(`- pid ${processInfo.pid} ${processInfo.name}: ${processInfo.commandLine}`);
  if (processInfo.killStatus) console.log(`  kill: ${processInfo.killStatus}`);
}

console.log("");
console.log(`npm run dev -w @hiveward/api processes: ${apiDevProcesses.length}`);
console.log(`tsx watch src/server.ts processes: ${tsxWatchProcesses.length}`);
console.log("Next steps:");
if (lock && !lockPidAlive) {
  console.log(`- The API lock is stale. Delete ${lockPath}, then retry startup.`);
} else if (lock || apiDevProcesses.length > 1 || tsxWatchProcesses.length > 1) {
  console.log("- Stop duplicate API dev servers, then retry startup.");
  console.log("- To stop suspected API processes explicitly: npm run doctor:sqlite-lock -- --kill-api");
} else {
  console.log("- No duplicate HiveWard API process was detected by this diagnostic.");
}

function resolveSqlitePath() {
  const configured = process.env.HIVEWARD_SQLITE_PATH?.trim() || "data/hiveward.sqlite";
  return isAbsolute(configured) ? configured : resolve(root, configured);
}

function readApiLock(path) {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return {
      pid: Number(parsed.pid),
      sqlitePath: typeof parsed.sqlitePath === "string" ? parsed.sqlitePath : undefined,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : undefined,
      command: typeof parsed.command === "string" ? parsed.command : undefined
    };
  } catch (error) {
    return {
      pid: NaN,
      sqlitePath: undefined,
      startedAt: undefined,
      command: `unreadable lock file: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

async function listProcesses() {
  if (process.platform === "win32") {
    return listWindowsProcesses();
  }
  return listPosixProcesses();
}

async function listWindowsProcesses() {
  const script = [
    "$OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "Get-CimInstance Win32_Process |",
    "Where-Object { $_.Name -match '^(node|node.exe|npm|npm.cmd|tsx)(.exe)?$' -or $_.CommandLine -match 'HiveWard|@hiveward/api|tsx watch src/server.ts' } |",
    "Select-Object ProcessId,Name,CommandLine |",
    "ConvertTo-Json -Depth 2"
  ].join(" ");
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024
    });
    if (!stdout.trim()) return [];
    const parsed = JSON.parse(stdout);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map((row) => ({
      pid: Number(row.ProcessId),
      name: String(row.Name ?? ""),
      commandLine: String(row.CommandLine ?? "")
    })).filter((row) => Number.isInteger(row.pid));
  } catch {
    return [];
  }
}

async function listPosixProcesses() {
  try {
    const { stdout } = await execFileAsync("ps", ["-eo", "pid=,comm=,args="], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024
    });
    return stdout.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = /^(\d+)\s+(\S+)\s+(.*)$/.exec(line);
        return match
          ? { pid: Number(match[1]), name: match[2], commandLine: match[3] }
          : undefined;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isLikelyHivewardProcess(processInfo) {
  const commandLine = processInfo.commandLine.toLowerCase();
  return commandLine.includes("@hiveward/api") ||
    commandLine.includes("tsx watch src/server.ts") ||
    commandLine.includes("apps/api/src/server.ts") ||
    commandLine.includes("hiveward");
}

function isPidInList(processes, pid) {
  return processes.some((processInfo) => processInfo.pid === pid);
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && typeof error === "object" && error.code === "EPERM";
  }
}
