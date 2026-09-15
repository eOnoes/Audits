# Checkpoint remediation review: disposition and data-only continuation

2026-09-15. Local producer assessment of external DESIGN + STATIC_SOURCE evidence.
Not an independent execution, release acceptance or new effect authorization.

## Received evidence

Claude report audited source `49cd0792e5e7f48fff1798baebaa24e170ac5371` in the
immutable 72-file packet at Audits `0471fe15d4eca6c3dd5d8243fe929eb7a0d9ef05`.
It is actually delivered at the required packet-specific reports path, commit
`b86e08b793bfffd5a47a68c85a3bf99b18a1b017`, blob
`339e7b2c403e943c83ec59f45e882216c1f0389f`:

https://github.com/eOnoes/Audits/blob/b86e08b793bfffd5a47a68c85a3bf99b18a1b017/onoes-agent-checkpoint-remediation-49cd0792e5e7-design-v1/reports/AUDIT_REPORT.md

The local attachment and remote raw blob compare byte-for-byte: 44,733 bytes,
SHA-256 `ac20989a2576a1bf9f600b2e8bc6b4dbe6b976ea016001d42ea6295c54ab82a2`.
Retained privately without modification as
`docs/reports/CLAUDE_CHECKPOINT_REMEDIATION_49cd079_2026_09_15.md`.
The report commit adds only that report; frozen packet inputs are unchanged.
GitHub delivery is verified, unlike the prior browser-capture-only handoff.

All eleven report sections and findings were read. The reviewer identifies
Claude Opus 5 in operator-mediated Claude Code, discloses the same model family
as the preceding reviewer, and explicitly declines fresh independent-second-
opinion status. No subject tests or helpers were executed by that reviewer.
They read the changed boundary and selected context, not every dependency source.
Their hashing/TAP/patch results are reported reviewer observations, not a new
producer execution claim. Current product ledger/contract bytes were compared
with the audited revision before beginning the new delta and were unchanged.

## Gate decision

The report explicitly resolves the earlier F-04 ambiguity:
`V3_DATA_SCHEMA_IMPLEMENTATION_READY: YES` with N-01/N-02 clarifications;
`SYNTHETIC_COMPOSITION_VERDICT: PASS_WITH_FINDINGS`;
`REAL_ADMISSION_READY: NO`; `ACTIVATION_READY: NO`.

The user resumed the existing build goal after receipt. Under that goal, the
next permitted work is data definitions/parsers/negative tests, not a new
production store, enrolled coordinator, issuer, physical anchor or VM execution.
The report supplies review evidence; it is not itself authority to perform
side effects. The completed data-only implementation still needs its own narrow
changed-boundary review before any consumer is composed.

## Findings

| Finding | Disposition and next obligation |
| --- | --- |
| B-01 / physical B-03 | OPEN for real admission/activation. Authenticated fresh storage/anchor, anti-rollback, enrollment, issuer custody and physical old-owner fencing remain absent. Does not block definitions and parsers. |
| N-01 evidence kind | DECIDED: add exact execute/publish kind to the core before implementation. The standalone parser checks the kind/outcome/null matrix. Future record joins must also check kind and every subject field against the bound intent. |
| N-02 time edges | DECIDED: observedAt <= outcomeRecordedAt < validUntil; outcomeRecordedAt <= releaseRecordedAt < validUntil. Equality at validUntil denies. Pure timeline parsing checks supplied historical data, not current time or authenticated release. |
| N-03 metadata identity | DECIDED: exact domain/installationId/namespaceId/storeId metadata core. Parser has no DB. Future persistence must durably bind and recheck all four inside every transaction. |
| N-04 approval identity | PRESERVED: namespaceId/approvalId with agent-candidate-effect-ledger/v1, unchanged from v2 and independent of store/domain. Enrollment commitment shape/enforcement stays separate and OPEN. |
| N-05 trusted clock gap | ACCEPTED LIMITATION of unchanged v2: a misbehaving host clock can change transaction state after preflight. No hostile host protection is claimed. Future private v3 persistence must decide/check the pre-BEGIN transaction obligation; no store is added here. |
| N-06 test labels | ACCEPTED PRECISION: the emptied-store retry is not a surviving-row replay; ordering of identity check before scan is proved by source, not the lock-hold assertion alone. Do not promote these tests into stronger evidence. |
| N-07 deadline disagreement | RESOLVED IN PART: the full-run-plus-full-stop success counterexample is contradicted by unchanged runDeadline checks. Synchronous settlement cost remains a real fail-closed blocker, pinned synthetically. Later local capacity measurements are separate evidence, not this review's execution or production sizing. |
| N-08 baseline header | CORRECTED in the next contract edit: current implementation baseline a6e7eb8, reviewed source 49cd079. Historical commits/packets remain unchanged. |
| N-09 sourceCharacters | ACCEPTED CAPTURE LIMITATION: 72,061 refers to UTF-16 DOM length after CRLF-to-LF normalization, not raw retained attachment bytes. The old browser capture is not reclassified as an original download. |
| N-10 hash-first handoff | OPEN HISTORICAL LIMITATION: the operator received a separate pin message, but Claude reports receiving only the URL without prior pin acknowledgment. No retroactive hash-first claim. Use explicit acknowledged-first sequencing on the next handoff. |

