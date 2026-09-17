# V3 persistence and supervised replay — design draft

2026-09-16. DESIGN ONLY; revised after conditional static review of 16cb32e4.
These corrections need delta review. NO PHYSICAL IMPLEMENTATION OR ACTIVATION.
Inputs: CONTRACT_V3; the local Claude implementation review of f256ad29;
V3_IMPLEMENTATION_REVIEW_DISPOSITION; V3_HISTORY_CAPACITY.
This selects a reviewable logical composition, not a new trusted Windows backend.
No real database, service, key, enrollment, approval, task or VM is created here.

## 1. Objective and unchanged requirements

Connect the data-only v3 validators to durable, restart-safe operation history
without permitting rollback, deletion, stale ownership or a local released flag
to authorize new work. Preserve complete records, stable cross-version approval
identity, workspace exclusion, publication parentage and every intermediate root.
Keep the dashboard responsive without weakening validation to recent/known IDs.

There is no concurrent v2/v3 enrollment, adoption of existing arbitrary stores,
pruning, automatic repair, silent capacity reset or v2 migration in this design.
Exactly one active domain/store is enrolled per namespace. The 1000-operation cap
still exhausts; a usable retention/version-continuity design remains a release
requirement, not an operator instruction to delete the book and start again.

An ordinary task identity must not write the ledger/WAL/SHM, anchor, enrollment,
keys, protected runtime or supervisor configuration. A keyed ledger digest alone
cannot detect rollback of both ledger and key-consistent history. Two files under
the same rewritable authority do not create an independent anchor. The physical
Windows identities, custody, anti-rollback root and enforcement must be separately
reviewed and demonstrated; this document does not narrow those obligations.

## 2. Proposed component ownership

| Component | Responsibility | Explicitly cannot establish |
| --- | --- | --- |
| Dashboard | Paired operator input and redacted progress/receipts | Admission from a row, cached result or UI flag |
| Enrolled coordinator | Own the serialized operation and physical session; enforce authorization/policy/deadlines and exact persistence pairs | Honest storage/anchor from injected lookalike ports |
| Private ledger adapter | Short synchronous SQLite transactions; exact metadata/schema checks and consistent complete snapshots | Freshness, ownership or permission on its own |
| Supervised replay worker | Evaluate the existing complete data checks away from the dashboard event loop | Anchor authentication, actual process settlement or operator consent |
| Independent anchor authority | Authenticated enrollment/epoch/head discovery and conditional durable append | Correct filesystem/task effects from a producer hash |
| Physical supervisor | Keep the old owner/task generation fenced, observe termination and retain custody | Completion merely from timeout or root-process exit |

These are logical roles. Do not export the private ledger as an alternate API to
UI/task code. The worker is a pinned trusted verifier of metadata, not an arbitrary
command sandbox. Selecting a process boundary does not by itself protect its
executable, IPC, memory, children or storage. Reuse reviewed lifecycle primitives
only after their deployment assumptions and physical gaps are resolved.

## 3. Genesis and enrollment decision (review N-07)

Genesis producerGeneration means the first enrolled coordinator epoch,
not an arbitrary current-owner UUID and not a value regenerated on every restart.
An explicit enrollment transaction in the anchor authority binds installationId,
namespaceId, storeId, ledger domain, immutable genesis checkpoint digest, initial
producerGeneration and the version-independent spent-approval commitment. The
genesis itself remains the current canonical empty-inventory checkpoint format.

For sequence >= 1, producerGeneration instead means the subject operation's
immutable intent.ownerGeneration, not the epoch of whichever coordinator writes
the checkpoint. This historical wire name is retained for compatibility. The
record/snapshot/history equality is unchanged. The authenticated request envelope
carries the distinct current coordinator epoch; it is not a field added to the
historical checkpoint, record, settlement core or their digests.

