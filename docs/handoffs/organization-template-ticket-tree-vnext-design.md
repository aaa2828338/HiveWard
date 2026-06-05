# Organization Template And Ticket Tree vNext Design

## Status

- Date: 2026-06-05
- Branch when authored: `wip/run-room-mvp-internal-alpha-snapshot`
- Design status: draft for product/engineering review
- Change class: program-level design

## Core Sentence

Organization structure is the template. Task execution is the instance.

HiveWard should stop treating a multi-layer flowchart as the main execution model. The main model should be a reusable organization template that can be started repeatedly. Each start creates one isolated organization run, with its own run seats and its own ticket tree.

## Decision

Build a new primary execution system:

- Template layer defines the reusable organization and role seats.
- Run layer snapshots that organization for one user request.
- Ticket tree is the unified dispatch, execution, review, rework, and reporting system inside the run.
- Assignment is strictly adjacent by hierarchy.
- Existing `BlueprintRun`, `RunRoom`, `WorkerTask`, `HumanActionRequest`, and inbox projection models are not the new normal execution path.

This is a hard product direction, not a compatibility patch.

## Clean Removal Mode

This design uses Clean Removal Mode.

There are only two classifications for existing system parts:

1. Keep because the new organization/ticket system truly needs the capability.
2. Delete because the old part belongs to the previous blueprint/run-room execution model.

Do not keep old APIs, old UI paths, old shared types, old store methods, old route facades, or old projections "for compatibility." If an old implementation detail is useful, move the useful idea into a new organization/ticket module with new names and new invariants. Do not preserve old names as a fallback.

Temporary coexistence while a multi-PR implementation is in progress is allowed only as local construction scaffolding. It is not a shipped product state and must have an explicit deletion gate.

## Existing System Diagnosis

Current code has adjacent pieces but not this architecture:

- `CompanyRoleKind` currently supports only `ceo` and `leader`.
- `BlueprintDefinition` mixes organization shape, executable process graph, runtime configuration, canvas layout, and node semantics.
- `BlueprintRun` and `BlueprintNodeRun` represent one execution of a blueprint DAG, not one instantiation of an organization.
- `RunRoom`, `ManagerCommand`, and `WorkerTask` are close to run-time dispatch concepts, but they are partial and Manager-centered rather than the universal ticket system.
- Approval and inbox models are separate governance surfaces. They should not remain the primary way to represent work dispatch.

The new system should reuse lessons from these models, but should not preserve them as the normal product path.

## Goals

1. Represent an AI organization as a reusable template.
2. Allow the same organization template to start multiple concurrent runs.
3. Give each run its own copied seat instances and ticket tree.
4. Make CEO, Leader, Manager, and Worker responsibilities explicit.
5. Enforce strict adjacent assignment in backend services.
6. Use tickets as the unified work object for dispatch, progress, result submission, review, rework, and final reporting.
7. Keep runtime sessions attached to run seats and ticket activity instead of blueprint nodes.
8. Make the UI explain the actual organization chain instead of exposing a generic flowchart as the primary mental model.
9. Allow a Leader to deliver the final answer directly to the user when the CEO delegates user-facing delivery to that Leader.
10. Keep execution quality review at the Manager level; Leader and CEO are routing/delivery roles, not universal inspection gates.

## Non-Goals

- Do not keep `BlueprintRun` as the main execution model.
- Do not keep `RunRoom` as the main execution room model.
- Do not keep `WorkerTask` as the canonical worker assignment model.
- Do not let UI-only validation enforce hierarchy rules.
- Do not allow cross-level assignment.
- Do not implement arbitrary matrix organizations in the first version.
- Do not migrate all old historical runs in the first version.
- Do not make a visual DAG builder the primary authoring model for this workflow.
- Do not keep any old system object only to provide compatibility.
- Do not make Leader or CEO mandatory quality-review gates for every run.

## Organization Shape

The first supported organization shape is a tree:

```text
CEO
└─ Leader
   └─ Manager
      ├─ Worker
      ├─ Worker
      └─ Worker
```

Rules:

- An organization template has exactly one CEO.
- A CEO can have one or more direct Leaders.
- Each Leader owns exactly one team.
- Each Leader has exactly one direct Manager in v1.
- A Manager can have one or more direct Workers.
- Workers have no direct reports.

If a future product needs a Leader with multiple Managers, model that as multiple Leader-owned teams first, not as a silent widening of v1.

