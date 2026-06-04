import { nanoid } from "nanoid";
import type {
  HumanActionRequest,
  HumanActionRequestResponseIntent,
  HumanActionRequestSourceContextType,
  HumanActionResponse
} from "@hiveward/shared";
import type { HivewardStore } from "../store/hivewardStore";

export type HumanActionRequestProducer = "manager" | "ceo" | "leader" | "worker" | "inbox" | "ui";

export interface CreateHumanActionRequestInput {
  producer: HumanActionRequestProducer;
  sourceContextType: HumanActionRequestSourceContextType;
  sourceContextId: string;
  responseIntent: HumanActionRequestResponseIntent;
  title: string;
  bodyMarkdown: string;
  runRoomId?: string;
  createdByRoleId?: string;
  metadata?: Record<string, unknown>;
}

export interface AppendHumanActionResponseInput {
  requestId: string;
  messageMarkdown: string;
  createdByRoleId?: string;
  metadata?: Record<string, unknown>;
}

export class HumanActionRequestService {
  constructor(private readonly store: HivewardStore) {}

  async createRequest(input: CreateHumanActionRequestInput): Promise<HumanActionRequest> {
    this.assertProducerCanCreate(input.producer, input.sourceContextType);
    const now = new Date().toISOString();
    const request: HumanActionRequest = {
      id: `human-action-request-${nanoid(10)}`,
      sourceContextType: input.sourceContextType,
      sourceContextId: requireText(input.sourceContextId, "HumanActionRequest.sourceContextId"),
      responseIntent: input.responseIntent,
      status: "pending",
      title: requireText(input.title, "HumanActionRequest.title"),
      bodyMarkdown: requireText(input.bodyMarkdown, "HumanActionRequest.bodyMarkdown"),
      createdAt: now,
      updatedAt: now,
      ...(input.runRoomId ? { runRoomId: input.runRoomId } : {}),
      ...(input.createdByRoleId ? { createdByRoleId: input.createdByRoleId } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {})
    };
    return this.store.appendHumanActionRequest(request);
  }

  async appendResponse(input: AppendHumanActionResponseInput): Promise<HumanActionResponse> {
    const request = await this.store.getHumanActionRequest(input.requestId);
    if (!request) throw new Error(`HumanActionRequest not found: ${input.requestId}`);
    if (request.status !== "pending") {
      throw new Error(`HumanActionRequest is not pending: ${input.requestId}`);
    }
    const response: HumanActionResponse = {
      id: `human-action-response-${nanoid(10)}`,
      requestId: request.id,
      messageMarkdown: requireText(input.messageMarkdown, "HumanActionResponse.messageMarkdown"),
      createdAt: new Date().toISOString(),
      ...(input.createdByRoleId ? { createdByRoleId: input.createdByRoleId } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {})
    };
    const appended = await this.store.appendHumanActionResponse(response);
    if (request.responseIntent === "reply_required" || request.responseIntent === "review_required") {
      await this.store.updateHumanActionRequest({
        id: request.id,
        status: "responded",
        updatedAt: appended.createdAt
      });
    }
    return appended;
  }

  private assertProducerCanCreate(
    producer: HumanActionRequestProducer,
    sourceContextType: HumanActionRequestSourceContextType
  ): void {
    if (producer === "manager") {
      if (sourceContextType !== "run_room") {
        throw new Error("Manager can only create run_room HumanActionRequest facts.");
      }
      return;
    }
    if (producer === "ceo" || producer === "leader") {
      if (sourceContextType !== "executive_chat" && sourceContextType !== "blueprint_governance") {
        throw new Error("CEO and Leader can only create executive_chat or blueprint_governance HumanActionRequest facts.");
      }
      return;
    }
    throw new Error(`${producer} cannot create HumanActionRequest facts.`);
  }
}

function requireText(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${fieldName} is required.`);
  return trimmed;
}
