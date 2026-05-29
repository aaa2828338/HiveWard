import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tsxCli = join(root, "node_modules", "tsx", "dist", "cli.mjs");
const command = existsSync(tsxCli) ? process.execPath : "tsx";
const args = existsSync(tsxCli)
  ? [tsxCli, "apps/api/src/store/sqlite/migrateJsonToSqliteCli.ts", ...process.argv.slice(2)]
  : ["apps/api/src/store/sqlite/migrateJsonToSqliteCli.ts", ...process.argv.slice(2)];
const result = spawnSync(command, args, {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit"
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
