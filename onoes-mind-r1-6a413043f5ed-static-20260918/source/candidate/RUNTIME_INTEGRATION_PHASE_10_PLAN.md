# Onoes.Mind Phase 10 — Runtime Integration Unblock Plan

**Status:** `BLOCKED`; design/specification and deterministic local test planning only.
**Scope:** canonical workspace `X:/SANITIZED/HOME_PATH`.
**Identity lock:** Cyony = cloud Hermes; Echo = Hermes local PC; Tripp = laptop OpenClaw. Pi is out of scope unless separately authorized.
**Forbidden:** no Hermes/OpenClaw/Pi live contact, external transport/provider change, credential access, native-store write, activation, or changes to forbidden projects.

Phase 10 does not begin live integration. It establishes evidence and gates for a future isolated trial. Production activation remains a separate fail-closed gate.

## Gate order and acceptance criteria

### Gate 10.1 — Read-only runtime identity/path evidence

Collect, without starting, probing, contacting, or mutating a runtime, for intended Cyony, Echo, and Tripp bindings: concrete executable/package/process path; launch/service metadata; resolved config/state and session roots; actual memory and skill/plugin roots; runtime version/ref and stable agent identity. Read-only health evidence means only pre-existing process/service/ownership/package/launch metadata; it is not a health endpoint, heartbeat, socket probe, runtime request, or inferred health claim. For Hermes, resolve the exact profile for Cyony and Echo. Pi is `OUT_OF_SCOPE` unless separately authorized. Do not use research snapshots, similarly named applications, or `tripp-scenes` as authority.

**PASS:** every intended binding has complete, mutually consistent evidence, provenance, redaction review, and no forbidden path was inspected as a target.
**CONDITIONAL:** evidence is complete for a subset only; those bindings are explicitly excluded and no adapter work proceeds for them.
**BLOCKED:** any missing, contradictory, guessed, credential-bearing, or unowned identity/path evidence.

Evidence required: the Gate 10.1 record in `PHASE_10_EVIDENCE_TEMPLATES.md`, read-only inventory, hashes, timestamps, source path, profile/instance mapping, ownership record, and boundary review. A missing or unavailable observation is recorded, not guessed.

### Gate 10.2 — Explicit operator authorization

Create the per-binding authorization record defined in `PHASE_10_EVIDENCE_TEMPLATES.md`, naming stable agent, runtime family, instance, allowed contract/capabilities, derived scope, authority assignment, expiry, and explicit prohibition on native-store writes and live activation. Authority and reviewer fields are templates until explicitly assigned.

**PASS:** each binding has a separate, unambiguous authorization and the authorization matches Gate 10.1.
**CONDITIONAL:** authorization exists for a subset only; unapproved bindings remain blocked.
**BLOCKED:** missing, ambiguous, expired, contradictory, or scope-broad authorization.

Evidence required: authorization record, reviewer signatures, capability/scope matrix, and boundary check.

### Gate 10.3 — Spec review and approval

Review and approve `RUNTIME_ADAPTER_CONTRACT.md`, `RUNTIME_HEARTBEAT_LEASE_SPEC.md`, `MODEL_TIER_SPEC.md`, `PHASE_10_PROTOCOL_SCHEMAS.md`, `PHASE_10_AUTH_SCOPE_POLICY.md`, `PHASE_10_LEDGER_RECEIPT_INVARIANTS.md`, and `PHASE_10_EVIDENCE_TEMPLATES.md` against v4.1 and the three audits, using the Gate 10.3 disposition matrix. Gate 10.3 is not executable until every artifact has a recorded disposition and assigned reviewer/authority.

**PASS:** all listed artifacts are approved with no unresolved Critical/High findings.
**CONDITIONAL:** only editorial/low-risk findings remain with owners and deadlines; no implementation or trial.
**BLOCKED:** contradiction, missing authority, unresolved security/integrity issue, or unapproved spec.

Evidence required: versioned review, disposition matrix, approval receipts, and spec hashes.

### Gate 10.4 — Deterministic fake adapter tests

After Gate 10.3 approval, implement only local fakes for authorized Hermes/OpenClaw protocol shapes, using `PHASE_10_PROTOCOL_SCHEMAS.md`, `PHASE_10_AUTH_SCOPE_POLICY.md`, and `PHASE_10_LEDGER_RECEIPT_INVARIANTS.md`. Pi remains excluded unless separately authorized. The deterministic test manifest is defined in `PHASE_10_EVIDENCE_TEMPLATES.md`.

**Sequencing rule:** pre-gate local deterministic fake implementation and
tests may be performed as preparatory work when explicitly labeled candidate
evidence. This work does not advance, approve, or pass Gate 10.3 or Gate
10.4. Gate 10.4 acceptance still requires the formal Gate 10.1, 10.2, and
10.3 prerequisites plus independent review; no candidate result substitutes
for those prerequisites.

