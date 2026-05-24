# Harness Chat Session Persistence Plan

## 背景

HiveWard 已经能把 CEO / Leader 聊天路由到 OpenClaw、Codex、Claude Code，但三者的会话能力不是同一类东西：

- OpenClaw 自己有 Agent / Session / History 接口，是一条 OpenClaw 原生路线。
- Codex 通过 SDK `startThread()` 创建 thread，通过 `resumeThread(threadId)` 恢复 thread。
- Claude Code 通过 SDK `query(..., { resume: sessionId })` 恢复 session。

所以目标不是把 OpenClaw、Codex、Claude Code 强行合成一种内部模型，而是让每种运行时走自己该走的路线，并保证同一个产品功能只有一条实现链路。

## 目标状态

Codex / Claude Code 使用 HiveWard ChatSession 作为产品层会话实体。HiveWard 持久化会话索引、UI transcript、native session id；真正的模型上下文仍由 Codex / Claude Code 自己保存。

OpenClaw 保持自己的原生 Agent / Session / History 路线。OpenClaw 已经有可查询、可创建、可改名的 native session 能力，不把它包装成 Codex / Claude Code 那种 Harness Session。

聊天页的通用发送功能只走一条链路：

```text
HiveWard ChatSession -> POST /api/chat/sessions/:sessionId/messages/stream -> Runtime adapter -> transcript persistence
```

原通用发送入口 `/api/chat/stream` 已退出目标状态。OpenClaw 的 `/api/chat/session` 和 `/api/chat/history` 不是通用发送链路，它们是 OpenClaw 自己的 native session/history 边界。

## 非目标

- 不做 Codex / Claude Code 的记忆插件。
- 不直接读写 Codex / Claude Code 的内部 session 文件作为主数据源。
- 不承诺永久恢复 native session。native 记录被清理、换机器、换用户或版本迁移失败时，HiveWard 只能展示自己的 UI 历史。
- 不把 Codex / Claude Code 包装成 OpenClaw Agent。
- 不做 PTY / terminal process 长驻模式。它以后可以作为高级模式重新评估。

## 存储边界

```text
HiveWard chatSessionId -> nativeSessionId
Codex / Claude Code nativeSessionId -> native thread/session state
```

`nativeSessionId` 是钥匙，不是记忆本体。钥匙存在且 native 房间还在，才能原生恢复。

HiveWard 保存：

- company / role / harness / model / mode 等产品层索引。
- 用户在 HiveWard 里看到的 user / assistant transcript。
- native session id 和 native session 状态。

Codex / Claude Code 保存：

- 原生 thread/session transcript。
- 工具状态。
- provider 自己需要的本地 session 文件。

## API

目标发送链路：

```text
GET  /api/chat/sessions
POST /api/chat/sessions
GET  /api/chat/sessions/:sessionId
PATCH /api/chat/sessions/:sessionId
GET  /api/chat/sessions/:sessionId/messages
POST /api/chat/sessions/:sessionId/messages/stream
POST /api/chat/sessions/:sessionId/end
```

OpenClaw 原生边界：

```text
POST  /api/chat/session
PATCH /api/chat/session
GET   /api/chat/history
```

## 发送流程

1. 前端选择或创建 HiveWard ChatSession。
2. 用户消息发送到 `POST /api/chat/sessions/:sessionId/messages/stream`。
3. 后端先落库 user message，并创建 streaming assistant message。
4. 如果 session 有 `nativeSessionId`：
   - Codex 用该 id resume thread。
   - Claude Code 用该 id resume session。
   - OpenClaw 用该 session key 继续自己的 native session。
5. 如果没有 `nativeSessionId`，按 harness 创建新的 native session。
6. SDK 返回或更新 native session id 后写回 HiveWard ChatSession。
7. assistant 输出边流式返回 UI，边最终落库为 assistant message。
8. native resume 失败时，session 标记为 `native_missing`，UI 只展示 HiveWard 历史，不声称原生恢复仍然有效。

## 风险规避

- native resume 失败不静默降级。只有明确识别 resume/session/thread missing、invalid、expired、deleted 等错误时才标记 `native_missing`。
- stream 中途失败也落库。用户消息先保存，assistant 占位消息失败时更新为 `failed`，刷新后能看到失败原因。
- `native_missing` 默认禁止继续发送。用户只能新建 session，或显式选择“使用 HiveWard 历史重建上下文”。
- 历史重建不冒充原生恢复。重建会清空失效 native key，创建新的 native session，并在 prompt 中标明这是 HiveWard visible conversation history。
- 正常 native resume 成功时不注入完整 HiveWard transcript，避免 token 膨胀和上下文越界。
- 手动结束 session 后不再默认 resume；历史仍可查看，继续需要新建 session。

## 单链路策略

- Codex / Claude Code 聊天发送只有 session-bound stream 一条链路。
- OpenClaw 在聊天页发送也走 session-bound stream，保证 UI transcript 和 HiveWard ChatSession 一致。
- OpenClaw 的 native session 创建、改名、history 查询属于 OpenClaw 专属能力，不承担通用发送功能。
- 前端聊天页会话列表和消息历史只来自 HiveWard API，不再依赖 localStorage session view。
- store 迁移只做数据形状补齐：没有 `chatSessions` / `chatMessages` 的既有 store 自动补空集合。

## 验收测试

- Codex 新建会话后发送两轮，第二轮使用同一个 `nativeSessionId` resume。
- Claude Code 新建会话后发送两轮，第二轮使用同一个 `session_id` resume。
- 刷新页面后，HiveWard 会话列表和消息历史仍存在。
- 切到蓝图页再回来，当前会话不丢。
- 重启 HiveWard 后，能展示历史，并能尝试 native resume。
- 手动结束会话后，继续发送会要求新建或显式重建。
- native resume 失败时，session 状态变为 `native_missing`，UI 不声称原生会话仍然有效。
- `/api/chat/stream` 不存在；通用发送只走 session-bound stream。
