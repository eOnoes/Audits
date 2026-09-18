import json
import sqlite3
import time

import pytest

from onoes_mind import Ledger, LedgerError, SyntheticWorkerAdapter


def make_ledger():
    ledger = Ledger()
    ledger.create_principal("operator")
    return ledger


def test_phase2_schema_and_immutable_neurons():
    ledger = make_ledger()
    work = ledger.create_work_item("w-1", "operator", "onoes", "audit", "idem-1")
    stage = ledger.add_stage(work["work_code"], "structure", 1, "synthetic")
    claim = ledger.claim_stage("worker-a", lease_seconds=30)
    result = ledger.complete_stage(claim["stage_execution_id"], "worker-a", claim["lease_version"], {"verdict": "PASS"})
    neuron = ledger.get_neuron(result["neuron_id"])
    assert neuron["neuron_id"].startswith("ON-")
    assert neuron["state_code"] == "ACTIVE"
    assert neuron["source_code"] == "ON"
    with pytest.raises(sqlite3.IntegrityError):
        ledger.db.execute("UPDATE neurons SET neuron_id='ON-99999' WHERE neuron_id=?", (neuron["neuron_id"],))


def test_parent_child_order_and_receipt_are_atomic():
    ledger = make_ledger()
    ledger.create_work_item("w-2", "operator", "onoes", "audit", "idem-2")
    ledger.add_stage("w-2", "structure", 1, "synthetic")
    claim = ledger.claim_stage("worker-a")
    completed = ledger.complete_stage(claim["stage_execution_id"], "worker-a", claim["lease_version"], {"ok": True})
    assert completed["receipt_id"]
    assert ledger.get_stage(claim["stage_execution_id"])["state"] == "SUCCEEDED"
    assert ledger.get_work("w-2")["current_state"] == "COMPLETED"
    receipt = ledger.db.execute("SELECT * FROM receipts WHERE receipt_id=?", (completed["receipt_id"],)).fetchone()
    assert receipt["stage_execution_id"] == claim["stage_execution_id"]
    assert receipt["record_id"] == completed["neuron_id"]


def test_fenced_lease_rejects_late_worker_and_duplicate_completion():
    ledger = make_ledger()
    ledger.create_work_item("w-3", "operator", "onoes", "audit", "idem-3")
    ledger.add_stage("w-3", "structure", 1, "synthetic")
    first = ledger.claim_stage("worker-a", lease_seconds=1)
    time.sleep(1.05)
    recovered = ledger.recover_expired_leases(now=time.time())
    second = ledger.claim_stage("worker-b")
    with pytest.raises(LedgerError, match="stale lease"):
        ledger.complete_stage(first["stage_execution_id"], "worker-a", first["lease_version"], {"late": True})
    done = ledger.complete_stage(second["stage_execution_id"], "worker-b", second["lease_version"], {"ok": True})
    with pytest.raises(LedgerError, match="not running"):
        ledger.complete_stage(second["stage_execution_id"], "worker-b", second["lease_version"], {"duplicate": True})
    assert recovered == 1
    assert done["receipt_id"]


def test_retry_preserves_attempt_history_and_dead_letters():
    ledger = make_ledger()
    ledger.create_work_item("w-4", "operator", "onoes", "audit", "idem-4")
    ledger.add_stage("w-4", "structure", 1, "synthetic")
    claim = ledger.claim_stage("worker-a")
    retry = ledger.fail_stage(claim["stage_execution_id"], "worker-a", claim["lease_version"], "timeout", retryable=True, max_attempts=2)
    assert retry["state"] == "RETRY_WAIT"
    next_claim = ledger.claim_stage("worker-b", now=time.time() + 100)
    dead = ledger.fail_stage(next_claim["stage_execution_id"], "worker-b", next_claim["lease_version"], "timeout", retryable=True, max_attempts=2)
    assert dead["state"] == "DEAD_LETTER"
    rows = ledger.db.execute("SELECT attempt_no,state FROM stage_executions WHERE work_code='w-4' ORDER BY attempt_no").fetchall()
    assert [(r["attempt_no"], r["state"]) for r in rows] == [(1, "FAILED"), (2, "DEAD_LETTER")]


def test_idempotent_work_and_quarantine_exclusion():
    ledger = make_ledger()
    one = ledger.create_work_item("w-5", "operator", "onoes", "audit", "same")
    two = ledger.create_work_item("w-5-other", "operator", "onoes", "audit", "same")
    assert one["work_code"] == two["work_code"] == "w-5"
    ledger.db.execute("INSERT INTO neurons(neuron_id,source_code,sequence_no,state_code,scope_code,visibility_code,memory_type,claim) VALUES ('ON-00001','ON',1,'ACTIVE','project/onoes-mind/shared','QUARANTINE','fact','secret')")
    assert all(row["visibility_code"] != "QUARANTINE" for row in ledger.build_context_pack("w-5", "operator", token_budget=100)["selected_neurons"])


def test_synthetic_adapter_is_deterministic():
    a = make_ledger()
    b = make_ledger()
    for ledger in (a, b):
        ledger.create_work_item("w-6", "operator", "onoes", "audit", "idem-6")
        ledger.add_stage("w-6", "structure", 1, "synthetic")
    first = SyntheticWorkerAdapter(a, "synthetic").run_once()
    second = SyntheticWorkerAdapter(b, "synthetic").run_once()
    assert first["output_payload_hash"] == second["output_payload_hash"]
    assert json.loads(first["output_payload"]) == json.loads(second["output_payload"])
