# Candidate dispatch/publication — S1 decisions

Status: producer design, dormant data implementation only; independent consumer and physical-control gates OPEN.
Date: 2026-09-13. Source baseline: `ebc0059bf3f5663454959ffc13875e3e829531fc`.

The design-v2 report at publisher source `95f0321b4c6b` has been read completely.
Its SHA-256 is `e2dfd6e92949a5bbe9900800d8acc8330537fc2e19e6276897797b4ab6516acb`.
All 68 original members rehash correctly and all 61 audited Git blob identities
match the baseline above. Review is DESIGN + STATIC_SOURCE, not executed or
EXACT_TREE evidence. The immutable packet/report remain separate from this
successor decision document. B1-B4 remain production gates; N1-N7 are retained.

## Transport and lifecycle

Keep the existing v1 65,536-byte preparation/channel denial exactly. It is not a
promise that all 128 paths of length 512 fit. The future complete-source transfer
uses a separately versioned manifest binding all files (including unchanged
read files), exact paths, lengths and digests; no old 64-file import reuse, scope
truncation, or silent canonical v1 rewrite. S1 stores its digest only. The new
transport/parser and physical read-back are not implemented or approved here.

Choose separate pre-publication VM orchestration, not VM verification inside the
existing executor's five-second step. Existing ceilings are unchanged: acquisition
30 s, failed-start cleanup 10 s; verifier acceptance includes result AND confirmed
stop within min(60 s, request timeout), with stop itself capped at 10 s. A future
owner must reserve cleanup/settlement inside its separately defined outer deadline
and stop starting forward work when insufficient budget remains. No new controller
is authorized; the historical 60 s watchdog cannot silently cover the complete
new lifecycle. Five-second timeout can settle during grace; it is not inevitably
quarantine. Short runs can succeed. Add separate timing controls at composition.

A cached result cannot simply be substituted into the old executor: it constructs
its own request and writes before calling its verifier. Publication needs its own
exact subject/observation binding and native-custody review. Never rewrite a result
identity to make an old executor accept it.

## Namespace and acceptance prerequisites

New data domain: `agent-candidate-effect-ledger/v1`. One protected installation
namespace UUID and pinned store UUID; they are not caller-selectable authorities.
The future enrollment must pin this namespace, the sole ledger location/identity,
issuer keys and accepted consumers. Both distinct capability and issuer acceptance
rules are mandatory, not a choice of either. Keys/aliases/rotation must not create
another consumption domain. No keys, signatures, enrollment or verifier exist in S1.

One approval ID is globally unique within the namespace, across operations,
workflows and phases. Digest input is canonical `{domain, namespaceId, approvalId}`;
key ID and phase are deliberately excluded. One `execute` operation consumes one
approval for BOTH transfer and launch, not one consumption per phase. `publish`
uses a fresh approval and operation ID under the SAME namespace and workflow.
Unique `(workflowId, kind)` prevents a second execution/publication within that
workflow. A new workflow never bypasses a retained workspace blocker.

Historical bounded-file-write and remediation contracts/tables/MAC bytes stay
unchanged. This is no migration, shared legacy uniqueness or legacy activation.
S1 has zero consumers. Before introducing any consumer, inventory all issuer,
verify/consume and runtime/export entry points across the complete current tree,
pin disjoint acceptance rules and audit that inventory. Reusing a historical lease
or claiming legacy interoperability requires a separately reviewed bridge.

## Record and transaction contract

Exact DDL is frozen in `src/build-only/windows-candidate-effect-ledger.ts`.
Meta binds version/store/namespace. One operations table stores canonical bounded
intent and append-only-in-record event history; indexed duplicates are checked
against parsed records on every scan. Unique approval identity, operation identity,
workflow/kind and partial unique workspace index share one transaction domain.
The index is on `blocked = 1`, NOT merely non-terminal state.

Immutable intent binds operation/workflow/approval identity, kind, workspace,
policy, candidate, review material, complete source manifest, verification request,
guest image/generation/controller identity and resource policy. Publication also
names the completed execution operation and exact result. Mutable stop/result
observations are subsequent events bound to the immutable intent digest.

Execution: reserved -> source-delivery-possible -> launch-possible ->
result-and-stop-observed -> completed (passed) or failed (not passed).
Publication: reserved -> publication-possible -> completed or restored.
Either kind can cancel only while reserved, or quarantine any non-terminal state.
Unknown stop is represented by absorbing quarantine, not a successful stop.
Completed/failed/restored/cancelled release this ledger's workspace blocker;
quarantine never does. Future host observation determines whether these claims are
true; the store only validates sequencing/binding. Publication reservation requires
a same-workflow, exact-subject, completed/passed execution record in this store.

