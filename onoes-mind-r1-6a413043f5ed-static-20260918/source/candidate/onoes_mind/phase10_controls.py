"""Fail-closed Stage E0/F0 controls for Phase 10.

These controls validate already-collected metadata and operator-authored
records.  They deliberately do not discover runtimes, read configuration or
state contents, probe processes/sockets, or make authorization decisions.
"""

from __future__ import annotations

import datetime as _datetime
import ntpath
import os
import posixpath
import re
from pathlib import Path
from typing import Any, Iterable


WORKSPACE = Path(__file__).parent.parent
FORBIDDEN_OPERATIONS = frozenset({"native_store_write", "live_activation", "provider_change"})
ALLOWED_BINDINGS = {
    "cyony": "Hermes",
    "echo": "Hermes",
    "tripp": "OpenClaw",
}
GATE_10_3_SPEC_ARTIFACTS = (
    "RUNTIME_ADAPTER_CONTRACT.md",
    "RUNTIME_HEARTBEAT_LEASE_SPEC.md",
    "MODEL_TIER_SPEC.md",
    "PHASE_10_PROTOCOL_SCHEMAS.md",
    "PHASE_10_AUTH_SCOPE_POLICY.md",
    "PHASE_10_LEDGER_RECEIPT_INVARIANTS.md",
    "PHASE_10_EVIDENCE_TEMPLATES.md",
)
GATE_10_3_AUDIT_ARTIFACTS = (
    "audits/phase10-spec-review/kimi-k2.7-code_cloud.md",
    "audits/phase10-spec-review/glm-5.2_cloud.md",
    "audits/phase10-spec-review/deepseek-v4-flash_cloud.md",
)
GATE_10_3_ARTIFACTS = GATE_10_3_SPEC_ARTIFACTS + GATE_10_3_AUDIT_ARTIFACTS
PROPOSED_DISPOSITION_STATUSES = frozenset({
    "PROPOSED_ACCEPT", "PROPOSED_MODIFY", "PROPOSED_BLOCKED",
})
METADATA_KINDS = frozenset({"package", "process", "launch", "path", "filesystem", "hash"})
CONTENT_KEYS = frozenset({"content", "body", "contents", "raw", "secret", "credential", "token", "authorization"})
_SAFE_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$")
_SAFE_OPERATION = re.compile(r"^[a-z][a-z0-9_]*(?:@[0-9]+)?$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
_SAFE_SCOPE = _SHA256
_SAFE_REVOCATION_CONDITION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,255}$")


class ControlValidationError(ValueError):
    """Raised when a Phase 10 control record is incomplete or unsafe."""