## Responsibility Model

### CEO

- Receives the user's request.
- Chooses the relevant Leader.
- Creates a ticket for that Leader.
- Decides whether the Leader should report back to CEO or answer the user directly.
- Responds to the user only when the run delivery mode keeps CEO as final responder.

CEO must not assign work to Managers or Workers.

### Leader

- Receives CEO direction.
- Understands the upper-level goal.
- Gives direction to the Manager.
- Receives the Manager's answer.
- Reports the answer either to CEO or directly to the user, depending on the run delivery mode.

Leader must not assign work directly to Workers.
Leader is not the execution quality gate in v1. If the Manager's answer is structurally wrong, that is a Manager failure or a new task, not a normal Leader review loop.

### Manager

- Receives Leader direction.
- Breaks work into concrete tasks.
- Assigns Worker tickets.
- Checks Worker output.
- Requests rework when needed.
- Aggregates results.
- Returns the result to Leader.

Manager is the only role that assigns work to Workers.
Manager is the execution quality owner in v1.

### Worker

- Receives Manager-assigned tickets.
- Executes concrete work.
- Writes progress and result events.
- Reports blockers to Manager.

Worker cannot assign tickets.

## Assignment Law

Ticket assignment must be enforced by backend code as a product invariant.

Allowed assignment:

```text
system/user -> CEO, only for the root ticket created when the run starts
CEO -> direct Leader
Leader -> direct Manager
Manager -> direct Worker
```

Forbidden assignment:

```text
CEO -> Manager
CEO -> Worker
Leader -> Worker
Manager -> Leader
Worker -> anyone
any seat -> non-direct report
any seat -> seat from another organization_run
```

Worker-to-Manager communication is not assignment. It is a `ticket_event`, such as `blocked`, `question`, `progress`, or `result_submitted`, on the ticket the Worker already owns.

## Delivery Law

Assignment hierarchy and user-facing delivery are separate.

Assignment hierarchy stays strict:

```text
CEO -> Leader -> Manager -> Worker
```

User-facing delivery may end at CEO or Leader:

```text
ceo_final: Worker -> Manager -> Leader -> CEO -> user
leader_direct: Worker -> Manager -> Leader -> user
```

Rules:

- Manager never reports directly to user.
- Worker never reports directly to user.
- Leader may report directly to user only when `organization_run.delivery_mode === "leader_direct"`.
- CEO may still be the final responder when `organization_run.delivery_mode === "ceo_final"`.
- The final response is a lifecycle event, not a chat message: it must be written as `user_response_submitted` by `organization_run.final_response_run_seat_id`.

## Data Model

### `organization_template`

Reusable organization definition.

```text
id
company_id
name
description
version
status: draft / published / archived
created_at
updated_at
published_at
archived_at
```

Engineering rules:

- Published templates are immutable for run creation.
- Editing a published template creates a new version.
- Runs always reference the template version they started from.

### `seat_template`

Reusable role seat inside a template.

```text
id
organization_template_id
role: ceo / leader / manager / worker
name
reports_to_seat_template_id
capability_description
default_runtime
default_model
default_prompt
created_at
updated_at
```

Engineering rules:

- `reports_to_seat_template_id` is null only for CEO.
- Role hierarchy must match the assignment law.
- The template validator rejects cycles.
- The template validator rejects orphan seats.
- The template validator rejects a Leader without exactly one Manager.
- The template validator rejects a Manager without at least one Worker.

### `organization_run`

One execution instance started from a template.

```text
id
organization_template_id
organization_template_version
company_id
user_request
delivery_mode: ceo_final / leader_direct
final_response_run_seat_id
status: queued / running / waiting_user / succeeded / failed / cancelled
created_by
created_at
started_at
ended_at
failure_reason
```

Engineering rules:

- A run owns all tickets created during that run.
- A run cannot use seats from another run.
- A run should remain stable even if the template is edited later.
- `delivery_mode` decides who publishes the final user-facing answer.
- `ceo_final` means the selected Leader reports to CEO, then CEO answers the user.
- `leader_direct` means CEO delegates user-facing delivery to the selected Leader, and the Leader may close the run by answering the user directly.
- `final_response_run_seat_id` must be CEO for `ceo_final` and the selected Leader for `leader_direct`.

### `run_seat`

Seat instance copied into one run.

