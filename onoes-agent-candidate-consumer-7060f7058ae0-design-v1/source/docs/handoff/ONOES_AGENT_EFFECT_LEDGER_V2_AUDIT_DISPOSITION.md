# Candidate effect ledger v2 — S1 audit disposition

Date: 2026-09-13. Implementation parent: `3ee6c2bb609c50e69bf9d45a04175a01df062cf8`.
Status: LOCAL REMEDIATION; independent re-review pending; no consumer activation.

## Evidence identity and scope

The complete operator-delivered Claude report is preserved at public audit commit
`06b021f2686dfb161cc8984827b0cb014acb5455`, root `AUDIT_REPORT.md`, Git blob
`824c1d962e072e32cf40c37660747de92309419f` (67,364 repository bytes).
It reviewed packet `2130d72cc3db2304395c964071e11414469e631b`, publisher source
`76dc12a9474d626efcf1944c86f4ffd131bfef2f`. Its claimed model is Claude Opus 5;
prior general project involvement is disclosed. STATIC_SOURCE, no subject tests
executed independently. Four blocking and thirteen nonblocking findings retained.

The report and frozen packet are unchanged. This document supersedes the *current*
S1 implementation description in ONOES_AGENT_DISPATCH_LEDGER_DECISIONS.md, not its
historical records or the outside verdict. B-03, physical-control and consumer
gates remain open. No new approval, signer, port, VM, provider or runtime export.

## Versioned corrections

- B-01: record domain becomes `agent-candidate-effect-ledger/v2`; SQLite meta
  version becomes 2. Mandatory `intent.storeId` participates in canonical intent
  and record hashes, scan identity checks, reservation preflight and parent subject
  matching. A SQL column duplicate is unnecessary: every record is explicitly
  checked against the pinned meta/constructor store identity. Verbatim completed
  rows copied between real stores with the same namespace deny read, writes and
  publication, including after reopen.
- The spent-approval digest deliberately retains domain
  `agent-candidate-effect-ledger/v1` and `{namespaceId, approvalId}`. Store, phase,
  key alias and record version cannot create a fresh spent-ID identity. This does
  NOT coordinate multiple maliciously enrolled stores: sole protected enrollment
  and global historical spent-ID retention are still host gates. Legacy v1 input
  and database schemas deny; no migration/adoption/deletion path is introduced.
- B-02: each bounded scan independently re-derives uniqueness of operation ID,
  approval identity, workflow/kind and blocked workspace. SQL indexes are still
  required. Tests inject individually valid duplicate rows at the driver-result
  seam after a real SQLite read and assert denial from all four access paths.
  This proves application validation, not physical SQLite-index corruption.
- N-07: connection, identity, clock and internal methods use ECMAScript private
  fields. Commit verification calls private read-back, not overridable public
  `read()`. Fault injection now occurs at the driver scan, with exact seam counts
  and durable-row observation. The trusted host still owns the database driver.
- N-12: retain the old simultaneous-start test as outcome consistency only. A new
  worker test runs while the parent retains a real `BEGIN IMMEDIATE` lock, reports
  SQLite `SQLITE_BUSY` and ledger denial, then reserves only after explicit lock
  release. Serialization without observed contention cannot pass this control.

## B-04: two distinct historical runs, not one mismatched result

Both publisher originals were recovered and rehashed during report intake:

| Run | Tests/pass/fail | Duration ms | Raw TAP SHA-256 |
| --- | --- | --- | --- |
| Decision-document pre-commit final run | 18/18/0 | 926.2852 | `a7ecb823a88766df28b044b0faed1de7b7c3f7b7a71f3a346645f795a0ccb600` |
| Fresh run after pinned 76dc12a commit, shipped in packet | 18/18/0 | 1185.3941 | `119918dea2ae0fc98c45f8dd153f1b80d067f88360a59d2a7fcb96b7d64c0f35` |

Each has zero skipped/cancelled tests. `PRODUCER_EVIDENCE.focused.phase` explicitly
says `fresh-compile-and-execution-after-pinned-commit` for the second run. The old
decision document records the earlier run; its word "final" was not a durable
identifier for every later execution. Clarifying this is necessary, but rewriting
either historical file to force identical hashes would destroy evidence. New
packets must label both roles and include this clarification. No independent
execution is inferred from either log. Reviewer acceptance of clarification is
pending; neither original result applies to v2.

## Remaining findings and mandatory consumer rules

