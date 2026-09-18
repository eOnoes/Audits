# Echo Audit — Distributed Continuity and Cloud-Primary Onoes.Mind v4.1

**Audit date:** 2026-09-02  
**Auditor:** Echo  
**Repository:** `X:/SANITIZED/HOME_PATH`  
**Primary plan audited:** `Onoes-Mind-Build-Plan-v4.1.md`  
**Plan size:** 1,156 lines / 74,779 bytes  
**Audit mode:** hostile architecture review; planning only; no implementation or runtime changes

## Disposition

# MODIFY

The v4.1 plan is a strong canonical-ledger and policy foundation, but it is not yet sufficient for the proposed cloud-primary, mandatory-Mind, Continuity Capsule deployment. The distributed-continuity decisions introduce a new runtime authority/failure model that must be specified before Phase 0 can be considered complete. This is not a reason to discard v4.1; it is a required amendment and phase-gating change.

## Scope and method

I read the primary plan completely and compared the proposed distributed-continuity decisions against its authority order, native-memory boundary, identity/scope model, acknowledgement semantics, backup/restore requirements, phase structure, and acceptance suite.

This audit is based on the written plan, not on claims that implementation exists. No source files, runtime settings, cloud resources, agents, credentials, or external services were modified or contacted.

## Positive controls worth preserving

1. Canonical ledger ownership is explicit and provider-neutral.
2. First-write-wins event binding correctly forbids automatic replacement event IDs on divergent retries.
3. `durable=true` is tied to canonical commit rather than a local acknowledgement.
4. Shared promotion has a single evidence gate and current-generation receipt requirement.
5. Scope is derived server-side; caller-selected scopes are hints only.
6. Secret scanning occurs before storage, hashing, journaling, indexing, or egress.
7. Primary-writer failure already favors read-only/unavailable behavior over automatic failover.
8. The plan correctly treats indexes and external providers as rebuildable projections.
9. Native memory is already described as not being an uncontrolled competing semantic authority.
10. The phase model separates core storage, operational hardening, provider experiments, runtime integration, semantic retrieval, and governance.
11. The acceptance suite includes deletion, restore, poisoning, retry, provider, concurrency, and degraded-state tests.
12. Supermemory remains optional and is not allowed to become the only durable copy.

## Findings

### DC-01 — Mandatory-primary routing is not specified

**Severity:** CRITICAL  
**Scenario:** A healthy agent starts with both Onoes.Mind and native/local memory available. A provider adapter, startup hook, or fallback branch queries native memory before the cloud gateway response is known, causing stale or private local content to influence a response while Mind is healthy.  
**Specification change:** Define one mandatory memory router per agent. Healthy mode must permit canonical Mind recall only; native memory calls must be mechanically denied, not merely discouraged by instructions. Every recall must carry route, gateway health epoch, principal, capsule version, and fallback state.  
**Phase:** Phase C, with the router contract and state machine frozen in Phase 0.  
**Acceptance test:** With Mind healthy, instrument every memory backend and run recall/capture scenarios. Native backend call count must be zero; any attempted native call must fail closed and produce a redacted policy event.  
**Blocks:** Phase 0 completion and production rollout.

### DC-02 — Circuit-breaker entry and recovery are undefined

**Severity:** HIGH  
**Scenario:** A single timeout or transient 503 causes fallback entry, or a brief successful response causes immediate exit. The agent alternates between cloud and local memory, producing inconsistent recall and duplicate outage observations.  
**Specification change:** Define deterministic thresholds: consecutive failures by error class, time window, probe timeout, half-open probe count, stability window, recovery epoch, and maximum fallback duration. State transitions must be monotonic per epoch and observable.  
**Phase:** Phase 0 contract; Phase C implementation.  
**Acceptance test:** Replay timeout, DNS, TLS, authentication, 5xx, rate-limit, and valid-empty-result cases. Verify only the specified classes enter fallback, recovery requires the stability window, and no oscillation occurs.  
**Blocks:** Phase 0 completion; production rollout.

