# Synthetic delivery/execution composition

Status: INJECTED SYNTHETIC PORTS ONLY; no production consumer or v3 state schema.
Baseline: dcdfc5e39fd5fe3c6c16d8faa01b119b0f021ecd plus the identities below.

## What changed

`SyntheticCandidateExecution` composes the existing v2 checkpoint sequencer with
ready, deliver, run and stop test ports. An initial recorded reservation precedes
readiness; a confirmed source-delivery marker precedes delivery; a matching stored
acknowledgment and confirmed launch marker precede run. A genuine bounded
verification result is recorded only after matching stop evidence and settled
task-port promises. Exact v2 replay invokes no lifecycle port and cannot resume
an abandoned partial attempt. Publication is NOT an execution port here.

Input requires a genuine branded verification request, its complete canonical
source manifest and an exact execute intent. Store/namespace, operation, request,
policy and source identities match before contact. A new SYNTHETIC resource-domain
digest binds the actual explicit ready/delivery/run/stop/checkpoint/overall limits;
it is not a real enrolled resource policy or approval envelope. The checkpoint
model now exposes immutable descriptive identity pins so a mismatched lifecycle
owner is rejected at construction. This getter changes no record or checkpoint
format. V2 ledger schema, state transitions and historical approvals are untouched.

The single-use latch precedes injected clock/policy callbacks, not merely awaits.
The same lifecycle-port object cannot be used by a second wrapper. These in-process
latches are not process fencing, and separate port objects do not establish
independent physical ownership. Ready observes an ALREADY acquired fixture; it is
not permission or code to boot/acquire a VM.

Stored metadata binds the operation/owner/guest/controller/request/manifest,
complete counts and OCS1 byte length, and a destination inventory digest. The
fixture computes that digest from reread owned destination copies, retains those
copies through fixture verification, checks them again at run, then clears them
on stop. Hash agreement is not protected destination custody or authenticated
origin. In a real adapter, task-generated/echoed digests are insufficient.

## Failure and cleanup semantics

Every checkpoint response loss stops forward progress and permits no guessed
checkpoint, compensating terminal or automatic retry. Lost terminal acknowledgment
never releases a result even if the raw v2 row now says completed. An uncertain
checkpoint remains the checkpoint model's closed state.

Caller abort, malformed readiness/storage/result, expiry, revocation and deadline
failure trigger at most one bounded stop attempt after lifecycle contact. Cleanup
ignores caller cancellation but does not acquire fresh forward authority. It uses
native monotonic time for its own bounded interval so failure of the injected
workflow clock cannot prevent the stop attempt. The internal unbounded absolute
sentinel is always clamped to the explicit finite stopMs; no unlimited policy value
is accepted. Host synchronous stalls still cannot be preempted by JavaScript.

Missing any required stop fact, an unsettled forward Promise or an uncertain stop
withholds results and leaves durable reconciliation/blocker state. Returning a
needs-reconciliation METADATA result does not claim the underlying work settled.
Late completion cannot restart this one-shot coordinator. A genuinely failed
verification remains failed; invalid/missing results are never invented as pass.
After a possible-effect marker, the unchanged v2 schema still quarantines missing
results even when synthetic stop evidence is valid. Before possible delivery,
confirmed cleanup can record v2 cancellation. No v2 quarantine is reopened.

Success requires run AND confirmed stop before the run deadline, without extending
that deadline through cleanup time. Failure cleanup has its own bounded interval.
Scope/policy validity is rechecked before forward contact and before disclosure;
post-expiry terminal bookkeeping is not forward permission. Once outcome settlement
starts, subsequent errors cannot issue a compensating terminal write. Output is
content-free with authority:none and physicalCustodyEstablished:false.

## Executed evidence

Producer-local Windows x64 / Node 24.14.0; installed dependencies; typecheck and
fresh test emit both exit 0. No subject source changes occurred after these pins:

| File | SHA-256 |
| --- | --- |
| src/build-only/windows-candidate-synthetic-execution.ts | 93ea6ed00619b8d078a966f54aa73332e697e6516a2aae47225ccfe53f7be255 |
| src/build-only/windows-candidate-checkpoint-sequencer.ts | 1ba5b080ef924255492c6feeb2d861614e3cb2cdd30ae73d5e2e949bcb94560f |
| tests/unit/windows-candidate-synthetic-execution.test.ts | ae8d16230d125faaed540617915fa075d193b30b99d41b776ab49647a888f217 |

Final focused run includes execution, checkpoint, release-boundary, ledger, source
manifest/transfer and managed-verifier suites: **166/166 pass**, 0 fail/cancel/skip,
2813.5377 ms. Captured TAP `candidate-synthetic-execution-focused-final-20260914.tap`,
SHA-256 `84099d43d132cd09855d568c77f35fb1500cb3c7d4f5ac0a1d1580a891410e7d`.

Full established offline run: **1910 tests / 1908 pass / 0 fail / 2 skipped**,
0 cancelled, 48343.0387 ms. Captured TAP `candidate-synthetic-execution-full-20260914.tap`,
SHA-256 `a1ca7379136509c4e1958470445508bdcc3ff75623e5318deae466bbc218d6b3`.
Command: `node --test --test-concurrency=4 --test-reporter=tap .test-dist/tests/**/*.test.js scripts/tests/candidate-review-http.test.mjs scripts/tests/candidate-crash.test.mjs`.
Skips remain the symlinked-binary case lacking Windows link-creation privilege and
the deliberately non-Windows inspector refusal case. No new execution case skipped.
Captured TAPs are local PowerShell artifacts, not independent execution or a claim
of byte-identical pre-capture stdout. Initial/intermediate runs are not these final
source/test receipts. Historical checkpoint-only receipts retain their old pins.

The 33 new cases exercise actual OCS1 framing/receiving in memory, including all
128 maximum-length paths and 16 MiB of synthetic source, BOM preservation,
destination retention and drift, every normal checkpoint acknowledgment-loss cut,
missing stop facts, pending/late delivery or stop, each phase's cancellation,
resource/owner/store substitution, reentrancy, scope expiry, broken injected clock,
late-stop denial, result identity/size and legitimate failed verification. SQLite
files really close/reopen, but there is no process restart, power cut or VM test.

## Remaining production work

This is not a serialized session/channel implementation. Existing run/stop frame
counts and 65,536-byte request limits are unchanged. The maximum request test uses
an in-process genuine request object, NOT proof that the old transport can carry
it. Versioned real framing, authentication, destination custody, independent stop
and resource sizing remain separate review/implementation work.

The test runner returns synthetic verification records after checking retained
bytes; it does not execute an allowlisted compiler or prove genuine independent
verification. No approval issuer, key, consent capture, real source reader,
subprocess task, VM controller, original write, publication adapter or installer
was activated. The full atomic inventory port remains injected; the test fixture
has no concurrent writer during synchronous collection. Replace that assumption
with a reviewed real snapshot API before host composition.

Next: implement and test the bounded atomic ledger inventory read, then package
the changed synthetic/CONTRACT_V3 boundaries for the appropriately scoped next
review before implementing v3 storage or any real consumer. External transfer
requires its own selected-service/sanitized-scope approval. B-03, physical fencing,
VM preflight, real enrollment, independent execution, installer/operator acceptance
and W1-W5 all remain open. No OS, provider, VM, public audit packet or workflow
setting changed in this slice.
