import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { createOpenClawAdapter } from "@openclaw-cui/adapter";
import { createApiRouter } from "./routes/apiRouter";
import { FileCuiStore } from "./store/fileCuiStore";
import { WorkflowWorker } from "./worker/workflowWorker";

const port = Number(process.env.PORT ?? 8787);

const store = new FileCuiStore();
await store.init();

const adapter = createOpenClawAdapter();
const worker = new WorkflowWorker(store, adapter);

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));
app.use(createApiRouter({ store, adapter, worker }));

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const message = error instanceof Error ? error.message : "Unexpected API failure.";
  res.status(500).json({
    error: {
      code: "internal_error",
      message
    }
  });
};

app.use(errorHandler);

app.listen(port, () => {
  console.log(`CUI Companion API listening on http://localhost:${port}`);
});
