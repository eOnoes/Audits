import json
import shutil
import tempfile
from pathlib import Path

from onoes_mind.pre_runtime_campaign import _blocking_process_worker, _run_process_contention, _sqlite_contention_probe, run_campaign


def test_pre_runtime_campaign_is_extensive_local_and_blocked():
    evidence = run_campaign()
    assert evidence["scenario_count"] == 69
    assert evidence["passed"] == 69
    assert evidence["failed"] == 0
    assert evidence["gate_status"] == "BLOCKED"
    assert evidence["prohibited_actions_performed"] == []
    assert all(row["evidence_artifact"].startswith("campaign_evidence.json#/") for row in evidence["scenarios"])


def test_pre_runtime_campaign_repeatability_is_hash_stable():
    first = run_campaign()
    second = run_campaign()
    assert first["reproducibility"]["canonical_hash"] == second["reproducibility"]["canonical_hash"]
    assert json.dumps(first["scenarios"], sort_keys=True) == json.dumps(second["scenarios"], sort_keys=True)


def test_spawn_contention_timeout_terminates_pool_without_orphans():
    result = _run_process_contention(
        [("unused", "unused", "timeout")],
        timeout_seconds=0.1,
        worker=_blocking_process_worker,
    )

    assert result["status"] == "FAIL"
    assert result["observed"]["failure"] == "process_contention_timeout"
    assert result["observed"]["pool_terminated"] is True
    assert result["observed"]["orphan_workers"] == 0


def test_sqlite_contention_repeatability_keeps_real_process_wave():
    root = tempfile.mkdtemp(prefix="onoes-mind-contention-test-")
    try:
        temp_root = Path(root)
        first = _sqlite_contention_probe(temp_root / "first")
        second = _sqlite_contention_probe(temp_root / "second")

        assert first["status"] == second["status"] == "PASS"
        assert first["observed"]["committed_event_rows"] == second["observed"]["committed_event_rows"] == 2
        assert sum(value for key, value in first["observed"]["process_counts"].items() if not key.startswith("thread:")) == 12
        assert sum(value for key, value in second["observed"]["process_counts"].items() if not key.startswith("thread:")) == 12
    finally:
        shutil.rmtree(root, ignore_errors=True)
