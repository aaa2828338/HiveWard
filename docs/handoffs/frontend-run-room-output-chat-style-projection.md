# Frontend/API Construction Sheet: RunRoom output uses chat-style projection

Read `AGENTS.md`, inspect referenced code, follow this document in order, do not skip sections, keep scope tight, avoid guessing, verify every claim, and report deviations.

## Confirmed Mode

- Mode: `Clean Foundation Strict`（干净地基严格模式：旧的“每个运行事件都是一条长期消息”的正常路径必须删除，不能保留为兼容分支）.
- Canonical event owner: `AgentOutputEvent`（模型输出事件：记录运行期间发生了什么；allowed `kind` values are `message_started`, `message_delta`, `message_completed`, `runtime_state`, `tool_state`, `message_failed`; created by backend worker/API, stored in `agent_output_events`, consumed by API/frontend projection）.
- Canonical run invocation key: `sourceId`（源对象 ID：在 RunRoom 节点输出里必须等于 `nodeRun.id`，回答“这批 delta/runtime/completed 属于哪一次节点调用”） when `ownerType === "run_room"`（运行房间 owner：这条事件属于哪个 RunRoom） and `sourceType === "blueprint_node_run"`（蓝图节点运行源：这条事件来自哪个节点运行）.
- Durable user-facing report owner: `ReleaseReport`（本轮报告：Manager 发布给用户看的轮次总结） and `AgentHumanReport`（Agent 人类报告：节点产出的可读 Markdown 记录）. Runtime deltas and command/tool states must not become durable user report rows.
- Frontend responsibility: project backend truth into a live view. Frontend must not own run lifecycle, worker execution, runtime identity, persistence, or report publication.
- Current worktree when authored: `D:\HiveWard-run-room-stack-pr1`, branch `codex/run-room-pr23-decision-inbox-frontend`, head `179dbb8`. The worktree already had unrelated modified files; preserve them and keep implementation diffs scoped.

## User-Facing Target

The Runs page must behave like Chat/Codex Desktop:

1. During a run, model self-talk, streaming output, command status, and tool status appear as live activity on the current invocation.
2. Tool/command status uses a fixed activity/status slot or compact activity list. It must update in place; it must not create permanent chronological chat rows.
3. `message_delta`（流式文本片段：只更新当前调用的可见草稿） and `runtime_state`（运行状态：只更新当前调用的 thinking/tool/command 状态） disappear or collapse after the invocation/final report is complete.
4. After a `ReleaseReport` exists, the durable normal product output is the report/artifacts view. The current-output panel must not keep raw self-talk, command started rows, runtime JSON, or `humanReportMd` wrapper JSON as normal content.
5. User run interjections remain user messages/input events, but they must not be mixed with worker runtime activity or become lifecycle owners.

## Code Evidence

