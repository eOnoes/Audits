# Candidate consumer contract — successor review draft v2

Status: DESIGN FOR REVIEW. No consumer, issuer, anchor, v3 ledger, transport or
physical adapter is implemented by this document. Source inspected at
7060f7058ae0c2febf3cf9d5b1efb3b3169f9dba. The v1 draft and public packet at
459aa620ae778d2d4f5eb5f2ec39f946b9f5c4be remain unchanged historical inputs.

This successor resolves design choices raised in the operator-delivered Claude
report; it does not claim independent acceptance of those choices. It supersedes
the v1 draft only where explicitly stated below. Default deny, full source scope,
separate execute/publication approvals, no effect from replay, three distinct
builder/reviewer/verifier actors, physical fencing and all W1-W5 requirements
remain mandatory. See `ONOES_AGENT_CANDIDATE_CONSUMER_REVIEW_DISPOSITION.md`.

## 1. CC-B-01 decision: distinguish settled non-results in a new domain

Choose a separately versioned ledger/record successor, not permanent retirement
as the ordinary user-facing result of every confirmed failed run. The proposed
domain is `agent-candidate-effect-ledger/v3`. No v2 parser, transition, stored
row, quarantine or spent-approval identity is changed or auto-migrated.

Propose an execute-only absorbing terminal `stopped-without-result`, reachable
from `source-delivery-possible` or `launch-possible`. It cannot support publication
and must retain `resultDigest: null` and `verificationPassed: null`. A failed
verification with an authentic parseable result still follows the ordinary
observed-result -> failed path. Never manufacture that result to fit v2.

The new terminal requires independently established, bounded settlement evidence
bound to the full intent and preceding record, operation, enrolled store/namespace,
request/manifest, dispatch owner and guest/controller generation. Evidence must
establish all of:

- old owner is fenced against every delayed forward call;
- delivery and run contacts, including synchronous throws and partial transfers,
  are accounted for, with every related host/guest process, channel and descendant
  settled, and the exact required host-Off observation established separately;
- task generation is permanently retired, source/input/output custody is released
  safely, and no unaccounted pending write or disclosure can continue;
- execution had no original-publication authority, the task boundary actually
  enforced that exclusion, and current workspace safety is established before
  another workflow may use it;
- the exact preceding ledger history and terminal are confirmed against the
  independent freshness protocol in section 3.

A runner exception, timeout, AbortSignal, closed pipe, root exit, empty anchor
lookup or caller boolean proves none of this. A result may be missing even after
an effect DID occur; `stopped-without-result` never means "nothing happened".
Keep bounded cause and observation identities; no stdout, source or credentials
belong in the terminal. Separate authentic stop evidence from invalid result data.

Unknown stop, disputed history, unavailable anchor or incomplete cleanup remains
quarantine/blocked. The new state does not reopen an existing quarantine. No
automatic repair, re-dispatch, refund, approval reset or verification reuse.
Only after terminal commit, matching anchor acknowledgment and independently
checked safe custody may the host release workspace exclusion. The old approval
and workflow stay spent. A later attempt needs a fresh proposal/review, fresh
explicit approval and new execution/workflow/owner generation.

This deliberately extends the reviewer's suggested no-effect-only abort case:
confirmed **post-effect** failure also needs a representable outcome. That extension
needs targeted review and physical settlement evidence before real use; it is
not authorized by accepting the original report. Synthetic tests may model it
only with explicitly non-authoritative ports after the acceptance review.

V2 behavior stays exactly as tested: after either possible-effect marker, a
missing result can only end in quarantine. No v2 consumer may pretend that the
proposed terminal already exists. A fresh synthetic v3 store is not a production
migration or a means to forget v2 spent IDs. Any real version transition requires
separate retention/enrollment review preserving the single authoritative history.

## 2. Durable identity and evidence corrections

V2 does NOT contain `candidateStoreId`, `preparationDigest` or an approval-envelope
digest. The candidate store parameter is a string supplied by the host; its
transitive presence in a review hash does not authenticate the actual store.
`candidateDigest` must mean saved artifact digest, not work-proposal digest.
The future versioned envelope/intent association must durably bind the genuine
candidate-store identity, artifact, proposal, preparation and exact complete
authorization content. Merely recording an approval UUID proves no such binding.
Issuer acceptance must validate its purpose, consent, revocation and every field
against the host's genuine objects before reservation. Schema names are proposals,
not existing signature formats; keys/enrollment remain separately authorized.

