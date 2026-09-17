# V3 incremental validation — equivalence and invalidation design

2026-09-16. Conditionally reviewed at 16cb32e4; corrected design requires delta
review. Bootstrap extraction added to the pure reference; incremental candidate
state/persistence acceptance remains open. A separate pure transcript validator
now exists; see V3_INCREMENTAL_IMPLEMENTATION for its exact non-authorizing scope,
generated matrix and limitations. It does not implement physical S promotion.
Source inspected at `c657ced2dcbe834823f9f41bb59066fd6753a9b4`.
No real store, anchor, consumer, owner authority or effect is implemented here.
This refines V3_PERSISTENCE_DESIGN_DRAFT after the 18.7–19.0-second dense replay
measurements. The existing full-history validator remains the reference.

## 1. Selected proposal, not acceptance

Full replay on owner acquisition/recovery; thereafter validate one exact append
against private retained validated state. Recompute and validate the COMPLETE
current inventory on every append. Do not use remembered IDs, a list of blocked
rows, an unverified root cache, a new Merkle format or a task-supplied receipt.
The optimization removes repeated traversal of already-proven checkpoint prefixes,
not complete current-state checking or authenticated freshness checks.

Keep canonical v3 records, roots and checkpoints unchanged. Work per append is
O(N) record/tuple validation plus sorting, not O(C*N) repeated checkpoint replay.
The hash of the full tuple inventory is still recomputed. Actual timing, IPC,
SQLite and supervision budgets remain to be measured; this is not an O(1) claim.

## 2. Private logical state and bootstrap

State S contains exact metadata and enrolled domain; the authenticated enrollment
identity/genesis binding; current fenced owner epoch; last confirmed anchor head;
all complete parsed records and their immutable settlement cores; per-operation
historically observed outcome-checkpoint digest A; historical global lastAt; and
a one-way invalidation latch. This state is held only inside the protected owner.
No serialized state, caller object, UI flag or bearer receipt may initialize it.

Bootstrap requires a complete consistent inventory and full retained checkpoint
stream, checked by the existing full-history reference, plus authenticated fresh
enrollment/head and actual physical custody. Selected extraction: extend the
reference return surface with lastAt and a deeply frozen plain object
outcomeCheckpointByOperation (operation ID -> exact historical A digest), populated
inside its existing validated traversal. Do not use a second independently
implemented traversal or a returned mutable Map. Capture A even when the row's
transport did not supply it yet; lastAt is empty only at genesis. No canonical
wire or parser acceptance rule changes. Test every nonempty prefix then continued
appends against a genesis-booted model before accepting the incremental module.
Check all input identities
again against fresh protected state after worker settlement. Missing/uncertain
bootstrap remains non-admitted; no empty-state fallback or resumption from a JSON
cache is allowed. The historical sketch below implements genesis only, not this bootstrap.

An outcome-checkpoint digest observed in an untrusted stream is still just data.
Authentication and fresh-current-owner checks remain independently required. A
correct incremental state cannot convert forged-but-consistent history into truth.

## 3. One append, checked before candidate state replacement

1. Call the complete checkpoint snapshot join ONCE. It already runs the inventory
   parser: all row histories, exact metadata, digests, immutable settlement joins,
   independent operation/approval/workflow uniqueness, current blocked-workspace
   exclusion and released/passed publication parentage, plus the checkpoint join.
   Do not parse the complete inventory a second time in this step.
2. Require checkpoint.sequence == S.head.sequence + 1 and previousCheckpointDigest
   == S.head.checkpointDigest. No duplicate, skip, bulk append, missing row or row
   deletion. Match the exact subject/producer/eventIndex/root/count to the supplied
   inventory; the snapshot parser already enforces these data relations.
3. Compare ALL prior rows, not only the checkpoint subject. Exactly one record is
   different: either a new reservation with zero events, or the existing subject
   with exactly one appended event. For an existing subject, canonical bytes of
   the new record with its last event removed must equal the entire old record.
   This pins intent, approval identity, reservedAt and every previous event.
4. On reservation, check workspace exclusion against S BEFORE introducing the row.
   For publication, its parent must already be released in S, not merely present
   as released in the proposed post-state. This preserves historical ordering
   even when event timestamps are equal. A release must belong to the same
   previously blocking operation; full record replay and predecessor equality
   do not allow release from an absent/released/quarantined state.