### DC-03 — Network partition is not equivalent to service outage

**Severity:** HIGH  
**Scenario:** The local agent cannot reach Mind, but Mind is healthy and another agent continues writing. Local fallback treats the partition as global outage and creates candidate memories based on stale assumptions.  
**Specification change:** Model local connectivity state separately from service health. A client may enter local read-only continuity after its own deterministic failure threshold, but it must never infer global outage or shared-write permission from local inability to connect.  
**Phase:** Phase 0 and Phase C.  
**Acceptance test:** Isolate one client from the network while the cloud service remains healthy and another client writes. Verify local fallback is labeled `client_partition`, no shared promotion occurs, and recovery reconciliation detects changed cloud truth.  
**Blocks:** Production rollout.

### DC-04 — Continuity Capsule is absent from the current plan

**Severity:** HIGH  
**Scenario:** An agent receives either no useful continuity state during outage or an uncontrolled broad replica containing obsolete, sensitive, or cross-scope data.  
**Specification change:** Add the Continuity Capsule as a bounded, signed, encrypted, versioned projection compiled from canonical Mind. Define schema, required sections, maximum byte/item/token budgets, permitted scopes, freshness, expiration, compiler identity, source ledger watermark, and atomic installation/rollback.  
**Phase:** Phase 0 specification; Phase C implementation.  
**Acceptance test:** Compile capsules for each agent and device from a seeded corpus. Verify scope filtering, deterministic selection, size limits, signature/encryption verification, atomic replacement, rollback, and rejection of malformed/expired capsules.  
**Blocks:** Phase 0 completion; production rollout.

### DC-05 — Full-content versus summary selection is under-specified

**Severity:** HIGH  
**Scenario:** Frequency-based selection repeatedly promotes a poisoned or outdated memory, while a summary omits the evidence needed to distinguish a current decision from an old one.  
**Specification change:** Define a mixture policy: full content only for small, high-utility, operator-pinned or operationally necessary records; summaries with canonical IDs and evidence pointers for broader context; no raw transcripts or large evidence bodies. Selection must weight authority, current status, scope, freshness, contradiction state, operator pinning, and safety—not recall frequency alone.  
**Phase:** Phase 0 selection policy; Phase D evaluation.  
**Acceptance test:** Seed frequent false information, low-frequency authoritative corrections, private data, expired commitments, and conflicting records. Verify the capsule chooses the governed current record and does not amplify frequency-only poisoning.  
**Blocks:** Phase 0 completion.

### DC-06 — Soul/identity governance is not separated from dynamic memory

**Severity:** HIGH  
**Scenario:** A candidate, outage journal entry, model-generated summary, or capsule compiler output changes the agent's identity/Soul kernel. The next offline session treats the mutation as authoritative.  
**Specification change:** Define `agent-kernel` as a separate signed artifact with a distinct owner, schema, key, version, approval path, and immutable-at-runtime rule. Dynamic memory must never write to it. Soul changes require explicit operator approval and a new signed revision.  
**Phase:** Phase 0 and Phase C.  
**Acceptance test:** Attempt to mutate identity through normal capture, outage journal replay, capsule compilation, imported content, prompt injection, and direct local file replacement. All unauthorized changes fail and the original kernel remains active.  
**Blocks:** Phase 0 completion; production rollout.

### DC-07 — Outage-journal durability and acknowledgement semantics are incomplete

**Severity:** HIGH  
**Scenario:** An agent writes an observation during an outage, reports it as remembered, loses it on power failure, or later replays it twice.  
**Specification change:** Define the outage journal as append-only, encrypted, checksummed, bounded, fsynced before acknowledgement, and explicitly `durable=false` / `canonical=false`. Each entry needs original event ID, device ID, outage epoch, observed time, journal sequence, payload classification, replay state, and dead-letter state. Raw secrets must be rejected before journaling.  
**Phase:** Phase 0 contract; Phase A.1 storage hardening; Phase C runtime enablement.  
**Acceptance test:** Kill/reboot during append, replay, acknowledgement, and cloud recovery. Verify no silent loss, no duplicate canonical fact, no raw secret persistence, bounded overflow, and truthful status reporting.  
**Blocks:** Production rollout; does not block Phase 0 if the feature remains explicitly disabled, but its specification blocks approval of enabling it.