Mint the owner/controller generation at protected acquisition BEFORE reserve;
bind observed enrolled runtime/image identities then. "Launch generation" does
not mean a value first discovered after reserve. Publication echoes its parent's
generation identities as historical subject bindings, not fresh launch observations.
VM UUIDs and controller echoes are not authenticated custody.

Reuse only the historical workflow's chronology/separation invariant. Candidate
evidence needs its OWN versioned schema binding the authenticated review envelope,
execute operation, request, result, measured run/stop interval and authenticated
actor identities. Do not invent historical command IDs/digests or cast the VM
result into a historical receipt. A newly dated review cannot reuse an earlier
verification; unchanged, still-valid pre-dispatch review may be revalidated without
rewriting its signed timestamp. All candidate-path times use exact valid
`YYYY-MM-DDTHH:mm:ss.sssZ`; reject offset/other precision before binding, rather
than loosening the review verifier or altering historical formats.

Restored publication releases workspace exclusion only, not the workflow's single
publication slot. Another publish of that result is forbidden even with a new
approval; cross-workflow parent references are forbidden. A fresh attempt requires
a complete new approved execution workflow. State this cost in the operator UI.

## 3. Freshness/anchor acceptance contract — B-03 remains OPEN

The anchor must have custody and recovery independent of the ledger's writer and
rollback domain. Task code cannot write it, and restoring the VM/DB must not reset
it. An append-only file, MAC or second DB is not proof of that property. No backend,
TPM, account, service, certificate or remote system is selected or installed here.

Proposed append entries bind installation, namespace/store, owner generation,
operation and per-operation event index, exact record digest, approval association,
previous anchor-entry digest and a monotonically increasing global append sequence.
They also bind a deterministic complete operation-inventory root and operation
count, including every terminal/spent-approval record. Canonical formats and root
construction are separately reviewed protocol inputs, not an implemented hash tree.

**Global append sequence is not operation row count.** One operation has several
events. Compare per-operation event indices/digests and the complete anchored
inventory root/count; never compare a global event counter directly to DB rows.
Discovering only rows still present cannot detect deletion. A missing expected
row, changed digest, substituted installation or reused sequence must deny.

Synthetic acceptance ports must model serialized compare-and-append with an
expected prior checkpoint, exact duplicate acknowledgment without a new entry,
conflicting replay denial, complete bounded discovery and unknown outcome on
write/response loss. All anchor calls occur outside SQLite transactions. A later
implementation must positively establish backend durability, authenticated fresh
reads, sole owner and physical fence; mocks cannot satisfy those properties.

Serialize each ledger-mutation/read-back/anchor-ack pair across the entire enrolled
store, not merely per workspace. Do not begin a subsequent ledger mutation while
that pair is unresolved: its inventory root must not accidentally include another
unwitnessed operation. This is a fenced host sequencing obligation, not a SQLite
transaction held across an await. On ownership loss, a new owner first fences the
old one and reconciles the unresolved pair; it never treats an anchor replay as
permission to resume a forward effect. Independent effect phases already released
remain subject to their own per-workspace ownership and stop rules.

| Cut / observation | Required consequence |
| --- | --- |
| Before ledger commit | No forward effect; no assumed consumption without exact read-back. |
| Ledger write/read-back uncertain | Latch owner closed; no compensating terminal write or effect. Discover both histories after fencing. |
| Ledger commit confirmed, append not confirmed | No forward effect. Anchor may have persisted despite a lost response. |
| Anchor confirms exact new checkpoint | Only the current live authorized phase may continue once. Replay/restart of that checkpoint grants no effect. |
| Crash after acknowledgment, before/after port contact | Indistinguishable possible effect until independently reconciled; never infer non-contact from missing local flags. |
| Ledger behind anchor, missing row or coherent rewrite | Deny rollback/deletion; retain blocker and forensic evidence. |
| Ledger ahead of observed anchor | Unwitnessed or inconsistent history, NOT proof of no effect. Require authenticated complete fresh anchor history and old-owner fencing; no automatic retry or abort. |
| Terminal commit without confirmed anchor | Withhold success/publication and workspace-fence release, even if DB terminal is releasing. |

