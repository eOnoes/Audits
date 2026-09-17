# V3 physical adapter, ownership and local-tail recovery contract

2026-09-17. DESIGN PROPOSAL FOR REVIEW. No physical adapter, account, service,
database, owner, key, IPC, task or installation is created or authorized here.
Baseline inspected: `e9deceef998373d362b941dcc3bd8d2d9f0c09f7`.
Inputs: V3_COORDINATOR_IMPLEMENTATION_REVIEW_DISPOSITION,
V3_COORDINATOR_PAIR_DESIGN, V3_PERSISTENCE_DESIGN_DRAFT,
V3_WORKER_MESSAGE_DESIGN and WINDOWS_ANCHOR_BACKEND_CANDIDATE.

## 1. Decisions proposed, and the evidence boundary

The current coordinator is retained unchanged with synthetic ports. It MUST NOT
be activated by changing its ports.kind string or substituting a physical adapter.
Its context and acknowledgment strings are unkeyed consistency claims. The
physical composition needs separately reviewed authenticated sessions and a
different construction/admission API, not a type assertion around the fixture.

Proposed first physical composition keeps the ENTIRE heavy coordinator path in a
dedicated supervised process, separate from Studio's event loop. Validation can
remain a private module within that trusted process initially; it does not execute
task commands. A second replay child is optional only after custody, request
settlement and aggregate resource accounting are reviewed. Merely moving the pure
validator out of process leaves repeated coordinator parsing/hashing on the UI
thread (N-01) and does not meet the observed responsiveness requirement.

The supervisor/control plane has an independent event loop/watchdog. It owns the
physical process/job and channels; it can stop the coordinator while synchronous
validation is busy. Studio never gets raw process handles, database paths or a
generic command/pipe endpoint. Task execution remains a separate approved VM
boundary, not this metadata worker. This is scheduling/custody design, not proof
that a process boundary confines filesystem, network or arbitrary commands.

Keep all existing canonical record/inventory/checkpoint formats and the outcome
-> A -> released -> B sequence. No new authority is inserted into historical
checkpoint fields. Existing parser ceilings and 1000-operation support do not
change. Retention/archival and usable lifetime exhaustion remain release work.

## 2. One physical owner, not one JavaScript object

The physical enrollment authority must bind installation, namespace, exactly one
store/domain, immutable genesis and current owner generation. The supervisor binds
that generation to retained process/job and channel identities. The adapter binds
it to the opened enrolled ledger and protected ancestor/storage custody. The
anchor independently binds it to its current enrolled owner and head.

An epoch UUID or successful compare-and-swap is NOT sufficient: old code may hold
open writable handles or an in-flight request. The required replacement order is:

1. Close forward admission and revoke the old channel's ability to begin work.
2. Persist/observe the authority's retiring state without releasing spent IDs,
   blocked workspaces, outstanding callbacks or unconfirmed local/anchor state.
3. Stop and independently confirm settlement of the complete old relevant process
   job AND host contacts/guest generation. Root exit, guest Off and Promise
   rejection are individually insufficient. Retain uncertainty on any failure.
4. Only then issue the new durable current generation and fresh authenticated
   sessions, retaining genesis/history. Authenticate and replay current state.
5. Grant normal readiness only after equal joined state and all other admission
   checks. A wrapper/new process/new module cannot renew an unretired owner.

Crashes between steps leave the namespace non-admitted. A lost acknowledgment
does not justify another owner claim or a second mutation. Owner discovery is
read-only; no automatic initialize/adopt/reset endpoint exists. Concrete Windows
tokens, object rights, name ownership and stop evidence must be specified/tested
under the existing backend candidate; this document does not pretend to provide
them. No working-PC provisioning is authorized.

## 3. Ledger storage and transaction obligation

Propose a private, version-pinned SQLite adapter behind the protected coordinator
boundary. Its schema is a separate reviewed input, not yet selected SQL. Storage
must retain metadata, every operation and its contexts, the complete checkpoint
stream and any reconciliation-intent record; no replace-all caller API, pruning,
reset, ATTACH, arbitrary PRAGMA or arbitrary SQL channel is exposed.

`readSnapshot` returns the existing canonical metadata/inventory/history transport
from ONE bounded consistent read transaction, never separate row/head reads. It
checks the enrolled store identity, exact schema, durability configuration and
physical opened-file identity. It derives complete row/approval/workflow/workspace
invariants independent of indexes. It returns bytes, not readiness or permission.

`commitCandidate` accepts only immutable bounded primitive wires from the private
pending request: expected complete pre-identity, exact candidate, bound authenticated
context and cancellation/deadline state. It receives no callback, logger, worker,
anchor client, consent function or task handle. Pre-parsing outside a transaction
is allowed only as rejection/preparation, never as the transactional pre-state.