- `apps/web/src/components/ChatPage.tsx:760-787` creates one local user message and one streaming assistant message before SSE events arrive. This proves the chat page treats a model call as one visible assistant message, not one row per event.
- `apps/web/src/components/ChatPage.tsx:813-835` receives `AgentOutputEvent` SSE frames from `api.streamSessionChat` and applies them to the existing assistant message.
- `apps/web/src/components/ChatPage.tsx:1425-1485` handles `message_delta`, `runtime_state`, `message_started`, and `message_completed` by updating the current message in place. This is the target projection shape.
- `apps/web/src/lib/model-output-thread.ts:57-118` projects stored `AgentOutputEvent` rows into `ModelOutputThreadMessage`（模型输出线程消息：render-only 消息，不是新的持久 owner）. `message_delta` appends to the active assistant message, `runtime_state` updates `runtimeActivities`, and `message_completed` finalizes the message.
- `apps/web/src/lib/model-output-thread.test.ts:10-107` proves five raw events become two render messages: one user message plus one assistant final answer with activity metadata. This is the behavior model RunRoom output should reuse/adapt.
- `apps/web/src/lib/chat-state.ts:36-49` proves runtime status is visible only while an assistant message is `streaming`（流式状态：回复还没完成） and has `runtimeStatus`; runtime status is not a durable message row.
- `apps/api/src/routes/apiRouter.ts:2051-2248` streams chat output by appending `AgentOutputEvent` facts and writing those events directly to SSE. Chat history is rebuilt from agent output events, not from old chat message rows.
- `apps/api/src/routes/apiRouter.test.ts:3790-3827` verifies chat streaming stores visible final output on `message_completed` and stores runtime activity on `runtimeState.activity`.
- `apps/api/src/worker/blueprintWorker.ts:5201-5324` writes RunRoom node output events with `ownerType: "run_room"`, `ownerId: context.runRoom.id`, `sourceType: "blueprint_node_run"`, `sourceId: context.nodeRun.id`, and metadata including `runRoomId`, `blueprintRunId`, `nodeRunId`, `nodeId`, and `nodeType`. This proves RunRoom already has a stable grouping key for one node invocation.
- `apps/api/src/worker/blueprintWorker.test.ts:2700-2749` proves completed node output is stored as canonical `ownerType: "run_room"` and explicitly not as `worker_task` metadata.
- `apps/api/src/worker/blueprintWorker.test.ts:2752-2825` proves provider deltas are persisted as canonical RunRoom output events with `kind: "message_delta"` and `sourceId: nodeRun.id`.
- `packages/shared/src/agentOutput.ts:23-37` defines `AgentOutputEvent`; `kind`（事件类型：只回答事件在输出流里的技术阶段，不能决定 UI 是否长期留存） and `runtimeState`（运行状态载荷：只回答当前运行对象状态，不能成为报告内容） are already available.
- `packages/shared/src/agentOutput.ts:39-72` defines `RunRoomFeedRow` and `RunRoomFeed`. These are the old display-row contracts to delete from the normal RunRoom output path.
- `apps/api/src/services/agentOutputService.ts:86-108` currently projects raw agent output events plus run interjections into `RunRoomFeed.rows`.
- `apps/api/src/services/agentOutputService.ts:135-155` creates one `RunRoomFeedRow` per event, including `message_delta` and `runtime_state`. This is the direct cause of the cluttered current-output stream.
- `packages/shared/src/api.ts:72-95` exposes `RunRoomFeedResponse` and `RunRoomFeedStreamEvent` with `feed_snapshot` / `feed_row`. These old public API surfaces make event rows look like durable feed rows.
- `apps/api/src/routes/apiRouter.ts:1147-1155` serves `/api/run-rooms/:runRoomId/feed` from `projectRunRoomFeed`.
- `apps/api/src/routes/apiRouter.ts:1161-1239` streams `/api/run-rooms/:runRoomId/feed/stream` as `feed_snapshot` and `feed_row`; this preserves the old row-shaped public surface.
- `apps/web/src/lib/run-room-stream-state.ts:17-41` applies `feed_snapshot` by replacement and `feed_row` by append/upsert into `runRoomFeed.rows`.
- `apps/web/src/lib/run-room-state.ts:4-8` reads `runView.runRoomFeed?.rows` and sorts/normalizes them for display.
- `apps/web/src/components/RunRoomFeedView.tsx:30-37` maps every row to a visible long-lived message row.
- `apps/web/src/components/WorkspacePages.tsx:611-615` builds `runRoomFeedRows` from the active run; `apps/web/src/components/WorkspacePages.tsx:879-886` renders `RunRoomFeedView` in the `current` output tab.
- `apps/web/src/components/WorkspacePages.tsx:951-966` already renders the latest `ReleaseReport.summary` under the `Round Report` / `本轮报告` tab. This is the durable report surface to keep.
- `apps/web/src/components/WorkspacePages.test.tsx:1054-1191` currently asserts the old behavior: RunRoom feed rows render instead of old transcript/timeline facts. This test must be replaced with chat-style projection tests.
- `apps/api/src/routes/apiRouter.test.ts:3155-3185` currently expects a `message_delta` to appear as a RunRoom feed row. This is a regression test for the old shape and must be rewritten.

## Evidence, Inference, Unknowns