```text
id
organization_run_id
seat_template_id
role
name
reports_to_run_seat_id
runtime_session_id
status: idle / working / waiting / blocked / done / failed
capability_snapshot
runtime_snapshot
prompt_snapshot
created_at
updated_at
```

Engineering rules:

- `reports_to_run_seat_id` copies the template hierarchy into the run.
- Runtime and prompt settings are snapshots, not live reads from the template.
- A run seat is the actor identity for ticket creation and ticket events.

### `ticket`

Canonical work object inside an organization run.

```text
id
organization_run_id
parent_ticket_id
creator_run_seat_id
assignee_run_seat_id
title
body
delivery_target: parent / user
user_visible: boolean
status: open / in_progress / blocked / submitted / accepted / rework_requested / cancelled / failed
created_at
updated_at
closed_at
```

Engineering rules:

- Root ticket is created by the platform and assigned to CEO.
- Non-root ticket must have a parent ticket.
- For non-root tickets, `creator_run_seat_id` must be the assignee of the parent ticket.
- For non-root tickets, `assignee_run_seat_id` must be a direct report of `creator_run_seat_id`.
- `delivery_target: user` is allowed only on a CEO-created ticket assigned to a direct Leader when the run uses `leader_direct`.
- `user_visible: true` means this ticket's final submitted answer may be shown to the user.
- A Manager parent ticket cannot be accepted until all blocking Worker child tickets are accepted, cancelled, or failed with an explicit override.
- CEO and Leader parent tickets do not perform execution-quality acceptance in v1; they receive or publish the downstream answer.
- Ticket status is changed only through `ticket_event` plus deterministic service logic.

### `ticket_event`

Append-only activity, communication, state transition, and output log for a ticket.

```text
id
ticket_id
organization_run_id
actor_run_seat_id
type
body
metadata_json
created_at
```

Allowed event types:

```text
created
assigned
started
progress
comment
blocked
question
child_ticket_created
result_submitted
user_response_submitted
accepted
rework_requested
cancelled
failed
closed
runtime_started
runtime_delta
runtime_completed
runtime_failed
```

Engineering rules:

- Events are append-only.
- Events are the audit log.
- Status transitions are derived from valid events.
- Runtime streaming output is attached to ticket events or ticket output projections, not to blueprint node rows.

## State Machine

Ticket state transitions:

```text
open -> in_progress
in_progress -> blocked
blocked -> in_progress
in_progress -> submitted
submitted -> accepted
submitted -> rework_requested
rework_requested -> in_progress
open/in_progress/blocked/submitted/rework_requested -> cancelled
open/in_progress/blocked/submitted/rework_requested -> failed
accepted -> closed
```

Rules:

- Assignee can start, comment, report blocker, and submit result.
- The Manager creator can accept Worker results, request Worker rework, cancel Worker tickets, or mark Worker tickets failed.
- CEO and Leader can cancel or fail their own child ticket when direction is abandoned, but they do not use `accepted` / `rework_requested` as a normal quality-review loop in v1.
- Manager can create Worker child tickets only while working on a Manager-assigned ticket.
- Leader can create Manager child tickets only while working on a Leader-assigned ticket.
- CEO can create Leader child tickets only while working on the root ticket.
- Worker cannot create child tickets.
- User-facing completion is represented by `user_response_submitted` on the run's final response ticket.

## Run Lifecycle

Starting a run:

1. User submits request.
2. Platform validates selected published organization template.
3. Platform creates `organization_run`.
4. Platform snapshots every `seat_template` into `run_seat`.
5. Platform creates root `ticket` assigned to CEO.
6. Platform opens or resumes CEO runtime session for that run seat.
7. CEO handles the root ticket, chooses a direct Leader, chooses `ceo_final` or `leader_direct`, and delegates downward through tickets.

Completing a run:

1. Worker submits concrete results to Manager.
2. Manager accepts or requests rework.
3. Manager submits aggregate result to Leader.
4. Leader takes the Manager answer as the team answer.
5. If the run is `leader_direct`, Leader submits the user-facing answer and the platform closes the run.
6. If the run is `ceo_final`, Leader submits the answer to CEO, CEO submits the user-facing answer, and the platform closes the run.

Leader does not perform a normal inspection/rework step. CEO does not perform a mandatory inspection/rework step. If either wants a materially different direction, that is a new child ticket or a new organization run, not compatibility with the old approval/revision loop.

Failure and cancellation:

