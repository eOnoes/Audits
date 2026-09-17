# V3 incremental review — receipt and remediation

2026-09-16. Producer disposition, not independent execution or activation.
Working base `7775873611e4be4aa7046dfa7d382c60a3b39d7f`.

## Exact received report

Original retained as `docs/reports/CLAUDE_V3_INCREMENTAL_82C8664_2026_09_16.md`.
30,667 bytes; SHA-256
`9bdebf232b4d963bf92844b339a8a40cbaab7924cf6bc1b4ac37f7bbebf936c1`.
Audit ID `onoes-agent-v3-incremental-82c8664434c7-static-v2`; subject
`82c8664434c7ecefcbb54b87984828c28fbae595`. Same Claude reviewer as the prior
design report, not an independent second opinion. STATIC_SOURCE only: subject
tests not run by reviewer. Reviewer verified manifest/member identities and
derived matrix counts, but did NOT receive the separate advance manifest pin.
That delivery-order gap remains; later self-hashing does not retroactively fix it.
Frozen packet members and historical execution receipts are unchanged.

## Findings

| Item | Disposition |
| --- | --- |
| B-01 / physical B-03 | OPEN. No real store, anchor, owner, worker, consumer, installer or activation follows from the static review. W1-W5 remain open. |
| N-1 | Added six snapshot-valid subject-prefix rewrites: earlier evidenceDigest; authorizationDigest, candidateDigest, reviewMaterialDigest and guestImageDigest with rehashed intent; and reservedAt moved earlier within valid bounds. Controls assert one extra event, matching sequence/prior head, unchanged other row, reference rejection, typed incremental denial, permanent latch and an independently valid successor. Documentation now calls exact-prefix equality load-bearing. |
| N-2 | Added positive A-first-on-quarantine controls for all eight outcome families, including both publication parent histories and nonempty bootstrap cuts. Added snapshot-valid wrong A in the very same outcome frame, with reference denial and permanent latch. |
| N-3 | Added in the subsequent test-only delta: all 36 fixed-shape family pairs, 6724 complete two-subject schedules, same-workspace execute reuse with pre-release denial, increasing positive timestamps and second-publication rejection. See V3_PAIRWISE_COVERAGE for exact limits and separate counts. No general exhaustive claim or physical admission follows. |
| N-4 | One frozen CANDIDATE_V3_OUTCOME_STATES tuple now feeds record grammar, bootstrap and append. Exact historical record enum order is retained; a literal/frozen test pins it. Fixture construction deliberately keeps an independent literal set to avoid certifying itself from the production constant. No wire or accepted outcome set changes. |
| N-5 | Implementation and design explicitly require capture-before-append, in-transaction complete pre-state recheck and invalidate/rebootstrap even after clean pre-write rejection. No rewind/commit API added. |
| N-6 | Accepted evidence limitation; producer runs do not establish independent execution. |

No source defect was alleged in the predicate and none is inferred from the new
controls. Their purpose is to stop future removal of a necessary existing guard.
The constant consolidation is the only production-code change in this follow-up.

## Next boundary

N-3's bounded expansion and the proposed coordinator capture/recheck/stage/
promotion/invalidation contract are now specified in V3_PAIRWISE_COVERAGE and
V3_COORDINATOR_PAIR_DESIGN; the latter's composition controls remain NOT RUN.
Prepare the next narrow combined review. Eddie requested GitHub delivery
because he is remote. Prepare a sanitized exact packet, confirm its public scope,
check workflow activation and publish only with applicable scoped authorization;
return one immutable request link. Do not upload the full project, private logs,
credentials or raw private-path receipts. No public packet has been published by
this remediation. The report-only write contract remains required.

Whole-PC restore scope still awaits the operator decision. It does not block
these pure regressions/design work, and it is not silently accepted or excluded.

## Local verification

Focused new controls: 4/4 pass, zero fail/skip, 973.1536 ms on Windows/Node.
TypeScript test compilation passed after sandbox-denied output writes were retried
with scoped permission. Final no-emit typecheck and whitespace checks passed.
Producer run 2026-09-16T16:09:04Z–16:12:27Z, win32 x64 / Node v24.14.0:
focused 85/85, zero fail/skip, 82900.0189 ms; full 2017 tests / 2015 pass /
zero fail / two skips, 119946.456 ms. Skips remain Windows link privilege
unavailable and the intentionally non-Windows-only inspector refusal. Neither
skip proves physical confinement. No VM, service, installer, provider, actual
approval or task effect was exercised.

Exact artifacts retained in `docs/reports/v3-incremental-review-fixes-20260916/`:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| v3-incremental-review-fixes-20260916.focused.tap | 20454 | `ebd7513f8a984f0c09e84f714bd5dfa0fd6e8918c4d56fd6da300237b9f273c3` |
| v3-incremental-review-fixes-20260916.full.tap | 467586 | `33eb4459c5c2dbaa65c43e535d6890ad6eeb3a1947e26d32a9741c264eb60bde` |
| v3-incremental-review-fixes-20260916.json | 47880 | `05017d1c3018c1891915c38fb42e57006a97fc02c555f0f5372f22ea4e268411` |
| verify-v3-incremental-review-fixes.mjs.txt | 4506 | `0797ab8a3778c0d910300ff6f5024e123b3ce389f5852fa732230ddfbf4c5f68` |

The JSON records commands, timestamps, exact base PLUS working-tree-delta status,
Node/helper identity and before/after source/compiled dependency hashes (unchanged).
This identifies the tested bytes, not a fictitious clean commit. Artifact copies
were byte-checked. Original private paths remain in these private receipts/helper;
a future public packet must use explicitly identified sanitized derivatives.
The prior 3774-scenario matrix totals are unchanged; added targeted cases are not
retroactively included in those historical counts. All results remain producer
evidence, not the reviewer's independent test execution.
