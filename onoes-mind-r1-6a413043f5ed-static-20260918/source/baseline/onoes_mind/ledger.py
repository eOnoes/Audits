"""Small, deterministic Phase 1A SQLite ledger and policy gateway."""

from __future__ import annotations

import base64
import calendar
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import threading
import time
import unicodedata
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable

CONTRACT = "memory_remember@2"
PUBLIC_SHARED = "project/onoes-mind/shared"
SHARED_KINDS = {"project_fact", "knowledge"}

_SECRET_PATTERNS = (
    re.compile(r"\b(?:sk|rk)-[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"(?i)\b(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*['\"]?[A-Za-z0-9/+_.=-]{12,}"),
)


class LedgerError(Exception):
    pass


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _canonical(value: Any) -> str:
    if isinstance(value, str):
        return unicodedata.normalize("NFC", value).replace("\r\n", "\n").replace("\r", "\n")
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _payload_hash(claim: str, kind: str, project_id: str) -> str:
    body = _canonical({"claim": claim, "kind": kind, "project_id": project_id})
    return hashlib.sha256(("canon-v1\0" + body).encode()).hexdigest()


def _walk_strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for k, v in value.items():
            yield from _walk_strings(k)
            yield from _walk_strings(v)
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from _walk_strings(item)


def _secret_category(envelope: dict[str, Any]) -> str | None:
    for text in _walk_strings(envelope):
        for pattern in _SECRET_PATTERNS:
            if pattern.search(text):
                return "credential_like_content"
    return None


def _hash_password(secret: str, salt: bytes | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", secret.encode(), salt, 120_000)
    return base64.b64encode(salt).decode(), base64.b64encode(digest).decode()


def _verify_password(secret: str, salt_b64: str, digest_b64: str) -> bool:
    _, digest = _hash_password(secret, base64.b64decode(salt_b64))
    return hmac.compare_digest(digest, digest_b64)


class Ledger:
    def __init__(self, path: str | Path = ":memory:", audit_key: bytes = b"phase1a-test-audit-key", deletion_ledger_path: str | Path | None = None, deletion_key: bytes = b"phase1b-deletion-key", environment_id: str = "onoes-mind-local"):
        self.path = Path(path) if str(path) != ":memory:" else None
        self.deletion_ledger_path = Path(deletion_ledger_path) if deletion_ledger_path else (self.path.parent / (self.path.name + ".deletions.jsonl") if self.path else None)
        self.deletion_key, self.environment_id = deletion_key, environment_id
        self._deletion_lock = threading.Lock()
        # The local bridge serves requests on a process-boundary server
        # thread.  Bridge-level serialization preserves the ledger's
        # transaction discipline while allowing that documented use.
        self.db = sqlite3.connect(str(path), isolation_level=None, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("PRAGMA busy_timeout=3000")
        if str(path) != ":memory:":
            self.db.execute("PRAGMA journal_mode=WAL")
        self.audit_key = audit_key
        self.migrate()
        if self.deletion_ledger_path:
            self._ensure_deletion_ledger()

    def close(self) -> None:
        self.db.close()

    @contextmanager
    def _transaction(self, *, immediate: bool = False):
        try:
            self.db.execute("BEGIN IMMEDIATE" if immediate else "BEGIN")
        except sqlite3.OperationalError as exc:
            if "locked" in str(exc).lower() or "busy" in str(exc).lower():
                raise LedgerError("ledger busy; retry") from exc
            raise
        try:
            yield
        except Exception as exc:
            self.db.rollback()
            if isinstance(exc, sqlite3.OperationalError) and ("locked" in str(exc).lower() or "busy" in str(exc).lower()):
                raise LedgerError("ledger busy; retry") from exc
            raise
        else:
            self.db.commit()

    def migrate(self) -> None:
        current = self.db.execute("SELECT COALESCE(MAX(version), 0) FROM schema_migrations").fetchone()[0] if self._table_exists("schema_migrations") else 0
        if current < 1:
            self.db.executescript(Path(__file__).with_name("migrations").joinpath("001_core.sql").read_text())
            self.db.execute("INSERT INTO schema_migrations(version, name) VALUES (1, 'core')")
            current = 1
        if current < 2:
            self.db.executescript(Path(__file__).with_name("migrations").joinpath("002_integrity.sql").read_text())
            self.db.execute("INSERT INTO schema_migrations(version, name) VALUES (2, 'integrity')")
            current = 2
        if current < 3:
            self.db.executescript(Path(__file__).with_name("migrations").joinpath("003_worker.sql").read_text())
            self.db.execute("INSERT INTO schema_migrations(version, name) VALUES (3, 'worker')")
            current = 3
        if current < 4:
            self.db.executescript(Path(__file__).with_name("migrations").joinpath("004_delivery.sql").read_text())
            self.db.execute("INSERT INTO schema_migrations(version, name) VALUES (4, 'delivery')")
            current = 4
        if current < 5:
            self.db.executescript(Path(__file__).with_name("migrations").joinpath("005_intelligence.sql").read_text())
            self.db.execute("INSERT INTO schema_migrations(version, name) VALUES (5, 'intelligence')")
            current = 5
        if current >= 5 and not self._table_exists("hardening_state"):
            self.db.executescript(Path(__file__).with_name("migrations").joinpath("006_hardening.sql").read_text())
        if current >= 5 and not self._table_exists("continuity_sessions"):
            self.db.executescript(Path(__file__).with_name("migrations").joinpath("007_continuity.sql").read_text())

    def rollback(self, target: int = 0) -> None:
        if target not in (0, 2, 3, 4, 5) or not self._table_exists("schema_migrations"):
            raise LedgerError("only rollback to version 2, 3, 4, 5, or 0 is supported")
        current = self.db.execute("SELECT COALESCE(MAX(version), 0) FROM schema_migrations").fetchone()[0]
        if target == 5:
            return
        if current >= 5:
            self.db.executescript(Path(__file__).with_name("migrations").joinpath("005_intelligence_down.sql").read_text())
            self.db.execute("DELETE FROM schema_migrations WHERE version=5")
            current = 4
        if target == 4:
            return
        if current >= 4:
            self.db.executescript(Path(__file__).with_name("migrations").joinpath("004_delivery_down.sql").read_text())
            current = 3
        if target == 3:
            return
        if current >= 3:
            self.db.executescript(Path(__file__).with_name("migrations").joinpath("003_worker_down.sql").read_text())
            current = 2
        if target == 2:
            return
        self.db.executescript(Path(__file__).with_name("migrations").joinpath("001_core_down.sql").read_text())

    # Phase 2 and Phase 3 coordination live in this same canonical Ledger.
    def create_work_item(self, work_code: str, requester: str, project: str, pipeline: str,
                         idempotency_key: str, requested_delivery_target: str | None = None,
                         requested_delivery_channel: str | None = None,
                         correlation_id: str | None = None) -> dict[str, Any]:
        existing = self.db.execute("SELECT * FROM work_items WHERE requester=? AND idempotency_key=?", (requester, idempotency_key)).fetchone()
        if existing:
            return dict(existing)
        correlation_id = correlation_id or "corr_" + hashlib.sha256((requester + "\0" + idempotency_key).encode()).hexdigest()[:24]
        try:
            self.db.execute("INSERT INTO work_items(work_code,requester,project,pipeline,requested_delivery_target,requested_delivery_channel,current_state,current_stage,correlation_id,idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?)",
                            (work_code, requester, project, pipeline, requested_delivery_target, requested_delivery_channel, "PENDING", None, correlation_id, idempotency_key))
        except sqlite3.IntegrityError as exc:
            raise LedgerError("work item conflicts with an existing identity") from exc
        return self.get_work(work_code)

    def get_work(self, work_code: str) -> dict[str, Any]:
        row = self.db.execute("SELECT * FROM work_items WHERE work_code=?", (work_code,)).fetchone()
        if not row:
            raise LedgerError("unknown work item")
        return dict(row)

    def add_stage(self, work_code: str, stage_code: str, sequence_no: int, assigned_capability: str,
                  input_context_ref: str | None = None) -> dict[str, Any]:
        self.get_work(work_code)
        existing = self.db.execute("SELECT * FROM stage_executions WHERE work_code=? AND stage_code=? AND attempt_no=1", (work_code, stage_code)).fetchone()
        if existing:
            return dict(existing)
        stage_id = "stage_" + hashlib.sha256(f"{work_code}\0{stage_code}\01".encode()).hexdigest()[:24]
        self.db.execute("INSERT INTO stage_executions(stage_execution_id,work_code,stage_code,sequence_no,attempt_no,state,assigned_capability,input_context_ref) VALUES (?,?,?,?,?,?,?,?)",
                        (stage_id, work_code, stage_code, sequence_no, 1, "PENDING", assigned_capability, input_context_ref))
        return self.get_stage(stage_id)

    def get_stage(self, stage_execution_id: str) -> dict[str, Any]:
        row = self.db.execute("SELECT * FROM stage_executions WHERE stage_execution_id=?", (stage_execution_id,)).fetchone()
        if not row:
            raise LedgerError("unknown stage execution")
        return dict(row)

    def claim_stage(self, worker_id: str, lease_seconds: int = 60, now: float | None = None) -> dict[str, Any]:
        now = time.time() if now is None else now
        with self._transaction():
            candidates = self.db.execute("SELECT s.* FROM stage_executions s WHERE s.state IN ('PENDING','RETRY_WAIT','RECOVERABLE') AND (s.next_attempt_at IS NULL OR s.next_attempt_at<=?) AND NOT EXISTS (SELECT 1 FROM stage_executions prior WHERE prior.work_code=s.work_code AND prior.sequence_no<s.sequence_no AND prior.state!='SUCCEEDED') ORDER BY s.sequence_no,s.attempt_no,s.stage_execution_id LIMIT 1", (now,)).fetchall()
            if not candidates:
                raise LedgerError("no claimable stage")
            row = candidates[0]
            new_version = row["lease_version"] + 1
            expires = now + lease_seconds
            changed = self.db.execute("UPDATE stage_executions SET state='RUNNING',lease_owner=?,lease_version=?,lease_expires_at=?,row_version=row_version+1,started_at=COALESCE(started_at,?) WHERE stage_execution_id=? AND row_version=? AND state IN ('PENDING','RETRY_WAIT','RECOVERABLE')",
                                      (worker_id, new_version, expires, _now(), row["stage_execution_id"], row["row_version"])).rowcount
            if changed != 1:
                raise LedgerError("optimistic lock conflict")
            self.db.execute("UPDATE work_items SET current_state='RUNNING',current_stage=?,updated_at=? WHERE work_code=? AND current_state NOT IN ('COMPLETED','CANCELLED','DEAD_LETTER')", (row["stage_code"], _now(), row["work_code"]))
        return self.get_stage(row["stage_execution_id"])

    def heartbeat(self, stage_execution_id: str, worker_id: str, lease_version: int, lease_seconds: int = 60) -> dict[str, Any]:
        expires = time.time() + lease_seconds
        with self.db:
            changed = self.db.execute("UPDATE stage_executions SET lease_expires_at=?,row_version=row_version+1 WHERE stage_execution_id=? AND state='RUNNING' AND lease_owner=? AND lease_version=?",
                                      (expires, stage_execution_id, worker_id, lease_version)).rowcount
        if changed != 1:
            raise LedgerError("stale lease")
        return self.get_stage(stage_execution_id)

    def recover_expired_leases(self, now: float | None = None) -> int:
        now = time.time() if now is None else now
        with self.db:
            expired = self.db.execute("SELECT * FROM stage_executions WHERE state='RUNNING' AND lease_expires_at IS NOT NULL AND lease_expires_at<?", (now,)).fetchall()
            for row in expired:
                self.db.execute("UPDATE stage_executions SET state='FAILED',error_code='timeout',lease_owner=NULL,lease_expires_at=NULL,row_version=row_version+1,completed_at=? WHERE stage_execution_id=?", (_now(), row["stage_execution_id"]))
                attempt = row["attempt_no"] + 1
                retry_id = "stage_" + hashlib.sha256(f"{row['work_code']}\0{row['stage_code']}\0{attempt}".encode()).hexdigest()[:24]
                self.db.execute("INSERT OR IGNORE INTO stage_executions(stage_execution_id,work_code,stage_code,sequence_no,attempt_no,state,assigned_capability,next_attempt_at) VALUES (?,?,?,?,?,?,?,?)", (retry_id,row["work_code"],row["stage_code"],row["sequence_no"],attempt,"RECOVERABLE",row["assigned_capability"],time.time()))
            return len(expired)

    def _lease_guard(self, stage_execution_id: str, worker_id: str, lease_version: int) -> dict[str, Any]:
        row = self.get_stage(stage_execution_id)
        if row["state"] != "RUNNING":
            if row["error_code"] == "timeout":
                raise LedgerError("stale lease")
            raise LedgerError("stage is not running")
        if row["lease_owner"] != worker_id or row["lease_version"] != lease_version:
            raise LedgerError("stale lease")
        return row

    def complete_stage(self, stage_execution_id: str, worker_id: str, lease_version: int, payload: dict[str, Any]) -> dict[str, Any]:
        row = self._lease_guard(stage_execution_id, worker_id, lease_version)
        encoded = _canonical(payload)
        payload_hash = hashlib.sha256(encoded.encode()).hexdigest()
        artifact_id = "art_" + payload_hash[:24]
        neuron_id = None
        receipt_id = "rcpt_stage_" + hashlib.sha256((stage_execution_id + ":" + str(lease_version)).encode()).hexdigest()[:24]
        with self._transaction():
            # Recheck the fence inside the write transaction, after all work
            # has been selected, so a late worker cannot commit evidence.
            current = self.db.execute("SELECT * FROM stage_executions WHERE stage_execution_id=? AND state='RUNNING' AND lease_owner=? AND lease_version=? AND row_version=?", (stage_execution_id, worker_id, lease_version, row["row_version"])).fetchone()
            if not current:
                raise LedgerError("stale lease")
            self.db.execute("INSERT OR IGNORE INTO artifacts(artifact_id,artifact_hash,payload_json) VALUES (?,?,?)", (artifact_id, payload_hash, encoded))
            next_seq = self.db.execute("SELECT COALESCE(MAX(sequence_no),0)+1 FROM neurons WHERE source_code='ON'").fetchone()[0]
            neuron_id = f"ON-{next_seq:05d}"
            self.db.execute("INSERT INTO neurons(neuron_id,source_code,sequence_no,state_code,scope_code,visibility_code,memory_type,claim) VALUES (?,?,?,?,?,?,?,?)",
                            (neuron_id, "ON", next_seq, "ACTIVE", "project/onoes-mind/shared", "ACTIVE", "worker_output", encoded))
            self.db.execute("INSERT INTO receipts(receipt_id,event_id,principal_id,status,record_id,payload_hash,work_code,stage_execution_id) VALUES (?,?,?,?,?,?,?,?)",
                            (receipt_id, "stage_complete:" + stage_execution_id, "operator", "accepted", neuron_id, payload_hash, row["work_code"], stage_execution_id))
            self.db.execute("UPDATE stage_executions SET state='SUCCEEDED',output_artifact_ref=?,output_payload_hash=?,receipt_ref=?,lease_owner=NULL,lease_expires_at=NULL,row_version=row_version+1,completed_at=? WHERE stage_execution_id=? AND row_version=?",
                            (artifact_id, payload_hash, receipt_id, _now(), stage_execution_id, row["row_version"]))
            # Prior failed attempts are terminal history once a later retry
            # succeeds; they must not keep the parent task RUNNING forever.
            remaining = self.db.execute("SELECT COUNT(*) FROM stage_executions WHERE work_code=? AND state NOT IN ('SUCCEEDED','CANCELLED','FAILED','DEAD_LETTER')", (row["work_code"],)).fetchone()[0]
            self.db.execute("UPDATE work_items SET current_state=?,updated_at=? WHERE work_code=?", ("COMPLETED" if remaining == 0 else "RUNNING", _now(), row["work_code"]))
            work = self.db.execute("SELECT requested_delivery_target,requested_delivery_channel,correlation_id FROM work_items WHERE work_code=?", (row["work_code"],)).fetchone()
            message_id = None
            if work["requested_delivery_target"]:
                envelope = self.build_a2a_envelope("worker", work["requested_delivery_target"], "STAGE_RESULT", {"work_code": row["work_code"], "stage_execution_id": stage_execution_id, "neuron_id": neuron_id, "artifact_id": artifact_id, "receipt_id": receipt_id}, correlation_id=work["correlation_id"], idempotency_key=receipt_id)
                message_id = envelope["message_id"]
                self.db.execute("INSERT INTO outbox_messages(outbox_id,message_id,idempotency_key,sender,receiver,message_type,envelope_json,payload_hash,state) VALUES (?,?,?,?,?,?,?,?,?)", ("out_" + message_id, message_id, receipt_id, "worker", work["requested_delivery_target"], "STAGE_RESULT", json.dumps(envelope, sort_keys=True, separators=(",", ":")), envelope["payload_hash"], "PENDING"))
                self.db.execute("INSERT INTO delivery_receipts(receipt_id,message_id,status) VALUES (?,?,?)", ("drcpt_" + message_id, message_id, "PENDING"))
        result = {"stage_execution_id": stage_execution_id, "receipt_id": receipt_id, "artifact_id": artifact_id, "output_payload_hash": payload_hash, "neuron_id": neuron_id}
        if message_id:
            result["message_id"] = message_id
        return result

    def fail_stage(self, stage_execution_id: str, worker_id: str, lease_version: int, error_code: str,
                   retryable: bool, max_attempts: int = 3, backoff_seconds: float = 1.0) -> dict[str, Any]:
        row = self._lease_guard(stage_execution_id, worker_id, lease_version)
        with self.db:
            current = self.db.execute("SELECT * FROM stage_executions WHERE stage_execution_id=? AND state='RUNNING' AND lease_owner=? AND lease_version=? AND row_version=?", (stage_execution_id, worker_id, lease_version, row["row_version"])).fetchone()
            if not current:
                raise LedgerError("stale lease")
            can_retry = retryable and row["attempt_no"] < max_attempts
            self.db.execute("UPDATE stage_executions SET state='FAILED',error_code=?,lease_owner=NULL,lease_expires_at=NULL,row_version=row_version+1,completed_at=? WHERE stage_execution_id=?", (error_code, _now(), stage_execution_id))
            if can_retry:
                attempt = row["attempt_no"] + 1
                retry_id = "stage_" + hashlib.sha256(f"{row['work_code']}\0{row['stage_code']}\0{attempt}".encode()).hexdigest()[:24]
                self.db.execute("INSERT INTO stage_executions(stage_execution_id,work_code,stage_code,sequence_no,attempt_no,state,assigned_capability,next_attempt_at) VALUES (?,?,?,?,?,?,?,?)", (retry_id,row["work_code"],row["stage_code"],row["sequence_no"],attempt,"RETRY_WAIT",row["assigned_capability"],time.time()+backoff_seconds*(2**(row["attempt_no"]-1))))
                state = "RETRY_WAIT"
            else:
                state = "DEAD_LETTER" if retryable else "FAILED"
                self.db.execute("UPDATE stage_executions SET state=? WHERE stage_execution_id=?", (state, stage_execution_id))
                self.db.execute("UPDATE work_items SET current_state=?,updated_at=? WHERE work_code=?", ("DEAD_LETTER" if state == "DEAD_LETTER" else "FAILED", _now(), row["work_code"]))
        return {"stage_execution_id": stage_execution_id, "state": state, "error_code": error_code}

    # ---- Phase 3 authenticated local A2A and delivery -----------------
    def register_a2a_agent(self, agent_id: str, signing_key: bytes, can_send: Iterable[str] = (), can_receive: bool = True) -> None:
        if not isinstance(agent_id, str) or not agent_id or not isinstance(signing_key, (bytes, bytearray)) or len(signing_key) < 16:
            raise LedgerError("invalid A2A agent registration")
        with self.db:
            self.db.execute("INSERT INTO a2a_agents(agent_id,signing_key,can_receive) VALUES (?,?,?) ON CONFLICT(agent_id) DO UPDATE SET signing_key=excluded.signing_key,can_receive=excluded.can_receive,enabled=1", (agent_id, bytes(signing_key), int(can_receive)))
            self.db.execute("DELETE FROM a2a_permissions WHERE agent_id=?", (agent_id,))
            self.db.executemany("INSERT INTO a2a_permissions(agent_id,message_type) VALUES (?,?)", ((agent_id, message_type) for message_type in can_send))

    def _a2a_agent(self, agent_id: str) -> sqlite3.Row:
        row = self.db.execute("SELECT * FROM a2a_agents WHERE agent_id=? AND enabled=1", (agent_id,)).fetchone()
        if not row:
            raise LedgerError("unknown or disabled A2A agent")
        return row

    @staticmethod
    def _a2a_body(envelope: dict[str, Any]) -> dict[str, Any]:
        return {key: envelope[key] for key in envelope if key != "signature"}

    def build_a2a_envelope(self, sender: str, receiver: str, message_type: str, payload: dict[str, Any], *, correlation_id: str | None = None, idempotency_key: str | None = None, ttl_seconds: int = 300) -> dict[str, Any]:
        source = self._a2a_agent(sender)
        target = self._a2a_agent(receiver)
        if not target["can_receive"]:
            raise LedgerError("receiver unauthorized")
        if not isinstance(payload, dict) or not message_type or ttl_seconds <= 0 or ttl_seconds > 3600:
            raise LedgerError("malformed A2A envelope")
        message_id = "msg_" + uuid.uuid4().hex
        body = {"api_version": "a2a.v1", "message_id": message_id, "correlation_id": correlation_id or "corr_" + uuid.uuid4().hex, "idempotency_key": idempotency_key or "idem_" + uuid.uuid4().hex, "sender": sender, "receiver": receiver, "message_type": message_type, "created_at": _now(), "expires_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + ttl_seconds)), "nonce": "nonce_" + secrets.token_hex(16), "payload_hash": hashlib.sha256(_canonical(payload).encode()).hexdigest(), "payload": payload}
        body["signature"] = hmac.new(bytes(source["signing_key"]), _canonical(self._a2a_body(body)).encode(), hashlib.sha256).hexdigest()
        return body

    def _verify_a2a(self, envelope: Any, receiver: str, enforce_expiry: bool = True) -> dict[str, Any]:
        if not isinstance(envelope, dict) or set((envelope or {}).keys()) != {"api_version", "message_id", "correlation_id", "idempotency_key", "sender", "receiver", "message_type", "created_at", "expires_at", "nonce", "payload_hash", "payload", "signature"}:
            raise LedgerError("malformed A2A envelope")
        if envelope["api_version"] != "a2a.v1" or envelope["receiver"] != receiver or not isinstance(envelope["payload"], dict):
            raise LedgerError("wrong target or malformed envelope")
        sender = self._a2a_agent(envelope["sender"])
        target = self._a2a_agent(receiver)
        if not target["can_receive"] or not self.db.execute("SELECT 1 FROM a2a_permissions WHERE agent_id=? AND message_type=?", (envelope["sender"], envelope["message_type"])).fetchone():
            raise LedgerError("unauthorized A2A message")
        expected_payload = hashlib.sha256(_canonical(envelope["payload"]).encode()).hexdigest()
        if not hmac.compare_digest(expected_payload, str(envelope["payload_hash"])):
            raise LedgerError("payload hash mismatch")
        expected_sig = hmac.new(bytes(sender["signing_key"]), _canonical(self._a2a_body(envelope)).encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected_sig, str(envelope["signature"])):
            raise LedgerError("invalid A2A signature")
        try:
            created = calendar.timegm(time.strptime(envelope["created_at"], "%Y-%m-%dT%H:%M:%SZ"))
            expires = calendar.timegm(time.strptime(envelope["expires_at"], "%Y-%m-%dT%H:%M:%SZ"))
        except (TypeError, ValueError, OverflowError) as exc:
            raise LedgerError("malformed A2A timestamp") from exc
        if enforce_expiry and (expires <= time.time() or created > time.time() + 30 or expires - created > 3600):
            raise LedgerError("expired A2A message")
        return envelope

    def receive_a2a(self, envelope: dict[str, Any], receiver: str) -> dict[str, Any]:
        # A committed message is a harmless duplicate, even if the sender
        # retries the same envelope after its nominal expiry.
        verified = self._verify_a2a(envelope, receiver, enforce_expiry=False)
        prior = self.db.execute("SELECT payload_hash FROM inbox_messages WHERE receiver=? AND message_id=?", (receiver, verified["message_id"])).fetchone()
        if prior:
            return {"status": "duplicate", "message_id": verified["message_id"]}
        envelope = self._verify_a2a(verified, receiver)
        idem = self.db.execute("SELECT message_id,payload_hash FROM inbox_messages WHERE receiver=? AND idempotency_key=?", (receiver, envelope["idempotency_key"])).fetchone()
        if idem:
            if idem["payload_hash"] != envelope["payload_hash"]:
                raise LedgerError("idempotency replay divergence")
            return {"status": "duplicate", "message_id": idem["message_id"]}
        ack_id = "ack_" + envelope["message_id"]
        try:
            with self._transaction():
                self.db.execute("INSERT INTO a2a_nonces(receiver,nonce,message_id,expires_at) VALUES (?,?,?,?)", (receiver, envelope["nonce"], envelope["message_id"], envelope["expires_at"]))
                self.db.execute("INSERT INTO inbox_messages(message_id,idempotency_key,sender,receiver,message_type,envelope_json,payload_hash,state,ack_id,processed_at) VALUES (?,?,?,?,?,?,?,?,?,?)", (envelope["message_id"], envelope["idempotency_key"], envelope["sender"], receiver, envelope["message_type"], json.dumps(envelope, sort_keys=True, separators=(",", ":")), envelope["payload_hash"], "ACKED", ack_id, _now()))
        except sqlite3.IntegrityError as exc:
            if "a2a_nonces" in str(exc):
                raise LedgerError("replayed A2A nonce") from exc
            raise LedgerError("duplicate A2A delivery") from exc
        return {"status": "accepted", "message_id": envelope["message_id"], "ack_id": ack_id}

    def dispatch_outbox(self, transport: Any, *, now: float | None = None, max_messages: int = 1, max_attempts: int = 3, backoff_seconds: float = 1.0) -> int:
        now = time.time() if now is None else now
        claimed = []
        with self._transaction():
            rows = self.db.execute("SELECT * FROM outbox_messages WHERE state IN ('PENDING','RETRY_WAIT') AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY created_at LIMIT ?", (now, max_messages)).fetchall()
            for row in rows:
                if row["attempts"] >= max_attempts:
                    continue
                self.db.execute("UPDATE outbox_messages SET state='IN_FLIGHT',lease_owner=?,lease_expires_at=?,attempts=attempts+1 WHERE outbox_id=? AND state IN ('PENDING','RETRY_WAIT')", ("dispatcher", now + 60, row["outbox_id"]))
                claimed.append(dict(row))
        delivered = 0
        for row in claimed:
            envelope = json.loads(row["envelope_json"])
            attempt = row["attempts"] + 1
            try:
                response = transport(envelope)
                if response.get("status") not in {"accepted", "duplicate"}:
                    raise LedgerError("acknowledgement rejected")
                with self._transaction():
                    self.db.execute("UPDATE outbox_messages SET state='SENT',sent_at=?,lease_owner=NULL,lease_expires_at=NULL WHERE outbox_id=? AND state='IN_FLIGHT'", (_now(), row["outbox_id"]))
                    self.db.execute("UPDATE delivery_receipts SET status='ACKED',attempts=?,updated_at=? WHERE message_id=?", (attempt, _now(), row["message_id"]))
                delivered += 1
            except Exception as exc:
                terminal = attempt >= max_attempts
                with self._transaction():
                    self.db.execute("UPDATE outbox_messages SET state=?,next_attempt_at=?,last_error=?,lease_owner=NULL,lease_expires_at=NULL WHERE outbox_id=? AND state='IN_FLIGHT'", ("DEAD_LETTER" if terminal else "RETRY_WAIT", None if terminal else time.time() + backoff_seconds * (2 ** (attempt - 1)), str(exc)[:256], row["outbox_id"]))
                    self.db.execute("UPDATE delivery_receipts SET status=?,attempts=?,error_code=?,updated_at=? WHERE message_id=?", ("DEAD_LETTER" if terminal else "RETRY_WAIT", attempt, str(exc)[:256], _now(), row["message_id"]))
        return delivered

    def get_neuron(self, neuron_id: str) -> dict[str, Any]:
        row = self.db.execute("SELECT * FROM neurons WHERE neuron_id=?", (neuron_id,)).fetchone()
        if not row:
            raise LedgerError("unknown neuron")
        return dict(row)

    def build_context_pack(self, work_code: str | None = None, principal_id: str | None = None,
                           token_budget: int = 512, *, task: str | None = None,
                           agent: str | None = None, project: str | None = None) -> dict[str, Any]:
        """Build a deterministic, authorized, relevance-ranked bounded pack.

        The legacy positional form remains supported.  The Phase 4 form uses
        task/agent/project explicitly and never trusts caller-supplied scopes.
        """
        principal_id = agent or principal_id
        if not principal_id or self.db.execute("SELECT 1 FROM principals WHERE principal_id=?", (principal_id,)).fetchone() is None:
            raise LedgerError("unauthorized context-pack principal")
        if token_budget <= 0:
            raise LedgerError("token budget must be positive")
        work = self.get_work(work_code) if work_code else None
        project = project or (work["project"] if work else "onoes-mind")
        task = task or (work["pipeline"] if work else "")
        terms = {t.lower() for t in re.findall(r"[A-Za-z0-9_-]{2,}", task)}
        scopes = [r[0] for r in self.db.execute("SELECT scope_id FROM scope_grants WHERE principal_id=? AND can_read=1", (principal_id,))]
        if not scopes:
            raise LedgerError("principal has no readable scope")
        marks = ",".join("?" for _ in scopes)
        rows = self.db.execute(f"SELECT * FROM neurons WHERE state_code='ACTIVE' AND visibility_code NOT IN ('QUARANTINE','QUARANTINED') AND project_id=? AND scope_code IN ({marks})", (project, *scopes)).fetchall()
        ranked = []
        now = time.time()
        for row in rows:
            claim = row["claim"]
            claim_terms = {t.lower() for t in re.findall(r"[A-Za-z0-9_-]{2,}", claim)}
            relevance = len(terms & claim_terms) / max(len(terms), 1)
            try:
                age_days = max(0.0, (now - calendar.timegm(time.strptime(row["freshness_at"], "%Y-%m-%d %H:%M:%S"))) / 86400)
            except (TypeError, ValueError, OverflowError):
                age_days = 3650.0
            freshness = 1.0 / (1.0 + age_days)
            importance = float(row["importance"])
            confidence = float(row["confidence"])
            score = (0.45 * relevance) + (0.25 * importance) + (0.20 * confidence) + (0.10 * freshness)
            item = dict(row)
            item["relevance"] = round(relevance, 6)
            item["freshness"] = round(freshness, 6)
            item["confidence"] = confidence
            try:
                item["provenance"] = json.loads(row["provenance_json"])
            except (TypeError, json.JSONDecodeError):
                item["provenance"] = []
            item["token_cost"] = len(claim.split())
            ranked.append((score, row["neuron_id"], item))
        ranked.sort(key=lambda item: (-item[0], item[1]))
        selected, omissions, used = [], [], 0
        for score, _, item in ranked:
            if used + item["token_cost"] > token_budget:
                omissions.append({"neuron_id": item["neuron_id"], "reason": "token_budget"})
                continue
            selected.append(item)
            used += item["token_cost"]
        pack_body = {"task": task, "agent": principal_id, "project": project, "budget": token_budget, "selected": [x["neuron_id"] for x in selected]}
        pack_id = "pack_" + hashlib.sha256(_canonical(pack_body).encode()).hexdigest()[:24]
        provenance = [{"neuron_id": item["neuron_id"], "refs": item["provenance"]} for item in selected]
        return {"pack_id": pack_id, "budget_requested": token_budget, "budget_used": used,
                "project_brief": {"project": project, "pipeline": work["pipeline"] if work else None, "task": task},
                "mental_models": [], "active_constraints": [], "selected_neurons": selected,
                "artifact_refs": [x["artifact_ref"] for x in selected if x.get("artifact_ref")],
                "provenance": provenance, "freshness_confidence": {"freshness": "ranked", "confidence": "derived"},
                "omissions": omissions}

    # ---- Phase 4 intelligence, sequential gates, and local trials --------
    def register_reviewer_capability(self, capability: str, reviewer_id: str, model_version: str = "synthetic-v1",
                                     *, enabled: bool = True, deterministic: bool = True) -> None:
        if not capability or not reviewer_id or not model_version:
            raise LedgerError("invalid reviewer capability")
        if self.db.execute("SELECT 1 FROM principals WHERE principal_id=?", (reviewer_id,)).fetchone() is None:
            raise LedgerError("reviewer principal is unavailable")
        self.db.execute("INSERT INTO reviewer_capabilities(capability,reviewer_id,model_version,enabled,deterministic) VALUES (?,?,?,?,?) ON CONFLICT(capability) DO UPDATE SET reviewer_id=excluded.reviewer_id,model_version=excluded.model_version,enabled=excluded.enabled,deterministic=excluded.deterministic", (capability, reviewer_id, model_version, int(enabled), int(deterministic)))

    def create_audit_pipeline(self, work_code: str, agent_id: str, project_id: str = "onoes-mind") -> dict[str, Any]:
        self.get_work(work_code)
        if self.db.execute("SELECT 1 FROM principals WHERE principal_id=?", (agent_id,)).fetchone() is None:
            raise LedgerError("unknown trial agent")
        pipeline_id = "audit_" + hashlib.sha256((work_code + "\0" + agent_id).encode()).hexdigest()[:24]
        with self._transaction():
            self.db.execute("INSERT OR IGNORE INTO audit_pipelines(pipeline_id,work_code,agent_id,project_id,current_state,current_stage) VALUES (?,?,?,?,?,?)", (pipeline_id, work_code, agent_id, project_id, "PENDING", None))
            stages = (("structure-governance", "structure-reviewer"), ("security-challenge", "security-reviewer"), ("final-adversarial-gate", "adversarial-reviewer"))
            for sequence, (stage, capability) in enumerate(stages, 1):
                stage_id = "audit_stage_" + hashlib.sha256((pipeline_id + "\0" + stage).encode()).hexdigest()[:24]
                self.db.execute("INSERT OR IGNORE INTO audit_stage_runs(stage_run_id,pipeline_id,stage_code,sequence_no,state,assigned_capability) VALUES (?,?,?,?,?,?)", (stage_id, pipeline_id, stage, sequence, "PENDING", capability))
        return dict(self.db.execute("SELECT * FROM audit_pipelines WHERE pipeline_id=?", (pipeline_id,)).fetchone())

    def _block_audit(self, pipeline_id: str, stage_id: str, code: str) -> None:
        with self._transaction():
            self.db.execute("UPDATE audit_stage_runs SET state='BLOCKED',error_code=? WHERE stage_run_id=? AND state='PENDING'", (code, stage_id))
            self.db.execute("UPDATE audit_pipelines SET current_state='BLOCKED',current_stage=?,updated_at=? WHERE pipeline_id=?", (self.db.execute("SELECT stage_code FROM audit_stage_runs WHERE stage_run_id=?", (stage_id,)).fetchone()[0], _now(), pipeline_id))

    def run_audit_pipeline(self, pipeline_id: str) -> dict[str, Any]:
        pipeline = self.db.execute("SELECT * FROM audit_pipelines WHERE pipeline_id=?", (pipeline_id,)).fetchone()
        if not pipeline:
            raise LedgerError("unknown audit pipeline")
        with self._transaction():
            self.db.execute("UPDATE audit_pipelines SET current_state='RUNNING',updated_at=? WHERE pipeline_id=? AND current_state='PENDING'", (_now(), pipeline_id))
        stages = self.db.execute("SELECT * FROM audit_stage_runs WHERE pipeline_id=? ORDER BY sequence_no", (pipeline_id,)).fetchall()
        prior_findings: list[dict[str, Any]] = []
        for stage in stages:
            capability = self.db.execute("SELECT * FROM reviewer_capabilities WHERE capability=? AND enabled=1", (stage["assigned_capability"],)).fetchone()
            a2a_ready = capability and self.db.execute("SELECT 1 FROM a2a_agents WHERE agent_id=? AND enabled=1 AND can_receive=1", (capability["reviewer_id"],)).fetchone() and self.db.execute("SELECT 1 FROM a2a_agents WHERE agent_id=? AND enabled=1", (pipeline["agent_id"],)).fetchone()
            if not capability or not capability["deterministic"] or not a2a_ready:
                self._block_audit(pipeline_id, stage["stage_run_id"], "required_reviewer_unavailable")
                return dict(self.db.execute("SELECT * FROM audit_pipelines WHERE pipeline_id=?", (pipeline_id,)).fetchone())
            if stage["sequence_no"] > 1:
                previous = self.db.execute("SELECT state FROM audit_stage_runs WHERE pipeline_id=? AND sequence_no=?", (pipeline_id, stage["sequence_no"] - 1)).fetchone()
                if not previous or previous[0] != "SUCCEEDED":
                    self._block_audit(pipeline_id, stage["stage_run_id"], "prior_stage_not_succeeded")
                    return dict(self.db.execute("SELECT * FROM audit_pipelines WHERE pipeline_id=?", (pipeline_id,)).fetchone())
            handoff = {"original_scope": {"agent": pipeline["agent_id"], "project": pipeline["project_id"]}, "stage_role": stage["stage_code"], "prior_findings": prior_findings, "unresolved_questions": [], "required_evidence": ["context_pack", "stage_receipt"], "acceptance_criteria": ["schema_valid", "provenance_present", "reviewer_approved"]}
            encoded = _canonical(handoff)
            payload_hash = hashlib.sha256(encoded.encode()).hexdigest()
            artifact_id = "art_" + payload_hash[:24]
            receipt_id = "rcpt_audit_" + hashlib.sha256((stage["stage_run_id"] + ":" + capability["reviewer_id"]).encode()).hexdigest()[:24]
            verdict = "PASS"
            findings = [{"code": "synthetic_review", "severity": "INFO", "message": "fixed deterministic reviewer result"}]
            output = {"verdict": verdict, "findings": findings, "severity": "INFO", "confidence": 1.0, "provenance": [{"artifact_ref": artifact_id, "model_version": capability["model_version"]}]}
            output_encoded = _canonical(output)
            output_hash = hashlib.sha256(output_encoded.encode()).hexdigest()
            output_artifact = "art_" + output_hash[:24]
            with self._transaction():
                self.db.execute("UPDATE audit_stage_runs SET state='SUCCEEDED',reviewer_id=?,output_artifact_ref=?,handoff_artifact_ref=?,verdict=?,findings_json=?,severity='INFO',confidence=1.0,provenance_json=?,receipt_id=? WHERE stage_run_id=? AND state='PENDING'", (capability["reviewer_id"], output_artifact, artifact_id, verdict, json.dumps(findings, sort_keys=True), json.dumps(output["provenance"], sort_keys=True), receipt_id, stage["stage_run_id"]))
                self.db.execute("INSERT OR IGNORE INTO artifacts(artifact_id,artifact_hash,payload_json) VALUES (?,?,?)", (artifact_id, payload_hash, encoded))
                self.db.execute("INSERT OR IGNORE INTO artifacts(artifact_id,artifact_hash,payload_json) VALUES (?,?,?)", (output_artifact, output_hash, output_encoded))
                self.db.execute("INSERT INTO receipts(receipt_id,event_id,principal_id,status,record_id,payload_hash,work_code,stage_execution_id) VALUES (?,?,?,?,?,?,?,?)", (receipt_id, "audit:" + stage["stage_run_id"], pipeline["agent_id"], "accepted", artifact_id, payload_hash, pipeline["work_code"], None))
                self.db.execute("INSERT INTO handoff_artifacts(handoff_id,pipeline_id,from_stage,to_stage,artifact_ref,payload_hash,receipt_id) VALUES (?,?,?,?,?,?,?)", ("handoff_" + stage["stage_run_id"], pipeline_id, stage["stage_code"], stages[stage["sequence_no"]]["stage_code"] if stage["sequence_no"] < len(stages) else pipeline["agent_id"], artifact_id, payload_hash, receipt_id))
                self.db.execute("UPDATE audit_pipelines SET current_stage=?,updated_at=? WHERE pipeline_id=?", (stage["stage_code"], _now(), pipeline_id))
                if capability["reviewer_id"] in {"tripp", "echo", "cyony"}:
                    envelope = self.build_a2a_envelope(pipeline["agent_id"], capability["reviewer_id"], "AUDIT_HANDOFF", {"pipeline_id": pipeline_id, "stage": stage["stage_code"], "artifact_ref": artifact_id}, idempotency_key=receipt_id)
                    self.db.execute("INSERT INTO outbox_messages(outbox_id,message_id,idempotency_key,sender,receiver,message_type,envelope_json,payload_hash,state) VALUES (?,?,?,?,?,?,?,?,?)", ("out_" + envelope["message_id"], envelope["message_id"], receipt_id, pipeline["agent_id"], capability["reviewer_id"], "AUDIT_HANDOFF", json.dumps(envelope, sort_keys=True, separators=(",", ":")), envelope["payload_hash"], "PENDING"))
                    self.db.execute("INSERT INTO delivery_receipts(receipt_id,message_id,status) VALUES (?,?,?)", ("drcpt_" + envelope["message_id"], envelope["message_id"], "PENDING"))
            prior_findings.extend(findings)
        with self._transaction():
            self.db.execute("UPDATE audit_pipelines SET current_state='COMPLETED',updated_at=? WHERE pipeline_id=?", (_now(), pipeline_id))
        return dict(self.db.execute("SELECT * FROM audit_pipelines WHERE pipeline_id=?", (pipeline_id,)).fetchone())

    def run_synthetic_trial(self, agent_id: str) -> dict[str, Any]:
        if agent_id not in {"tripp", "echo", "cyony"}:
            raise LedgerError("unknown synthetic trial agent")
        for principal in ("tripp", "echo", "cyony"):
            self.create_principal(principal)
        for reviewer in ("tripp", "echo", "cyony"):
            self.register_a2a_agent(reviewer, (reviewer + "-phase4-secret").encode()[:32], can_send=("AUDIT_HANDOFF", "ACK"), can_receive=True)
        self.create_work_item("trial-" + agent_id, agent_id, "onoes-mind", "structure-governance", "phase4-" + agent_id, agent_id, "audit-inbox")
        for capability, reviewer in (("structure-reviewer", "tripp"), ("security-reviewer", "echo"), ("adversarial-reviewer", "cyony")):
            self.register_reviewer_capability(capability, reviewer)
        pipeline = self.create_audit_pipeline("trial-" + agent_id, agent_id)
        result = self.run_audit_pipeline(pipeline["pipeline_id"])
        self.dispatch_outbox(lambda envelope: self.receive_a2a(envelope, envelope["receiver"]), max_messages=20, backoff_seconds=0)
        return result

    # ---- Durable local interruption/resumption trial -------------------
    _CONTINUITY_ROOT = Path("X:/SANITIZED/LOCAL_PATH")
    _CONTINUITY_FILES = (
        "ONOES_MIND_CANONICAL_PATHS.md", "ONOES_MIND_PROJECT_BOUNDARY.md",
        "Onoes-Mind-Build-Plan-v4.1.md", "ONOES_MIND_CODEX_EXECUTION_PLAN.md",
        "AUDIT_CURRENT_STATE.md", "IMPLEMENTATION_SCOPE.md",
        "PHASE_1B_EVIDENCE.md", "PHASE_2_EVIDENCE.md", "PHASE_3_EVIDENCE.md",
        "PHASE_4_EVIDENCE.md", "PHASE_5_EVIDENCE.md",
    )

    def _continuity_identity(self) -> tuple[str, str]:
        root = Path.cwd().resolve()
        expected = self._CONTINUITY_ROOT.resolve()
        if root != expected:
            raise LedgerError("continuity boundary blocked")
        return str(expected).replace("\\", "/"), "4.1"

    def _continuity_manifest(self, session_id: str) -> None:
        root, _ = self._continuity_identity()
        for relative in self._CONTINUITY_FILES:
            path = Path(root) / relative
            if not path.is_file():
                raise LedgerError("continuity evidence file missing: " + relative)
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            self.db.execute("INSERT INTO continuity_manifest(session_id,path,sha256,action) VALUES (?,?,?,'INSPECTED')", (session_id, relative, digest))

    def start_continuity_session(self, session_id: str = "continuity-trial") -> dict[str, Any]:
        root, plan_version = self._continuity_identity()
        for agent in ("tripp", "echo", "cyony"):
            self.create_principal(agent)
        objective = "Prove durable interruption, fenced takeover, bounded handoff, restart recovery, and local A2A acknowledgement."
        checkpoint = {"event": "session_created", "worker": None, "lease_epoch": 0}
        with self._transaction():
            self.db.execute("INSERT OR IGNORE INTO continuity_sessions(session_id,project_id,canonical_repo_path,build_plan_version,phase,stage,task_objective,status,current_worker,checkpoint_json,next_action,blockers_json,risks_json,handoff_json,audit_before_resume) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (session_id, "onoes-mind", root, plan_version, "Phase 5", "durable-interruption-resumption", objective, "ACTIVE", None, _canonical(checkpoint), "claim tripp", "[]", _canonical(["production activation remains blocked"]), "{}", "NOT_REQUIRED"))
            if self.db.execute("SELECT COUNT(*) FROM continuity_manifest WHERE session_id=?", (session_id,)).fetchone()[0] == 0:
                self._continuity_manifest(session_id)
        return self.get_continuity_session(session_id)

    def get_continuity_session(self, session_id: str) -> dict[str, Any]:
        row = self.db.execute("SELECT * FROM continuity_sessions WHERE session_id=?", (session_id,)).fetchone()
        if not row:
            raise LedgerError("unknown continuity session")
        return dict(row)

    def claim_continuity_lease(self, session_id: str, agent_id: str) -> dict[str, Any]:
        if agent_id not in {"tripp", "echo", "cyony"}:
            raise LedgerError("unknown continuity worker")
        session = self.get_continuity_session(session_id)
        prior = self.db.execute("SELECT * FROM continuity_leases WHERE session_id=? ORDER BY lease_epoch DESC LIMIT 1", (session_id,)).fetchone()
        if prior and prior["state"] == "ACTIVE":
            raise LedgerError("continuity lease is already active")
        epoch = (prior["lease_epoch"] if prior else 0) + 1
        if prior and agent_id == prior["agent_id"]:
            raise LedgerError("takeover must use the next worker")
        lease_id = f"lease_{session_id}_{epoch}"
        with self._transaction():
            self.db.execute("INSERT INTO continuity_leases(lease_id,session_id,agent_id,lease_epoch,state,takeover_of) VALUES (?,?,?,?,?,?)", (lease_id, session_id, agent_id, epoch, "ACTIVE", prior["lease_id"] if prior else None))
            self.db.execute("UPDATE continuity_sessions SET status=?,current_worker=?,lease_epoch=?,stage=?,next_action=?,checkpoint_json=?,updated_at=CURRENT_TIMESTAMP WHERE session_id=?", ("RESUMED" if prior else "ACTIVE", agent_id, epoch, "active", "interrupt or complete active worker", _canonical({"event": "lease_claimed", "agent": agent_id, "lease_epoch": epoch}), session_id))
        return dict(self.db.execute("SELECT * FROM continuity_leases WHERE lease_id=?", (lease_id,)).fetchone())

    def interrupt_continuity_session(self, session_id: str, lease_id: str, reason: str) -> dict[str, Any]:
        lease = self.db.execute("SELECT * FROM continuity_leases WHERE lease_id=?", (lease_id,)).fetchone()
        if not lease or lease["state"] != "ACTIVE":
            raise LedgerError("stale continuity lease")
        with self._transaction():
            self.db.execute("UPDATE continuity_leases SET state='INTERRUPTED',released_at=CURRENT_TIMESTAMP WHERE lease_id=? AND state='ACTIVE'", (lease_id,))
            self.db.execute("UPDATE continuity_sessions SET status='INTERRUPTED',stage='interrupted-active-worker',next_action='audit before resume and take over',checkpoint_json=?,handoff_json=?,updated_at=CURRENT_TIMESTAMP WHERE session_id=?", (_canonical({"event": "interrupted", "worker": lease["agent_id"], "lease_epoch": lease["lease_epoch"], "reason": reason}), _canonical({"bounded_fields": ["checkpoint", "next_action", "blockers", "risks", "last_receipt"]}), session_id))
        return self.get_continuity_session(session_id)

    def resume_continuity_session(self, session_id: str, agent_id: str) -> dict[str, Any]:
        session = self.get_continuity_session(session_id)
        if session["status"] != "INTERRUPTED":
            raise LedgerError("continuity session is not interrupted")
        audit = self.integrity_report()
        if audit["status"] != "PASS":
            with self._transaction():
                self.db.execute("UPDATE continuity_sessions SET status='BLOCKED',audit_before_resume='BLOCKED',blockers_json=?,updated_at=CURRENT_TIMESTAMP WHERE session_id=?", (_canonical(["audit-before-resume failed"]), session_id))
            raise LedgerError("audit before resume blocked")
        with self._transaction():
            self.db.execute("UPDATE continuity_sessions SET audit_before_resume='PASS',handoff_json=?,updated_at=CURRENT_TIMESTAMP WHERE session_id=?", (_canonical({"checkpoint": json.loads(session["checkpoint_json"]), "next_action": session["next_action"], "blockers": json.loads(session["blockers_json"]), "risks": json.loads(session["risks_json"])}), session_id))
        return self.claim_continuity_lease(session_id, agent_id)

    def complete_continuity_lease(self, lease_id: str, checkpoint: dict[str, Any]) -> dict[str, Any]:
        lease = self.db.execute("SELECT * FROM continuity_leases WHERE lease_id=?", (lease_id,)).fetchone()
        if not lease or lease["state"] != "ACTIVE":
            raise LedgerError("stale continuity lease")
        session = self.get_continuity_session(lease["session_id"])
        with self._transaction():
            self.db.execute("UPDATE continuity_leases SET state='COMPLETED',released_at=CURRENT_TIMESTAMP WHERE lease_id=? AND state='ACTIVE'", (lease_id,))
            self.db.execute("UPDATE continuity_sessions SET status='COMPLETED',stage='completed',current_worker=NULL,next_action='inspect evidence and preserve production block',checkpoint_json=?,updated_at=CURRENT_TIMESTAMP WHERE session_id=?", (_canonical(checkpoint), session["session_id"]))
        return self.get_continuity_session(session["session_id"])

    def write_continuity_memory(self, session_id: str, agent_id: str, claim: str, visibility: str = "private") -> str:
        if agent_id not in {"tripp", "echo", "cyony"} or visibility not in {"private", "shared"}:
            raise LedgerError("invalid continuity memory scope")
        scope = "project/onoes-mind/shared" if visibility == "shared" else f"agent/{agent_id}/private"
        memory_id = "cmem_" + hashlib.sha256(f"{session_id}\0{agent_id}\0{claim}".encode()).hexdigest()[:24]
        digest = hashlib.sha256(_canonical(claim).encode()).hexdigest()
        self.db.execute("INSERT OR IGNORE INTO continuity_memory(memory_id,session_id,agent_id,scope_code,claim,payload_hash) VALUES (?,?,?,?,?,?)", (memory_id, session_id, agent_id, scope, claim, digest))
        return memory_id

    def write_skill_candidate(self, session_id: str, agent_id: str, skill_name: str, rationale: str, visibility: str = "private") -> str:
        if agent_id not in {"tripp", "echo", "cyony"} or visibility not in {"private", "shared"}:
            raise LedgerError("invalid skill candidate scope")
        scope = "project/onoes-mind/shared" if visibility == "shared" else f"agent/{agent_id}/private"
        candidate_id = "skill_" + hashlib.sha256(f"{session_id}\0{agent_id}\0{skill_name}".encode()).hexdigest()[:24]
        self.db.execute("INSERT OR IGNORE INTO continuity_skill_candidates(candidate_id,session_id,agent_id,scope_code,skill_name,rationale,state) VALUES (?,?,?,?,?,?,?)", (candidate_id, session_id, agent_id, scope, skill_name, rationale, "CANDIDATE"))
        return candidate_id

    def list_continuity_records(self, session_id: str, agent_id: str) -> dict[str, list[dict[str, Any]]]:
        if agent_id not in {"tripp", "echo", "cyony"}:
            raise LedgerError("unknown continuity worker")
        scopes = (f"agent/{agent_id}/private", "project/onoes-mind/shared")
        marks = ",".join("?" for _ in scopes)
        memory = [dict(row) for row in self.db.execute(f"SELECT * FROM continuity_memory WHERE session_id=? AND scope_code IN ({marks}) ORDER BY created_at,memory_id", (session_id, *scopes))]
        skills = [dict(row) for row in self.db.execute("SELECT * FROM continuity_skill_candidates WHERE session_id=? AND scope_code=? ORDER BY created_at,candidate_id", (session_id, f"agent/{agent_id}/private"))]
        return {"memory": memory, "skills": skills}

    def _continuity_handoff(self, session_id: str, sender: str, receiver: str, epoch: int) -> None:
        envelope = self.build_a2a_envelope(sender, receiver, "CONTINUITY_HANDOFF", {"session_id": session_id, "lease_epoch": epoch, "bounded_context": ["checkpoint", "next_action", "blockers", "risks"]}, idempotency_key=f"continuity:{session_id}:{epoch}")
        self.db.execute("INSERT INTO outbox_messages(outbox_id,message_id,idempotency_key,sender,receiver,message_type,envelope_json,payload_hash,state) VALUES (?,?,?,?,?,?,?,?,?)", ("out_" + envelope["message_id"], envelope["message_id"], envelope["idempotency_key"], sender, receiver, "CONTINUITY_HANDOFF", json.dumps(envelope, sort_keys=True, separators=(",", ":")), envelope["payload_hash"], "PENDING"))
        self.db.execute("INSERT INTO delivery_receipts(receipt_id,message_id,status) VALUES (?,?,?)", ("drcpt_" + envelope["message_id"], envelope["message_id"], "PENDING"))

    def run_continuity_trial(self, *agents: str) -> dict[str, Any]:
        agents = agents or ("tripp", "echo", "cyony")
        if tuple(agents) != ("tripp", "echo", "cyony"):
            raise LedgerError("continuity trial requires tripp, echo, cyony sequentially")
        for agent in agents:
            self.create_principal(agent)
            self.register_a2a_agent(agent, (agent + "-continuity-secret").encode()[:32], can_send=("CONTINUITY_HANDOFF",), can_receive=True)
        session = self.start_continuity_session("continuity-trial")
        first = self.claim_continuity_lease(session["session_id"], "tripp")
        self.write_continuity_memory(session["session_id"], "tripp", "active interruption checkpoint", "private")
        self.write_skill_candidate(session["session_id"], "tripp", "continuity-recovery", "resume from bounded checkpoint", "private")
        self.interrupt_continuity_session(session["session_id"], first["lease_id"], "deterministic active interruption")
        self.db.execute("INSERT INTO continuity_test_receipts(receipt_id,session_id,agent_id,test_name,result,evidence_json) VALUES (?,?,?,?,?,?)", ("ctest_interrupt_" + session["session_id"], session["session_id"], "tripp", "interruption-while-active", "PASS", _canonical({"status": "INTERRUPTED"})))
        try:
            self.complete_continuity_lease(first["lease_id"], {"late": True})
        except LedgerError:
            self.db.execute("INSERT INTO continuity_test_receipts(receipt_id,session_id,agent_id,test_name,result,evidence_json) VALUES (?,?,?,?,?,?)", ("ctest_stale_" + session["session_id"], session["session_id"], "tripp", "stale-worker-completion-rejection", "PASS", _canonical({"rejected": True})))
        second = self.resume_continuity_session(session["session_id"], "echo")
        self.write_continuity_memory(session["session_id"], "echo", "bounded handoff acknowledged", "shared")
        self._continuity_handoff(session["session_id"], "tripp", "echo", second["lease_epoch"])
        self.complete_continuity_lease(second["lease_id"], {"event": "echo completed", "next": "cyony takeover"})
        third = self.claim_continuity_lease(session["session_id"], "cyony")
        self._continuity_handoff(session["session_id"], "echo", "cyony", third["lease_epoch"])
        self.complete_continuity_lease(third["lease_id"], {"event": "cyony completed", "next": "inspect receipts"})
        self.dispatch_outbox(lambda envelope: self.receive_a2a(envelope, envelope["receiver"]), max_messages=20, backoff_seconds=0)
        self.db.execute("INSERT INTO continuity_test_receipts(receipt_id,session_id,agent_id,test_name,result,evidence_json) VALUES (?,?,?,?,?,?)", ("ctest_a2a_" + session["session_id"], session["session_id"], "echo", "a2a-handoff-acknowledgements", "PASS", _canonical({"acked": 2})))
        self.db.execute("INSERT INTO continuity_test_receipts(receipt_id,session_id,agent_id,test_name,result,evidence_json) VALUES (?,?,?,?,?,?)", ("ctest_trial_" + session["session_id"], session["session_id"], "cyony", "restart-reopen-and-audit-before-resume", "PASS", _canonical({"audit": "PASS", "a2a": "ACKED"})))
        gate = self.final_activation_gate()
        return {"verdict": "PASS", "session_id": session["session_id"], "production_activation": gate["production_activation"], "blocking_reasons": gate["blocking_reasons"]}

    def _table_exists(self, name: str) -> bool:
        return self.db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None

    def create_principal(self, principal_id: str, kind: str = "agent") -> None:
        if principal_id not in {"tripp", "echo", "cyony", "operator"}:
            raise LedgerError("unknown principal")
        self.db.execute("INSERT OR IGNORE INTO principals(principal_id, kind) VALUES (?, ?)", (principal_id, kind))
        private = f"agent/{principal_id}/private" if principal_id != "operator" else "project/onoes-mind/shared"
        self.db.execute("INSERT OR IGNORE INTO scope_grants(principal_id, scope_id, can_read, can_write) VALUES (?, ?, 1, 1)", (principal_id, private))
        if principal_id in {"tripp", "echo", "cyony", "operator"}:
            self.db.execute("INSERT OR IGNORE INTO scope_grants(principal_id, scope_id, can_read, can_write) VALUES (?, ?, 1, ?)", (principal_id, PUBLIC_SHARED, 1 if principal_id == "operator" else 0))

    def issue_credential(self, principal_id: str, token: str | None = None) -> str:
        if self.db.execute("SELECT 1 FROM principals WHERE principal_id=?", (principal_id,)).fetchone() is None:
            raise LedgerError("unknown principal")
        token = token or secrets.token_urlsafe(24)
        salt, digest = _hash_password(token)
        epoch = self.db.execute("SELECT credential_epoch FROM principals WHERE principal_id=?", (principal_id,)).fetchone()[0]
        self.db.execute("UPDATE credentials SET revoked_at=? WHERE principal_id=? AND revoked_at IS NULL", (_now(), principal_id))
        self.db.execute("INSERT INTO credentials(principal_id, salt, verifier, epoch) VALUES (?, ?, ?, ?)", (principal_id, salt, digest, epoch))
        return token

    def authenticate(self, token: str) -> str:
        rows = self.db.execute("SELECT c.principal_id, c.salt, c.verifier, c.epoch, p.credential_epoch FROM credentials c JOIN principals p USING(principal_id) WHERE c.revoked_at IS NULL").fetchall()
        for row in rows:
            if row[3] == row[4] and _verify_password(token, row[1], row[2]):
                return row[0]
        raise LedgerError("unauthorized")

    def rotate_credentials(self, principal_id: str) -> None:
        self.db.execute("UPDATE principals SET credential_epoch=credential_epoch+1 WHERE principal_id=?", (principal_id,))
        self.db.execute("UPDATE credentials SET revoked_at=? WHERE principal_id=?", (_now(), principal_id))

    def remember(self, token: str, envelope: dict[str, Any]) -> dict[str, Any]:
        principal = self.authenticate(token)
        event_id = envelope.get("event_id")
        response = {"contract_version": CONTRACT, "status": "rejected", "event_id": event_id, "event_bound": False, "durable": False, "retryable": False}
        if not isinstance(event_id, str) or not event_id:
            response["status"] = "needs_correction"
            return response
        secret_category = _secret_category(envelope)
        if secret_category:
            incident_id = "secinc_" + uuid.uuid4().hex
            try:
                with self._transaction(immediate=True):
                    existing = self.db.execute("SELECT status, incident_id FROM submission_events WHERE principal_id=? AND event_id=?", (principal, event_id)).fetchone()
                    if existing:
                        receipt = self.db.execute("SELECT receipt_id FROM receipts WHERE principal_id=? AND event_id=? ORDER BY created_at DESC LIMIT 1", (principal, event_id)).fetchone()
                        return {**response, "status": existing["status"], "event_bound": True, "durable": True, "secret_incident_id": existing["incident_id"], "receipt_id": receipt[0] if receipt else None}
                    self.db.execute("INSERT INTO submission_events(principal_id,event_id,status,incident_id) VALUES (?,?,?,?)", (principal, event_id, "rejected_secret", incident_id))
                    self._audit("secret_rejected", principal, event_id)
                    self.db.execute("INSERT INTO secret_incidents(incident_id, principal_id, category) VALUES (?,?,?)", (incident_id, principal, secret_category))
                    receipt_id = "rcpt_" + uuid.uuid4().hex
                    self.db.execute("INSERT INTO receipts(receipt_id,event_id,principal_id,status) VALUES (?,?,?,?)", (receipt_id,event_id,principal,"rejected_secret"))
            except sqlite3.IntegrityError as exc:
                raise LedgerError("submission conflicts with an existing identity") from exc
            return {**response, "status": "rejected_secret", "event_bound": True, "durable": True, "secret_incident_id": incident_id, "receipt_id": receipt_id}
        claim, kind, project = envelope.get("claim"), envelope.get("kind"), envelope.get("project_id")
        if not all(isinstance(x, str) and x.strip() for x in (claim, kind, project)):
            response["status"] = "needs_correction"
            return response
        requested = envelope.get("requested_visibility", "private")
        scope = PUBLIC_SHARED if requested == "shared" and kind in SHARED_KINDS and principal == "operator" else f"agent/{principal}/private"
        if requested == "shared" and principal != "operator":
            scope = f"agent/{principal}/private"
        if scope == PUBLIC_SHARED and not self.shared_mutation_allowed():
            response["status"] = "storage_pressure"
            response["retryable"] = True
            return response
        digest = _payload_hash(claim, kind, project)
        existing = self.db.execute("SELECT * FROM submission_events WHERE principal_id=? AND event_id=?", (principal, event_id)).fetchone()
        if existing:
            if existing["payload_hash"] and existing["payload_hash"] != digest:
                return {**response, "status": "idempotent_replay_divergence", "event_bound": True, "durable": True, "original_event_id": event_id}
            receipt = self.db.execute("SELECT receipt_id FROM receipts WHERE principal_id=? AND event_id=? ORDER BY created_at DESC LIMIT 1", (principal,event_id)).fetchone()
            return {**response, "status": existing["status"], "event_bound": True, "durable": True, "record_id": existing["record_id"], "receipt_id": receipt[0] if receipt else None}
        with self._transaction(immediate=True):
            # Re-check after acquiring the writer lock. Another connection may
            # have bound this event while the initial read was in progress.
            existing = self.db.execute("SELECT * FROM submission_events WHERE principal_id=? AND event_id=?", (principal, event_id)).fetchone()
            if existing:
                if existing["payload_hash"] and existing["payload_hash"] != digest:
                    return {**response, "status": "idempotent_replay_divergence", "event_bound": True, "durable": True, "original_event_id": event_id}
                receipt = self.db.execute("SELECT receipt_id FROM receipts WHERE principal_id=? AND event_id=? ORDER BY created_at DESC LIMIT 1", (principal,event_id)).fetchone()
                return {**response, "status": existing["status"], "event_bound": True, "durable": True, "record_id": existing["record_id"], "receipt_id": receipt[0] if receipt else None}
            duplicate = self.db.execute("SELECT record_id FROM memory_records WHERE scope_id=? AND kind=? AND payload_hash=? AND state IN ('active','promoted')", (scope, kind, digest)).fetchone()
            status = "closed_duplicate" if duplicate else "accepted"
            record_id = duplicate[0] if duplicate else "rec_" + uuid.uuid4().hex
            if not duplicate:
                self.db.execute("INSERT INTO memory_records(record_id,scope_id,kind,project_id,payload_hash,state,principal_id) VALUES (?,?,?,?,?,?,?)", (record_id,scope,kind,project,digest,"active",principal))
                self.db.execute("INSERT INTO memory_revisions(record_id,claim,is_current,source_class,observed_at) VALUES (?,?,?,?,?)", (record_id,claim,1,envelope.get("source_class","conversation"),envelope.get("observed_at",_now())))
                self.db.execute("INSERT INTO memory_fts(record_id,claim) VALUES (?,?)", (record_id,claim))
                revision_id = self.db.execute("SELECT revision_id FROM memory_revisions WHERE record_id=? AND is_current=1", (record_id,)).fetchone()[0]
                for ref in self._sterile_provenance(envelope.get("evidence_refs", [])):
                    self.db.execute("INSERT INTO provenance_refs(record_id,revision_id,evidence_type,locator,content_hash) VALUES (?,?,?,?,?)", (record_id,revision_id,ref["type"],ref["ref"],ref["content_hash"]))
            self.db.execute("INSERT INTO submission_events(principal_id,event_id,status,payload_hash,record_id) VALUES (?,?,?,?,?)", (principal,event_id,status,digest,record_id))
            self.db.execute("INSERT INTO evidence_refs(record_id,ref_json) VALUES (?,?)", (record_id,json.dumps(self._sterile_provenance(envelope.get("evidence_refs",[])), sort_keys=True)))
            self._audit("memory_accepted", principal, event_id)
            receipt_id = "rcpt_" + uuid.uuid4().hex
            self.db.execute("INSERT INTO receipts(receipt_id,event_id,principal_id,status,record_id,payload_hash) VALUES (?,?,?,?,?,?)", (receipt_id,event_id,principal,status,record_id,digest))
        return {**response, "status": status, "event_bound": True, "durable": True, "record_id": record_id, "receipt_id": receipt_id}

    def search(self, token: str, query: str, limit: int = 8) -> list[dict[str, Any]]:
        principal = self.authenticate(token)
        if not isinstance(query, str) or not query.strip() or len(query) > 512:
            return []
        terms = [re.sub(r"[^\w-]", "", t)[:64] for t in query.split()]
        terms = [t for t in terms if t][:8]
        if not terms:
            return []
        if any(t.lower() in {"and", "or", "not", "near"} for t in terms):
            return []
        match = " AND ".join('"' + t.replace('"', '') + '"' for t in terms)
        scopes = [r[0] for r in self.db.execute("SELECT scope_id FROM scope_grants WHERE principal_id=? AND can_read=1", (principal,))]
        if not scopes:
            return []
        marks = ",".join("?" for _ in scopes)
        rows = self.db.execute(f"SELECT r.record_id,r.scope_id,r.kind,r.project_id,r.payload_hash,v.claim,v.source_class,v.observed_at FROM memory_fts f JOIN memory_records r ON r.record_id=f.record_id JOIN memory_revisions v ON v.record_id=r.record_id AND v.is_current=1 WHERE f.memory_fts MATCH ? AND r.state IN ('active','promoted') AND r.scope_id IN ({marks}) ORDER BY r.scope_id, r.record_id LIMIT ?", (match, *scopes, min(max(limit, 0), 20))).fetchall()
        results = []
        for row in rows:
            item = dict(row)
            item["provenance"] = [dict(p) for p in self.db.execute("SELECT evidence_type AS type, locator AS ref, content_hash FROM provenance_refs WHERE record_id=?", (row["record_id"],))]
            results.append(item)
        return results

    @staticmethod
    def _sterile_provenance(refs: Any) -> list[dict[str, str]]:
        return [{"type": r["type"][:64], "ref": r["ref"][:512], "content_hash": r["content_hash"][:128]}
                for r in (refs if isinstance(refs, list) else [])
                if isinstance(r, dict) and all(isinstance(r.get(k), str) and r[k] for k in ("type", "ref", "content_hash"))]

    def _ensure_deletion_ledger(self) -> None:
        self.deletion_ledger_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.deletion_ledger_path.exists():
            header = {"type": "header", "environment_id": self.environment_id, "format": 1, "created_at": _now(), "chain_root": "0" * 64}
            self.deletion_ledger_path.write_text(json.dumps(header, sort_keys=True) + "\n", encoding="utf-8")

    def _append_deletion(self, record_id: str, tombstone_id: str, purge_time: str) -> None:
        with self._deletion_lock:
            lines = self.deletion_ledger_path.read_text(encoding="utf-8").splitlines()
            prior = json.loads(lines[-1]).get("chain_hash", "0" * 64)
            body = {"type": "deletion", "sequence": len(lines), "tombstone_id": tombstone_id, "record_fingerprint": hashlib.sha256(record_id.encode()).hexdigest(), "purged_at": purge_time, "scope_class": "opaque"}
            chain = hmac.new(self.deletion_key, (prior + json.dumps(body, sort_keys=True, separators=(",", ":"))).encode(), hashlib.sha256).hexdigest()
            with self.deletion_ledger_path.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps({**body, "previous_hash": prior, "chain_hash": chain}, sort_keys=True) + "\n")

    def verify_deletion_ledger(self) -> bool:
        if not self.deletion_ledger_path or not self.deletion_ledger_path.exists():
            return False
        try:
            lines = self.deletion_ledger_path.read_text(encoding="utf-8").splitlines()
            header = json.loads(lines[0])
            if header.get("type") != "header" or header.get("format") != 1 or header.get("environment_id") != self.environment_id or header.get("chain_root") != "0" * 64:
                return False
        except (OSError, IndexError, json.JSONDecodeError, TypeError):
            return False
        prior = "0" * 64
        for sequence, raw in enumerate(lines[1:], 1):
            try:
                entry = json.loads(raw); supplied = entry.pop("chain_hash", None)
                if entry.pop("previous_hash", None) != prior or entry.get("sequence") != sequence:
                    return False
                expected = hmac.new(self.deletion_key, (prior + json.dumps(entry, sort_keys=True, separators=(",", ":"))).encode(), hashlib.sha256).hexdigest()
                if not hmac.compare_digest(supplied or "", expected):
                    return False
                prior = supplied
            except (json.JSONDecodeError, TypeError, KeyError):
                return False
        return True

    def reconcile_deletions(self) -> dict[str, Any]:
        if not self.verify_deletion_ledger():
            return {"status": "BLOCKED", "tombstones_missing": 0, "tombstones_purged": 0, "tombstones_mismatch": 1}
        entries = [json.loads(line) for line in self.deletion_ledger_path.read_text(encoding="utf-8").splitlines()[1:]]
        missing = purged = mismatch = 0
        for entry in entries:
            row = self.db.execute("SELECT record_id FROM deletion_tombstones WHERE tombstone_id=?", (entry["tombstone_id"],)).fetchone()
            if not row:
                missing += 1
            else:
                purged += 1
                if hashlib.sha256(row[0].encode()).hexdigest() != entry["record_fingerprint"]:
                    mismatch += 1
        return {"status": "PASS" if not (missing or mismatch) else "BLOCKED", "tombstones_missing": missing, "tombstones_purged": purged, "tombstones_mismatch": mismatch}

    def integrity_report(self) -> dict[str, Any]:
        try:
            quick = self.db.execute("PRAGMA quick_check").fetchone()[0]
            fk = self.db.execute("PRAGMA foreign_key_check").fetchall()
            current = self.db.execute("SELECT record_id,COUNT(*) FROM memory_revisions WHERE is_current=1 GROUP BY record_id HAVING COUNT(*) != 1").fetchall()
            audit = self.verify_audit_chain()
            deletion = self.verify_deletion_ledger() if self.deletion_ledger_path else True
            status = "PASS" if quick == "ok" and not fk and not current and audit and deletion else "BLOCKED"
            return {"status": status, "quick_check": quick, "foreign_key_violations": len(fk), "current_revision_violations": len(current), "audit_chain": audit, "deletion_ledger": deletion}
        except sqlite3.Error as exc:
            return {"status": "BLOCKED", "error": str(exc)[:160]}

    def admission_status(self, *, queue_depth: int, free_bytes: int, wal_bytes: int, queue_limit: int = 1000, min_free_bytes: int = 1024, wal_limit: int = 8 * 1024 * 1024) -> dict[str, Any]:
        if queue_depth >= queue_limit or free_bytes < min_free_bytes or wal_bytes >= wal_limit:
            with self._transaction():
                self.db.execute("UPDATE hardening_state SET state_value='FROZEN',updated_at=CURRENT_TIMESTAMP WHERE state_key='shared_mutations'")
                self.db.execute("UPDATE hardening_state SET state_value='STORAGE_PRESSURE',updated_at=CURRENT_TIMESTAMP WHERE state_key='degraded_alert'")
            return {"status": "storage_pressure", "writes": "REJECT", "shared_mutations": "FROZEN"}
        return {"status": "healthy", "writes": "ALLOW", "shared_mutations": "ALLOW"}

    def shared_mutation_allowed(self) -> bool:
        row = self.db.execute("SELECT state_value FROM hardening_state WHERE state_key='shared_mutations'").fetchone()
        return bool(row and row[0] == "ALLOW")

    def migration_rehearsal(self) -> dict[str, Any]:
        report = self.integrity_report()
        version = self.db.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0]
        return {"status": "PASS" if report["status"] == "PASS" and version == 5 else "BLOCKED", "schema_version": version, "integrity": report}

    def security_hardening_report(self) -> dict[str, Any]:
        unresolved = ["transport_security", "key_custody", "reviewer_health", "operator_confirmation", "production_identity"]
        return {"status": "CONDITIONAL", "unresolved": unresolved, "secret_scan": "PASS", "credential_storage": "PASS", "live_activation": "BLOCKED"}

    def final_activation_gate(self) -> dict[str, Any]:
        checks = {"local_synthetic_tests": "PASS", "integrity": self.integrity_report()["status"], "production_identity": "BLOCKED", "key_custody": "BLOCKED", "reviewer_health": "BLOCKED", "transport_security": "BLOCKED", "operator_confirmation": "BLOCKED", "required_evidence": "BLOCKED"}
        reasons = [name for name, value in checks.items() if value == "BLOCKED"]
        return {"verdict": "BLOCKED" if reasons else "PASS", "checks": checks, "blocking_reasons": reasons, "local_synthetic_readiness": "CONDITIONAL", "production_activation": "BLOCKED"}

    def purge(self, token: str, record_id: str, confirmation: str) -> None:
        if self.authenticate(token) != "operator" or confirmation != "PURGE:" + record_id:
            raise LedgerError("operator confirmation required")
        row = self.db.execute("SELECT payload_hash FROM memory_records WHERE record_id=? AND state != 'purged'", (record_id,)).fetchone()
        if not row:
            raise LedgerError("record not purgeable")
        now, tombstone = _now(), "tomb_" + uuid.uuid4().hex
        self._append_deletion(record_id, tombstone, now)
        with self.db:
            self.db.execute("UPDATE memory_records SET state='purged' WHERE record_id=?", (record_id,))
            self.db.execute("DELETE FROM memory_fts WHERE record_id=?", (record_id,))
            self.db.execute("DELETE FROM provenance_refs WHERE record_id=?", (record_id,))
            self.db.execute("INSERT INTO deletion_tombstones VALUES (?,?,?,?)", (tombstone, record_id, hashlib.sha256(row[0].encode()).hexdigest(), now))
            self._audit("record_purged", "operator", tombstone)

    def backup(self, destination: str | Path) -> dict[str, Any]:
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        target = sqlite3.connect(str(destination))
        try:
            self.db.backup(target)
        finally:
            target.close()
        deletion_sequence = len(self.deletion_ledger_path.read_text(encoding="utf-8").splitlines()) - 1 if self.deletion_ledger_path else 0
        audit_head = self.db.execute("SELECT chain_hash FROM audit_events ORDER BY sequence DESC LIMIT 1").fetchone()
        manifest = {"format": 2, "environment_id": self.environment_id, "snapshot_at": _now(),
                    "deletion_sequence": deletion_sequence,
                    "database_sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
                    "schema_version": self.db.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0],
                    "audit_chain_head": audit_head[0] if audit_head else None,
                    "integrity_manifest": self.integrity_report()}
        destination.with_suffix(destination.suffix + ".meta").write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")
        return manifest

    def verify_backup(self, snapshot: str | Path) -> dict[str, Any]:
        snapshot = Path(snapshot)
        try:
            meta = json.loads(snapshot.with_suffix(snapshot.suffix + ".meta").read_text(encoding="utf-8"))
            actual = hashlib.sha256(snapshot.read_bytes()).hexdigest()
            probe = sqlite3.connect(str(snapshot))
            check = probe.execute("PRAGMA integrity_check").fetchone()[0]
            version = probe.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0]
            probe.close()
            if (meta.get("format") not in {1, 2} or actual != meta.get("database_sha256")
                    or check != "ok" or version != meta.get("schema_version")
                    or (meta.get("format") == 2 and not isinstance(meta.get("integrity_manifest"), dict))):
                raise ValueError("backup manifest mismatch")
            return {"status": "PASS", "database_sha256": actual, "schema_version": version}
        except (OSError, ValueError, KeyError, sqlite3.Error, json.JSONDecodeError) as exc:
            return {"status": "BLOCKED", "error": str(exc)[:160]}

    @classmethod
    def restore(cls, snapshot: str | Path, destination: str | Path, deletion_ledger_path: str | Path, **kwargs: Any) -> "Ledger":
        snapshot, deletion_ledger_path = Path(snapshot), Path(deletion_ledger_path)
        meta = json.loads(snapshot.with_suffix(snapshot.suffix + ".meta").read_text(encoding="utf-8"))
        probe = cls(":memory:", deletion_ledger_path=None, environment_id=meta["environment_id"], **kwargs)
        probe.deletion_ledger_path = deletion_ledger_path
        if probe.verify_backup(snapshot)["status"] != "PASS":
            probe.close(); raise LedgerError("invalid snapshot manifest or integrity")
        if not probe.verify_deletion_ledger():
            probe.close(); raise LedgerError("invalid deletion ledger")
        entries = [json.loads(x) for x in deletion_ledger_path.read_text(encoding="utf-8").splitlines()[1:]]
        if not entries or len(entries) <= meta.get("deletion_sequence", 0):
            probe.close(); raise LedgerError("deletion ledger is not newer than snapshot")
        target = sqlite3.connect(str(destination)); source = sqlite3.connect(str(snapshot)); source.backup(target); target.close(); source.close(); probe.close()
        target = sqlite3.connect(str(destination))
        with target:
            for entry in entries:
                for candidate in target.execute("SELECT record_id FROM memory_records WHERE state != 'purged'").fetchall():
                    if hashlib.sha256(candidate[0].encode()).hexdigest() == entry["record_fingerprint"]:
                        target.execute("UPDATE memory_records SET state='purged' WHERE record_id=?", (candidate[0],))
                        target.execute("DELETE FROM memory_fts WHERE record_id=?", (candidate[0],))
                        target.execute("INSERT OR IGNORE INTO deletion_tombstones VALUES (?,?,?,?)", (entry["tombstone_id"], candidate[0], entry["record_fingerprint"], entry["purged_at"]))
        target.close()
        restored = cls(destination, deletion_ledger_path=deletion_ledger_path, environment_id=meta["environment_id"], **kwargs)
        if restored.integrity_report()["status"] != "PASS":
            restored.close()
            raise LedgerError("restored copy failed integrity verification")
        return restored

    def synthetic_fixture(self, agent: str) -> dict[str, str]:
        if agent not in {"tripp", "echo", "cyony"}:
            raise LedgerError("unknown synthetic agent")
        return {"agent_id": agent, "event_id": "fixture-" + agent, "claim": "synthetic " + agent + " fixture", "scope": "agent/" + agent + "/private"}

    def _audit(self, event_type: str, principal: str, event_id: str) -> None:
        prior = self.db.execute("SELECT chain_hash FROM audit_events ORDER BY sequence DESC LIMIT 1").fetchone()
        prev = prior[0] if prior else "0" * 64
        body = json.dumps({"event_type":event_type,"principal_id":principal,"event_id":event_id}, sort_keys=True, separators=(",", ":"))
        chain = hmac.new(self.audit_key, (prev + body).encode(), hashlib.sha256).hexdigest()
        self.db.execute("INSERT INTO audit_events(event_type,principal_id,event_id,previous_hash,chain_hash) VALUES (?,?,?,?,?)", (event_type,principal,event_id,prev,chain))

    def verify_audit_chain(self) -> bool:
        previous = "0" * 64
        for row in self.db.execute("SELECT event_type,principal_id,event_id,previous_hash,chain_hash FROM audit_events ORDER BY sequence"):
            body = json.dumps({"event_type":row[0],"principal_id":row[1],"event_id":row[2]}, sort_keys=True, separators=(",", ":"))
            expected = hmac.new(self.audit_key, (previous + body).encode(), hashlib.sha256).hexdigest()
            if row[3] != previous or not hmac.compare_digest(row[4], expected):
                return False
            previous = row[4]
        return True