## Report arithmetic corrections (producer checked)

The report repeatedly says four supplied baseline blobs while listing five
hashes; it also says 38 unchanged + five changed + one new among 46 members.
Parsing the actual pinned SOURCE_DELTA.json and enumerating baseline files gives
**40 unchanged + five changed + one new = 46; five supplied baseline blobs**.
The local packet verifier independently checked all five. Retain the report
unchanged and carry this correction alongside it; do not rewrite its evidence
or imply the review repeated work it did not report correctly. These arithmetic
errors do not change the concrete design decision or require a whole-audit redo.

## Data-core implementation scope

`windows-candidate-v3-data.ts` begins the data-only work with primitive canonical
UTF-8 text parsers for metadata, settlement core and historical timeline, plus
the stable approval-identity digest. Schemas are private. Unknown input objects
are never reflected on; byte limits precede JSON.parse. Existing canonical JSON
rules reject duplicate keys, alternate spelling, omitted nulls and extra fields.
Outputs are isolated and frozen. Errors are fixed, without echoing input.

These functions do not validate full v3 record histories, join evidence to an
intent/predecessor, authenticate evidence, prove a complete inventory, verify
checkpoint A/B, consult actual clocks, claim workspace availability or persist
anything. Those missing joins must be implemented and negatively tested next;
no consumer may treat standalone core parsing as those checks. No v2 mutation,
barrel/HTTP/UI/runtime wiring, migration, installation or external transfer.
W1-W5 remain the unchanged production finish line.

## Local executed evidence for the data-core delta

Baseline `a6e7eb86f99bad177634984d7f119fd28026f736` plus this new data-only
module/test and documentation delta. Node v24.14.0 on Windows x64. Typecheck and
fresh test compilation pass. Eighteen new platform-neutral tests include all
12 kind/outcome groups with all six result/null/boolean variants (72 combinations),
every missing/mistyped core field, altered digest commitments, strict wire
encoding, pre-parse byte caps, hostile proxies/accessors and exact time edges.
They compare the approval identity against the actual unchanged v2 helper.
No new tests skip off Windows. This is first implementation testing, not a claim
that an earlier nonexistent v3 implementation reproduced these defects.

Focused six-suite run: **161/161 pass, zero fail/cancel/skip**, 3,309.875 ms.
Full product offline regression: **1,950 tests / 1,948 pass / zero fail/cancel /
two skips**, 48,885.2794 ms. Both existing skips are explicitly retained: Windows
link-creation privilege unavailable and the non-Windows inspector refusal case
intentionally skipped on Windows. They do not satisfy W4's executed link gate.
The full command uses `.test-dist/tests/**/*.test.js` plus the existing synthetic
candidate-review HTTP/crash script suites, not only the unit directory.

Raw TAPs remain in desktop `.audit-preparation/`:

| Receipt | SHA-256 |
| --- | --- |
| v3-data-cores-focused-20260915.tap | `43b7f1d51d615c0eb0557f736d4e5d81bc29797252198015676dafa3ab295ed5` |
| v3-data-cores-full-product-20260915.tap | `9ad93aea7eb48d5cf6f36320025d4759980d7a4f6af2dca1f80f748503e1b749` |

The earlier `v3-data-cores-full-20260915.tap` filename was overly broad: it
contains UNIT ONLY (1,647 / 1,645 pass / two skips, 41,243.805 ms), not the full
product. It remains unchanged and is superseded for full-product claims by the
explicit `full-product` receipt above; its SHA-256 is
`73c2c2d503d2dc374a605c23eea54ea7c782ad19fac51edb6a3d7e135ee2443f`.

New module SHA-256:
`2beda5cf81d018a6b25f43d343ca2347365be19fb9daacafe4f2eefae9f70760`.
New test SHA-256:
`7f7301922da1a41138309840fc48b21dd27f30a5c410ea23612406f6ebc89067`.
Reference search finds only the new test importing the new data module; no
runtime/UI/HTTP/barrel consumer is wired. Local source scan and diff checks pass.
No independent execution, UI rebuild, VM, OS adjustment, new public packet,
provider, authentic evidence, real approval consumption or task effect occurred.
