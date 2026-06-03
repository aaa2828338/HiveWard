type ChatStatus = "sent" | "streaming" | "failed";

interface ChatStateMessage {
  id?: string;
  role: string;
  status?: ChatStatus;
  runtimeStatus?: ChatRuntimeStatusView;
}

export interface ChatRuntimeStatusView {
  phase: "thinking" | "tool" | "command";
  label: string;
}

interface AgentOutputRuntimeState {
  runtimeState?: Record<string, unknown>;
}

export function shouldRefreshStreamingChatMessages({
  localMessages,
  serverMessages
}: {
  localMessages: ChatStateMessage[];
  serverMessages: ChatStateMessage[];
}): boolean {
  const localLast = localMessages.at(-1);
  if (!localLast || localLast.role !== "assistant" || localLast.status !== "streaming") return false;

  const serverLast = serverMessages.at(-1);
  if (!serverLast || serverLast.role !== "assistant") return false;
  if (serverLast.status === "streaming") return false;

  return serverMessages.length >= localMessages.length;
}

export function toChatRuntimeStatus(event: AgentOutputRuntimeState): ChatRuntimeStatusView | undefined {
  const phase = event.runtimeState?.phase;
  const label = event.runtimeState?.label;
  if ((phase !== "thinking" && phase !== "tool" && phase !== "command") || typeof label !== "string") {
    return undefined;
  }
  return {
    phase,
    label
  };
}

export function shouldShowRuntimeStatus(message: ChatStateMessage): boolean {
  return message.role === "assistant" && message.status === "streaming" && Boolean(message.runtimeStatus);
}
