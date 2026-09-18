# Onoes.Mind — v4.2 to Canonical Plan Reconciliation Proposal

**Status:** PROPOSAL ONLY — independent review required  
**Prepared:** 2026-09-02  
**Canonical target:** `CODEX-CURRENT-BUILD-PLAN.md`  
**Architecture input:** `Onoes-Mind-Build-Plan-v4.2-DRAFT.md`  
**Implementation authority:** NONE

## Proposed disposition

Accept v4.2 as approved architecture/specification input, but do not treat it as direct implementation authority. Keep `CODEX-CURRENT-BUILD-PLAN.md` unchanged until an independent reviewer approves this reconciliation against an exact hash. Preserve the current dirty cloud-readiness/Phase 1 bridge slice as `UNOWNED_BUT_PROTECTED_WORK` until a named owner and closure or handoff receipt are established.

All Echo findings DC-01 through DC-15 are proposed for adoption. None are rejected. Where implementation or numeric policy is not yet authorized, the requirement is adopted and its implementation is deferred behind an explicit gate.

## Source-of-truth reconciliation

The canonical plan should retain this order:

1. Current code, database invariants, and passing tests describe the implemented tree.
2. Canonical repo contracts and reviewed audit receipts constrain changes.
3. `CODEX-CURRENT-BUILD-PLAN.md` governs active work only after an approved patch is applied.
4. v4.2 supplies approved architecture requirements but does not authorize implementation.
5. Older plans, audits, and research remain historical inputs unless explicitly promoted.

An architecture requirement must not be reported as implemented merely because it appears in v4.2. A dirty or untracked file must not be promoted into the canonical baseline without an ownership and closure receipt.

## Terminology collision to resolve

The current repository already uses **continuity** for interrupted-task takeover and handoff (`migrations/007_continuity.sql`, continuity methods in `ledger.py`, and `tests/test_continuity.py`). v4.2 uses continuity for distributed-memory outage operation.

The canonical plan should preserve the existing feature as **task/work continuity** and name the new feature **distributed-memory availability continuity**. New implementation must not introduce a generic `continuity.py` or reuse migration 007. Proposed future names are `availability_router.py`, `capsule.py`, `outage_journal.py`, and `008_distributed_memory_continuity.sql`.

## Required pre-implementation gates

### Gate R0 — Protected dirty-slice ownership

- Bind the cloud-readiness/Phase 1 bridge changes to a named authenticated owner, or retain the classification `UNOWNED_BUT_PROTECTED_WORK`.
- Record exact base revision and exact hashes for every changed file.
- Explain the changed binary fixture and generated evidence.
- Issue an explicit handoff, completion, or abandoned-with-preservation receipt.
- Do not edit any overlapping implementation or test file before this gate closes.

### Gate R1 — Isolated verification and closure

- Verify the protected slice in a clean disposable copy, never by rewriting the protected working tree.
- Run the focused bridge, rollout, and manifest tests and then the full pinned suite.
- Rebuild and independently verify final-candidate evidence in isolation.
- Review the unexplained `bad.sqlite` change.
- Obtain an independent review tied to the exact output manifest.

### Gate R2 — Canonical-plan review

- Independently compare this proposal, v4.2, the Echo reconciliation, the current canonical plan, and the exact implemented tree.
- Resolve each operator decision marked as a blocker or record its phase gate.
- Approve an exact proposed patch and digest before editing `CODEX-CURRENT-BUILD-PLAN.md`.
- Applying the documentation patch does not itself authorize implementation.

## DC-01 through DC-15 proposed canonical dispositions

