# Audit Report — Onoes-Agent checkpoint review remediation and v3 design decisions / onoes-agent-checkpoint-remediation-49cd0792e5e7-design-v1

## 1. Executive Summary

This is a DESIGN + STATIC_SOURCE follow-up review of the narrow changed boundary at publisher source `49cd0792e5e7f48fff1798baebaa24e170ac5371`, delivered as audit-packet commit `0471fe15d4eca6c3dd5d8243fe929eb7a0d9ef05` in `eOnoes/Audits`. Packet integrity is complete and independently recomputed from raw Git blobs: all 71 manifest members, all 46 source identities (SHA-256, byte length and Git blob OID), the 4 supplied baseline blobs, the 2 dependency-context members and both TAP artifacts verify byte-exactly, and applying `SOURCE_DELTA.patch` to the supplied baseline blobs reproduces every current changed blob byte-for-byte. The one production-source change is exactly the three-line addition the packet describes: `#checkStoredState()` as the first statement inside the ledger's `BEGIN IMMEDIATE` transaction, before scan, clock compare, operation and save; it introduces no new transaction nesting, callback or post-commit gap, and the four new write-path tests use a real second-connection commit and assert zero writes and zero durable rows, so they are falsifiable against the baseline. The seven added tests and the five-suite 143-test focused composition are confirmed by independent TAP parse; producer receipts are artifacts only, not executions by this reviewer. On the design questions, CONTRACT_V3 §§1–2 now record F-01, F-02 and F-03 as decisions rather than open conditions, and the F-04 residue (where the owner-epoch CAS lives) is decided; the physical anchor backend (B-03) remains absent and correctly OPEN. The prior report's N-03 "full run plus full stop" counterexample is refuted by the unchanged source (`runDeadline` at `windows-candidate-synthetic-execution.ts:230/237` requires run and confirmed stop to finish inside the run budget), while its underlying concern — unbudgeted synchronous cost after the observed-result checkpoint — is real and is now pinned by a new test. **Data-only v3 schema implementation is not blocked by this evidence** (V3_DATA_SCHEMA_IMPLEMENTATION_READY: YES, with the nonblocking clarifications in §6 to be recorded before the evidence-core domain string is frozen). **Real admission and activation remain NO**: nothing in this packet supplies protected storage, an authenticated fresh anchor, anti-rollback, physical fencing, enrollment or issuer custody. No subject test, helper, build or provider was run. The expected `MANIFEST.sha256` size/hash was not delivered to this reviewer out of band; the trust root is recorded as in-band only.

## 2. Audit Identity

- Audit ID: `onoes-agent-checkpoint-remediation-49cd0792e5e7-design-v1`
- Project: Onoes-Agent checkpoint review remediation and v3 design decisions
- Auditor/model: Claude Opus 5 (`claude-opus-5`), running as Claude Code in the Claude desktop app on the operator's Windows workstation, invoked by the operator pasting the packet's `AUDIT_REQUEST.md` URL. **Prior-involvement disclosure, material:** the supplied prior report (`receipts/PRIOR_REVIEW_BROWSER_CAPTURE.md`) identifies its author as Claude Opus 5 and itself declines fresh-second-opinion status. I am the same model family. I have no conversational continuity with that session and cannot confirm or deny that I produced those bytes; this session's persistent memory contains no Onoes-Agent entry. **This report is therefore NOT an independent second opinion.** Every conclusion that overlaps the prior report or the producer's disposition was re-derived from the current bytes, and where I disagree with either I say so with line references.
- Route/provider: operator-mediated static review. No provider or model call was made from the repository; the packet was obtained by ordinary public `git clone` of `eOnoes/Audits` at the pinned commit. All hashing and byte arithmetic ran offline on the reviewer's machine.
- Audit type: DESIGN + STATIC_SOURCE security, integrity and regression. Not release activation.
- Date/time UTC: review performed 2026-09-15 approximately 00:10–01:30 UTC; packet preparation recorded by the producer as 2026-09-14; packet commit authored 2026-09-14 23:06:18 UTC.
- Audited revision: publisher source `49cd0792e5e7f48fff1798baebaa24e170ac5371`; audit-packet commit `0471fe15d4eca6c3dd5d8243fe929eb7a0d9ef05` (`eOnoes/Audits`, `main`); packet tree object `342fecfd53b9b9c949d276b455c6416062601dc3`. Predecessor baseline: product `0c01a44237fa17970e173fd99e2b9db55863e54e` / packet `0d27ba257d09be6bea70baa2234cf42c785b7fe2`.

## 3. Scope and Method

