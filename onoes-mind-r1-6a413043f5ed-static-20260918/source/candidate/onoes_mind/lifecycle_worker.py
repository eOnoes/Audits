"""Deterministic, local-only lifecycle and skill-deduplication worker.

The worker is deliberately proposal-only by default.  It does not touch the
SQLite ledger, runtimes, providers, credentials, or networks.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import hashlib
import json
from difflib import SequenceMatcher
from typing import Any, Iterable

STATES = ("ACTIVE", "ARCHIVE_CANDIDATE", "ARCHIVED", "DELETION_CANDIDATE", "PURGED")
PROTECTED = ("pinned", "referenced", "dependent", "under_review", "quarantined", "disputed", "active_lineage")


def _canon(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def fingerprint(value: Any) -> str:
    return "sha256:" + hashlib.sha256(_canon(value).encode()).hexdigest()


def _dt(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        result = value
    else:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        result = result.replace(tzinfo=timezone.utc)
    return result.astimezone(timezone.utc)


@dataclass(frozen=True)
class RetentionPolicy:
    inactivity_days: int = 90
    archive_candidate_grace_days: int = 14
    record_archive_retention_days: int = 180
    skill_archive_retention_days: int = 365
    deletion_hold_days: int = 7
    near_duplicate_threshold: float = 0.92


@dataclass
class LifecycleRecord:
    record_id: str
    kind: str = "record"
    content: Any = ""
    last_used_at: str = "2026-01-01T00:00:00Z"
    state: str = "ACTIVE"
    archived_at: str | None = None
    deletion_candidate_at: str | None = None
    pinned: bool = False
    referenced: bool = False
    dependent: bool = False
    under_review: bool = False
    quarantined: bool = False
    disputed: bool = False
    active_lineage: bool = False
    scope: str = "shared/candidate"
    content_hash: str = ""
    version: int = 1

    def __post_init__(self) -> None:
        actual = fingerprint(self.content)
        if not self.content_hash:
            self.content_hash = actual

    @property
    def protection_reasons(self) -> list[str]:
        return [name for name in PROTECTED if getattr(self, name)]


@dataclass(frozen=True)
class LeaseToken:
    owner: str
    version: int


class LifecycleError(ValueError):
    pass


class LifecycleWorker:
    """Deterministic scan/classify/propose/quarantine worker."""

    def __init__(self, *, policy: RetentionPolicy | None = None, mode: str = "dry-run",
                 purge_authorized: bool = False) -> None:
        if mode not in {"dry-run", "quarantine", "purge"}:
            raise LifecycleError("unsupported mode")
        self.policy = policy or RetentionPolicy()
        self.mode = mode
        self.purge_authorized = purge_authorized
        self.records: dict[str, LifecycleRecord] = {}
        self.tombstones: list[dict[str, Any]] = []
        self.receipts: list[dict[str, Any]] = []
        self.manifests: list[dict[str, Any]] = []
        self._leases: dict[str, LeaseToken] = {}
        self._lease_versions: dict[str, int] = {}
        self._seen_requests: dict[str, str] = {}

    def add(self, record: LifecycleRecord) -> None:
        if record.record_id in self.records:
            raise LifecycleError("duplicate record id")
        self.records[record.record_id] = record

    def acquire_lease(self, record_id: str, owner: str) -> LeaseToken:
        if record_id not in self.records or not owner:
            raise LifecycleError("scope or ownership check failed")
        version = self._lease_versions.get(record_id, 0) + 1
        token = LeaseToken(owner, version)
        self._lease_versions[record_id] = version
        self._leases[record_id] = token
        return token

    def _fenced(self, record_id: str, token: LeaseToken) -> bool:
        return self._leases.get(record_id) == token

    def _receipt(self, event: str, record: LifecycleRecord, **details: Any) -> dict[str, Any]:
        body = {"receipt_id": f"lifecycle-{len(self.receipts) + 1}", "event": event,
                "record_id": record.record_id, "state": record.state, "details": details,
                "previous_receipt_hash": self.receipts[-1]["receipt_hash"] if self.receipts else None}
        body["receipt_hash"] = fingerprint(body)
        self.receipts.append(body)
        return body

    def _transition(self, record: LifecycleRecord, target: str, now: datetime, token: LeaseToken | None) -> str:
        if token is not None and not self._fenced(record.record_id, token):
            return "REJECTED_STALE_LEASE"
        if fingerprint(record.content) != record.content_hash:
            self._receipt("TAMPER_REJECTED", record, reason="content_hash_mismatch")
            return "REJECTED_TAMPER"
        if record.protection_reasons:
            self._receipt("PROTECTED", record, reasons=record.protection_reasons)
            return "PROTECTED"
        record.state = target
        if target == "ARCHIVED":
            record.archived_at = now.isoformat().replace("+00:00", "Z")
        if target == "DELETION_CANDIDATE":
            record.deletion_candidate_at = now.isoformat().replace("+00:00", "Z")
        self._receipt("STATE_PROPOSED", record, target=target)
        return target

    def scan(self, *, now: str | datetime, request_id: str = "scan-1") -> dict[str, Any]:
        current = _dt(now)
        request_hash = fingerprint({"request_id": request_id, "now": current.isoformat(), "mode": self.mode})
        prior = self._seen_requests.get(request_id)
        if prior:
            if prior != request_hash:
                raise LifecycleError("idempotency divergence")
            return next(item for item in self.manifests if item["request_hash"] == prior)
        proposals: list[dict[str, Any]] = []
        for record in sorted(self.records.values(), key=lambda row: row.record_id):
            age = (current - _dt(record.last_used_at)).total_seconds() / 86400
            target = None
            if record.state == "ACTIVE" and age >= self.policy.inactivity_days:
                target = "ARCHIVE_CANDIDATE"
            elif record.state == "ARCHIVE_CANDIDATE" and record.archived_at and current >= _dt(record.archived_at) + timedelta(days=self.policy.archive_candidate_grace_days):
                target = "ARCHIVED"
            elif record.state == "ARCHIVED" and record.archived_at:
                retention = self.policy.skill_archive_retention_days if record.kind == "skill" else self.policy.record_archive_retention_days
                if current >= _dt(record.archived_at) + timedelta(days=retention):
                    target = "DELETION_CANDIDATE"
            elif record.state == "DELETION_CANDIDATE" and record.deletion_candidate_at and current >= _dt(record.deletion_candidate_at) + timedelta(days=self.policy.deletion_hold_days):
                target = "PURGED"
            if target:
                reasons = record.protection_reasons
                outcome = "PROTECTED" if reasons else ("PROPOSED" if target != "PURGED" or not (self.mode == "purge" and self.purge_authorized) else "PURGE_AUTHORIZED")
                if outcome == "PURGE_AUTHORIZED":
                    tombstone = {"record_id": record.record_id, "content_hash": record.content_hash, "state": "PURGED", "receipt_id": f"deletion-{len(self.tombstones)+1}"}
                    self.tombstones.append(tombstone)
                    self._receipt("PURGED", record, tombstone=tombstone)
                    record.state = "PURGED"
                else:
                    self._receipt("PROPOSAL", record, target=target, reasons=reasons)
                proposals.append({"record_id": record.record_id, "from": record.state, "target": target, "outcome": outcome, "reasons": reasons})
        manifest = {"label": "CANDIDATE_PREPARATORY_EVIDENCE", "gate_status": "BLOCKED", "mode": self.mode,
                    "request_hash": request_hash, "now": current.isoformat(), "proposals": proposals,
                    "policy": self.policy.__dict__.copy(), "tombstones": list(self.tombstones)}
        manifest["manifest_hash"] = fingerprint(manifest)
        self._seen_requests[request_id] = request_hash
        self.manifests.append(manifest)
        return manifest

    def apply(self, manifest: dict[str, Any], *, owner: str = "worker") -> dict[str, Any]:
        """Apply only non-purge proposals under a fenced lease.

        PURGED is never applied here.  A separate, explicitly authorized
        ``mode='purge'`` invocation is required and still emits a tombstone.
        """
        if manifest.get("manifest_hash") != fingerprint({k: v for k, v in manifest.items() if k != "manifest_hash"}):
            raise LifecycleError("manifest tamper detected")
        applied = []
        for proposal in manifest.get("proposals", []):
            record = self.records[proposal["record_id"]]
            if proposal["target"] == "PURGED":
                applied.append({"record_id": record.record_id, "result": "PURGE_REQUIRES_EXPLICIT_AUTHORIZATION"})
                continue
            token = self.acquire_lease(record.record_id, owner)
            result = self._transition(record, proposal["target"], _dt(manifest["now"]), token)
            applied.append({"record_id": record.record_id, "result": result})
        return {"label": manifest["label"], "gate_status": manifest["gate_status"], "applied": applied,
                "receipt_count": len(self.receipts), "tombstone_count": len(self.tombstones)}

    def cancel_deletion(self, record_id: str, *, reason: str) -> str:
        record = self.records.get(record_id)
        if record is None or record.state != "DELETION_CANDIDATE":
            return "NOOP"
        record.state = "ARCHIVED"
        record.deletion_candidate_at = None
        self._receipt("DELETION_CANCELLED", record, reason=reason)
        return "CANCELLED"

    def resurrect(self, record_id: str) -> str:
        """Tombstoned records cannot be resurrected; replacement is explicit."""
        if record_id in {row["record_id"] for row in self.tombstones} or self.records.get(record_id, LifecycleRecord("missing")).state == "PURGED":
            return "REJECTED_TOMBSTONED"
        return "REJECTED_REQUIRES_NEW_ID"


def canonical_skill_fingerprint(name: str, content: str, scope: str, dependencies: Iterable[str] = ()) -> str:
    return fingerprint({"name": name.strip(), "content": content, "scope": scope, "dependencies": sorted(set(dependencies))})


def skill_deduplicate(candidates: Iterable[dict[str, Any]], *, near_threshold: float = .92) -> dict[str, Any]:
    rows = []
    for candidate in candidates:
        row = dict(candidate)
        row["canonical_fingerprint"] = canonical_skill_fingerprint(row["name"], row["content"], row.get("scope", "shared/candidate"), row.get("dependencies", []))
        rows.append(row)
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in sorted(rows, key=lambda item: (item["canonical_fingerprint"], item.get("candidate_id", ""))):
        groups.setdefault(row["canonical_fingerprint"], []).append(row)
    near = []
    for left_index, left in enumerate(rows):
        for right in rows[left_index + 1:]:
            if left["canonical_fingerprint"] == right["canonical_fingerprint"]:
                continue
            similarity = SequenceMatcher(None, left["content"], right["content"]).ratio()
            if similarity >= near_threshold:
                near.append({"left": left.get("candidate_id"), "right": right.get("candidate_id"), "similarity": round(similarity, 6), "decision": "REVIEW_ONLY"})
    return {"exact_groups": [sorted(group, key=lambda item: item.get("candidate_id", "")) for group in groups.values() if len(group) > 1], "near_duplicates": sorted(near, key=lambda item: (item["left"], item["right"])), "auto_merged": []}


def select_canonical(candidates: Iterable[dict[str, Any]]) -> dict[str, Any]:
    def score(row: dict[str, Any]) -> tuple[Any, ...]:
        return (row.get("evidence", 0), row.get("tests", 0), row.get("security_review", 0), row.get("dependencies", 0), -row.get("failure_rate", 1), -row.get("latency_ms", 10**9), -row.get("resource_cost", 10**9), row.get("provenance", 0), row.get("recent_successful_use", 0), row.get("candidate_id", ""))
    ordered = sorted((dict(row) for row in candidates), key=score, reverse=True)
    return {"candidate_id": ordered[0]["candidate_id"], "score": score(ordered[0]), "usage_only": False} if ordered else {"candidate_id": None, "score": (), "usage_only": False}
