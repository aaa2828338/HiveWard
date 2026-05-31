import { createHivewardApiApp } from "./app";
import { acquireHivewardApiProcessLock, resolveHivewardSqlitePathFromEnv } from "./store/sqlite/sqliteProcessLock";

const port = Number(process.env.PORT ?? 8787);
const sqlitePath = resolveHivewardSqlitePathFromEnv();
const apiLock = await acquireHivewardApiProcessLock({
  sqlitePath,
  command: process.env.npm_lifecycle_event
    ? `npm run ${process.env.npm_lifecycle_event} -w @hiveward/api`
    : process.argv.join(" ")
});

try {
  const app = await createHivewardApiApp();
  const server = app.listen(port, () => {
    console.log(`Hiveward API listening on http://localhost:${port}`);
  });
  server.on("close", () => {
    void apiLock.release();
  });
  process.on("exit", () => {
    apiLock.releaseSync();
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
} catch (error) {
  await apiLock.release();
  throw error;
}
