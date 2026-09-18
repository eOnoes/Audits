"""Fail-closed validation for local Phase 10 candidate evidence manifests."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Iterable


class EvidenceManifestError(ValueError):
    """Candidate evidence is incomplete or attempts to claim approval."""


REQUIRED_RESULT_FIELDS = frozenset({
    "test_id", "spec_refs", "fixture_hash", "input_hash", "expected_oracle",
    "actual_result", "receipt_state_hash", "network_denied", "native_store_unchanged",
    "environment", "timestamp", "artifact_hash",
})


def manifest_artifact_hash(manifest: dict[str, Any]) -> str:
    payload = {key: value for key, value in manifest.items() if key != "artifact_hash"}
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def validate_candidate_manifest(manifest: dict[str, Any], required_test_ids: Iterable[str] = ()) -> dict[str, Any]:
    """Validate candidate evidence without converting it into a gate decision."""
    if manifest.get("label") != "CANDIDATE_PREPARATORY_EVIDENCE":
        raise EvidenceManifestError("candidate label is required")
    if manifest.get("gate_status") != "BLOCKED":
        raise EvidenceManifestError("candidate evidence must remain gate-blocked")
    results = manifest.get("results")
    if not isinstance(results, list) or not results:
        raise EvidenceManifestError("results are required")
    ids = [item.get("test_id") for item in results]
    if any(not isinstance(test_id, str) or not test_id for test_id in ids) or len(ids) != len(set(ids)):
        raise EvidenceManifestError("test IDs must be present and unique")
    missing = set(required_test_ids) - set(ids)
    if missing:
        raise EvidenceManifestError("missing test IDs: " + ", ".join(sorted(missing)))
    for item in results:
        if REQUIRED_RESULT_FIELDS - set(item):
            raise EvidenceManifestError("result fields are incomplete for " + item["test_id"])
        if item["actual_result"] not in {"PASS", "FAIL", "BLOCKED"}:
            raise EvidenceManifestError("invalid actual result for " + item["test_id"])
        if item["actual_result"] == "PASS" and (item["network_denied"] is not True or item["native_store_unchanged"] is not True):
            raise EvidenceManifestError("PASS requires network denial and native-store immutability")
    if manifest.get("artifact_hash") != manifest_artifact_hash(manifest):
        raise EvidenceManifestError("artifact hash does not match manifest")
    return {"status": "VALIDATED_NOT_APPROVED", "gate_status": "BLOCKED", "result_count": len(results)}
