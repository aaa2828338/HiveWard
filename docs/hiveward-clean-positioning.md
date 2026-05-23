# HiveWard Clean Positioning and Chat Execution Rules

## 1. Core Position

HiveWard is not an agent OS, not a unified brain, and not a replacement runtime for OpenClaw, Codex, or Claude Code.

HiveWard is a communication console, session cockpit, and shortcut dispatch layer for external harnesses.

```text
OpenClaw is OpenClaw.
Codex is Codex.
Claude Code is Claude Code.
HiveWard is HiveWard.
```

HiveWard does not pretend to be a higher-level assistant. It does not create a fake shared identity such as "HiveWard Assistant".

The rule is simple:

```text
Who answers is who the UI displays.
Who executes is who the UI attributes execution to.
HiveWard only wraps, routes, organizes, and displays.
```

## 2. Ownership Boundary

HiveWard owns:

- UI layout and interaction state.
- Harness connection entries.
- Session view shortcuts.
- Tags, notes, task cards, project grouping, and status display.
- Prompt templates and quick-send affordances.
- Runtime status surfaces and log entry points.
- Metadata saved around a harness session.
- HiveWard Skill / Tool APIs that external harnesses may call to update HiveWard UI or metadata.

The harness owns:

- Context.
- Reasoning.
- Execution.
- Native session lifecycle.
- Native tools and channels.
- Native model behavior.
- Native workspace/project context.
- Native transcript truth.

HiveWard must not own:

- OpenClaw conversation context.
- Codex project context.
- Claude Code context.
- A fake cross-harness memory.
- A platform system prompt that tries to override the harness.
- A unified reasoning layer across harnesses.
- The external runtime loop.

## 3. Chat Page Product Shape

The chat page should be understood as:

```text
Harness Session Console
```

It should not be understood as:

```text
HiveWard Assistant Chat
```

The chat page is a HiveWard view over native harness sessions. It can provide a polished chat UI, but the speaker, session, options, and execution identity all belong to the selected harness.

## 4. Control Option Rule

All left-side chat options are harness-owned options presented through HiveWard.

Examples:

- Harness
- Native session
- Agent
- Model
- Workspace / project
- Thinking effort
- Mode
- Runtime status
- Log entry

HiveWard is only the display and control wrapper. It should not invent behavior behind these options.

If a harness supports an option, HiveWard may show it as enabled.

If a harness does not support an option, HiveWard should disable it, hide it, or mark it unavailable. HiveWard must not pretend the option applies uniformly.

## 5. Session Model

The clean relationship is:

```text
HiveWard Session View
        maps to
OpenClaw / Codex / Claude Code native session
```

The native harness session is the real context source.

HiveWard Session View is only:

- UI shell.
- Shortcut.
- Label/tag container.
- Project/task grouping surface.
- Metadata wrapper.
- Native session binding.

Correct model:

```text
Harness Session = real context
HiveWard Session View = UI wrapper + metadata + shortcuts
```

Incorrect model:

```text
HiveWard Session = independent AI context
Harness Session = executor controlled by HiveWard
```

The incorrect model creates identity confusion, context pollution, and runtime boundary problems.

## 6. New Session Behavior

"New session" in HiveWard should mean "create a new session view / shortcut".

It may initially be unbound:

```text
HiveWard Session View: Draft
Harness: not selected or selected but not started
Native session: none yet
```

After the user sends the first message or explicitly creates a harness session, HiveWard should bind it:

```text
HiveWard Session View: Requirements discussion
Harness: OpenClaw
Native session: oc_xxx
Agent: main
Model: MiniMax-M2.7
```

HiveWard may remember the mapping and metadata, but it should not become the source of chat memory.

## 7. Message Identity Rule

The message UI should show the actual speaker.

Allowed:

- User avatar.
- OpenClaw avatar.
- Codex avatar.
- Claude Code avatar.
- Specific harness agent avatar when available.

Avoid:

- "HiveWard Assistant" as the answering identity.
- Text that says HiveWard is doing the reasoning.
- UI that makes external harness output look like HiveWard output.

Recommended chat bubble content:

- Message body.
- Attachments, if any.
- Model used.
- Token usage.
- Status/error indicator.
- Compact link to details/logs when needed.

Do not put raw runtime identifiers directly in the bubble:

- `taskId`
- `runId`
- `sessionKey`
- gateway protocol details

Those belong in an inspection drawer, details panel, or logs view.

## 8. Chat Page UI Rules

Left panel:

- Use one consistent custom dropdown pattern.
- Every dropdown describes a harness-owned selection.
- Include session selection and new session creation.
- Show unavailable harnesses/options as disabled, not as fake working controls.
- Keep technical explanations out of the first-level UI.

Message area:

- Use avatar + bubble layout.
- The avatar indicates the actual speaker/harness.
- The bubble contains only content and compact usage metadata.
- Harness status and logs should be inspectable but not noisy.

Composer:

- Sends to the selected harness native session or creates one through the selected harness.
- May offer prompt templates and quick commands.
- Must not inject hidden platform behavior that changes harness identity or context ownership.

Mode selector:

- Selects the harness-facing task mode for the next interaction.
- Does not create a HiveWard-owned reasoning context.
- May change which prompt template, quick action, or harness skill is offered.
- Must make the active mode visible to the user.

For example, `Build blueprint` mode should mean:

```text
HiveWard tells the selected harness:
"The user wants to build a HiveWard blueprint. Use the HiveWard blueprint-writing skill/tool when appropriate."
```

It should not mean:

```text
HiveWard itself writes the blueprint with a hidden internal agent brain.
```

## 9. Prompt and Context Rules

HiveWard may provide:

- First-message prompt templates.
- Quick-send snippets.
- Saved notes.
- Task card references.
- User-visible metadata.

HiveWard must not:

- Force a hidden system prompt into every harness session.
- Rewrite harness behavior rules invisibly.
- Synchronize memory across harnesses as if it were one context.
- Use HiveWard session history as the authoritative reasoning context.
- Override Codex/OpenClaw/Claude Code native project context.

If context is sent to a harness, it must be explicit, visible, and scoped.

## 10. Mode-Driven Skill Routing

Chat modes are routing hints for the selected harness. They are not new HiveWard brains.

For V1, the important mode is:

```text
Build blueprint
```

When the user selects `Build blueprint`, HiveWard should:

- Keep the selected harness identity visible.
- Send the user's message to the selected native harness session.
- Attach or expose the relevant HiveWard blueprint-writing skill/tool to that harness.
- Make it clear that the harness is using a HiveWard skill to draft or update blueprint metadata.
- Receive the resulting draft, task card, note, or UI action through HiveWard APIs.

The harness should own:

- Understanding the user's request.
- Deciding how to use the blueprint-writing skill.
- Calling the skill/tool.
- Explaining the result.

HiveWard should own:

- Providing the skill/tool contract.
- Validating the blueprint draft shape.
- Saving the draft as HiveWard metadata.
- Opening the blueprint panel or draft view.
- Displaying status, errors, and logs.

Recommended future skill names:

```text
hiveward.create_blueprint_draft
hiveward.update_blueprint_draft
hiveward.open_blueprint_draft
hiveward.validate_blueprint_draft
hiveward.save_blueprint_note
```

Do not implement `Build blueprint` mode as a hidden HiveWard prompt that pretends to be the assistant. The visible execution path should remain:

```text
User selects Build blueprint
        ↓
HiveWard sends task to selected harness session
        ↓
Harness reasons and calls HiveWard blueprint skill/tool
        ↓
HiveWard validates/saves/opens draft
        ↓
Harness reports back as itself
```

## 11. HiveWard Skill / Tool Boundary

External harnesses may control HiveWard through narrow HiveWard tools.

First-version tool surface:

```text
hiveward.list_sessions
hiveward.create_session
hiveward.open_session
hiveward.tag_session
hiveward.create_task_card
hiveward.update_task_status
hiveward.save_note
hiveward.create_blueprint_draft
hiveward.open_panel
hiveward.get_runtime_status
```

Do not expose broad system control in V1:

```text
hiveward.execute_arbitrary_code
hiveward.delete_project
hiveward.modify_all_settings
hiveward.override_context
hiveward.auto_run_all_agents
hiveward.full_workspace_control
```

The tool rule:

```text
Harnesses may update HiveWard UI and metadata.
Harnesses must not receive unrestricted system control through HiveWard.
```

## 12. Engineering Rules

When implementing chat and harness features:

- Keep adapter/protocol mechanics out of React components.
- Keep harness-specific runtime details in the adapter/API layer.
- Treat HiveWard session ids as UI ids, not harness context ids.
- Store native harness session ids separately and name them clearly.
- Never label OpenClaw output as HiveWard output.
- Never label Codex output as HiveWard output.
- Never hide the selected harness from the user.
- Prefer explicit disabled states over fake support.
- Keep model, agent, workspace, and session values traceable to the harness catalog whenever possible.
- Treat chat modes as harness routing metadata, not HiveWard execution engines.
- Keep mode-specific skills explicit in the request envelope or harness tool configuration.

Recommended naming:

```text
hivewardSessionViewId
harnessId
nativeSessionId
agentId
modelId
workspaceId
```

Avoid naming that implies ownership inversion:

```text
hivewardAssistantSession
hivewardAgentContext
globalAgentMemory
unifiedBrainSession
```

## 13. V1 Acceptance Checklist

A clean V1 chat page is acceptable when:

- It connects to OpenClaw first.
- It keeps Codex and Claude Code entries visible but disabled until real support exists.
- It shows all controls as harness-owned choices.
- It supports HiveWard session views for shortcuts and metadata.
- It binds HiveWard session views to native harness sessions when available.
- It keeps the native harness as the source of context.
- It displays the actual harness/agent as speaker.
- It shows model and token usage compactly.
- It keeps raw ids and logs behind details views.
- It supports prompt templates without hidden context takeover.
- It supports Build blueprint mode by routing the selected harness to HiveWard blueprint-writing skills.
- It can create task cards or notes from a session.
- It does not claim HiveWard is the assistant doing the work.

## 14. Final Principle

```text
Harness owns context.
Harness owns reasoning.
Harness owns execution.

HiveWard owns UI coordination.
HiveWard owns session shortcuts.
HiveWard owns metadata.
HiveWard owns task cards.
HiveWard exposes narrow skills for harness control.
```

One-line product statement:

```text
HiveWard does not replace OpenClaw, Codex, or Claude Code.
HiveWard makes them easier to connect, dispatch, observe, and use.
```