- In scope: only the packet directory `onoes-agent-checkpoint-remediation-49cd0792e5e7-design-v1/` at the commit above — the revised CONTRACT_V3 decisions (§§1–2, cross-references in §§4–5), CONTRACT_V2 §1, the new disposition, the three-line ledger correction and its seven added tests, the changed baseline blobs and delta, receipts, and the prior report capture as a competing claim. Other source members are dependency context.
- Exclusions: broader product; v3 implementation; physical anchor, storage, enrollment, issuer; VM; OS; credentials; real approvals or effects; providers; installation and activation. None of these were examined or are certified.
- Files inspected (read in full unless noted):
  - Governance: `AUDIT_REQUEST.md`, `HANDOFF.md`, `SCOPE.md`, `REPORT_DELIVERY.md`, `reports/README.md`, `MANIFEST.sha256`.
  - Receipts: `CURRENT_CONTEXT.md`, `DELIVERY.json`, `REPORT_CAPTURE.json`, `SANITIZATION.json`, `PRODUCER_EVIDENCE.json`, `DEPENDENCY_CONTEXT.json`, `SOURCE_IDENTITIES.json` (parsed in full, 46 entries), `SOURCE_DELTA.json` (parsed in full, 46 entries), `SOURCE_DELTA.patch` (all hunks; ledger and CONTRACT_V3 hunks read line-by-line), `DEPENDENCIES.json` (first ~60 lines only), `CURRENT_FOCUSED.tap` (parsed in full; all 143 names read), `CURRENT_FULL.tap` (parsed programmatically; plan, summary and the two SKIP lines read), `PRIOR_REVIEW_BROWSER_CAPTURE.md` (§§1–5 in full; N-01/N-02/N-03/N-04/N-07 findings in full; final fields; remainder not read).
  - Baseline blobs: `receipts/baseline/**` (all four; used for hashing and patch application, read via the diff).
  - Docs: `ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V3.md` (full, current and diff against baseline), `ONOES_AGENT_CHECKPOINT_REVIEW_DISPOSITION.md` (full), `ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V2.md` (preamble and §1 only; §§2–6 not read), `ONOES_AGENT_ATOMIC_LEDGER_SNAPSHOT.md` (not read; unchanged since the prior review).
  - Source: `windows-candidate-effect-ledger.ts` (full, current), `windows-candidate-checkpoint-sequencer.ts` (lines 110–320: options, latch, `#call`, `#pair`), `windows-candidate-synthetic-execution.ts` (lines 60–130 and 160–263: constructor, `#time`, `#live`, `#wait` head, `stop`, `checkpoint`, `phase`, main flow and catch), `windows-candidate-effect-state.ts` (state enum, `candidateEffectBlocked`, transition rules at lines 30–31 and 91–112 only), `source/context/better-sqlite3/lib/methods/transaction.js` (full), `LICENSE` (header only).
  - Tests: `windows-candidate-effect-snapshot.test.ts` (fixture lines 1–55 and the new tests 99–167 in full; remaining tests by name only), `windows-candidate-checkpoint-sequencer.test.ts` (fixture 25–86 and new test 88–109 in full; next test partially), `windows-candidate-synthetic-execution.test.ts` (fixture 25–100 and new tests 323–351 in full; budget lines by grep), `windows-candidate-effect-ledger.test.ts` and `windows-candidate-release-boundary.test.ts` (loop-generated test lines by grep only; bodies not read).
  - Not read, not relied on: the 34 unchanged dependency-context source files other than those named above; helper files under `tests/tests/helpers/`; `DEPENDENCIES.json` beyond its head; CONTRACT_V2 §§2–6; the prior report's N-05/N-06/N-08/N-09/N-10 bodies and §§7–11 beyond the final fields.