5. The new reservation/event timestamp must be >= S.lastAt. Per-record monotonicity
   is insufficient because interleaved operations share one checkpoint stream.
6. On a blocking outcome event, capture that exact checkpoint as the row's unique
   expected A. On later release or quarantine, keep it. Every supplied A must match
   the captured digest and pass the existing record/checkpoint joins. A cannot be
   reconstructed merely from the latest root or accepted because it self-hashes.
7. Preserve previously bound settlement core bytes. A row without an outcome has
   no core; the first outcome supplies its core and binds its digest in the event.
   Later attachment of the already-observed exact A is allowed; it is not a second
   ledger event, new approval or new outcome. Missing A is allowed only where the
   existing record grammar permits it; release still requires A. Do not silently
   replace a core or accept a substituted late A for an otherwise unchanged row.
   Every previously bound core AND supplied A must remain present and byte-exact
   in S', including on unchanged rows. Context disappearance invalidates. This is
   intentionally stricter than stateless full replay, which accepts optional A
   omission on unreleased rows; differential tests must label that exception.
8. Compute a candidate successor S' separately. Until the durable ledger commit,
   exact read-back and authenticated anchor append/discovery are confirmed, S'
   is NOT the owner's confirmed state. Atomically replace private S only after
   the required pair has settled under the same owner/deadline/custody. If any
   result is unknown, invalidate; do not return to S and continue as though the
   ledger mutation never happened.

The pure transcript factory advances to S' immediately when append succeeds; it
is not the owner's confirmed S. Capture its snapshot BEFORE append for the
transactional full pre-state recheck. There is no rewind: even a clean pre-write
rejection invalidates the transcript and requires a new complete bootstrap, as
does rejected/malformed read-back. Account for that cost without reusing cached S
or treating rejection as proof that no other actor changed durable state.

An exact no-mutation diagnostic replay is outside this append API. It cannot
advance sequence, refresh evidence, redispatch a task or create permission.
Reconciliation of an uncertain pair still follows the separately reviewed one-
attempt protocol with a new fenced owner; it is not an incremental retry loop.

## 4. Induction argument and limits

Base case: a fully replayed history provides the same head, full row set, lastAt,
workspace lifetimes and historical A identities as the reference traversal.
This assumes actual successful complete replay, not a caller assertion.

Inductive step: exact one-record extension preserves every old prefix and all
prior checkpoints. Complete post-inventory validation preserves row-internal and
cross-row invariants. Sequence/previous-head/subject checks identify precisely
one next checkpoint. Old-state workspace and publication checks reproduce the
reference's reservation-time checks; lastAt reproduces global time ordering.
Complete root recomputation reproduces the reference's next inventory root.
Captured A enforces the reference's historical-A equality even if supplied late.
Thus an accepted append extends the same reference-valid history, subject to
the stated canonical-byte and collision-resistance assumptions.

The reverse direction applies only to an unchanged-schema reference-valid history
presented one append at a time with the required available contexts and without
owner invalidation. It is not a promise to accept arbitrary snapshot replacement,
unknown commits, whole-history rewrite, missing early context or owner migration.
Context A can arrive after its checkpoint; the step checker must not incorrectly
require a release's A to have been supplied with its earlier outcome transport.

This is a review argument, NOT formal proof or authentication. The shared parsers
could contain a common defect. Test-only agreement cannot prove private-memory,
physical-store, clock, worker, policy or anchor behavior. Those need independent
review and executed physical evidence before consumer admission.

## 5. Invalidation and continuity

| Event | Required action |
| --- | --- |
| Current anchor head/epoch/enrollment differs from confirmed S | Invalidate; full fresh discovery/replay after permitted ownership recovery |
| Ledger identity/schema/content drifts before transaction commit | Invalidate; no compensation or effect |
| Commit, append, worker response or stop outcome uncertain | Invalidate globally for forward work; retain physical fence |
| Deadline, consent or policy revision fails | Deny new effects; preserve actual contact accounting and required bounded cleanup; no stale-S reuse |
| Owner/worker/process restart, disconnect or unexpected response | No serialized-S restore; fresh fenced-owner bootstrap required |
| Incremental parser mismatch, invalid A, row deletion or skipped sequence | One-way invalidation, not a per-request recoverable validation error |
| Historical producer epoch differs from new reconciliation envelope | Preserve immutable historical bytes; only the reviewed anchor delegation may authorize reconciliation |

