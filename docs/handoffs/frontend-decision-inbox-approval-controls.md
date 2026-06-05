# Frontend Construction Sheet: decision_required inbox projections use approval controls

Read `AGENTS.md`, inspect referenced code, follow this document in order, do not skip sections, keep scope tight, avoid guessing, verify every claim, and report deviations.

## Confirmed Mode

- Mode: `Clean Foundation Strict`（干净地基严格模式：旧的普通回复路径不能继续决定审批行为）.
- Canonical owner: `ApprovalRequest`（审批请求：回答哪一条事项正在等人类做生命周期决策） plus the approval request API endpoints own approve/reject/reply lifecycle actions.
- Frontend responsibility: render backend truth and call the canonical API. Frontend must not own lifecycle, approval status, permissions, session identity, or automatic CEO submission semantics.
- Current worktree when authored: `D:\HiveWard-run-room-stack-pr1`, branch `codex/run-room-pr22-frontend-ui-polish`, head `179dbb8`. The worktree already had unrelated modified files; do not revert them.

## User-Facing Target

Blueprint proposal inbox mail that requires approval must show explicit approval controls:

- approve: user accepts the blueprint proposal.
- reject: user rejects the blueprint proposal.
- reply/comment: user adds discussion text only; it must not approve, reject, close, import, resume, or mutate lifecycle.

The single `Send response` UI is valid only for non-decision mail. For `decision_required`（需要决策：用户必须通过绑定的审批请求做生命周期动作） inbox projections, `Send response` as the only action is wrong and must be deleted from the normal product path.

The current manual `Submit for approval` button in `ChatPage` is not the product source of truth for sending CEO blueprint proposals to the inbox. CEO automatic submission must be produced by the CEO skill / executive command contract; the frontend must not preserve a manual-send fallback as if it were the normal workflow.

## Code Evidence

- `packages/shared/src/runRoom.ts:81-94` defines `responseIntent`（响应意图：回答这个人类动作请求需要哪类用户动作；allowed values are `decision_required`, `reply_required`, `review_required`） and optional `approvalRequestId`（审批请求 ID：回答哪条 `ApprovalRequest` owns this decision） on `HumanActionRequest` / `InboxProjection`.
- `packages/shared/src/runRoom.ts:203-229` validates that `decision_required` must have `approvalRequestId`, and non-decision intents must not have it. This proves the backend contract already separates decision mail from reply mail.
- `apps/api/src/routes/apiRouter.ts:842-884` exposes canonical approval lifecycle endpoints: `/api/approval-requests/:approvalRequestId/approve`, `/reject`, `/reply`, `/return-for-revision`, `/complete`, `/terminate`.
- `apps/api/src/routes/apiRouter.ts:1819-1851` rejects direct `request_human_action` commands with `responseIntent: "decision_required"`. This proves agents cannot create decision mail directly without an approval request.
- `apps/api/src/routes/apiRouter.ts:1853-1900` creates blueprint proposal approvals through `submit_blueprint_proposal`; it creates an `ApprovalRequest` and a bound `HumanActionRequest` with `responseIntent: "decision_required"` and `approvalRequestId`.
- `apps/api/src/store/fileHivewardStore.ts:1421-1479` projects pending approvals only when `request.runId` is a string. This explains why no-run CEO blueprint proposal approvals can be absent from the existing `approvals` list even though a decision inbox projection exists.
- `apps/api/src/store/fileHivewardStore.ts:1566-1601` and `apps/api/src/store/fileHivewardStore.ts:2818-2849` close bound pending decision human-action requests only when an approval decision is recorded. This proves the lifecycle close owner is the approval path, not text response.
- `apps/api/src/store/sqlite/sqliteHivewardStore.ts:955-974` marks only `reply_required` / `review_required` human actions as responded on text response. `decision_required` remains pending.
- `apps/api/src/routes/apiRouter.test.ts:4460-4535` verifies a text response to `decision_required` leaves the human action pending, and approval closes it.
- `apps/web/src/components/WorkspacePages.tsx:1328-1542` builds the inbox page and currently computes `totalEntries = approvals.length + inboxProjections.length`, which can double-count approval-backed projections.
- `apps/web/src/components/WorkspacePages.tsx:1617-1709` renders `ApprovalRequestDetail` with approval lifecycle buttons.
- `apps/web/src/components/WorkspacePages.tsx:1711-1783` renders `HumanActionProjectionDetail` with only textarea plus `Send response`; it has no decision branch.
- `apps/web/src/components/WorkspacePages.tsx:1824-1889` maps every `InboxProjection` to the same projection entry shape, regardless of `responseIntent` or `approvalRequestId`.
- `apps/web/src/components/ChatPage.tsx:867-897`, `1118-1195`, and `1965-1972` expose a manual `submitBlueprintProposal` path when message content looks like a blueprint proposal. This is a frontend fallback surface, not the CEO automatic source of truth.
- `docs/skills/hiveward-ceo/SKILL.md:87-96` and `docs/skills/hiveward-leader/SKILL.md:88-97` still describe old fenced `hiveward-inbox` output. This is skill-layer evidence only; do not fix it in this frontend PR.

