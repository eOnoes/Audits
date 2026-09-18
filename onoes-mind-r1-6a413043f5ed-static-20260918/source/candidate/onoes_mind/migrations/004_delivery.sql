CREATE TABLE a2a_agents(
    agent_id TEXT PRIMARY KEY,
    signing_key BLOB NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
    can_receive INTEGER NOT NULL DEFAULT 1 CHECK(can_receive IN (0,1))
);

CREATE TABLE a2a_permissions(
    agent_id TEXT NOT NULL REFERENCES a2a_agents(agent_id),
    message_type TEXT NOT NULL,
    PRIMARY KEY(agent_id, message_type)
);

CREATE TABLE outbox_messages(
    outbox_id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL,
    sender TEXT NOT NULL REFERENCES a2a_agents(agent_id),
    receiver TEXT NOT NULL REFERENCES a2a_agents(agent_id),
    message_type TEXT NOT NULL,
    envelope_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('PENDING','IN_FLIGHT','SENT','RETRY_WAIT','DEAD_LETTER')),
    attempts INTEGER NOT NULL DEFAULT 0,
    lease_owner TEXT,
    lease_expires_at REAL,
    next_attempt_at REAL,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TEXT,
    UNIQUE(sender, idempotency_key)
);
CREATE INDEX outbox_claim_index ON outbox_messages(state, next_attempt_at, created_at);

CREATE TABLE inbox_messages(
    message_id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL,
    sender TEXT NOT NULL REFERENCES a2a_agents(agent_id),
    receiver TEXT NOT NULL REFERENCES a2a_agents(agent_id),
    message_type TEXT NOT NULL,
    envelope_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('RECEIVED','ACKED','REJECTED')),
    ack_id TEXT,
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TEXT,
    UNIQUE(receiver, idempotency_key)
);

CREATE TABLE a2a_nonces(
    receiver TEXT NOT NULL REFERENCES a2a_agents(agent_id),
    nonce TEXT NOT NULL,
    message_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(receiver, nonce)
);

CREATE TABLE delivery_receipts(
    receipt_id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL UNIQUE REFERENCES outbox_messages(message_id),
    status TEXT NOT NULL CHECK(status IN ('PENDING','ACKED','RETRY_WAIT','DEAD_LETTER')),
    attempts INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
