# Candidate consumer successor — release and checkpoint protocol revision

Status: DATA-ONLY IMPLEMENTATION CLEARED BY TARGETED STATIC REVIEW; implementation
in progress. This document is not an activated ledger/store/admission format.
V1/V2 drafts and public packets remain immutable historical review inputs.
Inventory implementation baseline (pre-inventory): 0420349cf66ef16e6bc1b0e84de388938995509b.
Inventory implementation commit: f256ad29ea4176cdc60244db20fd3742769e1f0a.
Reviewed design source: 49cd0792e5e7f48fff1798baebaa24e170ac5371.

Record-history implementation and remaining inventory/checkpoint-B boundaries:
see `ONOES_AGENT_V3_RECORD_IMPLEMENTATION.md`. This is data-only implementation,
not protected storage or admission. Frozen public review inputs are unchanged.
The subsequent inventory, A/B and retained-history implementation is described
in `ONOES_AGENT_V3_INVENTORY_IMPLEMENTATION.md`; it closes those DATA validation
steps, not authenticated completeness or any production gate.

2026-09-15 remediation review: report at Audits b86e08b clears DATA-ONLY schema
work with N-01/N-02/N-03/N-04 clarifications below. Real admission and activation
remain NO. See `ONOES_AGENT_V3_DATA_REVIEW_DISPOSITION.md` for exact report
identity, all finding dispositions, coverage and delivery limitations. The
following 2026-09-14 paragraph records historical preparation, not current gating.

2026-09-14 review follow-up: decisions below respond to the checkpoint audit at
product 0c01a442 / packet 0d27ba2. They are design corrections for re-review,
not accepted v3 schemas or a physical backend. See
`ONOES_AGENT_CHECKPOINT_REVIEW_DISPOSITION.md` for findings and evidence limits.

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

An INTERNAL new-domain blocked column may become false only at `released`.
That column is NECESSARY, NOT SUFFICIENT for admission. No SQL query, ledger
receipt or record parser exports workspace permission. Every new reservation and
physical fence release must independently establish, under the current fenced
owner, that the complete durable ledger inventory equals an authenticated fresh
anchor checkpoint, and validate the settlement proof against current custody.
Missing or disputed facts return blocked/reconciliation, never an empty free set.
The authoritative admission decision is this joined read, not `listBlocked()`.

### Admission API decision (F-01)

Do not export a v3 `listBlocked`, `isFree`, `canReserve`, `candidateEffectBlocked`
or public unguarded `reserve`/`advance` surface to task/UI consumers. V2 exports
remain unchanged and cannot be injected into a real v3 consumer. V3 persistence
and any SQL blocked index are private to the enrolled coordinator. Diagnostics
may describe a record's historical state but return no availability boolean or
permission token. A caller cannot read a decision and later invoke an effect.

The single admission entry point accepts the proposed operation, acquires the
enrolled owner fence, obtains authenticated fresh anchor/enrollment/custody
observations, validates the complete atomic inventory and all live policy/consent
pins, and records the reservation/checkpoint pair while still holding that fence.
The successful return is recorded state only. The same coordinator retains the
physical session and repeats the required checks before each effect; no reusable
caller-supplied admission object exists. All mutation paths, including recovery,
are internal to this coordinator. A forged object, imported raw store, alternate
coordinator, restart, or stale prior observation must fail before effect contact.
TypeScript module privacy is API discipline, NOT protection against a compromised
host: protected process/storage/issuer ownership remains an activation gate.

### Settlement-evidence core decision (F-02)

Use the following exact canonical JSON core, with no optional or unknown fields,
for `settlementEvidenceDigest = canonicalSha256Digest(core)`:

```
{
  domain: "agent-candidate-settlement-evidence/v1",
  installationId, namespaceId, storeId, kind, operationId, workflowId,
  intentDigest, requestDigest, sourceManifestDigest, workspaceDigest,
  policyBindingDigest, ownerGeneration, guestGeneration,
  controllerIdentityDigest, resourcePolicyDigest,
  priorOutcomeRecordDigest, outcome, resultDigest, verificationPassed,
  observedAt, validUntil,
  contactAccountingDigest, ownerFenceEvidenceDigest,
  processSettlementEvidenceDigest, generationRetirementEvidenceDigest,
  custodyReleaseEvidenceDigest, publicationExclusionEvidenceDigest,
  workspaceSafetyEvidenceDigest
}
```

