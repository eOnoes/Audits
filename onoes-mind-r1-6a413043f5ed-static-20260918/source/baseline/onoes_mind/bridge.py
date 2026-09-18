"""Local authenticated process-boundary bridge for the Phase 1 slice.

The bridge is intentionally loopback-only and delegates durable task state,
leases, fencing, and completion receipts to :class:`Ledger`.  It has no
provider, runtime-store, command, path, or credential-loading capability.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import socket
import socketserver
import threading
import uuid
from typing import Any

from .ledger import Ledger, LedgerError

PROTOCOL_VERSION = "onoes-mind-bridge/v1"
RUNTIME_FAMILY = "local-test-runtime"
ALLOWED_AGENTS = {"echo", "tripp", "cyony"}
CAPABILITIES = frozenset({"task.start", "task.claim", "task.heartbeat", "task.stop", "task.complete"})
FORBIDDEN_KEYS = {"command", "path", "credential", "credentials", "provider_url", "workflow", "native_store"}
MAX_REQUEST_BYTES = 64 * 1024
MAX_PAYLOAD_BYTES = 16 * 1024
MAX_PAYLOAD_DEPTH = 8
MAX_PAYLOAD_NODES = 256
MAX_REPLAY_ENTRIES = 1024


class BridgeError(Exception):
    pass


def _canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _reject_unbounded(value: Any, *, depth: int = 0, nodes: list[int] | None = None) -> None:
    nodes = nodes if nodes is not None else [0]
    nodes[0] += 1
    if nodes[0] > MAX_PAYLOAD_NODES or depth > MAX_PAYLOAD_DEPTH:
        raise BridgeError("payload structure exceeds bridge bound")
    if isinstance(value, dict):
        for key, nested in value.items():
            if not isinstance(key, str) or len(key) > 128:
                raise BridgeError("payload key exceeds bridge bound")
            if str(key).lower() in FORBIDDEN_KEYS:
                raise BridgeError(f"forbidden field: {key}")
            _reject_unbounded(nested, depth=depth + 1, nodes=nodes)
    elif isinstance(value, list):
        if len(value) > 128:
            raise BridgeError("payload list exceeds bridge bound")
        for nested in value:
            _reject_unbounded(nested, depth=depth + 1, nodes=nodes)
    elif isinstance(value, str) and len(value) > 4096:
        raise BridgeError("string exceeds bridge bound")


def _mac(envelope: dict[str, Any], key: bytes) -> str:
    unsigned = {k: v for k, v in envelope.items() if k != "auth"}
    return hmac.new(key, _canonical(unsigned), hashlib.sha256).hexdigest()


class BridgeServer:
    def __init__(self, ledger: Ledger, *, auth_key: bytes = b"local-phase1-test-key") -> None:
        self.ledger = ledger
        self.auth_key = auth_key
        self._dispatch_lock = threading.Lock()
        self._replay: dict[str, tuple[str, dict[str, Any]]] = {}
        self._server: socketserver.ThreadingTCPServer | None = None
        self._thread: threading.Thread | None = None

    @property
    def address(self) -> tuple[str, int]:
        if self._server is None:
            raise BridgeError("bridge is not running")
        return self._server.server_address

    def start(self) -> None:
        owner = self

        class Handler(socketserver.StreamRequestHandler):
            def handle(self) -> None:
                line = self.rfile.readline(65537)
                try:
                    if not line or len(line) > MAX_REQUEST_BYTES:
                        raise BridgeError("bounded request required")
                    request = json.loads(line)
                    with owner._dispatch_lock:
                        fingerprint = owner._replay_fingerprint(request)
                        request_id = request.get("request_id") if isinstance(request, dict) else None
                        if request_id in owner._replay:
                            prior_fingerprint, prior_response = owner._replay[request_id]
                            if prior_fingerprint != fingerprint:
                                raise BridgeError("request_id replay divergence")
                            response = prior_response
                        else:
                            response = owner.dispatch(request)
                            if response.get("ok") and isinstance(request_id, str):
                                owner._replay[request_id] = (fingerprint, response)
                                if len(owner._replay) > MAX_REPLAY_ENTRIES:
                                    owner._replay.pop(next(iter(owner._replay)))
                except (BridgeError, LedgerError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
                    response = {"ok": False, "error": str(exc)}
                self.wfile.write(_canonical(response) + b"\n")

        class LocalServer(socketserver.ThreadingTCPServer):
            allow_reuse_address = True
            daemon_threads = True

            def verify_request(self, request, client_address):  # noqa: N802
                return client_address[0] == "127.0.0.1"

        self._server = LocalServer(("127.0.0.1", 0), Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def close(self) -> None:
        if self._server:
            self._server.shutdown()
            self._server.server_close()
            self._server = None

    @staticmethod
    def _replay_fingerprint(request: Any) -> str:
        unsigned = {k: v for k, v in request.items() if k != "auth"} if isinstance(request, dict) else request
        return hashlib.sha256(_canonical(unsigned)).hexdigest()

    def dispatch(self, request: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(request, dict):
            raise BridgeError("request must be an object")
        if request.get("protocol_version") != PROTOCOL_VERSION:
            raise BridgeError("unsupported protocol")
        identity = request.get("runtime_identity")
        if not isinstance(identity, dict) or identity.get("agent_id") not in ALLOWED_AGENTS:
            raise BridgeError("unknown runtime identity")
        if identity.get("runtime_family") != RUNTIME_FAMILY or not identity.get("runtime_instance_id"):
            raise BridgeError("incomplete runtime identity")
        auth = request.get("auth")
        if not isinstance(auth, dict) or not hmac.compare_digest(auth.get("mac", ""), _mac(request, self.auth_key)):
            raise BridgeError("authentication failed")
        payload = request.get("payload", {})
        _reject_unbounded(payload)
        if len(_canonical(payload)) > MAX_PAYLOAD_BYTES:
            raise BridgeError("payload exceeds bridge bound")
        operation = request.get("operation")
        if operation == "negotiate":
            offered = set(request.get("capabilities", []))
            return {"ok": True, "request_id": request.get("request_id"), "protocol_version": PROTOCOL_VERSION,
                    "runtime_identity": identity, "capabilities": sorted(offered & CAPABILITIES)}
        if not isinstance(request.get("request_id"), str) or not request["request_id"]:
            raise BridgeError("stable request_id required")
        agent = identity["agent_id"]
        if operation == "start_task":
            if not isinstance(payload, dict) or set(payload) - {"task_id", "objective", "idempotency_key"}:
                raise BridgeError("bounded task envelope required")
            task_id = payload.get("task_id") or "task_" + uuid.uuid4().hex[:16]
            objective = payload.get("objective")
            if not isinstance(objective, str) or not objective.strip():
                raise BridgeError("objective required")
            work = self.ledger.create_work_item(task_id, agent, "onoes-mind", "bridge", payload.get("idempotency_key", task_id))
            self.ledger.add_stage(work["work_code"], "main", 1, "bridge")
            return {"ok": True, "request_id": request["request_id"], "task_id": task_id, "state": "PENDING"}
        if operation == "claim_task":
            if not isinstance(payload, dict) or set(payload) - {"lease_seconds"}:
                raise BridgeError("bounded claim envelope required")
            lease_seconds = payload.get("lease_seconds", 60)
            if not isinstance(lease_seconds, int) or isinstance(lease_seconds, bool) or not 1 <= lease_seconds <= 3600:
                raise BridgeError("lease_seconds outside bridge bound")
            claim = self.ledger.claim_stage(agent, lease_seconds=lease_seconds)
            return {"ok": True, "request_id": request["request_id"], "claim": dict(claim)}
        if operation == "heartbeat":
            if not isinstance(payload, dict) or set(payload) - {"stage_execution_id", "lease_version", "lease_seconds"}:
                raise BridgeError("bounded heartbeat envelope required")
            row = self.ledger.heartbeat(payload["stage_execution_id"], agent, int(payload["lease_version"]), int(payload.get("lease_seconds", 60)))
            return {"ok": True, "request_id": request["request_id"], "stage": row}
        if operation == "stop_task":
            result = self.ledger.fail_stage(payload["stage_execution_id"], agent, int(payload["lease_version"]), "stopped", retryable=True, backoff_seconds=0)
            return {"ok": True, "request_id": request["request_id"], "stop": result}
        if operation == "complete_task":
            try:
                result = self.ledger.complete_stage(payload["stage_execution_id"], agent, int(payload["lease_version"]), payload.get("result", {}))
            except LedgerError as exc:
                # A stopped/recovered attempt is a fenced stale completion at
                # the process boundary, regardless of its terminal reason.
                if str(exc) in {"stage is not running", "stale lease"}:
                    raise BridgeError("stale lease") from exc
                raise
            return {"ok": True, "request_id": request["request_id"], "completion": result}
        raise BridgeError("operation denied")


class BridgeClient:
    def __init__(self, address: tuple[str, int], *, agent_id: str, runtime_instance_id: str, auth_key: bytes = b"local-phase1-test-key") -> None:
        self.address, self.agent_id, self.runtime_instance_id, self.auth_key = address, agent_id, runtime_instance_id, auth_key

    def call(self, operation: str, payload: dict[str, Any] | None = None, *, request_id: str | None = None, capabilities: list[str] | None = None) -> dict[str, Any]:
        request = {"protocol_version": PROTOCOL_VERSION, "request_id": request_id or operation + "-request",
                   "runtime_identity": {"agent_id": self.agent_id, "runtime_family": RUNTIME_FAMILY, "runtime_instance_id": self.runtime_instance_id},
                   "capabilities": capabilities or [], "operation": operation, "payload": payload or {}}
        request["auth"] = {"mac": _mac(request, self.auth_key)}
        with socket.create_connection(self.address, timeout=3) as conn:
            conn.sendall(_canonical(request) + b"\n")
            response = json.loads(conn.makefile("rb").readline())
        if not response.get("ok"):
            raise BridgeError(response.get("error", "bridge request failed"))
        return response
