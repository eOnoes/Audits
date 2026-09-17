# V3 dormant coordinator with synthetic ports

2026-09-17. Implements the next dormant composition allowed by the full Claude
coordinator-model report and V3_MODEL_REVIEW_DISPOSITION. This is actual build-only
coordinator code around the retained pure validation session, not another model
substitute. The ports used to test it are exclusively synthetic. No runtime
barrel, dashboard, task consumer, VM, provider, physical ledger, authenticated
anchor or worker process is connected. This is not release or activation approval.

## Implemented contract

`windows-candidate-v3-coordinator.ts` owns old confirmed S while the private
validation session advances T and one candidate C awaits settlement. Its public
surface is only bootstrap, append, close and redacted status. Callers cannot
submit S, an expected pre-head, a worker reply, a consent callback or a retry.
Append inputs are primitive bounded canonical inventory/checkpoint strings.
Host binding, clock, AbortSignal and ports are trusted embedding inputs, not
task-provided objects. A port object is consumed once by the factory; the same
object cannot create a second owner, even after failure. Busy requests reject
without queueing or poisoning the active winner.

Bootstrap charges one attempt, obtains fresh ledger and anchor strings, requires
exact full-history equality, drives the real full-replay session and checks its
complete post-identity. It then refreshes both sources and current authority
before assigning S. One-ahead, shorter, divergent, two-ahead and missing-genesis
inputs close; this path does not implement or silently invoke reconciliation.

An append captures S, obtains fresh pre-state/anchor reads, stages exact candidate
bytes, and sends a request with a fresh Node randomUUID nonce, private request
number, lifetime/epoch, complete pre-identity and one absolute deadline. Every
worker response field is bound to that pending request; all four returned post
components are also compared against locally staged bytes, including the two
components the message parser cannot derive on its own.

The commit port takes data only: canonical pre-identity, candidate snapshot,
bound context and a cancellation signal. It must own the entire short synchronous
transaction, independently checking current schema/durability/physical store,
complete pre-state and exact post-state under that transaction. No coordinator,
worker, anchor, authorization or task callback is passed into a transaction.
The test fixture simulates this with a synchronous string assignment; it does
not supply the required real transactional implementation.

After exact commit acknowledgment, the coordinator separately reads back the
candidate and checks that the anchor remains the old stream. It then contacts
the anchor once, outside the transaction, with exact predecessor/history and
checkpoint plus the original request/deadline context. Acknowledgments must be
exact canonical text with the expected context digest and full post tuple.
Fresh ledger/anchor reads and current authority are required before promotion.
The acknowledgment format is a consistency contract, NOT authentication.

Each commit/anchor attempt counter increments immediately before its actual
port call, after the final step-level cancellation/deadline check. Attempted
does not mean written. If a contacted port rejects or its reply is lost, the
coordinator conservatively treats that attempt as uncertain; it does not infer
no-write, compensate, retry or rewind the advanced session. Known no-write versus
commit-uncertain diagnostics for a physical adapter remain part of that adapter's
reviewed contract; the current public error intentionally makes no such claim.

## Snapshot transport and identities

`windows-candidate-v3-coordinator-data.ts` wraps the existing metadata, inventory
and retained-history canonical strings in a strict local transport envelope.
It defines no new ledger schema or authority. The four identity components remain
the exact SHA-256 of each existing wire and the last checkpoint's declared digest.
The byte-claim parser checks envelope/history shape and metadata/last checkpoint;
it deliberately does NOT validate the whole inventory/history. Only the session's
real pure validator can validate those claims. Tests preserve that distinction.

Encoding charges exact escaped bytes before composing the envelope; inner limits
remain 1,024 bytes metadata, 64 MiB inventory/history, 4,096 bytes checkpoint.
Staging verifies predecessor/sequence and appends one canonical checkpoint string
after checking the total history budget. The envelope uses the existing bootstrap
outer cap. Returned snapshots/identities are frozen; no proxy/getter/Buffer or
boxed string is accepted at the candidate transport boundary.

## Cancellation, revocation and uncertainty

One overall budget begins before candidate byte checks: 30 s bootstrap or 10 s
append, with test-only host narrowing supported but never widening. There is no
per-port budget reset. Safe nonnegative integer clock values must not regress.
Every asynchronous port step checks time/cancellation before contact and after
settlement; a timer races unresolved calls. Any failure closes the coordinator,
aborts the private signal and requests one validation invalidation.