Transaction sequence, owned entirely by the adapter:

1. Acquire BEGIN IMMEDIATE before any writable-state decision; reject busy at a
   bounded timeout, do not queue/retry under a renewed deadline.
2. Under the retained physical fence, check schema/durability/store identity and
   the adapter's locally enforced current owner binding. Reconstruct the COMPLETE
   canonical local pre-snapshot from that transaction, including contexts/history,
   and compare all four digests to the privately captured S. Count/head alone fails.
3. Independently validate candidate byte identity and exactly one permitted
   record/event plus checkpoint change. Re-derive cross-row invariants, retained
   contexts and precise history relation; a pre-parsed snapshot tuple alone fails
   N-02. No full-history replay on every transaction is silently introduced: the
   reviewed full bootstrap/incremental result and complete pre/post checks have
   distinct roles, with resource accounting required for all synchronous checks.
4. Write that exact change and one checkpoint in the SAME local transaction.
   Validate exact complete post-state and compare all candidate identities before
   commit. Local tail is unconfirmed until independent anchor confirmation.
5. Commit; only then take a separate fresh read transaction and reconstruct exact
   post-state for acknowledgment. An acknowledgment derived solely from request
   bytes is forbidden even if the request was validated earlier.

No await, external call, user callback, worker round-trip or anchor access occurs
inside that write transaction. Physical ownership excludes unauthorized external
mutation while checks are used; database locks alone do not authenticate files.
Anchor relation is checked outside the transaction before/after, not atomically
with it. Concurrent anchor drift may leave a local tail and must close forward
work. Do not report that cut as a no-write denial.

Possible outcomes are known-pre-write-denial (only with proven zero effect),
commit-unconfirmed, and exact committed read-back. Failure after attempted commit
never maps to no-write. The coordinator closes on all failures; no advanced
validation transcript is reused. The physical host retains uncertainty across
object/process recreation. SQLITE WAL/FULL is a configured policy, not power-loss
or hostile-filesystem proof; independent storage/kill/flush tests remain required.

## 4. Acknowledgment and trust distinctions

Separate types at the future boundary: byte-claimed snapshot identity;
session-confirmed history claims; authenticated current physical observation;
durably read-back ledger/anchor acknowledgment. None is task permission. A nominal
TypeScript brand is misuse resistance, NOT a cryptographic/security boundary.
Only the owning validation module creates session-confirmed claims; IPC must
revalidate authenticated bytes rather than resurrect a brand through a cast.

A physical acknowledgment binds protocol/version, operation, request digest,
fresh nonce, lifetime/current generation, enrolled installation/namespace/store,
expected pre-identity, exact post-identity and the original deadline/request
number. Ledger and anchor operations have distinct domains. Its exact authenticity
mechanism and key/channel custody must be selected and reviewed before code.
Nonce echo + hash does not authenticate a peer; stored acknowledgment bytes are
historical evidence, not a bearer capability or live freshness observation.

An anchor append is compare-and-append for precisely the existing checkpoint,
against a freshly authenticated expected predecessor and current owner. It runs
outside ledger transactions. One response for another owner/store/request/nonce/
operation or a late response denies; loss leaves uncertainty, not permission to
send again. Discovery binds enrollment, epoch and entire retained stream in one
authenticated observation. Separate stale replies may not be spliced together.

For diagnostics, a closed coordinator may display a last-confirmed historical
identity only with explicit closed/non-authorizing status. A live-use consumer
needs ready phase AND fresh physical owner/fence checks; phase alone is not proof.
No cached UI identity, boolean availability flag or local released column admits.

## 5. Local-tail reconciliation proposal (N-04)

Reconciliation is an operator-authorized maintenance operation, NOT a normal
bootstrap option and NOT a task approval. The candidate must already exist in
protected local storage. It may never be supplied from chat, a copied receipt,
an arbitrary database, worker output or a user-entered root/head override.

| Fresh authenticated relation | Permitted action; task contact always zero |
| --- | --- |
| Complete equal streams and valid full local replay | Record discovery; retire the uncertain attempt if its exact result is established. Fresh normal bootstrap/admission remains separate. No anchor append. |
| Local equals complete anchor stream plus exactly one checkpoint | Consider the one-attempt protocol below; no normal append/readiness. |
| Anchor ahead, shorter local, any divergence, two-ahead, missing genesis, changed enrollment/store | Closed forensic diagnosis only; no automatic rebuild, copy-back, deletion, anchor rewind or genesis creation. |
| Peer/owner/custody/stop/deadline uncertain, malformed history or missing contexts | Closed; do not infer a trustworthy relation from hashes. |

