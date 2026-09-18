"""Bounded, synthetic Echo-admin quarantine control plane.

This module is intentionally process-local and test-only.  It has no runtime,
provider, credential, network, native-store, archive, purge, or delete path.
All policy numbers are provisional configuration, not production policy.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import hashlib
import json
import re
from typing import Any


class QuarantineError(ValueError):
    pass


def _canon(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _hash(value: Any) -> str:
    return "sha256:" + hashlib.sha256(_canon(value).encode()).hexdigest()


def _time(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        result = value
    else:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return (result if result.tzinfo else result.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


_SECRET = re.compile(r"(?i)(?:sk|rk)-[a-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*['\"]?[A-Za-z0-9/+_.=-]{12,}")


@dataclass(frozen=True)
class QuarantineConfig:
    # Explicitly provisional experiment controls.
    ordinary_alert_cases: int = 10
    skill_conflict_alert_cases: int = 5
    security_alert_cases: int = 3
    aging_bands_days: tuple[int, ...] = (14, 30, 60)
    per_principal_limit: int = 10
    per_scope_limit: int = 20
    global_limit: int = 50
    per_request_limit: int = 4
    rate_window_seconds: int = 60


@dataclass
class QuarantineCase:
    case_id: str
    target_id: str
    target_kind: str
    domain: str
    scope: str
    reason: str
    trigger: str
    actor: str
    creator: str
    request_id: str
    evidence_hash: str
    content: Any
    metadata: dict[str, Any]
    created_at: str
    priority: str
    status: str = "OPEN"
    occurrence_count: int = 1
    review_task_id: str | None = None
    escalation: str = "NONE"
    last_reminder_band: int | None = None
    content_hash: str = ""


@dataclass(frozen=True)
class Lease:
    target_id: str
    owner: str
    version: int


class EchoAdminQuarantine:
    """A deterministic simulator for bounded Echo-admin quarantine handling."""

    TEST_ONLY = True
    GATE_STATUS = "BLOCKED"
    _TRIGGERS = {"ordinary", "skill-conflict", "security/scope", "secret-exposure"}

    def __init__(self, *, config: QuarantineConfig | None = None, now: str = "2026-08-24T00:00:00Z") -> None:
        self.config = config or QuarantineConfig()
        self.now = _time(now)
        self.cases: dict[str, QuarantineCase] = {}
        self._request_bindings: dict[str, str] = {}
        self._correlations: dict[str, str] = {}
        self._leases: dict[str, Lease] = {}
        self._lease_versions: dict[str, int] = {}
        self.receipts: list[dict[str, Any]] = []
        self.alerts: list[dict[str, Any]] = []
        self.review_tasks: list[dict[str, Any]] = []
        self._admissions: list[tuple[str, datetime]] = []
        self._frozen_scopes: set[str] = set()

    def _sanitize(self, value: Any) -> Any:
        if isinstance(value, str):
            return "[REDACTED_SECRET]" if _SECRET.search(value) else value
        if isinstance(value, dict):
            return {str(k): self._sanitize(v) for k, v in value.items() if str(k).lower() not in {"secret", "token", "password", "credential"}}
        if isinstance(value, list):
            return [self._sanitize(v) for v in value]
        return value

    def _priority(self, trigger: str, *, gray: bool = False) -> str:
        if trigger == "secret-exposure": return "P0"
        if trigger == "security/scope": return "P1"
        if gray or trigger == "skill-conflict": return "P2"
        return "P3"

    def _receipt(self, event: str, body: dict[str, Any]) -> dict[str, Any]:
        receipt = {"receipt_id": f"qrec-{len(self.receipts)+1}", "event": event, "body": body,
                   "previous_receipt_hash": self.receipts[-1]["receipt_hash"] if self.receipts else None}
        receipt["receipt_hash"] = _hash(receipt)
        self.receipts.append(receipt)
        return receipt

    def _admit(self, actor: str, scope: str, request_id: str, trigger: str) -> None:
        now = self.now
        self._admissions = [(a, t) for a, t in self._admissions if (now-t).total_seconds() < self.config.rate_window_seconds]
        if sum(a == actor for a, _ in self._admissions) >= self.config.per_principal_limit or sum(s.scope == scope for s in self.cases.values() if s.status == "OPEN") >= self.config.per_scope_limit or sum(s.status == "OPEN" for s in self.cases.values()) >= self.config.global_limit:
            if trigger in {"secret-exposure", "security/scope"}:
                return
            raise QuarantineError("BACKPRESSURE")
        if sum(1 for a, _ in self._admissions if a == actor) >= self.config.per_request_limit:
            raise QuarantineError("RATE_LIMITED")
        self._admissions.append((actor, now))

    def force_quarantine(self, *, target_id: str, target_kind: str, domain: str, scope: str,
                         reason: str, actor: str, request_id: str, evidence_hash: str,
                         content: Any, metadata: dict[str, Any] | None = None,
                         trigger: str = "ordinary", gray: bool = False) -> dict[str, Any]:
        if not all(isinstance(x, str) and x for x in (target_id, target_kind, domain, scope, reason, actor, request_id, evidence_hash)):
            raise QuarantineError("reason, scope, actor, request_id, and evidence_hash are required")
        if actor != "echo-admin":
            raise QuarantineError("only synthetic Echo-admin may force quarantine")
        if trigger not in self._TRIGGERS: raise QuarantineError("unknown trigger")
        safe_content = self._sanitize(content)
        safe_metadata = self._sanitize(metadata or {})
        bound = _hash({"target_id": target_id, "target_kind": target_kind, "domain": domain, "scope": scope, "reason": reason, "trigger": trigger, "evidence_hash": evidence_hash, "content": safe_content, "metadata": safe_metadata})
        prior = self._request_bindings.get(request_id)
        if prior:
            if prior != bound: raise QuarantineError("idempotency divergence")
            case = next(c for c in self.cases.values() if c.case_id == self._correlations.get(bound, prior))
            return {"case": asdict(case), "receipt": self.receipts[-1], "idempotent": True}
        self._admit(actor, scope, request_id, trigger)
        correlation = _hash({"domain": domain, "scope": scope, "trigger": trigger, "reason": reason, "evidence_hash": evidence_hash, "target_kind": target_kind})
        if correlation in self._correlations:
            case = self.cases[self._correlations[correlation]]
            case.occurrence_count += 1
            self._request_bindings[request_id] = bound
            self._correlations[bound] = case.case_id
            receipt = self._receipt("CORRELATED_OCCURRENCE", {"case_id": case.case_id, "request_id": request_id, "occurrence_count": case.occurrence_count})
            return {"case": asdict(case), "receipt": receipt, "idempotent": False}
        case_id = "qcase-" + _hash({"request_id": request_id, "bound": bound})[7:23]
        priority = self._priority(trigger, gray=gray)
        escalation = "OPERATOR_REQUIRED" if priority in {"P0", "P1"} or gray else "NONE"
        case = QuarantineCase(case_id, target_id, target_kind, domain, scope, reason, trigger, actor, actor, request_id, evidence_hash, safe_content, safe_metadata, self.now.isoformat().replace("+00:00", "Z"), priority, escalation=escalation, content_hash=_hash(safe_content))
        self.cases[case_id] = case
        self._request_bindings[request_id] = bound
        self._correlations[correlation] = case_id
        self._correlations[bound] = case_id
        task = {"task_id": f"qtask-{len(self.review_tasks)+1}", "case_id": case_id, "priority": priority, "reviewer": "operator", "creator": actor, "status": "OPEN"}
        case.review_task_id = task["task_id"]
        self.review_tasks.append(task)
        if priority in {"P0", "P1"} or gray:
            self.alerts.append({"alert_id": f"qalert-{len(self.alerts)+1}", "case_id": case_id, "priority": priority, "deduplicated": False, "operator_required": True})
        if trigger == "security/scope": self._frozen_scopes.add(scope)
        threshold = {"ordinary": self.config.ordinary_alert_cases, "skill-conflict": self.config.skill_conflict_alert_cases, "security/scope": self.config.security_alert_cases}.get(trigger)
        domain_count = sum(c.domain == domain and c.trigger == trigger for c in self.cases.values())
        threshold_key = f"threshold:{domain}:{trigger}"
        if threshold and domain_count >= threshold and not any(a.get("dedupe_key") == threshold_key for a in self.alerts):
            self.alerts.append({"alert_id": f"qalert-{len(self.alerts)+1}", "case_id": case_id, "priority": "ADVISORY", "deduplicated": True, "operator_required": False, "threshold_reached": True, "dedupe_key": threshold_key})
        receipt = self._receipt("QUARANTINED", {"case_id": case_id, "target_id": target_id, "request_id": request_id, "reason": reason, "scope": scope, "actor": actor, "evidence_hash": evidence_hash})
        return {"case": asdict(case), "receipt": receipt, "idempotent": False}

    def simulate_trigger(self, trigger: str, **kwargs: Any) -> dict[str, Any]:
        return self.force_quarantine(trigger=trigger, **kwargs)

    def propose_triage(self, case_id: str, *, agent: str = "agent") -> dict[str, Any]:
        case = self.cases[case_id]
        action = "retain-quarantined" if case.priority in {"P0", "P1"} else "request-evidence" if case.escalation == "OPERATOR_REQUIRED" else "attach-occurrence"
        proposal = {"case_id": case_id, "agent": agent, "action": action, "reversible": True, "deterministic": True, "operator_required": True if case.escalation == "OPERATOR_REQUIRED" else False}
        self._receipt("TRIAGE_PROPOSED", proposal)
        return proposal

    def review(self, case_id: str, *, reviewer: str, disposition: str) -> dict[str, Any]:
        case = self.cases[case_id]
        if reviewer == case.creator or reviewer == case.actor: raise QuarantineError("reviewer independence violation")
        if reviewer != "operator": raise QuarantineError("operator review required")
        if disposition not in {"retain-quarantined", "request-evidence", "promote", "reject", "supersede", "purge-eligible"}: raise QuarantineError("unknown disposition")
        if disposition in {"promote", "purge-eligible", "reject", "supersede"} and case.priority in {"P0", "P1"}: raise QuarantineError("high-impact disposition requires operator gate")
        case.status = "REVIEWED" if disposition != "retain-quarantined" else "OPEN"
        return self._receipt("REVIEWED", {"case_id": case_id, "reviewer": reviewer, "disposition": disposition})

    def acquire_lease(self, target_id: str, owner: str) -> Lease:
        if not owner: raise QuarantineError("owner required")
        version = self._lease_versions.get(target_id, 0) + 1
        token = Lease(target_id, owner, version)
        self._lease_versions[target_id] = version; self._leases[target_id] = token
        return token

    def triage_with_lease(self, case_id: str, lease: Lease) -> dict[str, Any]:
        if self._leases.get(lease.target_id) != lease or lease.target_id != case_id: raise QuarantineError("STALE_LEASE")
        return self.propose_triage(case_id, agent=lease.owner)

    def recall(self, *, scope: str) -> list[dict[str, Any]]:
        return []  # quarantined material is never in normal recall

    def promotion_candidates(self) -> list[dict[str, Any]]:
        return []

    def reminders(self, *, now: str | datetime | None = None) -> list[dict[str, Any]]:
        current = _time(now or self.now)
        result = []
        for case in sorted(self.cases.values(), key=lambda c: c.case_id):
            if case.status != "OPEN": continue
            age = (current - _time(case.created_at)).days
            bands = [band for band in self.config.aging_bands_days if age >= band]
            if bands and max(bands) != case.last_reminder_band:
                band = max(bands); case.last_reminder_band = band
                result.append({"case_id": case.case_id, "band_days": band, "provisional": True, "auto_closed": False})
        return result

    def trigger_report(self) -> dict[str, Any]:
        counts: dict[str, dict[str, int]] = {}
        for case in self.cases.values():
            counts.setdefault(case.domain, {}).setdefault(case.trigger, 0); counts[case.domain][case.trigger] += 1
        global_counts: dict[str, int] = {}
        for row in counts.values():
            for trigger, count in row.items(): global_counts[trigger] = global_counts.get(trigger, 0) + count
        threshold = {"ordinary": self.config.ordinary_alert_cases, "skill-conflict": self.config.skill_conflict_alert_cases, "security/scope": self.config.security_alert_cases}
        return {"dry_run": True, "provisional": True, "domain_counts": counts, "global_counts": global_counts, "thresholds": threshold, "alerts_are_advisory": True, "frozen_scopes": sorted(self._frozen_scopes)}

    def snapshot(self) -> dict[str, Any]:
        return {"config": asdict(self.config), "now": self.now.isoformat(), "cases": [asdict(c) for c in self.cases.values()], "receipts": self.receipts, "alerts": self.alerts, "review_tasks": self.review_tasks, "frozen_scopes": sorted(self._frozen_scopes), "bindings": self._request_bindings, "correlations": self._correlations}

    @classmethod
    def restart(cls, snapshot: dict[str, Any]) -> "EchoAdminQuarantine":
        instance = cls(config=QuarantineConfig(**snapshot["config"]), now=snapshot["now"])
        instance.cases = {row["case_id"]: QuarantineCase(**row) for row in snapshot["cases"]}
        instance.receipts = snapshot["receipts"]; instance.alerts = snapshot["alerts"]; instance.review_tasks = snapshot["review_tasks"]
        instance._frozen_scopes = set(snapshot["frozen_scopes"]); instance._request_bindings = snapshot["bindings"]; instance._correlations = snapshot.get("correlations", {})
        for case in instance.cases.values(): instance._correlations[_hash({"domain": case.domain, "scope": case.scope, "trigger": case.trigger, "reason": case.reason, "evidence_hash": case.evidence_hash, "target_kind": case.target_kind})] = case.case_id
        return instance

    def verify_integrity(self) -> bool:
        previous = None
        for receipt in self.receipts:
            if receipt["previous_receipt_hash"] != previous: return False
            body = {k: v for k, v in receipt.items() if k != "receipt_hash"}
            if receipt["receipt_hash"] != _hash(body): return False
            previous = receipt["receipt_hash"]
        return True
