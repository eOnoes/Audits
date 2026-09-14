# Synthetic checkpoint-pair sequencing over the unchanged v2 ledger

Status: INJECTED-PORT IMPLEMENTATION, NOT A REAL CONSUMER OR ANCHOR.
Baseline: 6daaa646feb410acb173005cccab03ac794a56ff, plus the source/test identities
below. This advances the synthetic-only slice permitted by the operator-returned
successor audit. It does not implement the proposed v3 state/release schema.

## Implemented boundary

`windows-candidate-checkpoint-sequencer.ts` composes explicit reserve/advance
calls with complete inventory snapshots and injected discovery/compare-and-append.
Before each write it requires matching current inventory and an observed checkpoint;
after the write it requires the exact expected one-record delta, appends one exact
checkpoint and rechecks inventory/ownership before returning metadata. No receipt
grants permission or claims workspace release. No callbacks run inside SQLite
transactions. There is no queue, automatic retry, compensation, repair or restart.

The new formats explicitly use SYNTHETIC domains and authority:none. They are
test contracts, not the reviewed/enrolled production anchor protocol. Empty
genesis is explicit fixture setup; missing discovery never initializes an anchor.
Complete inventory includes terminal/spent rows, verifies each v2 record, store
pins, approval/workflow/workspace uniqueness and publication parentage, then hashes
bounded sorted tuples. It does not serialize all full records into one canonical
JSON tree. Global sequence and operation count are distinct and independently
checked; the head's latest-operation/event/digest must match the inventory.

Every asynchronous port has a monotonic call deadline within the pair deadline.
Late fulfilled replies cannot win merely because a timer ran late. Cancellation,
uncertain writes/append outcomes, clock regression, ownership failure and observed
history drift close the instance. A pending append receives abort on timeout;
late fulfillment cannot reopen it. Reentrant or concurrent calls reject before
new contact. The shared latch is keyed to the SAME ledger object, including
multiple wrappers over it; it is not a cross-process or physical lock.

Exact replay performs bounded inventory/discovery reads, but zero ledger mutations,
anchor appends or forward effects. “Zero ports on replay” must mean zero FORWARD
effect ports, not omission of required freshness reads. Synthetic execution and
separately approved publication are exercised as DATA records only. There is no
delivery, run, stop, original write, approval issuer, source export, subprocess or
VM adapter in this module. The synthetic-only mode literal documents intended use;
it is not a sandbox preventing a malicious trusted host from injecting real code.

## Evidence and limitations

New source SHA-256:
`1a85f5b2ba08856cdf4f2c8174c49906d4d5039319c24317a9f977478132c3d0`.
New test SHA-256:
`56de8888112f624c04509917a305fc73a134a43131e017ca3773f2fbf98a6ff1`.

Windows x64, Node 24.14.0, installed dependencies; producer-local execution:

- Typecheck (`node node_modules/typescript/bin/tsc --noEmit`): exit 0.
- Test emit (`node node_modules/typescript/bin/tsc -p tsconfig.test.json`): exit 0.
- Focused sequencer + release-boundary + ledger run: **88/88 pass**, 0 fail,
  0 cancelled, 0 skipped, 2533.712 ms. Captured TAP
  `candidate-checkpoint-focused-20260914.tap`, SHA-256
  `8deb3ffe92690d886d4b3af9504e92e566766849d3762e0896e9c50ced9f6777`.
- Full established offline run: **1877 tests / 1875 pass / 0 fail / 2 skipped**,
  0 cancelled, 50247.8905 ms. Captured TAP `candidate-checkpoint-full-20260914.tap`,
  SHA-256 `bc629da6dad0630fd9d57e9ed918961b3bb8244517c4c39b9749d5a49b841f93`.
  Command: `node --test --test-concurrency=4 --test-reporter=tap .test-dist/tests/**/*.test.js scripts/tests/candidate-review-http.test.mjs scripts/tests/candidate-crash.test.mjs`.
  The bootstrap creates only the existing gitignored data directory.
- Skips: symlinked binary path case (Windows link-creation privilege unavailable)
  and the deliberately non-Windows managed-inspector refusal case. No new
  checkpoint or release-boundary case skipped. Do not infer physical link coverage.

TAP files are PowerShell-captured local artifacts, not independent execution or
claimed byte-identical pre-capture stdout. The earlier 23-case initial run is
superseded for this source/test delta by the 29 new cases in the focused/full runs.

Real synthetic SQLite files are closed/reopened; deliberate corruption is confined
to disposable fixture databases. Tests cover missing anchor, exact data-only
success, separate publication identity, terminal replay, mutation-response loss,
append persisted/not-persisted response loss, a raw releasing terminal with missing
ack, cancellation, late completion, reentrancy, revocation, deadline reserve,
clock regression, unexpected rows and coherent rewrites/deletion/rollback against
a separately retained fixture root. Maximum 1000-record inventory parses without
the canonical JSON node-limit cliff. New getters/proxies invoke zero traps.

Important assumptions remain explicit:

1. The snapshot port must provide a COMPLETE ATOMIC validated view. The real v2
   ledger still has no public all-record snapshot API; listBlocked/remembered IDs
   are insufficient. The synchronous fixture has no concurrent second writer,
   which is not a production atomicity proof. No v2 API was changed here.
2. The anchor and current-owner/policy ports are trusted injected test seams.
   Discovery's truth/freshness and checkpoint durability are not established by
   parsed shapes or resolved promises. No host reboot, protected backend,
   independent durable anchor, owner-CAS acquisition or authenticated channel ran.
3. Separate ledger objects/processes can bypass the in-memory shared latch. Sole
   enrollment and physical fencing are future host obligations. Re-instantiation
   is not reconciliation; a new owner must fence and authenticate both histories.
4. Append uncertainty blocks; this module supplies NO reconciliation write API.
   The new-owner envelope and bounded exact historical-payload reconciliation in
   CONTRACT_V3 still require their changed-boundary review and implementation.
5. This pairs RECORDS, not real source delivery/launch/stop. Authentic custody,
   all-related-work settlement and current safe workspace release remain absent.
   Returning a terminal checkpoint never releases a physical fence.
6. Byte caps and synthetic deadline caps are not enrolled production sizing. Host
   synchronous stalls are not preempted; no JS timer proves process termination.

## Next integration step

Compose the injected execution/delivery phases around this pair primitive, with
exact attempt latches and crash-cut call counts. Keep v2's no-result quarantine
unchanged. Add the actual bounded complete-inventory port under its own source
review instead of exposing a raw SQL/free-workspace bypass. Obtain the bounded
CONTRACT_V3 release/anchor/delivery review before writing the v3 record schema.
The full W1-W5 release objective, B-03 protection, physical VM preflight, issuer,
independent execution and operator acceptance remain open. No external audit packet
was regenerated or published, no workflow was enabled, and no OS setting changed.
