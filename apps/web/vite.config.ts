import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

type DevApiApp = (req: unknown, res: unknown, next: (error?: unknown) => void) => void;
type ApiAppModule = {
  createHivewardApiApp: () => Promise<DevApiApp>;
};

export default defineConfig({
  plugins: [
    react(),
    {
      name: "hiveward-single-port-api",
      configureServer: async (server) => {
        const { createHivewardApiApp } = await server.ssrLoadModule("../api/src/app.ts") as ApiAppModule;
        const apiApp = await createHivewardApiApp();
        server.middlewares.use((req, res, next) => {
          const url = req.url ?? "";
          if (url.startsWith("/api/") || url === "/healthz" || url === "/readyz") {
            apiApp(req, res, next);
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