| Finding | Disposition | Canonical effect | Implementation gate |
|---|---|---|---|
| DC-01 mandatory-primary routing | Adopted | One mandatory router; cloud Mind is exclusive dynamic-memory authority while healthy. | Phase C after R0–R2 and Phase 0 contract approval |
| DC-02 deterministic circuit breaker | Adopted | Fault classes, thresholds, half-open probes, stability window, epochs, hold, and maximum duration are deterministic and fail closed. | Numeric values deferred to measured Phase 0 gate |
| DC-03 client partition vs global outage | Adopted | Default uncertain failure to `client_partition`; only independent corroboration may label service outage; neither transfers canonical authority. | Phase C tests after topology contract |
| DC-04 Continuity Capsule | Adopted | Device/agent-bound signed and encrypted manifest, deterministic compiler, budgets, lease, local FTS, A/B install, and validity states. | Schema in Phase 0; activation deferred to Phase C |
| DC-05 content vs summaries | Adopted | Exact content only for bounded critical records; broader summaries retain canonical lineage and evidence pointers. | Phase 0 policy; Phase D quality gate |
| DC-06 identity separation | Adopted | `agent-kernel`, `continuity-cache`, and `outage-journal` have separate schemas, stores, keys, owners, and mutation rights. | Phase 0 contract; Phase C enforcement |
| DC-07 journal durability/ack | Adopted | Encrypted append-only checksummed/fsynced journal; local ack must say `canonical=false`; bounded overflow and dead letter. | Activation deferred to Phase C durability gate |
| DC-08 original event ID | Adopted | Replay preserves event ID; new IDs require governed correction or independent claim. | Phase C reconciliation gate |
| DC-09 offline revocation/deletion | Adopted | Device/grant/revocation epochs, leases, sensitivity TTLs, restricted expiry, reconnection-first deltas, and honest residual-exposure claims. | Phase A.1 controls; Phase C device gate; TTL decision pending |
| DC-10 device crypto lifecycle | Adopted | Separate signing/encryption roles, authenticated bindings, anti-rollback, rotation/revocation, and fail-before-use validation. | Phase A.1 controls; Phase C verification |
| DC-11 failure domains | Adopted | Private authenticated network, non-public gateway, separate process/credential/host-or-zone boundaries where practical, independent monitoring and recovery evidence. | Phase 0 topology; production placement decision pending |
| DC-12 compiler poisoning/scope | Adopted | Stable-ID authorization only, unsafe-state exclusion, deterministic receipts, no label joins, and authority-first ranking. | Phase C compiler; Phase D adversarial evaluation |
| DC-13 invalid/stale capsules | Adopted | Invalid, expired, revoked, wrong-bound, incompatible, or rollback-detected dynamic content fails closed to kernel-only restricted behavior. | Phase C capsule gate |
| DC-14 recovery barrier | Adopted | Health stability, journal freeze/replay, terminal outcomes, canonical acknowledgements, fresh capsule, and epoch advance precede healthy mode. | Phase C recovery gate |
| DC-15 native-memory conflict | Adopted | Use exactly three states; arbitrary legacy/native semantic stores are disabled in all states. | Phase 0 policy; Phase C enforcement |

## Proposed canonical build order

This order reconciles the current five-phase guide with v4.2 without assuming unimplemented capabilities:

1. **R0–R2 — Ownership, verification, and plan review.** Close the protected dirty slice and approve the canonical documentation patch.
2. **Phase 0 — Specification freeze.** Freeze schemas, authority matrix, three-state router, breaker algorithm, artifact separation, capsule/journal contracts, device lifecycle, recovery barrier, failure-domain topology, and tests 1–75. No runtime enablement.
3. **Phase A — Canonical local core.** Preserve a single canonical ledger, strict scopes, event binding, secret blocking, records/revisions, FTS, audit, export/backup, and the schema fields needed by later receipts. No agent production writes.
4. **Phase A.1 — Operational hardening.** Deletion ledger, pressure controls, recovery drills, device enrollment/revocation/key controls, and isolated topology drills. No fallback activation.
5. **Phase B — Optional Supermemory teacher lane.** Bounded synthetic projection only; never a dependency of identity, canonical storage, capsules, outage behavior, or recovery.
6. **Phase C — Runtime integration.** Only after a separate implementation authorization: mandatory router, three-state enforcement, capsules, journal, replay, and recovery barrier. Arbitrary native semantic memory remains denied.
7. **Phase D — Retrieval/evaluation.** Measure embeddings, capsule selection, summaries, poisoning resistance, latency, and budgets without granting new authority.
8. **Phase E — Shared governance.** Shared promotion/supersession/deletion and dual-channel approvals only after all evidence gates and explicit human approval.

