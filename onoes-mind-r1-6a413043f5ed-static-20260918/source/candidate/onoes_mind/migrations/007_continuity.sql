CREATE TABLE continuity_sessions(
    session_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    canonical_repo_path TEXT NOT NULL,
    build_plan_version TEXT NOT NULL,
    phase TEXT NOT NULL,
    stage TEXT NOT NULL,
    task_objective TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('ACTIVE','INTERRUPTED','RESUMED','COMPLETED','BLOCKED')),
    current_worker TEXT,
    lease_epoch INTEGER NOT NULL DEFAULT 0,
    checkpoint_json TEXT NOT NULL,
    next_action TEXT NOT NULL,
    blockers_json TEXT NOT NULL,
    risks_json TEXT NOT NULL,
    handoff_json TEXT NOT NULL,
    audit_before_resume TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE continuity_leases(
    lease_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES continuity_sessions(session_id),
    agent_id TEXT NOT NULL REFERENCES principals(principal_id),
    lease_epoch INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('ACTIVE','INTERRUPTED','COMPLETED','REJECTED')),
    takeover_of TEXT REFERENCES continuity_leases(lease_id),
    claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    released_at TEXT,
    UNIQUE(session_id, lease_epoch)
);

CREATE TABLE continuity_manifest(
    session_id TEXT NOT NULL REFERENCES continuity_sessions(session_id),
    path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('INSPECTED','CHANGED')),
    PRIMARY KEY(session_id, path)
);

CREATE TABLE continuity_test_receipts(
    receipt_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES continuity_sessions(session_id),
    agent_id TEXT NOT NULL,
    test_name TEXT NOT NULL,
    result TEXT NOT NULL CHECK(result IN ('PASS','BLOCKED')),
    evidence_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE continuity_memory(
    memory_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES continuity_sessions(session_id),
    agent_id TEXT NOT NULL,
    scope_code TEXT NOT NULL,
    claim TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(session_id, agent_id, payload_hash)
);

CREATE TABLE continuity_skill_candidates(
    candidate_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES continuity_sessions(session_id),
    agent_id TEXT NOT NULL,
    scope_code TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    rationale TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('CANDIDATE','REJECTED','APPROVED')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX continuity_lease_claim_index ON continuity_leases(session_id, state, lease_epoch);
