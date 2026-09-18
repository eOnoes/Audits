"""Deterministic, in-memory Gate 10.4 preparatory fake adapter.

This module is candidate evidence only.  It has no transport, runtime
discovery, credential access, native-store integration, or signed authority.
"""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from typing import Any


CONTRACT_VERSION = "2"
ADAPTER_VERSION = "candidate-adapter-1"
POLICY_VERSION = "candidate-policy-1"
BINDING_VERSION = "binding-v1"
CANDIDATE_WORKSPACE_HASH = "sha256:" + "c" * 64
CANDIDATE_ISSUED_AT = "1970-01-01T00:00:00Z"
REPLAY_WINDOW_SECONDS = 300
SUPPORTED_OPERATIONS = (
    "negotiate@2", "memory_remember@2", "memory_correct@2",
    "memory_recall@2", "memory_status@2", "heartbeat@2",
)
ALLOWED_AGENTS = {"cyony": "Hermes", "echo": "Hermes", "tripp": "OpenClaw"}
FORBIDDEN_OPERATIONS = frozenset({"native_store_write", "live_activation", "provider_change"})
COMMON_REQUEST_FIELDS = (
    "contract_version", "operation", "event_id", "correlation_id", "agent_id",
    "runtime_instance_id", "session_or_work_id", "workspace_hash", "adapter_version",
    "issued_at", "nonce", "auth", "lease_epoch", "lease_version", "payload",
)


class FakeAdapterError(ValueError):
    """Expected local-fake validation failure."""


