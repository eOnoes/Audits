# V3 structural wire ceiling — producer derivation, not C12 acceptance

2026-09-17. This follow-up addresses the arithmetic part of prior model finding
M-6. It changes only research/tests and documentation. The published coordinator
packet at 1cdadb6 remains frozen and does NOT contain this later work. No parser
limit, runtime consumer, physical adapter, owner, worker or activation changes.

## Question and scope

Multiplying the three independent parser caps (32,768 + 8,192 + 4,096) by 1,000
and assuming arbitrary escaping overstates what valid records can encode. These
caps are rejection ceilings, not lengths that every schema can attain. Valid
inner records contain no free-form text, paths, source, diagnostics or payloads.
Their strict fields are fixed ASCII literals, UUIDs, digests, UTC timestamps,
bounded integers, booleans and nulls. Canonical equality rejects whitespace,
alternative escaping, omitted/unknown keys and alternate numeric spellings.

This derivation upper-bounds schema-valid wire lengths. It does NOT replace
input rejection caps: invalid attacker input can still reach the existing much
larger pre-parse ceilings. Hostile-input allocation and CPU behavior remain a
separate resource gate. Nor does a byte ceiling prove fast full-history replay.

## Inspected assumptions and deliberately relaxed construction

The test pins seven LF-normalized source files: effect primitives, V3 data,
record, inventory, messages, local snapshot and canonical JSON. Schema changes
require re-deriving/reviewing the bound, not merely updating a hash to pass.
Normalization permits checkout newline conversion only; receipt identities
separately hash actual executed bytes. AST checks cover every metadata, intent,
event, record, settlement and checkpoint key, including both intent variants.

- UUIDs have exactly 36 printable ASCII characters; digests 71; exact UTC times
  24. None contains a quote, backslash or control character.
- Use the larger publish intent (including executionOperationId/resultDigest),
  six longest events, and the longest state/outcome literals. Both
  source-delivery-possible and result-and-stop-observed are 24 characters;
  stopped-without-result is the 22-character longest outcome.
- Populate all nullable digests/UUIDs; use false (5 bytes) instead of true/null
  (4). Checkpoint eventIndex deliberately uses null (4), not 0..6 (1).
- Checkpoint sequence uses Number.MAX_SAFE_INTEGER (16 decimal digits), and
  operationCount uses 1,000 (4). Use 7,001 checkpoints: one genesis plus at most
  seven structural checkpoints per each of 1,000 rows (reservation + six events).
- No lifecycle reduction is relied on. Six copies of the longest event, a
  publish intent and every populated evidence field cannot coexist legally.
  These objects are deliberate SUPERSETS, not admissible records or test claims.
  Tests assert the real record/settlement/checkpoint parsers reject them.

All inner keys/literals are printable ASCII and inner values need no escaping.
For a canonical wire profile (bytes B, quote count Q, backslash count S), embedding
it as a JSON string yields B' = B + Q + S + 2, Q' = Q + 2, S' = Q + 2S.
Arrays add brackets and commas; objects add quoted fixed keys, colons, braces
and commas. This explicitly accounts for repeated escaping of record strings
inside inventory strings inside a local snapshot, not just one escaping level.
Tests compare that recurrence with independent JSON.stringify on nested examples.

## Conservative results

| Wire | Derived ceiling in bytes | Existing rejection ceiling |
| --- | ---: | ---: |
| Metadata | 203 | 1,024 |
| Record | 5,003 | 32,768 |
| Settlement | 2,181 | 8,192 |
| Checkpoint | 859 | 4,096 |
| Encoded inventory row | 8,553 | No separate row-envelope cap |
| 1,000-row inventory | 8,554,063 | 67,108,864 |
| 7,001-checkpoint history | 6,384,978 | 67,108,864 |
| Complete local snapshot | 16,569,477 | 268,500,992 |

The full snapshot figure is for the local-snapshot envelope, NOT a measured
bootstrap IPC request or a resident-memory ceiling. The test materializes all
1,000 relaxed rows and 7,001 relaxed checkpoints, then calls the actual dormant
local-snapshot encoder; exact byte/quote/backslash counts equal the arithmetic.
That encoder bounds/transports strings; this is not acceptance by the real
history validator. The materialized corpus is intentionally invalid.

All 53 existing legal family prefixes, parsed through the real validators,
separately fit the member profiles; this is regression corroboration, not an
exhaustive proof. The universal bound rests on the inspected strict schemas,
fixed scalar lengths, longest literals and bounded collection counts above.

## Evidence and disposition

Research: tests/helpers/candidate-v3-wire-bound.ts and
tests/unit/windows-candidate-v3-wire-bound.test.ts (seven cases).
Retained producer runs: docs/reports/v3-wire-bound-20260917, including exact raw
focused/full TAP, selected source/compiled identities, runtime identity and UTC
times. Execution results must be read from receipt.json, not inferred from this
derivation. No independent execution or fresh external verdict is claimed.

Executed on win32 x64, Node v24.14.0, source base
527d0f720a9f4412953ccab760fb0b5e09e30c33 with the explicit research delta:
compile passed; focused 143/143, zero skipped/failed (1,428.0258 ms); full 2,138
tests / 2,136 passed / zero failed / two skipped (244,701.0819 ms), completed
2026-09-17T20:40:03.530Z. Skips are unavailable Windows symlink-creation privilege
and the deliberately non-Windows-only inspector refusal case. All 53 selected
source/compiled/config identities were unchanged across both runs. The separate
check-artifacts.mjs read-back verifies the raw TAP, counts, runtime and identities.
Focused TAP SHA-256:
cf12f75a920ecbeb57a7049a276720ad8fd4600bb206eddcaddd11eedd40843d
Full TAP SHA-256:
f03d8dbf068074597229ac13a1f5c5835228282032b8fa761f332f77b23442f7

M-6 disposition: the prior independent-cap Cartesian-product concern is narrowed
by this producer-side structural upper bound; the current valid schema need not
overflow the inventory envelope at 1,000 operations. This is not a tight maximum
admissible corpus, a full resource proof or an outside-reviewed closure.

C12 remains open for valid high-cost/adversarial histories, worst-case invalid
inputs, actual worker/process memory limits, cancellation and descendant stop,
storage/anchor costs, dashboard responsiveness, representative hardware and
independent verification. B-03/W1-W5 and all original release gates remain open.
