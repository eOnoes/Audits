# Complete atomic v2 ledger snapshot

Status: implemented and producer-tested; no production consumer or v3 storage.
Baseline: `9af4f055b0e0f0dde22d6e337db9cc989752bd49` plus the delta pinned below.
Evidence date: 2026-09-14 UTC.

## Scope and meaning

`SqliteCandidateEffectLedger.snapshot()` returns the complete immutable v2 record
array in operation-ID order, including spent approvals, releasing terminals and
quarantine. It uses the private scan, never public `read()` overrides or
`listBlocked()`, remembered IDs, per-record transactions or pagination. It returns
recorded state only: no permission, anchor, liveness, custody or freshness claim.

The shared private read path now rechecks schema, connection durability and store
metadata INSIDE the deferred read transaction before scanning records. The existing
preflight remains outside, including denial of caller-held transactions. Thus all
public reads and post-write private read-back receive this additional same-snapshot
identity check. No v2 table/index/record/signed-byte format changed. Write admission
and its existing preflight/IMMEDIATE transaction ordering are otherwise unchanged.
This is not an atomic ledger-plus-external-anchor transaction.

The existing SQL scan returns at most 1,001 rows as an overflow sentinel and bounds
each record's encoded bytes to 32,768 before returning its body through the driver.
Oversized/non-text bodies become NULL and fail validation; more than 1,000 rows
fails rather than truncates. Each row is canonically parsed, rehashed, replayed and
matched to its indexed columns/store/namespace; all cross-row operation, approval,
workflow and blocker constraints and publication parentage are re-derived. A bad
row makes the entire snapshot fail. This is a bounded local object read, not a
new serialized transport or a promise of a 32-MiB JavaScript heap ceiling.

There is no injected clock/callback, write, repair, pragma normalization, retention,
refund or automatic retry in the snapshot API. Existing trusted connection/host
assumptions remain. A SQLite snapshot is consistent at its read point, NOT proof
that another writer cannot commit later. Protected exclusive ownership and fresh
ledger/anchor joins remain necessary before any real effect or workspace release.

## Integration and falsifiable evidence

The checkpoint-sequencer and synthetic-execution fixtures now call this real
snapshot API instead of selecting IDs and reading them one-by-one. Their anchor,
ownership, delivery/run/stop and consent facts remain synthetic. No runtime,
HTTP, VM, issuer, source transfer or publication consumer was enabled.

15 new tests use real disposable SQLite files on Windows. They cover:

- Complete deterministic history, immutable arrays/nested records, valid publication
  parentage, no clock/write/public-read/filter calls and independent returned copies.
- A second WAL connection committing cancellation AND another reservation between
  the reader's pinned identity and operation SELECT. The first snapshot remains the
  old state; the next sees both commits. The test asserts the reader transaction
  is open and the second connection's commits finished before the row query.
- Identity change after preflight/before the read snapshot (including empty stores)
  denies; identity change plus row deletion during a pinned read preserves the old
  consistent snapshot, while the next read denies mismatched identity.
- 1,000 completed records compose with the synthetic checkpoint inventory digest;
  a 1,001st fails without hidden truncation. This tests maximum operation count,
  not an invented maximum-size legal history or a performance release threshold.
- Whole-inventory rejection for malformed JSON, oversized body, BLOB body, digest
  drift, blocker drift, store substitution and missing publication parent.
- Nested transactions, ATTACH/temp schema, durability drift, closed connection and
  read failure; failed reads release their own transaction without rolling back a
  caller transaction, modifying rows or consulting the clock.
- A negative control: coherent terminal deletion yields a changed complete digest
  but a valid empty SQLite snapshot. Only a separately retained authentic checkpoint
  can detect that missing history. This does NOT close B-03.

The existing four cross-row duplicate-driver controls additionally exercise the
new snapshot entry point (five checked access paths each). These substitute driver
results from real rows; they do not claim physical SQLite index corruption.
The interleaving tests use test-only driver hooks and a real second connection,
not background processes, host power cuts or independent execution.

## Executed producer receipts

Windows x64, Node 24.14.0, installed locked dependencies. Typecheck
`node node_modules/typescript/bin/tsc --noEmit` and fresh test emit
`node node_modules/typescript/bin/tsc -p tsconfig.test.json`: exit 0.

Focused four suites (snapshot, ledger, checkpoint sequencer, synthetic execution):
**128 tests / 128 passed / 0 failed / 0 cancelled / 0 skipped**, 2921.6132 ms.
Captured artifact `candidate-effect-snapshot-focused-20260914.tap`, SHA-256
`25df68c1611c6733624a9bc9a4f1da86452b5399431850ef4782b9e1d0d11c4f`.

Full established offline suite: **1925 tests / 1923 passed / 0 failed /
0 cancelled / 2 skipped**, 49418.685 ms, exit 0.
Command: `node --test --test-concurrency=4 --test-reporter=tap .test-dist/tests/**/*.test.js scripts/tests/candidate-review-http.test.mjs scripts/tests/candidate-crash.test.mjs`.
Captured artifact `candidate-effect-snapshot-full-20260914.tap`, SHA-256
`a20dfde35e2649783eabbe8d12338c883067f2f2c3a2555b515449ccc12d5287`.
Skips are unchanged: Windows link-creation privilege unavailable for the symlinked
binary case; intentionally non-Windows inspector refusal test skipped on Windows.
All new snapshot cases executed. TAPs are local PowerShell capture artifacts, not
independent execution or a claim of byte-identical pre-capture stdout.

| Source/test | SHA-256 |
| --- | --- |
| src/build-only/windows-candidate-effect-ledger.ts | 3e0b35c0c49d622d3823cf358901865acff197510aa4c0c218888c654c0a8a38 |
| tests/unit/windows-candidate-effect-snapshot.test.ts | 799fe4d6e401e0e70d239e4e6814c6bbb7548b767a32499b28f00dd0df3d02bd |
| tests/unit/windows-candidate-effect-ledger.test.ts | 64f00176f354439b76b3b81ea8ebda09000306ff55a7ff40653e28b802b7f475 |
| tests/unit/windows-candidate-checkpoint-sequencer.test.ts | 7e6150af627ee074fbc871dca400a58bdffcb33803b33e5c276a9d1eca330d32 |
| tests/unit/windows-candidate-synthetic-execution.test.ts | 96484d44a70b670a33f7b8cc29756cea6bc258195d67a7938e9fe077e0d11eb8 |

## Next boundary

Prepare a narrow local review packet of CONTRACT_V3's proposed durable release
join, synthetic checkpoint/execution composition and this additive ledger read
boundary, with exact dependencies/deltas and current test artifacts. Obtain the
selected service/sanitized scope approval before external transfer; historical
public-packet approval does not cover this new source. Review must precede v3
storage or real host composition. Physical protected storage/anchor/fencing,
VM preflight, real approval/enrollment, original-file publication, install/upgrade/
rollback, independent execution and W1-W5 acceptance remain open. This step made
no OS, VM, provider, workflow-setting or public-audit changes.
