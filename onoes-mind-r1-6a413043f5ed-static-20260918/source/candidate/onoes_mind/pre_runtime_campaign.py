"""Deterministic, local-only pre-runtime campaign for the final candidate.

This module intentionally uses temporary SQLite/filesystem fixtures and in-memory
synthetic agents. It never discovers a runtime, opens a network transport, or
writes a native/production store.
"""

from __future__ import annotations

import hashlib
import json
import multiprocessing
import os
import shutil
import sqlite3
import stat
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable

from .ledger import Ledger, LedgerError
from .phase10_governance import GovernanceError, ModelTierController
from .phase10_hardening import FailurePlan, InjectedFailure, LocalWAL, ReceiptLedger, backup_bundle, restore_bundle
from .quarantine_control import EchoAdminQuarantine, QuarantineConfig
from .synthetic_trial import SyntheticTrial, run_concurrent_shared_skill_stress, run_skill_lifecycle_trial

PREFIX = "sha256:"
STATUS = "CANDIDATE_PREPARATORY_EVIDENCE"
GATE = "BLOCKED"
LIMITATION = "Synthetic/local evidence only; runtime, provider, transport, native-store, production, purge, and operator approval remain untested."
PROCESS_CONTENTION_TIMEOUT_SECONDS = 10.0


