# Onoes.Mind v4.1 — Echo Distributed-Continuity Audit Reconciliation

**Prepared:** 2026-09-02  
**Source plan:** `Onoes-Mind-Build-Plan-v4.1.md`  
**Audit:** `Echo-Audit-Distributed-Continuity-v4.1.md`  
**Proposed plan:** `Onoes-Mind-Build-Plan-v4.2-DRAFT.md`  
**Scope:** Planning reconciliation only; no implementation or operational authorization

## Result

All findings DC-01 through DC-15 are **adopted**. None are rejected. Some implementation is deliberately phase-gated, but the governing contracts are part of the v4.2 Phase 0 specification boundary.

The audit does not change canonical authority: cloud Onoes.Mind remains the sole dynamic memory authority. A device capsule is a bounded leased projection, and an outage journal contains non-canonical candidates. Supermemory remains optional and absent from every continuity-critical path.

## Reconciliation matrix

| Finding | Severity | Current v4.1 treatment | Proposed v4.2 treatment | Section / phase | Acceptance test | Disposition |
|---|---|---|---|---|---|---|
| DC-01 Mandatory-primary routing | Critical | Runtime adapters and native emergency continuity were named, but no exclusive router mechanically denied native calls while healthy. | Adds one mandatory per-agent router and exact backend permissions for three states. Healthy mode allows cloud Mind dynamic recall/write only; denied local calls fail closed and audit. | §5 architecture; §5A router states; Phase 0 contract; Phase C implementation | 55, 69 | **Adopted** |
| DC-02 Circuit-breaker entry/recovery | High | Degraded operation, retry budgets, and slow start existed, without continuity transition thresholds. | Defines eligible/noneligible fault classes, parameterized measured thresholds, half-open probes, minimum hold, stability window, epochs, maximum duration, and no single-error fallback. | §5A circuit breaker; Phase 0 measurement/spec; Phase C | 56, 68–69 | **Adopted**; numeric values explicitly gated on Phase 0 measurements |
| DC-03 Client partition versus service outage | High | Primary failure/read-only posture existed, but a device could not distinguish local reachability failure from global service state. | Default reason is `client_partition`; only independent corroborated monitoring may label `service_outage`. Neither grants shared/canonical authority. Recovery detects concurrent cloud change. | §5A authority/circuit/recovery; Phase 0; Phase C | 57, 65, 75 | **Adopted** |
| DC-04 Continuity Capsule contract | High | No capsule schema, budget, compiler identity, watermark, expiry, or atomic install contract. | Adds per-agent/device signed/encrypted manifest, provisional 32 MiB and 1,500-item Phase 0 evaluation ceilings, measured production caps, bucket counts, local FTS, lease, A/B installation, rollback, and fail-closed validation. | §5A Capsule contract/validity; Phase 0; Phase C | 58, 64, 67, 70 | **Adopted** |
| DC-05 Full content versus summaries | High | Retrieval budgets existed but local continuity selection did not. | Uses exact content only for small pinned/critical records, summaries with canonical lineage for broader context, pointers for evidence, reserved buckets, authority-first ordering, and bounded frequency tie-breaking. | §5A Capsule/Compiler; Phase 0 policy; Phase D evaluation | 58–59, 66 | **Adopted** |
| DC-06 Soul/identity governance | High | Native memory mentioned identity/boot context but did not isolate identity from dynamic memory. | Creates separately owned/signed `agent-kernel` with distinct schema/key/version and immutable-at-runtime rule. Candidate, compiler, journal, model, import, and local replacement cannot mutate it. | §5 architecture; §5A Artifact separation; Phase 0; Phase C | 60, 64, 67 | **Adopted** |
| DC-07 Outage-journal durability/ack | High | Optional L1 spill rules existed; no explicit outage journal or local/canonical acknowledgement distinction. | Defines encrypted append-only checksummed/fsynced journal, bounded overflow, scan-before-write, `durable_local=true` and `canonical=false`, sequence/epoch/device fields, replay states, and dead letter. It is not a transparent healthy-mode buffer. | §5A Outage journal; §8 acknowledgement; Phase A schema, A.1 hardening, C enablement | 61–62, 68–69 | **Adopted**; activation deferred until Phase C gate |
| DC-08 Original event ID during replay | High | First-write-wins was strong, but outage replay outcomes were absent. | Preserves original event ID and defines same/duplicate/divergence/correction/independent-claim/scope/secret/dead-letter outcomes. New IDs require explicit governed correction or independent claim. | §5A Recovery/journal; §7 idempotency retained; Phase 0/C | 62, 68 | **Adopted** |
| DC-09 Offline revocation/deletion | Critical | Credential epochs and deletion ledger existed, but no device lease or offline exposure policy. | Adds per-device registration/key/grant/revocation epochs, bounded capsule lease and sensitivity TTL, restricted expiry mode, reconnection-first deltas, delivery denial, optional remote wipe, and explicit impossibility of guaranteed deletion from a permanently offline device. | §5A Device cryptography/revocation; Phase 0, A.1, C | 63, 67, 71–72 | **Adopted**; exact TTL/exposure values require operator decision after measurement |
| DC-10 Device signing/encryption lifecycle | High | TLS, credential hashing, audit signing, and backup encryption existed; capsule key binding did not. | Uses per-device/per-principal authenticated encryption, separate signing/encryption roles, associated-data bindings, anti-rollback, key rotation/revocation, OS/hardware protection, and fail-before-use verification. | §5A Capsule/Device cryptography; Phase 0, A.1, C | 64, 67, 70–71 | **Adopted** |
| DC-11 Cloud/failure-domain topology | High | Cloud location was an open choice and primary failure was read-only; cloud-agent correlation was not addressed. | Requires private TLS/mTLS network, non-public gateway, separate process/credential boundaries, separate host/zone where practical, independent monitoring and backup/ledger failure domains, and no authority transfer when Mind and cloud agent fail together. | §5/§5A Authority; Phase 0 topology, A.1 drills, rollout gate | 65, 75 | **Adopted**; provider/region placement remains an explicit operator decision |
| DC-12 Compiler scope leak/poisoning | High | Server-derived scopes and poisoning controls existed, but not for a capsule compiler. | Compiler consumes current canonical authorization by stable IDs only, excludes unsafe states, records inclusion/exclusion decisions, never joins on labels, and caps frequency below authority/safety/freshness. | §5A Compiler; Phase 0 policy, C implementation, D evaluation | 58–59, 66 | **Adopted** |
| DC-13 Invalid/stale capsule behavior | High | No capsule state vocabulary or restricted fallback behavior. | Defines valid, nearing-expiry, expired, revoked, signature-invalid, decrypt-failed, wrong-binding, policy-incompatible, rollback-detected, and rollback-available behavior. Invalid dynamic content fails closed to kernel-only restricted mode. | §5A Capsule validity; Phase 0/C | 63–64, 67, 70 | **Adopted** |
| DC-14 Recovery acknowledgement barrier | High | Primary recovery/runbook and canonical acks existed, but no local-to-cloud reconciliation barrier. | Adds ordered health/integrity stability, journal freeze/replay, terminal outcomes, conflict handling, canonical acknowledgement, fresh capsule installation, epoch advance, and prohibition on mixed recall. | §5A Recovery barrier; Phase 0 contract, A.1 drills, C implementation | 62, 68–70 | **Adopted** |
| DC-15 Native-memory wording conflict | High | Native memory was described as emergency continuity and Phase C preserved it, allowing adapter-specific interpretations. | Replaces it with `MIND_PRIMARY_HEALTHY`, `CONFIRMED_OUTAGE_CONTINUITY`, and `RECOVERY_RECONCILIATION`; arbitrary legacy/native semantic stores are disabled in every state. Only the governed capsule subsystem may provide local semantic recall. | Executive decision; §5 architecture; §5A router; Phase 0/C | 55, 57, 69, 73 | **Adopted** |