A replacement owner may NOT continue old-generation forward task effects. A
future separately reviewed recovery protocol may permit bounded stop/quarantine/
settlement bookkeeping for an old row, with its original historical generation,
only after the anchor authenticates the new current epoch, the exact enrolled
store and predecessor/payload, a scoped recovery authorization, and independent
physical fencing/settlement evidence for the old owner. New success evidence may
not be invented from timeout or stale callbacks; release still requires the full
settlement evidence and A/B protocol. These are necessary design requirements,
not an implemented delegation API or authority conferred by the pure parsers.
Until that protocol is independently reviewed and implemented, old in-flight rows
remain blocked. A pure fixture retaining G1 under a hypothetical G2 envelope
establishes only historical-data compatibility, never permission to recover.

Distinguish a newly authorized recovery transition from exact one-ahead
reconciliation: the latter repeats only the already committed checkpoint payload
under a fresh envelope, without a new event, relabeling or redispatch. The anchor
must enforce expected-head CAS, current-epoch authentication and exact-payload
idempotency for that separately authorized one-attempt protocol.

The data parser continues to accept shape-consistent genesis claims. The future
coordinator must compare the exact genesis digest to the authenticated enrollment
entry before accepting its stream. Owner rotation advances the authority's current
epoch, preserves genesis/head and historical producer generations, and requires
physical fencing before a new owner is admitted. Missing enrollment is never a
reason to create an empty genesis or implicitly initialize a second namespace.

Enrollment and initial-ledger creation are not cross-store atomic. Interrupted
creation stays non-admitted. A creation/recovery protocol and its crash cuts must
be reviewed before any enrollment implementation, including which side exists
first and how an operator distinguishes an uninitialized install from rollback.
Proposed concrete ordering and fourteen unexecuted crash controls are now in
`ONOES_AGENT_WINDOWS_ENROLLMENT_RECOVERY_DESIGN.md`: anchor preparation precedes
create-only ledger initialization; activation requires fresh complete read-back.
This is unreviewed design input, not an implemented enrollment or recovery API.

## 4. Durable pair protocol and resource placement

Refinement under review: `ONOES_AGENT_V3_INCREMENTAL_VALIDATION_DESIGN.md` proposes
one complete bootstrap/recovery replay and private one-append validation thereafter.
Its context-A, complete-inventory, promotion and invalidation rules are mandatory
review inputs. The full replay in step 2 below remains the reference fallback,
not the selected every-phase production latency path. No physical implementation.
The pure transcript append predicate now exists separately; see
V3_INCREMENTAL_IMPLEMENTATION. It is not authoritative S promotion or persistence.
The next review's concrete staged/confirmed-state composition is specified in
`ONOES_AGENT_V3_COORDINATOR_PAIR_DESIGN.md`, including capture before T advances,
complete in-transaction pre-state identity, post-commit read-back and failure cuts.
It is design only; no store/worker/anchor implementation is admitted by that draft.

Keep the reviewed ledger-then-anchor ordering. Do not hold BEGIN IMMEDIATE across
worker execution, anchor communication, operator waiting, callbacks or awaits.

1. Acquire one enrolled physical owner and the store-wide singleflight boundary;
   reject concurrent work instead of accumulating an unbounded queue. Authenticate
   fresh enrollment/epoch/head; take one complete consistent ledger snapshot with
   metadata/schema checked inside that transaction, then end the transaction.
2. Under the still-held physical owner fence, run complete replay in a supervised
   worker against that immutable snapshot and complete checkpoint stream. Bind the
   request to a fresh correlation nonce, exact input byte digests, metadata, anchor
   head, owner epoch and deadline. Result must echo those bindings over protected
   IPC and include the exact computed head/root/count. No reusable admission object
   is returned to an application caller. Shape and hashes alone are not IPC trust.
3. After actual worker settlement, recheck deadline, policy/consent, owner custody
   and fresh authenticated anchor head. If anything changed, reject; no effect or
   local write follows. Begin a short write transaction, recheck metadata, complete
   pre-state identity and intended predecessor, append exactly the planned record
   change, validate/read back that post-state, then commit. Cooperative process
   serialization does not excuse in-transaction drift checks.
