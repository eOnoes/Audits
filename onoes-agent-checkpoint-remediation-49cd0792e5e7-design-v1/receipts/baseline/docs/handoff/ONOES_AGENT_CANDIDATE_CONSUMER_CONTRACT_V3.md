# Candidate consumer successor — release and checkpoint protocol revision

Status: PROPOSED DESIGN; bounded changed-boundary review required before v3 data
implementation. This document version is not a ledger format implementation.
V1/V2 drafts and public packets remain immutable historical review inputs.
Current source baseline: 06cb638302a867006713af7702b77400b7d38d34.

This supersedes only the conflicting choices in CONTRACT_V2. All full-scope,
deny-first, separate approval, no automatic redispatch, physical fencing,
three-actor review/verification and W1-W5 requirements remain. The operator-returned
successor report (packet 9c546c8e738418dc5273f7ca4bcb4ef14907bb8e) is external
STATIC_SOURCE evidence, not permission. See SUCCESSOR_REVIEW_DISPOSITION.

## 1. SC-B-01: durable release plus fresh admission, not a local flag

Do not implement the V2 draft's absorbing, releasing `stopped-without-result`.
In the proposed NEW ledger domain, distinguish outcome recording from release:

- `stopped-without-result` is a non-releasing outcome, with null result and
  verification fields. It requires all the independently authenticated settlement
  facts in CONTRACT_V2 section 1, including post-effect failures. It never implies
  no effect. Quarantine stays absorbing and cannot enter this path.
- Other safe outcomes (passed/failed execution, restored/completed publication,
  and pre-contact cancellation) also remain workspace-blocking pending release.
  A passed execution outcome alone cannot fund publication in this new domain.
- A final absorbing `released` event binds the outcome, complete predecessor
  record digest, bounded settlement-evidence digest and the exact anchor
  checkpoint that witnessed that predecessor. It preserves the immutable outcome
  and spent approval/workflow, and performs no effect. It cannot release quarantine.
- The final record's outcome must still be inspected when validating publication
  parentage: only a released, passed execution with an authentic result qualifies.
  A released non-result, failed execution or restored publication never qualifies.

The ordinary new-domain blocked column may become false only at `released`.
That column is NECESSARY, NOT SUFFICIENT for admission. No SQL query, ledger
receipt or record parser exports workspace permission. Every new reservation and
physical fence release must independently establish, under the current fenced
owner, that the complete durable ledger inventory equals an authenticated fresh
anchor checkpoint, and validate the settlement proof against current custody.
Missing or disputed facts return blocked/reconciliation, never an empty free set.
The authoritative admission decision is this joined read, not `listBlocked()`.

Non-circular ordering for release:

1. Record the blocking outcome and exact settlement proof digest; append and
   confirm its checkpoint A. Revalidate proof, owner, policy and relevant custody.
2. Commit `released`, referring to predecessor checkpoint A (not its own digest).
3. Append checkpoint B over the released record and complete post-commit inventory.
4. Only an authenticated fresh joined view of B and that exact inventory, plus
   independently checked current safe custody, may admit subsequent work.

Acknowledgment B is not written back as another ledger event. This avoids an
infinite acknowledgment-of-acknowledgment chain. The crash gap is closed by the
mandatory fresh admission read, NOT by pretending the two stores commit atomically.
After a step-2 crash, the local row can say released while admission remains blocked.
After a lost step-3 response, a fresh authenticated read may establish B; a local
memory flag cannot. A new owner must fence the old owner and reconcile first.
Neither recovery case invokes a task, retries delivery, or spends another approval.

New-domain parsers should enforce the structural predecessor/settlement bindings;
only the protected host/anchor composition can establish their truth and freshness.
Do not claim the record alone proves physical release. If a proposed v3 API cannot
prevent consumers confusing its blocked column with admission, it is not ready.
The execute path has at most five explicit events (delivery, launch, observed
outcome, completed/failed outcome, release) after the reserved record; a non-result
path is shorter. Pin every transition path against the existing six-event ceiling
in the future schema tests rather than relying on this enumeration alone.

V2 schemas, terminal behavior and quarantines remain unchanged. A synthetic v2
sequencer must retain an uncertain pair's global fence even where v2's row is
releasing; it must not add `released` or non-result recovery to v2. No real consumer
of that synthetic model is authorized.

## 2. SC-N-01/02/03: owner epochs and complete checkpoint semantics