### DC-08 — Original-event-ID reuse conflicts with cloud conflict semantics unless expanded

**Severity:** HIGH  
**Scenario:** An outage entry reuses its original event ID after cloud truth changed. The cloud correctly returns first-write-wins divergence, but the client treats the response as accepted or silently creates a new ID, producing a duplicate or hidden conflict.  
**Specification change:** Define replay outcomes separately: canonical acknowledgement of the same payload, duplicate closure, divergence against an existing event binding, supersession proposal, rejected scope, secret rejection, and dead-letter. Reconciliation must preserve the original event ID and create a separate correction/independent-claim event only through explicit policy.  
**Phase:** Phase 0 and Phase C.  
**Acceptance test:** Exercise same payload, changed payload, changed evidence, superseded cloud record, deleted cloud record, and event-ID collision cases. Verify first-write-wins remains intact and every outcome is visible to the agent/operator.  
**Blocks:** Phase 0 completion; production rollout.

### DC-09 — Revocation and deletion propagation to offline devices are missing

**Severity:** CRITICAL  
**Scenario:** A device is lost, a private memory is purged or access is revoked in the cloud, but its valid capsule remains usable offline until expiry—or indefinitely if the device is disconnected.  
**Specification change:** Define per-device keys, device registration, revocation epochs, capsule lease/expiry, emergency revocation list or short-lived online renewal, remote wipe policy where available, and behavior when revocation state cannot be checked. A device that cannot prove a current lease must enter restricted/no-recall mode, not continue using sensitive content indefinitely.  
**Phase:** Phase 0 security contract; Phase A.1 operational controls; Phase C device behavior.  
**Acceptance test:** Revoke a device, purge a record, revoke an agent credential, and rotate a scope grant while the device is offline. Verify configured exposure window, no new sensitive recall after local enforcement point, and correct behavior on reconnection and capsule rebuild.  
**Blocks:** Phase 0 completion and production rollout.

### DC-10 — Device encryption/signing and key lifecycle are not defined

**Severity:** HIGH  
**Scenario:** A signed capsule can be copied to another device, a device key is reused across agents, or a stolen device decrypts all agent capsules.  
**Specification change:** Bind capsule encryption to intended device identity and agent principal; use authenticated encryption, signature verification, key version, key expiry, and separate signing/encryption roles. Define provisioning, rotation, revocation, backup, recovery, and hardware-protected key options.  
**Phase:** Phase 0 and Phase A.1.  
**Acceptance test:** Swap capsules between devices and agents, alter bytes, downgrade versions, rotate keys, and present revoked keys. All invalid cases fail before content use.  
**Blocks:** Phase 0 completion; production rollout.

### DC-11 — Cloud hosting and failure-domain assumptions are not placed in the phase plan

**Severity:** HIGH  
**Scenario:** The cloud agent and Mind share one host, network, credentials, backup, or failure domain. A host failure removes both canonical memory and the agent that should report the failure, while local agents continue from stale capsules.  
**Specification change:** Add deployment topology requirements: separate failure domains where practical, private networking, TLS/mTLS, gateway exposure rules, backup geography/storage separation, monitoring independent of the cloud agent, and explicit behavior when both cloud agent and Mind fail together.  
**Phase:** Phase 0 architecture/deployment contract; Phase A.1 restore/operations; rollout gate.  
**Acceptance test:** Simulate Mind-only failure, agent-only failure, shared-host failure, network partition, credential outage, backup unavailability, and region loss. Verify canonical authority never silently moves to a capsule or local journal.  
**Blocks:** Production rollout.