- Verified fact: chat and RunRoom already share the same low-level `AgentOutputEvent` concept.
- Verified fact: chat projects many events into one render message; RunRoom currently projects many events into many durable-looking rows.
- Verified fact: worker-produced RunRoom node output has a stable invocation key: `sourceType: "blueprint_node_run"` plus `sourceId: nodeRun.id`.
- Verified fact: the final report surface already exists through `releaseReports`.
- Inference: the desired product behavior can be implemented without store/schema migrations because canonical `AgentOutputEvent` facts already exist.
- Unknown until implementation: whether any remaining UI path still requires `RunRoomFeed` after the current-output panel is replaced. If yes, delete that dependency in the same PR or stop if it crosses forbidden modules.

## Coverage Inventory

- `AgentOutputEvent.kind`（事件类型：allowed `message_started`, `message_delta`, `message_completed`, `runtime_state`, `tool_state`, `message_failed`; created by worker/API, stored in `agent_output_events`, consumed by chat/run projections; it permits stream projection decisions but forbids lifecycle/report ownership decisions）.
- `ownerType`（owner 类型：allowed values include `run_room`, `chat_session`, `worker_task`, `manager_thread`, `human_action_request`; for this PR, RunRoom normal output may read only `run_room`; old `worker_task` / `manager_thread` / `human_action_request` projection shapes are 保留为历史事实，不参与决策）.
- `ownerId`（owner ID：for RunRoom output it must equal `runRoomId`; created by worker/API, stored in `agent_output_events`, used by API to filter events for one RunRoom）.
- `sourceType`（源类型：for canonical RunRoom node output it must be `blueprint_node_run`; it answers which domain object produced the event; it must not be inferred from labels or actor names）.
- `sourceId`（源 ID：for canonical RunRoom node output it must equal `nodeRun.id`; frontend uses it as the invocation grouping key）.
- `runtimeState.phase`（运行阶段：allowed `thinking`, `tool`, `command` when visible; created by runtime adapters/worker; consumed by UI status slot; it must not create normal feed rows）.
- `runtimeState.activityStatus` / `runtimeState.status`（活动/运行状态：allowed activity values `started`, `updated`, `completed`; runtime status values come from runtime execution; consumed only for activity display and failure state, not for report publication）.
- `ChatRuntimeActivity`（聊天式运行活动：render-only activity record with `id`, `source`, `phase`, `label`, `status`, `updatedAt`; created by frontend projection from `runtimeState`; stored only when included on completed runtime refs, not as a RunRoom row）.
- `ModelOutputThreadMessage`（模型输出线程消息：render-only message; created by frontend projection from events; consumed by message UI; it is not persisted and cannot decide lifecycle）.
- `RunRoomFeedRow` / `RunRoomFeed`（旧 RunRoom feed 行/列表：删除 from normal product path; if an enum/type reference remains outside this PR, it must be explicitly described as 保留为历史事实，不参与决策）.
- `ReleaseReport.summary`（发布报告摘要：Manager 发布给用户看的最终轮次说明； created by release-report workflow, stored in release reports, projected to `本轮报告`; it is the durable normal user-facing output after completion）.
- `AgentHumanReport.bodyMd`（Agent 人类报告正文：节点的可读产出； stored in agent reports, used for report/context layers; it may feed report views but must not appear as raw JSON wrapper in current output）.

## PR Construction Sheet

### Exact Base And Branch

- Base: `codex/run-room-pr23-decision-inbox-frontend` at `179dbb8`.
- Implementation branch: `codex/run-room-pr24-run-output-thread-projection`.
- If base head changed, first re-run Code Evidence and update this document before coding.
- If dirty files exist, preserve unrelated user changes and keep this PR diff scoped to the allowed files below.

### Exact Scope

Replace RunRoom current-output display from feed-row rendering to chat-style output projection:

1. Delete normal `RunRoomFeedRow` / `RunRoomFeed` current-output surfaces.
2. Expose validated RunRoom `AgentOutputEvent` facts and run interjections through a new output-event API contract.
3. Project events by invocation key (`sourceType: "blueprint_node_run"`, `sourceId: nodeRun.id`) into render-only output messages/cards.
4. Render runtime status/activity in place, not as standalone rows.
5. Keep final durable output in `ReleaseReport` / artifacts.
6. Replace old tests that prove row rendering with tests proving row rendering cannot happen.