Historical producerGeneration means the subject operation generation after
genesis, not the rotating coordinator epoch (PERSISTENCE_DESIGN_DRAFT section 3).
Pure state has no ability to authenticate an envelope or authorize owner rotation.
The generation matrix tests retained historical bytes and denies relabeling; real
owner delegation/fencing tests remain a separate physical gate.

A deadline failure invalidates S even before a commit; fresh full bootstrap is
required and can cost the observed roughly 19 seconds at capacity. No cheaper
reuse is inferred from a no-write guess. After a ledger commit, a policy/consent
failure alone does not suppress witnessing those committed bytes, but settlement
may proceed ONLY under still-valid reserved settlement authority, authenticated
owner custody and deadline/budget. Otherwise retain one-ahead/unknown state for
explicit reconciliation; do not promote or continue effects.

No old or prospective S may escape as an application token. The complete database
pre-state must be rechecked INSIDE each short transaction against the retained
validated pre-state, with current ownership independently held. Checking only
row count or sequence leaves rehashed replacement attacks. A same-user writable
database/anchor defeats the assumed boundary; this design does not fix that.

## 6. Executed, bounded test-only sketch

Local helper `.audit-preparation/check-v3-incremental-design.mjs` imports the
existing compiled pure parsers and fixture. It constructs three synthetic rows:
successful execution, its separately approved publication, and an unrelated
cancelled operation interleaved between checkpoints. It gives A to the snapshot
only at release, while the sketch retains the earlier actual checkpoint.

Observed: 13 valid prefixes agree with the full-history reference. Thirteen
previous-head substitutions are rejected by both, as is one substituted late A
whose rehashed current inventory AND current checkpoint snapshot pass on their
own. One skipped two-event update also invalidates the sketch. All 15 negative
cases leave the sketch closed to another append. Exit 0; no task/OS effects.

The sketch is ordinary mutable test code, not a protected implementation. It has
no nonempty bootstrap, epoch/anchor authentication, actual IPC/persistence,
cancellation, commit-uncertainty protocol or performance claim. It reuses the
reference's row/snapshot parsers and is not an independent audit. These small
cases corroborate the proposed invariants, not full equivalence.

Helper SHA-256: `6f8d44cee0dc3b89041dcd081cf4831c95740ba6d510ed09f095c7377d544c6a`.
Raw result: desktop `.audit-preparation/v3-incremental-design-experiment-20260916.json`.
Exact retained copy: `docs/reports/v3-resource-20260916/v3-incremental-design-experiment-20260916.json`.
Raw-result SHA-256: `c1eb9f5c71d437e821d17e9a00f4d38722313bd6d852c06643985d279b029c4e`.
Final synthetic head: `sha256:44b71ec770c8e55e139fe06b334a504beae46370dc53e554f58334e5b62cfb8d`.

Review limitation N-B/N-C: this historical receipt omits runtime/revision and
source/compiled identities; 13 negatives repeat one previous-head guard and the
skip case fails before the two-event guard. Preserve it, but do not use 13/15 as
bound equivalence evidence. A new create-only identified run and independently
targeted typed-error matrix must supersede it; neither count closes this gate.

## 7. Remaining review/execution gate

Before product implementation, independently review the induction/context rules
and physical assumptions together with the v3 report and resource measurements.
Require generated differential sequences for all outcomes and interleavings,
nonempty bootstrap with missing-then-attached A, adversarial context changes,
row corruption/deletion, pending pair promotion, unknown commit, owner rotation,
delayed replies and invalidation at every asynchronous seam. Measure full
bootstrap and incremental steps at capacity, including complete DB read-back.

This design supplies none of the absent anchor, enrollment, protected filesystem,
fencing, issuer, installer, retention or independent Windows execution evidence.
B-03 and W1-W5 remain open. Do not activate persistence from this document.
