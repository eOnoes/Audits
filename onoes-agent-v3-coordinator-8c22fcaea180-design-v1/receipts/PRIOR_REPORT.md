# Audit Report — Onoes-Agent v3 pure incremental claim validator and bootstrap / onoes-agent-v3-incremental-82c8664434c7-static-v2

## 1. Executive Summary

This is the narrow STATIC_SOURCE follow-up requested by the prior report's §10 item 5, over the local packet for publisher product `82c8664434c7ecefcbb54b87984828c28fbae595` (baseline `16cb32e4aa2c…`). All 41 manifest members verify; all 21 SOURCE_IDENTITIES members reproduce SHA-256, byte length and Git blob OID; the SOURCE_DELTA.patch reproduces every changed file hunk-for-hunk and every added file byte-for-byte; the producer test receipt's 14 source identities equal the packet bytes; both TAP hashes match; and the generated-matrix counts in the TAP (3,774 scenarios / 25,416 prefixes / 80,052 continued appends) equal my independent derivation from the generator structure. Every design-text correction required by the prior report (B-02 generation semantics, N-A bootstrap extraction, N-E context disappearance, N-F taxonomy, N-G ordering, N-H single join) is applied. The new module `windows-candidate-v3-incremental.ts` is, by static reading, a correct stepwise equivalent of the full-history reference for the unchanged-schema, no-pruning class, with the one declared stricter rule (bound context cannot disappear); I found no accepted-invalid or rejected-reference-valid append outside that rule. The negative harness is materially stronger than the prior sketch (typed errors, latch, snapshot-validity flags, reference re-validation). One load-bearing guard — the exact-prefix equality for the changed subject ([incremental.ts:63](../source/src/build-only/windows-candidate-v3-incremental.ts)) — has no negative control although a snapshot-valid attack reaches it; that is a test/documentation gap, not a code defect. **Decision: the pure predicate/claim transcript and reference bootstrap may be retained as the basis for the next separately reviewed coordinator/persistence design. Advancement is YES for that design step only; NO for any real store, authenticated owner, worker, consumer, task, installer or activation. B-03/W1–W5 remain absent physical gates.** Subject tests and helpers were NOT RUN.

## 2. Audit Identity

- Audit ID: `onoes-agent-v3-incremental-82c8664434c7-static-v2`
- Project: Onoes-Agent v3 pure incremental claim validator and bootstrap
- Auditor/model: `claude-opus-5` in Claude Code (desktop, local session), operator-selected. **Prior involvement:** I produced the prior report (`receipts/PRIOR_REPORT.md`, SHA-256 `6ed6c896…9151a`, verified identical to my delivered file) in a preceding session of this same conversation, and the earlier `f256ad29` report was by the same model family. This is a continuation by the same reviewer, not an independent second opinion.
- Route/provider: operator-mediated local review; no API/provider/network calls from the packet.
- Audit type: STATIC_SOURCE security, implementation, data contract, regression and evidence.
- Date/time UTC: 2026-09-16T09:50Z–2026-09-16T10:40Z (packet prepared 2026-09-16).
- Audited revision: `82c8664434c7ecefcbb54b87984828c28fbae595` (publisher-reported; no bundle). Tests ran against working tree on base `7c3f0c642be888df3af17f0e204dc7b3c74adce3`; binding is by exact hashes, which equal the packet bytes.

## 3. Scope and Method