| Finding | Disposition |
| --- | --- |
| B-03 | Open host gate. A real SQLite negative control accepts a coherent forged history with matching store ID and recomputed hashes. Protected file/WAL/SHM custody and a separately protected freshness/rollback anchor are required before activation. A MAC alone cannot detect an older authentic snapshot or row deletion. |
| N-01, N-08 | Recording time is bookkeeping, not proof of timely execution. Future host must bind authenticated outcome/stop evidence to the actual run deadline and exact source/result, revalidate current subject/policy at publication, and enforce a separately approved freshness policy. No stale result gets authority from these rows alone. Late failure/quarantine bookkeeping must remain possible. These host checks are not implemented by this store. |
| N-02 | Poison applies to the instance; constructor configures the trusted connection. Fresh connection is permitted for discovery, not automatic dispatch. Durable possible-effect blockers and old-owner fencing govern reconciliation. No new uncertainty write may be attempted after uncertain commit merely to persist a poison flag. Protected restart policy remains open. |
| N-03 | Forward-clock writes can deny all earlier writes until time catches up; now tested across reopen. No reset or arbitrary correction. Future host needs trusted clock sanity and an explicit reconciliation procedure. |
| N-04 | One corrupt row denies the entire store. No partial inventory may authorize effects. Separate protected forensic backup/read-only inspection is an operational prerequisite, not an implemented repair API. |
| N-05 | `replayed` is not permission, including for quarantined records. Future consumers must check complete state and authenticated ownership/authorization; replay can never repeat an effect. New regression pins this. |
| N-06 | Keep `touched` BEFORE save. A thrown write/driver response cannot safely be treated as untouched simply because save did not return. Conservative instance poisoning is accepted; BEGIN contention occurs before this latch and is separately tested. |
| N-09 | Workspace exclusion is once-at-a-time, not once-ever. Completed/failed/restored/cancelled release it; new work requires fresh legitimate authorization and IDs. Quarantine remains blocking. Restoration/reopen/approval-reuse tests pin this distinction. |
| N-10 | Bounded scans retained for independent checks. Parent lookup also contributes cost; do not claim scalable linear performance from 1,000-row fixtures. Production latency/retention acceptance remains open. |
| N-11 | 32 KiB remains a corruption/allocation ceiling, not measured legitimate record size. The reviewer's v1 byte arithmetic is not a v2 measurement and is not reused. |
| N-13 | Added coherent-forgery boundary, four duplicate-row controls, successful publication restoration, all six pragma drifts, ATTACH, forward-clock, oversized input and seven-event denial; retained crash/reopen tests. Physical corrupt-index, power-cut, POSIX and protected-host evidence are NOT established. |

Do not weaken quarantines, auto-prune spent approvals, migrate v1 or activate a
consumer to make these tests pass. Re-review the changed record/scan/read-back
boundary before composition. The Windows release W1–W5 acceptance criteria remain
unchanged and unfulfilled.

## Current producer verification

Windows x64, Node 24.14.0, installed locked dependencies; no install or provider.
Typecheck and compile passed. Initial compile in the restricted execution context
failed to write .test-dist (EPERM); the authorized local compile then succeeded.
An earlier test-source typecheck found index-signature dot access and was corrected
before any claimed successful test run. No OS permission setting was modified.

Final focused capture: 39 tests, 39 passed, zero failures/skips/cancellations,
2716.74 ms. Raw TAP `candidate-effect-v2-focused-20260913.tap`, SHA-256
`45085069ae1ba3d99d76603097f7dadcab7abe4432d567afeb3fb57317041afe`.
Full offline capture: 1,828 tests, 1,826 passed, zero failures/cancellations,
two platform/privilege skips, 52591.2505 ms. Raw TAP
`candidate-effect-v2-full-20260913.tap`, SHA-256
`8040823cbd7d32313a64eecc4db8c8212f7777fed9b2a28f672683020094309e`.
These are producer executions, not outside audit or packaged release acceptance.

Commands actually run from the product root with the installed Node binary:

```text
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.test.json
node --test --test-reporter=tap --test-reporter-destination=<focused-TAP> .test-dist/tests/unit/windows-candidate-effect-ledger.test.js
node scripts/bootstrap-audit-source.mjs
node --test --test-concurrency=4 --test-reporter=tap --test-reporter-destination=<full-TAP> .test-dist/tests/**/*.test.js scripts/tests/candidate-review-http.test.mjs scripts/tests/candidate-crash.test.mjs
```

The test reporter wrote each new capture in the publisher's local preparation
directory. Historical TAP was not replaced. No GitHub Actions ran.
