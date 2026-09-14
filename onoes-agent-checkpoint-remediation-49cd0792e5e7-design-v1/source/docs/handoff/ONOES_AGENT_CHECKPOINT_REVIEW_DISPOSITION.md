# Checkpoint/execution review disposition — 2026-09-14

Status: EXTERNAL DESIGN + STATIC_SOURCE REPORT RECEIVED; local corrections and
design decisions made; v3 implementation/real admission NOT cleared.

## Source and evidence class

Operator supplied the complete publicly readable Claude artifact:
https://claude.ai/public/artifacts/cc70c0ac-67a5-4dcd-ab2a-df36cb679b66

Report ID: `onoes-agent-checkpoint-execution-0c01a44237fa-static-design-v1`.
Reviewed source: `0c01a44237fa17970e173fd99e2b9db55863e54e`.
Packet: `0d27ba257d09be6bea70baa2234cf42c785b7fe2`, eOnoes/Audits.
Local correction baseline: `4112b690f1022781cc66561f1dc3021d00bab26f`.

All eleven report sections and closing fields were read in the browser. The
report identifies Claude Opus 5 and explicitly declines fresh-second-opinion
status. Model-family identity alone does not establish authorship continuity;
retain the reviewer's uncertainty rather than inventing continuity. It reports
partial source reading, no subject execution, and raw-Git verification of 73
manifest inputs, 51 source identities and five TAP artifacts. Those are reviewer
claims, not new executions by this agent. Verdict: PASS_WITH_FINDINGS /
NEEDS_REVIEW / PARTIAL; synthetic v2/design continuation only.

Delivery is operator-mediated public artifact, NOT verified GitHub report delivery.
The original Markdown bytes have not been downloaded/hashed into this repository;
the URL is not claimed immutable. Do not clean the public packet until the full
report is retained with byte identity and findings/continuity evidence preserved.
No report has been overwritten or uploaded by this disposition.

The report's observed manifest is 7,951 bytes and SHA-256
`8afa0c4ff75a4630991167bc96e81cb4ee26c738544ff47460155a3a450e450b`.
This matches the previously retained publisher pin and the local public-packet
manifest rehashed after receipt. This is post-receipt comparison, NOT retroactive
announce/acknowledge-before-read delivery; the reviewer says that acknowledgment
never reached them. Preserve N-09's procedural limitation.

## Findings and decisions

| Finding | Local disposition | Remaining gate |
| --- | --- | --- |
| F-01 admission API | Accepted design gap. CONTRACT_V3 section 1 now selects private persistence/mutation, no public availability predicate, and a single fenced admission-and-reservation coordinator; no reusable caller permission object. | Targeted design review; then implementation and negative controls. TypeScript privacy is not physical protection. |
| F-02 settlement evidence | Accepted. Section 1 defines the exact bounded canonical core, role-specific evidence bindings, kind/outcome/null rules, expiry and a non-circular pre-outcome -> proof -> outcome -> A -> release -> B order. | Core and producer-evidence contracts need review; authentic physical evidence is not supplied by hashes. |
| F-03 version-spanning identity | Accepted. Sections 2/4 explicitly prohibit concurrent active v2/v3 stores for the first release; one enrollment authority binds the active store/domain and retained spent history. No migration/reset is supplied. | Enrollment backend/continuity implementation and review remain open. Prohibition in prose is not enforcement. |
| F-04 physical anchor | OPEN, unchanged B-03. Section 2 selects the anchor's authenticated durable namespace stream for epoch CAS/enrollment/head, with atomic comparison and no local fallback. | Backend, anti-rollback root, authentication, provisioning and old-owner physical fencing do not exist here. No activation. |
| N-01 object identity exclusion | Accepted limitation. New distinct-wrapper concurrency test shows the wrapper bypasses the object-key latch, but inventory mismatch prevents the first pending caller from writing after the second caller commits. | Same-process test only; enrolled cross-process exclusion remains required. |
| N-02 write identity window | Confirmed and corrected: recheck schema/durability/store identity as first statement under BEGIN IMMEDIATE, before scan or mutation. Four regressions fail before the correction and pass after. | Local source correction, not independently re-reviewed or physical file custody. |
| N-03 synchronous budget cost | Accepted liveness risk; exact proposed counterexample is qualified. Successful run AND stop must finish inside runDeadline, so full separate run/stop budgets cannot produce the report's assumed passed observation. New tests cover this denial and actual synchronous read-back exhaustion after observation. | Measured overhead and physical watchdogs remain necessary; retained blocker is not recovery completion. |
| N-04 emergency allowance | Accepted with correction: overallMs + stopMs is nominal asynchronous allowance, NOT a hard wall ceiling under arbitrary synchronous stalls or delayed timers. CONTRACT_V3 now states this explicitly. | Do not encode that sum as physical stop proof. |
| N-05 all-or-nothing reads | Accepted integrity policy; no partial inventory may drive admission. | Protected diagnostic/reconciliation design remains open; not permission for deletion or repair. |
| N-06 read-back concurrent writer | Accepted under single serialized writer requirement. No weakening to accept a later/foreign record. | Real owner fencing must span mutation/read-back/anchor pairs. |
| N-07 snapshot allocation | Accepted sizing input with qualification: 1,001 x 32,768 is a ~32 MiB raw record-text bound, not total driver/JS heap. There are up to four inventories per pair plus decoded/retained objects. | Measure peak memory/latency; no production sizing claim from this arithmetic. |
| N-08 focused omission | Corrected for this run: all five suites, including eight release-boundary cases, are in the 143-test focused TAP. Historical packet unchanged. | Include them in next packet; never rewrite old receipts. |
| N-09 separate pin delivery | Post-receipt match confirmed above; original ordering limitation retained. | Next reviewer handoff must explicitly deliver pin and record acknowledgment separately. |
| N-10 baseline unavailable | Accepted evidence limitation. Public delta cannot establish unavailable private baseline membership. | Do not claim exact-tree provenance from a supplied patch. |