- In scope: `windows-candidate-v3-incremental.ts` (new), the bootstrap extension in `windows-candidate-v3-inventory.ts`, the record/data parsers and in-packet relative dependencies, the new history fixture, both incremental tests, the inventory test delta, current design/implementation docs, prior report/disposition, source delta and bounded receipts.
- Exclusions (as requested): wider product, actual persistence/coordinator/owner admission, SQLite, anchor, OS/VM, services/native controller, credentials, real approvals/effects, UI/HTTP/runtime consumers, providers, installer, activation.
- Files inspected — fully read: `AUDIT_REQUEST.md`, `HANDOFF.md`, `SCOPE.md`, `MANIFEST.sha256`, `reports/README.md`; `receipts/CURRENT_CONTEXT.md`, `DELIVERY.json`, `DERIVATIONS.json`, `PRIOR_REPORT_IDENTITY.json`, `SANITIZATION.json`, `SOURCE_DELTA.json`, `SOURCE_DELTA.patch`, `SOURCE_IDENTITIES.json`, `v3-incremental-cost-20260916.json`; `source/src/build-only/windows-candidate-v3-incremental.ts`, `windows-candidate-v3-inventory.ts` (history function fully; remainder unchanged from prior packet where it was fully read), `windows-candidate-v3-data.ts` and `-record.ts` (unchanged; fully read in the prior packet, identity re-verified), `canonical-json.ts`, `deep-freeze.ts` (unchanged, prior full read); `tests/tests/helpers/candidate-v3-history-fixture.ts`, `tests/tests/unit/windows-candidate-v3-incremental.test.ts`, `windows-candidate-v3-incremental-negative.test.ts`; `tests/research/measure-v3-incremental.mjs.txt`, `verify-v3-incremental.mjs.txt`; `source/docs/handoff/ONOES_AGENT_V3_INCREMENTAL_IMPLEMENTATION.md`, `ONOES_AGENT_V3_PERSISTENCE_REVIEW_DISPOSITION.md`.
  Read as exact diff against the prior packet's fully-read versions: `ONOES_AGENT_V3_PERSISTENCE_DESIGN_DRAFT.md`, `ONOES_AGENT_V3_INCREMENTAL_VALIDATION_DESIGN.md`, `ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V3.md`; `tests/tests/unit/windows-candidate-v3-inventory.test.ts` (patch hunks plus prior full read of the baseline).
  Partially read / not read, with impact: `receipts/v3-incremental-20260916.json` (structure, all 31 identities compared programmatically, run metadata, limitations; the 34-file full-run command list not read — no impact on findings); `receipts/v3-incremental-20260916.full.tap` (466 KB; footer, skips, matrix diagnostics, `not ok` count only — wider tests are context, not audited scope); `receipts/PRIOR_REPORT.md` (my own report; hash verified, not re-read); `tests/tests/unit/windows-candidate-v3-data.test.ts`, `-record.test.ts` (unchanged since baseline; not read — regression scope unchanged); `source/src/build-only/windows-candidate-effect-state.ts` (unchanged; `effectTime`/`effectUuid` read previously); `receipts/baseline/**` (inspected only through the recomputed diff).
- Commands/probes run (bounded offline arithmetic only): `sha256sum -c MANIFEST.sha256`; Python recomputation of SHA-256 / byte length / Git blob OID for all 21 identities, 2 baselines, 4 derivations, prior report; `git diff --no-index` baseline→current compared hunk-for-hunk with `SOURCE_DELTA.patch`, and the four added files reconstructed from the patch's `+` lines and hashed against packet files; comparison of the test receipt's `identitiesBefore` to SOURCE_IDENTITIES; SHA-256 of both TAPs vs receipt; Python re-derivation of scenario/prefix/continued-append counts from the schedule generator's combinatorics; `grep` of matrix diagnostics, test names and skips in the TAPs; a pattern scan of packet text for private paths/secrets; `diff -u` of the three carried-over docs against the prior packet.
- Cost/mutation controls: no build, install, execution, provider or network use, no GitHub write, no edit to any frozen input. This report is the only write.

## 4. Verdict

```
IMPLEMENTATION_VERDICT: PASS_WITH_FINDINGS
SECURITY_VERDICT:       NEEDS_REVIEW   (module hardening passes static review; physical boundary B-03 open by construction)
EVIDENCE_VERDICT:       PARTIAL        (hash-bound, internally consistent producer evidence; not independent; compiled/lockfile/Node identities are claims; no advance manifest pin received)
ADVANCEMENT:            YES — retain the pure predicate/claim transcript and reference bootstrap as the basis for the NEXT separately reviewed coordinator/persistence design.
                        NO  — real store, authenticated owner, worker, consumer, task, installer, activation.
```

## 5. Blocking Findings

- ID: B-01 (carries forward physical B-03 / W1–W5)
- Severity: blocker — for real persistence, owner admission, consumers and activation only. Not a blocker for retaining the pure implementation.
- File/symbol/line: `ONOES_AGENT_V3_INCREMENTAL_IMPLEMENTATION.md` §"Implemented boundary" lines 25–32 and §"Remaining gates"; `windows-candidate-v3-incremental.ts:6–10, 22–24, 81–82`; `CONTRACT_V3.md` §2.
- Observed fact: no anchor, protected storage, enrollment, owner-epoch CAS, envelope authentication, IPC/executable custody or physical fencing exists. The module states, and the test "claims remain forgeable data…" demonstrates, that a fresh instance accepts any coherent caller-supplied history.
- Why it matters: everything in the design that converts a transcript into admission lives outside this packet.
- Reproduction/probe: static; `windows-candidate-v3-incremental.test.ts:69–80`. NOT RUN.
- Required correction: none in this scope; §10 item 5.
- Status: previously documented.

