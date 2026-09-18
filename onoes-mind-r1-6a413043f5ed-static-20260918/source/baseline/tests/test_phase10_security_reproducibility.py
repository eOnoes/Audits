from pathlib import Path

import pytest

from onoes_mind.phase10_hardening import boundary_audit, reproducibility_manifest
from onoes_mind.phase10_controls import ControlValidationError, validate_metadata_record, WORKSPACE


def test_boundary_audit_is_explicitly_deny_only_and_workspace_scoped():
    audit = boundary_audit(WORKSPACE)
    assert audit["network"] == audit["native_store"] == "DENY"
    assert audit["credentials"] == audit["runtime_contact"] == audit["provider_contact"] == "NONE"
    assert audit["workspace"].lower().endswith("onoes-mind")


def test_reproducibility_manifest_is_sorted_scoped_and_blocked():
    manifest = reproducibility_manifest(["PHASE_10_IMPLEMENTATION_REPORT.md", "RUNTIME_INTEGRATION_PHASE_10_PLAN.md"], WORKSPACE)
    assert manifest["label"] == "CANDIDATE_PREPARATORY_EVIDENCE"
    assert manifest["gate_status"] == "BLOCKED"
    assert manifest["files"] == sorted(manifest["files"], key=lambda item: item["path"])
    with pytest.raises(ValueError):
        reproducibility_manifest([Path(WORKSPACE).parent / "outside"], WORKSPACE)


def test_nested_metadata_cannot_smuggle_secret_or_content():
    record = {"evidence_id": "e", "binding": "echo", "kind": "path",
              "path": str(WORKSPACE / "PHASE_10_IMPLEMENTATION_REPORT.md"),
              "observed_at": "2026-08-24T00:00:00Z", "observer": "operator",
              "redaction_result": "REVIEWED", "nested": {"secret": "blocked"}}
    with pytest.raises(ControlValidationError):
        validate_metadata_record(record)
