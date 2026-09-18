CREATE TABLE hardening_state(
    state_key TEXT PRIMARY KEY,
    state_value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE activation_checks(
    check_name TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK(status IN ('PASS','CONDITIONAL','BLOCKED')),
    detail TEXT NOT NULL,
    checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE retry_budget_events(
    event_id TEXT PRIMARY KEY,
    principal_id TEXT,
    lane TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO hardening_state(state_key, state_value) VALUES
 ('shared_mutations', 'ALLOW'), ('degraded_alert', 'NONE'), ('writer_mode', 'WRITE');