def validate_gate_10_3_matrix(rows: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Validate a proposed Gate 10.3 matrix without making a gate decision.

    The returned gate status is deliberately BLOCKED when authority or an
    independent reviewer is unassigned.  This function accepts proposals,
    never final ``PASS``/``APPROVED`` decisions, and never signs or approves.
    """
    if isinstance(rows, (str, bytes, dict)):
        raise ControlValidationError("Gate 10.3 matrix must be a list of rows")
    rows = list(rows)
    if len(rows) != len(GATE_10_3_ARTIFACTS):
        raise ControlValidationError("Gate 10.3 matrix must contain exactly ten rows")
    seen: set[str] = set()
    normalized = []
    blocked = False
    required = {"artifact", "proposed_disposition", "rationale", "authority", "independent_reviewer"}
    for row in rows:
        if not isinstance(row, dict):
            raise ControlValidationError("Gate 10.3 matrix rows must be objects")
        missing = sorted(required - row.keys())
        if missing:
            raise ControlValidationError("missing Gate 10.3 row fields: " + ", ".join(missing))
        artifact = row["artifact"]
        if artifact not in GATE_10_3_ARTIFACTS or artifact in seen:
            raise ControlValidationError("Gate 10.3 artifacts must be represented exactly once")
        seen.add(artifact)
        disposition = row["proposed_disposition"]
        if disposition not in PROPOSED_DISPOSITION_STATUSES:
            raise ControlValidationError("only PROPOSED_* dispositions are permitted")
        if disposition == "PROPOSED_BLOCKED":
            blocked = True
        if not isinstance(row["rationale"], str) or not row["rationale"].strip():
            raise ControlValidationError("rationale is required")
        findings = row.get("finding_dispositions")
        if not isinstance(findings, list) or not findings or any(
            not isinstance(finding, str) or not finding.strip() for finding in findings
        ):
            blocked = True
            findings = []
        authority = row["authority"]
        reviewer = row["independent_reviewer"]
        if authority in {"UNASSIGNED", "PENDING_OPERATOR_ASSIGNMENT"} or reviewer in {
            "UNASSIGNED", "PENDING_OPERATOR_ASSIGNMENT"
        }:
            blocked = True
        if authority == reviewer:
            blocked = True
        normalized.append({
            "artifact": artifact,
            "proposed_disposition": disposition,
            "rationale": row["rationale"],
            "authority": authority,
            "independent_reviewer": reviewer,
            "finding_dispositions": list(findings),
        })
    if set(seen) != set(GATE_10_3_ARTIFACTS):
        raise ControlValidationError("all seven specs and three audits are required exactly once")
    return {"gate": "10.3", "status": "BLOCKED" if blocked else "PROPOSAL_ONLY", "rows": normalized}


def _as_path(value: str | Path) -> Path:
    """Normalize a path lexically without consulting the filesystem."""
    if not isinstance(value, (str, Path)):
        raise ControlValidationError("path must be a string or Path")
    raw = str(value)
    if not raw or "\x00" in raw:
        raise ControlValidationError("path is empty or contains NUL")
    pathmod = ntpath if os.name == "nt" else posixpath
    parts = re.split(r"[\\/]" if os.name == "nt" else r"/", raw)
    if ".." in parts:
        raise ControlValidationError("path traversal is prohibited")
    normalized = pathmod.normpath(raw)
    if not pathmod.isabs(normalized):
        raise ControlValidationError("path must be absolute")
    return Path(normalized)


def _inside(path: Path, root: Path) -> bool:
    if os.name == "nt":
        path_text = ntpath.normcase(path.as_posix()).replace("\\", "/").casefold()
        root_text = ntpath.normcase(root.as_posix()).replace("\\", "/").casefold().rstrip("/")
        return path_text == root_text or path_text.startswith(root_text + "/")
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _contains_forbidden_content_key(value: Any) -> bool:
    if isinstance(value, dict):
        return any(
            key in CONTENT_KEYS or _contains_forbidden_content_key(nested)
            for key, nested in value.items()
        )
    if isinstance(value, list):
        return any(_contains_forbidden_content_key(item) for item in value)
    return False


def validate_metadata_record(record: dict[str, Any], approved_roots: Iterable[str | Path] = ()) -> dict[str, Any]:
    """Validate a metadata-only observation without inspecting its target.

    ``approved_roots`` must be an explicit, exact allowlist supplied by the
    operator.  This function never traverses a root and never reads a file.
    """
    if not isinstance(record, dict):
        raise ControlValidationError("metadata record must be an object")
    required = {"evidence_id", "binding", "kind", "path", "observed_at", "observer"}
    missing = sorted(required - record.keys())
    if missing:
        raise ControlValidationError("missing metadata fields: " + ", ".join(missing))
    binding = record["binding"]
    _safe_identifier(record["evidence_id"], "evidence_id")
    _safe_identifier(record["observer"], "observer")
    _timestamp(record["observed_at"], "observed_at")
    if binding not in ALLOWED_BINDINGS:
        raise ControlValidationError("unknown binding; Pi is OUT_OF_SCOPE")
    if record["kind"] not in METADATA_KINDS:
        raise ControlValidationError("metadata kind is not allowlisted")
    if _contains_forbidden_content_key(record):
        raise ControlValidationError("content-bearing metadata is prohibited")
    path = _as_path(record["path"])
    roots = [WORKSPACE]
    for root in approved_roots:
        if not isinstance(root, (str, Path)):
            raise ControlValidationError("approved root must be a string or Path")
        raw_root = str(root)
        pathmod = ntpath if os.name == "nt" else posixpath
        if not pathmod.isabs(raw_root):
            raise ControlValidationError("approved roots must be absolute")
        roots.append(_as_path(root))
    if not any(_inside(path, root) for root in roots):
        raise ControlValidationError("path is outside the canonical or approved metadata boundary")
    if record.get("redaction_result") not in {"NOT_REQUIRED", "REDACTED", "REVIEWED"}:
        raise ControlValidationError("metadata redaction result is missing or invalid")
    return {
        "evidence_id": str(record["evidence_id"]),
        "binding": binding,
        "runtime_family": ALLOWED_BINDINGS[binding],
        "kind": record["kind"],
        "path": path.as_posix(),
        "observed_at": str(record["observed_at"]),
        "observer": str(record["observer"]),
        "redaction_result": record["redaction_result"],
        "disposition": record.get("disposition", "UNASSIGNED"),
    }


def build_metadata_manifest(records: Iterable[dict[str, Any]], approved_roots: Iterable[str | Path] = ()) -> dict[str, Any]:
    """Create a sanitized manifest from metadata records only."""
    roots = tuple(approved_roots)
    normalized = [validate_metadata_record(record, roots) for record in records]
    return {"format": 1, "workspace": WORKSPACE.as_posix(), "records": normalized}


def _safe_identifier(value: Any, field: str) -> str:
    if not isinstance(value, str) or value == "UNASSIGNED" or not _SAFE_IDENTIFIER.fullmatch(value):
        raise ControlValidationError(field + " has an invalid identifier format")
    return value


def _timestamp(value: Any, field: str) -> _datetime.datetime:
    if not isinstance(value, str):
        raise ControlValidationError(field + " must be an RFC3339 timestamp")
    try:
        parsed = _datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ControlValidationError(field + " must be an RFC3339 timestamp") from exc
    if parsed.tzinfo is None:
        raise ControlValidationError(field + " must include a timezone")
    return parsed


def validate_binding_authorization(
    record: dict[str, Any],
    validated_evidence: Iterable[dict[str, Any]] | None = None,
    *,
    require_evidence_linkage: bool = False,
) -> dict[str, Any]:
    """Validate an operator-filled Gate 10.2 record; do not sign or approve it."""
    required = {
        "authorization_id", "binding_evidence_id", "stable_agent", "runtime_family",
        "runtime_instance_id", "principal_id", "operations", "derived_scope",
        "prohibited_operations", "workspace_hash", "starts_at", "expires_at",
        "approving_authority", "independent_reviewer", "approval_timestamp", "signature_ref",
        "revocation_condition",
    }
    if not isinstance(record, dict):
        raise ControlValidationError("authorization record must be an object")
    missing = sorted(required - record.keys())
    if missing:
        raise ControlValidationError("missing authorization fields: " + ", ".join(missing))
    agent = record["stable_agent"]
    if agent not in ALLOWED_BINDINGS:
        raise ControlValidationError("stable agent is not authorized; Pi remains OUT_OF_SCOPE")
    if record["runtime_family"] != ALLOWED_BINDINGS[agent]:
        raise ControlValidationError("runtime family does not match identity lock")
    for field in ("authorization_id", "binding_evidence_id", "runtime_instance_id", "principal_id", "approving_authority", "independent_reviewer", "signature_ref"):
        _safe_identifier(record[field], field)
    if record["approving_authority"] == record["independent_reviewer"]:
        raise ControlValidationError("approving authority and independent reviewer must differ")
    if agent in {record["approving_authority"], record["independent_reviewer"]}:
        raise ControlValidationError("stable agent cannot approve or independently review")
    if not isinstance(record["operations"], list) or not record["operations"] or any(
        not isinstance(operation, str) or not _SAFE_OPERATION.fullmatch(operation)
        for operation in record["operations"]
    ):
        raise ControlValidationError("at least one exact operation is required")
    if not isinstance(record["prohibited_operations"], list) or any(
        not isinstance(operation, str) or not _SAFE_OPERATION.fullmatch(operation)
        for operation in record["prohibited_operations"]
    ):
        raise ControlValidationError("prohibited operations must be a list of exact operations")
    prohibited = set(record["prohibited_operations"])
    if set(record["operations"]) & prohibited:
        raise ControlValidationError("requested operations cannot be prohibited")
    if not FORBIDDEN_OPERATIONS.issubset(prohibited):
        raise ControlValidationError("native-store writes, live activation, and provider changes must be prohibited")
    if not isinstance(record["workspace_hash"], str) or not _SHA256.fullmatch(record["workspace_hash"]):
        raise ControlValidationError("workspace hash must be lowercase sha256:<64 hex>")
    if not isinstance(record["derived_scope"], str) or not _SAFE_SCOPE.fullmatch(record["derived_scope"]):
        raise ControlValidationError("derived scope must be opaque lowercase sha256:<64 hex>")
    if not isinstance(record["revocation_condition"], str) or not _SAFE_REVOCATION_CONDITION.fullmatch(
        record["revocation_condition"]
    ):
        raise ControlValidationError("revocation condition has an invalid format")
    approval = _timestamp(record["approval_timestamp"], "approval_timestamp")
    starts = _timestamp(record["starts_at"], "starts_at")
    expires = _timestamp(record["expires_at"], "expires_at")
    if not approval <= starts < expires:
        raise ControlValidationError("authorization timestamps must satisfy approval <= starts < expires")
    if require_evidence_linkage and validated_evidence is None:
        raise ControlValidationError("validated evidence linkage is required")
    if validated_evidence is not None:
        linked = any(
            isinstance(evidence, dict)
            and evidence.get("evidence_id") == record["binding_evidence_id"]
            and evidence.get("binding") == agent
            for evidence in validated_evidence
        )
        if not linked:
            raise ControlValidationError("binding evidence is not linked to validated evidence")
    return {field: record[field] for field in required} | {"status": "VALIDATED_NOT_APPROVED"}
