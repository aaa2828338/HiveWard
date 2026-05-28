# Manager Self-Iteration Remaining Semantics

This note locks the remaining lifecycle semantics before implementation. It is a supplement to `manager-self-iteration-engineering-plan.md` and `manager-self-iteration-requirements.md`.

## 1. Hard failures must not pretend to succeed

Research and round-plan preparation may fall back only when the configured capability is absent. It must not fall back silently when a configured runtime or agent fails.

Hard blockers include:

- configured research or requirement agent cannot start;
- configured agent returns failed or cancelled;
- manager fallback runtime cannot start;
- manager fallback returns failed or cancelled;
- manager explicitly reports a credential, permission, destructive-operation, or external-fact blocker.

When a hard blocker occurs, the round publishes a blocked approval item that can be read and replied to, but cannot be approved into execution.

## 2. More-research decisions are semantic manager judgments

The platform must not rely on a magic string such as `NEEDS_MORE_RESEARCH`.

After a draft round execution plan is generated, the manager is asked to judge whether the draft can proceed or needs another research pass. The manager returns a structured decision with:

- `needsMoreResearch`;
- `reason`;
- optional `researchBrief`;
- optional `hardBlocker`.

The loop is still bounded by `maxPreparationAttempts`.

## 3. Manager owns cross-round summaries

The platform gives the manager required fields, but the manager produces the summary content.

Required snapshot fields:

- completed items;
- rejected options or review feedback;
- key decisions;
- validated facts;
- open questions;
- active risks;
- assumptions;
- recommended next step;
- concise summary.

The manager may also include freeform notes for task-specific context that does not fit the required fields. The platform may keep a fallback only for malformed summary output, but the normal path is manager-authored.

## 4. Rejected artifacts remain visible but are not formal context

Rejected report artifacts remain in run history and inbox context so humans and the manager can inspect what was rejected.

They must not enter the formal artifact index used for the next accepted round. During the same rejected round rerun, the manager may see rejected artifacts under a separate rejected-artifact context so it can fix them. Once a clean replacement report is accepted, downstream rounds should see the accepted/current artifacts, not the rejected ones.

## 5. Research source field

Dispatch context must report research provenance from the research result, not from the plan source. Until a dedicated `researchSource` field exists, the dispatch context uses `researchStatus`.
