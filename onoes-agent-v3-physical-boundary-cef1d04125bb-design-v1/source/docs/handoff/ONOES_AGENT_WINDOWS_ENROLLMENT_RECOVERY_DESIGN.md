# Windows installation enrollment and interrupted-creation recovery

2026-09-16. PROPOSED DESIGN; NOT IMPLEMENTED, REVIEWED OR AUTHORIZED TO RUN.
Inspected baseline: `e1c8d44e96972f87b7245a8de48628ce3da889e1`.
This closes a specification gap, not a physical B-03 or W4 acceptance gate.
No changes to canonical v3 records/checkpoints, frozen packets or native code.

## 1. Placement and prerequisites

Read with WINDOWS_ANCHOR_BACKEND_CANDIDATE, V3_PERSISTENCE_DESIGN_DRAFT and
CONTRACT_V3. The proposed separate anchor owns installation enrollment; the
coordinator owns the ledger. A new installation is not inferred from absent files.
An authenticated, already provisioned anchor and separately authorized installer
are prerequisites. Creating that anchor's own trust root is a different, still
open physical provisioning step; this protocol must not bootstrap its own trust
by accepting a key or identity supplied in an installation package.

Whole-PC coherent image rollback remains an unresolved operator scope decision.
This local protocol cannot distinguish it from the formerly genuine state. It
must not claim otherwise or silently narrow the release requirement. Independent
ledger/guest rollback, missing files, stale owners and cross-store substitution
remain required denials regardless of that decision.

## 2. Existing primitives are not enrollment

- `src/build-only/native/windows-managed-root-registration.cs` records a root
  creation intent before creating a new root. Exact completed retries re-read
  physical identity. An incomplete record denies; it does not resume creation.
  Its unkeyed creation record is not anchor enrollment or anti-rollback evidence.
- `windows-managed-root-provisioning.cs` currently requires SYSTEM and creates
  new protected roots only. Do not run it on the working PC or reinterpret it as
  an ordinary coordinator permission. Neither primitive provisions the proposed
  anchor service or admits a v3 ledger.
- `scripts/studio-static-package.mjs::stageStudioStatic` preserves incomplete
  stages and verifies complete ones against an external pin. It neither switches
  an active version nor establishes protected executable/loader custody.
- `windows-candidate-v3-data.ts` parses installation/namespace/store identity;
  the history and incremental validators check claims. None discovers a trusted
  anchor, binds a physical database, or authorizes installation.

The steps below require new reviewed composition. They are not directions to
chain these existing APIs and call the result an installer.

## 3. Proposed durable enrollment record

This is a field inventory for review, NOT a new exported wire format or schema.
The anchor's private enrollment record must bind one installation request and its
authorization identity; installationId, namespaceId, storeId, ledger domain;
exact canonical genesis digest and initial historical producerGeneration;
version-independent spent-approval continuity; expected protected parent/location
binding; approved package/runtime/configuration identities; and transition state.
The physical ledger/root identity captured after creation is then bound during
activation, not guessed before creation. Paths alone are not identity.

Proposed states: `prepared`, `active`, `retired`. Prepared and retired entries
both reserve their identities permanently. Expiry does not delete or free them.
An exact duplicate request is an observation of the same recorded state, not a
second consumption or permission to repeat physical creation. A conflicting
request, a second store/domain for the namespace, or reuse of its enrollment
authorization must deny inside the anchor transaction. Retired cannot reactivate.
No new namespace may evade spent approvals, quarantines or capacity accounting.

The active record also holds the current authenticated owner epoch and head.
Owner changes do not replace genesis or historical row generations. Old-owner
fencing, A/B settlement and one-ahead reconciliation retain their existing gates.
Installation authorization is distinct from task execution/publication approvals.

## 4. Creation order and acknowledgment loss

1. **Inspect and stage, without admission.** Verify independently pinned package
   bytes and compatibility; retain a create-only inactive stage. Establish the
   approved protected parent and anchor peer, capacity and maintenance scope.
   No task source import, provider call, guest launch or runtime auto-start.
2. **Prepare at the anchor first.** In one short durable transaction reserve the
   exact request/identities and genesis, with no physical filesystem callback in
   the transaction. Require exact read-back before proceeding. This ordering
   ensures subsequent ledger creation has a prior independently held intent.
3. **Create the ledger once.** Under the still-valid installer authorization and
   retained exclusive physical custody, create a new ledger at the prepared
   target, initialize exact metadata and empty history/genesis, and obtain full
   read-back and physical identity. This is not v2 adoption or migration. Never
   fill in an existing partial store, rewrite its ACL or import arbitrary bytes.
4. **Activate at the anchor.** Independently verify the prepared request, current
   physical custody, exact empty ledger/genesis, complete validation and active
   maintenance authority. CAS `prepared` to `active`, binding physical identity
   and approved runtime configuration in one anchor transaction. The activation
   API must not accept an unauthenticated caller's `verified: true` assertion.
5. **Confirm, then acquire separately.** Fresh authenticated discovery must report
   the exact active tuple. A local installed/version marker is a convenience,
   never authority. Normal coordinator admission still needs current custody,
   owner fencing, full joined replay, policy and task-specific approval. The
   installer completing is not permission to perform a task.

No transaction spans another store, pipe contact, filesystem effect or await.
No claim of atomicity across these steps, or power-loss durability from read-back.
Reserve measured capacity and deadline for the entire maintenance path, including
safe termination/recording. Numeric limits and actual flush/stop evidence remain
unselected release inputs; elapsed timeout is not cancellation confirmation.