No other blocking finding was observed in the scoped audit.

## 6. Nonblocking Findings

- ID: N-1
- Severity: high (test/doc gap on a load-bearing guard; no code change required)
- File/symbol/line: `windows-candidate-v3-incremental.ts:62–63` (`canonicalJson({ ...record, events: record.events.slice(0, -1) }) !== canonicalJson(prior.record)`); `windows-candidate-v3-incremental-negative.test.ts:60–77` (`inserted` fails record grammar; no other case reaches line 63); `ONOES_AGENT_V3_INCREMENTAL_IMPLEMENTATION.md` guard table row "One-event/new-zero-event/zero-change".
- Observed fact: the snapshot join (`inventory.ts:71–84`) checks only the *current* checkpoint's `recordDigest` against the subject's whole record. A transport that appends the legitimate next event to the subject **and** rewrites something inside the subject's retained prefix that the record grammar does not bind — e.g. a non-outcome event's `evidenceDigest`, or the intent's `authorizationDigest`/`candidateDigest`/`reviewMaterialDigest`/`guestImageDigest`, or `reservedAt` within its bounds — is snapshot-valid (root, count, sequence, subject digest all recomputed), passes `changed === 1` (`:57`), passes the length check (`:62`) and is stopped only by the exact-prefix clause at `:63`. The reference would reject it through earlier checkpoints' `recordDigest`; in the incremental path that clause is the sole guard. No negative control exercises it, and the implementation doc's table could be read as classifying the whole one-event guard as shadowed.
- Why it matters: this is the guard that pins "every previous event, intent, approval identity and reservedAt" (design §3 step 3). A later "simplification" that trusts the snapshot join for the subject row would silently open history rewrite of the subject's own past on the production append path.
- Reproduction/probe: static trace of `edited()` semantics vs guard order. NOT RUN.
- Required correction: add a negative with `snapshotAccepts = true`: take `basic()` frame `fs[3]` (subject +1 event), rewrite `events[0].evidenceDigest` (and a second variant rewriting `intent.authorizationDigest` with `intentDigest` rehashed; a third changing `reservedAt`), rebuild via `edited()`, and `assertDenial(fs[2], fs[3], bad, true)`. State in the implementation doc that the exact-prefix clause is load-bearing, not defense-in-depth.
- Status: new.

- ID: N-2
- Severity: low
- File/symbol/line: `candidate-v3-history-fixture.ts:61–83` (`transcript`, attachment modes); `windows-candidate-v3-incremental-negative.test.ts:124–140`.
- Observed fact: (a) A is never first supplied on the subject's own quarantine append (mode "release" never delivers to quarantined rows; "later-unrelated" requires a different subject), so `incremental.ts:79` is not exercised at that arrival time; (b) no negative supplies a self-consistent but wrong A in the same frame as the outcome event (the `late` case uses a later frame). Both hit the same guard (`:79`) that `late`/`replacement` already isolate.
- Why it matters: completes "optional A at every permitted arrival time" (Q3); low risk because the guard is shared.
- Reproduction/probe: static. NOT RUN.
- Required correction: add a fourth attachment mode "quarantine-step" (or an explicit case) and one same-frame wrong-A negative.
- Status: new.

- ID: N-3
- Severity: low (matrix scope, Q7)
- File/symbol/line: `windows-candidate-v3-incremental.test.ts:34–67`; `candidate-v3-history-fixture.ts:35–58` (distinct workspace per non-publish row; all timestamps `time(0)`).
- Observed fact: 3,774 scenarios are exhaustive only over the declared bounded paths (subject × two reservation-only rows, or parent × subject × one reservation), plus 30 deterministic three-full-row orders. Not covered: all interleavings of two fully progressing rows; sequential reuse of one workspace by two execute rows (the only same-workspace reuse is publish-after-parent); strictly increasing timestamps in the positive matrix (only equal times, so `lastAt` never advances beyond `time(0)`); two publications of the same parent (workflow/kind collision is covered at inventory level only).
- Why it matters: the doc already declines to call the matrix generally exhaustive; these are the smallest additions with distinct invariant value.
- Reproduction/probe: static. NOT RUN.
- Required correction: add (i) pairwise full-row interleavings for family pairs (C(12,6)=924 orders per pair is tractable), (ii) one execute-released-then-execute-reserved same-workspace positive and its pre-release negative, (iii) one strictly-increasing-time transcript variant, (iv) a second publication of a released parent as a negative.
- Status: new.

