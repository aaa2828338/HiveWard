# Chat Native Harness UI Boundary

## Decision

HiveWard Chat is not a separate chat runtime.

HiveWard Chat is a UI channel for native agent harnesses such as OpenClaw and Codex. It gives users a fast way to use agent capabilities inside the HiveWard product context, with HiveWard-specific shortcuts, skills, and display controls layered on top.

The logic below is the product and architecture contract for the current Chat integration. Future changes should preserve this boundary unless the native harness ownership model changes.

## Plain-Language Model

HiveWard Chat is a display window and microphone.

The native harness owns the real conversation. HiveWard only gives the user a convenient place to talk to that harness while making the agent aware that the user is operating inside HiveWard.

## Source of Truth

OpenClaw or Codex owns:

- native sessions
- native chat history
- transcripts
- task/run identifiers
- model/tool execution
- usage facts
- delivery/runtime status

HiveWard owns:

- the Chat page UI
- selected harness, agent, model, and mode controls
- local display preferences
- platform-specific shortcuts and skill entry points
- the binding from a HiveWard UI view to a native session key
- a small HiveWard platform context added at dispatch time

## Platform Context

HiveWard may provide a short platform background to the agent.

The context should say only what environment the agent is being invoked from:

```text
HiveWard is a workspace for designing and operating business workflows.
Teams use it to map company goals, roles, handoffs, approvals, tools, and execution evidence into reusable blueprints.
You are being invoked from HiveWard's chat UI to help the user use agent capabilities in this platform context.
```

This context is not a visible chat message.

This context is not saved as HiveWard chat history.

This context is not a replacement for the native harness system prompt. If the native API supports a dedicated system/developer/context field, use that field. If it does not, the backend may prepend this short context when dispatching the current user message.

## Send Flow

The intended flow is:

```text
User types in HiveWard Chat
  -> HiveWard frontend sends the user's message and selected native target
  -> HiveWard backend adds a short HiveWard platform context
  -> HiveWard backend calls the native harness API
  -> native harness executes with its own session/runtime/tools
  -> HiveWard streams or displays the native response
```

HiveWard should not build its own conversation context from local history before sending.

## History Flow

The intended history flow is:

```text
HiveWard lists native sessions from the harness
  -> user selects a native session
  -> HiveWard asks the harness for that session's native history
  -> HiveWard renders the returned messages
```

HiveWard may cache transient messages in memory while the current stream is active. It should not persist a second authoritative transcript in local storage or the HiveWard store.

## What HiveWard May Persist Locally

HiveWard may persist only local UI metadata, such as:

- active Chat UI view id
- selected harness id
- selected agent id
- selected model id
- display preferences
- bound native session key
- local draft UI state when useful

HiveWard should not persist native chat messages as HiveWard-owned history.

## What Must Not Be Injected Into Chat Context

Do not inject these into the native chat prompt:

- `Hiveward blueprint run`
- `Hiveward node run`
- HiveWard session view ids
- native session ids
- local history JSON
- thinking effort UI state
- show-tool-call/display toggles
- runtime evidence flags
- internal request envelopes
- attachment metadata dumps

If attachments are supported, pass them through the native harness attachment/file interface. Do not stringify HiveWard attachment objects into the prompt unless there is no native file channel and the user explicitly sent text content.

## Blueprint Boundary

Blueprint runs and node runs belong to HiveWard blueprint execution.

Plain Chat is not a blueprint run. It should not expose blueprint run ids or node run ids to the agent, and it should not label chat requests as blueprint nodes in user-visible or model-visible context.

If temporary request ids are needed for idempotency or backend tracking, name them as chat request ids and keep them internal.

## Skill Integration

HiveWard skills should appear as explicit UI actions, commands, or native harness tools where possible.

Do not bury large skill descriptions in every chat prompt. The agent should receive only the relevant action/tool context needed for the current user request.

## Implementation Checks

Use this document as the implementation contract for future Chat changes:

- keep native harness history as the source of truth
- keep HiveWard local storage limited to UI metadata
- keep platform context short and invisible
- keep blueprint execution ids out of Chat
- expose HiveWard-specific value through UI controls, skills, and native tool surfaces
