ALTER TABLE neurons ADD COLUMN project_id TEXT NOT NULL DEFAULT 'onoes-mind';
ALTER TABLE neurons ADD COLUMN importance REAL NOT NULL DEFAULT 0.5;
ALTER TABLE neurons ADD COLUMN confidence REAL NOT NULL DEFAULT 0.5;
ALTER TABLE neurons ADD COLUMN freshness_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE neurons ADD COLUMN provenance_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE neurons ADD COLUMN artifact_ref TEXT;

CREATE TABLE reviewer_capabilities(
    capability TEXT PRIMARY KEY,
    reviewer_id TEXT NOT NULL,
    model_version TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
    deterministic INTEGER NOT NULL DEFAULT 0 CHECK(deterministic IN (0,1))
);

CREATE TABLE audit_pipelines(
    pipeline_id TEXT PRIMARY KEY,
    work_code TEXT NOT NULL REFERENCES work_items(work_code),
    agent_id TEXT NOT NULL REFERENCES principals(principal_id),
    project_id TEXT NOT NULL,
    current_state TEXT NOT NULL CHECK(current_state IN ('PENDING','RUNNING','BLOCKED','COMPLETED','FAILED')),
    current_stage TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_stage_runs(
    stage_run_id TEXT PRIMARY KEY,
    pipeline_id TEXT NOT NULL REFERENCES audit_pipelines(pipeline_id),
    stage_code TEXT NOT NULL,
    sequence_no INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('PENDING','RUNNING','BLOCKED','SUCCEEDED','FAILED')),
    assigned_capability TEXT NOT NULL,
    reviewer_id TEXT,
    input_artifact_ref TEXT,
    output_artifact_ref TEXT,
    handoff_artifact_ref TEXT,
    verdict TEXT,
    findings_json TEXT,
    severity TEXT,
    confidence REAL,
    provenance_json TEXT,
    receipt_id TEXT,
    error_code TEXT,
    UNIQUE(pipeline_id, stage_code),
    UNIQUE(pipeline_id, sequence_no)
);

CREATE TABLE handoff_artifacts(
    handoff_id TEXT PRIMARY KEY,
    pipeline_id TEXT NOT NULL REFERENCES audit_pipelines(pipeline_id),
    from_stage TEXT NOT NULL,
    to_stage TEXT NOT NULL,
    artifact_ref TEXT NOT NULL REFERENCES artifacts(artifact_id),
    payload_hash TEXT NOT NULL,
    receipt_id TEXT NOT NULL REFERENCES receipts(receipt_id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX audit_stage_claim_index ON audit_stage_runs(pipeline_id, sequence_no, state);