## Evidence, Inference, Unknowns

- Verified fact: backend approval endpoints already exist, and store tests prove `decision_required` cannot be closed by ordinary text response.
- Verified fact: frontend currently has the approval button component and the response-only projection component, but it does not route `decision_required` projections to approval controls.
- Verified fact: no-run blueprint proposal approvals can be omitted from the current pending approvals projection because `listPendingApprovals` filters on `request.runId`.
- Inference: the frontend can fix the visible single-button bug by treating `InboxProjection.approvalRequestId` as a pointer to a canonical `ApprovalRequest`, then rendering approval controls only when that request is available and pending.
- Unknown until implementation: whether the current app state already fetches all `ApprovalRequest` facts through `api.listApprovalRequests()` in the relevant workspace hydration path. If not, add that fetch in the frontend layer only; do not add backend compatibility routes in this PR.
- Unknown until skill PR: whether CEO automatic blueprint submission is already installed in the deployed skill package. Frontend must not claim the manual button is the source of truth.

## Coverage Inventory

- `responseIntent`（响应意图：allowed `decision_required`, `reply_required`, `review_required`; created by backend services, stored on `HumanActionRequest`, projected to `InboxProjection`, consumed by frontend only to choose UI shape; it must not by itself decide lifecycle or permissions）.
- `approvalRequestId`（审批请求 ID：allowed non-empty string only for `decision_required`; created by approval/human-action services, stored in the store, consumed by frontend to find/call `ApprovalRequest`; it permits approval API calls only when matching request is pending; it forbids text-response lifecycle mutation）.
- `status`（状态：for `HumanActionRequest`, allowed `pending`, `responded`, `closed`, `cancelled`; created and updated by store/services, projected to UI, consumed for filtering; decision status must be closed by approval decisions only）.
- `capabilities`（能力：approval request booleans such as `approve`, `reject`, `reply`, `returnForRevision`, `complete`, `terminate`; created by backend approval service, consumed by UI to show/hide buttons; frontend must not derive capabilities from `kind`, title, label, or `responseIntent`）.
- `kind`（审批种类：for `ApprovalRequest`, describes product category such as blueprint proposal; it is display/category context only and must not replace capabilities or lifecycle status decisions）.
- APIs consumed by frontend: `GET /api/approval-requests`, `POST /api/approval-requests/:approvalRequestId/approve`, `POST /api/approval-requests/:approvalRequestId/reject`, `POST /api/approval-requests/:approvalRequestId/reply`, plus existing inbox projection reads.
- Persistence owner: API store implementations; no frontend persistence.
- Frontend state: add or reuse an `approvalRequestsById` map keyed by `approvalRequestId`; use it for decision projection rendering and deduplication.
- UI controls: `decision_required` gets approval controls; `reply_required` / `review_required` keep response controls.
- Lifecycle transitions: approve/reject/return/complete/terminate go through approval request endpoints; text reply appends discussion only.
- Legacy paths to delete/forbid in frontend: response-only detail for decision projections, manual-send-as-normal-CEO-submission, projection counting that double-counts the same approval-backed item.

