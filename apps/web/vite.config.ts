import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

type DevApiApp = (req: unknown, res: unknown, next: (error?: unknown) => void) => void;
type ApiAppModule = {
  createHivewardApiApp: () => Promise<DevApiApp>;
};

const defaultHivewardPort = 10101;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function readHivewardPort(env: Record<string, string | undefined> = process.env): number {
  const rawPort = env.HIVEWARD_PORT?.trim();
  if (!rawPort) return defaultHivewardPort;

  const port = Number(rawPort);
  if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;

  throw new Error(`HIVEWARD_PORT must be an integer from 1 to 65535. Received: ${rawPort}`);
}

function apiSourceChanged(filePath: string): boolean {
  const normalizedPath = filePath.replaceAll("\\", "/");
  return (
    normalizedPath.includes("/apps/api/src/") ||
    normalizedPath.includes("/packages/shared/src/") ||
    normalizedPath.includes("/packages/adapter/src/")
  );
}

export default defineConfig(({ mode }) => {
  const env = loadRootEnv(mode);

  return {
    envDir: repositoryRoot,
    plugins: [
      react(),
      {
        name: "hiveward-single-port-api",
        configureServer: async (server) => {
          let apiAppPromise: Promise<DevApiApp> | undefined;

          const loadApiApp = async () => {
            if (!apiAppPromise) {
              apiAppPromise = server
                .ssrLoadModule("../api/src/app.ts")
                .then((mod) => (mod as ApiAppModule).createHivewardApiApp());
            }

            try {
              return await apiAppPromise;
            } catch (error) {
              apiAppPromise = undefined;
              throw error;
            }
          };

          server.watcher.on("change", (filePath) => {
            if (apiSourceChanged(filePath)) {
              apiAppPromise = undefined;
            }
          });

          server.middlewares.use(async (req, res, next) => {
            const url = req.url ?? "";
            if (url.startsWith("/api/") || url === "/healthz" || url === "/readyz") {
              try {
                const apiApp = await loadApiApp();
                apiApp(req, res, next);
              } catch (error) {
                next(error);
              }
              return;
            }
            next();
          });
        }
      }
    ],
    server: {
      port: readHivewardPort(env),
      strictPort: true
    }
  };
});

function loadRootEnv(mode: string): Record<string, string | undefined> {
  return {
    ...loadEnv(mode, repositoryRoot, ""),
    ...process.env
  };
}
