# V3 review N-3 — complete pairwise schedules and ordering controls

2026-09-16. PRODUCER SYNTHETIC TEST EVIDENCE, not independent execution.
Base `907f8962e92309675449bdc8d5a29e9bcb062089` plus the new named test file.
No production module or canonical wire is changed in this delta.

## Exact additional scope

`tests/unit/windows-candidate-v3-pairwise.test.ts` adds 39 top-level tests:
36 unordered-with-repetition family pairs from the existing eight outcome shapes,
plus workspace reuse, strictly increasing timestamps and duplicate publication.
For each pair, every interleaving of the two complete paths is generated; exact
schedule count is independently calculated with the binomial coefficient and
duplicate schedules are rejected. Two six-step executions have 924 schedules.

Publications have distinct completed/released parents supplied as a fixed serial
prelude. Parent execution is NOT included in the pairwise permutation claim.
The pair suite uses one A-arrival mode (release), equal timestamps and fixed IDs
per role; it does not enumerate arbitrary fields, all ID assignments or all
parent/child histories. The separately retained bounded three-row matrix and
quarantine/outcome A-arrival controls cover different dimensions.

Every generated prefix is checked by full reference replay and by a model booted
at genesis. For each schedule, a rotating nonempty cut is bootstrapped and then
continued to the end, comparing head/root/count/lastAt/historical-A and final
summary. This is NOT every cut of every pair schedule. The existing bounded
three-row suite continues to check every cut of its own declared paths.

Additional observed diagnostics: **36 pairs / 6724 schedules / 84146 reference
prefixes / 39195 resumed appends**. Counts are separate from the historical
3774/25416/80052 matrix, not a correction or retroactive enlargement of it.
The full reference and incremental predicate share lower-level parsers; their
agreement is not independent correctness or authenticated history.

## Targeted ordering cases

- Two distinct execute approvals/workflows reuse one workspace only after the
  first execute is released. Every bootstrap cut succeeds for the full valid
  history. Introducing the new reservation immediately before release denies in
  the reference and incremental API, then permanently latches the instance.
- Two fully progressing interleaved executes use strictly increasing global
  times. Outcome cores and predecessor hashes are independently rebuilt to match
  the new times; the test asserts exact lastAt at all twelve prefixes and tests
  every nonempty bootstrap cut. It does not merely retimestamp a malformed core.
- A second publication after the first is released uses a distinct approval ID
  but the same parent workflow. Reference and incremental paths reject it; the
  legitimate unrelated reservation remains valid, but cannot revive the denied
  instance. This exercises workflow/kind uniqueness, not just simultaneous
  workspace exclusion or duplicate approval identity.

Negative cases assert CandidateV3DataError, not an arbitrary exception, and a
subsequent valid append also denies. No private state injection, real store,
source transfer, VM, approval issuer or task effect is used.

## Execution and limits

Test compilation and no-emit typecheck passed. First targeted smoke: 4/4 pass,
zero fail/skip, 19904.5576 ms, including all 924 schedules for pair 0/0.
Expanded focused suite: 124/124 pass, zero fail/skip, 195620.4788 ms.
Full offline suite: 2056 tests / 2054 pass / zero fail / two skips,
221073.7742 ms. The two skips are unavailable Windows link-creation privilege
and the deliberately non-Windows-only inspector refusal test on this Windows host.
Selected source/compiled identities remained unchanged before and after both runs.
These are functional synthetic runs, not production performance benchmarks.
Each verification-helper child has a predeclared 480-second timeout, not a
production latency or total-machine resource guarantee.

The N-3 additions satisfy the requested bounded test expansion. They do not close
physical B-03/W1-W5, general unbounded equivalence or consumer admission. Next
narrow GitHub review combines these controls, N-1/N-2 fixes, the preserved report
and V3_COORDINATOR_PAIR_DESIGN. No packet is published by this document.

## Retained executed evidence

Run window: 2026-09-16T16:18:37.947Z through 2026-09-16T16:25:34.783Z,
win32 x64 / Node v24.14.0. Exact copies are retained under
`docs/reports/v3-pairwise-20260916/` with Git text conversion disabled.

| Artifact | SHA-256 |
| --- | --- |
| v3-pairwise-20260916.focused.tap | `91c3a83efe1cec82724e04a6ffdaa01ff0f91992dd587face09e9ed4913d353d` |
| v3-pairwise-20260916.full.tap | `dcc9ac7fe877041d6601b647400e03cbcab12452e68cd9dd78e1a5592d29d5e1` |
| v3-pairwise-20260916.json | `8d0a1f87e9bca8f03db596c21d1d1df584291eb9d2d4809684c8ede44e41ec39` |
| verify-v3-pairwise.mjs.txt | `390eff634869f861c0484d43d90423ccc7a6c619bb4bb92d7ba00d1e2aaf2662` |

The receipt correctly identifies base 907f896 plus an uncommitted test delta,
not a clean revision that did not yet exist. The helper was also hashed, and
both child exits were zero with empty stderr. Original private paths in the
JSON/helper require explicitly labelled sanitized derivatives in a public packet.
These executions cover pure validation and the existing offline suite, not the
twelve proposed coordinator/physical composition controls.