The independent anchor has a current-owner generation separate from historical
checkpoint producer generations. The owner claim is an authenticated compare-and-
swap on the previous owner epoch, durably recorded before any new-owner ledger
write. Every append, discovery and reconciliation request is authenticated for
that current epoch. Reject old generations, including delayed callbacks. This is
not physical fencing by itself; owner acquisition also requires the actual old
process/task boundary to be fenced and settled.

Each immutable checkpoint payload binds installation, namespace, store, historical
producer generation, operation, explicit event index (reserved=0), exact record
digest, stable approval-identity digest, previous checkpoint digest and global
sequence. Its inventory describes the complete POST-LEDGER-COMMIT state for that
pair, not the state before the event and not other unwitnessed writes.

Proposed inventory hash core (format pending changed-boundary review):

`{ domain: "agent-candidate-inventory-root/v1", installationId, namespaceId,
storeId, operationCount, entries }`

Entries contain operationId, eventIndex, recordDigest, approvalIdentityDigest and
last state. Sort by ascending lowercase canonical UUID (ASCII/code-unit identical),
reject duplicate operations, approval identities and workflow/kind pairs, and
check blocked-workspace exclusivity against the full parsed records. Each record
digest covers its entire intent and history, not only the latest event. Empty
inventory is the canonical empty array and count zero within this domain, never a
zero digest or missing lookup. Canonical byte rules are the existing canonicalJson
rules, not a new JSON implementation. Hash the bounded tuple inventory, not a
single giant object containing every 32-KiB record. Use the 1,000-operation limit.

The anchor records the authenticated producer's CLAIMED root. It cannot validate
SQLite contents from a hash. A fresh honest reader recomputes the whole inventory
and compares it against independently held authenticated history. That detects
rollback/deletion/substitution under the stated trust model; it does not defeat
a compromised authorized producer capable of forging both claimed histories.
No retention, archive, rotation, row deletion or cross-version migration is
implemented here. Any future such operation needs a separately reviewed continuity
protocol preserving all spent approvals and the complete inventory commitment.

All ledger mutation/read-back/anchor pairs are serialized across the enrolled
store. No caller callback or await occurs inside a SQLite transaction. Reject
concurrent requests rather than allocate an unbounded queue. Before the first
mutation, require exact fresh matching inventories; after each mutation, append
only its exact post-state. An inventory port must provide a complete consistent
snapshot, including unexpected and terminal rows. Re-reading only remembered IDs
or `listBlocked()` is not sufficient; v2 currently has no public all-record snapshot
API. A synthetic fixture can model that port; production composition must implement
and review it without weakening v2's private validated read-back.

Unknown append outcome closes the owner for writes. New-owner reconciliation may
make at most one explicit idempotent append attempt for the exact unresolved
payload, after authenticated full discovery and old-owner fencing. The envelope
uses the NEW reconciliation owner epoch; immutable historical payload bytes and
producer epoch do not change. The anchor must validate that delegation and exact
expected prior checkpoint, not accept ordinary old-owner writes. Exact duplicates
acknowledge the existing sequence; conflicts, gaps, incomplete discovery or unknown
retry outcomes retain the fence. Do not compensate with terminal writes. No
automatic restart loop, repair, new store, new approval or forward effect follows.
An anchor-ahead record is not automatically materialized in SQLite; preserve
evidence and require explicit reconciliation design/authority.

## 3. SC-N-04/05: delivery grammar and destination evidence

Keep the existing run/stop channel and request limit unchanged. New delivery
session inbound grammar, with one authenticated ready and at most one stopped:

- ready -> stored -> (result | run-failed) -> stopped: at most four frames;
- ready -> delivery-failed -> stopped: at most three frames;
- stop from any acquired prefix -> stopped: no further forward frame;
- timeout, malformed input, missing readiness or missing stopped: uncertainty,
  not an invented response. Stop can be requested before readiness.

Delivery-failed and stored are mutually exclusive. Failure is not successful
storage and can never permit run. Duplicate kinds, result after delivery-failed,
any frame after stopped, unsolicited/out-of-phase messages, and stale-generation
frames deny. Four is the maximum on any valid inbound path, not the number of
distinct kinds. The fixed bound must be derived and tested along with per-frame
bytes/chunks, EOF and process-settlement rules in the new transport implementation.

