import { Bot, Brain, Loader2, Square, Wrench } from "lucide-react";
import type { ChatRuntimeActivity } from "@hiveward/shared";
import type { ModelOutputThreadMessage } from "../lib/model-output-thread";
import { MarkdownRenderer } from "./MarkdownRenderer";

export interface SharedMessageViewProps {
  message: ModelOutputThreadMessage;
  avatarLabel?: string;
  speakerLabel?: string;
  pendingLabel?: string;
  failedLabel?: string;
  runtimeActivityLabel?: string;
  formatRuntimeActivityTitle?: (activity: ChatRuntimeActivity) => string;
  formatRuntimeActivityTime?: (value: string) => string;
}

export function SharedMessageView({
  message,
  avatarLabel,
  speakerLabel,
  pendingLabel,
  failedLabel,
  runtimeActivityLabel,
  formatRuntimeActivityTitle = (activity) => activity.phase,
  formatRuntimeActivityTime = () => ""
}: SharedMessageViewProps) {
  const role = message.role;
  const bodyMarkdown = message.content;
  const status = message.status;
  const runtimeActivities = (message.runtimeActivities ?? message.runtimeRef?.activity ?? []).filter((activity) => activity.status !== "completed");
  const isUser = role === "user";
  const rowClass = role ?? "system";
  const runtimeStatus = status === "streaming" ? message.runtimeStatus : undefined;

  return (
    <article className={`shared-message-row shared-message-row-${rowClass} ${status ?? ""}`}>
      <div className={`shared-message-avatar shared-message-avatar-${rowClass}`} aria-label={avatarLabel ?? speakerLabel ?? rowClass}>
        {isUser ? avatarLabel ?? "You" : <Bot size={16} />}
      </div>
      <div className={`shared-message shared-message-${rowClass} ${status ?? ""}`}>
        {speakerLabel && <strong className="shared-message-speaker">{speakerLabel}</strong>}
        {bodyMarkdown ? <MarkdownRenderer value={bodyMarkdown} className="shared-message-body" /> : null}
        {runtimeStatus ? (
          <div className="shared-message-runtime-status">
            <Loader2 className="spin" size={15} />
            <span>{runtimeStatus.label}</span>
          </div>
        ) : null}
        {runtimeActivities.length > 0 ? (
          <div className="shared-runtime-activity-list" aria-label={runtimeActivityLabel}>
            {runtimeActivities.map((activity) => (
              <div key={activity.id} className={`shared-runtime-activity shared-runtime-activity-${activity.phase}`}>
                {activity.phase === "command" ? <Square size={12} /> : activity.phase === "tool" ? <Wrench size={12} /> : <Brain size={12} />}
                <span className="shared-runtime-activity-time">{formatRuntimeActivityTime(activity.updatedAt)}</span>
                <span className="shared-runtime-activity-title">{formatRuntimeActivityTitle(activity)}</span>
                <span className="shared-runtime-activity-label" title={activity.label}>{activity.label}</span>
              </div>
            ))}
          </div>
        ) : null}
        {!bodyMarkdown && status === "streaming" ? (
          <div className="shared-message-pending">
            <Loader2 className="spin" size={15} />
            {pendingLabel}
          </div>
        ) : null}
        {status === "failed" && failedLabel ? <span className="shared-message-status">{failedLabel}</span> : null}
      </div>
    </article>
  );
}
