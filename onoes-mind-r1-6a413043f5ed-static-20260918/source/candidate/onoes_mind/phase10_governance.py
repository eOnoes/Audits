"""Deterministic model-tier governance hooks; no model or approval side effects."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from .phase10_fake_adapters import canonical_hash


class GovernanceError(ValueError):
    """Fail-closed governance transition error."""


class ModelTierController:
    """Small local state machine for Sol/Luna enforcement and evidence receipts."""

    def __init__(self, *, work_id: str = "candidate-work", plan_version: str = "candidate-plan-v1") -> None:
        self.work_id = work_id
        self.plan_version = plan_version
        self.state = "SOL_PLANNING"
        self._receipts: list[dict[str, Any]] = []

    @property
    def receipts(self) -> list[dict[str, Any]]:
        return deepcopy(self._receipts)

    def _receipt(self, event: str, **details: Any) -> dict[str, Any]:
        receipt = {"receipt_id": f"governance-{len(self._receipts) + 1}", "work_id": self.work_id,
                   "event": event, "state": self.state, "plan_version": self.plan_version,
                   "model_tier": "Sol" if self.state in {"SOL_PLANNING", "SOL_RECONCILING", "ESCALATED"} else "Luna",
                   "details": details, "previous_receipt_hash": self._receipts[-1]["receipt_hash"] if self._receipts else None}
        receipt["receipt_hash"] = canonical_hash(receipt)
        self._receipts.append(receipt)
        return deepcopy(receipt)

    def enter_luna(self, approval_receipt: str | None) -> dict[str, Any]:
        if self.state != "SOL_PLANNING" or not approval_receipt:
            raise GovernanceError("accepted plan and approval receipt are required")
        self.state = "LUNA_SUPERVISING"
        return self._receipt("PLAN_ACCEPTED", approval_receipt=approval_receipt)

    def escalate(self, reason: str, evidence_refs: list[str]) -> dict[str, Any]:
        if self.state != "LUNA_SUPERVISING" or not reason or not evidence_refs:
            raise GovernanceError("only Luna may escalate with evidence")
        self.state = "ESCALATED"
        return self._receipt("ESCALATED", reason=reason, evidence_refs=list(evidence_refs))

    def reconcile(self, diagnosis: str, correction: str, test_ids: list[str]) -> dict[str, Any]:
        if self.state != "ESCALATED" or not diagnosis or not correction or not test_ids:
            raise GovernanceError("Sol reconciliation requires diagnosis, correction, and tests")
        self.state = "SOL_RECONCILING"
        return self._receipt("RECONCILIATION_PROPOSED", diagnosis=diagnosis, correction=correction, test_ids=list(test_ids))

    def return_to_luna(self, approval_receipt: str | None, tests_passed: bool) -> dict[str, Any]:
        if self.state != "SOL_RECONCILING" or not approval_receipt or not tests_passed:
            raise GovernanceError("independent approval and passing tests are required")
        self.state = "LUNA_SUPERVISING"
        return self._receipt("RETURN_TO_LUNA", approval_receipt=approval_receipt)

    def block(self, reason: str) -> dict[str, Any]:
        if self.state == "BLOCKED" or not isinstance(reason, str) or not reason.strip():
            raise GovernanceError("block reason is required")
        self.state = "BLOCKED"
        return self._receipt("BLOCKED", reason=reason)

    def authorize_action(self, action: str, *, required_tier: str,
                         evidence_refs: list[str] | None = None) -> dict[str, Any]:
        """Enforce the active model tier for a bounded local action."""
        if self.state == "BLOCKED":
            raise GovernanceError("blocked governance cannot authorize actions")
        if required_tier not in {"Sol", "Luna"} or not isinstance(action, str) or not action.strip():
            raise GovernanceError("a valid action and model tier are required")
        active = "Sol" if self.state in {"SOL_PLANNING", "SOL_RECONCILING", "ESCALATED"} else "Luna"
        if active != required_tier:
            raise GovernanceError(f"{required_tier} action is not permitted in {active} state")
        if not evidence_refs:
            raise GovernanceError("action evidence is required")
        return self._receipt("ACTION_AUTHORIZED", action=action, evidence_refs=list(evidence_refs),
                             required_tier=required_tier)
