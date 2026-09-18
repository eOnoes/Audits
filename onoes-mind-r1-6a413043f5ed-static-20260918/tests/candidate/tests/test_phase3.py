import json
import hashlib
import hmac
import sqlite3
import time

import pytest

from onoes_mind import Ledger, LedgerError
from onoes_mind.ledger import _canonical


def make_ledger():
    ledger = Ledger()
    ledger.create_principal("operator")
    ledger.register_a2a_agent("worker", b"worker-secret-16", can_send=("STAGE_RESULT",), can_receive=True)
    ledger.register_a2a_agent("receiver", b"receiver-secret-16", can_send=("ACK",), can_receive=True)
    return ledger


def test_phase3_schema_and_completion_enqueues_outbox_atomically():
    ledger = make_ledger()
    ledger.create_work_item("w", "operator", "onoes", "audit", "idem", "receiver", "inbox-audits")
    ledger.add_stage("w", "structure", 1, "synthetic")
    claim = ledger.claim_stage("worker")
    result = ledger.complete_stage(claim["stage_execution_id"], "worker", claim["lease_version"], {"verdict": "PASS"})
    rows = ledger.db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('outbox_messages','inbox_messages','a2a_nonces','delivery_receipts') ORDER BY name").fetchall()
    assert [r[0] for r in rows] == ["a2a_nonces", "delivery_receipts", "inbox_messages", "outbox_messages"]
    outbox = ledger.db.execute("SELECT * FROM outbox_messages").fetchone()
    assert outbox["state"] == "PENDING"
    assert outbox["message_id"] == result["message_id"]
    assert json.loads(outbox["envelope_json"])["receiver"] == "receiver"


def test_authenticated_authorized_expiring_and_replayed_messages_fail_closed():
    ledger = make_ledger()
    envelope = ledger.build_a2a_envelope("worker", "receiver", "STAGE_RESULT", {"ok": True}, ttl_seconds=30)
    accepted = ledger.receive_a2a(envelope, "receiver")
    assert accepted["status"] == "accepted"
    duplicate = ledger.receive_a2a(envelope, "receiver")
    assert duplicate["status"] == "duplicate"
    tampered = dict(envelope, payload={"ok": False})
    with pytest.raises(LedgerError, match="payload hash"):
        ledger.receive_a2a(tampered, "receiver")
    unauthorized = ledger.build_a2a_envelope("worker", "receiver", "ADMIN_PURGE", {}, ttl_seconds=30)
    with pytest.raises(LedgerError, match="unauthorized"):
        ledger.receive_a2a(unauthorized, "receiver")
    expired = ledger.build_a2a_envelope("worker", "receiver", "STAGE_RESULT", {}, ttl_seconds=30)
    expired["expires_at"] = "2000-01-01T00:00:00Z"
    expired["signature"] = hmac.new(b"worker-secret-16", _canonical(ledger._a2a_body(expired)).encode(), hashlib.sha256).hexdigest()
    with pytest.raises(LedgerError, match="expired"):
        ledger.receive_a2a(expired, "receiver")


def test_outbox_dispatch_happens_after_commit_and_ack_is_idempotent():
    ledger = make_ledger()
    ledger.create_work_item("w", "operator", "onoes", "audit", "idem", "receiver", "inbox")
    ledger.add_stage("w", "structure", 1, "synthetic")
    claim = ledger.claim_stage("worker")
    result = ledger.complete_stage(claim["stage_execution_id"], "worker", claim["lease_version"], {"verdict": "PASS"})
    observations = []

    def transport(envelope):
        observations.append(ledger.db.execute("SELECT state FROM outbox_messages WHERE message_id=?", (envelope["message_id"],)).fetchone()[0])
        return ledger.receive_a2a(envelope, "receiver")

    sent = ledger.dispatch_outbox(transport)
    assert sent == 1
    assert observations == ["IN_FLIGHT"]
    assert ledger.db.execute("SELECT state FROM outbox_messages WHERE message_id=?", (result["message_id"],)).fetchone()[0] == "SENT"
    assert ledger.db.execute("SELECT status FROM delivery_receipts WHERE message_id=?", (result["message_id"],)).fetchone()[0] == "ACKED"
    assert ledger.dispatch_outbox(transport) == 0


def test_retry_and_dead_letter_preserve_delivery_attempts():
    ledger = make_ledger()
    ledger.create_work_item("w", "operator", "onoes", "audit", "idem", "receiver", "inbox")
    ledger.add_stage("w", "structure", 1, "synthetic")
    claim = ledger.claim_stage("worker")
    result = ledger.complete_stage(claim["stage_execution_id"], "worker", claim["lease_version"], {"verdict": "PASS"})
    attempts = []

    def failing(_envelope):
        attempts.append(True)
        raise TimeoutError("network timeout")

    assert ledger.dispatch_outbox(failing, max_attempts=2, backoff_seconds=0) == 0
    assert ledger.dispatch_outbox(failing, max_attempts=2, backoff_seconds=0) == 0
    row = ledger.db.execute("SELECT state,attempts,last_error FROM outbox_messages WHERE message_id=?", (result["message_id"],)).fetchone()
    assert tuple(row) == ("DEAD_LETTER", 2, "network timeout")
    assert len(attempts) == 2
    assert ledger.db.execute("SELECT status FROM delivery_receipts WHERE message_id=?", (result["message_id"],)).fetchone()[0] == "DEAD_LETTER"


def test_outbox_and_inbox_idempotency_constraints_are_database_enforced():
    ledger = make_ledger()
    with pytest.raises(sqlite3.IntegrityError):
        ledger.db.execute("INSERT INTO outbox_messages(outbox_id,message_id,idempotency_key,sender,receiver,message_type,envelope_json,payload_hash,state) VALUES ('a','m','i','worker','receiver','STAGE_RESULT','{}','h','PENDING')")
        ledger.db.execute("INSERT INTO outbox_messages(outbox_id,message_id,idempotency_key,sender,receiver,message_type,envelope_json,payload_hash,state) VALUES ('b','m','i2','worker','receiver','STAGE_RESULT','{}','h','PENDING')")


def test_completion_and_outbox_roll_back_together_on_delivery_configuration_failure():
    ledger = make_ledger()
    ledger.create_work_item("w", "operator", "onoes", "audit", "idem", "missing-agent", "inbox")
    ledger.add_stage("w", "structure", 1, "synthetic")
    claim = ledger.claim_stage("worker")
    with pytest.raises(LedgerError, match="unknown or disabled"):
        ledger.complete_stage(claim["stage_execution_id"], "worker", claim["lease_version"], {"verdict": "PASS"})
    assert ledger.get_stage(claim["stage_execution_id"])["state"] == "RUNNING"
    assert ledger.db.execute("SELECT COUNT(*) FROM neurons").fetchone()[0] == 0
    assert ledger.db.execute("SELECT COUNT(*) FROM outbox_messages").fetchone()[0] == 0
