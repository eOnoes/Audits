ALTER TABLE receipts ADD COLUMN work_code TEXT;
ALTER TABLE receipts ADD COLUMN stage_execution_id TEXT;

CREATE TABLE neurons(
    neuron_id TEXT PRIMARY KEY,
    source_code TEXT NOT NULL,
    sequence_no INTEGER NOT NULL,
    state_code TEXT NOT NULL CHECK(state_code IN ('ACTIVE','SUPERSEDED','QUARANTINED','DELETED')),
    scope_code TEXT NOT NULL,
    visibility_code TEXT NOT NULL,
    memory_type TEXT NOT NULL,
    claim TEXT NOT NULL,
    supersedes_neuron_id TEXT REFERENCES neurons(neuron_id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_code, sequence_no)
);
CREATE TRIGGER neurons_immutable_identity
BEFORE UPDATE OF neuron_id, source_code, sequence_no ON neurons
BEGIN SELECT RAISE(ABORT, 'neuron identity is immutable'); END;

CREATE TABLE work_items(
    work_code TEXT PRIMARY KEY,
    requester TEXT NOT NULL REFERENCES principals(principal_id),
    project TEXT NOT NULL,
    pipeline TEXT NOT NULL,
    requested_delivery_target TEXT,
    requested_delivery_channel TEXT,
    current_state TEXT NOT NULL CHECK(current_state IN ('PENDING','RUNNING','COMPLETED','FAILED','BLOCKED','CANCELLED','DEAD_LETTER')),
    current_stage TEXT,
    correlation_id TEXT NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(requester, idempotency_key)
);

CREATE TABLE stage_executions(
    stage_execution_id TEXT PRIMARY KEY,
    work_code TEXT NOT NULL REFERENCES work_items(work_code),
    stage_code TEXT NOT NULL,
    sequence_no INTEGER NOT NULL,
    attempt_no INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('PENDING','RUNNING','SUCCEEDED','FAILED','RETRY_WAIT','RECOVERABLE','DEAD_LETTER','CANCELLED')),
    assigned_capability TEXT NOT NULL,
    lease_owner TEXT,
    lease_version INTEGER NOT NULL DEFAULT 0,
    lease_expires_at REAL,
    row_version INTEGER NOT NULL DEFAULT 0,
    input_context_ref TEXT,
    output_artifact_ref TEXT,
    output_payload_hash TEXT,
    receipt_ref TEXT REFERENCES receipts(receipt_id),
    error_code TEXT,
    next_attempt_at REAL,
    started_at TEXT,
    completed_at TEXT,
    UNIQUE(work_code, stage_code, attempt_no)
);
CREATE INDEX stage_claim_index ON stage_executions(state, next_attempt_at, sequence_no);

CREATE TABLE artifacts(
    artifact_id TEXT PRIMARY KEY,
    artifact_hash TEXT NOT NULL UNIQUE,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE capability_registry(
    capability TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    version TEXT NOT NULL,
    deterministic INTEGER NOT NULL DEFAULT 0
);