4. Append exactly that post-commit checkpoint with expected prior head and current
   authenticated epoch. Confirm the exact committed payload and sequence. Unknown
   commit or append outcomes close the owner for forward work. Never compensate
   with an invented terminal record or overwrite the uncertain history.
   A late policy/consent revocation denies new effects, not truthful witnessing of
   the already committed payload: finish that append only within the previously
   reserved settlement authority, authenticated current-owner custody and overall
   deadline/resource budget. Revocation never extends those bounds. If they fail,
   do not append or promote; retain the fence and the explicit one-ahead/unknown
   disposition for separately authorized fresh-owner reconciliation.
5. Before a physical effect, repeat the relevant live authorization, deadline,
   custody and joined-state checks. The reservation receipt and worker result are
   descriptive, not transferable permissions. Outcome -> A -> release -> B uses
   the existing non-circular protocol unchanged; released without confirmed fresh
   B remains non-admitted.

Steps 1–3 are a proposed scheduling location, not a proof that a snapshot remains
valid while replay runs. That proof requires exclusive physical ownership, fresh
anchor comparison and in-transaction pre-state checks. If the selected platform
cannot provide them, this design must fail review rather than omit a check.

Anchor discovery responses must bind the request nonce and the combined enrollment,
current epoch and head in one authenticated observation. Independent stale reads
of these fields cannot be combined. Exact authenticated transport/key custody and
nonce lifetime are pending physical-interface design, not provided by a UUID.

## 5. Replay-cost decision (N-03, N-04)

Follow-up evidence: `ONOES_AGENT_V3_RESOURCE_DESIGN_EVIDENCE.md` now records a
dense 1000-operation/6001-checkpoint workload at about 18.7–19.0 seconds per parse,
62 accepted fixed-shape cases and five malformed input denials. The full-per-pair
reference below is NOT selected for production latency. Next design work must
evaluate one full acquisition/recovery replay plus private incremental append
validation under fresh fenced ownership, with equivalence and cache-invalidation
proofs. The separate pure claim implementation is now described in
V3_INCREMENTAL_IMPLEMENTATION; canonical wire is unchanged. No durable pair or
physical incremental admission is supplied here.

Select supervised FULL replay as the initial reference design; do not substitute
incremental validation, a Merkle format, an unverified cache or a truncated stream
in this patch. Incremental roots would change a load-bearing algorithm and require
their own equivalence/continuity review. The existing canonical wire stays fixed.

The current representative 1000-operation/6001-checkpoint observation took
7414.2215 ms for parsing; total child cost also included 7163.2131 ms of corpus
construction. Peak process RSS including setup was 257540 KiB. This is one sample,
not a maximum hardware-independent budget. It is already too slow for a short
synchronous dashboard request. Async UI scheduling alone cannot preempt hashing.

Before implementation sizing, measure maximum reachable fixed-field variants,
successful and quarantined/interleaved histories, malformed near-cap transports,
duplicate keys/deep JSON, and aggregate canonicalization costs. Measure receive,
parse, validation, serialization and actual child settlement separately and as one
deadline. Include warm/cold runs on the declared minimum Windows machine, record
source/runtime identities and retain raw results. Abort/kill timeout is not proof
of termination; an unsettled worker keeps the coordinator blocked.

Caps are acceptance limits, NOT allocation ceilings: inventory/history each allow
64 MiB of wire; nested caps are record 32768, settlement 8192, checkpoint 4096.
There may be simultaneous strings, parsed objects, zod outputs, prefixes, sorted
tuples and GC-retained intermediates. Do not multiply wire by three and declare
that a heap/process bound. Malformed JSON can consume the cap before shape denial.
V8 old-space limits do not cap total RSS. A production worker needs a measured,
physically enforced resource policy and a separately observed stop boundary.

