import type { ChatRuntimeActivity } from "@hiveward/shared";
import type { Language } from "../lib/i18n";
import type { RunRoomOutputMessage, RunRoomOutputStreamState } from "../lib/run-room-output-state";
import { EmptyState, StatusBadge, type StatusBadgeTone } from "../shared/ui";
import { SharedMessageView } from "./SharedMessageView";

export interface RunRoomOutputViewProps {
  messages: RunRoomOutputMessage[];
  language: Language;
  streamState?: RunRoomOutputStreamState;
  reportAvailable?: boolean;
}

export function RunRoomOutputView({ messages, language, streamState = "idle", reportAvailable = false }: RunRoomOutputViewProps) {
  const copy = getRunRoomOutputCopy(language);
  const streamCopy = getRunRoomOutputStreamCopy(streamState, language);
  return (
    <section className="run-room-output run-output-section" aria-label={copy.title}>
      <div className="run-output-section-header">
        <div>
          <h4>{copy.title}</h4>
          <p>{reportAvailable ? copy.reportAvailableHint : copy.hint}</p>
        </div>
        <StatusBadge className="run-room-output-stream-pill" label={streamCopy} tone={streamStateTone(streamState)} />
      </div>
      {messages.length === 0 ? (
        <EmptyState className="ui-state-compact" title={reportAvailable ? copy.reportAvailableEmpty : copy.empty} />
      ) : (
        <div className="trace-output-stream run-room-output-list" aria-live="polite">
          {messages.map((message) => (
            <SharedMessageView
              key={message.id}
              message={message}
              avatarLabel={avatarLabelForMessage(message, language)}
              speakerLabel={speakerLabelForMessage(message, language)}
              pendingLabel={copy.pending}
              failedLabel={copy.failed}
              runtimeActivityLabel={copy.runtimeActivity}
              formatRuntimeActivityTitle={(activity) => formatRunRoomRuntimeActivityTitle(activity, language)}
              formatRuntimeActivityTime={(value) => formatRunRoomOutputTime(value, language)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function streamStateTone(streamState: RunRoomOutputStreamState): StatusBadgeTone {
  if (streamState === "live") return "success";
  if (streamState === "connecting") return "warning";
  if (streamState === "error") return "danger";
  return "neutral";
}

function getRunRoomOutputCopy(language: Language) {
  const zh = language === "zh-CN";
  return {
    title: zh ? "RunRoom 输出" : "RunRoom output",
    hint: "Manager / Worker / System",
    reportAvailableHint: zh ? "本轮报告已发布。" : "Round report published.",
    empty: zh ? "还没有运行输出。" : "No run output yet.",
    reportAvailableEmpty: zh ? "本轮报告已发布，当前输出不再显示运行过程活动。" : "Round report is available; current output no longer shows runtime activity.",
    pending: zh ? "运行中" : "Working",
    failed: zh ? "失败" : "Failed",
    runtimeActivity: zh ? "运行活动" : "Runtime activity"
  };
}

function getRunRoomOutputStreamCopy(streamState: RunRoomOutputStreamState, language: Language): string {
  const zh = language === "zh-CN";
  if (streamState === "connecting") return zh ? "连接中" : "Connecting";
  if (streamState === "live") return zh ? "实时" : "Live";
  if (streamState === "error") return zh ? "离线" : "Offline";
  return zh ? "只读" : "Read-only";
}

function speakerLabelForMessage(message: RunRoomOutputMessage, language: Language): string | undefined {
  if (message.role === "user") return language === "zh-CN" ? "用户" : "You";
  return message.speakerLabel;
}

function avatarLabelForMessage(message: RunRoomOutputMessage, language: Language): string | undefined {
  if (message.role === "user") return language === "zh-CN" ? "用户" : "You";
  if (message.speakerLabel === "Manager") return "M";
  if (message.speakerLabel === "Worker") return "W";
  if (message.speakerLabel === "System") return "S";
  return "A";
}

function formatRunRoomRuntimeActivityTitle(activity: ChatRuntimeActivity, language: Language): string {
  const zh = language === "zh-CN";
  if (activity.phase === "thinking") return zh ? "思考" : "Thinking";
  if (activity.phase === "tool") return zh ? "工具" : "Tool";
  return zh ? "命令" : "Command";
}

function formatRunRoomOutputTime(value: string, language: Language): string {
  const formatter = new Intl.DateTimeFormat(language === "zh-CN" ? "zh-CN" : "en", {
    hour: "2-digit",
    minute: "2-digit"
  });
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? formatter.format(date) : value;
}