## PR Construction Sheet

### Exact Base And Branch

- Base: `codex/run-room-pr22-frontend-ui-polish` at `179dbb8`.
- Implementation branch: `codex/run-room-pr23-decision-inbox-frontend`.
- If base head changed, first re-run the Code Evidence inspection and update this document before coding.
- If the worktree contains unrelated user changes, preserve them and keep this PR diff scoped to the allowed files below.

### Exact Scope

Implement frontend projection behavior for approval-backed inbox items:

1. Render `decision_required` inbox projections with approval controls tied to `ApprovalRequest`.
2. Keep `reply_required` and `review_required` projections on the existing send-response path.
3. Deduplicate a pending approval and its matching inbox projection by `approvalRequestId`.
4. Ensure approval actions refresh both approval request state and inbox projections.
5. Delete the normal manual `Submit for approval` product surface only when the skill-layer automatic `submit_blueprint_proposal` contract is already present on the base branch. If that contract is not present, stop and report the dependency; do not preserve the manual button as a compatibility fallback.

### Allowed Files And Modules

- `apps/web/src/App.tsx`: frontend hydration/state wiring only.
- `apps/web/src/lib/api.ts`: frontend API client typing/wiring only if existing methods do not expose `listApprovalRequests`.
- `apps/web/src/components/WorkspacePages.tsx`: inbox entry model, deduplication, detail rendering, button routing.
- `apps/web/src/components/WorkspacePages.test.tsx`: frontend behavior tests.
- `apps/web/src/components/ChatPage.tsx`: remove or gate the manual submit surface only if the skill-layer automatic contract is already available on the base branch.
- `apps/web/src/styles.css`: minimal styles for any new unavailable/blocked state; do not restyle unrelated UI.

### Forbidden Files And Modules

- Do not edit backend routes, stores, migrations, worker services, shared schema, or approval services in this frontend PR.
- Do not edit `docs/skills/hiveward-ceo/SKILL.md` or `docs/skills/hiveward-leader/SKILL.md` in this frontend PR. Skill cleanup belongs to a separate skill construction sheet.
- Do not add dependencies.
- Do not introduce local storage, browser-only lifecycle state, or UI-owned approval status.

### Required Frontend Contract

Create an explicit frontend view model for inbox entries. The exact names may follow local style, but the responsibilities must be:

- Approval entry: sourced from canonical `PendingApprovalItem` / `ApprovalRequest`; shows approval controls.
- Decision projection entry: sourced from `InboxProjection` with `responseIntent: "decision_required"` and `approvalRequestId`; must resolve its `ApprovalRequest` before rendering lifecycle controls.
- Response projection entry: sourced from `InboxProjection` with `responseIntent: "reply_required"` or `review_required`; shows send-response controls.
- Unavailable decision projection: `decision_required` with missing, non-pending, or unresolved `ApprovalRequest`; shows a blocked/unavailable state and no normal action buttons.

The UI must never call `onSendHumanActionResponse` for `decision_required`.

### Old Paths To Delete Or Forbid

- Delete: response-only normal detail path for `decision_required` inbox projections.
- Delete: double-counting `totalEntries = approvals.length + inboxProjections.length` when the same `approvalRequestId` appears in both sources.
- Forbid: deriving approval buttons from title text, body text, `kind`, `responseIntent` alone, graph position, or CSS class.
- Forbid: falling back from missing `ApprovalRequest` to normal `Send response`.
- Forbid: treating the manual `ChatPage.submitBlueprintProposal` button as the CEO automatic send path.
- Later PR2: delete/update old skill references to fenced `hiveward-inbox` and make CEO/Leader skills use structured `submit_blueprint_proposal`. Until PR2 lands, frontend must not add new reads or product behavior depending on the old skill block.

### APIs To Add, Change, Or Delete

- Add no backend API.
- Prefer existing `api.listApprovalRequests()` if available.
- Use existing approval action APIs for approve/reject/reply/return/complete/terminate.
- Delete no backend route.
- Delete no shared schema field.