## Exact files Codex would later modify

### First proposed documentation change after independent review

- `CODEX-CURRENT-BUILD-PLAN.md` — apply the independently approved reconciliation patch only.

No implementation file is needed for that documentation-only action. The present proposal and evidence files are additive and do not overlap the protected dirty slice.

### Proposed new specification files after R2, if separately authorized

- `DISTRIBUTED_MEMORY_CONTINUITY_SPEC.md`
- `CONTINUITY_CAPSULE_CONTRACT.md`
- `DISTRIBUTED_CONTINUITY_ACCEPTANCE_MATRIX.md`

### Candidate implementation files for a future, separately authorized Phase C slice

- `onoes_mind/availability_router.py` — new
- `onoes_mind/capsule.py` — new
- `onoes_mind/outage_journal.py` — new
- `onoes_mind/migrations/008_distributed_memory_continuity.sql` — new
- `onoes_mind/migrations/008_distributed_memory_continuity_down.sql` — new
- `tests/test_availability_router.py` — new
- `tests/test_capsule.py` — new
- `tests/test_outage_journal.py` — new
- `tests/test_recovery_barrier.py` — new

`onoes_mind/ledger.py` may eventually require reviewed integration, but it is deliberately excluded from the preauthorized file list. Its interface should be inspected only after R0/R1 closure and a bounded patch is approved. Existing task-continuity files and all currently dirty implementation/test files remain outside this proposal.

## Unresolved operator decisions

The following must be answered or explicitly gated before the affected implementation begins:

1. Authenticated owner and disposition for the protected cloud-readiness/Phase 1 bridge slice.
2. Cloud provider, region, and exact failure-domain separation for Mind, the cloud agent, monitoring, backups, and deletion-ledger replicas.
3. Measured breaker thresholds/window, probe timeout, half-open successes, stability window, continuity hold, and maximum duration per client/network class.
4. Capsule lease, sensitivity TTLs, and maximum acceptable offline/lost-device exposure.
5. Production capsule byte/item/token/bucket budgets after device/corpus measurement; 32 MiB and 1,500 items remain evaluation ceilings only.
6. Device enrollment/attestation, key custody/recovery, OS/hardware protection, and remote-wipe support.
7. Which noncritical dead-letter classes may allow recovery and which require operator resolution.
8. Whether development may colocate the cloud agent and Mind; production preference remains separate failure domains.
9. RPO/RTO, retention periods, trusted-host signing-key custodians, and off-host backup/deletion-ledger locations.
10. Whether optional encrypted healthy-mode L1 spill is ever worth enabling; default remains disabled and it is distinct from the outage journal.

## Approval record required before canonical modification

```text
proposal_file: CODEX-CURRENT-BUILD-PLAN-v4.2-RECONCILIATION-PROPOSAL.md
proposal_sha256: <computed after finalization>
canonical_preimage_sha256: <CODEX-CURRENT-BUILD-PLAN.md hash>
architecture_input_sha256: <Onoes-Mind-Build-Plan-v4.2-DRAFT.md hash>
dirty_slice_receipt: <R0/R1 receipt or explicit protected-work hold>
independent_reviewer: <authenticated identity>
disposition: <APPROVE_PATCH | MODIFY | BLOCK>
approved_exact_patch_sha256: <digest>
implementation_authority: NONE
```

## Preservation confirmation

This reconciliation does not overwrite v4.1, does not alter the current canonical plan, and does not modify any dirty implementation, test, generated evidence, fixture, runtime, provider, credential, cloud, fallback, or Control command-boundary file. It grants no authority to commit, push, deploy, connect agents, ingest real memory, activate native fallback, or enable shared offline authority.