OCS1 exact wire bytes = manifest.byteLength + 44 * manifest.fileCount; maximum
16,777,216 + 44 * 128 = 16,782,848 bytes. The manifest's separately bounded wire and
bounded session control frames are additional protocol budgets, not hidden inside
that OCS1 sum. Transfer byte ceilings are NOT measured transfer-time ceilings.

Stored evidence binds request, manifest, operation and owner/guest generation,
actual reread destination file count/lengths and content digests in manifest order,
and a canonical destination inventory digest. Compute these from destination
bytes after complete EOF under retained destination custody, and compare every
member against the manifest. Do not echo source-declared hashes as read-back.
Authenticated origin, protected destination and independently confirmed cleanup
remain necessary; matching hashes or task-authored counts prove none of them.

## 4. SC-N-06/09: authorization core and coexistence

Avoid self-reference: first compute a versioned canonical intent CORE omitting
only authorizationDigest. The separately signed envelope binds that core digest
and its explicit consent, purpose, expiry, revocation and issuer fields. Compute
authorizationDigest over the exact canonical envelope bytes, then construct the
complete ledger intent and its digest. The signature covers an envelope core
without its own signature. Reject unknown fields and alternative byte encodings.
Concrete schemas/keys/issuer custody need their own scoped review before use.
No existing v2 field or historical signed bytes change.

Maintain the existing namespace/approvalId identity domain across versions. One
authoritative enrollment must prohibit independent active v2/v3 stores from
spending the same approval. A digest domain alone cannot do that. No activation
of a second version, empty-store adoption, refund or forgotten quarantine serves
as migration. Version coexistence requires reviewed shared consumption/retention.

## 5. SC-N-07/08: bounded work, cleanup and pair lifetime

Add explicit positive safe-integer `anchorAppendMs` and `anchorDiscoveryMs` to
the proposed resource policy; bind both with all existing fields. No defaults,
infinity, missing values, unsafe sums or synthetic-to-production sizing promotion.
Each serialized pair has one monotonic deadline. Every anchor call consumes that
deadline and the global overall remainder; re-entry does not reset either.
Reconciliation has at most one discovery and one explicit idempotent append, with
any required confirming discovery counted separately and reserved up front.

For each phase, reserve its work ceiling, every planned checkpoint append and
discovery on that phase's normal AND failure paths, applicable stop budget and
settlement budget. Use the maximum feasible branch cost, not the sum of mutually
exclusive branches. If the remainder cannot fund the selected bounded path, deny
before starting that phase. Close an unresolved pair on budget exhaustion; no
subsequent ledger mutation or growing waiter queue. Do not cancel and treat an
unsettled promise as completed. Physical watchdogs/fences remain independently
required for host stalls and process death.

Verifier SUCCESS acceptance stays strictly before start + min(runMs,
request.timeoutMs), with run and confirmed stop both inside that interval.
Worst-case FAILURE cleanup is different: timeout at that deadline may start a
stop attempt lasting stopMs. Reserve min(runMs, request.timeoutMs) + stopMs +
settlementMs, plus explicit planned anchor costs, before the wrapper. This does
not extend the success deadline or permit another run. An unconfirmable stop
remains blocked even after all budgets elapse. Preserve the 30s acquisition,
60s run and 10s stop caps; transfer/overall/parent-age/anchor production ceilings
remain unselected measured release inputs. Preserve full 128-file source scope.

## 6. Implementation order and falsifiable review boundary

The report allows synthetic sequencing over unchanged v2, not v3 implementation.
First pin real SQLite crash/reopen behavior and demonstrate why its releasing
predicate cannot substitute for joined admission. Then implement injected-only
pair sequencing with synthetic owner, complete inventory, anchor and policy ports;
no real source, approval, VM, subprocess task or publication adapters. Validate
single-attempt/replay rules and every audit-specified crash cut with exact call
counts. Missing results after v2 possible-effect markers still quarantine.

Before any v3 record implementation, review this revised release/admission join,
checkpoint/reconciliation protocol, delivery grammar and budget arithmetic. Test
all release cuts, lost versus absent acknowledgments, snapshot rollback and row
deletion, old-owner retries, maximum inventories and clock/deadline failure. An
extra release event alone is an insufficient fix and must fail the negative control.

B-03 physical storage/freshness, authentic host/guest fencing, independent execution,
operator acceptance and W1-W5 remain open. Neither this document nor passing test
models closes those gates. No audit packet is regenerated or published by this edit.
