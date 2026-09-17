# V3 coordinator: staged claims and confirmed durable pairs

2026-09-16. DESIGN FOR REVIEW ONLY. No coordinator, worker, persistence adapter,
anchor, owner authentication or effect consumer is implemented by this document.
Source baseline `907f8962e92309675449bdc8d5a29e9bcb062089` plus separately identified
pairwise test additions. Read with V3_PERSISTENCE_DESIGN_DRAFT,
V3_INCREMENTAL_VALIDATION_DESIGN and WINDOWS_ENROLLMENT_RECOVERY_DESIGN.

## 1. Scope of the proposed composition

The reviewed pure validator checks caller-supplied historical claims. This design
specifies where those checks would fit in a single-owner durable append without
equating consistency, a promise settling, a local released flag or a checkpoint
hash with real admission. No public commit/confirm method is added to the pure
factory. Existing canonical records/checkpoints, A/B ordering and historical row
generations remain unchanged.

The same reviewer requested this design and N-1/N-2 regressions together, not a
sequence of new approvals for individual tests. Its missing physical assumptions
must be challenged in that next narrow review, not assumed from synthetic ports.
Unresolved protected hosting, enrollment, independent anchor/owner authentication,
fencing, capacity/retention and actual implementation are release blockers.

## 2. State owned privately by one coordinator lifetime

- **S (confirmed state):** exact enrolled metadata, current authenticated owner
  epoch and observed anchor head, complete validated inventory/history identities,
  root/count/lastAt and historical A dictionary. Bootstrap requires full replay
  of a fresh consistent protected snapshot and authenticated joined discovery.
- **T (pure transcript):** one private createCandidateV3IncrementalClaims instance
  with no externally callable methods. It is a consistency cache, not the owner
  or a durable fence. The coordinator is responsible for invalidating it.
- **C (one staged candidate):** immutable copied complete post-inventory, exactly
  one checkpoint/event change, its expected old-state identity, the exact proposed
  new-state identity and the bounded request/phase accounting. At most one exists.
- **F (physical fence/session):** separately established protection of the exact
  ledger, executable/worker, current coordinator and all relevant task contacts.
  This is not an injected boolean or a UUID. Loss/uncertainty closes forward work.

Root and count alone are insufficient for transaction comparison. Bind the exact
canonical metadata, complete persisted inventory representation INCLUDING retained
settlement/A context, and complete checkpoint-history identity as well as head.
The proposed adapter must define a deterministic snapshot encoding; optional
context appearing/disappearing during that interval is drift, even if a record-only
root stays equal. Maintain private snapshot bytes/digests from bootstrap/confirmed
read-back; do not rely on snapshot() exposing the complete inventory (it does not).
No new canonical ledger wire or cryptographic authority is defined by these private
comparison identities. Hash equality assumes collision resistance and protected
source custody; coherent forged storage still requires the independent anchor.

The proposed validation worker is persistent for one coordinator lifetime so it
can retain T. Successful REQUEST settlement is distinct from PROCESS termination:
the fixed pinned worker must finish that bounded validation request with no
outstanding callbacks/child work before accepting another request. It stays alive;
its reply is not a claim that its process exited. Custody and quiescence need a
reviewed fixed protocol and physical tests, not a task-provided settled flag.
On timeout, poison, worker replacement or shutdown, separately confirm termination
of all relevant worker activity before admitting a replacement; then bootstrap
again. Killing/restarting a worker on every successful append would lose T and
cannot retain the claimed incremental composition or its measured cost.

## 3. Lifecycle and forbidden shortcuts

| Phase | Permitted next action | What remains prohibited |
| --- | --- | --- |
| Uninitialized | Fresh ownership/discovery/full bootstrap | Caller-supplied S, empty fallback, task contact |
| Ready(S) | Capture S and stage one authorized candidate | Concurrent mutation queue or a second T owner |
| Staged(S,C), T already advanced | Transactional complete pre-state recheck and exact proposed write | Calling snapshot() to recover old S; returning readiness for C |
| Ledger committed, read-back exact | One authenticated bounded anchor append | Effect from commit receipt alone; another ledger mutation |
| Pair confirmed | Promote C as S only while required authority/custody is still valid | Treat historical success as new task approval |
| Closed/uncertain | Bounded diagnostics and separately authorized reconciliation | Rewind T, retry effect, compensating terminal, new instance to clear uncertainty |

There is no queue of future candidates and no concurrent append to T. Public
clients cannot submit an expected root/head or choose an alternate namespace to
override the private coordinator state. Proposed request sizes, total memory,
queue/connection and deadline ceilings must be selected before implementing this
host; parser caps do not constitute total-process limits.

## 4. One append from Ready(S)

1. Hold F and store-wide singleflight. Check live phase-specific authorization,
   policy, monotonic deadline and budget, plus fresh authenticated enrollment,
   current epoch and head. No new effect is inferred from these metadata checks.
2. Capture T.snapshot() and the private complete S identities BEFORE append. Bind
   the candidate request to this exact S. Construct C from private bounded bytes,
   not from mutable caller objects, getters, callbacks or shared buffers.
3. Evaluate T.append(C.inventory, C.checkpoint) off the dashboard event loop in the
   proposed protected validation worker. The request/response must bind its nonce,
   input identities, owner epoch, expected pre-head and deadline. Exactly one
   request may be in flight; late/mismatched replies deny. If the worker retains T,
   its snapshot must be obtained before that append, not reconstructed afterward.
   Child response alone does not establish worker/descendant settlement or custody.
4. After confirmed work settlement, verify the result and live owner/head/custody
   and remaining authority/budget again. T now describes C, while authoritative S
   remains old. Worker/process replacement forces full bootstrap, never import of
   a serialized T summary or undocumented automatic replay.