### DC-12 — Capsule compiler scope-leak and poisoning controls need explicit gates

**Severity:** HIGH  
**Scenario:** A compiler joins records by display name, stale index, project label, or agent ID supplied in content and includes another agent's private memory. A frequently recalled poisoned item receives increased capsule priority.  
**Specification change:** Compiler input must be canonical, scope-authorized records only, joined by stable IDs. Every output item needs an inclusion reason, source revision, scope decision, sensitivity decision, and compiler-policy version. Frequency is a bounded signal only and cannot override authority, safety, freshness, or contradiction state.  
**Phase:** Phase 0 policy; Phase C implementation; Phase D evaluation.  
**Acceptance test:** Seed forged names, cross-agent labels, stale indexes, malicious summaries, high-frequency poisoned facts, and private/shared collisions. Verify zero cross-scope inclusion and deterministic safe selection.  
**Blocks:** Phase 0 completion; production rollout.

### DC-13 — Stale, expired, or unverifiable capsule behavior is unspecified

**Severity:** HIGH  
**Scenario:** Signature verification fails, the capsule expires, its source watermark is too old, or the compiler policy version is unsupported. The agent continues using it as normal memory.  
**Specification change:** Define capsule states: valid, nearing-expiry, expired, signature-invalid, decrypt-failed, policy-incompatible, revoked, and rollback-available. Define fail-closed behavior, emergency identity-only behavior, operator alerting, and whether non-sensitive pinned commitments may remain available.  
**Phase:** Phase 0 and Phase C.  
**Acceptance test:** Corrupt, expire, downgrade, revoke, and decrypt-fail capsules. Verify the agent never treats invalid dynamic content as canonical and enters the documented restricted mode.  
**Blocks:** Phase 0 completion; production rollout.

### DC-14 — Recovery requires a canonical acknowledgement barrier

**Severity:** HIGH  
**Scenario:** Cloud connectivity returns and the agent immediately resumes normal cloud-primary recall while outage entries are still unreconciled or the capsule is still stale. Responses mix old local state with new canonical state.  
**Specification change:** Define recovery ordering: connectivity probe → authenticated gateway health → integrity/stability window → freeze fallback writes → replay outage journal using original IDs → resolve outcomes/conflicts → canonical acknowledgement → purge or retain journal entries → compile/install fresh capsule → re-enable healthy routing. Normal operation must not resume before the barrier completes.  
**Phase:** Phase 0 state machine; Phase C implementation; Phase A.1 recovery drills.  
**Acceptance test:** Recover during pending journal entries, conflicting cloud updates, partial replay, capsule compilation failure, and acknowledgement timeout. Verify no split-brain recall and no local deletion before acknowledgement.  
**Blocks:** Production rollout.

### DC-15 — Existing native-memory wording conflicts with mandatory Mind-primary operation

**Severity:** HIGH  
**Scenario:** v4.1's target architecture and Phase C say native memory provides emergency continuity, but do not say whether native storage is disabled, queried, written, or synchronized during healthy operation. Different adapters make different choices.  
**Specification change:** Replace the native-memory language with an explicit three-state policy: `MIND_PRIMARY_HEALTHY`, `CONFIRMED_OUTAGE_CONTINUITY`, and `RECOVERY_RECONCILIATION`. State exact permitted reads/writes in each state. Native memory must be disabled or policy-denied in healthy mode; outage writes go only to the outage journal; recovery entries are candidates.  
**Phase:** Phase 0 amendment; Phase C implementation.  
**Acceptance test:** Run all agent adapters across each state and assert allowed backend calls, status labels, and write destinations.  
**Blocks:** Phase 0 completion; production rollout.

## Answers to required questions

### 1. Is “Continuity Capsule” the right abstraction?

**Yes**, provided it is explicitly a signed, encrypted, bounded, expiring projection—not a database replica, cache of convenience, or alternate authority. The name correctly communicates continuity rather than canonical ownership.