def canonical_hash(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def private_scope_id(principal_id: str, agent_id: str, binding_version: str = BINDING_VERSION) -> str:
    # PHASE_10_AUTH_SCOPE_POLICY.md §3: hash the exact concatenation.
    raw = "onoes-mind/private-scope/v1" + principal_id + agent_id + binding_version
    return "sha256:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


class DeterministicFakeGateway:
    """A closed-world gateway whose state exists only in process memory."""

    def __init__(self) -> None:
        self._events: dict[str, dict[str, Any]] = {}
        self._records: dict[str, dict[str, Any]] = {}
        self._receipts: list[dict[str, Any]] = []
        self._quarantine: list[dict[str, Any]] = []
        self._recovery_receipts: list[dict[str, Any]] = []
        self._nonce_bindings: dict[str, tuple[str, str]] = {}
        self._revision = 0
        self._lease_epoch = 1
        self._lease_version = 1
        self._state = "LINKED"
        self._mind_down_reason: str | None = None
        self.external_contact_attempted = False
        self.native_store_write_attempted = False

    def contact_external(self, *_: Any, **__: Any) -> None:
        self.external_contact_attempted = True
        raise FakeAdapterError("external contact is denied by default")

    def write_native_store(self, *_: Any, **__: Any) -> None:
        self.native_store_write_attempted = True
        raise FakeAdapterError("native-store writes are denied")

    def takeover_lease(self) -> tuple[int, int]:
        self._lease_epoch += 1
        self._lease_version += 1
        return self._lease_epoch, self._lease_version

    @property
    def state(self) -> str:
        return self._state

    def set_mind_down(self, reason: str) -> None:
        """Enter sticky degraded mode without writing a receipt or memory."""
        if not reason:
            raise FakeAdapterError("Mind-down requires a safe reason")
        self._state = "DEGRADED"
        self._mind_down_reason = reason

    def begin_recovery(self) -> None:
        if self._state != "DEGRADED":
            raise FakeAdapterError("recovery requires degraded state")
        self._state = "RECOVERING"
        self._recovery_receipt("RECOVERY_STARTED", state=self._state)

    def complete_recovery(self) -> None:
        if self._state != "RECOVERING":
            raise FakeAdapterError("recovery checks are not active")
        self._state = "LINKED"
        self._mind_down_reason = None
        self._recovery_receipt("RECOVERY_COMPLETED", state=self._state)

    @property
    def recovery_receipts(self) -> list[dict[str, Any]]:
        return deepcopy(self._recovery_receipts)

    def _recovery_receipt(self, event: str, **details: Any) -> dict[str, Any]:
        receipt = {"receipt_id": f"recovery-{len(self._recovery_receipts) + 1}",
                   "event": event, "state": self._state, "details": details,
                   "previous_receipt_hash": self._recovery_receipts[-1]["receipt_hash"]
                   if self._recovery_receipts else None}
        receipt["receipt_hash"] = canonical_hash(receipt)
        self._recovery_receipts.append(receipt)
        return deepcopy(receipt)

    def reconcile_observation(self, observation: dict[str, Any]) -> dict[str, Any]:
        """Reconcile a sanitized continuity observation without minting an event."""
        if self._state != "RECOVERING":
            raise FakeAdapterError("reconciliation requires recovering state")
        required = {"event_id", "operation", "payload_hash", "principal_id", "derived_scope",
                    "runtime_binding", "lease_epoch", "lease_version", "canonical_revision"}
        if not isinstance(observation, dict) or not required.issubset(observation):
            self._recovery_receipt("OBSERVATION_QUARANTINED", reason="MALFORMED")
            return {"status": "QUARANTINED", "reason_code": "MALFORMED"}
        event = self._events.get(observation["event_id"])
        expected = {"event_id": event["event_id"], "operation": event["operation"],
                    "payload_hash": event["payload_hash"], "principal_id": event["principal_id"],
                    "derived_scope": event["derived_scope"], "runtime_binding": event["runtime_binding"],
                    "lease_epoch": event["lease_epoch"], "lease_version": event["lease_version"],
                    "canonical_revision": event.get("receipt", {}).get("canonical_revision") if event else None}
        if event and all(observation[key] == expected[key] for key in expected):
            receipt = self._recovery_receipt("OBSERVATION_RECONCILED", event_id=observation["event_id"])
            return {"status": "IDEMPOTENT_REPLAY", "event_id": observation["event_id"],
                    "result": deepcopy(event["result"]), "receipt": deepcopy(event["receipt"]),
                    "reconciliation_receipt": receipt}
        reason = "CONFLICT" if event else "UNKNOWN_EVENT"
        self._recovery_receipt("OBSERVATION_QUARANTINED", event_id=observation["event_id"], reason=reason)
        return {"status": "QUARANTINED", "event_id": observation["event_id"], "reason_code": reason}

    def negotiate(self, *, agent_id: str = "echo", runtime_instance_id: str = "echo-fake-1") -> dict[str, Any]:
        if agent_id not in ALLOWED_AGENTS or not runtime_instance_id:
            return self._response("negotiate@2", None, "INCOMPATIBLE_CONTRACT", error="identity is not authorized")
        receipt = {"receipt_id": "negotiation-1", "event_id": None, "operation": "negotiate@2",
                   "payload_hash": canonical_hash({"supported_contracts": [CONTRACT_VERSION]}),
                   "result_hash": canonical_hash({"selected_contract": CONTRACT_VERSION}),
                   "canonical_revision": None, "event_bound": False, "durable": False,
                   "status": "INCOMPATIBLE_CONTRACT" if False else "OK", "authorizing_principal_id": "principal:" + agent_id,
                   "authorization_grant_id": "candidate-grant-v1", "runtime_binding_hash": canonical_hash(runtime_instance_id),
                   "lease_epoch": self._lease_epoch, "lease_version": self._lease_version,
                   "policy_version": POLICY_VERSION, "contract_version": CONTRACT_VERSION,
                   "created_at": CANDIDATE_ISSUED_AT, "previous_receipt_hash": None}
        receipt["response_hash"] = canonical_hash({"contract_version": CONTRACT_VERSION, "operation": "negotiate@2",
            "status": "OK", "event_bound": False, "durable": False, "retryable": False})
        receipt["receipt_hash"] = canonical_hash(receipt)
        return {"contract_version": CONTRACT_VERSION, "operation": "negotiate@2", "status": "OK",
                "selected_contract": CONTRACT_VERSION, "accepted_operations": list(SUPPORTED_OPERATIONS),
                "limits": {"count": 20, "bytes": 4096, "latency_ms": 1000, "retry_budget": 0},
                "policy_version": POLICY_VERSION, "workspace_hash": CANDIDATE_WORKSPACE_HASH,
                "event_bound": False, "durable": False, "correlation_id": None, "receipt": receipt}

    def _response(self, operation: str, event_id: str | None, status: str, *, durable: bool = False,
                  result: Any = None, error: str | None = None, receipt: dict[str, Any] | None = None,
                  request: dict[str, Any] | None = None) -> dict[str, Any]:
        response = {"contract_version": CONTRACT_VERSION, "operation": operation, "status": status,
                    "event_id": event_id, "correlation_id": request.get("correlation_id") if request else None,
                    "event_bound": durable, "durable": durable, "retryable": False,
                    "result": result, "receipt": receipt,
                    "error": {"code": status, "message": error} if error else None}
        return response

    def _error(self, request: dict[str, Any], status: str, message: str) -> dict[str, Any]:
        return self._response(str(request.get("operation")), request.get("event_id"), status,
                              error=message, request=request)

    def _validate_envelope(self, request: dict[str, Any]) -> str | None:
        if not isinstance(request, dict):
            return "REJECTED_POLICY"
        if any(field not in request for field in COMMON_REQUEST_FIELDS):
            return "REJECTED_POLICY"
        if request["contract_version"] != CONTRACT_VERSION or request["adapter_version"] != ADAPTER_VERSION:
            return "INCOMPATIBLE_CONTRACT"
        if request["workspace_hash"] != CANDIDATE_WORKSPACE_HASH or request["issued_at"] != CANDIDATE_ISSUED_AT:
            return "REJECTED_POLICY"
        if not isinstance(request["nonce"], str) or not request["nonce"]:
            return "REJECTED_POLICY"
        if not isinstance(request["session_or_work_id"], str) or not request["session_or_work_id"]:
            return "REJECTED_POLICY"
        if not isinstance(request["correlation_id"], str) or not request["correlation_id"]:
            return "REJECTED_POLICY"
        if not isinstance(request["payload"], dict):
            return "REJECTED_POLICY"
        if (not isinstance(request["lease_epoch"], int) or isinstance(request["lease_epoch"], bool)
                or not isinstance(request["lease_version"], int) or isinstance(request["lease_version"], bool)
                or request["lease_epoch"] < 1 or request["lease_version"] < 1):
            return "REJECTED_POLICY"
        return None

    def _identity(self, request: dict[str, Any]) -> tuple[str | None, dict[str, Any] | None]:
        agent = request.get("agent_id")
        auth = request.get("auth")
        if agent not in ALLOWED_AGENTS or not request.get("runtime_instance_id"):
            return "UNAUTHORIZED_RUNTIME", None
        if "lease_epoch" not in request or "lease_version" not in request:
            return "REJECTED_POLICY", None
        if not isinstance(auth, dict) or auth.get("audience") != "onoes-mind" or auth.get("credential_ref") != "candidate-credential-ref":
            return "UNAUTHORIZED_RUNTIME", None
        principal = "principal:" + agent
        scope = private_scope_id(principal, agent)
        if request.get("private_scope_id", scope) != scope:
            return "REJECTED_POLICY", None
        identity = {"principal_id": principal, "derived_scope": scope,
                    "runtime_binding": {"principal_id": principal, "agent_id": agent,
                                         "runtime_instance_id": request["runtime_instance_id"],
                                         "runtime_family": ALLOWED_AGENTS[agent],
                                         "workspace_hash": request["workspace_hash"],
                                         "binding_version": BINDING_VERSION},
                    "lease_epoch": request["lease_epoch"], "lease_version": request["lease_version"]}
        return None, identity

    @staticmethod
    def _same_binding(prior: dict[str, Any], identity: dict[str, Any]) -> bool:
        return all(prior.get(key) == identity.get(key) for key in
                   ("principal_id", "derived_scope", "runtime_binding", "lease_epoch", "lease_version"))

    def _commit(self, request: dict[str, Any], operation: str, payload_hash: str,
                result: dict[str, Any], identity: dict[str, Any]) -> dict[str, Any]:
        self._revision += 1
        event_id = request["event_id"]
        prior = self._receipts[-1]["receipt_hash"] if self._receipts else None
        receipt = {"receipt_id": f"receipt-{self._revision}", "event_id": event_id, "operation": operation,
                   "payload_hash": payload_hash, "result_hash": canonical_hash(result),
                   "canonical_revision": f"r-{self._revision}", "event_bound": True, "durable": True,
                   "status": "ACCEPTED_DURABLE", "previous_receipt_hash": prior,
                   "authorizing_principal_id": identity["principal_id"], "authorization_grant_id": "candidate-grant-v1",
                   "runtime_binding_hash": canonical_hash(identity["runtime_binding"]),
                   "lease_epoch": identity["lease_epoch"], "lease_version": identity["lease_version"],
                   "policy_version": POLICY_VERSION, "contract_version": CONTRACT_VERSION,
                   "created_at": CANDIDATE_ISSUED_AT}
        receipt["response_hash"] = canonical_hash(self._response(operation, event_id, "ACCEPTED_DURABLE",
            durable=True, result=result, receipt=None, request=request))
        receipt["receipt_hash"] = canonical_hash(receipt)
        self._receipts.append(receipt)
        self._events[event_id] = {"event_id": event_id, "operation": operation, "payload_hash": payload_hash,
                                  "result": deepcopy(result), "receipt": deepcopy(receipt),
                                  "authorization_grant_id": "candidate-grant-v1", "workspace_hash": request["workspace_hash"],
                                  "created_at": CANDIDATE_ISSUED_AT, "receipt_link": receipt["receipt_hash"], **identity}
        return self._response(operation, event_id, "ACCEPTED_DURABLE", durable=True,
                              result=result, receipt=receipt, request=request)

    def _quarantine_event(self, request: dict[str, Any], payload_hash: str, reason: str,
                          reason_code: str, content_hash: str) -> dict[str, Any]:
        event_id = request["event_id"]
        identity_error, identity = self._identity(request)
        assert identity_error is None and identity is not None
        item = {"quarantine_id": canonical_hash({"event_id": event_id, "payload_hash": payload_hash, "reason": reason}),
                "event_id": event_id, "content_hash": content_hash, "reason_code": reason_code,
                "safe_metadata": {"content_length": request["payload"].get("content", request["payload"].get("replacement_content", "" )).__len__()},
                "source_principal": identity["principal_id"], "derived_scope": identity["derived_scope"],
                "status": "PENDING", "created_at": CANDIDATE_ISSUED_AT, "review_receipt_id": None}
        self._quarantine.append(item)
        message = reason
        self._events[event_id] = {"event_id": event_id, "operation": request["operation"], "payload_hash": payload_hash,
                                  "result": None, "receipt": None, "status": "QUARANTINED", "error": message,
                                  "authorization_grant_id": "candidate-grant-v1", "workspace_hash": request["workspace_hash"],
                                  "created_at": CANDIDATE_ISSUED_AT, "receipt_link": None, **identity}
        return self._response(request["operation"], event_id, "QUARANTINED", error=message, request=request)

    def request(self, request: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(request, dict):
            return self._response("unknown", None, "REJECTED_POLICY", error="request must be an object")
        operation = request.get("operation")
        event_id = request.get("event_id")
        if operation not in SUPPORTED_OPERATIONS:
            return self._error(request, "INCOMPATIBLE_CONTRACT", "operation is not allowlisted")
        if operation == "negotiate@2" and not all(field in request for field in COMMON_REQUEST_FIELDS):
            return self._error(request, "INCOMPATIBLE_CONTRACT", "negotiation envelope is incomplete")
        envelope_error = self._validate_envelope(request)
        if envelope_error:
            return self._error(request, envelope_error, "request envelope is incomplete or invalid")
        if operation == "negotiate@2":
            return self.negotiate(agent_id=request["agent_id"], runtime_instance_id=request["runtime_instance_id"])
        identity_error, identity = self._identity(request)
        if identity_error:
            return self._error(request, identity_error, "request rejected by local policy")
        assert identity is not None
        if not isinstance(event_id, str) or not event_id:
            return self._error(request, "REJECTED_POLICY", "event binding is required")
        payload = request["payload"]
        payload_hash = canonical_hash(payload)
        nonce_binding = (str(event_id), payload_hash)
        prior = self._events.get(event_id)
        if prior:
            if (prior["operation"] == operation and prior["payload_hash"] == payload_hash
                    and self._same_binding(prior, identity)):
                return self._response(operation, event_id, "IDEMPOTENT_REPLAY", durable=prior["receipt"] is not None,
                                      result=deepcopy(prior["result"]), error=prior.get("error"),
                                      receipt=deepcopy(prior["receipt"]), request=request)
            return self._error(request, "IDEMPOTENT_REPLAY_DIVERGENCE", "event binding conflicts")
        prior_nonce = self._nonce_bindings.get(request["nonce"])
        if prior_nonce is not None and prior_nonce != nonce_binding:
            return self._error(request, "REJECTED_POLICY", "nonce is already bound to another event")
        if identity["lease_epoch"] != self._lease_epoch or identity["lease_version"] != self._lease_version:
            return self._error(request, "STALE_LEASE", "request lease is stale")
        self._nonce_bindings.setdefault(request["nonce"], nonce_binding)
        if operation == "memory_status@2":
            return self._response(operation, event_id, "OK", result={"state": self._state, "mind_down_reason": self._mind_down_reason, "mind_revision": f"r-{self._revision}",
                "lease_epoch": self._lease_epoch, "lease_version": self._lease_version, "event_status": "UNKNOWN"}, request=request)
        if operation == "heartbeat@2":
            return self._response(operation, event_id, "OK", result={"state": self._state,
                "lease_epoch": self._lease_epoch, "lease_version": self._lease_version,
                "mind_revision": f"r-{self._revision}"}, request=request)
        if operation == "memory_recall@2":
            payload = request["payload"]
            try:
                max_records = min(max(int(payload.get("max_records", 20)), 0), 20)
                max_bytes = min(max(int(payload.get("max_bytes", 4096)), 0), 4096)
            except (TypeError, ValueError, OverflowError):
                return self._error(request, "REJECTED_POLICY", "recall limits are invalid")
            superseded = {record.get("supersession_link", {}).get("supersedes_record_id") for record in self._records.values()}
            records = [deepcopy(record) for record in self._records.values()
                       if not record.get("quarantined") and record["record_id"] not in superseded]
            selected, used = [], 0
            for record in records:
                size = len(json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8"))
                if len(selected) >= max_records or used + size > max_bytes:
                    break
                selected.append(record); used += size
            return self._response(operation, event_id, "OK_EMPTY" if not selected else "OK",
                result={"records": selected, "next_cursor": None, "truncated": len(selected) < len(records),
                        "policy_version": POLICY_VERSION, "provenance": [r["provenance"] for r in selected]}, request=request)
        if self._state != "LINKED":
            return self._error(request, "MIND_DOWN", "canonical writer is not linked")
        content = payload.get("content") if operation == "memory_remember@2" else payload.get("replacement_content")
        content_hash_key = "content_hash" if operation == "memory_remember@2" else "replacement_content_hash"
        if not isinstance(content, str) or not content or payload.get(content_hash_key) != canonical_hash(content):
            return self._error(request, "REJECTED_POLICY", "content or content hash is invalid")
        if operation == "memory_remember@2" and payload.get("requested_visibility") not in {"private", "shared_candidate"}:
            return self._error(request, "REJECTED_POLICY", "visibility is invalid")
        if any(marker in content.lower() for marker in ("api_key=", "access_token=", "secret=")):
            return self._quarantine_event(request, payload_hash, "content quarantined", "SECRET_REJECT", canonical_hash(content))
        if operation == "memory_remember@2" and payload.get("requested_visibility") == "shared_candidate":
            return self._quarantine_event(request, payload_hash, "shared candidate requires review", "SENSITIVE_REVIEW", canonical_hash(content))
        target = None
        if operation == "memory_correct@2":
            if not isinstance(payload.get("reason"), str) or not payload["reason"]:
                return self._error(request, "REJECTED_POLICY", "correction reason is required")
            target = self._records.get(payload.get("supersedes_record_id"))
            if (not target or target.get("superseded_by") or payload.get("supersedes_revision") != target["revision"]
                    or payload.get("supersedes_event_id") != target.get("event_id")):
                return self._error(request, "REJECTED_POLICY", "supersession target is invalid")
        record_id = f"record-{len(self._records) + 1}"
        record = {"record_id": record_id, "revision": f"r-{self._revision + 1}", "content": content,
                  "content_hash": canonical_hash(content), "provenance": payload.get("provenance", {}),
                  "visibility": payload.get("requested_visibility", "private"), "quarantined": False, "event_id": event_id}
        if target is not None:
            target["superseded_by"] = record_id
            record["supersession_link"] = {"supersedes_event_id": payload["supersedes_event_id"],
                "supersedes_record_id": payload["supersedes_record_id"], "supersedes_revision": target["revision"],
                "replacement_event_id": event_id, "replacement_record_id": record_id, "replacement_revision": record["revision"],
                "replacement_content_hash": payload["replacement_content_hash"], "reason": payload.get("reason")}
        self._records[record_id] = record
        return self._commit(request, operation, payload_hash, record, identity)


class DeterministicFakeAdapter:
    """Protocol-shaped client for the closed-world fake gateway."""

    def __init__(self, gateway: DeterministicFakeGateway, agent_id: str = "echo", runtime_instance_id: str = "echo-fake-1") -> None:
        self.gateway = gateway
        self.agent_id = agent_id
        self.runtime_instance_id = runtime_instance_id
        self.lease_epoch, self.lease_version = gateway._lease_epoch, gateway._lease_version

    def call(self, operation: str, event_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.gateway.request({"contract_version": CONTRACT_VERSION, "operation": operation, "event_id": event_id,
            "correlation_id": "correlation-" + event_id, "agent_id": self.agent_id,
            "runtime_instance_id": self.runtime_instance_id, "session_or_work_id": "work-candidate-1",
            "workspace_hash": CANDIDATE_WORKSPACE_HASH, "adapter_version": ADAPTER_VERSION,
            "issued_at": CANDIDATE_ISSUED_AT, "nonce": "nonce-" + event_id,
            "private_scope_id": private_scope_id("principal:" + self.agent_id, self.agent_id),
            "lease_epoch": self.lease_epoch, "lease_version": self.lease_version,
            "auth": {"credential_ref": "candidate-credential-ref", "audience": "onoes-mind"}, "payload": payload})