After any lost response, stop forward work. Query exact authenticated state under
a new bounded diagnostic/recovery request; never repeat a creation call blindly.
Historical request IDs, cached receipts and expired maintenance authorization
permit no new mutation. If continuation needs a fresh maintenance grant, it must
bind the existing request, exact current state and allowed remaining step. It
cannot replace identities, adopt a different file or grant a task effect.

## 5. Crash-cut acceptance matrix — every case NOT RUN

Each case needs an authorized positive control, exact physical identities,
before/after state and counters for actual creation, activation and task contact.
Exercise process loss and separately actual Windows restart/storage faults;
one does not prove the other. No creation/activation tests are authorized here.

| Cut / independently observed state | Required recovery and falsifier |
| --- | --- |
| E01: staged files, no prepared anchor entry | No admission. No inference of a fresh install from anchor absence. A separately authenticated fresh-install decision is required; stage is not adopted as authoritative state. |
| E02: prepare response lost; anchor says prepared | Same request remains reserved. Read-only discovery first; no second prepare consumption or new request ID. |
| E03: prepared; target absent after installer loss | Remain non-admitted. Missing target is not proof creation never occurred. Only a reviewed, freshly authorized recovery with prior-owner fencing may create it; no ordinary startup retry. |
| E04: prepared; incomplete root/registration/ledger | Preserve and deny. No repair, fill-in, deletion or reseeding. Existing root-registration code already refuses partial continuation. |
| E05: prepared; exact complete empty ledger, lost creation response | Separately scoped recovery can consider activation only after fresh physical custody, matching request/genesis and complete validation. No second ledger creation. |
| E06: prepared; ledger contains any operation/history beyond genesis | Deny activation. No task was admissible while prepared, even if supplied history is internally coherent. |
| E07: activation commit/response uncertain | Fresh anchor discovery; exact active tuple needs no second mutation. Prepared state requires the explicit E05 recovery, not a timeout-driven repeat. |
| E08: active; local installed marker missing/stale | Marker cannot block observation of real active state or trigger reenrollment. Reconstruct only non-authoritative UI/install metadata under authorized maintenance; never reset ledger/head. |
| E09: active; missing, old, altered or relocated ledger | Block coordinator admission. Do not recreate it from empty genesis or from anchor digests. Restore/reconciliation needs its separate reviewed continuity protocol. |
| E10: concurrent installers / request replay with changed package, target or IDs | One exact anchor reservation; loser denies. A renamed directory or new request ID cannot acquire a second active store. |
| E11: maintenance expires, old callback returns, or installer stop unconfirmed | No activation or new creation from stale work. Preserve uncertainty and block replacement until exact old activity is fenced. |
| E12: anchor unavailable, corrupt or missing its enrollment | Deny, not local-fallback trust, service recreation or automatic genesis. Already running owners cannot infer continued admission. |
| E13: retired enrollment and old valid active receipt | Fresh retired state wins; no resurrection, task approval reuse or active-store fallback. |
| E14: capacity/full disk during prepare/create/activate | No success inferred from failed/unknown commit. Existing reserved identities remain reserved; error recovery cannot rotate an empty namespace. |

For E03, a separately reviewed recovery may instead permanently retire the
prepared record after proving no live activity. That does not authorize deleting
an orphan or recycling identities. No abandonment/reset/cleanup implementation is
introduced; a user-visible diagnosis must distinguish reserved from active.

## 6. Upgrade, rollback, uninstall and retention obligations

Binary versions and authoritative state are separate. Supported upgrades stage
and verify new bytes, quiesce/fence the old runtime, check compatibility against
the exact active enrollment/head and then switch under explicit maintenance.
Do not include ledger/anchor snapshots in a binary rollback package. An older
runtime that cannot understand current state must refuse to start, not migrate
backward, silently reset, or use a private copy of yesterday's database.

Uninstall must stop and confirm all relevant activity and preserve authoritative
state by default. Removal of binaries does not unspend approvals or clear workspace
quarantine. A separately authorized retirement retains the anchor identity and
continuity record; reinstall cannot silently create a new active namespace.
Cleanup of a partial stage is distinct from cleanup of authoritative state and
requires exact target validation and separate applicable authority.

There is no archival/compaction design here. The existing 1000-operation lifetime
cap is still a release blocker for ongoing use. Receipt JSONL rotation is unrelated
and must NEVER be applied to ledger/anchor/spent-approval state. Before activation,
select and review a capacity-extension/retention protocol preserving namespace-wide
spent identities, complete required history, publication parents, quarantines and
anchor continuity. Creating another store is not that remedy.

## 7. Review and implementation boundary

This specifies anchor-first enrollment preparation and exact crash recovery as a
candidate. It does not choose actual service identities, RPC authentication,
descriptors, key lifecycle, anchor bootstrapping, schema or atomic activation
primitive. Those remain physical-design and independent-review inputs together
with this matrix. Do not launch a second unrelated audit just for this document;
include it when the physical installation/enrollment boundary is ready for review.

Local review: compared the existing root registration/provisioning, static-stage
and v3 data APIs with the proposed sequence. No native code, subject tests,
installer, service, VM, provider, approval or OS change was executed. Documentation
checks are not E01-E14 results. The frozen incremental packet at 82c8664 remains
unchanged and its report has not been received at this checkpoint.

Local verification: whitespace check passed; source-pattern scan passed over
1204 files (a bounded pattern check, not exhaustive secret detection). Separate
read-only hashing matched the frozen incremental manifest's 4507-byte external
pin and all 41 listed members. No subject tests were rerun for this docs-only
change. The private repository's sole workflow was observed disabled_manually
before synchronization; no Actions run or public packet publication was requested.