No measured production replay, pair or anchor budget is selected here. Before any
phase starts, reserve the feasible success/failure path including replay, SQLite,
anchor discovery/append, stop and settlement; one monotonic overall deadline is
not reset by retry, worker replacement or reconciliation. Deny before contact if
the remaining budget is inadequate. Keep success and emergency cleanup distinct.

## 6. Restart, uncertainty and historical truth

| Observed state | Required disposition |
| --- | --- |
| Ledger and authenticated anchor agree; complete replay valid | Necessary evidence only; still require current owner, custody, policy and consent |
| Ledger exactly one intended change ahead; append may be missing | Retain fence; new authenticated owner may use the separately reviewed one-attempt reconciliation protocol; no task redispatch |
| Anchor ahead of ledger | Block; do not materialize rows or infer a rollback repair |
| Missing row/history/genesis; changed store metadata | Block; never treat as empty/free and never auto-enroll |
| Lost append response | Discover exact authenticated state; acknowledgment absence is not append absence |
| Worker exits without response or responds without confirmed stop | No validation success; no mutation/effect; retain uncertainty |
| Old owner callback after replacement | Reject envelope epoch; immutable historical payload identity is not authority for an old owner |
| Released record without matching fresh B | Keep admission blocked despite local released state |

At most one explicitly authorized idempotent reconciliation append for an exact
unresolved payload, with a fresh current-owner envelope. Historical producer bytes
are never relabeled. Record all contact attempts; no hidden retries after response
loss, automatic guest replacement, refunds or additional approval consumption.

## 7. Denial taxonomy decision (N-09)

Preserve CandidateV3DataError's fixed outward message. Do not derive detailed
reasons by inspecting untrusted exception messages or matching raw source text.
The proposed coordinator-only reason set is phase-based and input-free:
`identity-unconfirmed`, `history-invalid`, `anchor-unconfirmed`, `owner-unconfirmed`,
`deadline-exhausted`, `worker-unsettled`, `policy-denied`, `commit-unconfirmed`,
`append-unconfirmed`, `capacity-exhausted`.
Commit uncertainty names the ledger transaction; append uncertainty names the
anchor append/response. Neither category implies an effect did or did not occur.
These are proposed operational categories, not a new wire schema implemented here.

An internal category is available only where the coordinator actually observed
that phase's fact. A generic parser rejection stays `history-invalid`; it does
not identify which row is corrupt or establish tampering. Public pairing/auth
errors keep existing non-oracle responses. Diagnostics contain no raw paths,
source, key material, SQL, provider errors or serialized rejected input. Unknown
outcomes remain unknown even when a user-friendly message is shown.

## 8. Falsifiable design-review gates

Require independent review of this draft, the retained implementation report,
eight added regression controls and unchanged-wire domain refactor. Resource
measurements remain an explicit missing design input, not hidden by test counts.

Before any persistence implementation is admitted, resolve and test:

- Exact Windows storage/anchor identities, executable and IPC custody, key custody,
  task access denial, hard links/aliases/reparse/subprocess cases; no admin/Defender
  workaround assumed. State any excluded full-host rollback threat explicitly.
- Authenticated genesis substitution, fresh-head replay, changed enrollment and
  delayed old-owner requests under actual physical fencing.
- Crash before/after each SQLite commit, anchor append, response and A/B boundary;
  whole-file rollback/deletion with a protected unchanged anchor; uncertain stop.
- Malicious snapshot mutation between replay and commit, metadata drift inside
  the transaction, cross-process contention and no callback inside transactions.
- Real maximum-resource supervision and responsive dashboard cancellation while
  preserving uncertain state; no process-exit-only descendant settlement claim.
- Capacity/retention and install/upgrade/recovery/rollback continuity, spent
  approvals across versions, explicit operator acceptance and W1-W5 evidence.

This document is not the review verdict, a real store implementation, enrollment
permission or a claim that the physical anti-rollback mechanism exists.