5. Enter a short synchronous ledger write transaction. Recheck schema, durability
   policy, physical store identity and the COMPLETE pre-state identities against
   captured S under its transaction snapshot. Independent uniqueness/row checks
   remain required. Drift, added contexts, deletion, replacement or changed history
   deny before any write. Do not merely compare row count, final sequence or the
   checkpoint subject. Do not call worker, anchor, consent or task callbacks here.
6. Apply only C's exact single change/checkpoint. Construct and validate the exact
   post-state and compare to C inside the transaction, then commit. After commit,
   obtain a fresh complete read-back in a separate bounded read transaction and
   require exact C identity. The method must distinguish a known no-write rejection
   from commit-unconfirmed; neither permits continued use of advanced T.
7. Outside all ledger transactions append precisely C.checkpoint to the anchor,
   with the authenticated current epoch and S.head as compare-and-append expected
   predecessor. Record the attempt before contact. Require authenticated exact
   acknowledgment/read-back of the requested payload/sequence/enrollment, with
   current request/deadline binding; a digest-shaped string or old receipt is not
   confirmation. The concrete anchor protocol and persistence remain unimplemented.
8. Promote privately to S' only after exact ledger read-back, confirmed append
   and the required owner/fence/deadline/settlement checks all hold. Transfer C's
   complete inventory/history identities and the validated summary together; drop
   staged bytes no longer needed. Release singleflight only into Ready or Closed,
   never a half-promoted state. No part of S/S' is a bearer capability.

Atomic private assignment is not distributed atomicity. Physical F and the future
adapter must make concurrent/untrusted alteration impossible while the transaction
checks are used; an optimistic hash followed by an uncontrolled write is inadequate.
Policy/consent checks likewise do not prove an unchanged policy across asynchronous
work. Any future effect independently requires current authority immediately at
its actual boundary; recording a marker is necessary bookkeeping, not permission.

## 5. Denial, cancellation and lost responses

Every rejection after staging invalidates T and closes this owner for forward
work, including a clean transaction conflict before writing. T has no rewind.
Malformed read-back, identity drift, unexpected worker reply or uncertain worker
stop are not recoverable per-request errors. A fresh instance is not a safe reset;
re-entry requires independently established custody/fencing plus full bootstrap
from current protected state and authenticated anchor discovery.

After ledger commit, a later policy/consent revocation prohibits new effects but
does not necessarily prohibit witnessing the already committed exact payload.
Only pre-reserved, still-valid bounded settlement authority, current authenticated
owner/custody and the original overall budget may permit that append. Do not reset
the timer or extend authority because cleanup is inconvenient. If any condition
fails, do not append/promote: retain the physical fence and one-ahead/unknown state
for the separately authorized fresh-owner reconciliation protocol. Do not erase
history, invent a failure/success outcome or report that no task effect occurred.

If acknowledgment is lost after a real append, no automatic repeat or new candidate
is allowed. Exact fresh discovery and the existing one-attempt reconciliation gate
decide what is already durable. An exact historical checkpoint still uses its row's
immutable generation; current-owner epoch belongs to the authenticated envelope.
Old-row forward effects remain prohibited. Owner CAS alone does not stop old code.

The outcome -> A -> released -> B chain uses these same pair rules at each step.
Local release without confirmed fresh B cannot unblock workspace admission. A
closed coordinator may retain redacted diagnostic facts without asserting task
success, storage absence or safe process termination. Detailed raw errors/paths,
source, credentials and serialized rejected inputs do not leave the boundary.

## 6. Required composition controls — NOT RUN

| ID | Falsifiable test of the actual future composition |
| --- | --- |
| C01 | T advances to C but transaction rejects pre-write drift; next valid request still denies until fresh complete bootstrap, with zero effect calls. |
| C02 | Change an unrelated record, context A, metadata or history between capture and transaction while preserving count; each change denies before write. |
| C03 | Return a valid-shaped result for another request/epoch/pre-head; deny without commit/anchor/effect contact. |
| C04 | Mutate caller input after capture; persisted bytes must be exactly the privately staged candidate, or deny before contact. |
| C05 | Fail before commit, after durable commit/before response, during read-back and after anchor commit/before response; each cut yields the proper observed/unknown state, never compensation or repeat. |
| C06 | Delay worker settlement or anchor reply past deadline; no promotion/new effect even if a late reply says success. Unsettled physical activity keeps replacement blocked. |
| C07 | Revoke policy after ledger commit with valid reserved settlement authority, then separately expire that authority; only the first may witness the exact commit, neither permits a new effect. |
| C08 | Restart coordinator/worker between each phase; no serialized-S import, automatic redispatch or bypass of current enrollment/head/fence discovery. |
| C09 | Two clients race the same store; one bounded owner, loser rejects rather than creating a second candidate, transaction or unbounded queue. |
| C10 | Ledger and anchor disagree in every allowed/forbidden direction; only exact reviewed one-ahead recovery can be considered, and it never performs a task. |
| C11 | Corrupt or lose acknowledgment between outcome/A/release/B; workspace stays unavailable until the exact required pair is confirmed. |
| C12 | At maximum history, enforce measured end-to-end allocation/deadline/stop bounds while dashboard cancellation remains responsive; do not substitute parser timing alone. |

Pure predicate tests cannot close C01-C12. Start with a separately reviewed dormant
composition and fault harness only after review of this design, and require real
physical evidence before consumer admission. Installation recovery, owner rotation,
retention and independent execution remain separate open requirements, not optional
follow-ups hidden by a green synthetic matrix. Whole-PC rollback scope is still
awaiting the operator decision; no exclusion is selected here.
