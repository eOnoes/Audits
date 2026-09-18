"""Local-only Phase 10 hardening primitives.

These mechanisms are deterministic test doubles.  They never open a socket,
resolve a runtime, read credentials, or write a native store.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable


class InjectedFailure(RuntimeError):
    """A deterministic interruption at a named durability boundary."""


def digest(value: Any) -> str:
    data = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return "sha256:" + hashlib.sha256(data).hexdigest()


class FailurePlan:
    def __init__(self, points: Iterable[str] = ()) -> None:
        self.points = set(points)
        self.hit: list[str] = []

    def checkpoint(self, name: str) -> None:
        if name in self.points:
            self.hit.append(name)
            raise InjectedFailure(name)


class LocalWAL:
    """Checksummed append/replay journal with torn-tail recovery."""

    def __init__(self, failures: FailurePlan | None = None) -> None:
        self._lines: list[str] = []
        self._durable_lines: list[str] = []
        self.failures = failures or FailurePlan()

    def append(self, event_id: str, payload: dict[str, Any]) -> None:
        record = {"event_id": event_id, "payload": payload}
        line = json.dumps({**record, "record_hash": digest(record)}, sort_keys=True)
        self.failures.checkpoint("wal.before_append")
        self._lines.append(line)
        self.failures.checkpoint("wal.after_append_before_fsync")
        self._durable_lines.append(line)

    def tear_tail(self) -> None:
        if self._lines:
            self._lines[-1] = self._lines[-1][:-1]
        if self._durable_lines:
            self._durable_lines[-1] = self._durable_lines[-1][:-1]

    def replay(self) -> list[dict[str, Any]]:
        result = []
        for line in self._durable_lines:
            try:
                record = json.loads(line)
                expected = {"event_id": record["event_id"], "payload": record["payload"]}
                if record.get("record_hash") != digest(expected):
                    break
            except (ValueError, KeyError, TypeError):
                break
            result.append(record)
        return result


class ReceiptLedger:
    """First-write-wins event binding with atomic receipt publication."""

    def __init__(self, failures: FailurePlan | None = None) -> None:
        self.wal = LocalWAL(failures)
        self.events: dict[str, dict[str, Any]] = {}
        self.receipts: list[dict[str, Any]] = []
        self.failures = failures or FailurePlan()
        self._lock = threading.RLock()

    def submit(self, event_id: str, payload: dict[str, Any], *, now: int) -> dict[str, Any]:
        with self._lock:
            return self._submit(event_id, payload, now=now)

    def _submit(self, event_id: str, payload: dict[str, Any], *, now: int) -> dict[str, Any]:
        payload_hash = digest(payload)
        prior = self.events.get(event_id)
        if prior:
            if prior["payload_hash"] == payload_hash:
                return {"status": "IDEMPOTENT_REPLAY", "receipt": prior["receipt"]}
            return {"status": "IDEMPOTENT_REPLAY_DIVERGENCE", "receipt": prior["receipt"]}
        if self.receipts and now < self.receipts[-1]["observed_at"]:
            return {"status": "REJECTED_TIMESTAMP_ORDER", "receipt": None}
        self.wal.append(event_id, {"payload_hash": payload_hash, "observed_at": now})
        self.failures.checkpoint("ledger.before_receipt")
        receipt = {"receipt_id": f"receipt-{len(self.receipts) + 1}", "event_id": event_id,
                   "payload_hash": payload_hash, "observed_at": now,
                   "previous_receipt_hash": self.receipts[-1]["receipt_hash"] if self.receipts else None}
        receipt["receipt_hash"] = digest(receipt)
        self.failures.checkpoint("ledger.after_receipt_before_commit")
        self.receipts.append(receipt)
        self.events[event_id] = {"payload_hash": payload_hash, "receipt": receipt}
        return {"status": "ACCEPTED_DURABLE", "receipt": receipt}

    def verify(self) -> bool:
        prior = None
        seen_events: set[str] = set()
        for receipt in self.receipts:
            if not isinstance(receipt, dict) or receipt.get("event_id") in seen_events:
                return False
            seen_events.add(receipt.get("event_id"))
            body = {k: v for k, v in receipt.items() if k != "receipt_hash"}
            if receipt["receipt_hash"] != digest(body) or receipt["previous_receipt_hash"] != prior:
                return False
            prior = receipt["receipt_hash"]
        return True


@dataclass(frozen=True)
class Lease:
    epoch: int
    version: int


class FencedLease:
    def __init__(self) -> None:
        self.current = Lease(1, 1)

    def take_over(self) -> Lease:
        self.current = Lease(self.current.epoch + 1, self.current.version + 1)
        return self.current

    def permits(self, lease: Lease) -> bool:
        return lease == self.current


def backup_bundle(ledger: ReceiptLedger) -> dict[str, Any]:
    if not ledger.verify():
        raise ValueError("cannot back up an invalid receipt chain")
    body = {"format": "phase10-local-backup-v1", "schema_version": 1,
            "receipts": ledger.receipts, "events": ledger.events, "wal": ledger.wal.replay()}
    return {**body, "manifest_hash": digest(body)}


def restore_bundle(bundle: dict[str, Any], *, clean_workspace: bool = True) -> ReceiptLedger:
    if not isinstance(bundle, dict):
        raise ValueError("backup bundle must be an object")
    body = {k: v for k, v in bundle.items() if k != "manifest_hash"}
    if (not clean_workspace or body.get("format") != "phase10-local-backup-v1"
            or body.get("schema_version") != 1
            or not isinstance(body.get("receipts"), list)
            or not isinstance(body.get("events"), dict)
            or not isinstance(body.get("wal"), list)
            or bundle.get("manifest_hash") != digest(body)):
        raise ValueError("backup manifest validation failed")
    ledger = ReceiptLedger()
    ledger.receipts = body["receipts"]
    ledger.events = body["events"]
    receipt_by_event = {receipt.get("event_id"): receipt for receipt in ledger.receipts}
    if set(receipt_by_event) != set(ledger.events) or any(
        event.get("payload_hash") != receipt_by_event[event_id].get("payload_hash")
        or event.get("receipt", {}).get("receipt_hash") != receipt_by_event[event_id].get("receipt_hash")
        for event_id, event in ledger.events.items()
    ):
        raise ValueError("backup event and receipt bindings are inconsistent")
    if any(entry.get("event_id") not in ledger.events
           or entry.get("payload", {}).get("payload_hash") != ledger.events[entry["event_id"]].get("payload_hash")
           for entry in body["wal"]):
        raise ValueError("backup WAL bindings are inconsistent")
    if not ledger.verify():
        raise ValueError("receipt chain validation failed")
    return ledger


def boundary_audit(root: str | Path) -> dict[str, Any]:
    root_path = Path(root).resolve()
    return {"workspace": str(root_path), "network": "DENY", "credentials": "NONE",
            "native_store": "DENY", "runtime_contact": "NONE", "provider_contact": "NONE",
            "python": sys.version.split()[0], "platform": platform.platform(),
            "path_scope": str(root_path)}


def reproducibility_manifest(files: Iterable[str | Path], root: str | Path) -> dict[str, Any]:
    root_path = Path(root).resolve()
    entries = []
    for file in sorted((Path(f) for f in files), key=lambda p: str(p)):
        path = file if file.is_absolute() else root_path / file
        resolved = path.resolve()
        if root_path not in resolved.parents and resolved != root_path:
            raise ValueError("manifest path escapes workspace")
        entries.append({"path": str(resolved.relative_to(root_path)).replace(os.sep, "/"),
                        "sha256": hashlib.sha256(resolved.read_bytes()).hexdigest()})
    return {"label": "CANDIDATE_PREPARATORY_EVIDENCE", "gate_status": "BLOCKED",
            "python": sys.version.split()[0], "files": entries, "manifest_hash": digest(entries)}


def run_bounded_concurrency(worker: Callable[[int], Any], count: int = 32) -> list[Any]:
    """Deterministic bounded schedule used to exercise a concurrency oracle."""
    if not 1 <= count <= 128:
        raise ValueError("bounded count required")
    return [worker(index) for index in range(count)]