`pendingPorts` counts unsettled promises even after the public request rejects.
It is NOT a process/descendant stop witness. A dedicated test lets an uncooperative
synthetic commit write after cancellation: the write can happen, but no later
anchor call, promotion or port-object replacement is allowed. Physical exclusion,
termination and separately authorized fresh-owner recovery remain mandatory.

Post-commit forward revocation can still allow witnessing the exact old pair
under separately retained settlement authority and the unchanged deadline. The
final forward check nevertheless denies a new Ready owner. If settlement itself
expires/revokes, no anchor contact occurs. Last confirmed S remains old on every
failure, even when local or both synthetic writes are already observed.

## Evidence and coverage

The 22-case coordinator suite uses the actual message/session/incremental modules
through asynchronous synthetic ports. It checks 53 sequential prefixes across
all eight outcome families against a full-reference oracle, complete nonempty
bootstrap, transaction/pre-state drift (including removal of an unrelated row's
context), anchor drift during local commit, lost replies, forged responses/acks,
corrupt read-back, busy callers, epoch/clock loss and post-commit revocation.

Cancellation is swept over 32 before/after append seams and 18 bootstrap seams;
expiry is swept over all 16 settled append seams. Pending validation, commit and
anchor responses are separately canceled/closed. A 500 ms test-only timer case
checks rejection while a port remains unresolved; it is not a throughput or OS
watchdog benchmark. The fixture checks that async port contacts never occur
inside its simulated transaction. Its fault hooks exist only in test code.

Selected source/compiled/config identities, exact commands, raw focused/full TAP
and producer receipt are retained in `docs/reports/v3-coordinator-20260917`.
Compilation and no-emit typecheck passed. Focused: 136/136, zero fail/skip,
1430.4192 ms; TAP SHA-256
`f81277ffd6ee92cc211b909b4f2a3492ee905ef3e29f67e2291d4fe8e6c3f98a`.
Full offline: 2,131 tests / 2,129 passed / zero failed / two skipped,
241363.9444 ms, UTC 2026-09-17T19:52:41.498Z--19:56:42.947Z; TAP SHA-256
`25f65dc8d982701f652afcf14c72b2574304ce98b2118c87b9476428597f8f51`.
The skips remain Windows symlink-creation privilege and the deliberately
non-Windows-only inspector refusal case. A separate artifact read-back checked
all 49 selected identities, both raw TAP files, counts and seam diagnostics.
Receipt SHA-256:
`d3dda7803fff8d093b6ccbbe1529f396b61b85f0249a504f4f8d6a486f10aa5a`.
The staged-source check found all 23 selected TypeScript files and the lockfile
byte-identical to executed inputs. The two existing tsconfigs were read as CRLF
locally and are LF in Git: exact CRLF-to-LF comparison and parsed JSON equality
both pass. Their actual executed bytes and the explicit mapping are retained as
`EXECUTED_*.json.txt` and `EXECUTION_INDEX_MATCH.json`; the original receipt is
unchanged. Do not collapse that distinction into an EXACT_TREE assertion.
This is producer evidence, not independent execution, exact full-product
provenance or Windows-native proof.

## Open gates and next action

- Real store-wide ownership/fencing is NOT a WeakSet. Cloning/recreating ports or
  loading another module copy can bypass this local object-identity guard. A host
  must retain one port bundle and cannot treat a new object as authorization.
- Real transaction durability, protected file/WAL/SHM custody, enrollment,
  authenticated anchor discovery/append and anti-rollback B-03/W1-W5 are absent.
- Real validation worker/IPC, shared clock conversion, executable custody,
  request quiescence and descendant termination are absent. In-process callbacks
  and promises cannot establish any of these facts.
- Synchronous parsing/hashing may block this dedicated future host. The timer
  cannot preempt synchronous JavaScript. Repeated complete snapshot parsing and
  allocation need measurement at the maximum admissible history. M-6/C12 remain
  OPEN; the small-fixture pass is not a maximum-capacity or dashboard claim.
- A one-ahead bootstrap closes; no retirement, reconciliation, effect or task
  API has been activated. Public status never grants admission or claims that
  an uncertain write did not happen.

Next: prepare one combined narrow review of the message/session/coordinator
implementation and these synthetic fault controls, including their residual host
contracts. Obtain the selected service and exact sanitized scope approval before
new external source transfer. Do not wire physical storage/worker/task consumers
or equate this checkpoint with the Windows release goal being complete.