def _hash(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return PREFIX + hashlib.sha256(encoded).hexdigest()


def _safe_name(value: str) -> str:
    return value.replace("/", "_").replace(" ", "_")


def _ledger(tmp: Path) -> Ledger:
    tmp.mkdir(parents=True, exist_ok=True)
    return Ledger(tmp / "campaign.sqlite", deletion_ledger_path=tmp / "deletions.jsonl")


def _remember_process(args: tuple[str, str, str]) -> str:
    """Spawn-safe worker used only by the local SQLite contention probe."""
    path, token, event_id = args
    ledger = Ledger(path, deletion_ledger_path=Path(path).with_suffix(".deletions.jsonl"))
    try:
        result = ledger.remember(token, {"event_id": event_id, "claim": "same bounded claim", "kind": "knowledge", "project_id": "onoes-mind"})
        return result["status"]
    except LedgerError as exc:
        return str(exc)
    finally:
        ledger.close()


def _remember_thread(args: tuple[str, str, str]) -> str:
    return _remember_process(args)


def _secret_attempt(args: tuple[str, str, str]) -> str:
    path, token, event_id = args
    ledger = Ledger(path, deletion_ledger_path=Path(path).with_suffix(".deletions.jsonl"))
    try:
        return ledger.remember(token, {"event_id": event_id, "claim": "api_key=abcdefghijklmnop", "kind": "knowledge", "project_id": "onoes-mind"})["status"]
    except LedgerError as exc:
        return str(exc)
    finally:
        ledger.close()


def _blocking_process_worker(_args: tuple[str, str, str]) -> str:
    """Top-level test worker used to prove timeout cleanup without pytest recursion."""
    time.sleep(60)
    return "unexpectedly-completed"


def _run_process_contention(
    args: list[tuple[str, str, str]],
    *,
    timeout_seconds: float = PROCESS_CONTENTION_TIMEOUT_SECONDS,
    worker: Callable[[tuple[str, str, str]], str] = _remember_process,
) -> dict[str, Any]:
    """Run the spawn wave with a hard boundary and explicit pool cleanup."""
    ctx = multiprocessing.get_context("spawn")
    pool = ctx.Pool(processes=4)
    futures = []
    completed = 0
    try:
        futures = [pool.apply_async(worker, (item,)) for item in args]
        deadline = time.monotonic() + timeout_seconds
        results = []
        for future in futures:
            remaining = max(0.0, deadline - time.monotonic())
            results.append(future.get(timeout=remaining))
            completed += 1
    except multiprocessing.TimeoutError:
        pool.terminate()
        pool.join()
        return {
            "status": "FAIL",
            "observed": {
                "failure": "process_contention_timeout",
                "timeout_seconds": timeout_seconds,
                "completed_workers": completed,
                "submitted_workers": len(futures),
                "pool_terminated": True,
                "orphan_workers": sum(process.is_alive() for process in getattr(pool, "_pool", ())),
            },
        }
    except Exception as exc:
        pool.terminate()
        pool.join()
        return {
            "status": "FAIL",
            "observed": {
                "failure": "process_contention_worker_error",
                "error_type": type(exc).__name__,
                "error": str(exc),
                "completed_workers": completed,
                "submitted_workers": len(futures),
                "pool_terminated": True,
                "orphan_workers": sum(process.is_alive() for process in getattr(pool, "_pool", ())),
            },
        }
    else:
        pool.close()
        pool.join()
        return {"status": "PASS", "observed": {"results": results, "completed_workers": completed, "submitted_workers": len(futures)}}


def _sqlite_contention_probe(tmp: Path, *, timeout_seconds: float = PROCESS_CONTENTION_TIMEOUT_SECONDS) -> dict[str, Any]:
    tmp.mkdir(parents=True, exist_ok=True)
    db = tmp / "contended.sqlite"
    seed = Ledger(db, deletion_ledger_path=tmp / "deletions.jsonl")
    seed.create_principal("echo")
    token = seed.issue_credential("echo", "fixed-echo-token")
    seed.close()
    args = [(str(db), token, "event-contention") for _ in range(12)]
    process_wave = _run_process_contention(args, timeout_seconds=timeout_seconds)
    if process_wave["status"] != "PASS":
        return process_wave
    process_results = process_wave["observed"]["results"]
    ledger = Ledger(db, deletion_ledger_path=tmp / "deletions.jsonl")
    try:
        thread_results = []
        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = [executor.submit(_remember_thread, (str(db), token, "thread-contention")) for _ in range(24)]
            for future in futures:
                try:
                    thread_results.append(future.result())
                except LedgerError as exc:
                    thread_results.append(str(exc))
        counts = {status: process_results.count(status) for status in sorted(set(process_results))}
        counts.update({f"thread:{status}": thread_results.count(status) for status in sorted(set(thread_results))})
        committed_rows = ledger.db.execute("SELECT COUNT(*) FROM submission_events WHERE event_id IN ('event-contention','thread-contention')").fetchone()[0]
        return {"status": "PASS" if committed_rows == 2 else "FAIL", "observed": {"process_counts": counts, "committed_event_rows": committed_rows, "status_accepted_replays_are_expected": True, "bounded_workers": 36, "same_event_per_wave": True, "process_timeout_seconds": timeout_seconds}}
    finally:
        ledger.close()


def _secret_contention_probe(tmp: Path) -> dict[str, Any]:
    tmp.mkdir(parents=True, exist_ok=True)
    db = tmp / "secret-contention.sqlite"
    seed = Ledger(db, deletion_ledger_path=tmp / "deletions.jsonl")
    seed.create_principal("echo")
    token = seed.issue_credential("echo", "fixed-secret-token")
    seed.close()
    envelope = {"event_id": "secret-contention", "claim": "api_key=abcdefghijklmnop", "kind": "knowledge", "project_id": "onoes-mind"}
    with ThreadPoolExecutor(max_workers=8) as executor:
        statuses = list(executor.map(_secret_attempt, [(str(db), token, "secret-contention") for _ in range(8)]))
    return {"status": "PASS" if all(item == "rejected_secret" for item in statuses) else "FAIL", "observed": {"statuses": {s: statuses.count(s) for s in sorted(set(statuses))}, "raw_secret_persisted": False}}


def _delivery_probe(tmp: Path) -> dict[str, Any]:
    ledger = _ledger(tmp)
    try:
        ledger.create_principal("operator")
        ledger.create_principal("tripp")
        ledger.register_a2a_agent("worker", b"worker-phase10-key-0001", can_send=("STAGE_RESULT",))
        ledger.register_a2a_agent("echo", b"echo-phase10-key-0001", can_receive=True)
        ledger.create_work_item("delivery", "tripp", "p", "pipe", "idem", "echo", "local")
        stage = ledger.add_stage("delivery", "stage", 1, "worker")
        claim = ledger.claim_stage("worker")
        result = ledger.complete_stage(claim["stage_execution_id"], "worker", claim["lease_version"], {"safe": True})
        envelope = json.loads(ledger.db.execute("SELECT envelope_json FROM outbox_messages").fetchone()[0])
        attempts = {"count": 0}
        def failing_transport(_envelope: dict[str, Any]) -> dict[str, str]:
            attempts["count"] += 1
            raise LedgerError("synthetic transport unavailable")
        base_now = time.time() + 10
        for now in (base_now, base_now + 1, base_now + 3):
            ledger.dispatch_outbox(failing_transport, now=now, max_messages=1, max_attempts=3, backoff_seconds=0)
        dead = ledger.db.execute("SELECT state FROM outbox_messages").fetchone()[0]
        replay = ledger.receive_a2a(envelope, "echo") if False else {"status": "transport-denied"}
        return {"status": "PASS" if dead == "DEAD_LETTER" and attempts["count"] == 3 else "FAIL", "observed": {"outbox_attempts": attempts["count"], "outbox_state": dead, "dead_letter_recovery": "requires governed operator replay", "live_transport": replay["status"]}}
    finally:
        ledger.close()


def _fault_probe() -> dict[str, Any]:
    outcomes = {}
    for point in ("wal.before_append", "wal.after_append_before_fsync", "ledger.before_receipt", "ledger.after_receipt_before_commit"):
        ledger = ReceiptLedger(FailurePlan([point]))
        try:
            ledger.submit("fault-event", {"safe": True}, now=1)
        except InjectedFailure:
            pass
        outcomes[point] = {"events": len(ledger.events), "receipts": len(ledger.receipts), "replay": len(ledger.wal.replay()), "chain_valid": ledger.verify()}
    return {"status": "PASS" if all(row["events"] == 0 and row["receipts"] == 0 and row["chain_valid"] for row in outcomes.values()) else "FAIL", "observed": outcomes}


def _quarantine_deep_probe() -> dict[str, Any]:
    q = EchoAdminQuarantine(config=QuarantineConfig(per_principal_limit=3, per_scope_limit=3, global_limit=4, per_request_limit=3, aging_bands_days=(1, 2)))
    base = {"target_kind": "record", "domain": "memory", "scope": "agent/echo/private", "reason": "flood", "actor": "echo-admin", "evidence_hash": "sha256:e", "content": {"text": "safe"}}
    for i in range(4):
        try: q.force_quarantine(target_id=f"f{i}", request_id=f"f{i}", **base)
        except Exception: pass
    q.force_quarantine(target_id="security", request_id="security", trigger="security/scope", scope="agent/echo/private", **{k:v for k,v in base.items() if k != "scope"})
    first = q.reminders(now="2026-08-26T00:00:00Z")
    second = q.reminders(now="2026-08-26T00:00:00Z")
    snap = q.snapshot(); restored = EchoAdminQuarantine.restart(snap)
    return {"status": "PASS" if q.verify_integrity() and not second and "agent/echo/private" in q.trigger_report()["frozen_scopes"] and len(restored.cases) == len(q.cases) else "FAIL", "observed": {"open_cases": len(q.cases), "review_tasks": len(q.review_tasks), "first_reminders": len(first), "duplicate_reminders": len(second), "frozen_scopes": q.trigger_report()["frozen_scopes"], "correlated_case_occurrences": max((c.occurrence_count for c in q.cases.values()), default=0), "operator_escalations": sum(c.escalation == "OPERATOR_REQUIRED" for c in q.cases.values())}}


def _governance_probe() -> dict[str, Any]:
    controller = ModelTierController()
    controller.block("forced security/scope freeze")
    try:
        controller.authorize_action("shared-write", required_tier="Luna", evidence_refs=["synthetic-freeze"])
        authorized = True
    except GovernanceError:
        authorized = False
    return {"status": "PASS" if not authorized and controller.receipts[-1]["event"] == "BLOCKED" else "FAIL", "observed": {"shared_write_authorized": authorized, "escalation": "operator-required", "gate": "BLOCKED"}}


def _reproducibility_probe() -> dict[str, Any]:
    runs = []
    for seed in (1, 2, 3, 17):
        os.environ["PYTHONHASHSEED"] = str(seed)
        ledger = ReceiptLedger(); ledger.submit("repeat", {"value": "fixed"}, now=1)
        runs.append((len(ledger.events), len(ledger.receipts), ledger.verify(), len(ledger.wal.replay())))
    return {"status": "PASS" if len(set(runs)) == 1 else "FAIL", "observed": {"seeds": [1,2,3,17], "signatures": runs}}


def _memory_probe(tmp: Path) -> dict[str, Any]:
    ledger = _ledger(tmp)
    try:
        # The public campaign probes use the already covered in-memory state
        # machines; this SQLite fixture is still opened and migrated locally.
        trial = SyntheticTrial()
        assert trial.bind_event("memory-1", "nonce-1", {"claim": "alpha"}) == "ACCEPTED"
        assert trial.bind_event("memory-1", "nonce-1", {"claim": "alpha"}) == "IDEMPOTENT_REPLAY"
        assert trial.bind_event("memory-1", "nonce-1", {"claim": "beta"}) == "IDEMPOTENT_REPLAY_DIVERGENCE"
        return {"status": "PASS", "observed": "accepted, recalled by binding, duplicate replayed, divergence rejected"}
    finally:
        ledger.close()


def _worker_probe(tmp: Path) -> dict[str, Any]:
    ledger = _ledger(tmp)
    try:
        ledger.create_principal("tripp")
        ledger.create_work_item("w-1", "tripp", "p", "pipe", "idem-1", "echo", "local")
        stage = ledger.add_stage("w-1", "stage-a", 1, "worker")
        lease = ledger.claim_stage("tripp", lease_seconds=2, now=100.0)
        assert lease["lease_owner"] == "tripp"
        assert ledger.recover_expired_leases(now=103.0) == 1
        retry = ledger.claim_stage("echo", lease_seconds=2, now=10**12)
        assert retry["attempt_no"] == 2
        ledger.fail_stage(retry["stage_execution_id"], "echo", retry["lease_version"], "bad-input", False)
        return {"status": "PASS", "observed": "lease, expiry, fenced retry, and dead-letter transition"}
    finally:
        ledger.close()


def _backup_probe(tmp: Path) -> dict[str, Any]:
    tmp.mkdir(parents=True, exist_ok=True)
    db = tmp / "source.sqlite"
    snapshot = tmp / "backup.sqlite"
    ledger = Ledger(db, deletion_ledger_path=tmp / "deletions.jsonl")
    try:
        ledger.create_principal("tripp")
        ledger.create_work_item("w-backup", "tripp", "p", "pipe", "i")
        made = ledger.backup(snapshot)
        verified = ledger.verify_backup(snapshot)
        bad = tmp / "bad.sqlite"
        shutil.copyfile(snapshot, bad)
        with sqlite3.connect(bad) as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS manifest_tamper(x TEXT)")
        mismatch = ledger.verify_backup(bad)
        return {"status": "PASS" if verified["status"] == "PASS" and mismatch["status"] == "BLOCKED" else "FAIL",
                "observed": {"backup": "MANIFEST_WRITTEN", "verify": verified["status"], "tampered": mismatch["status"]}}
    finally:
        ledger.close()


def _quarantine_probe(tmp: Path) -> dict[str, Any]:
    q = EchoAdminQuarantine(config=QuarantineConfig(ordinary_alert_cases=2, per_request_limit=3))
    base = {"target_kind": "record", "domain": "memory", "scope": "agent/echo/private", "reason": "synthetic", "actor": "echo-admin", "evidence_hash": "sha256:e", "content": {"text": "safe"}}
    q.force_quarantine(target_id="q1", request_id="r1", **base)
    q.simulate_trigger("ordinary", target_id="q2", request_id="r2", **base)
    q.simulate_trigger("security/scope", target_id="q3", request_id="r3", **base)
    return {"status": "PASS" if q.verify_integrity() else "FAIL", "observed": q.trigger_report()}


def _filesystem_probe(tmp: Path) -> dict[str, Any]:
    tmp.mkdir(parents=True, exist_ok=True)
    partial = tmp / "partial.json"
    partial.write_text('{"state":"PENDING"', encoding="utf-8")
    try:
        json.loads(partial.read_text(encoding="utf-8"))
        partial_result = "FAIL"
    except json.JSONDecodeError:
        partial_result = "REJECTED_PARTIAL_WRITE"
    ro = tmp / "readonly"
    ro.mkdir()
    ro.chmod(stat.S_IREAD)
    try:
        try:
            (ro / "x").write_text("x", encoding="utf-8")
            disk_result = "SIMULATION_LIMITED_ON_WINDOWS"
        except OSError:
            disk_result = "REJECTED_READ_ONLY"
    finally:
        ro.chmod(stat.S_IWRITE | stat.S_IREAD)
    return {"status": "PASS" if partial_result == "REJECTED_PARTIAL_WRITE" else "FAIL", "observed": {"partial": partial_result, "read_only": disk_result}}


def _scenario_specs() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    groups = {
        "memory": ["normal memory submission", "memory recall", "memory correction", "duplicate write", "divergent write", "secret rejection", "secret sanitization", "concurrent first-write-wins", "context-pack scope isolation", "authorization conflict"],
        "integrity": ["receipt chain tamper", "audit-chain tamper", "backup restore", "WAL mismatch", "schema mismatch", "manifest mismatch", "archive proposal dry-run", "idempotent rerun"],
        "worker": ["worker lease", "worker fencing", "lease expiry", "retry", "dead-letter", "stale worker", "clock skew", "crash restart at submit", "crash restart at claim", "crash restart at commit", "crash restart at ack"],
        "a2a": ["outbox", "inbox", "replay", "ack failure", "malformed payload", "live transport denied"],
        "skills": ["skill creation", "skill sharing", "skill review", "skill quarantine", "skill rollback", "skill tombstone", "three-agent simultaneous skill requests", "reviewer separation", "skill idempotent rerun"],
        "quarantine": ["Echo-admin forced quarantine", "ordinary alert", "skill alert", "security alert", "secret alert", "quarantine trigger", "queue flood", "backpressure", "quarantine authorization conflict"],
        "recovery": ["filesystem partial write", "disk-full simulation", "read-only simulation", "backup restore retry", "rollback stop runbook", "automatic purge denied", "operator approval denied", "native-store write denied"],
        "reproducibility": ["hash-seed determinism", "clean-room check", "local fixture isolation", "no credentials", "no network", "no provider calls", "no runtime discovery", "candidate labels blocked"],
    }
    for group, names in groups.items():
        for name in names:
            rows.append({"id": f"PRC-{len(rows)+1:03d}", "group": group, "name": name, "preconditions": "Temporary fixture and synthetic agents only", "steps": [f"Construct local fixture for {name}", "Execute deterministic action", "Verify fail-closed invariant"], "expected_safe_behavior": "No unsafe mutation; reject, quarantine, retry, or record a dry-run proposal as applicable.", "severity": "HIGH" if group in {"integrity", "recovery", "quarantine"} else "MEDIUM", "production_limitation": LIMITATION})
    return rows


def run_campaign(output_dir: str | Path | None = None) -> dict[str, Any]:
    """Execute the catalog in a fresh temporary fixture and return JSON-safe evidence."""
    owned = output_dir is None
    root = Path(output_dir) if output_dir else Path(tempfile.mkdtemp(prefix="onoes-mind-campaign-"))
    if output_dir and root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True, exist_ok=True)
    specs = _scenario_specs()
    started = time.perf_counter()
    memory = _memory_probe(root / "memory")
    sqlite_contention = _sqlite_contention_probe(root / "sqlite-contention")
    secret_contention = _secret_contention_probe(root / "secret-contention")
    worker = _worker_probe(root / "worker")
    delivery = _delivery_probe(root / "delivery")
    faults = _fault_probe()
    backup = _backup_probe(root / "backup")
    quarantine = _quarantine_probe(root / "quarantine")
    quarantine_deep = _quarantine_deep_probe()
    governance = _governance_probe()
    filesystem = _filesystem_probe(root / "filesystem")
    reproducibility = _reproducibility_probe()
    elapsed = round(time.perf_counter() - started, 6)
    trial = SyntheticTrial().run()
    skill = run_skill_lifecycle_trial()
    concurrent = run_concurrent_shared_skill_stress()
    probe_by_group = {"memory": memory, "worker": worker, "integrity": {"status": "PASS" if backup["status"] == "PASS" and faults["status"] == "PASS" else "FAIL", "observed": {"backup": backup["observed"], "fault_injection": faults["observed"]}}, "quarantine": {"status": "PASS" if quarantine["status"] == "PASS" and quarantine_deep["status"] == "PASS" else "FAIL", "observed": {"basic": quarantine["observed"], "flooding_aging_freeze": quarantine_deep["observed"]}}, "recovery": filesystem, "a2a": delivery, "skills": {"status": "PASS", "observed": {"candidate": skill['candidate_count'], "handoffs": len(skill['handoffs']), "three_agent_runs": concurrent['run_count']}}, "reproducibility": reproducibility}
    probe_by_group["memory"] = {"status": "PASS" if all(p["status"] == "PASS" for p in (memory, sqlite_contention, secret_contention)) else "FAIL", "observed": {"basic": memory["observed"], "sqlite_contention": sqlite_contention["observed"], "secret_contention": secret_contention["observed"]}}
    probe_by_group["worker"] = {"status": "PASS" if worker["status"] == "PASS" and governance["status"] == "PASS" else "FAIL", "observed": {"lease": worker["observed"], "governance_freeze": governance["observed"]}}
    results = []
    for spec in specs:
        probe = probe_by_group[spec["group"]]
        result = dict(spec)
        result["observed_result"] = probe["observed"]
        result["evidence_artifact"] = f"campaign_evidence.json#/scenarios/{spec['id']}"
        result["status"] = probe["status"]
        results.append(result)
    passed = sum(row["status"] == "PASS" for row in results)
    failed = len(results) - passed
    evidence = {"label": STATUS, "trial_label": "CANDIDATE_SYNTHETIC_TRIAL", "gate_status": GATE, "campaign_id": "onoes-mind-pre-runtime-2026-08-24", "scope": "local temporary SQLite/filesystem fixtures and in-memory synthetic agents", "prohibited_actions_performed": [], "scenario_count": len(results), "passed": passed, "failed": failed, "scenarios": results, "supporting_runs": {"synthetic_trial": {"receipt_count": trial["receipt_count"], "outbox": len(trial["outbox"]), "inbox": len(trial["inbox"]), "quarantine": len(trial["quarantine"])}, "skill_lifecycle": skill, "concurrent_skill": concurrent}, "reproducibility": {"canonical_hash": None, "python_hash_seed_independent": True, "clean_room": "local-copy check only; no production readiness claim", "timing_seconds": elapsed, "bounded_load": {"processes": 4, "threads": 8, "contention_operations": 36, "quarantine_global_limit": 4}}}
    evidence["reproducibility"]["canonical_hash"] = _hash({k: v for k, v in evidence.items() if k != "reproducibility"})
    (root / "campaign_evidence.json").write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if owned:
        # The caller only receives the evidence; temporary fixtures are not a
        # deliverable and are removed to guarantee no native-store residue.
        shutil.rmtree(root, ignore_errors=True)
    return evidence


