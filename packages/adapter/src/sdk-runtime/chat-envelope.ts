import type { ChatAttachment, ChatThinkingEffort } from "@hiveward/shared";
import type { ModelReasoningEffort } from "@openai/codex-sdk";
import type { Options } from "@anthropic-ai/claude-agent-sdk";

export function buildSdkChatPrompt(message: string, attachments: ChatAttachment[]): string {
  const trimmedMessage = message.trim();
  const attachmentBlock = buildAttachmentBlock(attachments);
  return [trimmedMessage, attachmentBlock].filter(Boolean).join("\n\n");
}

export function mapCodexReasoningEffort(thinking: ChatThinkingEffort | undefined): ModelReasoningEffort | undefined {
  if (thinking === "minimal") return "low";
  if (thinking === "low" || thinking === "medium" || thinking === "high" || thinking === "xhigh") {
    return thinking;
  }
  if (thinking === "max") return "xhigh";
  return undefined;
}

export function mapClaudeEffort(thinking: ChatThinkingEffort | undefined): Options["effort"] | undefined {
  if (thinking === "low" || thinking === "medium" || thinking === "high" || thinking === "xhigh" || thinking === "max") {
    return thinking;
  }
  if (thinking === "minimal") return "low";
  return undefined;
}

export function mapClaudeThinking(thinking: ChatThinkingEffort | undefined): Options["thinking"] | undefined {
  if (thinking === "off") return { type: "disabled" };
  if (thinking === "adaptive") return { type: "adaptive" };
  return undefined;
}

function buildAttachmentBlock(attachments: ChatAttachment[]): string | undefined {
  if (!attachments.length) return undefined;
  return [
    "Attachments:",
    ...attachments.map((attachment, index) => formatAttachment(index + 1, attachment))
  ].join("\n");
}

function formatAttachment(index: number, attachment: ChatAttachment): string {
  const lines = [
    `Attachment ${index}: ${attachment.name}`,
    `- mediaType: ${attachment.mediaType}`,
    `- size: ${attachment.size}`
  ];
  if (attachment.truncated) {
    lines.push("- note: text was truncated before sending to the harness");
  }
  if (attachment.text) {
    lines.push("", "```text", attachment.text, "```");
  }
  return lines.join("\n");
}
