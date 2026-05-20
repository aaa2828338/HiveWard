import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

type DevApiApp = (req: unknown, res: unknown, next: (error?: unknown) => void) => void;
type ApiAppModule = {
  createHivewardApiApp: () => Promise<DevApiApp>;
};

function apiSourceChanged(filePath: string): boolean {
  const normalizedPath = filePath.replaceAll("\\", "/");
  return (
    normalizedPath.includes("/apps/api/src/") ||
    normalizedPath.includes("/packages/shared/src/") ||
    normalizedPath.includes("/packages/adapter/src/")
  );
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "hiveward-single-port-api",
      configureServer: async (server) => {
        let apiAppPromise: Promise<DevApiApp> | undefined;

        const loadApiApp = async () => {
          if (!apiAppPromise) {
            apiAppPromise = server.ssrLoadModule("../api/src/app.ts")
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
    port: 5173
  }
});
