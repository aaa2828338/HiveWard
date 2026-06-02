import type { AgentTaskResult, RuntimeExecutionStatus, RuntimeUsageFact, StartAgentTaskInput, WaitForAgentTaskInput } from "@hiveward/shared";
import type { AgentSdkTaskRecord } from "./types";

export class AgentSdkTaskRegistry {
  private readonly records = new Map<string, AgentSdkTaskRecord>();
  private activeTasks = 0;
  private readonly queuedTasks: Array<() => void> = [];

  constructor(private readonly maxConcurrency: number) {}

  register(record: AgentSdkTaskRecord): void {
    this.records.set(record.taskId, record);
  }

  waitForTask(input: WaitForAgentTaskInput): Promise<AgentTaskResult> {
    const record = this.records.get(input.taskId);
    if (!record) {
      throw new Error(`SDK task not found: ${input.taskId}`);
    }

    return record.final.finally(() => {
      if (record.timeout) clearTimeout(record.timeout);
      this.records.delete(input.taskId);
    });
  }

  async cancelTask(input: WaitForAgentTaskInput): Promise<AgentTaskResult> {
    const record = this.records.get(input.taskId);
    if (!record) {
      throw new Error(`SDK task not found: ${input.taskId}`);
    }

    record.abortController.abort("cancelled");
    return this.waitForTask(input);
  }

  runWithConcurrency<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = () => {
        this.activeTasks += 1;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.activeTasks -= 1;
            this.queuedTasks.shift()?.();
          });
      };

      if (this.activeTasks < this.maxConcurrency) {
        run();
      } else {
        this.queuedTasks.push(run);
      }
    });
  }
}

export function createTerminalTaskResult({
  taskId,
  runId,
  sessionKey,
  nativeSessionId,
  resumeMode = "started",
  resumeRequested = false,
  resumeAttempted = false,
  resumeProven = false,
  providerSessionId,
  providerStartedNewSession = false,
  resumable = false,
  source,
  status,
  error,
  output,
  usage,
  updatedAt = new Date().toISOString()
}: {
  taskId: string;
  runId: string;
  sessionKey: string;
  nativeSessionId?: string;
  resumeMode?: AgentTaskResult["resumeMode"];
  resumeRequested?: boolean;
  resumeAttempted?: boolean;
  resumeProven?: boolean;
  providerSessionId?: string;
  providerStartedNewSession?: boolean;
  resumable?: boolean;
  source: AgentTaskResult["source"];
  status: RuntimeExecutionStatus;
  error?: string;
  output?: string;
  usage?: RuntimeUsageFact;
  updatedAt?: string;
}): AgentTaskResult {
  return {
    taskId,
    runId,
    sessionKey,
    nativeSessionId,
    resumeMode,
    resumeRequested,
    resumeAttempted,
    resumeProven,
    providerSessionId,
    providerStartedNewSession,
    resumable,
    source,
    status,
    error,
    output,
    usage,
    updatedAt
  };
}

export function buildRuntimeResumeProof(
  input: Pick<StartAgentTaskInput, "nativeSessionId">,
  providerSessionId: string | undefined,
  options: { resumeAttempted?: boolean; resumable?: boolean } = {}
): Pick<
  AgentTaskResult,
  "nativeSessionId" |
    "resumeMode" |
    "resumeRequested" |
    "resumeAttempted" |
    "resumeProven" |
    "providerSessionId" |
    "providerStartedNewSession" |
    "resumable"
> {
  const resumeRequested = Boolean(input.nativeSessionId);
  const resumeAttempted = resumeRequested && options.resumeAttempted === true;
  const providerStartedNewSession = Boolean(
    resumeRequested &&
    providerSessionId &&
    providerSessionId !== input.nativeSessionId
  );
  const resumeProven = Boolean(
    resumeRequested &&
    resumeAttempted &&
    providerSessionId &&
    providerSessionId === input.nativeSessionId
  );
  return {
    nativeSessionId: providerSessionId,
    resumeMode: resumeProven ? "resumed" : "started",
    resumeRequested,
    resumeAttempted,
    resumeProven,
    providerSessionId,
    providerStartedNewSession,
    resumable: options.resumable ?? Boolean(providerSessionId)
  };
}