### Implementation Order

1. Add or expose frontend state for current `ApprovalRequest` facts and create `approvalRequestsById`.
2. Replace `buildHumanActionInboxEntries` with a typed builder that branches on `responseIntent` and `approvalRequestId`.
3. Deduplicate approval-backed entries by `approvalRequestId`.
4. Render decision projections through approval controls, reusing `ApprovalRequestDetail` behavior where practical without making `InboxProjection` the lifecycle owner.
5. Add unavailable decision projection UI for unresolved approval references.
6. Ensure approve/reject/reply callbacks refresh approval requests and inbox projections.
7. Add tests before deleting old behavior.
8. If and only if skill automatic submission is present on base, delete the normal manual submit product surface from `ChatPage`.

### Positive Tests

- A `decision_required` `InboxProjection` with `approvalRequestId` and matching pending `ApprovalRequest` renders approve and reject controls.
- Clicking approve calls the approval request approve callback with `approvalRequestId`.
- Clicking reject calls the approval request reject callback with `approvalRequestId`.
- Reply/comment on an approval-backed item calls the approval request reply callback and does not close lifecycle.
- A `reply_required` projection renders `Send response` and calls `onSendHumanActionResponse`.
- A `review_required` projection keeps response behavior.
- A canonical pending approval without an inbox projection still renders as before.

### Negative Tests

- `decision_required` with matching approval does not render `Send response`.
- `decision_required` never calls `onSendHumanActionResponse`.
- `decision_required` with missing/unresolved `ApprovalRequest` renders no approve, reject, or send-response button.
- Duplicate approval plus projection for the same `approvalRequestId` renders one normal actionable row, not two.
- `capabilities.approve === false` hides or disables approve even when `responseIntent` is `decision_required`.
- `capabilities.reject === false` hides or disables reject even when `responseIntent` is `decision_required`.
- If the manual `ChatPage` submit surface is removed, tests prove the user-visible manual button cannot appear as a normal action.

### Source Gates

Run and inspect:

```bash
git grep -n "onSendHumanActionResponse" -- apps/web/src/components/WorkspacePages.tsx
git grep -n "responseIntent.*decision_required" -- apps/web/src/components/WorkspacePages.tsx apps/web/src/components/WorkspacePages.test.tsx
git grep -n "submitBlueprintProposal\\|Submit for approval" -- apps/web/src/components/ChatPage.tsx apps/web/src/components/ChatPage.test.tsx
```

Source gates prove source shape only; they do not replace behavior tests.

### Behavior Gates

Run:

```bash
npm test -- apps/web/src/components/WorkspacePages.test.tsx
npm run typecheck -w @hiveward/web
```

If `ChatPage` manual submit is touched, also run the relevant `ChatPage` test file. If no `ChatPage` test exists, add focused tests or report the exact coverage gap.

### Mechanical Acceptance Checklist

- `decision_required` action path uses `approvalRequestId`.
- Approval buttons use `ApprovalRequest.capabilities`.
- Text reply cannot close, approve, reject, resume, import, or terminate a decision request.
- Missing approval owner is visible as blocked/unavailable, not silently downgraded to response-only UI.
- Entry count equals rendered unique entries.
- Dirty worktree files not in this scope are untouched.
- No backend or skill files changed in this frontend PR.

### Failure Conditions

Stop and report if any condition is true:

- No frontend-accessible way exists to fetch the required `ApprovalRequest`.
- A required approval action endpoint is missing.
- The implementation requires backend schema or store changes.
- Skill automatic blueprint submission is not present but the task requires deleting the manual `ChatPage` submit surface in the same PR.
- Existing dirty worktree changes conflict with the allowed files and cannot be separated safely.

## Completion Report Requirements

The implementer must return the repository-required completion report with changed files, verification commands and results, remaining risks, `Change classification`, and `用人话翻译`. For this PR, classify deterministic UI, API-client wiring, and tests under `Program-level`; classify skill or prompt changes as `Prompt-level` only if a separate skill PR is actually touched.