- Any seat can report a blocker on its own ticket.
- Creator can cancel or fail a child ticket when the task is no longer valid.
- Cancelling a parent ticket cascades cancellation to open child tickets.
- Failing a required Worker ticket blocks Manager submission unless Manager records an explicit override event.

## Service Boundaries

### `OrganizationTemplateService`

Owns:

- create draft template
- validate template hierarchy
- publish template
- archive template
- create new template version

Must enforce:

- one CEO
- valid hierarchy
- no cycles
- Leader has exactly one Manager in v1
- Manager has at least one Worker
- Worker has no children

### `OrganizationRunService`

Owns:

- start run from template
- snapshot seats
- create root ticket
- set delivery mode and final response run seat
- update run status
- close run after the final response ticket submits `user_response_submitted`

Must enforce:

- run isolation
- template version stability
- root ticket assignment to CEO
- final responder is CEO for `ceo_final`
- final responder is the delegated Leader for `leader_direct`

### `TicketService`

Owns:

- create child ticket
- add ticket event
- transition ticket status
- validate creator and assignee
- derive ticket tree projections

Must enforce:

- adjacent assignment
- parent ownership
- same-run actor checks
- Worker cannot create child tickets
- Leader cannot create Worker tickets
- CEO cannot create Manager or Worker tickets
- `delivery_target: user` only on valid delegated Leader tickets
- `accepted` / `rework_requested` normal loop only for Manager-owned review of Worker tickets in v1
- no UI bypass

### `RuntimeSeatService`

Owns:

- creating or resuming runtime sessions for run seats
- building role-specific prompt context
- attaching runtime output to ticket events
- storing runtime refs on `run_seat`

Must not:

- choose assignment targets without going through `TicketService`
- write final ticket status directly
- skip hierarchy checks

## API Surface

Template APIs:

```text
GET    /api/organization-templates
POST   /api/organization-templates
GET    /api/organization-templates/:templateId
POST   /api/organization-templates/:templateId/publish
POST   /api/organization-templates/:templateId/archive
POST   /api/organization-templates/:templateId/new-version
```

Run APIs:

```text
POST   /api/organization-runs
GET    /api/organization-runs
GET    /api/organization-runs/:runId
POST   /api/organization-runs/:runId/cancel
```

Ticket APIs:

```text
GET    /api/organization-runs/:runId/tickets
GET    /api/tickets/:ticketId
POST   /api/tickets/:ticketId/children
POST   /api/tickets/:ticketId/events/comment
POST   /api/tickets/:ticketId/events/start
POST   /api/tickets/:ticketId/events/block
POST   /api/tickets/:ticketId/events/submit-result
POST   /api/tickets/:ticketId/events/submit-user-response
POST   /api/tickets/:ticketId/events/accept
POST   /api/tickets/:ticketId/events/request-rework
POST   /api/tickets/:ticketId/events/cancel
POST   /api/tickets/:ticketId/events/fail
```

Initial APIs may accept `actorRunSeatId` in the request body because the current app does not yet have complete role-seat authentication. The server must still validate that the actor is allowed to perform the action. Later auth work can replace body-provided actor ids with session-derived actor ids.

## UI Model

The primary run UI should show:

- organization run header
- current status
- organization seat tree
- ticket tree
- selected ticket detail
- ticket events
- result/rework controls appropriate to the actor
- user-response control only for the run's `final_response_run_seat_id`
- runtime output attached to the selected ticket

The UI should not present the old blueprint canvas as the main execution screen for new runs.

Minimum user-facing screens:

1. Organization Template list.
2. Organization Template detail with seat tree.
3. Start Organization Run form.
4. Organization Run detail with ticket tree.
5. Seat-scoped work queue for the selected actor.

## Default Seed Template

The first seed template should be:

```text
AI Product Team
CEO
└─ Product Team Leader
   └─ Product Execution Manager
      ├─ Research Worker
      ├─ Writing Worker
      └─ Development Worker
```

This seed gives the product a concrete first-run path without requiring a full template editor before the system can be tested.

## Runtime Prompt Contract

Each run seat receives:

- organization run id
- seat identity
- direct parent and direct children
- assigned ticket
- parent ticket context
- relevant child ticket summaries
- allowed actions
- forbidden actions

The prompt must say the same law as the backend:

- CEO can only assign to direct Leaders.
- Leader can only assign to its direct Manager.
- Manager can only assign to direct Workers.
- Worker cannot assign tickets.
- Leader does not inspect Worker output and does not manage Worker rework.
- Manager is responsible for Worker result review and rework.
- If `delivery_mode` is `leader_direct`, Leader may answer the user directly after receiving Manager's answer.
- A reply, comment, or report does not change lifecycle unless submitted through a real ticket action.

The backend remains the source of truth. Prompt rules are a guidance layer, not enforcement.

## Clean Replacement Plan

The replacement must be a product cutover, not an adapter layer.

Rules:

- New execution starts only through `OrganizationRun`.
- New work dispatch exists only as `ticket`.
- New runtime output attaches to `ticket_event` or ticket output projections.
- New user-facing delivery exists only as `user_response_submitted` on the final response ticket.
- Old endpoints must not return new organization/ticket data.
- New endpoints must not read old blueprint/run-room data.
- Old UI screens must not be hidden behind feature flags as compatibility paths.
- Old shared types must not be imported by new organization/ticket modules.

## Keep Or Delete Inventory

### Keep

Keep only the parts that the new system truly needs:

| Existing area | Keep reason | Required change |
| --- | --- | --- |
| `CompanyProfile` / company workspace | Organization templates still need company scope. | Keep as tenant/workspace owner. |
| Runtime ids, runtime refs, runtime usage facts, runtime access policy | Run seats still need to launch Codex, Claude, OpenClaw, Hermes, and other harnesses. | Move usage to `run_seat` and `ticket_event`; do not keep blueprint-node coupling. |
| Harness/model configuration stores | Seat templates need default runtime/model bindings. | Reuse configuration lookup, but bind it to `seat_template` defaults and `run_seat` snapshots. |
| SQLite driver, file helpers, store test infrastructure | New tables need durable persistence and tests. | Add organization/ticket tables; remove old execution store methods after cutover. |
| Artifact service | Worker and Manager outputs may still publish files or links. | Attach artifacts to tickets or ticket events. |
| Markdown rendering and generic message display components | Ticket bodies and events are Markdown. | Reuse as presentation components, not as chat/run-room lifecycle owners. |
| Generic API server/app scaffolding | New routes live in the same API app. | Replace old route groups with organization/ticket route groups. |

### Delete

Delete these from the normal product system because they belong to the old execution architecture:

| Existing area | Delete reason | Replacement |
| --- | --- | --- |
| `BlueprintDefinition` as execution source | It mixes org chart, process graph, runtime config, and canvas layout. | `organization_template` plus `seat_template`. |
| `BlueprintRun`, `BlueprintNodeRun`, `RunCommand`, `RunCommandStep` | They represent DAG execution, not organization instances. | `organization_run`, `run_seat`, `ticket`, `ticket_event`. |
| `BlueprintStudioPage`, blueprint canvas edit state, blueprint canvas run state | Primary authoring/execution is no longer a flowchart. | Organization template seat tree editor and run ticket tree. |
| `blueprintWorker` | It executes blueprint nodes and Manager slots. | Organization runtime worker that acts on assigned tickets for run seats. |
| `manager_slot`, Manager slot handles, slot lane execution | Manager now creates Worker tickets directly. | Manager-owned child tickets and parallel Worker tickets. |
| `RunRoom`, `RunInterjection`, RunRoom output endpoints, RunRoom output UI/state | Run room is the old runtime container. | Organization Run detail and ticket events. |
| `ManagerCommand` | Manager dispatch is no longer a separate command model. | `ticket` child creation by Manager. |
| `WorkerTask` | Worker assignment is no longer a separate task model. | Worker-assigned `ticket`. |
| `HumanActionRequest`, `InboxProjection`, `ManagerMail` as work/governance surface | Human-visible work should be in the ticket tree, not a parallel inbox model. | Ticket assigned to a human/governance seat or `ticket_event` for user decision, when that feature is added. |
| `ApprovalThread`, `ApprovalRequest`, `ApprovalDecision`, `ApprovalReply` as separate lifecycle facts | Approval cannot remain a parallel lifecycle system if tickets are the unified work system. | Ticket decision events and human/governance tickets. |
| `BlueprintKanbanService` | It projects RunRoom/WorkerTask/HumanActionRequest cards. | Seat work queue and ticket board projections. |
| Role directory concepts limited to `ceo` and `leader` | New seat model includes CEO, Leader, Manager, Worker. | `seat_template` and `run_seat`. |
| Architecture blueprint view | It is a CEO/Leader-only management view, not the executable org template. | Organization template tree. |