N-01 decision: include explicit `kind`, exactly `execute` or `publish`, in the
core before freezing this domain in code. Standalone parsing checks the matrix
below; future joined record validation MUST also compare kind with the intent
alongside every other subject/predecessor field. Self-checking shape is not an
authenticated join or permission.

UUIDs use existing lowercase canonical UUID rules; all digest fields use exactly
`sha256:` plus 64 lowercase hex digits. `outcome` is exactly one of `completed`,
`failed`, `cancelled`, `restored`, `stopped-without-result`. Exact UTC millisecond
timestamps must satisfy observedAt < validUntil. N-02 boundary decision:
`observedAt <= outcomeEvent.recordedAt < validUntil` and
`outcomeEvent.recordedAt <= releaseEvent.recordedAt < validUntil`.
Equal observation/outcome/release timestamps are permitted; equality with
validUntil denies. The host's separately bounded settlement policy must enforce
actual freshness. A record's old evidence cannot renew its own validity.
Execute completed/failed requires non-null resultDigest and respectively true/
false verificationPassed. Execute cancelled/stopped-without-result and publish
completed/restored/cancelled require both fields null; a publication's parent
result is already bound in its intent, not falsely presented as a new result.
No other kind/outcome combination is admitted. A quarantine has no release core.

Maximum canonical UTF-8 core is 8,192 bytes, checked before JSON parse; use the
existing passive-input/canonicalJson rules and canonical-wire equality. Missing
fields, empty strings, omitted nulls, duplicate keys, alternative encodings and
oversize inputs deny. No source bytes, paths, stdout, credentials, or variable
arrays occur in this core. Every evidence digest names separately bounded,
authenticated host evidence of that specific role and exact subject/generation;
hash shape, a supplied digest or a task-supplied true flag is never sufficient.
The coordinator must obtain and validate those role-specific evidence bodies,
including every possible contact/descendant, before recording an outcome. Their
authentication, retention and concrete producer contracts remain separate review
inputs, not implicit implementations created by this core definition.

Avoid a new circular hash: priorOutcomeRecordDigest hashes the entire record
BEFORE the blocking outcome is appended. The outcome event binds this evidence
digest. Checkpoint A then witnesses that outcome-containing record. The release
event binds that complete predecessor record digest, the SAME evidence digest,
and A. No evidence core contains the digest of the event that contains it, or B.
Validate the full predecessor relation on read. Before release, require A to be
authenticated-fresh for the current fenced owner; a believed, cached or merely
well-formed A is insufficient. If any evidence has expired or is disputed, retain
the blocker. Do not rewrite old evidence or manufacture a replacement outcome.

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

Generation clarification after review 16cb32e4 (B-02): sequence-zero checkpoint
producerGeneration is the immutable initial enrollment epoch. At sequence >= 1
it is the subject record's immutable intent.ownerGeneration. The existing parser
equality stays unchanged. It is NOT the current coordinator epoch, which belongs
in the authenticated request envelope. A replacement owner cannot relabel an old
row or resume its forward task effects. A separately reviewed recovery protocol
must bind scoped recovery authority, exact enrolled store/head/payload and proven
old-owner physical fencing before permitting bounded old-row stop/settlement
bookkeeping under a fresh envelope. No such authority is implemented by the pure
parsers. Until that gate closes the old row remains blocked. Exact one-ahead
reconciliation repeats committed bytes only; it is not a new recovery transition.
See PERSISTENCE_DESIGN_DRAFT section 3 for the selected design and restrictions.

The independent anchor has a current-owner generation separate from historical
checkpoint producer generations. The owner claim is an authenticated compare-and-
swap on the previous owner epoch, durably recorded before any new-owner ledger
write. Every append, discovery and reconciliation request is authenticated for
that current epoch. Reject old generations, including delayed callbacks. This is
not physical fencing by itself; owner acquisition also requires the actual old
process/task boundary to be fenced and settled.

### Enrollment and epoch location decision (F-03 / F-04 design residue)

N-03 metadata decision: the v3 metadata core is exactly
`{ domain: "agent-candidate-effect-ledger/v3", installationId, namespaceId, storeId }`.
All three IDs use the existing lowercase canonical UUID rule. A future private
store must durably bind every field and compare all four inside every read/write
transaction, not only at constructor time. A metadata parser proves shape only;
it neither creates a database nor establishes enrollment or protects relocation.
Its canonical transport is bounded at 1,024 UTF-8 bytes before parsing.