F-04 is described as activation-only in its detailed finding but is grouped with
all schema blockers elsewhere in the report. Do not silently resolve that
inconsistency as permission. V3 implementation stays gated; the next narrow review
must distinguish a data-model review from physical backend acceptance explicitly.
New design decisions have NOT been approved by this report retroactively.

## Executed local evidence

Windows, installed Node 24.14.0 and TypeScript; synthetic inputs and isolated
temporary SQLite only. No VM, provider, real approval, installer, native service,
source export, OS setting or security-protection change.

The first unprivileged compiler attempt failed to write generated .test-dist
files. Its subsequent stale-output filtered run is NOT evidence. A scoped compiler
retry succeeded before any reproduction claim. Four new write-window tests then
failed against old source: reserve/replay attempted an INSERT after identity
substitution, advance reported missing operation rather than bad identity, and
the supposed in-transaction identity check was reached only during read-back.
After the three-line correction all four passed with zero operation writes before
identity rejection. The contention control observes SQLITE_BUSY on a second
connection while the IMMEDIATE identity check runs. No index/schema format changed.

Final typecheck and fresh test compilation: exit 0.
Focused five suites: **143 pass / 0 fail / 0 cancelled / 0 skip**, 3,434.3871 ms.
Full offline product: **1,932 tests / 1,930 pass / 0 fail / 0 cancelled / 2 skip**,
51,127.497 ms. Seven new tests account for the increase from 1,925. The skips are
the unchanged Windows link-privilege case and the intentionally non-Windows-only
inspector refusal case (the latter still has a bare TAP SKIP; not newly fixed).

Raw TAPs retained in the desktop workspace's `.audit-preparation/`:

| Artifact | SHA-256 |
| --- | --- |
| checkpoint-review-remediation-focused-20260914.tap | 9401c0a1b08c0a5a469d29cb0e00bb01b32407d6bb81c8621b85586fe02f86f8 |
| checkpoint-review-remediation-full-20260914.tap | ae0834b0d86a5b6cb2387dcb41b20c4148cdc15db900a12e75b4a23215fa7722 |

These are producer-executed tests, not independent execution or release evidence.
The focused command explicitly lists effect-snapshot, effect-ledger,
checkpoint-sequencer, synthetic-execution and release-boundary emitted unit suites.
Full command is the existing offline `.test-dist/tests/**/*.test.js` set with
concurrency 4 plus candidate-review-http and candidate-crash script tests.

## Next action

Retain the complete report bytes, then prepare a narrow changed-boundary packet
covering the revised CONTRACT_V3 decisions, this disposition and tested source
delta. Request review of the decisions and residual gates, not another broad audit
of unchanged code. New public transfer needs explicit scoped approval. Do not
regenerate the old 74-file packet. Keep v3 schema, enrollment, real effects and
activation gated; B-03 and all W1-W5 acceptance remain incomplete. The full Agent
goal remains active; these results do not constitute an installable release.