- ID: N-4
- Severity: low
- File/symbol/line: `windows-candidate-v3-record.ts:27` (`outcomes`), `windows-candidate-v3-inventory.ts:163` (inline five-literal array), `windows-candidate-v3-incremental.ts:13` (`outcomes` set), `candidate-v3-history-fixture.ts:13`.
- Observed fact: the outcome-state list is now written in three production modules independently (same N-06 pattern the prior review consolidated for domains).
- Why it matters: divergence would make bootstrap A-capture and incremental A-capture disagree silently.
- Reproduction/probe: grep. NOT RUN.
- Required correction: export one `CANDIDATE_V3_OUTCOME_STATES` from `record.ts` (or `data.ts`) and import it; pin literals in a test as done for domains.
- Status: new.

- ID: N-5
- Severity: low (documentation of transcript-vs-S usage)
- File/symbol/line: `windows-candidate-v3-incremental.ts:83–87`; `ONOES_AGENT_V3_INCREMENTAL_IMPLEMENTATION.md:25–32`; `INCREMENTAL_VALIDATION_DESIGN.md` §3 step 8, §5.
- Observed fact: a successful `append` advances the instance to S′ immediately; the ledger still holds S until the coordinator's transaction commits. The docs say the coordinator must "stage candidate data separately", but do not state that the instance no longer exposes S after `append`, so the pre-state identity (root/count) needed for the in-transaction recheck must be captured via `snapshot()` **before** calling `append`, and that a cleanly rejected commit (drift detected pre-write) still requires `invalidate()` plus full re-bootstrap (~12.7 s at capacity by the producer's sample) because there is no rewind. Any denial — including a malformed read-back — latches for the same reason.
- Why it matters: these are the exact seams the next coordinator design must handle; the API is correct, the usage contract is implicit.
- Reproduction/probe: static. NOT RUN.
- Required correction: add two sentences to the implementation doc / design §3.8.
- Status: new.

- ID: N-6
- Severity: low (evidence)
- File/symbol/line: `receipts/v3-incremental-20260916.json` (`identitiesBefore` entries for `.test-dist/**`, `package-lock.json`, `tsconfig*.json`, `nodeExecutableSha256`); `DERIVATIONS.json` member 1 (`byteIdentical: false`); `PERSISTENCE_REVIEW_DISPOSITION.md:69–76` (intermediate `v3-bootstrap-20260916` receipts not in packet).
- Observed fact: 14 source identities in the receipt equal the packet; 17 compiled/lockfile/config/Node identities are producer claims (blobs absent); the main JSON receipt is a labelled sanitized derivative whose original hash cannot be reproduced here; the intermediate 61/61 + 1993 run cited by the disposition is disclosed but its receipts are not packet members. No contradiction found; contemporaneity is by hash (tests 04:14–04:17Z, capacity 04:18–04:19Z, docs committed at `82c8664` afterwards).
- Why it matters: bounds what "81/81, 2013/2011" proves.
- Reproduction/probe: hash comparison. NOT RUN.
- Required correction: none for this phase; independent execution remains a release gate.
- Status: new (accepted limitation).

## 7. Verification Results