### Allowed Files And Modules

- `packages/shared/src/agentOutput.ts`: delete RunRoom feed row/list types only if no other allowed module needs them; otherwise isolate remaining definitions as historical and unused by RunRoom output.
- `packages/shared/src/api.ts`: replace `RunRoomFeedResponse` / `RunRoomFeedStreamEvent` with new output-event response/stream contracts.
- `packages/shared/src/blueprint.ts`: replace `BlueprintRunView.runRoomFeed` with the new RunRoom output snapshot field if the run detail payload still needs embedded output.
- `apps/api/src/services/agentOutputService.ts`: replace `projectRunRoomFeed` with validated event listing/projection helpers.
- `apps/api/src/routes/apiRouter.ts`: delete old feed endpoints from normal product path and add new output-event endpoints.
- `apps/api/src/routes/apiRouter.test.ts`: rewrite API behavior tests.
- `apps/api/src/executionRebuildOldPathGate.test.ts`: update old-path gates so feed-row projection cannot re-enter.
- `apps/web/src/App.tsx`: replace RunRoom feed stream state wiring with output-event stream state wiring.
- `apps/web/src/lib/api.ts`: replace frontend feed client methods/types.
- `apps/web/src/lib/model-output-thread.ts`: reuse or extend chat projection helpers so RunRoom uses the same event-to-message concept without importing `RunRoomFeedRow`.
- `apps/web/src/lib/model-output-thread.test.ts`: add RunRoom projection coverage if shared helpers move here.
- `apps/web/src/lib/run-room-output-state.ts`: new allowed file for RunRoom-specific event snapshot/stream application and invocation grouping.
- `apps/web/src/lib/run-room-output-state.test.ts`: new required tests.
- `apps/web/src/lib/run-room-state.ts` and `apps/web/src/lib/run-room-state.test.ts`: delete or replace; no old feed-row display helper may remain in normal path.
- `apps/web/src/lib/run-room-stream-state.ts` and `apps/web/src/lib/run-room-stream-state.test.ts`: delete or replace; no `feed_row` upsert helper may remain.
- `apps/web/src/components/RunRoomFeedView.tsx`: delete/replace with a RunRoom output view that consumes render-only projection, not feed rows.
- `apps/web/src/components/WorkspacePages.tsx`: wire the current-output tab to the new projection and keep `本轮报告` as durable output.
- `apps/web/src/components/WorkspacePages.test.tsx`: replace old UI expectations.
- `apps/web/src/components/SharedMessageView.tsx`: only if needed to remove `RunRoomFeedRow` coupling and reuse chat-style message rendering.
- `apps/web/src/styles.css`: minimal class replacement; delete `.run-room-feed*` normal styles if the component is removed.

### Forbidden Files And Modules

- Do not edit store schema, migrations, or persistence tables. This PR must use existing `agent_output_events`, `run_interjections`, `release_reports`, and `agent_human_reports`.
- Do not edit runtime adapters (`packages/adapter/src/sdk-runtime/*`) unless a compile error proves a type rename requires a mechanical import fix.
- Do not edit skills, prompts, role contracts, or prompt envelopes.
- Do not add dependencies.
- Do not add frontend-owned lifecycle, approval, session, or runtime identity state.
- Do not infer grouping from node labels, actor labels, rendered text, command strings, JSON body shape, graph position, or CSS classes.

### Forbidden Shapes

- No append-only `rows.map(...)` UI for RunRoom raw output events.
- No `RunRoomFeedRow` object used as a normal current-output render model.
- No `feed_snapshot` / `feed_row` SSE contract in the new normal product path.
- No `runtime_state` card, row, message, or Markdown body as a standalone visible output.
- No `message_delta` card, row, message, or Markdown body as a standalone durable output.
- No raw JSON wrapper display such as `{"humanReportMd": ...}` in the current-output panel after report publication.
- No grouping by label text, actor text, command string, graph position, CSS class, or JSON body shape.
- No missing-`sourceId` fallback that turns old events into normal output.
- No frontend-owned final report synthesized from runtime deltas.
- No retained old feed route described as `compatibility`, `fallback`, `read-only fallback`, or `best-effort`.