If an implementation tries to keep a deleted item, it must prove the item is genuinely required by the new organization/ticket model. Otherwise the source gate fails.

## Current System Connection Points

The clean cutover should connect to the current app only through kept infrastructure:

1. Keep company selection as the workspace scope.
2. Replace blueprint lists with organization template lists.
3. Replace blueprint detail/canvas with organization template detail.
4. Replace "start blueprint run" with "start organization run."
5. Replace run detail with organization run ticket tree.
6. Replace RunRoom output with ticket event output.
7. Replace inbox/approval navigation with seat work queues and ticket decision surfaces.
8. Replace CEO/Leader role directory with organization seats.
9. Keep harness configuration pages because seat templates need runtime defaults.
10. Keep artifact viewing, but attach artifacts to ticket events.

There must be no route where a user starts a new `BlueprintRun`, opens a new `RunRoom`, creates a new `WorkerTask`, or creates a new `HumanActionRequest` after the cutover.

## Persistence Strategy

Implement shared TypeScript contracts first, then both stores:

- SQLite is the durable primary store.
- File store can support local development and tests if still required by the repo.
- No old-run migration is required for the first implementation.
- New organization/ticket tables are the only execution tables used by the new product path.
- Old execution store methods must be deleted from shared/API contracts during cutover.
- Old persisted local data can be discarded or exported before cutover; it is not a runtime compatibility dependency.

Required SQLite tables:

```text
organization_templates
seat_templates
organization_runs
run_seats
tickets
ticket_events
```

Indexes:

```text
seat_templates(organization_template_id)
seat_templates(reports_to_seat_template_id)
organization_runs(organization_template_id, created_at)
run_seats(organization_run_id)
run_seats(seat_template_id)
tickets(organization_run_id)
tickets(parent_ticket_id)
tickets(creator_run_seat_id)
tickets(assignee_run_seat_id)
ticket_events(ticket_id, created_at)
ticket_events(organization_run_id, created_at)
```

Deletion gate:

- Remove store methods that create, update, or list `BlueprintRun`, `RunRoom`, `ManagerCommand`, `WorkerTask`, `HumanActionRequest`, and approval lifecycle facts from normal execution stores.
- Remove SQLite schema paths used only by old execution once the new store contract passes.
- Remove file-store fixtures that create old execution facts unless they belong to explicit migration/export tests.

## Projections

Backend should provide deterministic projections:

### Organization template tree

Input:

- organization template
- seat templates

Output:

- root CEO node
- nested Leader/Manager/Worker tree
- validation status

### Organization run view

Input:

- organization run
- run seats
- tickets
- ticket events

Output:

- run summary
- run seat tree
- ticket tree
- active tickets
- blocked tickets
- final result if closed

### Seat work queue

Input:

- run seat
- tickets assigned to that run seat

Output:

- tickets needing action
- Manager-owned submitted Worker tickets needing review
- blocker events needing response
- final user-response tickets assigned to the run's final responder

## Testing Requirements

Shared model tests:

- Template with one CEO, one Leader, one Manager, and Workers validates.
- Template with no CEO fails.
- Template with two CEOs fails.
- Template with Leader directly owning Worker fails.
- Template with CEO directly owning Manager fails.
- Template with Manager owning Manager fails.
- Template with cycle fails.

Ticket service tests:

- Starting run creates run seats and root CEO ticket.
- CEO can assign direct Leader.
- CEO cannot assign Manager.
- CEO cannot assign Worker.
- Leader can assign direct Manager.
- Leader cannot assign Worker.
- Manager can assign direct Worker.
- Manager cannot assign Leader.
- Worker cannot create child ticket.
- Seat cannot create ticket under a parent ticket it does not own.
- Seat cannot assign a run seat from another run.
- Manager parent ticket cannot be accepted while required Worker child tickets are open.
- Leader result handling does not expose normal accept/rework controls.
- CEO result handling does not expose mandatory accept/rework controls.
- `leader_direct` run can close through Leader `user_response_submitted`.
- `ceo_final` run can close through CEO `user_response_submitted`.
- Worker result submission changes ticket to `submitted`.
- Manager rework request on a Worker ticket changes ticket to `rework_requested`.
- Manager acceptance of a Worker ticket changes ticket to `accepted`.