- Test command/result: NOT RUN. Producer: focused 81/81 (77,354.9 ms), full 2013 / 2011 pass / 0 fail / 2 skips (Windows link-creation privilege; non-Windows inspector refusal), exit 0, empty stderr, per receipt. Test count reconciliation: prior 56 + 5 bootstrap tests + 20 incremental tests = 81; 1988 + 5 + 20 = 2013.
- Probe command/result: `sha256sum -c` → 41/41 OK, no unlisted files; manifest self-hash `5a878306952a98dbeeb173ab0b8f7009ae291f17fe0564344d5054af2cf47022`, 4,507 bytes (no separately announced expected digest reached me → transport trust NOT established). Identities: 21/21 SOURCE_IDENTITIES OK (sha/len/OID); SOURCE_DELTA: 2/2 baselines OK, all "unchanged" have baseline == current, all currents == SOURCE_IDENTITIES; DERIVATIONS: 4/4 derived hashes/lengths OK, cost JSON byte-identical with matching original blob OID; PRIOR_REPORT.md == `6ed6c896…`, 43,188 B. Patch: changed-file hunks byte-identical to recomputed diff; 4 added files reconstructed from `+` lines hash-equal to packet files. Receipt: 14/14 source identities == packet; `identitiesBefore == identitiesAfter`; TAP SHA-256 `630d1f3a…` (focused) and `91a57af7…` (full) match receipt and implementation doc. Matrix: per-family diagnostics in the TAP (978, 978, 210, 642, 390, 204, 204, 138 scenarios; 6474, 6474, 942, 3786, 2022, 2004, 2004, 1278 prefixes; 19086, 19086, 1686, 9678, 4386, 8946, 8946, 5316 continued) plus 30/432/2922 deterministic equal my derivation: 3,744 + 30 = 3,774; 24,984 + 432 = 25,416; 77,130 + 2,922 = 80,052. Canonical size 6,819,063 B for the capacity inventory equals the prior packet's fixed-shape bound.
- Hash/manifest comparison: consistent throughout.
- Receipt comparison: helper hashes in both receipts equal DERIVATIONS `originalSha256` values; capacity receipt `unchanged: true`, exit 0, one bootstrap 12,709.5 ms, one append 333.2 ms, five inventory-only (252–303 ms) and five snapshot-join (252–278 ms) samples, setup 12,600.1 ms separated, peak RSS 360,520 KiB including setup; no DB/IPC/anchor/stop timings (as stated).
- Scope check: named packet only; parent repository shows the packet untracked; wider tests in the full TAP not audited.
- Unexpected output or failure: none. Secret/private-path scan of packet text: no hits other than test titles containing the words "token"/"api-key". The receipt's focused command records a system `node.exe` path (not private).

## 8. Security and Integrity Review

- Secrets: none observed; sanitization is a pattern tripwire, not proof.
- Injection/control content: `createCandidateV3IncrementalClaims` rejects non-string metadata before any use; inventory/history/checkpoint wires pass through the existing primitive-only, byte-bounded, canonical-equality parsers; no caller object is reflected on (`traps === 0` asserted for accessors, throwing proxies, revoked proxies, Buffer, null, number). Noncanonical, BOM-prefixed and truncated wire deny and latch.
- Authorization/admission: none. API is `snapshot`/`append`/`invalidate` on a frozen object; every result kind is `validated-v3-incremental-claim-not-admission`; no commit/confirm/callback; no state import (a `snapshot()` result passed as inventory is denied). Documented and tested that a fresh instance accepts a coherent forgery (B-01 boundary).
- Isolation/custody: not applicable in scope; module privacy is API discipline only. UNTESTED physically.
- Mutation: returned summaries and the retained `outcomeCheckpointByOperation` are deep-frozen (assignment throws `TypeError` per test); internal `state` is closure-private; transitions are all-or-nothing (candidate built and frozen before assignment).
- Concurrency: synchronous, no awaits; re-entrancy impossible within a call.
- Provenance: publisher-local Git; tested bytes bound by hash to a working tree on `7c3f0c6`; compiled/lockfile/Node identities are claims.
- Replay/rollback: incremental step enforces consecutive sequence and previous-head, retained row set, one changed subject, exact one-event extension with exact prefix, zero-event reservation with old-state workspace/parent checks, global `lastAt`, historical-A equality and no context disappearance. Generation: `producerGeneration` at seq ≥ 1 is the row's immutable `ownerGeneration` (parsers unchanged; relabel denied; head retains G1). Genesis epoch distinct from row generations in fixtures. No code or prose authorizes old-row forward effects, relabeling, reconciliation, success or release; the draft §3 explicitly keeps old in-flight rows blocked pending a separately reviewed recovery protocol.
- Fail-closed: every exception path sets `state = null` and rethrows the fixed `CandidateV3DataError`; the outward message is constant.

## 9. Limitations and Missing Evidence

- NOT RUN: tests, helpers, compilation. No runtime packages, compiled output, lockfile, tsconfig or Node binary supplied; their hashes are producer claims.
- No advance manifest pin was announced to me for this packet; the prior packet's ordering gap is likewise unrepaired.
- Same reviewer as the prior report; same model family as the `f256ad29` review.
- Unread/partially read members listed in §3.
- Single-machine, single-sample capacity numbers; no percentiles, minimum hardware, SQLite read-back, IPC, anchor, cancellation or stop budgets.
- Equivalence evidence shares the row/snapshot/canonical parsers with the reference; agreement is not independent proof of those parsers.

