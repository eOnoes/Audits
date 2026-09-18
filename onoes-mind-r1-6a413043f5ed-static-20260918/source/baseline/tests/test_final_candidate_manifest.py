import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "audits" / "final-candidate" / "FINAL_CANDIDATE_MANIFEST.json"


def _hash(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def _manifest_without_hash(manifest):
    return {key: value for key, value in manifest.items() if key != "manifest_hash"}


def test_final_candidate_manifest_is_blocked_and_self_consistent():
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    canonical = json.dumps(_manifest_without_hash(manifest), sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    assert manifest["manifest_hash"] == "sha256:" + hashlib.sha256(canonical).hexdigest()
    assert manifest["label"] == "CANDIDATE_PREPARATORY_EVIDENCE"
    assert manifest["trial_label"] == "CANDIDATE_SYNTHETIC_TRIAL"
    assert manifest["gate_status"] == "BLOCKED"


def test_final_candidate_manifest_file_hashes_and_counts_are_current():
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    for section in ("artifacts", "source_files", "test_files"):
        for relative, expected in manifest[section].items():
            assert _hash(ROOT / relative) == expected, relative
    assert manifest["test_matrix"] == {
            "full_pytest_collected": 167,
        "focused_phase10_collected": 73,
        "focused_synthetic_collected": 19,
        "pre_runtime_campaign_collected": 4,
        "unittest_discovery_expected": 13,
    }
    assert manifest["adversarial"]["case_count"] == 32
    assert manifest["adversarial"]["failed"] == 0
    assert manifest["pre_runtime_campaign"] == {"scenario_count": 69, "passed": 69, "failed": 0, "evidence_hash": manifest["pre_runtime_campaign"]["evidence_hash"]}