Each possible-effect event must be committed BEFORE that effect. Exact replay
returns recorded state with `replayed`, never permission to repeat an effect.
No callbacks/VM/file effects inside SQLite transactions. `BEGIN IMMEDIATE` writers
recheck state/uniqueness; exact read-back follows commit. Uncertain write/read-back
poisons that store instance's writes; fresh read-only discovery can inspect durable
state, never infer that missing response means no effect. Physical ownership fencing
and stale-controller termination remain prerequisites before a future dispatcher.

No delete, pruning, refund, reset, quarantine clearing or automatic redispatch.
1,000 lifetime operations, <=32 KiB per canonical record, <=6 events per operation;
quota exhaustion denies. This is a bounded first store, not a production retention
solution: protected archival/continued global spent-ID retention must be designed
before install/long-lived activation. Same-disk snapshot rollback is not detected.

## Gates preserved

Protected guest manager/observer and low-privilege task identities must differ.
Wrapping task stdout, a content hash or VM UUID is not authentic execution evidence.
Host-observed Off is shutdown evidence only. Design the synthetic B1 experiment
before requesting its separate OS/configuration authority. No Defender exclusions,
administrator task token, real task source or original writes are allowed by S1.

S1 tests use only temp SQLite and synthetic identities: transition graph, exact
replay, identity substitution, concurrent writers, commit/read-back loss, cold
reopen, corruption, expiry/clock ordering, limits and persistent quarantine.
No consumer, VM port, launcher, HTTP route, approval signer or publication adapter.
Review exact S1 blobs after local evidence; publication/native custody and W1-W5
remain open independently of these tests.

## Local S1 execution receipt (2026-09-13)

Implemented two build-only modules: `windows-candidate-effect-state.ts` and
`windows-candidate-effect-ledger.ts`. No production barrel, runtime closure,
consumer, provider, VM port or historical authority file changed. Inputs are
bounded and reject proxies before reflection; read-back validates canonical
history, duplicated index fields and publication-parent identity/time ordering.
Known store limits above are logical data quotas, not physical disk/WAL quotas.

Environment: Windows x64, Node v24.14.0, Node ABI 137; installed locked dependencies.
Commands executed locally from the product root:

```
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.test.json
node --test --test-reporter=tap .test-dist/tests/unit/windows-candidate-effect-ledger.test.js
node scripts/bootstrap-audit-source.mjs
node --test --test-concurrency=4 --test-reporter=tap .test-dist/tests/**/*.test.js scripts/tests/candidate-review-http.test.mjs scripts/tests/candidate-crash.test.mjs
```

- Final focused: 18/18 pass; zero failed/skipped/cancelled; 926.2852 ms.
  TAP SHA-256 `a7ecb823a88766df28b044b0faed1de7b7c3f7b7a71f3a346645f795a0ccb600`.
- Final full: 1,788 tests / 1,786 pass / zero failed/cancelled / two skips;
  50,186.5381 ms. TAP SHA-256
  `6e70f4ecc1e540cc62bf101fcb485ce1f37ddb148417e942d16b2b3386087278`.
- Skips are the existing Windows binary-symlink privilege case and deliberately
  non-Windows-only inspector-refusal case. No new ledger test skips on Windows
  or off-Windows; cross-platform execution was not performed.
- Receipts retained in the desktop workspace's ignored `.audit-preparation/`:
  `candidate-effect-ledger-focused-20260913.tap` and
  `candidate-effect-ledger-final-full-20260913.tap`.

Two independent worker connections reproduce same-approval and same-workspace
contention with one reservation. A separate Node process commits a possible-effect
marker then exits 23 without closing SQLite; a new connection finds the same
blocker and exact replay, not a second operation. This is process-exit evidence,
not a physical power-cut, Windows sandbox, or real VM experiment.

The first focused run passed 13/16: three intended after-COMMIT fault cases instead
failed while replacing a non-writable better-sqlite3 transaction property. The
corrected wrapper asserts its fault fires exactly once AFTER the real transaction
has ended; all three now prove retained records, write poison and read-only
recovery. This was a test-harness correction, not an independently audited pass.
An intermediate full run passed 1,785/1,787; the final numbers above supersede it
after passive-input hardening and the extra process-exit case.

Still required: independent S1 contract/source review; protected identity/enrollment
and consumer inventory; complete source transport; scoped Windows control-plane
experiment; separate original-publication adapter/approval gate; production store
retention/restore rules. S1 records trusted-host observations as data, not proof
that those observations occurred. All release stages W1-W5 remain open.