- Commands/probes run (all read-only, offline, on the reviewer's clone; none executed subject code): `git clone`; `git cat-file -p` of every packet blob; `sha256sum`/Python `hashlib` recomputation of all 71 manifest members, the manifest itself, all 46 `SOURCE_IDENTITIES` entries (sha256 + byteLength + Git blob OID via `sha1("blob <len>\0"+bytes)`), all 46 `SOURCE_DELTA` entries and the 4 baseline blobs; `git apply --check` and `git apply` of `SOURCE_DELTA.patch` onto the baseline blobs in a scratch directory, followed by hash comparison against current blobs (after stripping the CRLF my local `core.autocrlf` introduced — the packet blobs themselves are LF); byte-level CR/CRLF count of every blob; TAP parse (plan, `# tests/pass/fail/skipped`, per-line `ok` count, suite boundaries, name cross-reference focused→full); `grep` of `test(` declarations current vs baseline; Python character/UTF-16 counts of the capture; `git cat-file -p 0d27ba2:…/MANIFEST.sha256 | sha256sum` to check the disposition's cited previous-packet pin; `gh api` read-only queries of repository permissions, workflow list and Actions settings; `git ls-tree` for `.github/`.
- Cost/mutation controls: no GitHub Actions, hosted runners, builds, installs, package downloads, provider calls, subject tests or helpers; no branch, PR, force-push, deletion or edit of any packet input. The only write is this report at the contracted path. My clone directory is disposable scratch space.

## 4. Verdict

```
IMPLEMENTATION_VERDICT: PASS_WITH_FINDINGS
SECURITY_VERDICT: NEEDS_REVIEW
EVIDENCE_VERDICT: PARTIAL
ADVANCEMENT: YES for data-only v3 schema implementation (record, event, settlement-evidence core, checkpoint payload, parsers and negative tests) and for continued synthetic v2 work; NO for real admission, a production store, enrollment, a real consumer, VM or activation.
```

## 5. Blocking Findings

The only blocker in scope blocks **real admission and activation**, not data-only schema work. The distinction the request asked for is stated explicitly here and in §8.

---

- ID: B-01 (carries forward B-03 / prior F-04)
- Severity: blocker — for REAL_ADMISSION and ACTIVATION only. Explicitly NOT a blocker for DATA-ONLY schema implementation.
- File/symbol/line: `ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V3.md:179–195` (epoch CAS location decision and its own statement "The anchor's backend, anti-rollback root, authentication keys, old-owner physical fencing and provisioning still do not exist in this packet"); `windows-candidate-checkpoint-sequencer.ts:117–121` (`SyntheticCheckpointAnchorPort`, interface only); `:143–145` (latch "covers only this ledger object").
- Observed fact: the design now decides *where* the current-owner epoch CAS record lives (in the authenticated anchor authority's durable namespace stream, atomically compared with enrollment binding and checkpoint head, persisted before ownership is acknowledged, no local fallback, unknown CAS outcome → non-admitted). The epoch is carried in the request envelope, not in immutable checkpoint payload bytes (`:240–242`). No implementation of that authority — storage, authentication, anti-rollback, provisioning, physical old-owner fencing — exists anywhere in the packet; only the port interface and test doubles.
- Why it matters: every admission decision in §1 ("joined read" of fresh authenticated B plus exact inventory plus current custody) and every rejection of a stale, restarted or alternate coordinator in the F-01 decision depends on this authority existing and being authentic. Without it there is no real admission, only recorded state.
- What specifically blocks DATA-ONLY schema work: **nothing in this finding.** The v3 record/event schema, the settlement-evidence core, the checkpoint payload core (§2 lines 197–216) and the inventory-root core reference the epoch only as authenticated envelope context; the immutable payload binds the historical *producer generation*, which is a UUID field already present in v2 pins. A data-only parser can be written and negatively tested against these definitions without an anchor backend.
- What specifically blocks real admission/activation: the absent authenticated backend itself (B-03), plus enrollment (F-03 authority), issuer custody (§4) and physical fencing. These are missing mechanisms, not data defects.
- Reproduction/probe: `grep -n "compareAndAppend\|discover" source/src/build-only/*.ts` — the only implementations are in test fixtures (`windows-candidate-checkpoint-sequencer.test.ts:58–69`, `windows-candidate-synthetic-execution.test.ts:51–58`). NOT RUN — source inspection.
- Required correction: none available inside this scope. Resolve B-03 with independently reviewed physical evidence before any admission claim. Do not let a passing data-only schema suite be read as progress on this gate.
- Status: previously documented, correctly OPEN, unchanged. The prior report's inconsistency (activation-only in its F-04 body, schema-blocking in its final fields) is resolved here: the *residue* that blocked schema work was the undecided epoch location, which V3 §2 now decides; the *backend* blocks admission/activation only.

## 6. Nonblocking Findings

---

- ID: N-01
- Severity: medium
- File/symbol/line: `ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V3.md:74–100` (settlement-evidence core field list and kind/outcome rules).
- Observed fact: the core enumerates 28 fields and states kind-dependent admissibility rules ("Execute completed/failed requires non-null resultDigest …; Execute cancelled/stopped-without-result and publish completed/restored/cancelled require both fields null; No other kind/outcome combination is admitted"), but the core has **no `kind` field**. Kind is bound only indirectly through `intentDigest` (the v2 intent contains `kind`, `windows-candidate-effect-state.ts` intent schema) and `priorOutcomeRecordDigest`.
- Why it matters: substitution is not possible — the digest binds the intent, which binds kind — so this is not a security gap. It is a specification gap for a DATA-ONLY parser: a standalone core validator cannot check the kind/outcome/null rule at all; it can only be checked when the core is validated joined to its record. Because the core is declared "exact … no optional or unknown fields" under domain `agent-candidate-settlement-evidence/v1`, adding `kind` after implementation would require a domain bump.
- Reproduction/probe: compare the field list at lines 76–87 against the rules at 91–100; `kind` is absent. Compare against `windows-candidate-effect-state.ts:104–112`, where every admissible v2 terminal is kind-dependent. NOT RUN — document comparison.
- Required correction: before freezing the `/v1` domain, record one of two decisions in V3 §1: (a) add `kind` (exactly `execute`|`publish`) to the core, or (b) state that the core is validated only joined to its record and that kind is taken from the record intent bound by `intentDigest`. Either is implementable; (a) makes the core self-checking.
- Status: new.

---

- ID: N-02
- Severity: low
- File/symbol/line: `ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V3.md:92–95` ("observedAt < validUntil … both the outcome recording and release append must occur within this interval").
- Observed fact: the strict inequality between the two core timestamps is exact, but the relation between them and the ledger's own `recordedAt` on the outcome event and on the `released` event is stated as "within" without inclusive/exclusive boundaries, and the ordering `observedAt ≤ outcome.recordedAt` is implied, not stated.
- Why it matters: a data-only parser must choose boundaries; two implementations could differ at equality. The request asked whether expiry is "sufficiently specified and bounded"; it is bounded, with one boundary ambiguity.
- Reproduction/probe: text reading only. NOT RUN.
- Required correction: state `observedAt ≤ outcomeEvent.recordedAt < validUntil` and `releaseEvent.recordedAt < validUntil` (or the intended variant) in §1, and pin both boundaries in the future schema tests.
- Status: new.

---

- ID: N-03
- Severity: low
- File/symbol/line: `ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V3.md:76–79, 205–206` (`installationId` in the evidence core and inventory root); `windows-candidate-effect-ledger.ts:13–16` (v2 meta binds only version, store_id, namespace_id).
- Observed fact: both v3 cores require `installationId`, but the design does not say where a v3 store durably binds it. In v2 it arrives only through caller-supplied pins.
- Why it matters: for a data-only parser of a v3 store, `installationId` must come from the store's own metadata to be part of the validated identity, otherwise identity substitution checks (the very thing N-02 of the prior report corrected) cannot cover it.
- Reproduction/probe: `grep -n installationId` across V3 and the ledger source. NOT RUN.
- Required correction: decide in the v3 schema that meta binds `installationId`, ledger domain string and `storeId`/`namespaceId`, and that the in-transaction identity recheck compares all of them.
- Status: new.

---

- ID: N-04
- Severity: low
- File/symbol/line: `ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V3.md:167–177` ("version-independent spent-approval commitment").
- Observed fact: the F-03 decision is coherent for a first release — v2 is synthetic/dormant, so no enrolled production namespace exists to transition; v3 is the first and only active store per namespace; no migration or reset is offered. The shape of the enrollment entry's "spent-approval commitment" is not defined.
- Why it matters: this is data that belongs to the *enrollment authority*, not to the v3 ledger schema. It does not block v3 ledger schema work, but it must be designed before enrollment exists, and the approval-identity digest domain (`agent-candidate-effect-ledger/v1`, deliberately stable across versions per `windows-candidate-effect-state.ts:11`) must be retained unchanged by v3 so the commitment can be version-independent.
- Reproduction/probe: text reading. NOT RUN.
- Required correction: in the v3 schema, explicitly retain `APPROVAL_IDENTITY_DOMAIN` unchanged; defer the commitment format to the enrollment authority's own scoped review and say so in §2.
- Status: new (refines prior F-03, which is otherwise decided).

---

- ID: N-05
- Severity: low
- File/symbol/line: `windows-candidate-effect-ledger.ts:166–172` (`#preflight()` → `this.#now()` → `db.transaction(...).immediate()`); `better-sqlite3/lib/methods/transaction.js:54–62`.
- Observed fact: the N-02 correction (line 175) is correct and complete for its purpose: `#checkStoredState()` is the first statement under `BEGIN IMMEDIATE`, ahead of `#scan()`, the clock compare, the operation and `#save`, so a substituted identity is rejected before any INSERT/UPDATE for reserve, advance and replay, including zero-row stores; a throw there leaves `touched === false`, so the instance is not poisoned and the wrapper rolls back. What is **pre-existing and unchanged** is that the injected host clock callback `this.#now()` runs after `#preflight()`'s `inTransaction` check and before `BEGIN IMMEDIATE`. The wrapper degrades to a `SAVEPOINT` whenever `db.inTransaction` is already true, and `#checkStoredState()` cannot detect that from inside.
- Why it matters: only a misbehaving trusted-host clock could open a transaction on the connection; that is outside the stated trust model (the host owns the connection). It is recorded so that the correction is not over-read as closing every window between preflight and lock acquisition. The post-commit read-back gap (`:182–186`) is also unchanged and already documented (prior N-06).
- Reproduction/probe: source reading of `#write` and `wrapTransaction`. NOT RUN.
- Required correction: none required. Optionally recheck `inTransaction` immediately before `.immediate()` or document the clock as a non-transactional host obligation.
- Status: new observation on unchanged code; not introduced by the correction.

---

- ID: N-06
- Severity: low
- File/symbol/line: `windows-candidate-effect-snapshot.test.ts:118–148` (`replay` case) and `:150–167`.
- Observed fact: the three loop cases are genuinely falsifiable — the hook fires only on the out-of-transaction preflight meta read, commits a real second-connection `IMMEDIATE` transaction that deletes rows and substitutes `store_id`, then asserts `writes === 0` (no INSERT/UPDATE prepared), `inTransaction === false`, and `count(*) === 0` on the other connection. For `reserve`, the old code also ended in `identity-mismatch` (post-commit read-back), so the *reason* is not the discriminator; the zero-write and zero-row assertions are. Two labelling limits: the `replay` case cannot reach the `replayed: true` branch (rows were deleted, so `existing` is undefined) — it exercises "previously-successful writer retries the same intent into an emptied, re-identified store", which is still the intended zero-row scenario; and the lock-hold test asserts that an in-transaction meta read occurs while a second writer observes `SQLITE_BUSY` (`busy_timeout=0`), but does not assert its ordering relative to the operations scan — that ordering is established by source reading (`:175–176`), not by the test.
- Why it matters: naming precision for future readers; the tests' evidentiary value is unchanged.
- Reproduction/probe: read the enclosing functions; NOT RUN.
- Required correction: optional — add a non-empty-store replay substitution case (per-row `storeId` at `:108` already covers it in the ledger suite) and an ordering assertion in the lock-hold test.
- Status: new.

---

- ID: N-07
- Severity: low
- File/symbol/line: `windows-candidate-synthetic-execution.ts:230, 237`; prior report N-03; `windows-candidate-synthetic-execution.test.ts:323–351`.
- Observed fact: **the prior report's exact counterexample is wrong on the bytes it reviewed.** This source file is unchanged from the prior packet (identical SHA-256 in `SOURCE_DELTA.json`), and it already set `runDeadline = now + min(runMs, request.timeoutMs)` at `:230` and failed `deadline` at `:237` after `stop()` if exceeded. A run that consumes its full run budget plus a stop that consumes its full `stopMs` cannot reach the observed-result checkpoint; it reaches the catch at `:245`, `settlementStarted` is false, and the record is quarantined. The new test at `:341` pins exactly this (`quarantined`, no `result-and-stop-observed` event). **The prior report's underlying concern is nonetheless real**: after a successful stop inside the run budget, remaining slack before the two terminal checkpoints is only `stopMs` plus whatever the `phase()` reserve at `:210` left; synchronous work in `checkpoint()` (`readRecord`, canonicalization, digest) is not reserved, so it can exhaust the deadline between the observed-result advance and the terminal advance, leaving a retained `result-and-stop-observed` blocker and `needs-reconciliation`. The new test at `:323` pins that outcome by advancing an injected monotonic clock inside `readRecord` — a modelled, not measured, synchronous cost.
- Why it matters: both competing claims are partly right; the disposition's qualification is accurate and the retained blocker is the correct fail-closed outcome. Neither `overallMs + stopMs` nor any nominal allowance is a wall-clock or heap ceiling; CONTRACT_V3 §5 now says so explicitly (`:318–325`), which resolves prior N-04 as documentation.
- Reproduction/probe: trace `:229–241` with fixture budgets `runMs 500, stopMs 200, checkpointMs 1000, overallMs 10000`: run→499, stop→699 ≥ runDeadline 500 → `deadline`. NOT RUN — hand trace.
- Required correction: none for the synthetic scope. For production composition, reserve measured synchronous overhead per phase as §5 requires, and keep the retained blocker as the outcome (never a compensating terminal).
- Status: previously documented (N-03/N-04), now correctly qualified and pinned.

---

- ID: N-08
- Severity: low
- File/symbol/line: `ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V3.md:6` ("Current source baseline: 06cb638302a867006713af7702b77400b7d38d34"); `ONOES_AGENT_CHECKPOINT_REVIEW_DISPOSITION.md:14` ("Local correction baseline: 4112b690…").
- Observed fact: the V3 document's self-declared source baseline is unchanged from the previous packet and names a commit (`06cb6383…`) that is neither the audited revision (`49cd0792…`) nor the predecessor (`0c01a442…`) nor the disposition's local baseline (`4112b690…`). All three are publisher-private commits not verifiable from the public packet.
- Why it matters: provenance hygiene only; the packet's own `SOURCE_IDENTITIES.json`/`SOURCE_DELTA.json` are internally consistent and independently verified, so no evidence claim depends on the stale line. But a wiki reader of V3 alone would be pointed at the wrong revision.
- Reproduction/probe: `diff` of baseline vs current V3 blob shows line 6 untouched. NOT RUN — diff reading.
- Required correction: update the baseline line on the next V3 edit; do not regenerate this packet.
- Status: new.

---

- ID: N-09
- Severity: low
- File/symbol/line: `receipts/REPORT_CAPTURE.json` (`sourceCharacters: 72061`), `receipts/PRIOR_REVIEW_BROWSER_CAPTURE.md`.
- Observed fact: the capture's `byteLength` (72,798) and SHA-256 verify against the raw blob. The blob is the only packet member with CRLF line endings (390 of 390 lines), consistent with its declared "form newline normalization". `sourceCharacters` equals the UTF-16 length after CRLF→LF, i.e. the DOM text length, not a property of the retained bytes. The disposition's cited previous-packet manifest pin (7,951 bytes, `8afa0c4f…e450b`) verifies against the raw blob at `0d27ba2`.
- Why it matters: the capture is a frozen review *input* with normalized newlines, not the original report attachment; no original-attachment identity is claimed by this report either.
- Reproduction/probe: byte count of `\r\n` in the blob; UTF-16 length after normalization = 72,061. Offline arithmetic only.
- Required correction: none; optionally state the CRLF→LF rule next to `sourceCharacters`.
- Status: new.

---

- ID: N-10
- Severity: low
- File/symbol/line: packet delivery (HANDOFF.md "Send expected MANIFEST.sha256 size/hash separately and obtain acknowledgment BEFORE asking the reviewer to read source").
- Observed fact: this reviewer received only the request URL. The manifest blob observed in-band is 7,802 bytes, SHA-256 `8b76c9034c3384a8889dce00b449d958d6a999f8f7c5b16e9a065efefcc6e5ec`, Git blob `0993c4d1fcc09b1096545436be6f871dc30b500a`. No out-of-band pin was delivered or acknowledged before source reading.
- Why it matters: hash-first delivery is not claimed; the trust root is the pinned public commit only.
- Reproduction/probe: `git cat-file -p HEAD:<packet>/MANIFEST.sha256 | sha256sum`.
- Required correction: on the next handoff, deliver the pin in a separate channel and record acknowledgment before the read request, as the packet itself instructs.
- Status: previously documented (prior N-09), recurring.

## 7. Verification Results

- Test command/result: **NOT RUN.** No subject test, helper, build, typecheck or script was executed by this reviewer. Producer artifacts verified as artifacts only: `CURRENT_FOCUSED.tap` plan `1..143`, `# tests 143 / pass 143 / fail 0 / skipped 0 / todo 0 / duration_ms 3434.3871`; 143 top-level `ok` lines, zero `not ok`. `CURRENT_FULL.tap` plan `1..1932`, `# tests 1932 / pass 1930 / fail 0 / skipped 2 / duration_ms 51127.497`; 1932 `ok` lines; the two skips are line 4311 (`# SKIP Windows link creation privilege unavailable`) and line 9327 (bare `# SKIP`, inspector unsupported-host), matching `PRODUCER_EVIDENCE.json`. Both TAP SHA-256 values match `PRODUCER_EVIDENCE.json` and the manifest.
- Focused composition (independent TAP parse): checkpoint sequencer tests 1–30 (30), ledger 31–81 (51), snapshot 82–100 (19), release boundary 101–108 (8), execution 109–143 (35) = 143. All 143 focused test names occur verbatim in the full TAP. Delta vs prior packet: 128 + 7 new + 8 release-boundary (previously omitted from focused) = 143; full 1925 + 7 = 1932.
- Seven added tests (from the patch, all pure additions; zero `-` lines in any test diff): snapshot `write rechecks empty-store identity under IMMEDIATE before {reserve,advance,replay}` (3) + `write holds IMMEDIATE lock while rechecking identity before scanning or saving` (1); checkpoint `distinct ledger wrapper evades object latch but stale inventory denies a second mutation` (1); execution `synchronous read-back exhaustion after observed-result checkpoint withholds success and retains blocker` and `run plus stop at success deadline cannot record a passed observation even with global budget left` (2).
- Probe command/result: patch application — `git apply --check` clean; baseline + `SOURCE_DELTA.patch` → all six changed/new blobs match `SOURCE_IDENTITIES` SHA-256 and Git blob OIDs (`b0cfdfb`, `c5ed554`, `a3b8c96`, `2879c7c`, `0b7a6ce`, `98e2021`) exactly. Ledger hunk: +3 lines (two comment lines and `this.#checkStoredState();`) at `:173–175`, nothing removed; no table/index/record-format bytes changed.
- Hash/manifest comparison: 71/71 manifest members verify against raw blobs; the only packet file absent from the manifest is `MANIFEST.sha256` itself; no manifest entry is missing from the tree. 46/46 `SOURCE_IDENTITIES` entries verify (sha256, byteLength, gitBlobOid). 46/46 `SOURCE_DELTA` entries consistent: 38 unchanged (current == baseline hash/OID/length), 1 new, 5 changed with all 4 supplied baseline blobs (`fea36ca3…`, `3e0b35c0…`, `7e6150af…`, `799fe4d6…`, `96484d44…`) verifying byte-exactly; membership of the two receipts is identical. 2/2 dependency-context members verify. Line endings: 71 blobs LF-only; the capture blob CRLF (390/390).
- Receipt comparison: `PRODUCER_EVIDENCE.json` counts, durations, skips and `focusedSuites` (30/51/19/35/8) agree with the TAPs. `REPORT_CAPTURE.json` byteLength and sha256 agree with the blob; `sourceCharacters` reproducible only after CRLF→LF (N-09). Disposition's previous-packet manifest pin verified against `0d27ba2`. `DELIVERY.json` records `published: false` — expected, since receipts precede publication; the packet is now published at `0471fe1`.
- Scope check: in scope and complete. No source, test, receipt, request or manifest edited. Scope not expanded; unchanged dependency members were not re-audited.
- Unexpected output or failure: my first clone failed with Windows "Filename too long" until `core.longpaths` was set — a local checkout artifact, not a packet defect. My first CR scan reported no CR in any blob; the byte-count scan corrected this to exactly one CRLF member (the capture). My first patch-application comparison showed mismatches caused by my local `autocrlf`; after normalizing my applied files the comparison matched exactly. None of these affect the packet.

## 8. Security and Integrity Review

- **F-01 — admission bypass removed by design?** Within the exported API, yes: V3 §1 (`:50–67`) exports no `listBlocked`/`isFree`/`canReserve`/`candidateEffectBlocked` analogue for v3, keeps persistence and any SQL blocked index private, defines a single fenced admission-and-reservation entry point whose successful return is recorded state only, keeps all mutation (including recovery) inside that coordinator, and — the decisive property — makes no effect path consume caller-held state, so "read a decision, later invoke an effect" has no API. Restart: the in-memory fence dies, a new epoch must be CAS-acquired and the old owner fenced (§2), so stale requests are rejected by the authority, not by memory. Stale observations: rejected by the mandatory fresh joined read before every effect. Alternate wrappers: in-process, a second coordinator over the same store is indistinguishable by module privacy alone (the new N-01 test shows exactly this for v2 — the wrapper evades the object latch and is stopped only by inventory mismatch); by design, rejection of an alternate coordinator depends on the enrolled fence and authenticated anchor, i.e. on B-01. New reservations and physical release: both require the fresh joined read plus independently checked custody (`:41–46`). The distinction the request asked for is stated in the document itself (`:66–67`): TypeScript privacy is API discipline, not protection against a compromised host or a raw SQLite handle. One unenforceable line: "Diagnostics may describe a record's historical state but return no availability boolean" — any disclosed history lets a consumer compute a predicate; what actually protects is that no effect path accepts it. Judgment: the design removes the *v2 shape* of the bypass (a releasing predicate that consumers can act on); it cannot and does not claim to remove OS/process-level bypass.
- **F-02 — settlement-evidence core implementable data-only?** Yes, with N-01/N-02. Kind/outcome/null rules are complete against the v2 state graph (`windows-candidate-effect-state.ts:104–112`: execute → completed|failed|cancelled-from-reserved; publish → completed|restored|cancelled-from-reserved; quarantine absorbing) plus the new `stopped-without-result` for execute only; no impossible outcome and no v2 terminal is omitted. Every required subject binding (installation, namespace, store, operation, workflow, intent, request, manifest, workspace, policy, owner/guest generation, controller, resource policy) and every evidence-role binding (contact accounting, owner fence, process settlement, generation retirement, custody release, publication exclusion, workspace safety) is a named required field; empty strings, omitted nulls, unknown fields, duplicate keys, alternative encodings and >8,192-byte cores deny. Expiry is bounded (`observedAt < validUntil`, no self-renewal) with one boundary ambiguity (N-02). Non-circularity verified by construction: `priorOutcomeRecordDigest` covers the record *before* the outcome event; the outcome event carries the evidence digest; checkpoint A witnesses the record with the outcome; the `released` event binds the predecessor record digest, the same evidence digest and A's digest; B witnesses the record with the release and is never written back. No core contains the digest of the event that contains it, nor A's successor, nor B. Quarantine has no core and no release (`:27, :34, :100`). Evidence digests are treated in the document as shape-bounded pointers, not as authenticity or current physical fact (`:106–112`) — this report agrees and does not treat them otherwise.
- **F-03 — coherent first-release decision?** Yes (N-04). One enrollment authority per installation; one active storeId + domain per namespace; retired-store history immutable; concurrent active v2/v3 prohibited; no migration/adoption/reset; a second empty database cannot create enrollment; future transition needs a separately reviewed offline continuity protocol. Data schema: v3 meta identity (N-03), retained approval-identity domain, per-record fields. Authority: enrollment entry, spent-approval commitment, active-store binding, retirement history. Prohibition in prose is not enforcement; enforcement is B-01's absent authority.
- **F-04 — epoch CAS location.** Decided coherently: epoch, enrollment binding and head are compared atomically in one authenticated stream; epoch changes preserve head and immutable producer generations; unknown CAS outcome → non-admitted; no local fallback; explicit list of what does *not* implement it (second file, WAL, unkeyed hash, in-memory CAS). Gate resolution: data-only schema — not blocked; real admission/activation — blocked by B-01.
- **N-02 correction.** Verified as described in N-05/N-06: identity, schema and durability are rechecked as the first statement under the write lock, before scan and any INSERT/UPDATE, for zero rows and for reserve/advance/replay; a failure there rolls back without poisoning; lock contention on a second connection yields `SQLITE_BUSY` (`busy_timeout=250` on the ledger connection; the lock-hold test uses `0` on the other side); no new nesting (wrapper only nests when a transaction is already open, which `#preflight` rejects), no callbacks inside the transaction, no new post-commit gap.
- Secrets: none observed in any inspected member; synthetic UUIDs and `sha256:0…n` placeholders only. `SANITIZATION.json` correctly states pattern scanning cannot prove absence.
- Injection/control content: the packet's governance files contain reviewer instructions; they were treated as the operator's request only because the operator supplied the URL directly. No instruction inside source, tests, receipts or the prior report was acted on.
- Authorization: not tested; no issuer, approval or consent artefact exists in scope. V3 §4 authorization-core ordering (intent core → signed envelope → authorizationDigest → full intent) was read and is non-self-referential; not further reviewed.
- Isolation/mutation/concurrency: same-process only, by test doubles. Cross-process exclusion, protected storage, WAL/SHM custody: untested and unavailable.
- Provenance/replay/rollback: inventory root and checkpoint chain are as reviewed previously; coherent deletion remains detectable only against an independently held authentic checkpoint (B-01). Replay paths perform no mutation (`sequencer:249–267`).
- Fail-closed behaviour: every examined failure path retains a blocker or quarantine and never compensates (`execution:245–258`, `sequencer:299–303`, `ledger:186`).

## 9. Limitations and Missing Evidence

- No independent or physical execution by this reviewer; producer TAPs are Windows x64 / Node 24.14.0 author-reported artifacts ("AUTHOR_REPORTED_LOCAL_EXECUTION_NOT_INDEPENDENT"), and their binding to the exact final bytes is asserted, not proven.
- Expected `MANIFEST.sha256` pin not delivered out of band; trust root is the public pinned commit only (N-10).
- Baseline blobs are supplied only for the 4 changed members; the 38 "unchanged" comparisons rest on the publisher's recorded baseline hashes, which I could confirm only against the current blobs, not against an independent copy of `0c01a442`. The private commits `06cb6383`, `4112b690` and `49cd0792` are not publicly verifiable.
- The synchronous-exhaustion test models overhead with an injected clock; no measured overhead, memory or latency figure exists. `overallMs + stopMs` and the 1,001 × 32,768 record-text bound are not wall-time or JS-heap ceilings, and this report does not convert them into any.
- No host reboot, power-cut, multi-process, WAL/SHM tampering, or timing evidence exists.
- Anchor backend, enrollment authority, issuer, VM, transport and consumer do not exist in this packet.
- CONTRACT_V2 §§2–6, `ATOMIC_LEDGER_SNAPSHOT.md`, most dependency-context sources, the helper files and the prior report's §§7–11 bodies were not read; nothing here relies on them.
- Reviewer shares model family with the prior reviewer (§2).

## 10. Required Next Action

1. Record N-01 (`kind` in the core or explicit joined-validation rule) and N-02 (timestamp boundaries) in CONTRACT_V3 §1 before the `agent-candidate-settlement-evidence/v1` domain string is used by any code; update the stale baseline line (N-08). These are document edits, not blockers, and may be the first commit of the schema work.
2. Then implement DATA-ONLY v3 schema and parsers — record, events (including `stopped-without-result` and `released`), settlement-evidence core, checkpoint payload and inventory-root cores, and v3 meta binding installation/namespace/store/domain (N-03) — with negative tests for every kind/outcome/null combination, every release cut, predecessor/A/B binding, quarantine-cannot-release, six-event ceiling, oversize/duplicate-key/omitted-null denial. No store activation, no admission path, no anchor contact.
3. Re-audit that schema packet as a narrow changed-boundary review (data-only), citing this report and its exact audited revision.
4. Intentionally excluded and still open: B-03 physical anchor/storage/anti-rollback/fencing, enrollment authority and spent-approval commitment, issuer custody, transport, VM, real approvals/effects, W1–W5. Each requires its own scoped review with physical evidence before any admission or activation claim.

## 11. Explicit Non-Claims

This report does NOT certify: formal acceptance of the product or of CONTRACT_V3; production readiness; live-model or provider readiness; public-release or installer readiness; real admission; activation; enrollment; physical anchor freshness, anti-rollback or fencing; protected storage or custody; issuer, approval or consent handling; VM, OS or transport behaviour; that producer tests pass on any machine other than the producer's; that the synthetic composition is safe for any real consumer; that the browser capture is the original report's bytes; or that this review is an independent second opinion. A YES on data-only schema readiness authorizes definitions, parsers and negative tests only — no effects, no production stores, no physical claims.

```text
MODEL_ID: claude-opus-5
ROUTE: operator-mediated static review via Claude Code (Claude desktop app) on the operator's Windows workstation; public git clone of eOnoes/Audits at the pinned commit; no provider call from the repository; offline hashing and byte arithmetic only
AUDITED_REVISION: publisher source 49cd0792e5e7f48fff1798baebaa24e170ac5371; audit-packet commit 0471fe15d4eca6c3dd5d8243fe929eb7a0d9ef05 (eOnoes/Audits main); packet tree 342fecfd53b9b9c949d276b455c6416062601dc3
IMPLEMENTATION_VERDICT: PASS_WITH_FINDINGS
SECURITY_VERDICT: NEEDS_REVIEW
EVIDENCE_VERDICT: PARTIAL
BLOCKING_FINDINGS: 1 (B-01: absent authenticated anchor backend / B-03 — blocks REAL_ADMISSION and ACTIVATION only; explicitly does NOT block data-only schema work; previously documented, unchanged)
NONBLOCKING_FINDINGS: 10 (N-01 evidence core lacks `kind`/joined-validation rule; N-02 timestamp boundary inclusivity; N-03 v3 meta must bind installationId/domain; N-04 spent-approval commitment shape belongs to enrollment authority; N-05 pre-existing clock callback between preflight and BEGIN IMMEDIATE, unchanged; N-06 write-path test labelling limits; N-07 prior N-03 counterexample refuted by runDeadline, underlying synchronous-exhaustion concern real and now pinned; N-08 stale baseline line in V3 header; N-09 capture sourceCharacters reproducible only after CRLF→LF; N-10 manifest pin not delivered out of band)
TEST_RESULTS: NOT RUN. Producer artifacts verified as artifacts only: CURRENT_FOCUSED 143 tests / 143 pass / 0 fail / 0 cancelled / 0 skip; CURRENT_FULL 1932 / 1930 pass / 0 fail / 0 cancelled / 2 explained skips. Focused composition independently parsed as checkpoint 1–30 (30), ledger 31–81 (51), snapshot 82–100 (19), release boundary 101–108 (8), execution 109–143 (35). Seven added tests confirmed from the patch (snapshot 4, checkpoint 1, execution 2), all pure additions.
SCOPE_RESULT: In scope and complete. 71/71 manifest members, 46/46 source identities (SHA-256 + byteLength + Git blob OID), 46/46 delta entries, 4/4 baseline blobs, 2/2 dependency-context members verify byte-exactly against raw Git blobs; baseline + patch reproduces all six changed/new blobs exactly; ledger delta is +3 lines, purely additive. No packet input edited; no scope expansion.
PLATFORM_LIMITATIONS: No independent or physical execution; producer evidence Windows x64 / Node 24.14.0 only; two Windows-conditional skips; no reboot/power-cut/multi-process/timing/memory measurement; unchanged-member baseline publisher-reported; private commits 06cb6383/4112b690/49cd0792 not publicly verifiable; manifest pin not delivered out of band; anchor, enrollment, issuer, VM, transport absent; reviewer shares model family with prior reviewer.
ADVANCEMENT: YES for data-only v3 schema implementation and continued synthetic v2 work; NO for real admission, production store, enrollment, real consumer, VM or activation
NEXT_REQUIRED_ACTION: Record N-01 and N-02 in CONTRACT_V3 §1 (and fix the N-08 baseline line), then implement the DATA-ONLY v3 record/event/evidence-core/checkpoint-payload schemas and parsers with the negative tests listed in §10 step 2, and submit that as a narrow changed-boundary packet for re-audit; keep B-03, enrollment, issuer, effects and activation gated.
V3_DATA_SCHEMA_IMPLEMENTATION_READY: YES
SYNTHETIC_COMPOSITION_VERDICT: PASS_WITH_FINDINGS
REAL_ADMISSION_READY: NO
ACTIVATION_READY: NO
REPORT_DELIVERY: VERIFIED_GITHUB
```
