import { createHash } from "node:crypto";

export interface SqliteMigration {
  version: number;
  name: string;
  checksum: string;
  up: string[];
}

const sqliteInitialSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    checksum TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS migration_manifests (
    id TEXT PRIMARY KEY,
    source_root TEXT NOT NULL,
    backup_root TEXT NOT NULL,
    source_manifest_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('dry_run','applied','failed')),
    created_at TEXT NOT NULL,
    completed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    logo_label TEXT,
    logo_url TEXT,
    business_goal TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS workspace_dashboards (
    company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    dashboard_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS role_directories (
    company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    directory_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS role_driver_bindings (
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL,
    runtime_id TEXT NOT NULL,
    model_id TEXT,
    binding_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (company_id, role_id)
  )`,
  `CREATE TABLE IF NOT EXISTS blueprints (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    current_version INTEGER NOT NULL,
    current_version_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS blueprint_versions (
    id TEXT PRIMARY KEY,
    blueprint_id TEXT NOT NULL REFERENCES blueprints(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    definition_json TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (blueprint_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS blueprint_skill_sources (
    id TEXT PRIMARY KEY,
    blueprint_id TEXT NOT NULL REFERENCES blueprints(id) ON DELETE CASCADE,
    working_directory TEXT NOT NULL,
    source_completeness TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    blueprint_id TEXT NOT NULL,
    blueprint_version_id TEXT REFERENCES blueprint_versions(id),
    blueprint_name TEXT,
    blueprint_version INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled','skipped','waiting_approval')),
    started_by TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_ms INTEGER,
    total_input_tokens INTEGER NOT NULL DEFAULT 0,
    total_output_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost_usd REAL NOT NULL DEFAULT 0,
    openclaw_refs_json TEXT NOT NULL DEFAULT '[]',
    final_result_json TEXT,
    row_version INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS run_blueprint_snapshots (
    run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
    blueprint_version_id TEXT,
    definition_json TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS run_sequence_counters (
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('event','timeline')),
    last_sequence INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, scope)
  )`,
  `CREATE TABLE IF NOT EXISTS node_runs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    blueprint_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    node_label TEXT NOT NULL,
    node_type TEXT NOT NULL,
    iteration_round_id TEXT,
    execution_kind TEXT NOT NULL DEFAULT 'node',
    status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled','skipped','waiting_approval')),
    queued_at TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,
    error TEXT,
    usage_json TEXT,
    openclaw_ref_json TEXT,
    lease_owner TEXT,
    lease_expires_at TEXT,
    worker_epoch INTEGER NOT NULL DEFAULT 0,
    row_version INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS node_run_payloads (
    node_run_id TEXT PRIMARY KEY REFERENCES node_runs(id) ON DELETE CASCADE,
    input_json TEXT,
    output_json TEXT,
    raw_result_json TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS run_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    node_run_id TEXT REFERENCES node_runs(id) ON DELETE SET NULL,
    sequence INTEGER NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    payload_json TEXT,
    openclaw_ref_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (run_id, sequence)
  )`,
  `CREATE TABLE IF NOT EXISTS iteration_sessions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    top_manager_node_id TEXT NOT NULL,
    blueprint_snapshot_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running','completed','failed','cancelled')),
    max_rounds INTEGER NOT NULL,
    current_round_id TEXT,
    created_at TEXT NOT NULL,
    ended_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS iteration_rounds (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES iteration_sessions(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    round_number INTEGER NOT NULL,
    status TEXT NOT NULL,
    requirement_request_id TEXT,
    approved_requirement_request_id TEXT,
    approved_requirement_revision INTEGER,
    release_report_request_id TEXT,
    artifact_ids_json TEXT NOT NULL DEFAULT '[]',
    research_status TEXT,
    research_summary TEXT,
    research_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
    plan_source TEXT,
    context_snapshot_id TEXT,
    approved_plan_json TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    UNIQUE (session_id, round_number)
  )`,
  `CREATE TABLE IF NOT EXISTS manager_dispatches (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    round_id TEXT REFERENCES iteration_rounds(id) ON DELETE CASCADE,
    manager_node_run_id TEXT REFERENCES node_runs(id) ON DELETE SET NULL,
    target_node_run_id TEXT REFERENCES node_runs(id) ON DELETE SET NULL,
    slot INTEGER,
    route_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('created','running','succeeded','failed','cancelled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS manager_context_snapshots (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES iteration_sessions(id) ON DELETE CASCADE,
    round_id TEXT NOT NULL REFERENCES iteration_rounds(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    source_report_id TEXT,
    snapshot_json TEXT NOT NULL,
    summary TEXT NOT NULL,
    recommended_next_step TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS approval_requests (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    round_id TEXT,
    node_run_id TEXT,
    kind TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','replied','completed','terminated','superseded')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    payload_ref TEXT,
    source_type TEXT,
    source_id TEXT,
    thread_id TEXT,
    revision INTEGER NOT NULL,
    replaces_request_id TEXT,
    superseded_by_request_id TEXT,
    capabilities_json TEXT NOT NULL,
    requested_by_json TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS approval_decisions (
    id TEXT PRIMARY KEY,
    approval_request_id TEXT NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    actor TEXT NOT NULL CHECK (actor IN ('user','system','manager')),
    comment TEXT,
    resulting_status TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS approval_replies (
    id TEXT PRIMARY KEY,
    approval_request_id TEXT NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS inbox_items (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_by_role_id TEXT NOT NULL,
    target_role_id TEXT,
    blueprint_id TEXT,
    blueprint_name TEXT,
    payload_json TEXT,
    source_json TEXT,
    approval_request_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    decided_at TEXT,
    decision_comment TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS inbox_replies (
    id TEXT PRIMARY KEY,
    inbox_item_id TEXT NOT NULL REFERENCES inbox_items(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS agent_outputs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    round_id TEXT,
    node_run_id TEXT NOT NULL REFERENCES node_runs(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    envelope_json TEXT NOT NULL,
    result_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (node_run_id)
  )`,
  `CREATE TABLE IF NOT EXISTS agent_human_reports (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    round_id TEXT,
    node_run_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    node_label TEXT NOT NULL,
    title TEXT NOT NULL,
    body_md TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('agent','fallback')),
    fallback_reason TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS agent_handoffs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    round_id TEXT,
    node_run_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    round_id TEXT,
    node_run_id TEXT REFERENCES node_runs(id) ON DELETE SET NULL,
    slot TEXT,
    title TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('html','markdown','json','file','link')),
    format TEXT,
    storage_path TEXT,
    relative_path TEXT,
    download_url TEXT,
    preview_policy TEXT NOT NULL CHECK (preview_policy IN ('none','source','sandboxed_iframe')),
    trusted INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current','rejected','superseded','failed')),
    bytes INTEGER,
    sha256 TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS release_reports (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    round_id TEXT NOT NULL,
    approval_request_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 1),
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    supersedes_report_id TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS release_report_artifacts (
    release_report_id TEXT NOT NULL REFERENCES release_reports(id) ON DELETE CASCADE,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    title TEXT NOT NULL,
    location TEXT NOT NULL,
    current INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (release_report_id, artifact_id)
  )`,
  `CREATE TABLE IF NOT EXISTS run_timeline_items (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    actor_node_id TEXT,
    actor_label TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    payload_ref TEXT,
    UNIQUE (run_id, sequence)
  )`,
  `CREATE TABLE IF NOT EXISTS manager_mail (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    capabilities_json TEXT NOT NULL,
    related_run_id TEXT,
    related_round_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    company_id TEXT,
    harness_id TEXT NOT NULL,
    native_session_id TEXT,
    native_session_state TEXT,
    title TEXT,
    role_scope_json TEXT,
    model_id TEXT,
    agent_id TEXT,
    thinking_effort TEXT,
    permission_mode TEXT,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    ended_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL,
    harness_id TEXT NOT NULL,
    model_id TEXT,
    native_message_id TEXT,
    runtime_ref_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS chat_attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    attachment_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_runs_company_started ON runs(company_id, started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_runs_blueprint_started ON runs(blueprint_id, started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_runs_status_updated ON runs(status, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_node_runs_run_status ON node_runs(run_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_node_runs_run_round_node ON node_runs(run_id, iteration_round_id, node_id)`,
  `CREATE INDEX IF NOT EXISTS idx_run_events_run_created ON run_events(run_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_approval_requests_status_created ON approval_requests(status, requested_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_approval_requests_run_round ON approval_requests(run_id, round_id)`,
  `CREATE INDEX IF NOT EXISTS idx_inbox_items_company_status ON inbox_items(company_id, status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_run_round_node ON agent_human_reports(run_id, round_id, node_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_handoffs_run_node ON agent_handoffs(run_id, node_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_artifacts_run_round_node ON artifacts(run_id, round_id, node_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_release_reports_run_round ON release_reports(run_id, round_id, version DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_run_timeline_run_created ON run_timeline_items(run_id, created_at)`
];

const sqliteLegacyMigrationCompatibilityStatements = [
  "ALTER TABLE artifacts ADD COLUMN declared_node_run_id TEXT",
  "UPDATE artifacts SET declared_node_run_id = node_run_id WHERE declared_node_run_id IS NULL AND node_run_id IS NOT NULL",
  "ALTER TABLE release_report_artifacts ADD COLUMN position INTEGER NOT NULL DEFAULT 0"
];

const sqliteManagerReportRoundNumberStatements = [
  "ALTER TABLE agent_human_reports ADD COLUMN manager_round_number INTEGER"
];

const sqliteApprovalThreadStatements = [
  `CREATE TABLE IF NOT EXISTS approval_threads (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open','closed')),
    title TEXT NOT NULL,
    run_id TEXT,
    round_id TEXT,
    node_run_id TEXT,
    source_type TEXT,
    source_id TEXT,
    current_request_id TEXT,
    current_revision INTEGER NOT NULL,
    capabilities_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    closed_at TEXT
  )`,
  `INSERT OR IGNORE INTO approval_threads (
     id, kind, status, title, run_id, round_id, node_run_id, source_type, source_id,
     current_request_id, current_revision, capabilities_json, created_at, updated_at, closed_at
   )
   SELECT
     COALESCE(thread_id, id),
     kind,
     CASE WHEN status = 'pending' THEN 'open' ELSE 'closed' END,
     title,
     run_id,
     round_id,
     node_run_id,
     source_type,
     source_id,
     CASE WHEN status = 'pending' THEN id ELSE NULL END,
     revision,
     capabilities_json,
     requested_at,
     COALESCE(updated_at, requested_at),
     CASE WHEN status = 'pending' THEN NULL ELSE COALESCE(updated_at, requested_at) END
   FROM approval_requests`,
  `CREATE TABLE IF NOT EXISTS approval_replies_next (
    id TEXT PRIMARY KEY,
    approval_request_id TEXT REFERENCES approval_requests(id) ON DELETE SET NULL,
    thread_id TEXT NOT NULL REFERENCES approval_threads(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL
  )`,
  `INSERT OR IGNORE INTO approval_replies_next (id, approval_request_id, thread_id, message, actor, created_at)
   SELECT
     approval_replies.id,
     approval_replies.approval_request_id,
     COALESCE(approval_requests.thread_id, approval_replies.approval_request_id),
     approval_replies.message,
     approval_replies.actor,
     approval_replies.created_at
   FROM approval_replies
   LEFT JOIN approval_requests ON approval_requests.id = approval_replies.approval_request_id
   WHERE COALESCE(approval_requests.thread_id, approval_replies.approval_request_id) IS NOT NULL`,
  "DROP TABLE approval_replies",
  "ALTER TABLE approval_replies_next RENAME TO approval_replies",
  `CREATE INDEX IF NOT EXISTS idx_approval_threads_run_status ON approval_threads(run_id, status, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_approval_replies_thread_created ON approval_replies(thread_id, created_at)`
];

const sqliteApprovalReplyMetadataStatements = [
  "ALTER TABLE approval_replies ADD COLUMN metadata_json TEXT",
  `UPDATE approval_replies
   SET metadata_json = '{"legacySource":"approval_replies_v1","legacyAction":"reply","legacyMeaning":"message_only","requestKind":"'
     || COALESCE((SELECT kind FROM approval_requests WHERE approval_requests.id = approval_replies.approval_request_id), 'unknown')
     || '"}'
   WHERE metadata_json IS NULL`
];

const sqliteApprovalReplyLegacyMeaningStatements = [
  `UPDATE approval_replies
   SET metadata_json = '{"legacySource":"approval_replies_v1","legacyAction":"reply","legacyMeaning":"'
     || CASE COALESCE((SELECT kind FROM approval_requests WHERE approval_requests.id = approval_replies.approval_request_id), 'unknown')
       WHEN 'agent_proposal' THEN 'legacy_agent_rerun_feedback'
       WHEN 'iteration_requirement_plan' THEN 'legacy_requirement_revision_feedback'
       WHEN 'manager_release_report' THEN 'legacy_release_report_feedback'
       ELSE 'message_only'
     END
     || '","requestKind":"'
     || COALESCE((SELECT kind FROM approval_requests WHERE approval_requests.id = approval_replies.approval_request_id), 'unknown')
     || '"}'
   WHERE metadata_json LIKE '%"legacySource":"approval_replies_v1"%'`
];

const sqliteExecutionFactsStatements = [
  `CREATE TABLE IF NOT EXISTS run_commands (
    id TEXT PRIMARY KEY,
    command_key TEXT NOT NULL UNIQUE,
    blueprint_id TEXT NOT NULL,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    round_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('regular_run')),
    status TEXT NOT NULL CHECK (status IN ('queued','running','waiting_approval','succeeded','failed','cancelled')),
    current_revision INTEGER NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
    current_step TEXT,
    started_at TEXT,
    ended_at TEXT,
    error TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS run_command_steps (
    id TEXT PRIMARY KEY,
    command_id TEXT NOT NULL REFERENCES run_commands(id) ON DELETE CASCADE,
    step_key TEXT NOT NULL UNIQUE,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    round_id TEXT,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    mode TEXT NOT NULL,
    node_id TEXT NOT NULL,
    node_run_id TEXT REFERENCES node_runs(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('queued','running','waiting_approval','succeeded','failed','cancelled')),
    started_at TEXT,
    ended_at TEXT,
    error TEXT,
    runtime_ref_json TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS node_execution_sessions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    node_run_id TEXT NOT NULL REFERENCES node_runs(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    agent_seat_id TEXT,
    harness_id TEXT NOT NULL,
    native_session_id TEXT,
    runtime_ref_json TEXT,
    policy TEXT NOT NULL CHECK (policy IN ('refresh_per_run','refresh_per_round','preserve_across_rounds')),
    status TEXT NOT NULL CHECK (status IN ('active','paused','completed','failed','unavailable','fallback')),
    status_reason TEXT,
    fallback_of_session_id TEXT,
    resumed_from_session_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_used_at TEXT
  )`,
  // 保留为历史事实，不参与决策: store APIs no longer read, write, or project this table.
  `CREATE TABLE IF NOT EXISTS node_session_transcript_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES node_execution_sessions(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    node_run_id TEXT NOT NULL REFERENCES node_runs(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user','assistant','system','runtime')),
    kind TEXT NOT NULL CHECK (kind IN ('user_message','assistant_delta','assistant_message','runtime_started','runtime_state','runtime_done','system_note')),
    content TEXT,
    runtime_ref_json TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(session_id, sequence)
  )`,
  `CREATE TABLE IF NOT EXISTS approval_discussion_bindings (
    approval_request_id TEXT PRIMARY KEY REFERENCES approval_requests(id) ON DELETE CASCADE,
    thread_id TEXT,
    mode TEXT NOT NULL CHECK (mode IN ('none','message_only','executor')),
    route TEXT NOT NULL,
    executor_actor TEXT,
    executor_kind TEXT,
    executor_node_id TEXT,
    executor_node_run_id TEXT,
    executor_session_id TEXT,
    runtime_id TEXT,
    can_stream_reply INTEGER NOT NULL CHECK (can_stream_reply IN (0,1)),
    reason TEXT,
    resolver_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "ALTER TABLE approval_replies ADD COLUMN purpose TEXT NOT NULL DEFAULT 'message'",
  `CREATE INDEX IF NOT EXISTS idx_run_commands_run_status ON run_commands(run_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_run_commands_round_kind ON run_commands(run_id, round_id, kind)`,
  `CREATE INDEX IF NOT EXISTS idx_run_command_steps_command_status ON run_command_steps(command_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_run_command_steps_node_run ON run_command_steps(node_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_node_execution_sessions_run_node ON node_execution_sessions(run_id, node_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_node_execution_sessions_native ON node_execution_sessions(harness_id, native_session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_node_transcript_session_seq ON node_session_transcript_events(session_id, sequence)`,
  `CREATE INDEX IF NOT EXISTS idx_approval_discussion_bindings_mode ON approval_discussion_bindings(mode)`
];

const sqliteExecutionFactConstraintStatements = [
  `CREATE TABLE IF NOT EXISTS run_commands_next (
    id TEXT PRIMARY KEY,
    command_key TEXT NOT NULL UNIQUE,
    blueprint_id TEXT NOT NULL,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    round_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('regular_run')),
    status TEXT NOT NULL CHECK (status IN ('queued','running','waiting_approval','succeeded','failed','cancelled')),
    current_revision INTEGER NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
    current_step TEXT CHECK (current_step IS NULL OR current_step IN ('research_resolution','requirement_resolution','revise_plan','preflight_judgment','context_snapshot','release_report','node_execution')),
    started_at TEXT,
    ended_at TEXT,
    error TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `INSERT INTO run_commands_next (
     id, command_key, blueprint_id, run_id, round_id, kind, status, current_revision,
     current_step, started_at, ended_at, error, metadata_json, created_at, updated_at
   )
   SELECT
     id, command_key, blueprint_id, run_id, round_id, kind, status, current_revision,
     current_step, started_at, ended_at, error, metadata_json, created_at, updated_at
   FROM run_commands`,
  `CREATE TABLE IF NOT EXISTS run_command_steps_next (
    id TEXT PRIMARY KEY,
    command_id TEXT NOT NULL REFERENCES run_commands_next(id) ON DELETE CASCADE,
    step_key TEXT NOT NULL UNIQUE,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    round_id TEXT,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    mode TEXT NOT NULL CHECK (mode IN ('research_resolution','requirement_resolution','revise_plan','preflight_judgment','context_snapshot','release_report','node_execution')),
    node_id TEXT NOT NULL,
    node_run_id TEXT REFERENCES node_runs(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('queued','running','waiting_approval','succeeded','failed','cancelled')),
    started_at TEXT,
    ended_at TEXT,
    error TEXT,
    runtime_ref_json TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `INSERT INTO run_command_steps_next (
     id, command_id, step_key, run_id, round_id, revision, mode, node_id, node_run_id,
     status, started_at, ended_at, error, runtime_ref_json, metadata_json, created_at, updated_at
   )
   SELECT
     id, command_id, step_key, run_id, round_id, revision, mode, node_id, node_run_id,
     status, started_at, ended_at, error, runtime_ref_json, metadata_json, created_at, updated_at
   FROM run_command_steps`,
  "DROP TABLE run_command_steps",
  "DROP TABLE run_commands",
  "ALTER TABLE run_commands_next RENAME TO run_commands",
  "ALTER TABLE run_command_steps_next RENAME TO run_command_steps",
  `CREATE TABLE IF NOT EXISTS node_execution_sessions_next (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    node_run_id TEXT NOT NULL REFERENCES node_runs(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    agent_seat_id TEXT,
    harness_id TEXT NOT NULL,
    native_session_id TEXT,
    runtime_ref_json TEXT,
    policy TEXT NOT NULL CHECK (policy IN ('refresh_per_run','refresh_per_round','preserve_across_rounds')),
    status TEXT NOT NULL CHECK (status IN ('active','paused','completed','failed','unavailable','fallback')),
    status_reason TEXT,
    fallback_of_session_id TEXT REFERENCES node_execution_sessions_next(id) ON DELETE SET NULL,
    resumed_from_session_id TEXT REFERENCES node_execution_sessions_next(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_used_at TEXT
  )`,
  `INSERT INTO node_execution_sessions_next (
     id, run_id, node_run_id, node_id, agent_seat_id, harness_id, native_session_id,
     runtime_ref_json, policy, status, status_reason, fallback_of_session_id,
     resumed_from_session_id, created_at, updated_at, last_used_at
   )
   SELECT
     id, run_id, node_run_id, node_id, agent_seat_id, harness_id, native_session_id,
     runtime_ref_json, policy, status, status_reason, fallback_of_session_id,
     resumed_from_session_id, created_at, updated_at, last_used_at
   FROM node_execution_sessions`,
  // 保留为历史事实，不参与决策: this rebuild only preserves old rows while session FK constraints are rebuilt.
  `CREATE TABLE IF NOT EXISTS node_session_transcript_events_next (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES node_execution_sessions_next(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    node_run_id TEXT NOT NULL REFERENCES node_runs(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user','assistant','system','runtime')),
    kind TEXT NOT NULL CHECK (kind IN ('user_message','assistant_delta','assistant_message','runtime_started','runtime_state','runtime_done','system_note')),
    content TEXT,
    runtime_ref_json TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(session_id, sequence)
  )`,
  `INSERT INTO node_session_transcript_events_next (
     id, session_id, sequence, run_id, node_run_id, role, kind, content,
     runtime_ref_json, metadata_json, created_at
   )
   SELECT
     id, session_id, sequence, run_id, node_run_id, role, kind, content,
     runtime_ref_json, metadata_json, created_at
   FROM node_session_transcript_events`,
  `CREATE TABLE IF NOT EXISTS approval_discussion_bindings_next (
    approval_request_id TEXT PRIMARY KEY REFERENCES approval_requests(id) ON DELETE CASCADE,
    thread_id TEXT,
    mode TEXT NOT NULL CHECK (mode IN ('none','message_only','executor')),
    route TEXT NOT NULL CHECK (route IN ('none','message_only','agent_approval','requirement_agent','requirement_manager','release_report_manager','function_manager','function_summary')),
    executor_actor TEXT CHECK (executor_actor IS NULL OR executor_actor IN ('agent','manager','system')),
    executor_kind TEXT CHECK (executor_kind IS NULL OR executor_kind IN ('none','message_only','agent_approval','requirement_agent','requirement_manager','release_report_manager','function_manager','function_summary')),
    executor_node_id TEXT,
    executor_node_run_id TEXT REFERENCES node_runs(id) ON DELETE SET NULL,
    executor_session_id TEXT REFERENCES node_execution_sessions_next(id) ON DELETE SET NULL,
    runtime_id TEXT,
    can_stream_reply INTEGER NOT NULL CHECK (can_stream_reply IN (0,1)),
    reason TEXT,
    resolver_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `INSERT INTO approval_discussion_bindings_next (
     approval_request_id, thread_id, mode, route, executor_actor, executor_kind,
     executor_node_id, executor_node_run_id, executor_session_id, runtime_id,
     can_stream_reply, reason, resolver_version, created_at, updated_at
   )
   SELECT
     approval_request_id, thread_id, mode, route, executor_actor, executor_kind,
     executor_node_id, executor_node_run_id, executor_session_id, runtime_id,
     can_stream_reply, reason, resolver_version, created_at, updated_at
   FROM approval_discussion_bindings`,
  "DROP TABLE node_session_transcript_events",
  "DROP TABLE approval_discussion_bindings",
  "DROP TABLE node_execution_sessions",
  "ALTER TABLE node_execution_sessions_next RENAME TO node_execution_sessions",
  "ALTER TABLE node_session_transcript_events_next RENAME TO node_session_transcript_events",
  "ALTER TABLE approval_discussion_bindings_next RENAME TO approval_discussion_bindings",
  `CREATE INDEX IF NOT EXISTS idx_run_commands_run_status ON run_commands(run_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_run_commands_round_kind ON run_commands(run_id, round_id, kind)`,
  `CREATE INDEX IF NOT EXISTS idx_run_command_steps_command_status ON run_command_steps(command_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_run_command_steps_node_run ON run_command_steps(node_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_node_execution_sessions_run_node ON node_execution_sessions(run_id, node_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_node_execution_sessions_native ON node_execution_sessions(harness_id, native_session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_node_transcript_session_seq ON node_session_transcript_events(session_id, sequence)`,
  `CREATE INDEX IF NOT EXISTS idx_approval_discussion_bindings_mode ON approval_discussion_bindings(mode)`
];

const sqliteRunRoomFoundationStatements = [
  `CREATE TABLE IF NOT EXISTS run_rooms (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    blueprint_id TEXT,
    run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('open','completed','failed','cancelled')),
    title TEXT,
    summary TEXT,
    manager_role_id TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS run_interjections (
    id TEXT PRIMARY KEY,
    run_room_id TEXT NOT NULL REFERENCES run_rooms(id) ON DELETE CASCADE,
    target TEXT NOT NULL CHECK (target IN ('manager')),
    message_markdown TEXT NOT NULL,
    created_by_role_id TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS manager_commands (
    id TEXT PRIMARY KEY,
    run_room_id TEXT NOT NULL REFERENCES run_rooms(id) ON DELETE CASCADE,
    manager_role_id TEXT,
    action TEXT NOT NULL CHECK (action IN ('dispatch_worker_task','request_human_action','cancel_worker_task','summarize_run_room','complete_run_room')),
    status TEXT NOT NULL CHECK (status IN ('queued','running','waiting_user','succeeded','failed','cancelled')),
    worker_task_id TEXT,
    human_action_request_id TEXT,
    instruction_markdown TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS worker_tasks (
    id TEXT PRIMARY KEY,
    run_room_id TEXT NOT NULL REFERENCES run_rooms(id) ON DELETE CASCADE,
    manager_command_id TEXT NOT NULL REFERENCES manager_commands(id) ON DELETE CASCADE,
    worker_seat_id TEXT,
    title TEXT,
    instruction_markdown TEXT,
    status TEXT NOT NULL CHECK (status IN ('queued','running','waiting_user','succeeded','failed','cancelled')),
    started_at TEXT,
    ended_at TEXT,
    error TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_tasks_one_active_per_run_room
    ON worker_tasks(run_room_id)
    WHERE status IN ('queued','running','waiting_user')`,
  `CREATE TABLE IF NOT EXISTS human_action_requests (
    id TEXT PRIMARY KEY,
    run_room_id TEXT REFERENCES run_rooms(id) ON DELETE SET NULL,
    source_context_type TEXT NOT NULL CHECK (source_context_type IN ('run_room','executive_chat','blueprint_governance')),
    source_context_id TEXT NOT NULL,
    response_intent TEXT NOT NULL CHECK (response_intent IN ('decision_required','reply_required','review_required')),
    status TEXT NOT NULL CHECK (status IN ('pending','responded','closed','cancelled')),
    title TEXT NOT NULL,
    body_markdown TEXT NOT NULL,
    created_by_role_id TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS human_action_responses (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES human_action_requests(id) ON DELETE CASCADE,
    message_markdown TEXT NOT NULL,
    created_by_role_id TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS agent_output_events (
    id TEXT PRIMARY KEY,
    owner_type TEXT NOT NULL CHECK (owner_type IN ('chat_session','run_room','manager_thread','worker_task','human_action_request')),
    owner_id TEXT NOT NULL,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('user','ceo','leader','manager','worker','system')),
    kind TEXT NOT NULL CHECK (kind IN ('message_started','message_delta','message_completed','runtime_state','tool_state','message_failed')),
    sequence INTEGER NOT NULL CHECK (sequence >= 1),
    body_markdown TEXT,
    delta TEXT,
    source_type TEXT,
    source_id TEXT,
    runtime_state_json TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(owner_type, owner_id, sequence)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_run_rooms_company_status ON run_rooms(company_id, status, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_run_rooms_blueprint_status ON run_rooms(blueprint_id, status, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_run_interjections_run_room_created ON run_interjections(run_room_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_manager_commands_run_room_status ON manager_commands(run_room_id, status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_worker_tasks_run_room_status ON worker_tasks(run_room_id, status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_worker_tasks_manager_command ON worker_tasks(manager_command_id)`,
  `CREATE INDEX IF NOT EXISTS idx_human_action_requests_context_status ON human_action_requests(source_context_type, response_intent, status, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_human_action_requests_run_room ON human_action_requests(run_room_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_human_action_responses_request_created ON human_action_responses(request_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_output_events_owner_sequence ON agent_output_events(owner_type, owner_id, sequence)`
];

const sqliteHumanActionApprovalOwnerStatements = [
  `ALTER TABLE human_action_requests
    ADD COLUMN approval_request_id TEXT REFERENCES approval_requests(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS idx_human_action_requests_approval_request
    ON human_action_requests(approval_request_id, status, updated_at DESC)`
];

function checksumStatements(statements: string[]): string {
  return createHash("sha256").update(statements.join("\n")).digest("hex");
}

export const sqliteMigrations: SqliteMigration[] = [
  {
    version: 1,
    name: "sqlite_vnext_v1",
    checksum: checksumStatements(sqliteInitialSchemaStatements),
    up: sqliteInitialSchemaStatements
  },
  {
    version: 2,
    name: "legacy_migration_compatibility",
    checksum: checksumStatements(sqliteLegacyMigrationCompatibilityStatements),
    up: sqliteLegacyMigrationCompatibilityStatements
  },
  {
    version: 3,
    name: "manager_report_round_number",
    checksum: checksumStatements(sqliteManagerReportRoundNumberStatements),
    up: sqliteManagerReportRoundNumberStatements
  },
  {
    version: 4,
    name: "approval_threads",
    checksum: checksumStatements(sqliteApprovalThreadStatements),
    up: sqliteApprovalThreadStatements
  },
  {
    version: 5,
    name: "approval_reply_metadata",
    checksum: checksumStatements(sqliteApprovalReplyMetadataStatements),
    up: sqliteApprovalReplyMetadataStatements
  },
  {
    version: 6,
    name: "approval_reply_legacy_meaning",
    checksum: checksumStatements(sqliteApprovalReplyLegacyMeaningStatements),
    up: sqliteApprovalReplyLegacyMeaningStatements
  },
  {
    version: 7,
    name: "execution_facts",
    checksum: checksumStatements(sqliteExecutionFactsStatements),
    up: sqliteExecutionFactsStatements
  },
  {
    version: 8,
    name: "execution_fact_constraints",
    checksum: checksumStatements(sqliteExecutionFactConstraintStatements),
    up: sqliteExecutionFactConstraintStatements
  },
  {
    version: 9,
    name: "run_room_foundation",
    checksum: checksumStatements(sqliteRunRoomFoundationStatements),
    up: sqliteRunRoomFoundationStatements
  },
  {
    version: 10,
    name: "human_action_approval_owner",
    checksum: checksumStatements(sqliteHumanActionApprovalOwnerStatements),
    up: sqliteHumanActionApprovalOwnerStatements
  }
];

export const sqliteSchemaVersion = sqliteMigrations.at(-1)?.version ?? 0;
export const sqliteSchemaStatements = sqliteMigrations.flatMap((migration) => migration.up);

export const sqliteRequiredSchema = {
  schema_migrations: ["version", "name", "applied_at", "checksum"],
  migration_manifests: ["id", "source_root", "backup_root", "source_manifest_json", "result_json", "status", "created_at"],
  runs: ["id", "company_id", "blueprint_id", "status", "started_by", "started_at", "row_version", "updated_at"],
  run_sequence_counters: ["run_id", "scope", "last_sequence", "updated_at"],
  node_runs: ["id", "run_id", "blueprint_id", "node_id", "node_label", "node_type", "status", "lease_owner", "worker_epoch", "row_version", "updated_at"],
  node_run_payloads: ["node_run_id", "input_json", "output_json", "raw_result_json", "updated_at"],
  run_commands: ["id", "command_key", "blueprint_id", "run_id", "kind", "status", "current_revision", "created_at", "updated_at"],
  run_command_steps: ["id", "command_id", "step_key", "run_id", "revision", "mode", "node_id", "status", "created_at", "updated_at"],
  run_rooms: ["id", "company_id", "status", "created_at", "updated_at"],
  run_interjections: ["id", "run_room_id", "target", "message_markdown", "created_at"],
  manager_commands: ["id", "run_room_id", "action", "status", "created_at", "updated_at"],
  worker_tasks: ["id", "run_room_id", "manager_command_id", "status", "created_at", "updated_at"],
  human_action_requests: ["id", "source_context_type", "source_context_id", "response_intent", "status", "approval_request_id", "title", "body_markdown", "created_at", "updated_at"],
  human_action_responses: ["id", "request_id", "message_markdown", "created_at"],
  agent_output_events: ["id", "owner_type", "owner_id", "actor_type", "kind", "sequence", "created_at"],
  node_execution_sessions: ["id", "run_id", "node_run_id", "node_id", "harness_id", "policy", "status", "created_at", "updated_at"],
  approval_discussion_bindings: ["approval_request_id", "mode", "route", "can_stream_reply", "resolver_version", "created_at", "updated_at"],
  run_events: ["id", "run_id", "node_run_id", "sequence", "type", "message", "created_at"],
  approval_threads: ["id", "kind", "status", "title", "current_revision", "capabilities_json", "created_at", "updated_at"],
  approval_replies: ["id", "approval_request_id", "thread_id", "message", "actor", "purpose", "created_at", "metadata_json"],
  approval_requests: ["id", "run_id", "round_id", "node_run_id", "kind", "status", "title", "body", "revision", "requested_by_json", "requested_at"],
  approval_decisions: ["id", "approval_request_id", "action", "actor", "resulting_status", "created_at"],
  inbox_items: ["id", "company_id", "type", "status", "title", "summary", "created_by_role_id", "created_at", "updated_at"],
  agent_outputs: ["id", "run_id", "round_id", "node_run_id", "node_id", "envelope_json", "created_at"],
  agent_human_reports: ["id", "run_id", "round_id", "manager_round_number", "node_run_id", "node_id", "node_label", "title", "body_md", "source", "created_at"],
  agent_handoffs: ["id", "run_id", "round_id", "node_run_id", "node_id", "payload_json", "created_at"],
  artifacts: ["id", "run_id", "round_id", "node_run_id", "declared_node_run_id", "kind", "storage_path", "relative_path", "download_url", "preview_policy", "trusted", "status", "created_at"],
  release_reports: ["id", "run_id", "round_id", "approval_request_id", "version", "title", "summary", "created_at"],
  release_report_artifacts: ["release_report_id", "artifact_id", "position", "title", "location", "current"],
  run_timeline_items: ["id", "run_id", "sequence", "created_at", "actor_label", "kind", "title"],
  chat_sessions: ["id", "harness_id", "mode", "status", "created_at", "updated_at"],
  chat_messages: ["id", "session_id", "role", "content", "status", "harness_id", "created_at"]
} satisfies Record<string, string[]>;

export const sqliteRequiredIndexes = {
  runs: ["idx_runs_company_started", "idx_runs_blueprint_started", "idx_runs_status_updated"],
  node_runs: ["idx_node_runs_run_status", "idx_node_runs_run_round_node"],
  run_commands: ["idx_run_commands_run_status", "idx_run_commands_round_kind"],
  run_command_steps: ["idx_run_command_steps_command_status", "idx_run_command_steps_node_run"],
  run_rooms: ["idx_run_rooms_company_status", "idx_run_rooms_blueprint_status"],
  run_interjections: ["idx_run_interjections_run_room_created"],
  manager_commands: ["idx_manager_commands_run_room_status"],
  worker_tasks: ["idx_worker_tasks_run_room_status", "idx_worker_tasks_manager_command", "idx_worker_tasks_one_active_per_run_room"],
  human_action_requests: ["idx_human_action_requests_context_status", "idx_human_action_requests_run_room", "idx_human_action_requests_approval_request"],
  human_action_responses: ["idx_human_action_responses_request_created"],
  agent_output_events: ["idx_agent_output_events_owner_sequence"],
  node_execution_sessions: ["idx_node_execution_sessions_run_node", "idx_node_execution_sessions_native"],
  approval_discussion_bindings: ["idx_approval_discussion_bindings_mode"],
  run_events: ["idx_run_events_run_created"],
  run_timeline_items: ["idx_run_timeline_run_created"],
  approval_threads: ["idx_approval_threads_run_status"],
  approval_replies: ["idx_approval_replies_thread_created"],
  approval_requests: ["idx_approval_requests_status_created", "idx_approval_requests_run_round"],
  artifacts: ["idx_artifacts_run_round_node"],
  release_reports: ["idx_release_reports_run_round"]
} satisfies Record<string, string[]>;

export const sqliteRequiredUniqueConstraints = [
  { table: "run_events", columns: ["run_id", "sequence"] },
  { table: "run_commands", columns: ["command_key"] },
  { table: "run_command_steps", columns: ["step_key"] },
  { table: "run_timeline_items", columns: ["run_id", "sequence"] },
  { table: "agent_outputs", columns: ["node_run_id"] },
  { table: "agent_output_events", columns: ["owner_type", "owner_id", "sequence"] }
];

export const sqliteRequiredForeignKeys = [
  { table: "runs", from: "company_id", targetTable: "companies", to: "id" },
  { table: "node_runs", from: "run_id", targetTable: "runs", to: "id" },
  { table: "run_commands", from: "run_id", targetTable: "runs", to: "id" },
  { table: "run_command_steps", from: "command_id", targetTable: "run_commands", to: "id" },
  { table: "run_command_steps", from: "run_id", targetTable: "runs", to: "id" },
  { table: "run_command_steps", from: "node_run_id", targetTable: "node_runs", to: "id" },
  { table: "run_rooms", from: "company_id", targetTable: "companies", to: "id" },
  { table: "run_rooms", from: "run_id", targetTable: "runs", to: "id" },
  { table: "run_interjections", from: "run_room_id", targetTable: "run_rooms", to: "id" },
  { table: "manager_commands", from: "run_room_id", targetTable: "run_rooms", to: "id" },
  { table: "worker_tasks", from: "run_room_id", targetTable: "run_rooms", to: "id" },
  { table: "worker_tasks", from: "manager_command_id", targetTable: "manager_commands", to: "id" },
  { table: "human_action_requests", from: "run_room_id", targetTable: "run_rooms", to: "id" },
  { table: "human_action_requests", from: "approval_request_id", targetTable: "approval_requests", to: "id" },
  { table: "human_action_responses", from: "request_id", targetTable: "human_action_requests", to: "id" },
  { table: "node_execution_sessions", from: "run_id", targetTable: "runs", to: "id" },
  { table: "node_execution_sessions", from: "node_run_id", targetTable: "node_runs", to: "id" },
  { table: "node_execution_sessions", from: "fallback_of_session_id", targetTable: "node_execution_sessions", to: "id" },
  { table: "node_execution_sessions", from: "resumed_from_session_id", targetTable: "node_execution_sessions", to: "id" },
  { table: "approval_discussion_bindings", from: "approval_request_id", targetTable: "approval_requests", to: "id" },
  { table: "approval_discussion_bindings", from: "executor_node_run_id", targetTable: "node_runs", to: "id" },
  { table: "approval_discussion_bindings", from: "executor_session_id", targetTable: "node_execution_sessions", to: "id" },
  { table: "run_events", from: "run_id", targetTable: "runs", to: "id" },
  { table: "run_timeline_items", from: "run_id", targetTable: "runs", to: "id" },
  { table: "approval_decisions", from: "approval_request_id", targetTable: "approval_requests", to: "id" },
  { table: "approval_replies", from: "approval_request_id", targetTable: "approval_requests", to: "id" },
  { table: "approval_replies", from: "thread_id", targetTable: "approval_threads", to: "id" },
  { table: "artifacts", from: "run_id", targetTable: "runs", to: "id" },
  { table: "release_reports", from: "run_id", targetTable: "runs", to: "id" },
  { table: "release_report_artifacts", from: "artifact_id", targetTable: "artifacts", to: "id" }
];

export const sqliteRequiredChecks = [
  { table: "runs", contains: "status IN ('queued','running','succeeded','failed','cancelled','skipped','waiting_approval')" },
  { table: "node_runs", contains: "status IN ('queued','running','succeeded','failed','cancelled','skipped','waiting_approval')" },
  { table: "run_commands", contains: "status IN ('queued','running','waiting_approval','succeeded','failed','cancelled')" },
  { table: "run_commands", contains: "current_step IS NULL OR current_step IN ('research_resolution','requirement_resolution','revise_plan','preflight_judgment','context_snapshot','release_report','node_execution')" },
  { table: "run_command_steps", contains: "status IN ('queued','running','waiting_approval','succeeded','failed','cancelled')" },
  { table: "run_command_steps", contains: "mode IN ('research_resolution','requirement_resolution','revise_plan','preflight_judgment','context_snapshot','release_report','node_execution')" },
  { table: "run_rooms", contains: "status IN ('open','completed','failed','cancelled')" },
  { table: "run_interjections", contains: "target IN ('manager')" },
  { table: "manager_commands", contains: "action IN ('dispatch_worker_task','request_human_action','cancel_worker_task','summarize_run_room','complete_run_room')" },
  { table: "manager_commands", contains: "status IN ('queued','running','waiting_user','succeeded','failed','cancelled')" },
  { table: "worker_tasks", contains: "status IN ('queued','running','waiting_user','succeeded','failed','cancelled')" },
  { table: "human_action_requests", contains: "source_context_type IN ('run_room','executive_chat','blueprint_governance')" },
  { table: "human_action_requests", contains: "response_intent IN ('decision_required','reply_required','review_required')" },
  { table: "human_action_requests", contains: "status IN ('pending','responded','closed','cancelled')" },
  { table: "agent_output_events", contains: "owner_type IN ('chat_session','run_room','manager_thread','worker_task','human_action_request')" },
  { table: "agent_output_events", contains: "actor_type IN ('user','ceo','leader','manager','worker','system')" },
  { table: "agent_output_events", contains: "kind IN ('message_started','message_delta','message_completed','runtime_state','tool_state','message_failed')" },
  { table: "agent_output_events", contains: "sequence >= 1" },
  { table: "node_execution_sessions", contains: "policy IN ('refresh_per_run','refresh_per_round','preserve_across_rounds')" },
  { table: "node_execution_sessions", contains: "status IN ('active','paused','completed','failed','unavailable','fallback')" },
  { table: "approval_discussion_bindings", contains: "mode IN ('none','message_only','executor')" },
  { table: "approval_discussion_bindings", contains: "route IN ('none','message_only','agent_approval','requirement_agent','requirement_manager','release_report_manager','function_manager','function_summary')" },
  { table: "approval_discussion_bindings", contains: "executor_actor IS NULL OR executor_actor IN ('agent','manager','system')" },
  { table: "approval_discussion_bindings", contains: "executor_kind IS NULL OR executor_kind IN ('none','message_only','agent_approval','requirement_agent','requirement_manager','release_report_manager','function_manager','function_summary')" },
  { table: "approval_requests", contains: "status IN ('pending','approved','rejected','replied','completed','terminated','superseded')" },
  { table: "approval_threads", contains: "status IN ('open','closed')" },
  { table: "approval_decisions", contains: "actor IN ('user','system','manager')" },
  { table: "artifacts", contains: "kind IN ('html','markdown','json','file','link')" },
  { table: "artifacts", contains: "preview_policy IN ('none','source','sandboxed_iframe')" },
  { table: "artifacts", contains: "status IN ('current','rejected','superseded','failed')" },
  { table: "release_reports", contains: "version >= 1" }
];