### New Contracts And Fields

Use these names unless an existing local convention clearly requires a narrower name:

- `RunRoomOutputSnapshot`（运行房间输出快照：回答一个 RunRoom 当前有哪些底层输出事实； contains `runRoomId`, `events`, `interjections`; created by API, stored nowhere new, consumed by frontend）.
- `RunRoomOutputStreamEvent`（运行房间输出流事件：allowed `output_snapshot`, `agent_output_event`, `run_interjection`, `heartbeat`, `output_error`; created by API SSE route, consumed by frontend stream state）.
- `RunRoomOutputMessage`（运行房间输出消息：render-only message/card; created by frontend projection from snapshot/events; not persisted）.
- `runRoomInvocationId`（运行房间调用 ID：for node output equals `sourceId`; created by frontend projection from verified event fields; groups `message_delta`, `runtime_state`, and `message_completed`; does not decide lifecycle or report publication）.
- `runtimeActivities`（运行活动列表：compact thinking/tool/command display attached to one invocation message; created by frontend projection; must update by activity id instead of appending rows）.

The API must not emit `RunRoomFeedRow`, `feed_snapshot`, or `feed_row` in the new normal path.

### Field Producers, Storage, Consumers

- Producer: `BlueprintWorker.appendRunRoomNodeOutputEvent` already creates canonical RunRoom `AgentOutputEvent` facts.
- Storage: existing `agent_output_events`; no new table or migration.
- API consumer/producer: `AgentOutputService` validates and lists RunRoom output events; route returns/streams `RunRoomOutputSnapshot` and `RunRoomOutputStreamEvent`.
- Frontend consumer: `App` stores the latest output snapshot/events for the selected run; `WorkspacePages` renders projected messages.
- UI projection: current-output tab shows live `RunRoomOutputMessage` plus one compact status/activity area; report tab shows `ReleaseReport.summary`.

### Allowed Values

- `RunRoomOutputStreamEvent.type`: `output_snapshot`, `agent_output_event`, `run_interjection`, `heartbeat`, `output_error`.
- `AgentOutputEvent.kind`: use existing allowed values; for UI projection implement `message_started`, `message_delta`, `message_completed`, `message_failed`, `runtime_state`; ignore or explicitly block `tool_state` until a tested product meaning exists.
- `runtimeState.phase`: `thinking`, `tool`, `command` for visible activity; unknown values must not render as normal rows.
- `RunRoomOutputMessage.status`: `streaming`, `sent`, `failed`.

### Forbidden Decisions

- Do not decide durable visibility from `kind` alone. `kind` only explains event phase.
- Do not decide invocation grouping from display text, labels, JSON shape, or command string.
- Do not turn `runtime_state` into `bodyMarkdown`.
- Do not show raw `humanReportMd` JSON wrapper as current output after a report exists.
- Do not keep `Send response`, approval, or inbox actions on execution output messages.
- Do not keep old feed endpoints as a read-only fallback.

### Old Paths Deleted In This PR

- Delete old normal `RunRoomFeedRow` / `RunRoomFeed` current-output rendering.
- Delete old `/api/run-rooms/:runRoomId/feed` and `/api/run-rooms/:runRoomId/feed/stream` normal product routes.
- Delete frontend `feed_snapshot` / `feed_row` stream state application.
- Delete tests that expect `message_delta` or `runtime_state` to appear as feed rows.
- Delete `.run-room-feed*` normal UI class dependency if `RunRoomFeedView` is removed.

### Old Paths Not Yet Deleted But Forbidden From New Reads/Writes

