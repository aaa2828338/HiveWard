import type { RunRoomFeedRow } from "@hiveward/shared";
import type { Language } from "../lib/i18n";
import {
  canOpenRunRoomFeedWorkerDetails,
  formatRunRoomFeedRuntimeState
} from "../lib/run-room-state";
import { SharedMessageView } from "./SharedMessageView";

export interface RunRoomFeedViewProps {
  rows: RunRoomFeedRow[];
  language: Language;
}

export function RunRoomFeedView({ rows, language }: RunRoomFeedViewProps) {
  const copy = getRunRoomFeedCopy(language);
  return (
    <section className="run-room-feed run-output-section" aria-label={copy.title}>
      <div className="run-output-section-header">
        <div>
          <h4>{copy.title}</h4>
          <p>{copy.hint}</p>
        </div>
        <span className="status-pill status-default">{copy.readOnly}</span>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state compact-empty-state">{copy.empty}</div>
      ) : (
        <div className="trace-output-stream run-room-feed-list">
          {rows.map((row) => (
            <RunRoomFeedMessageRow key={row.id} row={row} language={language} />
          ))}
        </div>
      )}
    </section>
  );
}

function RunRoomFeedMessageRow({ row, language }: { row: RunRoomFeedRow; language: Language }) {
  const copy = getRunRoomFeedCopy(language);
  const runtimeState = formatRunRoomFeedRuntimeState(row, language);
  const speakerLabel = runRoomFeedSpeakerLabel(row, language);
  const avatarLabel = runRoomFeedAvatarLabel(row, language);
  const message = (
    <>
      <SharedMessageView message={row} speakerLabel={speakerLabel} avatarLabel={avatarLabel} />
      <div className="run-room-feed-meta">
        <time dateTime={row.createdAt}>{formatRunRoomFeedTime(row.createdAt, language)}</time>
        <span>{runRoomFeedDisplayModeLabel(row, language)}</span>
      </div>
      {runtimeState ? <div className="shared-message-runtime-status">{runtimeState}</div> : null}
    </>
  );

  if (!canOpenRunRoomFeedWorkerDetails(row)) {
    return <article className={`run-room-feed-row run-room-feed-row-${row.sourceType}`}>{message}</article>;
  }

  return (
    <article className="run-room-feed-row run-room-feed-row-worker">
      <details className="run-room-feed-details">
        <summary aria-label={copy.executionDetails}>
          {message}
        </summary>
        <dl className="run-execution-meta">
          <div>
            <dt>{copy.workerTask}</dt>
            <dd>{row.workerTaskId ?? copy.unknown}</dd>
          </div>
          <div>
            <dt>{copy.managerCommand}</dt>
            <dd>{row.managerCommandId ?? copy.unknown}</dd>
          </div>
          <div>
            <dt>{copy.event}</dt>
            <dd>{row.agentOutputEventId ?? copy.unknown}</dd>
          </div>
        </dl>
      </details>
    </article>
  );
}

function getRunRoomFeedCopy(language: Language) {
  const zh = language === "zh-CN";
  return {
    title: zh ? "RunRoom 群聊流" : "RunRoom office feed",
    hint: zh
      ? "只读显示 Manager 正式消息、Worker 执行输出和系统状态。"
      : "Read-only view of Manager messages, Worker execution output, and system status.",
    readOnly: zh ? "只读" : "Read-only",
    empty: zh ? "还没有 RunRoomFeed 行。" : "No RunRoomFeed rows yet.",
    executionDetails: zh ? "执行详情" : "Execution details",
    workerTask: "WorkerTask",
    managerCommand: "ManagerCommand",
    event: "AgentOutputEvent",
    unknown: zh ? "未知" : "Unknown"
  };
}

function runRoomFeedSpeakerLabel(row: RunRoomFeedRow, language: Language): string {
  const zh = language === "zh-CN";
  if (row.sourceType === "manager") return "Manager";
  if (row.sourceType === "worker") return "Worker";
  if (row.sourceType === "user") return zh ? "用户" : "You";
  return zh ? "系统" : "System";
}

function runRoomFeedAvatarLabel(row: RunRoomFeedRow, language: Language): string {
  const zh = language === "zh-CN";
  if (row.sourceType === "manager") return "M";
  if (row.sourceType === "worker") return "W";
  if (row.sourceType === "user") return zh ? "用户" : "You";
  return zh ? "系统" : "S";
}

function runRoomFeedDisplayModeLabel(row: RunRoomFeedRow, language: Language): string {
  const zh = language === "zh-CN";
  if (row.displayMode === "execution_output") return zh ? "执行输出" : "Execution output";
  return zh ? "正式消息" : "Formal message";
}

function formatRunRoomFeedTime(value: string, language: Language): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
}
