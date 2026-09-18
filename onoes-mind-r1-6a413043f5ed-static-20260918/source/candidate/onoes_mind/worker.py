"""Deterministic local Phase 2 worker adapter; no network or provider boundary."""

from __future__ import annotations

from typing import Any

from .ledger import Ledger


class SyntheticWorkerAdapter:
    def __init__(self, ledger: Ledger, worker_id: str = "synthetic") -> None:
        self.ledger = ledger
        self.worker_id = worker_id

    def run_once(self) -> dict[str, Any]:
        claim = self.ledger.claim_stage(self.worker_id)
        payload = {"adapter": "synthetic", "stage_code": claim["stage_code"], "verdict": "PASS", "work_code": claim["work_code"]}
        return {"output_payload": __import__("json").dumps(payload, sort_keys=True, separators=(",", ":")), **self.ledger.complete_stage(claim["stage_execution_id"], self.worker_id, claim["lease_version"], payload)}