## 10. Required Next Action

1. Add the exact-prefix negative controls (N-1) and reclassify that clause as load-bearing in `ONOES_AGENT_V3_INCREMENTAL_IMPLEMENTATION.md`; add the quarantine-step / same-frame A cases (N-2). These belong in the next delta; they do not block starting the coordinator/persistence design.
2. Extend the matrix per N-3 and consolidate the outcome-state list (N-4); add the transcript-usage sentences (N-5).
3. Proceed to the separately reviewed coordinator/persistence design, using this module as the append predicate and `parseCandidateV3CheckpointHistory` as the bootstrap. That design must specify: capture-before-append of S identity, in-transaction complete pre-state recheck against it, S′ promotion only after durable commit + read-back + confirmed append, invalidate-and-rebootstrap on every uncertain or rejected outcome, and the epoch envelope that the pure layer cannot authenticate.
4. Re-audit only the N-1/N-2 test delta together with that design as a narrow static review.
5. Intentionally excluded and still open: durable pair promotion and unknown-outcome/cancellation lifecycle, owner-epoch CAS and physical old-owner fencing, authenticated IPC and executable/key custody, enrollment/genesis creation and recovery protocol, anti-rollback root, old-row recovery protocol (rows stay blocked until it exists), retention/capacity (1000-op cap), installer/version continuity, resource supervision, independent execution, operator acceptance — B-03 and W1–W5.

## 11. Explicit Non-Claims

This report does NOT certify: formal acceptance; production, live-model or public-release readiness; that any store, anchor, coordinator, owner, worker, consumer, task, installer or activation is authorized; that producer test or timing results were reproduced; that the manifest was received over a trusted channel; the correctness of the shared row/snapshot/canonical parsers beyond static reading; general (unbounded) equivalence of the incremental predicate with full replay beyond the declared matrix and the induction argument; or independence of this review from the prior ones.

## Focused questions — answers with file/symbol/line

1. **Bootstrap.** `inventory.ts:131, 163–166, 171–172`: A captured at the validated outcome checkpoint for every row, independent of transport A; `lastAt` is the traversal's global value ('' at genesis). Test "bootstrap returns frozen historical A and lastAt at every prefix without requiring supplied A" and the two per-family extraction tests cover all cuts/quarantine. The new return adds fields only; the added duplicate-outcome branch (`:164`) is unreachable because `record.ts:105–112` permits only `quarantined`/`released` after an outcome — so wire acceptance is unchanged.
2. **Equivalence.** `incremental.ts:36–80` vs `inventory.ts:134–170`: snapshot join + sequence/prior head + retained rows + one change + exact prefix/zero-event + old-state workspace/parent + `lastAt` + historical A reproduce each reference step; the root recomputed from the post-inventory equals the reference's entries by induction. No accepted-invalid or rejected-reference-valid append found outside the disappearance rule.
3. **Contexts.** `:49` (core byte-exact if previously bound), `:51` (A byte-exact if previously bound — disappearance denies; test `disappeared` asserts the reference *accepts* it, so the stricter rule is labelled, not a hidden failed equivalence), `:79` (any supplied A equals the captured historical digest — `late`, `replacement`, `changedA` are all snapshot-valid and denied). Arrival times covered: at outcome, at release, at a later unrelated step; missing: the subject's own quarantine step (N-2).
4. **Closure/hardening.** `:88–91` latch on any exception incl. parse failures; `:31` explicit invalidate; `:29` frozen API; `summary` deep-frozen; `:26` and parser `typeof` checks precede any reflection (`traps === 0`); Buffer/number/null denied; fixed error text.
5. **Pure transcript.** `:6–10, 81–82`, doc lines 25–32; no confirm/commit; re-instantiation accepts coherent forgeries — tested at `incremental.test.ts:77–79`. Usage seam (capture S before append; no rewind) is implicit — N-5.
6. **Generation.** Draft §3 and CONTRACT_V3 §2 addendum: genesis = initial enrollment epoch; seq ≥ 1 = row `ownerGeneration`; envelope epoch is separate and not authenticated here. `negative.test.ts:165–172` denies relabel and asserts head retains G1; fixture genesis `uuid(99999)` ≠ any row. No code/prose authorizes old-row effects, relabeling, reconciliation, success or release.
7. **Counts.** Re-derived exactly (§7). Scope is sufficient for the declared claim; smallest high-value additions in N-3.
8. **Reachability.** My trace agrees with the implementation doc's table: gap/duplicate/zero-change/two-event/new-with-event are shadowed by the snapshot's `sequence == Σ(events+1)`; old workspace/parent guards by post-inventory exclusion + one-change; global `lastAt` by the snapshot's latest-subject rule; core equality by digest-bound events; duplicate outcome by grammar. Independently snapshot-valid attacks that are tested: prior-head, same-count relocation, unrelated-row rehash, wrong subject, late/replaced/released-A, core rewrite, publication skip. Untested but reachable: exact-prefix rewrite of the subject (N-1).
9. **Specific cases.** Same-time publication ordering: family 5–7 schedules (all `time(0)`) and `historical` (`!parent`); old workspace blockers: cuts 0/1/4 ± quarantine; absent parent: `historical`; release-only-in-post: `skipped`; skipped/multiple events: `two`, `newWithEvent`; missing/replaced rows: `dropped`, `replaced`; core/A substitution: `rewritten`, `late`, `replacement`, `changedA`; duplicate outcome: `duplicate` (grammar); time regression: `newRow`, `existing` (shadowed as documented); valid-after-denial latch: every `assertDenial`.
10. **Identities/chronology.** Verified in §7; hash-bound to the working tree, not to `7c3f0c6` alone; compiled/dependency/runtime are claims; raw TAPs exact; JSON/helper derivatives separately identified.
11. **Capacity helper.** `measure-v3-incremental.mjs.txt:46–68`: 1000 distinct-workspace/generation rows, all reservations first, five event rounds; `beforeInventory/History` snapshotted at 6000 checkpoints; A bound at index 4 by mutating the shared release event object before any prefix containing it is hashed (no hidden mutation of already-hashed prefixes); setup, inventory-only ×5, snapshot ×5, bootstrap ×1, append ×1 separated. Not production sizing.
12. **Remaining physical gates.** §10 item 5; kept separate from this module's findings.