N-04 approval identity decision: preserve exactly the existing digest core
`{ domain: "agent-candidate-effect-ledger/v1", namespaceId, approvalId }` across
v2/v3 and store IDs. Do not add installation/store/schema fields to this digest.
The enrollment authority's spent-approval commitment format and its durable
version-spanning enforcement require a separate scoped design/review; they are
not implicitly provided by this data-only identity function.

For this first release, prohibit concurrent active v2/v3 stores within one
namespace. V2 remains synthetic/dormant; no production migration, adoption,
coexistence or namespace reset is supplied by v3. There is one protected enrollment
authority for an installation. Its authenticated namespace entry binds exactly
one active storeId and ledger domain, immutable retired-store history and the
version-independent spent-approval commitment. Unknown or conflicting enrollment
denies; making a second empty database cannot create enrollment. A future version
transition requires a separately reviewed, explicit offline continuity protocol
preserving spent approvals/workflows/quarantines; it cannot run both versions or
start a clean history to evade limits. Until that protocol exists, transition of
an enrolled production namespace is unsupported, not automatic migration.

Store the current-owner epoch CAS record IN the authenticated anchor authority's
durable namespace stream, alongside the enrollment binding and checkpoint head,
not in the mutable ledger database or an application-memory flag. The authority
must atomically compare the expected enrollment/epoch/head and persist the new
epoch before acknowledging ownership. Epoch changes preserve the existing ledger
head and immutable checkpoint producer generations. All anchor requests bind that
entry and the current epoch, with fresh authenticated responses; enrollment,
epoch and head must not be assembled from independently stale reads. Unknown CAS
outcome leaves the requester non-admitted until authenticated discovery. No local
fallback and no recreation of a missing anchor entry is allowed.

This selects the logical persistence/ownership boundary, not a physical Windows
implementation. The anchor's backend, anti-rollback root, authentication keys,
old-owner physical fencing and provisioning still do not exist in this packet.
A second file under the same rewritable authority, SQLite WAL, an unkeyed hash,
or an in-memory CAS does NOT implement this decision. B-03 remains OPEN and must
be resolved with independently reviewed physical evidence before real admission.

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
or `listBlocked()` is not sufficient. V2 now has a complete atomic `snapshot()`
API (0c01a442); that is consistent local history, not authenticated freshness.
Production composition must supply the physical boundary without weakening
v2's private validated read-back or treating a snapshot as permission.

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
as migration. Concurrent version coexistence is prohibited for this release;
the authority/continuity decision in section 2 applies across schema versions.

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

Synchronous SQLite, hashing and validation also consume the deadline; reserve
explicit measured overhead with phase costs, then recheck after synchronous work.
No finite allowance guarantees preemption of a blocked event loop or filesystem.
In the current synthetic model, emergency cleanup may start after overallMs and
use another stopMs. `overallMs + stopMs` is only the nominal asynchronous allowance,
NOT a proven wall-clock ceiling: scheduling delay, synchronous stalls and pending
work can exceed it. A real supervisor must independently enforce/observe stopping;
time elapsed alone never releases a fence or converts unknown work into settlement.

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

Historical sequencing decision before the b86e08b follow-up review:
the earlier report allowed synthetic sequencing over unchanged v2, not v3 implementation.
First pin real SQLite crash/reopen behavior and demonstrate why its releasing
predicate cannot substitute for joined admission. Then implement injected-only
pair sequencing with synthetic owner, complete inventory, anchor and policy ports;
no real source, approval, VM, subprocess task or publication adapters. Validate
single-attempt/replay rules and every audit-specified crash cut with exact call
counts. Missing results after v2 possible-effect markers still quarantine.

The targeted review now clears data-only implementation after the clarifications
above. First implement bounded metadata/evidence parsers; complete record/event,
predecessor/A/B joins, checkpoint/inventory and negative tests next. Submit the
completed data-only delta for narrow changed-boundary review before consumers.
No v3 store, admission path or anchor contact follows from this clearance.

Historical pre-review requirement: before v3 record implementation, review the revised release/admission join,
checkpoint/reconciliation protocol, delivery grammar and budget arithmetic. Test
all release cuts, lost versus absent acknowledgments, snapshot rollback and row
deletion, old-owner retries, maximum inventories and clock/deadline failure. An
extra release event alone is an insufficient fix and must fail the negative control.

B-03 physical storage/freshness, authentic host/guest fencing, independent execution,
operator acceptance and W1-W5 remain open. Neither this document nor passing test
models closes those gates. No audit packet is regenerated or published by this edit.
