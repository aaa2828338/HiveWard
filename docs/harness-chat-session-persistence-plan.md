# Harness Chat Session Persistence Plan

## 背景

HiveWard 已经支持把 CEO / Leader 聊天路由到 OpenClaw、Codex、Claude Code。OpenClaw 有比较完整的 Agent / Session / History 结构；Codex 和 Claude Code 的 SDK 更偏向 native thread/session：

- Codex SDK 通过 `startThread()` 创建会话，通过 `resumeThread(threadId)` 恢复会话。thread 状态由 Codex 保存在自己的本地会话目录中。
- Claude Code SDK 通过 `query(..., { resume: sessionId })` 恢复会话，并有自己的本地 session persistence。
- HiveWard 当前可以拿到 native session id，但还没有把 Codex / Claude Code 的聊天会话作为 HiveWard 后端实体持久化，因此刷新、切页或重启后 UI 历史不稳定。

## 目标

做一套轻量的 HiveWard ChatSession 层，让 Codex / Claude Code 的会话体验接近“只要我没有主动结束，就可以回来继续”。

这套系统不接管 Codex / Claude Code 的记忆，也不冒充它们的桌面端历史系统。HiveWard 只保存自己发起的会话索引和 UI transcript，并保存 native session id 以便优先恢复原生上下文。

## 非目标

- 不做 Codex / Claude Code 的记忆插件。
- 不直接读写 Codex / Claude Code 的内部 session 文件作为主数据源。
- 不承诺永久恢复 native session；native 记录被清理、换机器、换用户、版本迁移失败时，HiveWard 只能展示自己的历史记录。
- 不把 Codex / Claude Code 包装成 OpenClaw Agent。Codex / Claude Code 只有 Harness Session，不显示 OpenClaw 的 Agent / Session 概念。

## 选型

默认采用方案 A：SDK native session。

- Codex：保存 `thread.id`，继续时调用 `resumeThread(threadId)`。
- Claude Code：保存 `session_id`，继续时传 `resume: sessionId`。
- HiveWard 自己保存 UI transcript，用于聊天列表和历史展示。

方案 B：PTY / terminal process 长驻模式暂不作为默认方案。它更像嵌入真实 CLI 终端，能保留“进程活着则上下文活着”的体验，但跨平台、ANSI 输出解析、交互提示、取消、权限和错误处理成本更高。可以以后作为高级模式加入。

## 存储边界

两边都保存，但保存内容不同：

- Codex / Claude Code 保存 native 会话状态：模型原生续接需要的 transcript、工具状态、thread/session 文件。
- HiveWard 保存产品层索引和展示记录：会话属于哪个 company、role、harness、model，以及用户在 HiveWard 里看到的消息。

可以理解为：

```text
HiveWard chatSessionId -> nativeSessionId
Codex / Claude Code nativeSessionId -> native thread/session state
```

`nativeSessionId` 是钥匙，不是记忆本体。钥匙存在且 native 房间还在，才能原生恢复。

## 数据模型草案

```ts
type ChatSessionStatus = "active" | "ended" | "native_missing" | "failed";

interface HivewardChatSession {
  id: string;
  companyId?: string;
  harnessId: "openclaw" | "codex" | "claudeCode";
  roleScope?: ChatRoleScope;
  title: string;
  nativeSessionId?: string;
  nativeSessionState?: "unknown" | "resumable" | "missing";
  modelId?: string;
  thinkingEffort?: ChatThinkingEffort;
  mode: "chat" | "blueprint";
  status: ChatSessionStatus;
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
}

interface HivewardChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: ChatAttachment[];
  harnessId: HarnessId;
  modelId?: string;
  nativeMessageId?: string;
  status: "sent" | "streaming" | "failed";
  runtimeRef?: ChatRuntimeRef;
  createdAt: string;
}
```

## API 草案

```text
GET  /api/chat/sessions
POST /api/chat/sessions
GET  /api/chat/sessions/:sessionId
GET  /api/chat/sessions/:sessionId/messages
POST /api/chat/sessions/:sessionId/messages/stream
POST /api/chat/sessions/:sessionId/end
```

兼容期可以保留当前 `/api/chat/stream`，但新前端应逐步切到 session-bound stream。

## 发送流程

1. 前端选择或创建 HiveWard ChatSession。
2. 用户发送消息到 `POST /api/chat/sessions/:sessionId/messages/stream`。
3. 后端先持久化 user message。
4. 如果 session 有 `nativeSessionId`：
   - Codex 调用 `resumeThread(nativeSessionId)`。
   - Claude Code 调用 `resume: nativeSessionId`。
5. 如果没有 `nativeSessionId`，创建新的 native session。
6. SDK 返回或更新 native session id 时，写回 HiveWard ChatSession。
7. assistant 输出流式写入 UI，同时最终落库为 assistant message。
8. 如果 native resume 失败：
   - session 标记为 `native_missing`。
   - UI 显示“原生会话不可恢复，仅可查看 HiveWard 历史”。
   - 不默认伪装成同一个 native 会话。

## UI 行为

- Codex / Claude Code 设置面板显示“会话”，不显示 OpenClaw Agent。
- 会话列表来自 HiveWard API，而不是前端 localStorage。
- 切换页面、刷新页面、重启前端后，聊天记录仍可展示。
- 用户可以手动结束会话；结束后不再默认 resume。
- native session 失效时，历史仍可查看，但继续发送需要新建会话或用户明确选择“用历史重建上下文”。

## 上下文重建策略

默认不把完整历史强行注入 prompt，避免越界和 token 膨胀。

只有在 native resume 失败且用户明确选择继续时，才使用 HiveWard transcript 生成显式上下文包：

```text
HiveWard visible conversation history:
...

Current user message:
...
```

这应在 UI 上标识为“使用 HiveWard 历史重建上下文”，不能称为 Codex / Claude 原生恢复。

## 验收测试

- Codex 新建会话后发送两轮，第二轮使用同一个 `nativeSessionId` resume。
- Claude Code 新建会话后发送两轮，第二轮使用同一个 `session_id` resume。
- 刷新页面后，HiveWard 会话列表和消息历史仍存在。
- 切到蓝图页再回来，当前会话不丢。
- 重启 HiveWard 后，能展示历史，并能尝试 native resume。
- 手动结束会话后，继续发送会要求新建或显式恢复。
- native resume 失败时，session 状态变为 `native_missing`，UI 不声称原生会话仍然有效。

## 推荐实施顺序

1. 在 `FileHivewardStore` 增加 `chatSessions` 和 `chatMessages` 持久化。
2. 增加 chat session API。
3. 调整前端聊天页从 API 读取会话和消息，移除 Codex / Claude Code 对 localStorage session view 的依赖。
4. 调整 `/api/chat/stream` 或新增 session-bound stream，保存 native session id 和 transcript。
5. 加 Codex / Claude Code resume 回归测试。
6. 加 native resume 失败的状态和 UI 提示。
7. 后续再评估 PTY terminal session 作为高级模式。