```text
MODEL_ID: claude-opus-5 (Claude Code desktop, local); same reviewer as the prior 16cb32e4 report — not independent
ROUTE: operator-mediated local review; no API/provider/network calls
AUDITED_REVISION: 82c8664434c7ecefcbb54b87984828c28fbae595 (publisher-reported; tests hash-bound to working tree on 7c3f0c642be888df3af17f0e204dc7b3c74adce3)
IMPLEMENTATION_VERDICT: PASS_WITH_FINDINGS
SECURITY_VERDICT: NEEDS_REVIEW
EVIDENCE_VERDICT: PARTIAL
BLOCKING_FINDINGS: B-01 (physical B-03/W1-W5; blocks real admission/activation only)
NONBLOCKING_FINDINGS: N-1 exact-prefix guard has no control and is load-bearing; N-2 A arrival on quarantine step / same-frame wrong A untested; N-3 matrix additions; N-4 outcome list duplicated; N-5 capture-before-append/no-rewind usage undocumented; N-6 compiled/runtime identities are claims
TEST_RESULTS: NOT RUN by reviewer. Producer: focused 81/81; full 2013/2011/0 fail/2 skips; matrix 3774/25416/80052 reproduced by derivation
SCOPE_RESULT: named packet only; 41/41 manifest OK; 21/21 identities and 2/2 baselines reproduce sha/length/OID; patch reproduces all changed and added files; unread members listed with impact in §3
PLATFORM_LIMITATIONS: no execution; no compiled/dependency/Node blobs; no advance manifest pin received; single-sample producer timings; no DB/IPC/anchor/stop measurements
ADVANCEMENT: YES — retain pure predicate/transcript and bootstrap as basis for the next separately reviewed coordinator/persistence design. NO — real store, owner, worker, consumer, task, installer, activation
NEXT_REQUIRED_ACTION: add N-1 exact-prefix negative controls and reclassify the clause as load-bearing in the implementation doc; then proceed to the coordinator/persistence design (§10 item 3) and re-audit that delta narrowly
REPORT_DELIVERY: LOCAL_DELIVERED (reports/AUDIT_REPORT.md; SHA-256 and byte length reported by the reviewer alongside this file). No GitHub write authorized or performed.
```