### 2. Should native memory be queried only during confirmed outages?

**Yes.** During healthy operation, native memory should be mechanically unavailable to the semantic recall path. During a confirmed client-side outage, only the permitted capsule and outage-journal behavior should activate. A local partition must never grant shared-write or shared-truth authority.

### 3. Should the local cache contain full content, summaries, pointers, or a mixture?

A **mixture**:

- full content for small, operator-pinned identity/commitment records and high-utility facts where the agent needs exact wording;
- compact summaries for bounded project context;
- canonical IDs, revision IDs, hashes, evidence pointers, freshness, and scope metadata for traceability;
- no secrets, raw transcripts, broad history, large evidence bodies, inaccessible scopes, or unreviewed dynamic instructions.

### 4. How should the compiler decide what each agent receives?

Use a deterministic, policy-first pipeline:

1. select only canonical current records permitted for the agent principal and device;
2. exclude purged, revoked, quarantined, disputed, inaccessible, expired, and unsupported-sensitivity content;
3. apply operator pins and essential identity/commitment rules;
4. apply authority, freshness, contradiction, safety, and utility policies;
5. use frequency only as a bounded tie-breaker or measurement signal;
6. produce an inclusion/exclusion receipt;
7. sign, encrypt, version, size-check, and atomically install the capsule.

### 5. What must happen before returning from fallback to cloud-primary operation?

The gateway must be reachable and authenticated; a stability/integrity window must pass; fallback writes must freeze; outage-journal entries must replay with original event IDs; each result must be acknowledged or dead-lettered; conflicts must be surfaced; local entries must not be removed prematurely; a fresh valid capsule must be compiled and installed; and the router must advance to a new recovery epoch.

### 6. Does this alter the A / A.1 / B / C / D / E phase structure?

**Yes, but it does not require replacing it.** Add a distributed-continuity specification slice to Phase 0, expand A.1 with device/revocation/recovery operations, and make Phase C a mandatory-primary router plus capsule/journal integration gate. Phase D evaluates selection quality and poisoning resistance. Phase E governs shared changes and approval as already planned.

Suggested placement:

```text
Phase 0: continuity state machine, capsule contract, compiler policy, threat model, keys, revocation, failure domains
Phase A: canonical ledger fields and event binding used by capsules/journal
Phase A.1: recovery drills, device revocation, independent monitoring, storage/pressure controls
Phase B: optional provider projection remains separate
Phase C: mandatory Mind-primary router, outage journal, capsule installation, recovery barrier
Phase D: selection quality, frequency-poisoning, freshness, and latency evaluation
Phase E: shared governance; no fallback promotion authority
```

### 7. Can Supermemory remain entirely optional and be woven in later?

**Yes.** The new continuity design strengthens that conclusion. Supermemory must remain a non-authoritative projection/teacher lane and must never be required for capsule compilation, outage operation, recovery, identity, deletion, or canonical reconciliation.

## Required v4.1 amendment checklist

Before Phase 0 specification freeze, amend the primary plan with:

- mandatory-primary routing state machine;
- deterministic circuit-breaker thresholds and recovery epoch;
- local partition versus global outage semantics;
- Continuity Capsule schema and budgets;
- deterministic compiler selection and inclusion receipt;
- agent-kernel, continuity-cache, and outage-journal separation;
- device-bound encryption/signing and key lifecycle;
- capsule expiry, revocation, deletion, and stolen-device exposure policy;
- outage-journal acknowledgement/replay/dead-letter semantics;
- recovery barrier and original-event-ID conflict outcomes;
- cloud/Mind/agent failure-domain topology;
- independent monitoring and backup/restore behavior;
- capsule scope-leak and poisoning test matrix;
- phase-to-test ownership for all new controls.

## Non-action confirmation

This audit did not modify `Onoes-Mind-Build-Plan-v4.1.md`, implement code, configure cloud resources, connect agents, ingest memory, alter runtime settings, issue credentials, or authorize deployment.