**PASS:** reproducible suite passes with all required negative cases and no network/provider/runtime calls.
**CONDITIONAL:** non-critical test harness gaps are documented; no live trial.
**BLOCKED:** any false success, scope bypass, event-ID mutation, secret spill, quarantine leak, or external call.

Evidence required: the Gate 10.4–10.6 deterministic test evidence manifest; no gate is executable without the referenced schemas, invariants, fixtures, and oracle entries.

### Gate 10.5 — Heartbeat, lease, Mind-down, fallback, quarantine, reconciliation

After Gate 10.3 approval, run local deterministic tests for all states, missed heartbeats, stale lease fencing, sticky Mind-down, no-spill default, bounded `durable=false` spill if modeled, fsync/replay/dead-letter behavior, quarantine-first recovery, conflicts, and no silent shared divergence, using `RUNTIME_HEARTBEAT_LEASE_SPEC.md`, `PHASE_10_PROTOCOL_SCHEMAS.md`, and `PHASE_10_LEDGER_RECEIPT_INVARIANTS.md`.

**PASS:** all invariants pass; stale or unowned work cannot complete; recovery is observable and governed.
**CONDITIONAL:** only tests unrelated to safety remain, with no trial authorization.
**BLOCKED:** false completion, stale mutation, unbounded/secret spill, automatic promotion, or silent divergence.

Evidence required: the Gate 10.5 deterministic manifest in `PHASE_10_EVIDENCE_TEMPLATES.md`, including state-transition traces, lease/epoch assertions, injected outage/restart results, quarantine reports, and reconciliation receipts.

### Gate 10.6 — Model-tier and deviation tests

After Gate 10.3 approval, test Sol planning, Luna stable supervision, each escalation criterion, pause/quarantine, receipt completeness, Sol reconciliation, plan-version changes, and return-to-Luna approval using `MODEL_TIER_SPEC.md` and the receipt rules in `PHASE_10_LEDGER_RECEIPT_INVARIANTS.md`.

**PASS:** unresolved deviations stop work and every transition has required receipts.
**CONDITIONAL:** cosmetic receipt/reporting gaps only; no autonomous continuation across a deviation.
**BLOCKED:** model override of policy/ledger, self-approval, silent plan drift, or false completion.

Evidence required: the Gate 10.6 deterministic manifest in `PHASE_10_EVIDENCE_TEMPLATES.md`, including deterministic scenarios, receipt chain, plan versions, escalation/review decisions, and quarantine evidence.

### Gate 10.7 — Independent security, integrity, and operations review

Obtain separate reviews of boundary/identity, authentication/credential isolation, ledger/lease integrity, quarantine/recovery, operations, and test evidence.

**PASS:** all Critical/High findings resolved or explicitly rejected with technical justification by the authorized reviewer.
**CONDITIONAL:** only documented lower-severity findings remain and the reviewers explicitly prohibit live activation until closure.
**BLOCKED:** any unresolved Critical/High finding, missing reviewer independence, or incomplete evidence.

Evidence required: the Gate 10.7 independent review manifest in `PHASE_10_EVIDENCE_TEMPLATES.md`, plus review reports, finding dispositions, threat/test matrix, operational runbook, and final artifact manifest.

### Gate 10.8 — Bounded isolated runtime trial

Only after Gates 10.1–10.7 pass, and only with separate written authorization, conduct a bounded, isolated, read-only-first trial against verified bindings. No live provider/channel activation, native-store mutation, or production scope is implied.

**PASS:** trial stays within bounds, all receipts/heartbeats/leases/reconciliation outcomes are valid, and no forbidden target or credential is touched.
**CONDITIONAL:** trial is stopped safely with complete evidence; findings return to Sol and re-audit.
**BLOCKED:** identity drift, unexpected transport, scope violation, credential issue, false durability, or any safety/integrity anomaly.

Evidence required: the Gate 10.8 isolated trial authorization/report in `PHASE_10_EVIDENCE_TEMPLATES.md`, plus isolation proof, allow/deny network trace, event/lease receipts, rollback/reconciliation report, and post-trial audit.

### Gate 10.9 — Separate live activation gate

Live activation is never implied by Phase 10. It requires a new explicit operator confirmation after all prior evidence is reviewed, plus current production identity, key custody, transport security, reviewer health, and activation runbook approval.

**PASS:** explicit current confirmation and every prerequisite is green.
**CONDITIONAL:** design/trial evidence is positive but any production prerequisite remains open; remain fail-closed.
**BLOCKED:** default state, missing confirmation, unresolved audit finding, or any uncertainty about runtime/channel/credential ownership.

Evidence required: the Gate 10.9 production activation checklist in `PHASE_10_EVIDENCE_TEMPLATES.md`, current gate receipts, production security/operations approvals, and signed operator confirmation. This task cannot satisfy this gate.

## Exit rule

Until Gate 10.9 passes, Onoes.Mind production activation remains `BLOCKED`. A completed document or passing local synthetic tests do not claim live integration, runtime ownership, or production readiness. Any deviation from this order returns the phase to `BLOCKED`, quarantines affected outputs, and requires Sol reconciliation plus re-audit.