An anchor acknowledgment may be lost, an anchor replica stale, or a marker forged;
therefore absence alone cannot authorize the new non-result terminal. The full
section-1 settlement proof is required. Existing v2 `completed`/`restored` data
also cannot release a physical fence while the corresponding anchor is uncertain.
Archive, rotation, backup and restore must preserve inventory/spent-ID continuity.
Fresh namespace/store creation is never recovery of a lost authoritative history.

## 4. Versioned delivery/session acceptance contract

The existing channel and `ManagedVmVerificationSession` have only run/stop, a
three-frame inbound ceiling and a 65,536-byte request limit. They cannot implement
the delivery-before-launch sequence. Keep them unchanged. Introduce a separately
versioned channel and session with phases ready -> delivering -> stored -> running
-> stopping -> settled/uncertain. Stop is available from every acquired phase;
new forward work is never available after stopping/uncertainty.

The new delivery command binds operation/request, manifest, owner and session
generation. OCS1 bytes have their own transfer budget, separate from run-request
bytes. One authenticated destination-stored acknowledgment binds those identities,
complete bytes/counts, physical destination custody and read-back. Receiver.finish
or a task-produced acknowledgment is insufficient. Budget at least ready, stored,
result-or-run-failure, stopped as distinct inbound messages; derive exact maxima
from the reviewed grammar including failure paths. Duplicate/unsolicited/out-of-
phase frames deny. No run until exact stored acknowledgment and fresh launch marker
plus anchor ack. Latch each attempt before any reentrant callback.

Required synthetic controls: missing/truncated/extra source, wrong digest/generation,
stored before EOF, duplicate stored/run, cancellation at each seam, early result,
stopped before all work/stdio settles, stale fulfilled readiness and delayed old-
owner callbacks. Assert zero subsequent forward calls and exact bounded cleanup.
Real origin authentication, destination custody and independent stop remain absent.
Full 128-file source scope is preserved; larger run-request support, if required,
needs a new separately bounded grammar, never silently widening the old limit.

## 5. Resource policy acceptance contract

Propose canonical `agent-candidate-resource-policy/v1` with explicit positive safe
integer millisecond fields: acquisitionMs, transferMs, launchMs, runMs, stopMs,
settlementMs, overallMs and maxParentAgeMs. No missing, zero, unlimited, inferred
sum or implicit default. Bind the complete document through resourcePolicyDigest.
All arithmetic must remain within safe integer bounds. Each phase ceiling must
fit the explicit overall ceiling; acquisition <=30000, run <=60000 and stop <=10000.
Run allowance includes stop, as the current verifier does; do not double-count
stop within the run wrapper or grant an additional run budget after transfer.

At every phase entry require sufficient monotonic overall remainder for that
phase's declared work plus its applicable stop and settlement reserve. For the
existing verifier wrapper reserve runMs + settlementMs, since runMs already includes
stop; for acquisition/transfer/launch reserve phaseMs + stopMs + settlementMs.
Actual run-and-stop acceptance remains strictly before min(runMs, request.timeoutMs).
Use inclusive expiry denial and explicit parent-age cutoff; wall-clock timestamps
do not extend monotonic deadlines. Independently owned watchdog/fencing still
must handle host stalls/death; JS timers are not that mechanism.

Concrete transfer/overall/parent-age ceilings and physical resource limits remain
unselected release inputs. Reject enrollment lacking those reviewed values. Tests
may choose bounded synthetic values; synthetic timing is not production sizing.
Retain all current source byte/file/path caps and the historical 5-second executor
limit. Do not wrap this lifecycle in that old step or narrow the candidate to fit.

## 6. Next acceptance and execution boundary

Before a sequencer is implemented, obtain targeted acceptance review of this
successor, particularly post-effect stopped-without-result, complete-inventory
anchor semantics and versioned delivery/session interfaces. Do not re-audit all
unchanged ledger mechanics. Thereafter the first sequencer is over injected test
ports only, with exact call counts and durable state at every crash cut, no real
approval, source export, VM or original write. V2 cannot impersonate v3; implement
the reviewed new data domain separately if its transition is required.

Proposed controls are NOT RUN: authenticated stop missing any required fact denies;
fake no-effect/anchor absence denies; changed generation denies; terminal ack loss
retains fence; replay of every terminal invokes zero ports; fresh workflow after
confirmed non-result cannot reuse approval/result; anchor row deletion/rollback/
coherent rewriting deny; full success reaches independently verified publication
only with its separate approval. Physical versions need scoped operator authority.
No synthetic result or external review alone closes B-03 or W1-W5.