## Phase changes

| Phase | Distributed-continuity amendment |
|---|---|
| Phase 0 | Freeze router states, breaker fault classes/threshold variables, client-partition semantics, capsule/kernel/journal schemas, compiler policy/receipts, crypto and revocation model, recovery barrier, topology, threat model, and tests 55–75. Measured numeric thresholds and TTLs are named operator decisions rather than guesses. |
| Phase A | Add device/revocation/grant epochs and canonical fields needed for capsule/journal receipts while preserving ledger, first-write-wins, and scope authority. No fallback activation. |
| Phase A.1 | Add device enrollment/revocation/key operations, lease metadata, independent monitoring, deletion/revocation deltas, topology/failure drills, and recovery controls. No agent fallback activation. |
| Phase B | Remains optional. Supermemory can run later or in parallel and is not a prerequisite for Phase C or continuity. |
| Phase C | Implement the mandatory router, cloud-only healthy path, capsule compilation/delivery/install, client continuity, outage journal, adapter state enforcement, and complete recovery barrier. |
| Phase D | Evaluate capsule sizes, summary/full mixture, freshness, offline utility, selection determinism, latency, and frequency-poisoning resistance. |
| Phase E | Preserve shared governance and prove outage/recovery cannot promote, supersede shared truth, or bypass the signed second channel. |

## New tests and ownership

Tests 55–75 cover healthy-mode exclusivity, breaker behavior, client partitions, capsule compilation/budgets, poisoning, kernel immutability, journal durability/replay, offline revocation, device cryptography, failure domains, compiler isolation, invalid capsule states, recovery barrier, adapter state matrices, atomic installation, stolen devices, deletion propagation, denial of offline shared authority, Supermemory independence, and simultaneous cloud-agent/Mind failure.

Their first blocking ownership is recorded in the v4.2 plan: schema/unit slices in Phase A, operational/device controls in A.1, full runtime continuity in C, selection-quality evaluation in D, and shared-authority denial/retests in E.

## Explicitly unresolved operator decisions

The following are not guessed:

1. Cloud provider, region, and exact failure-domain placement.
2. Per-network/device-class circuit-breaker thresholds and timing, after Phase 0 measurements.
3. Capsule and sensitivity-class lease/TTL values and maximum acceptable offline stolen-device exposure.
4. Production capsule byte/item/bucket limits after testing the provisional 32 MiB/1,500-item evaluation ceilings on the corpus and each device.
5. Device enrollment/attestation, OS/hardware key protection, recovery custodians, and remote-wipe platform support.
6. Which noncritical dead letters may cross the recovery barrier with an operator receipt.
7. Whether development may colocate the cloud agent and Mind; production preference is separate failure domains.

## Authority and scope confirmation

- v4.1 remains the unchanged baseline.
- The v4.2 file is a proposal draft, not an approved specification or implementation order.
- Continuity does not become canonical authority.
- No shared publication or destructive authority exists during outage or recovery.
- No unrestricted local database copy is permitted.
- No secret or inaccessible scope is eligible for a capsule or journal.
- Supermemory remains optional and may be learned from or woven in later without redesigning the canonical or continuity contracts.