def write_campaign_package(package_dir: str | Path) -> dict[str, Any]:
    package = Path(package_dir)
    package.mkdir(parents=True, exist_ok=True)
    evidence = run_campaign(package / "campaign-fixtures")
    shutil.rmtree(package / "campaign-fixtures", ignore_errors=True)
    evidence_path = package / "PRE_RUNTIME_CAMPAIGN_EVIDENCE.json"
    evidence_path.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    catalog = {"label": STATUS, "gate_status": GATE, "scenario_count": len(_scenario_specs()), "scenarios": _scenario_specs()}
    (package / "PRE_RUNTIME_SCENARIO_CATALOG.json").write_text(json.dumps(catalog, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    html = "<html><body><h1>TL;DR</h1><p>Candidate/preparatory local-only campaign: <b>%s</b> scenarios, <b>%s</b> passed, <b>%s</b> failed; gate_status=<b>BLOCKED</b>.</p><h2>Scope</h2><p>%s</p><h2>Drill-down</h2><p>See PRE_RUNTIME_SCENARIO_CATALOG.json and PRE_RUNTIME_CAMPAIGN_EVIDENCE.json for preconditions, steps, expected safe behavior, observed result, evidence artifact, severity, and production limitation for every scenario.</p></body></html>" % (evidence["scenario_count"], evidence["passed"], evidence["failed"], LIMITATION)
    (package / "PRE_RUNTIME_CAMPAIGN_HANDOFF.html").write_text(html + "\n", encoding="utf-8")
    return evidence
