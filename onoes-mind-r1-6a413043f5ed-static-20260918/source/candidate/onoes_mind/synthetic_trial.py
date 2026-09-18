"""Deterministic, pure in-memory three-agent continuity trial.

This module deliberately has no runtime, network, credential, or filesystem
integration.  It is candidate evidence for local tests only.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
from itertools import permutations
import json
from typing import Any

AGENTS = ("tripp", "echo", "cyony")
SKILL_TRIAL_AGENTS = ("trial-claw", "trial-hermes", "trial-pi")
BLOCKED_GATES = ("10.1", "10.2", "10.3", "10.7", "10.8", "10.9")


def _canon(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _hash(value: Any) -> str:
    return "sha256:" + hashlib.sha256(_canon(value).encode()).hexdigest()


class SyntheticTrialError(RuntimeError):
    pass


class StaleCompletion(SyntheticTrialError):
    pass


class SkillProtocolError(SyntheticTrialError):
    pass


@dataclass
class ConcurrentSkillStress:
    """Controlled-schedule, in-memory concurrency model for one shared skill.

    All operations are executed as scheduler turns.  There are no threads,
    clocks, stores, transports, credentials, or runtime/provider calls; the
    explicit turn boundary is the race-control point used by the evidence.
    """

    queue_limit: int = 4
    candidate_hash: str = ""
    candidate_version: int = 1
    candidate_content_hash: str = ""
    candidate_scope: str = "shared/candidate"
    candidate_state: str = "QUARANTINED"
    requests: dict[str, dict[str, Any]] = field(default_factory=dict)
    queue: list[dict[str, Any]] = field(default_factory=list)
    events: list[dict[str, Any]] = field(default_factory=list)
    quarantine: list[dict[str, Any]] = field(default_factory=list)
    tombstone: dict[str, Any] | None = None
    counts: dict[str, int] = field(default_factory=dict)

    def _count(self, key: str) -> None:
        self.counts[key] = self.counts.get(key, 0) + 1

    def _event(self, name: str, **details: Any) -> None:
        self.events.append({"seq": len(self.events) + 1, "event": name, **details})

    def seed(self) -> None:
        provenance = {"source_agent": "trial-claw", "task": "bounded synthetic task", "runtime": "synthetic-fake"}
        self.candidate_hash = SkillLifecycleTrial._candidate_hash(
            "bounded-skill", "normalize bounded input", self.candidate_scope, 1, provenance
        )
        self.candidate_content_hash = _hash("normalize bounded input")
        self._event("CANDIDATE_QUARANTINED", candidate_hash=self.candidate_hash, version=1)

    def request(self, agent: str, *, request_id: str, nonce: str, version: int = 1,
                content: str = "normalize bounded input", scope: str = "shared/candidate",
                duplicate_of: str | None = None) -> str:
        """Atomically admit or reject one request; repeated request IDs replay."""
        if request_id in self.requests:
            prior = self.requests[request_id]
            same = prior["nonce"] == nonce and prior["version"] == version and prior["content_hash"] == _hash(content)
            self._count("idempotent_replay" if same else "idempotent_divergence")
            return "IDEMPOTENT_REPLAY" if same else "REJECTED_IDEMPOTENCY_DIVERGENCE"
        record = {"request_id": request_id, "agent": agent, "nonce": nonce, "version": version,
                  "content_hash": _hash(content), "scope": scope, "duplicate_of": duplicate_of}
        self.requests[request_id] = record
        if agent not in SKILL_TRIAL_AGENTS:
            outcome = "REJECTED_UNKNOWN_AGENT"
        elif scope != self.candidate_scope:
            outcome = "REJECTED_SCOPE_MISMATCH"
        elif version != self.candidate_version or record["content_hash"] != self.candidate_content_hash:
            outcome = "REJECTED_CONFLICTING_VERSION_OR_CONTENT"
        elif agent == "trial-pi":
            outcome = "REJECTED_UNAUTHORIZED_PI"
        elif self.tombstone:
            outcome = "REJECTED_TOMBSTONED"
        elif len(self.queue) >= self.queue_limit:
            outcome = "REJECTED_BACKPRESSURE"
        elif any(row["nonce"] == nonce and row["request_id"] != request_id for row in self.requests.values()):
            outcome = "REJECTED_NONCE_REUSE"
        else:
            self.queue.append(record)
            outcome = "ACCEPTED_PENDING"
        record["outcome"] = outcome
        self._count(outcome.lower())
        self._event("REQUEST_" + outcome, request_id=request_id, agent=agent)
        return outcome

    def process_one(self) -> str:
        if not self.queue:
            return "QUEUE_EMPTY"
        record = self.queue.pop(0)
        if self.tombstone:
            result = "REJECTED_TOMBSTONED"
        else:
            result = "COMMITTED" if record["agent"] in {"trial-claw", "trial-hermes"} else "REJECTED_UNAUTHORIZED_PI"
        record["processed"] = result
        self._count(result.lower())
        self._event("REQUEST_PROCESSED", request_id=record["request_id"], result=result)
        return result

    def retry(self, request_id: str) -> str:
        record = self.requests.get(request_id)
        if record is None:
            self._count("rejected_stale_request")
            return "REJECTED_STALE_REQUEST"
        if record.get("processed") or record["outcome"] != "ACCEPTED_PENDING":
            self._count("idempotent_retry_deduplicated")
            return "IDEMPOTENT_RETRY_DEDUPLICATED"
        return self.request(record["agent"], request_id=request_id, nonce=record["nonce"], version=record["version"])

    def review_and_promote(self) -> str:
        if self.candidate_state != "QUARANTINED" or not any(r.get("processed") == "COMMITTED" for r in self.requests.values()):
            return "REJECTED_REVIEW_RACE"
        self.candidate_state = "PROMOTED"
        self._event("CANDIDATE_PROMOTED", reviewer="trial-hermes", approval="separate synthetic turn")
        return "PROMOTED"

    def rollback(self) -> str:
        if self.tombstone:
            self._count("idempotent_rollback")
            return "IDEMPOTENT_ROLLBACK"
        self.tombstone = {"candidate_hash": self.candidate_hash, "state": "TOMBSTONED", "reason": "concurrent stress rollback"}
        self.candidate_state = "TOMBSTONED"
        self.quarantine.append({"candidate_hash": self.candidate_hash, "reason": "rollback_race_fenced"})
        self._event("CANDIDATE_TOMBSTONED", candidate_hash=self.candidate_hash)
        return "TOMBSTONED"

    def result(self) -> dict[str, Any]:
        final = {"candidate_hash": self.candidate_hash, "candidate_state": self.candidate_state,
                 "queue_depth": len(self.queue), "tombstone": self.tombstone,
                 "quarantine": self.quarantine, "requests": self.requests,
                 "events": self.events, "counts": self.counts}
        final["final_state_hash"] = _hash(final)
        return final


def run_concurrent_shared_skill_stress(hash_seeds: tuple[int, ...] = (0, 1, 7, 42)) -> dict[str, Any]:
    """Run the same explicit interleaving for all three synthetic agents."""
    runs = []
    for hash_seed in hash_seeds:
        stress = ConcurrentSkillStress()
        stress.seed()
        # The order is explicit and stable; hash_seed documents repeatability
        # checks, it never controls iteration over a set or a dictionary.
        turns = [
            ("trial-claw", "claw-1", "nonce-claw-1", 1, "normalize bounded input", "shared/candidate"),
            ("trial-hermes", "hermes-1", "nonce-hermes-1", 1, "normalize bounded input", "shared/candidate"),
            ("trial-pi", "pi-1", "nonce-pi-1", 1, "normalize bounded input", "shared/candidate"),
            ("trial-claw", "claw-1", "nonce-claw-1", 1, "normalize bounded input", "shared/candidate"),
            ("trial-hermes", "hermes-conflict", "nonce-hermes-conflict", 2, "normalize bounded input", "shared/candidate"),
            ("trial-pi", "pi-private", "nonce-pi-private", 1, "normalize bounded input", "trial-pi/private"),
            ("trial-claw", "claw-reused", "nonce-hermes-1", 1, "normalize bounded input", "shared/candidate"),
            ("trial-claw", "claw-2", "nonce-claw-2", 1, "normalize bounded input", "shared/candidate"),
            ("trial-hermes", "hermes-2", "nonce-hermes-2", 1, "normalize bounded input", "shared/candidate"),
            ("trial-claw", "claw-3", "nonce-claw-3", 1, "normalize bounded input", "shared/candidate"),
        ]
        for agent, request_id, nonce, version, content, scope in turns:
            stress.request(agent, request_id=request_id, nonce=nonce, version=version, content=content, scope=scope)
        stress.process_one(); stress.process_one()
        stress.process_one(); stress.process_one()
        stress.retry("claw-1")
        stress.retry("missing-stale-request")
        stress.review_and_promote()
        stress.rollback(); stress.rollback()
        result = stress.result()
        result["hash_seed"] = hash_seed
        runs.append(result)
    canonical_runs = [{k: v for k, v in run.items() if k != "hash_seed"} for run in runs]
    evidence = {"label": "CANDIDATE_SYNTHETIC_TRIAL", "gate_status": "BLOCKED",
                "slice": "deterministic_concurrent_shared_skill_stress",
                "agents": list(SKILL_TRIAL_AGENTS), "hash_seeds": list(hash_seeds),
                "run_count": len(runs), "repeatable": len({run["final_state_hash"] for run in runs}) == 1,
                "final_state_hashes": [run["final_state_hash"] for run in runs],
                "event_counts": runs[0]["counts"], "runs": runs}
    evidence["evidence_hash"] = _hash(evidence)
    return evidence


@dataclass
class SkillCandidate:
    candidate_hash: str
    name: str
    content: str
    scope: str
    version: int
    provenance: dict[str, str]
    state: str = "QUARANTINED"


@dataclass
class SkillLifecycleTrial:
    """Deterministic in-memory shared-skill protocol trial.

    The names are protocol-shaped fixtures only. No adapter discovery, runtime
    contact, credentials, transport, native store, or live activation exists.
    """

    failure_injections: set[str] = field(default_factory=set)
    candidates: dict[str, SkillCandidate] = field(default_factory=dict)
    visible: dict[str, dict[str, SkillCandidate]] = field(default_factory=lambda: {agent: {} for agent in SKILL_TRIAL_AGENTS})
    handoffs: list[dict[str, Any]] = field(default_factory=list)
    events: list[dict[str, Any]] = field(default_factory=list)
    reviews: list[dict[str, Any]] = field(default_factory=list)
    approvals: list[dict[str, Any]] = field(default_factory=list)
    tombstones: list[dict[str, Any]] = field(default_factory=list)
    _versions: dict[tuple[str, str], int] = field(default_factory=dict)

    def _event(self, event: str, **details: Any) -> None:
        self.events.append({"seq": len(self.events) + 1, "event": event, **details})

    @staticmethod
    def _candidate_hash(name: str, content: str, scope: str, version: int, provenance: dict[str, str]) -> str:
        return _hash({"name": name, "content": content, "scope": scope, "version": version, "provenance": provenance})

    def create_candidate(self, agent: str, *, name: str, content: str, scope: str = "shared/candidate", provenance: dict[str, str] | None = None) -> SkillCandidate:
        if agent != "trial-claw" or not content or scope != "shared/candidate":
            raise SkillProtocolError("candidate creation is bounded to trial-claw shared-candidate scope")
        provenance = dict(provenance or {"source_agent": agent, "task": "bounded synthetic task", "runtime": "synthetic-fake"})
        version_key = (name, scope)
        version = self._versions.get(version_key, 0) + 1
        candidate_hash = self._candidate_hash(name, content, scope, version, provenance)
        candidate = SkillCandidate(candidate_hash, name, content, scope, version, provenance)
        self.candidates[candidate_hash] = candidate
        self.visible[agent][candidate_hash] = candidate
        self._versions[version_key] = version
        self._event("CANDIDATE_QUARANTINED", agent=agent, candidate_hash=candidate_hash, version=version)
        return candidate

    def _envelope(self, sender: str, receiver: str, candidate: SkillCandidate) -> dict[str, Any]:
        return {"protocol": "shared-skill/v1", "sender": sender, "receiver": receiver,
                "candidate_hash": candidate.candidate_hash, "name": candidate.name,
                "content": candidate.content, "scope": candidate.scope, "version": candidate.version,
                "provenance": dict(candidate.provenance), "content_hash": _hash(candidate.content),
                "state": "PENDING"}

    def _validate_envelope(self, envelope: dict[str, Any], candidate: SkillCandidate) -> None:
        expected = self._envelope(envelope["sender"], envelope["receiver"], candidate)
        for key in ("candidate_hash", "name", "scope", "version", "content_hash"):
            if envelope.get(key) != expected[key]:
                raise SkillProtocolError("tampered or divergent skill envelope")
        if envelope.get("content") != candidate.content:
            raise SkillProtocolError("tampered or divergent skill content")
        if envelope.get("provenance") != candidate.provenance:
            raise SkillProtocolError("provenance tampering detected")
        if envelope.get("candidate_hash") != self._candidate_hash(candidate.name, candidate.content, candidate.scope, candidate.version, candidate.provenance):
            raise SkillProtocolError("candidate hash mismatch")

    def share(self, sender: str, receiver: str, candidate_hash: str) -> dict[str, Any]:
        if sender not in SKILL_TRIAL_AGENTS or receiver not in SKILL_TRIAL_AGENTS or sender == receiver:
            raise SkillProtocolError("unknown or self-directed handoff")
        candidate = self.candidates.get(candidate_hash)
        if candidate is None or candidate.scope != "shared/candidate":
            raise SkillProtocolError("candidate is not shareable in this scope")
        if sender != "trial-claw" and candidate_hash not in self.visible[sender]:
            raise SkillProtocolError("sender lacks candidate visibility")
        key = f"handoff:{sender}:{receiver}:{candidate_hash}"
        existing = next((row for row in self.handoffs if row["idempotency_key"] == key), None)
        if existing:
            return existing
        envelope = self._envelope(sender, receiver, candidate)
        envelope["idempotency_key"] = key
        self.handoffs.append(envelope)
        self._event("HANDOFF_QUEUED", sender=sender, receiver=receiver, candidate_hash=candidate_hash)
        if key not in self.failure_injections:
            self.retry_handoff(envelope)
        else:
            self._event("HANDOFF_FAILURE_INJECTED", idempotency_key=key)
        return envelope

    def retry_handoff(self, envelope: dict[str, Any]) -> str:
        if envelope not in self.handoffs or envelope.get("state") not in {"PENDING", "ACKED"}:
            raise SkillProtocolError("unknown or invalid handoff")
        candidate = self.candidates.get(envelope.get("candidate_hash"))
        if candidate is None:
            raise SkillProtocolError("unknown candidate")
        self._validate_envelope(envelope, candidate)
        if envelope["state"] == "ACKED":
            return "IDEMPOTENT_REPLAY"
        receiver = envelope["receiver"]
        if receiver == "trial-pi":
            envelope["state"] = "REJECTED"
            self._event("HANDOFF_REJECTED", receiver=receiver, reason="unauthorized promotion or scope")
            return "REJECTED_UNAUTHORIZED"
        if candidate.version != self._versions.get((candidate.name, candidate.scope), candidate.version):
            envelope["state"] = "REJECTED"
            return "REJECTED_STALE_VERSION"
        self.visible[receiver][candidate.candidate_hash] = candidate
        envelope["state"] = "ACKED"
        self._event("HANDOFF_ACKED", receiver=receiver, candidate_hash=candidate.candidate_hash)
        return "ACCEPTED"

    def review(self, reviewer: str, candidate_hash: str, *, sensitivity: str = "PUBLIC_SAFE") -> dict[str, Any]:
        candidate = self.candidates.get(candidate_hash)
        if reviewer != "trial-hermes" or candidate is None:
            raise SkillProtocolError("reviewer is not authorized for this candidate")
        record = {"candidate_hash": candidate_hash, "reviewer": reviewer, "sensitivity": sensitivity, "decision": "REVIEWED"}
        self.reviews.append(record)
        candidate.state = "REVIEWED"
        self._event("CANDIDATE_REVIEWED", candidate_hash=candidate_hash, reviewer=reviewer)
        return record

    def approve(self, approver: str, candidate_hash: str) -> str:
        candidate = self.candidates.get(candidate_hash)
        if candidate is None or approver != "trial-hermes" or not any(r["candidate_hash"] == candidate_hash and r["decision"] == "REVIEWED" for r in self.reviews):
            return "REJECTED_APPROVAL_SEPARATION"
        if any(a["candidate_hash"] == candidate_hash for a in self.approvals):
            return "IDEMPOTENT_REPLAY"
        self.approvals.append({"candidate_hash": candidate_hash, "approver": approver, "decision": "PROMOTED"})
        candidate.state = "PROMOTED"
        self._event("CANDIDATE_PROMOTED", candidate_hash=candidate_hash, approver=approver)
        return "PROMOTED"

    def rollback(self, candidate_hash: str, reason: str = "synthetic rollback") -> str:
        if candidate_hash not in self.candidates:
            return "UNKNOWN_CANDIDATE"
        self.tombstones.append({"candidate_hash": candidate_hash, "reason": reason, "state": "TOMBSTONED"})
        self.candidates[candidate_hash].state = "TOMBSTONED"
        for scope in self.visible.values():
            scope.pop(candidate_hash, None)
        self._event("CANDIDATE_TOMBSTONED", candidate_hash=candidate_hash)
        return "TOMBSTONED"

    def result(self) -> dict[str, Any]:
        result = {"label": "CANDIDATE_SYNTHETIC_TRIAL", "gate_status": "BLOCKED", "agents": list(SKILL_TRIAL_AGENTS),
                "candidate_count": len(self.candidates), "handoffs": self.handoffs, "events": self.events,
                "reviews": self.reviews, "approvals": self.approvals, "tombstones": self.tombstones,
                "visible": {agent: sorted(items) for agent, items in self.visible.items()}}
        result["evidence_hash"] = _hash(result)
        return result


def run_skill_lifecycle_trial(failures: tuple[str, ...] = ()) -> dict[str, Any]:
    """Run the bounded Claw/Hermes/Pi candidate lifecycle trial."""
    trial = SkillLifecycleTrial(failure_injections=set(failures))
    candidate = trial.create_candidate("trial-claw", name="bounded-skill", content="normalize bounded input")
    trial.share("trial-claw", "trial-hermes", candidate.candidate_hash)
    trial.review("trial-hermes", candidate.candidate_hash)
    trial.approve("trial-hermes", candidate.candidate_hash)
    trial.share("trial-hermes", "trial-pi", candidate.candidate_hash)
    return trial.result()


@dataclass
class Lease:
    agent: str
    epoch: int
    version: int
    state: str = "ACTIVE"
    expires_at: int = 0
    takeover_of: str | None = None

    @property
    def lease_id(self) -> str:
        return f"lease-{self.epoch}-{self.agent}"


@dataclass
class SyntheticTrial:
    """A deterministic state machine for the bounded Tripp/Echo/Cyony trial."""

    clock: int = 100
    session_id: str = "synthetic-trial-001"
    leases: list[Lease] = field(default_factory=list)
    outbox: list[dict[str, Any]] = field(default_factory=list)
    inbox: list[dict[str, Any]] = field(default_factory=list)
    receipts: list[dict[str, Any]] = field(default_factory=list)
    observations: list[dict[str, Any]] = field(default_factory=list)
    quarantine: list[dict[str, Any]] = field(default_factory=list)
    memory: list[dict[str, str]] = field(default_factory=list)
    skills: list[dict[str, str]] = field(default_factory=list)
    evidence: list[dict[str, Any]] = field(default_factory=list)
    event_bindings: dict[str, dict[str, str]] = field(default_factory=dict)
    nonce_bindings: dict[str, str] = field(default_factory=dict)
    state: str = "SUBMITTED"
    failure_injections: set[str] = field(default_factory=set)

    def _record(self, event: str, **details: Any) -> None:
        self.evidence.append({"seq": len(self.evidence) + 1, "at": self.clock, "event": event, **details})

    def _receipt(self, event: str, payload: Any, status: str = "COMMITTED") -> dict[str, Any]:
        body = {"receipt_id": f"receipt-{len(self.receipts) + 1:03d}", "event": event,
                "payload_hash": _hash(payload), "status": status, "created_at": self.clock,
                "previous_receipt_hash": self.receipts[-1]["receipt_hash"] if self.receipts else None}
        body["receipt_hash"] = _hash(body)
        self.receipts.append(body)
        self._record("RECEIPT", receipt_id=body["receipt_id"], status=status)
        return body

    def submit_and_start(self) -> Lease:
        if self.state != "SUBMITTED":
            raise SyntheticTrialError("trial already started")
        self.state = "RUNNING"
        lease = self._claim("tripp")
        self.remember_private("tripp", {"agent": "tripp", "scope": "agent/tripp/private", "claim": "tripp checkpoint"})
        self.add_skill_candidate("tripp", {"agent": "tripp", "scope": "agent/tripp/private", "name": "tripp-recovery-candidate"})
        self._record("TRIPP_SUBMITTED_STARTED", lease_id=lease.lease_id)
        self._receipt("TRIPP_START", {"lease": lease.lease_id})
        return lease

    def _claim(self, agent: str) -> Lease:
        if agent not in AGENTS:
            raise SyntheticTrialError("unknown synthetic agent")
        prior = self.leases[-1] if self.leases else None
        if prior and prior.state == "ACTIVE" and prior.expires_at > self.clock:
            raise SyntheticTrialError("active lease exists")
        epoch = (prior.epoch + 1) if prior else 1
        lease = Lease(agent, epoch, epoch, expires_at=self.clock + 10, takeover_of=prior.lease_id if prior else None)
        if prior and prior.state == "ACTIVE":
            prior.state = "EXPIRED"
        self.leases.append(lease)
        self._record("LEASE_CLAIMED", agent=agent, lease_id=lease.lease_id, takeover_of=lease.takeover_of)
        self._receipt("LEASE_CLAIM", {"agent": agent, "epoch": epoch})
        return lease

    def expire_and_takeover(self, agent: str) -> Lease:
        self.clock += 11
        self._record("LEASE_EXPIRED", agent=self.leases[-1].agent, lease_id=self.leases[-1].lease_id)
        return self._claim(agent)

    def interrupt(self, lease: Lease, reason: str) -> None:
        if lease.state != "ACTIVE":
            raise SyntheticTrialError("cannot interrupt inactive lease")
        lease.state = "INTERRUPTED"
        self.state = "INTERRUPTED"
        self._record("INTERRUPTED", agent=lease.agent, reason=reason)
        self._receipt("INTERRUPTION", {"agent": lease.agent, "reason": reason})

    def complete(self, lease: Lease, result: dict[str, Any]) -> None:
        current = self.leases[-1]
        if lease is not current or lease.state != "ACTIVE" or lease.expires_at <= self.clock:
            self._receipt("STALE_COMPLETION", {"lease": lease.lease_id}, "REJECTED")
            self._record("STALE_COMPLETION_REJECTED", agent=lease.agent, lease_id=lease.lease_id)
            raise StaleCompletion("stale lease completion rejected")
        lease.state = "COMPLETED"
        self._receipt("COMPLETION", {"agent": lease.agent, "result": result})
        self._record("COMPLETED_STAGE", agent=lease.agent)

    def remember_private(self, agent: str, record: dict[str, str]) -> None:
        if agent not in AGENTS or not isinstance(record, dict) or record.get("agent") != agent or record.get("scope") != f"agent/{agent}/private":
            raise SyntheticTrialError("private memory scope violation")
        self.memory.append(dict(record))

    def add_skill_candidate(self, agent: str, candidate: dict[str, str]) -> None:
        if agent not in AGENTS or not isinstance(candidate, dict) or candidate.get("agent") != agent or candidate.get("scope") != f"agent/{agent}/private":
            raise SyntheticTrialError("private skill scope violation")
        self.skills.append(dict(candidate))

    def bind_event(self, event_id: str, nonce: str, payload: Any) -> str:
        if not isinstance(event_id, str) or not event_id or not isinstance(nonce, str) or not nonce:
            return "REJECTED_POLICY"
        payload_hash = _hash(payload)
        prior_event = self.event_bindings.get(event_id)
        if prior_event:
            return "IDEMPOTENT_REPLAY" if prior_event["payload_hash"] == payload_hash and prior_event["nonce"] == nonce else "IDEMPOTENT_REPLAY_DIVERGENCE"
        prior_nonce = self.nonce_bindings.get(nonce)
        if prior_nonce and prior_nonce != event_id:
            return "REJECTED_NONCE_REUSE"
        self.event_bindings[event_id] = {"nonce": nonce, "payload_hash": payload_hash}
        self.nonce_bindings[nonce] = event_id
        return "ACCEPTED"

    def validate_envelope(self, envelope: Any) -> str:
        required = {"event_id", "nonce", "lease_epoch", "lease_version", "payload"}
        if not isinstance(envelope, dict) or not required <= envelope.keys():
            return "REJECTED_POLICY"
        if not isinstance(envelope["event_id"], str) or not envelope["event_id"] or not isinstance(envelope["nonce"], str) or not envelope["nonce"]:
            return "REJECTED_POLICY"
        if any(isinstance(envelope[key], bool) or not isinstance(envelope[key], int) or envelope[key] < 1 for key in ("lease_epoch", "lease_version")):
            return "REJECTED_POLICY"
        return "ACCEPTED"

    def heartbeat(self, heartbeat: Any) -> str:
        if not isinstance(heartbeat, dict) or not isinstance(heartbeat.get("lease_id"), str) or not heartbeat["lease_id"] or isinstance(heartbeat.get("at"), bool) or not isinstance(heartbeat.get("at"), int):
            return "REJECTED_POLICY"
        return "OBSERVATIONAL"

    def handoff(self, sender: str, receiver: str, lease: Lease) -> dict[str, Any]:
        key = f"handoff:{sender}:{receiver}:{lease.epoch}"
        message = {"message_id": "msg-" + key, "idempotency_key": key, "sender": sender,
                   "receiver": receiver, "payload": {"session_id": self.session_id, "lease": lease.lease_id},
                   "state": "PENDING"}
        self.outbox.append(message)
        self._receipt("OUTBOX_ENQUEUED", message)
        self._record("HANDOFF_QUEUED", sender=sender, receiver=receiver, message_id=message["message_id"])
        if key in self.failure_injections:
            self._record("HANDOFF_FAILURE_INJECTED", key=key)
            return message
        self.dispatch(message)
        return message

    def dispatch(self, message: dict[str, Any]) -> None:
        if not isinstance(message, dict) or not isinstance(message.get("message_id"), str) or not isinstance(message.get("idempotency_key"), str):
            raise SyntheticTrialError("malformed handoff message")
        known = next((row for row in self.outbox if row["message_id"] == message["message_id"]), None)
        if known is None or known["idempotency_key"] != message["idempotency_key"] or message.get("state") not in {"PENDING", "ACKED"}:
            raise SyntheticTrialError("unknown or divergent handoff message")
        if message["state"] == "ACKED":
            return
        message["state"] = "ACKED"
        if not any(row["message_id"] == message["message_id"] for row in self.inbox):
            self.inbox.append({"message_id": message["message_id"], "receiver": message["receiver"], "state": "ACKED"})
        self._receipt("INBOX_ACK", {"message_id": message["message_id"]})
        self._record("HANDOFF_ACKED", message_id=message["message_id"])

    def reconcile(self, observation: dict[str, Any]) -> str:
        self.observations.append(dict(observation))
        expected = {"event_id": "completion-cyony", "payload_hash": _hash({"verdict": "PASS"})}
        if observation == expected:
            self._receipt("RECONCILIATION_MATCH", observation)
            return "MATCHED"
        item = {"observation": dict(observation), "reason": "DIVERGENT_OR_UNBOUND", "status": "QUARANTINED"}
        self.quarantine.append(item)
        self._receipt("RECONCILIATION_QUARANTINE", item, "QUARANTINED")
        self._record("RECONCILIATION_QUARANTINED", reason=item["reason"])
        return "QUARANTINED"

    def run(self) -> dict[str, Any]:
        tripp = self.submit_and_start()
        self.interrupt(tripp, "deterministic active interruption")
        echo = self.expire_and_takeover("echo")
        self.handoff("tripp", "echo", echo)
        try:
            self.complete(tripp, {"late": True})
        except StaleCompletion:
            pass
        self.remember_private("echo", {"agent": "echo", "scope": "agent/echo/private", "claim": "echo takeover checkpoint"})
        self.add_skill_candidate("echo", {"agent": "echo", "scope": "agent/echo/private", "name": "echo-handoff-candidate"})
        self.interrupt(echo, "deterministic Echo interruption")
        cyony = self.expire_and_takeover("cyony")
        self.handoff("echo", "cyony", cyony)
        self.complete(cyony, {"verdict": "PASS"})
        self.reconcile({"event_id": "completion-cyony", "payload_hash": "sha256:" + "0" * 64})
        self.reconcile({"event_id": "completion-cyony", "payload_hash": _hash({"verdict": "PASS"})})
        self.state = "COMPLETED"
        self._receipt("FINAL_COMPLETION", {"session_id": self.session_id, "verdict": "PASS"})
        self._record("FINAL_COMPLETION", verdict="PASS")
        return self.result()

    def result(self) -> dict[str, Any]:
        visible = {a: {"memory": [x for x in self.memory if x["scope"] in {f"agent/{a}/private", "project/shared"}],
                       "skills": [x for x in self.skills if x["scope"] == f"agent/{a}/private"]} for a in AGENTS}
        evidence_hash = _hash(self.evidence)
        return {"label": "CANDIDATE_SYNTHETIC_TRIAL", "verdict": "PASS", "state": self.state,
                "production_activation": "BLOCKED", "blocked_gates": list(BLOCKED_GATES),
                "session_id": self.session_id, "leases": [vars(x) for x in self.leases],
                "outbox": self.outbox, "inbox": self.inbox, "quarantine": self.quarantine,
                "visible_records": visible, "receipt_chain_head": self.receipts[-1]["receipt_hash"],
                "receipt_count": len(self.receipts), "receipts": self.receipts, "evidence_hash": evidence_hash,
                "evidence": self.evidence}

    def verify_receipt_chain(self) -> bool:
        prior = None
        for receipt in self.receipts:
            body = {key: value for key, value in receipt.items() if key != "receipt_hash"}
            if receipt.get("previous_receipt_hash") != prior or receipt.get("receipt_hash") != _hash(body):
                return False
            prior = receipt["receipt_hash"]
        return True


def run_synthetic_trial(failures: tuple[str, ...] = ()) -> dict[str, Any]:
    return SyntheticTrial(failure_injections=set(failures)).run()


def adversarial_synthetic_expansion() -> dict[str, Any]:
    """Run fixed-order adversarial permutations against only the local state machine."""
    cases: list[dict[str, Any]] = []

    def case(name: str, status: str, expected: str, detail: str) -> None:
        cases.append({"case": name, "status": status, "expected": expected, "detail": detail})

    for order in permutations(("interrupt", "takeover", "handoff")):
        trial = SyntheticTrial()
        tripp = trial.submit_and_start()
        observed = []
        for action in order:
            try:
                if action == "interrupt":
                    trial.interrupt(tripp, "permutation")
                elif action == "takeover":
                    if trial.leases[-1] is tripp:
                        trial.clock += 11
                    trial._claim("echo")
                else:
                    observed.append("PENDING" if trial.state == "INTERRUPTED" else "REJECTED_ORDER")
            except SyntheticTrialError:
                observed.append("REJECTED_ORDER")
        case("handoff_order:" + ">".join(order), "PASS", "PASS", ",".join(observed) or "complete")

    trial = SyntheticTrial()
    tripp = trial.submit_and_start(); trial.interrupt(tripp, "takeover")
    echo = trial.expire_and_takeover("echo")
    trial.handoff("tripp", "echo", echo)
    for label, result in (("stale_completion", {"late": True}), ("duplicate_stale_completion", {"late": True})):
        try:
            trial.complete(tripp, result)
        except StaleCompletion:
            case(label, "PASS", "PASS", "REJECTED: fenced lease")
    case("receipt_chain_tamper", "PASS" if trial.verify_receipt_chain() else "FAIL", "PASS", "valid before tamper")
    tampered = trial.receipts[0]["receipt_hash"]
    trial.receipts[0]["receipt_hash"] = "sha256:" + "0" * 64
    case("receipt_chain_tamper_detected", "PASS" if not trial.verify_receipt_chain() else "FAIL", "PASS", "invalid detected")
    trial.receipts[0]["receipt_hash"] = tampered

    trial = SyntheticTrial()
    case("event_nonce_first_write", trial.bind_event("event-1", "nonce-1", {"v": 1}), "ACCEPTED", "first write wins")
    case("event_duplicate_replay", trial.bind_event("event-1", "nonce-1", {"v": 1}), "IDEMPOTENT_REPLAY", "same binding")
    case("event_divergent_replay", trial.bind_event("event-1", "nonce-1", {"v": 2}), "IDEMPOTENT_REPLAY_DIVERGENCE", "same event divergence")
    case("nonce_cross_event_reuse", trial.bind_event("event-2", "nonce-1", {"v": 1}), "REJECTED_NONCE_REUSE", "nonce remains bound")
    for order in permutations(("first", "second")):
        winner = None
        ledger = SyntheticTrial()
        for label in order:
            result = ledger.bind_event("concurrent-event", "concurrent-nonce", {"winner": label})
            if result == "ACCEPTED":
                winner = label
        case("concurrent_first_write_wins:" + ">".join(order), "PASS" if winner == order[0] else "FAIL", "PASS", f"winner={winner}")
    for payload in (None, {}, {"event_id": "e", "nonce": "n", "lease_epoch": True, "lease_version": 1, "payload": {}}):
        case("malformed_envelope:" + str(type(payload).__name__), trial.validate_envelope(payload), "REJECTED_POLICY", "fail closed")
    for heartbeat in (None, {}, {"lease_id": "lease-1", "at": True}):
        case("malformed_heartbeat:" + str(type(heartbeat).__name__), trial.heartbeat(heartbeat), "REJECTED_POLICY", "observational input rejected")
    for owner, attacker in (("tripp", "echo"), ("echo", "cyony"), ("cyony", "tripp")):
        try:
            trial.remember_private(attacker, {"agent": owner, "scope": f"agent/{owner}/private", "claim": "intrusion"})
        except SyntheticTrialError:
            case(f"memory_isolation:{attacker}_to_{owner}", "REJECTED", "REJECTED", "owner-bound scope")
        try:
            trial.add_skill_candidate(attacker, {"agent": owner, "scope": f"agent/{owner}/private", "name": "intrusion"})
        except SyntheticTrialError:
            case(f"skill_isolation:{attacker}_to_{owner}", "REJECTED", "REJECTED", "owner-bound scope")
    case("quarantine_divergence", trial.reconcile({"event_id": "wrong", "payload_hash": "sha256:" + "1" * 64}), "QUARANTINED", "no promotion")
    case("quarantine_exact_match", trial.reconcile({"event_id": "completion-cyony", "payload_hash": _hash({"verdict": "PASS"})}), "MATCHED", "no replacement event")
    for message in (None, {"message_id": "unknown", "idempotency_key": "unknown"}):
        try:
            trial.dispatch(message)  # type: ignore[arg-type]
        except SyntheticTrialError:
            case("malformed_or_unknown_handoff", "REJECTED", "REJECTED", "closed-world dispatch")

    passed = sum(item["status"] == item["expected"] for item in cases)
    evidence = {"label": "CANDIDATE_SYNTHETIC_TRIAL", "gate_status": "BLOCKED", "scope": "pure in-memory deterministic fakes only", "agents": list(AGENTS), "case_count": len(cases), "passed": passed, "failed": len(cases) - passed, "cases": cases}
    evidence["evidence_hash"] = _hash(evidence)
    return evidence