Before offering the operation, stop/fence old activity, establish the fresh
maintenance generation/session and independently replay the COMPLETE current
local inventory/history. The existing full-history parser replays record prefixes
and verifies intermediate roots against the supplied final inventory; use that
checked history to establish the exact old anchor prefix and sole candidate tail.
Do not truncate records or fabricate a previous snapshot as a fallback. Missing
context or an invalid historical root denies. Anchor/enrollment authentication
remains separate from that parser's consistency result.

The operator confirmation must bind the exact enrolled identities, current
maintenance generation, both full stream digests, candidate checkpoint digest,
read-back inventory identity and fresh bounded expiration. It explicitly states:
"witness this already committed local checkpoint; do not run or repeat a task".
No source/command/VM/approval-consumption or new history event can be requested.

Persist a create-only maintenance intent BEFORE the append contact, binding those
bytes and the original unresolved tail. Proposed authoritative placement is the
independent anchor's maintenance journal, not the rollbackable ledger. Preparation
is a distinct authenticated metadata operation with explicit maintenance consent;
it neither advances the head nor renews task authority. Keep it separate from the
one append attempt and charge/count its own contact. Preparation response loss
permits read-only discovery of the exact existing intent, never a new ID fallback.

The journal's proposed immutable identity is the tuple (installation, namespace,
store, expected anchor predecessor digest, exact candidate checkpoint digest).
Use a domain-separated canonical digest only as an index, not authentication.
Store that tuple, local metadata/inventory/history digests, maintenance owner epoch,
consent-evidence digest, original expiration and prepared timestamp, plus an
monotone phase: prepared -> contact-possible -> witnessed. Unknown is a discovery
disposition for a consumed contact-possible record without confirmed outcome, not
an extra compensating terminal write after losing a reply. No delete/reset/relabel
transition. A new operator request ID or epoch for the same
tuple cannot create another logical attempt. A different payload for the same
expected predecessor is a conflict requiring forensic disposition, not a race
between two repairs. The final exact schema/wire and historical retention need
review before implementation; these fields do not modify the V3 checkpoint.

The authority durably marks contact-possible before its append handling, then
atomically checks current epoch, unexpired consent, exact predecessor and exact
payload and commits the checkpoint plus witnessed result in its own short
transaction. A crash before that transaction leaves consumed/unknown rather than
granting a second attempt. A lost result after commit is discoverable as witnessed.
Fresh read-only discovery can establish equality; it never clears contact-possible
or allocates a replacement intent. The choice trades availability for one-attempt
integrity and must be explicitly accepted/reviewed; an unknown-but-not-appended
case still requires a separately designed operator escalation, not ad-hoc SQL.

This is a proposed persistent protocol, not an implemented authority or a boolean
the caller can supply. Ledger-only rollback cannot reset this independent journal;
whole-authority rollback has the unresolved whole-PC limitation in section 8.
Until the protocol and real physical custody are reviewed and implemented,
one-ahead recovery remains deliberately unavailable.

Synthetic-model precision: preparation-only reply loss may be followed by exact
discovery and the FIRST marker/append within the SAME still-current maintenance
owner and unexpired consent. Reopening a transport handle is not replacing the
physical owner. A changed owner, consumed marker or expired consent forbids that
continuation. `ONOES_AGENT_V3_RECONCILIATION_MODEL.md` exercises these distinctions
with the real pure history validator, but supplies no physical implementation.

After intent read-back, recheck the full local candidate and authenticated anchor
prefix under retained custody, the maintenance authority and remaining original
budget. Contact the anchor at most once with the EXACT existing tail and fresh
envelope. Never change historical producerGeneration to the new owner's epoch.
Require authenticated durable read-back and exact equality of the complete local
and anchor streams before reporting witnessed-pair. Retain the maintenance trail;
do not add a task event, rewrite success/failure, clear quarantine or refund IDs.

If the anchor may have appended but reply was lost, close. Subsequent authorized
discovery can establish equality without another append. If still one-ahead with
a consumed attempt, do NOT automatically mint another recovery ID and retry.
An additional operator procedure would require its own reviewed authority and
durable accounting, not an unbounded retry button. No successful maintenance
receipt itself grants readiness or retries the earlier task.

## 6. Watchdog, transport and capacity acceptance

The supervisor must remain schedulable while the coordinator is busy. It tracks
one bounded request and zero queued requests, starts the deadline before receipt/
parsing, binds its own monotonic deadline to the actual pending request, and never
trusts raw child clock values as comparable. Cross-process deadline translation
requires an explicit protocol and tests. Late completions cannot revive a closed
generation. On cancellation, invalidate admission and request stop, retaining
every potentially live contact until independently settled.

