import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { createOpenClawAdapter } from "@openclaw-cui/adapter";
import { createApiRouter } from "./routes/apiRouter";
import { FileCuiStore } from "./store/fileCuiStore";
import { OpenClawConfigStore } from "./store/openClawConfigStore";
import { WorkflowWorker } from "./worker/workflowWorker";

export async function createCuiApiApp(): Promise<ReturnType<typeof express>> {
  const store = new FileCuiStore();
  await store.init();

  const openClawConfigStore = new OpenClawConfigStore();
  const adapter = createOpenClawAdapter({ sdkWorkspaceRoot: projectRoot() });
  const worker = new WorkflowWorker(store, adapter);

  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: "2mb" }));
  app.use(createApiRouter({ store, openClawConfigStore, adapter, worker }));
  app.use(errorHandler);
  return app;
}

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