API tests:

- Every ticket action validates actor permissions server-side.
- Missing or forged actor ids cannot bypass hierarchy.
- Cross-run ids are rejected.
- Invalid state transitions are rejected.
- Run detail returns ticket tree projection.

UI tests:

- Run detail shows organization tree and ticket tree.
- CEO view can create only Leader tickets.
- Leader view can create only Manager tickets.
- Manager view can create only Worker tickets.
- Worker view has no create-child-ticket action.
- Rework controls appear only for Manager review of Worker tickets.
- User response controls appear only for the final response run seat.

Source gates:

```bash
git grep -n "WorkerTask\\|ManagerCommand\\|RunRoom" -- apps packages docs
git grep -n "BlueprintRun" -- apps packages docs
git grep -n "organization_template\\|organization_run\\|ticket_event" -- apps packages docs
```

Expected final result: old execution names do not appear in normal product source. Any temporary construction reference must have a deletion ticket in the same implementation plan.

## Implementation Slices

### Slice 1: Contracts and validation

- Add shared organization and ticket contracts.
- Add template validation.
- Add ticket transition validation.
- Add tests for all hierarchy rules.

### Slice 2: Store and seed data

- Add SQLite tables.
- Add file-store support if required.
- Seed AI Product Team template.
- Add store contract tests.

### Slice 3: API

- Add template APIs.
- Add run start API.
- Add ticket tree APIs.
- Add ticket action APIs.
- Add API permission tests.

### Slice 4: Minimal UI

- Add Organization Templates view.
- Add Start Run action.
- Add Organization Run detail view.
- Add seat-scoped controls.
- Remove old Blueprint Studio and RunRoom entry points from the normal product surface.

### Slice 5: Runtime integration

- Bind runtime sessions to `run_seat`.
- Route runtime output into ticket events.
- Teach CEO/Leader/Manager/Worker prompts the new action law.
- Make runtime actions call ticket APIs.

### Slice 6: Old system deletion

- Remove old normal `BlueprintRun`, `RunRoom`, `WorkerTask`, `HumanActionRequest`, and approval product paths.
- Remove old routes, store methods, shared exports, UI state, tests, and docs that exist only for the old execution model.
- Update docs and screenshots.

## Open Product Questions

1. Should v1 allow multiple Leaders under one CEO, or should the first template have exactly one Leader?
2. Should user-facing delivery default to `leader_direct` or `ceo_final` when the user starts from CEO?
3. Should Worker runtime sessions be long-lived per `run_seat`, or fresh per ticket?
4. Should Manager be allowed to assign several Worker tickets in parallel by default?
5. Should a Worker be allowed to ask a question that pauses the parent Manager ticket, or only mark its own ticket blocked?
6. What exact role should represent the human user for future approval/decision tickets: a special user seat, a governance seat, or a ticket event actor outside the org tree?

## Recommended Defaults

- Allow multiple Leaders under CEO, but each Leader owns exactly one Manager.
- Default CEO-started runs to `leader_direct` after CEO chooses the Leader, because Leader is allowed to answer the user directly.
- Use one runtime session per `run_seat` per organization run.
- Allow Manager to create multiple parallel Worker tickets.
- Worker blocker pauses only the Worker ticket; Manager decides whether the Manager ticket is blocked.
- Represent future human approvals inside the ticket system, not as a separate approval lifecycle model.

## Acceptance Criteria

The design is accepted when:

- New runs are created from organization templates, not blueprint DAGs.
- Each run has isolated run seats.
- All work appears as a ticket tree under one organization run.
- Server-side code rejects all cross-level assignment.
- Worker cannot assign work.
- Final user output is submitted by `organization_run.final_response_run_seat_id`, which may be CEO or the delegated Leader.
- Old execution systems are not used by the normal new-run path.
- Old execution systems are deleted from normal source paths, not kept as compatibility routes.

## Plain-Language Summary

HiveWard should stop asking users to think in flowcharts first. Users should create or choose an organization, then start that organization on a task.

Every task run gets its own copy of the organization seats and its own ticket tree. CEO sends work to Leader. Leader sends work to Manager. Manager sends work to Workers. Workers report to Manager. Manager gives the answer to Leader. Leader can answer the user directly when CEO delegated delivery. No one skips levels. The ticket tree becomes the main execution record, delivery surface, and audit trail.
