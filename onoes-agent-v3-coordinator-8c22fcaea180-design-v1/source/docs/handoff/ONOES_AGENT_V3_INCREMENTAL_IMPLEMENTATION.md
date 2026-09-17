# V3 pure incremental claim validator — implementation and verification scope

2026-09-16. PRODUCER FOLLOW-UP; outside delta review RECEIVED, follow-up in
`ONOES_AGENT_V3_INCREMENTAL_REVIEW_DISPOSITION.md`. Historical run below preserved.
Base: `7c3f0c642be888df3af17f0e204dc7b3c74adce3` plus explicitly identified files.
Prior review: `CLAUDE_V3_PERSISTENCE_16CB32E4_2026_09_16.md`.

## Implemented boundary

`src/build-only/windows-candidate-v3-incremental.ts` implements the logical
append predicate and a private validation transcript. Only unit tests import it;
no runtime/barrel/HTTP/Studio/store/worker consumer is wired. Bootstrap must run
the full-history reference; there is no imported state object, reset method,
callback, asynchronous seam, storage, provider, clock or execution capability.
All input is primitive canonical wire. Every result says
`validated-v3-incremental-claim-not-admission`.

The returned frozen API has snapshot, append and invalidate only. append checks
one complete snapshot join, consecutive sequence/prior head, retained row set,
exactly one changed subject, exact one-event extension or zero-event reservation,
old workspace/parent state, global lastAt, retained historical A and immutable
contexts. Derived candidate data replaces the private transcript only after all
checks and frozen result construction succeed. Any exception invalidates it
permanently; all later append/snapshot calls fail with CandidateV3DataError.

This is NOT the protected coordinator S or its commit/append/promotion protocol.
Advancing a pure transcript records only that strings are mutually consistent.
A new instance can accept a coherent caller-supplied forged/rolled-back history;
that expected negative boundary is tested. Instance closure is not durable fencing.
Do not treat this factory, returned summary or checkpoint as a capability. Future
physical composition must stage candidate data separately and confirm its durable
pair under current owner/custody/deadline before promoting authoritative state.
No fake confirm/commit/owner-authentication callback is supplied here.

The future coordinator must capture `snapshot()` before `append()` for its
in-transaction complete pre-state recheck: a successful append immediately moves
the pure transcript to S', so S is no longer exposed by this instance. There is
no rewind. Even a clean pre-write rejection (not only an uncertain commit), or
rejected/malformed read-back, requires invalidation and full fresh bootstrap
under the separately established physical owner; cached S is not a reset token.

## Generated positive matrix

The test fixture constructs records, roots and checkpoint chains independently
of the validators, using the existing canonical hash/fixture primitives. All
eight transition families, every cut and optional quarantine are enumerated.
Each case has three rows. For execute families the other two rows are independent
reservations; for publication they are the completed parent and one independent
reservation. The recursive scheduler exhausts every legal interleaving OF THOSE
BOUNDED PATHS, with publication reservation after parent release. This is not
exhaustive over three arbitrary fully progressing rows, arbitrary timestamps or
every possible history. Thirty additional deterministic cases exercise three
fully progressing rows in round-robin and serial order. Broader combinatorial
coverage is a remaining review question, not silently claimed complete.

Three attachment modes: outcome, release (never before release, including omitted
A forever on unreleased/quarantined rows), and later unrelated step. Once supplied,
A remains supplied. Timestamps are equal to expose structural ordering. Genesis
epoch differs from all operation generations, and each operation retains its own
generation. These are not authenticated owner rotation tests.

3,774 scenarios; 25,416 full-reference prefix comparisons; 80,052 continuation
comparisons after bootstrapping every nonempty prefix. Each comparison asserts
exact head, root, count, lastAt and historical A dictionary, plus immutable output.
Shared row/snapshot/canonical parsers mean agreement is not independent proof.

## Negative controls and guard reachability

Every malformed append asserts CandidateV3DataError (not any throw), permanent
closure, rejection of a subsequent VALID append, and continued reference validity
of that uncorrupted control. Controls span gaps/duplicates/prior heads, row
deletion/replacement/two-row mutation/wrong subject, zero/two-event updates,
new-with-event/insertion, all blocking workspace states, absent/unreleased/only-
post-released publication parent, time regression, late/substituted/disappearing A,
released-row A replacement, core rewrite/removal, duplicate outcome, generation
substitution, malformed/noncanonical wire, proxies/accessors/revoked proxies and
metadata identity mismatch. No caller proxy trap is invoked.

Tests explicitly establish snapshot acceptance before incremental denial for
prior-head substitution, same-count relocation, rehashed two-row changes,
wrong checkpoint subject, skipped two-event/new-with-event snapshots, late A,
already-bound A replacement, released A replacement and rehashed core replacement.
They do NOT claim that every lower-level defensive branch is independently reached:

| Defense | Earlier invariant that may necessarily reject first |
| --- | --- |
| Event-count/new-zero-event/zero-change | Snapshot aggregate sequence plus exact retained rows makes a pure skip fail sequence continuity; insertion may fail record grammar. This does NOT cover prefix equality. |
| Exact prefix of the changed subject (LOAD-BEARING) | No earlier guard necessarily rejects a legitimate next event combined with rewriting a prior evidenceDigest, an intent digest field or reservedAt. The new N-1 controls demonstrate snapshot acceptance, correct length/sequence/prior head, unchanged other row, reference denial and permanent incremental latch. |
| Old workspace exclusion | Complete post-inventory detects unchanged blockers; releasing old row plus reserving new one is a two-change/sequence violation. |
| Old publication parent state | Shared workspace exclusion or multi-change/sequence rejects earlier. Absent-parent history at the first reservation is separately isolated with valid final snapshot. |
| Global lastAt | Snapshot latest-subject and record monotonicity already imply it when retained records are unchanged. |
| Duplicate outcome | Record transition grammar forbids a second outcome. |
| Prior core equality | Core change must change its digest-bound event (assuming collision resistance), also violating exact prefix or unrelated-row preservation. |

Do not weaken the complete snapshot join or inject private unchecked state merely
to manufacture independent reachability. These controls prove public-API denial,
not every individual guard. The explicit duplicate checks remain defense in depth.
The exact-prefix comparison is not one of those merely duplicate checks and
must not be removed on the assumption that the complete snapshot join pins history.

One deliberate differential exception: disappearing previously supplied A on an
unchanged unreleased row is accepted by stateless full replay but denied/latches
incremental continuity. Matching optional A can still arrive later. No equality
claim is made across this intentionally stricter rule.

## Execution and resource evidence

TypeScript test compile passed. Local win32 x64, Node v24.14.0, run start
2026-09-16T04:14:12Z. Focused: 81/81, zero fail/skip, 77354.8834 ms. Full offline:
2013 tests / 2011 pass / zero fail / two skips, 111682.2142 ms. Skips: unavailable
Windows link-creation privilege; non-Windows-only inspector refusal on Windows.
Neither skip establishes filesystem isolation. Matrix diagnostic totals match
between focused and full runs. This is producer execution, not independent review.
Final no-emit typecheck and diff whitespace check passed. Existing source-pattern
scan passed over 1202 files; it is a configured tripwire, not proof of no secrets.

Exact evidence and helpers retained at `docs/reports/v3-incremental-20260916/`:

| Artifact | SHA-256 |
| --- | --- |
| v3-incremental-20260916.focused.tap (19520 bytes) | `630d1f3aa6e860368e5e034f2cf3ce455399491b063f20cfcb5f122f7a103b94` |
| v3-incremental-20260916.full.tap (466591 bytes) | `91a57af71f04ca2811ef2f6a3ffbc5f8a614dd2d18737dcf7e11c51acd1af91e` |
| v3-incremental-20260916.json | `3b2833ebd73013114a47251bc239712514502abf3c35048540a09b22836ba730` |
| v3-incremental-cost-20260916.json | `38b3537cd4b739e57191af86f8d138b2bc7c096d09d96f4e8ead97ee72613184` |

Receipts bind base revision PLUS working-tree delta status (new files are not
falsely attributed to HEAD), before/after source and compiled dependency hashes,
helper hash, timestamps, Node version/executable hash, platform and exact commands.
Selected bytes remained unchanged across each run. Exact helpers are retained
as `.mjs.txt` for static reading. These local files contain private checkout paths;
make labelled sanitized derivatives before any separately approved public audit.

Capacity measurement ran after regressions finished, in one child with a 180 s
timeout and 512 MiB V8 old-space limit (not an RSS limit). Dense corpus: all 1000
reservations first, then all five event rounds; bootstrap at 6000 checkpoints,
append the last release to reach 6001. Every row has a distinct workspace and
historical generation. Conforming final inventory: 6,819,063 bytes.

| Measured work | Observed milliseconds |
| --- | --- |
| Corpus construction (excluded from parse timings) | 12600.1235 |
| Inventory-only parse, five samples | 302.7077, 266.8992, 252.1858, 263.0760, 256.4731 |
| Full checkpoint snapshot join, five samples | 278.3758, 263.2167, 265.1146, 257.6830, 252.3246 |
| Full-reference bootstrap, one sample | 12709.5227 |
| Final incremental append, one sample | 333.2124 |

Peak RSS was 360520 KiB INCLUDING setup and all validations. These are one-machine
samples, not percentiles, a minimum-hardware benchmark or a production deadline.
No SQLite read-back, authenticated anchor/IPC, durable pair, worker cancellation,
physical stop or OS isolation timing is included. Comparison to earlier 18.7–19 s
samples is not a controlled performance improvement claim; only this declared
corpus/run is measured. A real coordinator must budget and supervise all phases.

## Remaining gates

Narrow static review of this implementation, the corrected design, bootstrap
extension, generated and negative tests, and bound evidence. Specifically ask
about the bounded-vs-general interleaving coverage, defense-in-depth branches,
stricter A continuity and pure transcript vs authoritative S distinction.
Pending durable-pair lifecycle/invalidation, epoch envelopes, SQLite crash cuts,
anchor/IPC/executable custody, old-owner fencing, restore/retention/installation,
physical resource supervision, independent execution and operator acceptance are
not supplied by this module. B-03/W1-W5 remain open. No real storage activation.