Retain proposed 30-second bootstrap, 10-second ordinary append and separate
5-second stop-confirmation budgets for review. The two 2-GiB component budgets
and 4-GiB combined ceiling from WORKER_MESSAGE_DESIGN are design maxima, not
permission to allocate them or a claim that V8 old-space bounds process memory.
If validation is co-located, its total fits within the coordinator budget rather
than adding a second implicit allocation. Native/IPC/encoded/decoded/GC-retained
copies and malformed near-cap inputs count. Resource-exhaustion denies safely;
support is not silently reduced below 1000 operations to make tests pass.

Later producer evidence bounds structurally valid snapshot bytes and measures a
dense composed path, but does not yet cover worst-admissible/invalid input, cold
minimum hardware, physical transport, memory enforcement or UI cancellation.
The 17.49-second coordinator event-loop stall is a concrete reason for whole-path
isolation, not evidence that the proposed production supervisor is implemented.

## 7. Required adversarial controls (all physical cases NOT RUN)

| ID | Falsifiable control before physical admission |
| --- | --- |
| PA01 | Race two real processes plus wrapper/module variants over one enrolled store; exactly one physical owner, loser no write/channel admission. |
| PA02 | Hold an old write/channel contact through retirement; new owner stays denied until every relevant old contact is physically settled. |
| PA03 | Drift unrelated row/context/history/schema/store identity between replay and transaction; zero writes despite same count/head where possible. |
| PA04 | Hostile adapter echoes requested ack without writing, writes different bytes, or returns stale read-back; coordinator never promotes. |
| PA05 | Fail before write, during transaction, after commit and before/after read-back; reopen distinguishes retained exact state/unknown without retry or compensation. |
| PA06 | Change anchor inside local transaction; local tail stays non-admitted and no automatic anchor append or repair follows. |
| PA07 | Corrupt/move/delete local records while leaving anchor unchanged; independent joined discovery denies, no empty fallback. |
| PA08 | Present every relation in section 5, including equal final heads with divergent prefixes; only the exact one-ahead case can reach maintenance review. |
| PA09 | Kill at maintenance intent creation/read-back/contact/anchor commit/reply; attempt accounting survives restart and no automatic second append occurs. |
| PA10 | Reconcile a tail carrying old historical generation through a new maintenance epoch; preserve bytes; no task/approval/publication contacts. |
| PA11 | Substitute store, epoch, nonce, operation, deadline, pre/post or replay a valid authenticated reply; reject before promotion. |
| PA12 | Cancel/timeout with synchronous maximum valid and malformed near-cap workloads; responsive supervisor, enforced memory, no replacement on unconfirmed stop. |
| PA13 | Interrupt outcome/A/release/B and owner changes; local released never admits without authenticated matching B and current physical authority. |
| PA14 | Corrupt maintenance history or exhaust capacity; fail closed, no reset/namespace rotation/refund. |
| PA15 | Upgrade/binary rollback while preserving current ledger/anchor/maintenance continuity; incompatible versions deny rather than rewrite history. |

Each negative requires a positive reachability control and independent before/
after bytes/identity, actual process/contact observations and no-effect counters.
Test the physical adapter against a hostile boundary fixture, not only the current
cooperative string-assignment ports. Producer execution is not independent audit.

## 8. Open decisions and next sequence

- Whole-PC coherent rollback: operator choice still pending. Local role separation
  does not detect restoring every local authority together; do not silently waive
  that requirement or claim an HMAC solves it.
- Concrete protected identities, exact rights, authentication/key/channel custody,
  store/fence authority and durable maintenance attempt schema remain required
  design inputs. No file paths, service accounts or keys are selected here.
  V3_WINDOWS_PEER_CHANNEL_DESIGN now narrows the candidate to distinct own-process
  service peers, explicit query/client masks, mutual OS/channel authentication and
  private child IPC. Its launcher, supervisor custody and physical tests remain
  unimplemented; it does not select an installed account or waive this gate.
  V3_AUTHORITY_JOURNAL_DESIGN specifies normalized durable owner/maintenance
  invariants and two-transaction witness handling. It chooses non-admission after
  lost physical custody rather than pretending a persisted active owner survives
  restart. Exact SQL, supervisor reattachment and physical tests remain open.
- Retention/lifetime capacity and supported recovery after irreparable corruption
  must preserve approval/quarantine continuity; a permanent 1000-row ceiling is
  not a finished long-lived personal agent.
- Next: local self-review and pure adversarial design checks; then one scoped
  outside review of the combined adapter/owner/reconciliation/hosting boundary.
  Only after that review and required operator authority prepare the bounded
  disposable-Windows physical implementation/probes. Do not infer host installation
  or real task permission from approval to prepare a review packet.

No production source changed for this design. No physical PA-case has run.
Original Windows release W1-W5 requirements remain open and unchanged.