- Global `agentOutputOwnerTypes` may still include `worker_task`, `manager_thread`, and `human_action_request`; for RunRoom output projection those values are 保留为历史事实，不参与决策.
- Store rows created by older builds may remain on disk; the new normal RunRoom output API must not project old non-`run_room` owners as normal output.
- No later PR is planned for feed-row compatibility. If an old path is still needed by an allowed file, stop and report the exact dependency instead of creating a compatibility branch.

### APIs To Add, Change, Or Delete

- Add `GET /api/run-rooms/:runRoomId/output/events`.
- Add `GET /api/run-rooms/:runRoomId/output/events/stream`.
- Delete normal product use of `GET /api/run-rooms/:runRoomId/feed`.
- Delete normal product use of `GET /api/run-rooms/:runRoomId/feed/stream`.
- Update run detail attachment from `runRoomFeed` to the new output snapshot only if embedding is still required by `BlueprintRunView`.

### Persistence/Schema/Migration Requirements

- No schema changes.
- No migration.
- Existing `agent_output_events` rows remain canonical event facts.
- Existing `run_interjections` remain user interjection facts.
- Existing `release_reports` and `agent_human_reports` remain durable report facts.

### Service/Worker Ownership Requirements

- Worker remains the producer of RunRoom `AgentOutputEvent` facts.
- `AgentOutputService` owns validated event listing for RunRoom output.
- Frontend projection owns only render shape, not execution semantics.
- `ReleaseReport` / report services remain the final durable report owner.

### Frontend Projection Requirements

Implement a RunRoom projection that follows chat semantics but uses RunRoom grouping:

1. Sort events by `sequence` then `id` for one `runRoomId`.
2. Accept only events where `ownerType === "run_room"` and `ownerId === runRoomId`.
3. For node output, require `sourceType === "blueprint_node_run"` and non-empty `sourceId`.
4. Group node output by `sourceId`.
5. `message_started` creates or opens the invocation message and sets status `streaming`.
6. `message_delta` appends/replaces content on that invocation message.
7. `runtime_state` updates the invocation message status/activity. It must not create a standalone visible message.
8. `message_completed` finalizes the invocation message with `bodyMarkdown` and clears live runtime status.
9. `message_failed` finalizes the invocation message as failed.
10. Once the active run has a latest `ReleaseReport`, default user-facing output must be the report/artifacts view; current-output raw activity must not remain as normal long-lived content.

### Positive Tests

- Chat-style projector turns `message_started` + `runtime_state` + `message_delta` + `message_completed` with the same `sourceId` into one `RunRoomOutputMessage`.
- Runtime activity updates in place by activity id and appears under that one invocation message.
- `message_completed.bodyMarkdown` replaces/settles the streaming draft for that invocation.
- API snapshot returns validated canonical RunRoom output events and run interjections for the requested RunRoom.
- API stream emits `output_snapshot`, then newly appended `agent_output_event`.
- Runs page current-output tab renders one invocation message for multiple raw events.
- Runs page report tab renders `latestReleaseReport.summary` as the durable report.
- After a report exists, raw runtime activity does not remain as normal current-output content.

### Negative Tests

- `runtime_state` alone cannot render as a standalone message row.
- `message_delta` cannot render as its own durable row when a matching invocation exists.
- Events with `ownerType: "chat_session"` do not appear in RunRoom output even if metadata includes `runRoomId`.
- Old `worker_task`, `manager_thread`, or `human_action_request` owner events do not project as normal RunRoom output.
- Events with mismatched `ownerId`, `metadata.runRoomId`, or missing `sourceId` do not project as node invocation messages.
- Old `/feed` and `/feed/stream` endpoints are not used by frontend and do not return the new normal product data.
- `RunRoomFeedView` / `RunRoomFeedRow` cannot appear as normal UI action/source names in product code.
- Raw JSON containing `humanReportMd` does not appear in current-output UI after `ReleaseReport` exists.
- Execution output messages expose no reply, approval, inbox, or send-target controls.

### Source Gates

Run and inspect:

```bash
rg -n "RunRoomFeed|RunRoomFeedRow|RunRoomFeedView|feed_snapshot|feed_row|runRoomFeed|run-room-feed" packages/shared/src apps/api/src apps/web/src -S
rg -n "/feed|streamRunRoomFeed|getRunRoomFeed|applyRunRoomFeedStreamEvent|buildRunRoomFeedRowsForDisplay" apps/api/src apps/web/src packages/shared/src -S
rg -n "runtime_state.*RunRoomFeed|message_delta.*RunRoomFeed|execution_output" apps/api/src apps/web/src packages/shared/src -S
```

Expected result: no normal product-path references. Any remaining reference must be in explicitly named historical tests/gates and must state `保留为历史事实，不参与决策`; otherwise the source gate fails.

### Behavior Gates

Run:

```bash
npm test -- apps/web/src/lib/model-output-thread.test.ts
npm test -- apps/web/src/lib/run-room-output-state.test.ts
npm test -- apps/web/src/components/WorkspacePages.test.tsx
npm test -- apps/api/src/routes/apiRouter.test.ts
npm test -- apps/api/src/executionRebuildOldPathGate.test.ts
npm run typecheck -w @hiveward/web
npm run typecheck -w @hiveward/api
```

Behavior gates must prove behavior. Source scans alone are insufficient.

### Mechanical Acceptance Checklist

- Current-output UI no longer appends one permanent row per `message_delta` / `runtime_state`.
- One node invocation groups by `sourceId`.
- Runtime status/activity updates in place.
- Final durable report comes from `ReleaseReport` / artifacts.
- No backend store/schema/migration changes.
- No skill/prompt changes.
- Old feed APIs and UI helpers are deleted from normal product path.
- Negative tests prove old row projection cannot execute, project normal capability, appear as a normal UI action, or decide report visibility.

### Failure Conditions

Stop and report if any condition is true:

- `AgentOutputEvent` facts on the base branch do not provide a stable `sourceId` / `sourceType` for RunRoom node output.
- Implementing the new projection requires store schema or migration changes.
- Any required change crosses forbidden files and cannot be separated.
- Existing dirty worktree changes in allowed files conflict with this PR and cannot be isolated without overwriting user work.
- Old feed endpoints are still required by another normal product surface that cannot be migrated in this PR.
- The final report surface cannot be identified from `releaseReports`, `agentHumanReports`, or `finalResult`.

## Completion Report Requirements

The implementer must return the repository-required completion report with:

- changed files;
- verification commands and results;
- remaining risks or `none`;
- `Change classification`;
- `用人话翻译`.

For this PR, deterministic API contracts, UI projection, source gates, and behavior tests are `Program-level`. Prompt/skill changes are `Prompt-level` only if a separate prompt/skill file is actually touched. If both are touched, classify as `Mixed` and separate responsibilities.

## 人话提示词解释

这份文档要求工程师把运行页从“日志流”改成“聊天式投影”。底层仍然保留真实事件事实：`AgentOutputEvent` 记录模型开始、增量输出、工具/命令状态、完成或失败。但 UI 不再把每个事件当作一条长期消息。它要像聊天页一样，把同一次节点调用的事件按 `sourceId` 聚合成一个可见输出块：运行中更新，完成后收口；最终用户长期看的内容是 `本轮报告` 和 `产物`。这符合 `Clean Foundation Strict`，因为旧的 feed-row 正常路径被删除，不给它留兼容分支。

## 提示词自检报告

- Confirmed mode: `Clean Foundation Strict`.
- Canonical owner: `AgentOutputEvent` owns runtime output facts; `ReleaseReport` / `AgentHumanReport` own durable report facts; frontend owns render projection only.
- Deletion list: old `RunRoomFeedRow`, `RunRoomFeed`, `/feed`, `/feed/stream`, `feed_snapshot`, `feed_row`, row-based UI helpers/tests from normal product path.
- Forbidden shapes: text/label/JSON/CSS inference, runtime_state as standalone row, raw `humanReportMd` JSON in current output, frontend-owned lifecycle, old owner projection fallback.
- Verification: includes targeted API/frontend tests, typechecks, source gates, and behavior gates.
- Negative tests: explicitly prove old row projection cannot render, execute as normal UI, select old owners, expose normal actions, or decide report visibility.
- Deviations: none.
