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

## Non-Goals

- Do not keep `BlueprintRun` as the main execution model.
- Do not keep `RunRoom` as the main execution room model.
- Do not keep `WorkerTask` as the canonical worker assignment model.
- Do not let UI-only validation enforce hierarchy rules.
- Do not allow cross-level assignment.
- Do not implement arbitrary matrix organizations in the first version.
- Do not migrate all old historical runs in the first version.
- Do not make a visual DAG builder the primary authoring model for this workflow.

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
- Reviews the Leader's final report.
- Responds to the user.

CEO must not assign work to Managers or Workers.

### Leader

- Receives CEO direction.
- Understands the upper-level goal.
- Gives direction to the Manager.
- Monitors execution quality.
- Corrects drift.
- Reports progress, risks, and final result to CEO.

Leader must not assign work directly to Workers.

### Manager

- Receives Leader direction.
- Breaks work into concrete tasks.
- Assigns Worker tickets.
- Checks Worker output.
- Requests rework when needed.
- Aggregates results.
- Returns the result to Leader.

Manager is the only role that assigns work to Workers.

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
- A parent ticket cannot be accepted until all blocking child tickets are accepted, cancelled, or failed with an explicit override.
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
- Creator can accept, request rework, cancel, or mark failed.
- Manager can create Worker child tickets only while working on a Manager-assigned ticket.
- Leader can create Manager child tickets only while working on a Leader-assigned ticket.
- CEO can create Leader child tickets only while working on the root ticket.
- Worker cannot create child tickets.

## Run Lifecycle

Starting a run:

1. User submits request.
2. Platform validates selected published organization template.
3. Platform creates `organization_run`.
4. Platform snapshots every `seat_template` into `run_seat`.
5. Platform creates root `ticket` assigned to CEO.
6. Platform opens or resumes CEO runtime session for that run seat.
7. CEO handles the root ticket and delegates downward through tickets.

Completing a run:

1. Worker submits concrete results to Manager.
2. Manager accepts or requests rework.
3. Manager submits aggregate result to Leader.
4. Leader accepts or requests rework.
5. Leader submits final team report to CEO.
6. CEO accepts or requests rework.
7. CEO writes final answer to user.
8. Platform closes root ticket and marks `organization_run` succeeded.

Failure and cancellation:

- Any seat can report a blocker on its own ticket.
- Creator can cancel or fail a ticket.
- Cancelling a parent ticket cascades cancellation to open child tickets.
- Failing a required child ticket blocks parent acceptance unless creator records an explicit override event.

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
- update run status
- close run after root ticket closes

Must enforce:

- run isolation
- template version stability
- root ticket assignment to CEO

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
- A reply, comment, or report does not change lifecycle unless submitted through a real ticket action.

The backend remains the source of truth. Prompt rules are a guidance layer, not enforcement.

## Old System Replacement Plan

Normal product path:

- Replace `BlueprintRun` start with `OrganizationRun` start.
- Replace `RunRoom` screen with Organization Run ticket tree screen.
- Replace `WorkerTask` with `ticket`.
- Replace run output feed rows with ticket event projections.
- Replace Manager command dispatch with ticket child creation.

Historical path:

- Existing historical blueprint runs may remain readable in a legacy/history section during transition.
- They must not be used for new execution.
- No new feature should depend on old `RunRoom`, `WorkerTask`, or blueprint node run semantics.

Approval/inbox path:

- Existing approval threads can remain as legacy governance until ticket-based decision events exist.
- Future unified design should represent human approval as a ticket or ticket event addressed to the human governance actor.
- First implementation does not need to migrate approval storage.

## Persistence Strategy

Implement shared TypeScript contracts first, then both stores:

- SQLite is the durable primary store.
- File store can support local development and tests if still required by the repo.
- No old-run migration is required for the first implementation.
- New tables should be additive at first.
- Old tables can remain until legacy UI paths are removed.

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
- submitted child tickets needing review
- blocker events needing response

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
- Parent ticket cannot be accepted while required child tickets are open.
- Worker result submission changes ticket to `submitted`.
- Creator rework request changes ticket to `rework_requested`.
- Creator acceptance changes ticket to `accepted`.

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
- Rework and result controls appear only for valid actor/state combinations.

Source gates:

```bash
git grep -n "WorkerTask\\|ManagerCommand\\|RunRoom" -- apps packages docs
git grep -n "BlueprintRun" -- apps packages docs
git grep -n "organization_template\\|organization_run\\|ticket_event" -- apps packages docs
```

Old names may remain only in explicitly marked legacy/historical files while the replacement is in progress.

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
- Hide old run start path from the normal product surface.

### Slice 5: Runtime integration

- Bind runtime sessions to `run_seat`.
- Route runtime output into ticket events.
- Teach CEO/Leader/Manager/Worker prompts the new action law.
- Make runtime actions call ticket APIs.

### Slice 6: Legacy removal

- Remove old normal `BlueprintRun`, `RunRoom`, and `WorkerTask` product paths.
- Keep old history read-only only if needed.
- Update docs and screenshots.

## Open Product Questions

1. Should v1 allow multiple Leaders under one CEO, or should the first template have exactly one Leader?
2. Should human approval become a special `ticket` assigned to a user/governance actor, or remain a separate approval model until a later migration?
3. Should Worker runtime sessions be long-lived per `run_seat`, or fresh per ticket?
4. Should Manager be allowed to assign several Worker tickets in parallel by default?
5. Should a Worker be allowed to ask a question that pauses the parent Manager ticket, or only mark its own ticket blocked?

## Recommended Defaults

- Allow multiple Leaders under CEO, but each Leader owns exactly one Manager.
- Keep human approval separate for the first implementation, but design ticket events so approval can later move into the same tree.
- Use one runtime session per `run_seat` per organization run.
- Allow Manager to create multiple parallel Worker tickets.
- Worker blocker pauses only the Worker ticket; Manager decides whether the Manager ticket is blocked.

## Acceptance Criteria

The design is accepted when:

- New runs are created from organization templates, not blueprint DAGs.
- Each run has isolated run seats.
- All work appears as a ticket tree under one organization run.
- Server-side code rejects all cross-level assignment.
- Worker cannot assign work.
- CEO-to-user final output is derived from the closed root ticket.
- Old execution systems are not used by the normal new-run path.

## Plain-Language Summary

HiveWard should stop asking users to think in flowcharts first. Users should create or choose an organization, then start that organization on a task.

Every task run gets its own copy of the organization seats and its own ticket tree. CEO sends work to Leader. Leader sends work to Manager. Manager sends work to Workers. Workers report back up. No one skips levels. The ticket tree becomes the main execution record, review surface, and audit trail.
