import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { createRuntimeAdapter } from "@hiveward/adapter";
import { createApiRouter } from "./routes/apiRouter";
import { FileHivewardStore } from "./store/fileHivewardStore";
import { OpenClawConfigStore } from "./store/openClawConfigStore";
import { BlueprintWorker } from "./worker/blueprintWorker";

export async function createHivewardApiApp(): Promise<ReturnType<typeof express>> {
  const store = new FileHivewardStore();
  await store.init();

  const openClawConfigStore = new OpenClawConfigStore();
  const adapter = createRuntimeAdapter({ sdkWorkspaceRoot: projectRoot() });
  const worker = new BlueprintWorker(store, adapter);

  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: "2mb" }));
  app.use(createApiRouter({ store, openClawConfigStore, adapter, worker }));
  app.use(apiNotFoundHandler);
  app.use(errorHandler);
  return app;
}

const apiNotFoundHandler: express.RequestHandler = (req, res, next) => {
  const url = req.url ?? "";
  if (!url.startsWith("/api/") && url !== "/healthz" && url !== "/readyz") {
    next();
    return;
  }
  res.status(404).json({
    error: {
      code: "not_found",
      message: "API route not found."
    }
  });
};

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const message = error instanceof Error ? error.message : "Unexpected API failure.";
  res.status(500).json({
    error: {
      code: "internal_error",
      message
    }
  });
};

function projectRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}
