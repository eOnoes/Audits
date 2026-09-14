# Audit Report — Onoes-Agent release/checkpoint/execution/snapshot boundary / onoes-agent-checkpoint-execution-0c01a44237fa-static-design-v1

## 1. Executive Summary

This is a DESIGN + STATIC_SOURCE review of the changed release/checkpoint/execution/snapshot boundary at publisher revision `0c01a44237fa17970e173fd99e2b9db55863e54e`, as delivered in the packet directory of the same name. Packet integrity is complete and independently recomputed: all 73 manifest members, all 51 source identities (SHA-256, byte length **and** Git blob OID), the two dependency-context members, all five TAP artifacts and the five source/test hashes embedded in `ATOMIC_LEDGER_SNAPSHOT.md` verify byte-exactly against raw Git blobs. The claimed focused composition is confirmed by independent parse of the TAP itself, not merely by the producer's assertion. The implemented work does what the packet says it does: `snapshot()` is a genuinely single-read-snapshot complete inventory that re-derives every cross-row invariant in application code rather than trusting SQL indexes; the checkpoint sequencer permits exactly one expected record delta and never guesses, compensates or retries on uncertainty; and the synthetic execution composition establishes each checkpoint strictly before the effect it guards and withholds a passing result until a confirmed stop. The negative controls are real negative controls — they affirmatively reproduce the v2 boundary failure rather than asserting its absence. **Advancement to v3 data schema implementation is blocked**, not by a defect in these bytes but by four decisions CONTRACT_V3 itself leaves open (admission API surface, settlement-evidence digest core, cross-store approval uniqueness, and the entirely absent authenticated anchor backend, B-03). Advancement to activation, a real consumer or a VM is separately and emphatically NO. Continued synthetic work over the unchanged v2 ledger is supported by this evidence. No subject test, helper or script was executed; the expected `MANIFEST.sha256` pin was never separately delivered to this reviewer, so the trust root is acknowledged as incomplete rather than inferred.

## 2. Audit Identity

- **Audit ID:** `onoes-agent-checkpoint-execution-0c01a44237fa-static-design-v1`
- **Project:** Onoes-Agent release/checkpoint/execution/snapshot boundary
- **Auditor/model:** Claude Opus 5 (`claude-opus-5`), running in Anthropic's Claude chat interface, invoked by Onoes with the packet URL. **Prior-involvement disclosure, material:** the supplied prior report `receipts/SUCCESSOR_REVIEW.md` states on its own face that it was produced by Claude Opus 5, and `SUCCESSOR_REVIEW_DISPOSITION.md` records that "the reviewer discloses authorship of the prior review." I am the same model. I have no conversational continuity with that session and cannot confirm or deny that I produced those specific bytes, and my own stored notes record Onoes-Agent as a project I have discussed before. **This report is therefore explicitly NOT a fresh independent second opinion.** Every conclusion below that overlaps the prior report was re-derived from the current bytes; where I agree with the prior reviewer I say so and give my own line-level evidence, and I do not treat that report's confidence as evidence for anything.
- **Route/provider:** operator-mediated scoped review. No provider call was made from the repository; the packet was read over ordinary public GitHub clone at the pinned commit.
- **Audit type:** DESIGN + STATIC_SOURCE security, integrity and regression. Not release activation.
- **Date/time UTC:** review performed 2026-09-14 UTC. Packet preparation date recorded by the producer as 2026-09-14 UTC.
- **Audited revision:** publisher source `0c01a44237fa17970e173fd99e2b9db55863e54e`; audit-repository packet commit `0d27ba257d09be6bea70baa2234cf42c785b7fe2` (`eOnoes/Audits`).

## 3. Scope and Method

**In scope:** only the packet directory `onoes-agent-checkpoint-execution-0c01a44237fa-static-design-v1/` at the commit above — the 51 product blobs, the two non-product SQLite context members, the receipts, the delta and the prior successor report as an input.

**Exclusions (as declared, and honoured):** the broader/current product, a real v3 schema or consumer, VM or native acquisition, OS configuration, keys and credentials, source export, approval issuance or consumption, physical anchor and enrollment, original-file writes and publication, providers, installer and activation.

**Files actually read (read in full unless noted):**

- Packet governance: `AUDIT_REQUEST.md`, `HANDOFF.md`, `SCOPE.md`, `REPORT_DELIVERY.md`, `reports/README.md`.
- Receipts: `CURRENT_CONTEXT.md`, `DELIVERY.json`, `SANITIZATION.json`, `DEPENDENCY_CONTEXT.json`, `PRODUCER_EVIDENCE.json`, `MANIFEST.sha256`, `SOURCE_IDENTITIES.json` (parsed in full, all 51 entries), `SOURCE_DELTA.json` (parsed in full, all 51 entries), `SOURCE_DELTA.patch` (ledger hunk read line-by-line; remainder skimmed), `CURRENT_FOCUSED.tap` and `CURRENT_FULL.tap` and the three historical TAPs (parsed programmatically in full; not read line-by-line as prose), `SUCCESSOR_REVIEW.md` (executive summary and identity section only — noted as a limitation).
- Source: `windows-candidate-effect-ledger.ts`, `windows-candidate-effect-state.ts`, `windows-candidate-checkpoint-sequencer.ts`, `windows-candidate-synthetic-execution.ts` (all four read line-by-line in full); `windows-candidate-source-transfer.ts` (targeted read of the OCS1 framing constants only).
- Docs: `ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V3.md`, `ONOES_AGENT_ATOMIC_LEDGER_SNAPSHOT.md`, `ONOES_AGENT_CANDIDATE_SUCCESSOR_REVIEW_DISPOSITION.md` (full); `ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V2.md` (section 1 and preamble only).
- Tests: `windows-candidate-release-boundary.test.ts` and `windows-candidate-effect-snapshot.test.ts` (full); `windows-candidate-checkpoint-sequencer.test.ts` and `windows-candidate-synthetic-execution.test.ts` (complete test-name inventory plus targeted reads of the concurrency, budget-reserve and invariant-rederivation cases).

**Not read, and therefore not relied on:** `ONOES_AGENT_SYNTHETIC_CHECKPOINT_SEQUENCER.md`, `ONOES_AGENT_SYNTHETIC_EXECUTION_COMPOSITION.md`, `receipts/DEPENDENCIES.json`, the body of `SUCCESSOR_REVIEW.md`, `CONTRACT_V2` sections 2–6, the bodies of the ledger and sequencer/execution test suites beyond the excerpts named above, and the 38 unchanged dependency-context source files. Conclusions below rest on bytes I read, not on these.


**Commands/probes run (all over packet bytes only; no subject code executed):** `git clone` of the public report repository and `git checkout` of the pinned commit; `git cat-file blob` for every member; SHA-256 and Git-blob-OID recomputation in Python; JSON parsing of the receipts; regular-expression parsing of the TAP artifacts; `find` for workflow files. No TypeScript was compiled, no test or helper was run, no `node` process was started, no network call other than the GitHub clone and the initial page fetch.

**Cost/mutation controls observed:** no GitHub Actions or hosted runners were invoked; the repository contains no `.github/` directory and no YAML workflow files at this commit, so no workflow could have been triggered. No branches, PRs, merges, resets, deletions or file edits were made. No model or provider call was issued from the repository. No package was installed, no build was run, no credential was requested or handled.

## 4. Verdict

```
IMPLEMENTATION_VERDICT: PASS_WITH_FINDINGS
SECURITY_VERDICT: NEEDS_REVIEW
EVIDENCE_VERDICT: PARTIAL
ADVANCEMENT: YES for retaining and continuing to test the synthetic v2-only
composition and for continued v3 DESIGN work; NO for v3 data schema
implementation, real consumer, VM and activation.
```

## 5. Blocking Findings

Every finding in this section blocks **v3 data schema implementation specifically**. None of them blocks retaining or continuing to test the synthetic v2-only composition. F-04 additionally blocks activation and always has.

---

- **ID:** F-01
- **Severity:** blocker (for v3 data schema implementation)
- **File/symbol/line:** `source/docs/handoff/ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V3.md` §1, the paragraph beginning "The ordinary new-domain blocked column may become false only at `released`" and the sentence "If a proposed v3 API cannot prevent consumers confusing its blocked column with admission, it is not ready."
- **Observed fact:** V3 states that the blocked column is "NECESSARY, NOT SUFFICIENT for admission" and that the authoritative decision is the joined read, then poses the API-surface question as an open condition rather than deciding it. The packet contains no decision on whether the v3 store exposes a blocked column, a `listBlocked()` analogue, or any per-row releasing predicate at all to callers outside the joined admission read.
- **Why it matters:** this is the exact shape of SC-B-01. V2's own negative control (`windows-candidate-release-boundary.test.ts:91`) proves that a raw v2 store with a releasing terminal will accept a new reservation on that workspace after reopen, with `listBlocked()` returning `[]` (line 87). If v3 ships a structurally similar column before the API question is settled, the same confusion is reproducible in the new domain, and the correction will have moved the bug rather than fixed it. V3 §6 itself warns that "an extra release event alone is an insufficient fix and must fail the negative control."
- **Reproduction/probe:** read `windows-candidate-release-boundary.test.ts:74–94` — five parameterized cases (`completed`, `failed`, `cancelled`, `restored`, `publish-completed`) each assert `candidateEffectBlocked(result) === false`, `listBlocked() === []`, a changed complete inventory root, and then `reserve(...).disposition === "recorded"`. NOT RUN by this review; read as source. The corresponding TAP lines are `CURRENT_FULL.tap` entries 1115–1119.
- **Required correction:** decide, before schema work, whether the v3 store exposes any releasing predicate to callers, and if it does, what mechanism prevents its use as admission. State the decision in CONTRACT_V3 §1 as a decision, not a condition.
- **Status:** new (the underlying SC-B-01 gap is previously documented; this is the specific undecided residue in the proposed correction).

---


- **ID:** F-02
- **Severity:** blocker (for v3 data schema implementation)
- **File/symbol/line:** `ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V3.md` §1, third bullet: "A final absorbing `released` event binds the outcome, complete predecessor record digest, bounded settlement-evidence digest and the exact anchor checkpoint that witnessed that predecessor."
- **Observed fact:** V3 specifies a canonical hash core for the *inventory* root (§2, `agent-candidate-inventory-root/v1`, with named fields and sort/rejection rules) but specifies no canonical core, domain string, field list or byte bound for the **settlement-evidence digest** that `released` must bind. CONTRACT_V2 §1 enumerates the settlement *facts* in prose (owner fencing, contact accounting, generation retirement, custody release, publication-exclusion enforcement, confirmed preceding history) but gives no canonical encoding. Nothing in the packet closes that gap.
- **Why it matters:** `released` is the one event that can flip admission. Its binding is the security boundary. An unspecified digest core means two implementations can produce different digests over the same facts, that facts can be silently omitted, and that the negative controls V3 §6 demands ("test all release cuts") cannot be written with exact expected bytes.
- **Reproduction/probe:** grep CONTRACT_V3 for `settlement`; every occurrence is a requirement on the digest, never a definition of it. Compare against §2's inventory core, which *is* defined. NOT RUN — source comparison only.
- **Required correction:** define the settlement-evidence canonical core (domain, exact field set, bounds, canonicalJson rules, empty/absent handling) in CONTRACT_V3 before any v3 record schema is written.
- **Status:** new.

---

- **ID:** F-03
- **Severity:** blocker (for v3 data schema implementation)
- **File/symbol/line:** `source/src/build-only/windows-candidate-effect-state.ts:11` (`APPROVAL_IDENTITY_DOMAIN = "agent-candidate-effect-ledger/v1"`, with the comment "Store binding prevents verbatim relocation, NOT duplicate host enrollment") and `:85–87` (`effectApprovalIdentity`); enforcement at `windows-candidate-effect-ledger.ts:18` (`approval_identity_digest TEXT UNIQUE`), `:117–124` (application re-derivation) and `:195` (`approval-reused`); requirement at CONTRACT_V3 §4, "One authoritative enrollment must prohibit independent active v2/v3 stores from spending the same approval. A digest domain alone cannot do that."
- **Observed fact:** the approval-identity domain is deliberately held stable across record-schema versions, so the same `(namespaceId, approvalId)` yields the identical digest in a v2 store and a future v3 store. Uniqueness is enforced only *within one store's rows* — by the SQL UNIQUE index and, independently, by the in-memory `approvals` set at `:121–123`. There is no enrollment authority in the packet, and V3 states plainly that the digest domain cannot supply one.
- **Why it matters:** two concurrently active stores in the same namespace can each spend the same approval once, producing two authorized executions from one consent. This is a double-spend of the exact resource the ledger exists to make single-use. It is not a defect in these bytes — the code's own comment states the limit — but it is an unmet precondition for v3 existing alongside v2 at all.
- **Reproduction/probe:** read `windows-candidate-effect-ledger.ts:117–124`; the duplicate sets are constructed per `#scan()` call, scoped to one connection's `candidate_effect_operations` table. There is no cross-store read anywhere in the packet. NOT RUN — source inspection only.
- **Required correction:** specify and separately review the single version-spanning enrollment/consumption authority before v3 storage exists. Version coexistence without it should be treated as prohibited, not deferred.
- **Status:** previously documented (SC-N-09 in the prior disposition); re-derived here from source.

---

- **ID:** F-04
- **Severity:** blocker (for activation; pre-existing and correctly OPEN)
- **File/symbol/line:** `windows-candidate-checkpoint-sequencer.ts:12–16` (the module header: "INJECTED SYNTHETIC MODEL ONLY. No effect port, real enrollment, issuer, owner acquisition, backend… An in-memory lock, these hashes and a fulfilled Promise prove no physical custody"), `:117–121` (`SyntheticCheckpointAnchorPort` — an interface with no implementation anywhere in the packet); CONTRACT_V3 §2 and the closing paragraph of §6.
- **Observed fact:** the entire joined admission decision that F-01/F-02 depend on rests on an authenticated anchor with owner-epoch compare-and-swap, freshness and anti-rollback. No such backend exists in this packet — only the port interface and test doubles. `ATOMIC_LEDGER_SNAPSHOT.md` states directly that a coherent deletion of history yields a valid empty SQLite snapshot and that "only a separately retained authentic checkpoint can detect that missing history."
- **Why it matters:** this is **a missing backend, not a data defect.** Nothing in the v2 record format or the snapshot API is wrong; the guarantee simply cannot exist until an authenticated, fresh, fenced anchor and protected storage exist. Any reading that recasts B-03 as a fixable S1 defect in these bytes would be wrong.
- **Reproduction/probe:** `windows-candidate-effect-snapshot.test.ts`, final case, "coherent terminal deletion is visible only as a changed complete inventory, not authenticated by snapshot alone" — it deletes all rows through the second connection and asserts `snapshot()` returns `[]` with a changed inventory root. NOT RUN — read as source. The test's own comment says "This does NOT close B-03."
- **Required correction:** none available inside this scope. B-03 remains OPEN: protected storage, authenticated fresh anchor, anti-rollback and actual owner/process fencing, each independently scoped and reviewed.
- **Status:** previously documented, correctly open, unchanged.

## 6. Nonblocking Findings


---

- **ID:** N-01
- **Severity:** medium
- **File/symbol/line:** `windows-candidate-checkpoint-sequencer.ts:126` (`ledger: Pick<SqliteCandidateEffectLedger, "reserve" | "advance">`), `:138` (`const shared = new WeakMap<object, Shared>()`), `:172–174`; and `windows-candidate-synthetic-execution.ts:62` (`const usedPorts = new WeakSet<object>()`), `:150`, `:162`.
- **Observed fact:** both single-flight guards key on **object identity**. The sequencer's `Options.ledger` is a *structural* `Pick<>` type, so `{ reserve: l.reserve.bind(l), advance: l.advance.bind(l) }` is a type-legal argument that yields a distinct WeakMap key and therefore a separate `{busy, closed, lastTime}` state over the same SQLite store. The same applies to a fresh wrapper object passed as `ports` to the execution session.
- **Why it matters:** two sequencers over one store could each believe they hold the pair latch. In practice each would still fail closed — `#matches(head, current)` at `:246` and the post-append re-read at `:296` both compare complete inventory roots, and the ledger serializes via IMMEDIATE transactions with a post-commit read-back — so the outcome is a `history-mismatch` and a permanently closed owner, not a silent double-write. The cost is availability and diagnosability, not integrity.
- **Reproduction/probe:** `windows-candidate-checkpoint-sequencer.test.ts:181` ("concurrent work and reentrant callbacks reject without poisoning the active pair") constructs `a` and `b` from the *same* fixture ledger object and asserts `busy`; `windows-candidate-synthetic-execution.test.ts:281` ("two wrappers sharing lifecycle ports") shares the same `ports` object and asserts `session-used`. Neither exercises a distinct wrapper object over the same underlying store. NOT RUN — read as source.
- **Required correction:** none required for the synthetic scope; the source comment at `:144–145` and the audit request both state that WeakMap identity is not cross-process exclusion. For the production composition, derive exclusion from the enrolled store identity rather than from a JavaScript object reference, and add one negative control that passes a fresh wrapper.
- **Status:** new (disclosed in source; not previously recorded as a finding).

---

- **ID:** N-02
- **Severity:** low
- **File/symbol/line:** `windows-candidate-effect-ledger.ts:85–92` (`#preflight` → `#checkStoredState`), `:129–139` (`#readAll`, which repeats `#checkStoredState()` *inside* the deferred transaction), `:163–185` (`#write`, which does **not** repeat it inside the IMMEDIATE transaction).
- **Observed fact:** the delta's whole point is pinning identity inside the read snapshot; the write path was deliberately left as preflight-then-`#scan()`. `#scan()` does check `record.intent.storeId !== this.#storeId` per row (`:108`), so for a non-empty store any meta substitution is caught. For an **empty** store there are no rows, so a store-identity swap committed between `#preflight()` and `BEGIN IMMEDIATE` is not detected before the INSERT.
- **Why it matters:** the row commits into a store the caller no longer owns. Detection is post-commit: `#readOne` at `:179` goes through `#readAll`, which does the in-transaction identity check, throws `identity-mismatch`, and — because `touched` is true — sets `#writePoisoned` at `:183`. So the instance fails closed and reports failure, but a durable row already exists. The window is narrow (IMMEDIATE holds the write lock once open) and meta substitution is external corruption under a trust model where the host owns the connection.
- **Reproduction/probe:** `windows-candidate-effect-snapshot.test.ts` covers "identity replaced after preflight but before snapshot is rejected, including empty stores" for the **read** path only. No equivalent case exists for the write path. NOT RUN — read as source.
- **Required correction:** optional. Either call `#checkStoredState()` as the first statement inside `#write`'s IMMEDIATE transaction, or add a negative control documenting the accepted window explicitly.
- **Status:** new.

---

- **ID:** N-03
- **Severity:** medium
- **File/symbol/line:** `windows-candidate-checkpoint-sequencer.ts:270` (`if (deadline - this.#time() < this.#appendMs …) fail("deadline")`) immediately preceding the synchronous ledger call at `:272`; and `windows-candidate-synthetic-execution.ts:210` (`if (deadline - this.#time() < budget + this.#options.stopMs + 2 * this.#options.checkpointMs) fail("deadline")`), `:91` (constructor sum `5 * checkpointMs + readyMs + deliveryMs + runMs + stopMs <= overallMs`).
- **Observed fact:** budgets are reserved *before* the guarded work, and the arithmetic is otherwise sound — the append interval is reserved before any potentially durable write, and the constructor sum covers all five checkpoints on the success path plus the quarantine checkpoint on the failure path. What is **not** budgeted is the synchronous work between reservations: the ledger `reserve`/`advance` call itself (SQLite `busy_timeout=250` plus `synchronous=FULL` fsync, unbounded in principle), and the canonicalization, digesting and `readRecord` validation around each phase.
- **Why it matters:** **concrete counterexample.** Configure `overallMs` at exactly the constructor minimum. Let the run phase consume its full `min(runMs, request.timeoutMs)` and the stop confirmation consume its full `stopMs`. The remaining budget is then exactly `2 * checkpointMs`. The `result-and-stop-observed` advance at `windows-candidate-synthetic-execution.ts:239` consumes up to `checkpointMs`, and any non-zero synchronous cost in `checkpoint()` — `parse`, `readRecord`, `canonicalSha256Digest` at `:194–197` — pushes the terminal advance at `:241` past `deadline`. `#wait` fails `deadline`, the catch at `:245` finds `settlementStarted === true` (set at `:238`), and `:249–250` returns `needs-reconciliation`. The record is left at `result-and-stop-observed`, which `candidateEffectBlocked` treats as blocking, so the workspace is held with no terminal and no automatic recovery.
- **Why this is not a blocker:** the outcome is fail-closed and correct — no result is disclosed, `parsedResult` is cleared at `:246`, and no compensating write occurs. It is a liveness and sizing issue. CONTRACT_V3 §5 already requires reserving "every planned checkpoint append and discovery on that phase's normal AND failure paths" using "the maximum feasible branch cost"; the implemented arithmetic reserves the phase-entry cost but not the inter-phase synchronous cost.
- **Reproduction/probe:** `windows-candidate-checkpoint-sequencer.test.ts:395` ("insufficient append reserve denies before SQLite mutation after a slow synchronous owner check") establishes the *pre-write* reserve with `calls.mutation === 0` and `calls.append === 0`. No test drives the terminal-advance exhaustion above. NOT RUN — read as source.

- **Required correction:** add an explicit synchronous-overhead allowance to the constructor sum, or add the counterexample above as a negative control that asserts `needs-reconciliation` and a retained blocker, so the behaviour is pinned rather than incidental.
- **Status:** new.

---

- **ID:** N-04
- **Severity:** low
- **File/symbol/line:** `windows-candidate-synthetic-execution.ts:116–120` (`#wait(… emergencyCleanup)` selecting raw `performance.now()` over `#time()`), `:182–183` (the cleanup `stop` call passing `Infinity` as the absolute deadline and `cleanup.signal`).
- **Observed fact:** the emergency stop attempt is bounded by `stopMs` only, not by the overall deadline, and deliberately bypasses the monotonic-regression guard so a broken injected clock cannot prevent cleanup. Total wall time for a session can therefore exceed `overallMs` by up to `stopMs`.
- **Why it matters:** `overallMs` is a work ceiling, not a wall-clock ceiling. Any caller sizing a supervisor timeout from `overallMs` alone will be wrong by `stopMs`. The trade-off is correct — a cleanup attempt after a host stall is worth more than a hard ceiling — but it must be documented where `overallMs` is consumed, not only in the source comment at `:180–181`.
- **Reproduction/probe:** `windows-candidate-synthetic-execution.test.ts:314` ("broken injected clock cannot prevent bounded emergency stop or create a success") covers the intended behaviour. NOT RUN — read as source.
- **Required correction:** state `overallMs + stopMs` as the session wall ceiling wherever the resource policy is described.
- **Status:** new.

---

- **ID:** N-05
- **Severity:** low
- **File/symbol/line:** `windows-candidate-effect-ledger.ts:100–127` (any single failing row calls `effectFail`, aborting the whole scan) as reached from `read()` `:143`, `listBlocked()` `:146` and `snapshot()` `:153`.
- **Observed fact:** one corrupt row makes every read path permanently unavailable. There is no per-row quarantine, no inspection path and no partial read.
- **Why it matters:** correct for integrity and explicitly intended ("A bad row makes the entire snapshot fail"), but it means a single unrecoverable row denies access to the other 999 records including the evidence needed to diagnose the corruption. This is an availability property to accept knowingly, not a defect.
- **Reproduction/probe:** the seven-way parameterized corruption suite in `windows-candidate-effect-snapshot.test.ts` (`json`, `oversize`, `blob`, `digest`, `blocked`, `store`, `missing-parent`) asserts exactly this, with `assert.equal(f.db.inTransaction, false)` confirming clean transaction release. NOT RUN — read as source.
- **Required correction:** none. Record as an accepted property in the v3 continuity design, where retention or repair will eventually need an inspection path.
- **Status:** new.

---

- **ID:** N-06
- **Severity:** low
- **File/symbol/line:** `windows-candidate-effect-ledger.ts:179–180` (post-commit read-back via `#readOne`, which opens a *new* deferred transaction) and `:183` (`if (touched) this.#writePoisoned = true`).
- **Observed fact:** the read-back is not in the write transaction. A second connection that legitimately advances the same operation between COMMIT and read-back causes `canonicalJson(found) !== canonicalJson(saved.record)`, which poisons this instance's writes for the rest of its life.
- **Why it matters:** correct and conservative under the stated single-trusted-writer model, and the poison is the safe direction. Under any future multi-writer composition it is a false-positive denial-of-service surface. The snapshot test's second connection demonstrates that concurrent commits from another handle are entirely possible against the same file.

- **Reproduction/probe:** `windows-candidate-effect-snapshot.test.ts`, "WAL snapshot keeps old rows while a second connection commits between pinned identity and row scan" establishes the concurrent-writer capability; no test drives it into the write read-back. NOT RUN — read as source.
- **Required correction:** none in scope. CONTRACT_V3 §2's "All ledger mutation/read-back/anchor pairs are serialized across the enrolled store" is the right requirement; note that the implemented v2 ledger does not enforce it by itself.
- **Status:** new.

---

- **ID:** N-07
- **Severity:** low
- **File/symbol/line:** `windows-candidate-effect-ledger.ts:95–100` (`LIMIT 1001`, per-row `substr`/`CASE` bounds, `rows.length > CANDIDATE_EFFECT_MAX_OPERATIONS` rejection) and `windows-candidate-checkpoint-sequencer.ts:242`, `:245`, `:284`, `:296` (four `#inventory()` calls per pair, each a full snapshot).
- **Observed fact:** bytes are SQL-bounded before disclosure, exactly as the audit request anticipates — the driver may materialise the 1,001st sentinel row before rejection, and each `record_json` is capped at 32,768 bytes by the `CASE` expression. Worst-case per call is therefore roughly 1,001 × 32 KiB ≈ 32 MiB of driver+JSON allocation, and the sequencer performs that up to four times per pair.
- **Why it matters:** a sizing input for production composition, not a defect. `ATOMIC_LEDGER_SNAPSHOT.md` already states this is "not a promise of a 32-MiB JavaScript heap ceiling."
- **Reproduction/probe:** "complete maximum 1000-row completed inventory composes with checkpoint digest; 1001 denies without truncation" asserts `limit-exceeded` and `f.db.inTransaction === false`. NOT RUN — read as source.
- **Required correction:** none. Carry the figure into the production sizing decision.
- **Status:** new.

---

- **ID:** N-08
- **Severity:** low
- **File/symbol/line:** `receipts/CURRENT_FOCUSED.tap` (128 entries) versus `tests/tests/unit/windows-candidate-release-boundary.test.ts`.
- **Observed fact:** the release-boundary suite is *not* in the current focused run. I confirmed this by name matching: none of its four declared test names (including the five-way parameterized one) appears in `CURRENT_FOCUSED.tap`. Its coverage at current bytes exists only inside the 1,925-test full run (entries 1115–1119 and neighbours), and at historical bytes in `HISTORICAL_RELEASE_59.tap`.
- **Why it matters:** the packet's framing ("their four current focused tests" plus "the release-boundary negative controls") is accurate and not misleading. But the four negative controls that carry most of the SC-B-01 argument are visible in the focused artifact only by their absence, which makes the fastest reviewer check the wrong one.
- **Reproduction/probe:** parse `CURRENT_FOCUSED.tap` for the literal string `boundary negative:` — zero matches. Parse `CURRENT_FULL.tap` for the same — matches at entries 1115–1119. Executed by this review over receipt bytes.
- **Required correction:** include the release-boundary suite in the focused artifact for the next packet, or state its exclusion explicitly in `CURRENT_CONTEXT.md`.
- **Status:** new.

---

- **ID:** N-09
- **Severity:** medium
- **File/symbol/line:** `AUDIT_REQUEST.md`, "Integrity and delivery": "Acknowledge separately delivered expected MANIFEST.sha256 byte length/hash before reading the source."
- **Observed fact:** no expected manifest pin was delivered to this reviewer out of band. The packet URL alone was supplied. `MANIFEST.sha256` is not self-listed, so the manifest is a trust root only if its own bytes are independently pinned.

- **Why it matters:** the request's own instruction is to "record delivery incomplete rather than inferring a trust root," and I am doing exactly that. Every hash below is *internally consistent* — the manifest matches the members, the identities match the manifest, the docs match the identities, the delta matches all of them — but that consistency is a property of one fetched tree. It does not exclude a coherently rewritten tree.
- **Reproduction/probe:** observed `MANIFEST.sha256` byte length **7,951**, SHA-256 **`8afa0c4ff75a4630991167bc96e81cb4ee26c738544ff47460155a3a450e450b`**. Recorded as an observation for the operator to compare against the producer's retained pin. I make no claim that this value was acknowledged. This exactly repeats the delivery gap the prior packet's disposition already recorded ("Expected-pin acknowledgment did not reach the reviewer; do not retroactively claim hash-first delivery").
- **Required correction:** for the next packet, send the expected manifest byte length and hash by a channel separate from the packet URL, before the reviewer reads source.
- **Status:** previously documented for the prior packet; recurring.

---

- **ID:** N-10
- **Severity:** low
- **File/symbol/line:** `receipts/SOURCE_DELTA.json`, fields `baselineSha256` and `baselineGitBlobOid` on all 51 members; `baselineProductRevision: fdf413aa0c7b8ed0972e5633302d59b3eac04957`.
- **Observed fact:** the current side of every delta entry verifies (see §7). The baseline side cannot be verified because the baseline revision's blobs are not supplied and the private Git history is out of scope. The delta is therefore a publisher comparison, exactly as `CURRENT_CONTEXT.md` says.
- **Why it matters:** "2 changed, 11 new, 38 unchanged" is a claim about a revision I cannot see. The *shape* of the change is independently corroborated by `SOURCE_DELTA.patch`, whose ledger hunk I read line-by-line and which is purely additive, but the completeness of the change set is not independently established.
- **Reproduction/probe:** cross-checked all 51 `currentSha256` values against `SOURCE_IDENTITIES.json` and against raw blob bytes — zero mismatches. No probe is possible for the baseline side.
- **Required correction:** none. Recorded as a limitation, not a defect.
- **Status:** new.

## 7. Verification Results

**Test command/result:** **NOT RUN.** No subject test, helper, script, build or typecheck was executed by this review. The producer's own runs are AUTHOR_REPORTED_LOCAL_EXECUTION_NOT_INDEPENDENT by their own receipt (`PRODUCER_EVIDENCE.json`, `evidenceClass`), and I treat them as artifacts, not as execution.

**Probe command/result:**

| Probe | Result |
| --- | --- |
| Manifest verification — SHA-256 of every listed member recomputed from raw Git blobs (`git cat-file blob`, avoiding checkout newline conversion) | **73/73 match. 0 mismatches.** Every manifest entry exists on disk; the only on-disk file not listed is `MANIFEST.sha256` itself, as expected |
| Source identity verification — SHA-256, byte length and Git blob OID recomputed independently (`sha1("blob <len>\0" + bytes)`) for all 51 product members | **51/51 match on all three fields. 0 mismatches.** `memberCount: 51` matches the actual array length |
| Coverage check — every file under `source/` and `tests/` accounted for | All covered except the two `source/context/better-sqlite3/*` files, correctly excluded from product identities and separately receipted |
| Dependency-context verification — `transaction.js` and `LICENSE` | **2/2 SHA-256 and byte length match**, flagged `not-product-Git-member` |
| TAP artifact verification — SHA-256 of all five receipts | **5/5 match** `PRODUCER_EVIDENCE.json` |
| TAP count verification — `# tests/pass/fail/cancelled/skipped` and `# duration_ms` parsed from each artifact | **All five agree exactly with the declared values**, including `duration_ms` to four decimal places. Focused 128/128/0/0/0. Full 1925/1923/0/0/2. Historical 59, 88, 166 |
| Doc-embedded hash verification — the five source/test SHA-256 values tabulated in `ATOMIC_LEDGER_SNAPSHOT.md` | **5/5 match packet bytes.** This is the strongest contemporaneity evidence in the packet: the design document's hashes and the shipped blobs are the same bytes |
| Delta cross-check — all 51 `currentSha256` values against `SOURCE_IDENTITIES.json` | **51/51 agree. 0 mismatches.** Composition: 38 unchanged, 11 new, 2 changed = 51 |

| Delta patch inspection — the `windows-candidate-effect-ledger.ts` hunk | Purely additive: `#preflight` refactored into `#checkStoredState`, the recheck added inside the deferred read transaction, and `snapshot()` added. **No table, index, record format or signed-byte change**, as claimed |
| Workflow/activation check — search for `.github/`, `*.yml`, `*.yaml` across the repository at the audited commit | **None found. No GitHub Actions workflow exists at this commit**, so no Action could be triggered by a report write |

**Hash/manifest comparison:** complete and clean, with the trust-root caveat at N-09. Observed `MANIFEST.sha256`: 7,951 bytes, SHA-256 `8afa0c4ff75a4630991167bc96e81cb4ee26c738544ff47460155a3a450e450b` — recorded, not acknowledged.

**Receipt comparison:** `PRODUCER_EVIDENCE.json` is accurate on every field I could check. The two declared skips are present and correctly described in `CURRENT_FULL.tap`: entry **719**, "symlinked binary paths are rejected where the host permits link creation", carrying the explicit directive `# SKIP Windows link creation privilege unavailable`; and entry **1548**, "managed inspector refuses unsupported hosts rather than claiming Windows evidence", carrying a bare `# SKIP` with no reason string. Both are platform-conditional and neither touches the changed boundary. The bare-reason form on 1548 is a minor artifact-quality nit: the intent ("intentionally skipped on Windows") is recoverable only from `PRODUCER_EVIDENCE.json` and the test name, not from the TAP line itself.

**Focused composition check — the packet's claim verified independently, not accepted:** `CURRENT_CONTEXT.md` claims "128/128 (snapshot 15 + ledger 51 + checkpoint 29 + execution 33)". I extracted all 128 TAP entry names, extracted the declared `test()`/`it()` names from each of the five unit suites, and mapped them. The TAP numbering is strictly sequential 1–128 and groups contiguously by suite:

| Suite | TAP entry range | Count | Claim |
| --- | --- | --- | --- |
| `windows-candidate-checkpoint-sequencer.test.ts` | 1–29 | 29 | 29 ✓ |
| `windows-candidate-effect-ledger.test.ts` | 30–80 | 51 | 51 ✓ |
| `windows-candidate-effect-snapshot.test.ts` | 81–95 | 15 | 15 ✓ |
| `windows-candidate-synthetic-execution.test.ts` | 96–128 | 33 | 33 ✓ |

47 of the 128 names are generated from template literals in parameterized loops, so name matching alone resolves only 81; the contiguous ranges and the exact boundary positions resolve the remainder. The composition claim is **confirmed**.

**Scope check:** the packet contains exactly the declared scope. The delta change set (2 changed + 11 new) is precisely the release/checkpoint/execution/snapshot boundary named in `SCOPE.md`; the 38 unchanged members are dependency context. No source, test, receipt, request or manifest was edited by this review.

**Unexpected output or failure:** none. Every check that could be run, passed. One access note: `https://github.com/.../tree/...` for the packet directory returned a robots-disallowed error to the fetch tool, so directory enumeration was performed by public `git clone` at the pinned commit instead. This changed nothing about which bytes were read.

## 8. Security and Integrity Review

**Answers to the eight changed-boundary questions.**

**Q1 — Does CONTRACT_V3 close SC-B-01 without an infinite acknowledgment chain?** Structurally, yes, and the chain terminates correctly. Tracing the ordering in §1: the blocking outcome commits with its settlement-proof digest, checkpoint A is appended and confirmed, `released` is committed *referring to A* (not to its own digest), checkpoint B is appended over the released record and the complete post-commit inventory, and B is **not** written back as another ledger event. That last choice is what terminates the chain, and it is the right one. There is no circularity: A's digest is a value the anchor produced before the `released` record existed, so binding it into that record cannot depend on the record's own digest; B then commits to the post-release inventory, which already contains A's digest.

At each crash cut:

- **Ledger-released / anchor-old** (crash after step 2, before B): the local row reads `released` and the ordinary blocked column is false, but the complete durable inventory now includes the release event while the anchor head is still A, which witnessed the pre-release state. The mandatory joined read compares inventory root against authenticated fresh head and finds a mismatch. **Admission is refused.** V3 states this outcome explicitly and correctly: "After a step-2 crash, the local row can say released while admission remains blocked."
- **Persisted-B / lost reply** (append committed remotely, response lost): a fresh authenticated discovery establishes B, and the joined read then matches. Recovery is possible **only** through a fresh authenticated read, never through a local memory flag — V3 says this in terms, and the implemented v2 negative control at `windows-candidate-release-boundary.test.ts:96–111` proves the underlying point from bytes: "anchor response loss and absent append have identical ledger bytes but different independent histories."


Can a restarted or new owner admit work without the joined proof? Not structurally — the join is the admission decision by construction, and §2 requires an authenticated owner-epoch compare-and-swap durably recorded before any new-owner ledger write. But the honest separation is this:

- **What a structural v3 parser can guarantee:** that the release event binds a complete predecessor record digest, a settlement digest and an exact witnessing checkpoint; that inventory equals a claimed anchor root; that spent approvals and workflow/kind pairs are unique within the store; that the digest construction is non-circular and the event ceiling is respected.
- **What it cannot guarantee, at all:** that the anchor head is itself fresh rather than rolled back; that the old process is actually dead; that the workspace is physically free; that no second enrolled store exists. Those are physical custody and fencing, and they are B-03. A parser reading an authenticated-looking anchor record cannot distinguish a fresh head from a replayed one without the authentication and anti-rollback that do not exist here.

**Exact decisions required BEFORE v3 storage implementation** (this is the list the question asks for): (1) the v3 admission API surface — whether a blocked column or `listBlocked()` analogue is exposed at all, and if so what prevents its use as admission (F-01); (2) the canonical settlement-evidence digest core — domain, field set, bounds, empty handling (F-02); (3) the single version-spanning enrollment authority that makes approval identity unique across a v2 store and a v3 store (F-03); (4) the owner-epoch record's storage location and its authentication relationship to the anchor — §2 requires the CAS be "durably recorded before any new-owner ledger write" without saying where it lives; (5) whether `released` may be appended when the witnessing checkpoint is merely *believed* rather than authenticated-fresh — §1 says missing or disputed facts return blocked/reconciliation, which I read as no, but it is worth stating as a schema-level constraint rather than a prose rule.

Absorbing v2 quarantine is unchanged and I verified it from bytes: `terminal()` at `windows-candidate-effect-state.ts:94` includes `quarantined`, so no transition leaves it, and `candidateEffectBlocked` at `:91–93` excludes `quarantined` from the releasing set, so the workspace lock is held permanently. `windows-candidate-release-boundary.test.ts:127–139` confirms the store rejects `workspace-blocked`, `transition-denied` and an attempted `released` state as `input-invalid`.

**Q2 — Does the sequencer permit only one exact expected record delta?** Yes, and the mechanism is strong. `#pair` takes `before` and `current` inventories around the discovery await and requires `current.inventoryRootDigest === before.inventoryRootDigest` (`:246`), so nothing moved underneath. `#matches` (`:200–206`) requires the anchor head's inventory root *and* operation count *and* the specific record's event index, record digest and approval identity to agree with the current inventory — so the pair starts from genuinely matching complete inventories, not from a count. After the write, `:284–287` recomputes the expected inventory as `current.records` minus the touched operation, plus the returned record, and requires the observed `after` root to equal it exactly. That is a one-record-delta proof, not a count check. Bindings are all pinned: store and namespace at `:238`, installation/namespace/store inside every checkpoint core at `:288–291`, owner at `:197`, operation and approval identity in the checkpoint payload, and workflow/kind uniqueness re-derived inside `syntheticCheckpointInventory` at `:63–67`. Sequence and row count are correctly distinct — sequence increments per append while `operationCount` changes only on reserve.

Exact replay is observation only, with no write and no append (`:249–267`). Reentrant callers hit the `busy` latch at `:233`, set synchronously before any await. Time and abort policy are checked by `#live` at `:186–193`, which re-checks abort and deadline both before and after the owner assertion, so a slow `assertCurrent` cannot smuggle a stale authorization through. **Uncertainty never produces a guessed append, a compensation or renewed forward work:** a receipt that fails to parse yields `mutation-unconfirmed` at `:272–273`; any failure after contact sets `closed = true` at `:300`; there is no retry, no queue, no compensating terminal write anywhere in the file.

The audit request's caution is correct and I confirm it: the test ports and the WeakMap object identity at `:138` are **not** cross-process exclusion (N-01). The real cross-restart fence is the inventory-versus-head mismatch, which holds — at the cost that an unknown-append crash wedges the store permanently, because the implemented sequencer has no reconciliation path at all. That is correct fail-closed behaviour and it is exactly what V3 §2's reconciliation envelope is proposed to address. It also means the reconciliation envelope has **zero implemented coverage** and must not be read as validated by these tests.

**Q3 — Does `snapshot()` return every validated record from ONE read snapshot?** Yes. `#readAll` (`:129–139`) opens a deferred transaction whose *first* statement is `#checkStoredState()` — schema, durability and store/namespace metadata — which establishes the read snapshot before `#scan()` reads any row. So schema pins, metadata pins and rows all come from one consistent read point rather than from a pre-BEGIN check followed by later-committed rows. `snapshot()` (`:153`) is `deepFreeze(#readAll())` with no filter, no pagination, no caller callback, no clock and no public-read override; `read()` and `listBlocked()` go through the same private path, and the test at the top of the snapshot suite proves this by monkey-patching both public methods to throw and asserting `snapshot()` still succeeds with `clockCalls === 0` and an unchanged `total_changes()`.

Index-only trust is explicitly refused: `:115–125` re-derives operation, approval, workflow/kind and blocked-workspace uniqueness in application code, and `:126` re-derives publication parentage. Per-row validation at `:101–114` reparses, recanonicalizes, rehashes and cross-checks every indexed column against the record body. Bytes are SQL-bounded before disclosure at `:95–99`; the driver may fetch the 1,001st sentinel before `:100` rejects it, which is the anticipated behaviour, and nothing is truncated. The two-connection interleaving test is genuinely exact — it asserts `f.db.inTransaction === true` at the moment the row query is prepared, performs two commits on the second connection, asserts `f.other.inTransaction === false` and a row count of 2 *before* the reader selects, and then asserts the reader still returns the single old record while the next call sees both commits. Read-failure cleanup is tested to release its own transaction without rolling back a caller transaction, touching rows or consulting the clock.

**Snapshot consistency is not freshness, and the packet does not confuse them.** A snapshot is consistent at its read point and proves nothing about a later commit by another writer; there is no writer fencing; and coherently deleted history is undetectable from SQLite alone — the final test deletes every row and asserts a valid empty snapshot with a changed inventory root, with the explicit note that only a separately retained authentic checkpoint detects it, and that this does not close B-03.

Do the shared private read changes affect writes or post-commit read-back unexpectedly? Two effects, both recorded above. The read-back at `:179` now performs the in-transaction identity check, which is the intended tightening, but it runs in a *new* transaction, so a legitimate concurrent write poisons this instance (N-06). And `#write` itself was not given the in-transaction recheck, leaving a narrow empty-store window (N-02). Existing v2 table and index bytes are unchanged — confirmed from the delta patch.

**Q4 — Does synthetic execution establish each checkpoint before the effect it guards?** Yes, in all four required orderings, verified by line order in `windows-candidate-synthetic-execution.ts`: reservation checkpoint at `:215` strictly before readiness at `:218`; `source-delivery-possible` at `:220` strictly before `deliver` at `:221`; authentic-shape stored evidence validated at `:221–227` before the `launch-possible` marker at `:228` and before `run` at `:231`; and the run result parsed at `:234` but **not recorded or disclosed** until `stop()` has been awaited at `:235` and the `result-and-stop-observed` advance made at `:239`, with the return at `:243` after the terminal advance at `:241`.

Pins are complete at `:154–158`: request, workspace, policy-binding, store, namespace and resource-policy digests are all required to match the intent before anything starts, and the manifest is parsed against the request and the intent's `sourceManifestDigest`. **OCS1 counts are exact.** `storedSchema` at `:22–25` bounds `wireByteLength` to `[44, 16_782_848]` and `:226` requires `stored.wireByteLength === manifest.byteLength + 44 * manifest.fileCount`. This is arithmetically consistent with the real codec — `windows-candidate-source-transfer.ts:12–13` defines `headerBytes: 44` and `wireBytes: totalBytes + 44 * files`, and `:143` enforces the same identity — and with the stated maximum `16,777,216 + 44 × 128 = 16,782,848`. Destination retention and reread are required structurally (`endOfInputObserved`, `destinationReadBack`, `protectedDestination` are all `z.literal(true)`) and the destination inventory digest is recomputed from the manifest at `:223–224` and compared, so a task-authored count cannot stand in for a reread. Invalid result transport is handled at `:232–234`: non-string, over-length by character count *and* by byte length, and codec-invalid results all fail before any observation, and the test suite drives `{}`, a 65,537-character string, a `Uint8Array` and a result bound to a different request, asserting `quarantined` with no `result-and-stop-observed` event.

Every stop fact is required: `stoppedSchema` at `:26–28` demands `hostOff`, `dispatchClosed`, `allRelatedWorkSettled`, `generationRetired`, `sourceCustodyReleased` and `originalPublicationExcluded` all literally `true`, the binding must match, and `stop()` additionally requires `this.#pending === 0` at `:185` before setting `settled`. A stop object that merely claims settlement cannot satisfy that, because `#pending` is real counter state maintained at `:131–134`. **A successful fixture result is not an executed real verifier** — the ports are injected test seams and the module header says so.

Missing results after possible effects stay quarantined under v2: on the error path, `parsedResult` is cleared at `:246`, and `:255` selects `quarantined` whenever any event exists (i.e. after `source-delivery-possible` or later) and `cancelled` only when the record has zero events, which is reachable only before any possible delivery. The focused suite names exactly this: "v2 no-result stop after source-delivery-possible cannot become failure/cancellation or release a workspace" and the same for launch-possible.


**Q5 — Are cancellation, deadlines and cleanup honest?** Largely yes, with one named counterexample. Latches precede injected callbacks: `#used`/`usedPorts` are set at `:162` before any clock or policy callback, not merely before the first await, and the suite tests this directly ("injected clock and policy callbacks cannot reenter before the single-use latch"). In the sequencer's `#call`, the abort listener and timer are installed at `:220–221` *before* `run()` is invoked at `:225`, so there is no deferred contact after stop. Budgets are explicit, finite and checked for unsafe sums: `positive()` rejects non-safe-integers and out-of-range values in both modules, the sequencer requires `appendMs + discoveryMs <= pairMs`, and the execution constructor requires `5 × checkpointMs + readyMs + deliveryMs + runMs + stopMs <= overallMs`. Per-checkpoint versus execution allowance is distinguished — `phase()` at `:210` reserves the phase budget plus stop plus two checkpoints before starting. Preflight time is checked; late success after timeout cannot resurrect a result, because `Promise.race` has already settled and `parsedResult` is cleared; pending forward promises are tracked by `#pending` rather than assumed settled; a broken clock cannot block cleanup, because emergency stop uses raw `performance.now()`; policy expiry is re-checked in every `#live`; and disclosure is final, after all recording. Stop is attempted at most once — `stop()` memoizes on `stopping` at `:175`.

Does every feasible path reserve the checkpoint and stop costs it needs? **No — here is the concrete counterexample,** given in full in N-03: with `overallMs` at the constructor minimum, a full-length run and a full-length stop leave exactly `2 × checkpointMs`, and the unbudgeted synchronous work inside `checkpoint()` (parse, `readRecord`, digest at `:194–197`) can push the terminal advance at `:241` past the deadline, yielding `needs-reconciliation` with the record stranded at `result-and-stop-observed` and the workspace held. The failure direction is safe; the liveness is not guaranteed. I am not treating synthetic limits as production sizing, and note separately that `overallMs` is not a wall-clock ceiling because emergency stop may add `stopMs` beyond it (N-04).

**Q6 — Do the reconciliation envelope and release/admission binding resist stale-owner replay?** As designed, yes, conditionally. §2 requires every append, discovery and reconciliation request to be authenticated for the *current* owner epoch, requires rejection of old generations including delayed callbacks, keeps immutable historical payload bytes and producer epoch unchanged while wrapping them in a new-owner envelope, and requires the anchor to validate both the delegation and the exact expected prior checkpoint. At most one explicit idempotent append attempt is permitted; exact duplicates acknowledge the existing sequence, and conflicts, gaps, incomplete discovery or unknown retry outcomes retain the fence. That is a sound design, and it does not rewrite historic producer bytes.

Authorization digest construction is **non-circular**: §4 computes a versioned canonical intent core omitting only `authorizationDigest`, has the signed envelope bind that core digest, computes `authorizationDigest` over the exact canonical envelope bytes, and only then constructs the complete intent and its digest — so the signature covers an envelope core that does not contain its own signature. Cross-version spent-approval rules are also non-circular, and deliberately so: `APPROVAL_IDENTITY_DOMAIN` is pinned to `/v1` independently of the record schema domain, so identity is stable across v2 and v3. But non-circular is not sufficient — uniqueness is enforced per store only, which is F-03.

**Physical B-03 remains OPEN and I am not relabelling it.** The absent anchor backend is a missing backend, not an S1 data defect in these bytes. Nor am I dismissing the genuine tension as future work: the implemented v2 sequencer has *no* reconciliation path, so the unknown-append case is a permanent wedge today. That is the correct conservative behaviour for a synthetic model, but it means the whole reconciliation design in §2 is unexercised, and the gap between "designed" and "tested" here is total, not partial.

**Q7 — Is the proposed delivery grammar coherent?** Internally, yes. The four-frame maximum is consistent with the enumerated paths — `ready -> stored -> (result | run-failed) -> stopped` is four and `ready -> delivery-failed -> stopped` is three — and §3 is careful to say four is the maximum on any valid inbound path rather than the number of distinct kinds. Mutual exclusion of `stored` and `delivery-failed` is stated unambiguously, with failure explicitly never permitting run. EOF and stop semantics are coherent: stop may be requested before readiness, stop from any acquired prefix yields `stopped` with no further forward frame, and timeout, malformed input, missing readiness or missing `stopped` are all classified as uncertainty rather than an invented response. The OCS1 budget is kept separate from the manifest wire budget and the session control-frame budget, which is the right separation, and §3 states outright that byte ceilings are not transfer-time ceilings.

**I do not endorse this grammar as implemented or verified.** The current code is injected methods on a `SyntheticCandidateExecutionPorts` interface, not a serialized channel; there is no framing, no EOF handling and no process-settlement rule in the audited source. The only thing the implementation shares with the grammar is the OCS1 arithmetic, which I verified. §3's own requirement that "the fixed bound must be derived and tested along with per-frame bytes/chunks, EOF and process-settlement rules in the new transport implementation" is the correct disposition and is unmet.

**Q8 — Test falsifiability and chronology.** The current focused and full TAPs verify by hash and by parsed counts; the 51 source identities verify on SHA-256, byte length and Git blob OID; and the delta's current side verifies against both. The five hashes tabulated inside `ATOMIC_LEDGER_SNAPSHOT.md` match the shipped blobs, which ties the design document to the exact reviewed bytes — the single most useful contemporaneity artifact in the packet. The two skips are explained above and neither touches the changed boundary. The old 88/166 counts are correctly presented as historical, their focused artifacts are supplied, and `CURRENT_CONTEXT.md` maps them onto current evidence without rewriting them.

On falsifiability specifically: these tests are unusually good at the thing that matters, which is asserting what *cannot* happen. `windows-candidate-release-boundary.test.ts` does not assert that v2 is safe — it affirmatively reproduces the unsafe reservation at `:91` and labels it. The snapshot suite substitutes driver results, corrupts rows seven different ways, fires a real second connection at a precise point inside the reader's transaction, and asserts whole-inventory rejection rather than partial success. The sequencer suite tests that a late fulfilled port result cannot evade its own deadline, that an abort plus a synchronous injected throw leaves no unhandled rejection, and that a wrong receipt cannot anchor an unrequested transition. The execution suite tests that an unsettled delivery cannot be called stopped merely because a stop object says so. These are negative controls in the real sense.

The gaps are narrow and named: no negative control for a distinct wrapper object over a shared store (N-01), none for an identity swap between write preflight and `BEGIN IMMEDIATE` (N-02), none for the budget counterexample in N-03, and the release-boundary suite is absent from the focused artifact (N-08).

**Does this evidence support continued synthetic work and designing/implementing the v3 DATA schema?** It supports continued synthetic work over the unchanged v2 ledger, and it supports continued v3 *design* work. It does **not** yet support v3 data schema implementation, for the four reasons in §5. The bounded corrections required before that step are exactly F-01, F-02 and F-03 plus the two supplementary decisions listed under Q1. It authorizes no real consumer, no VM and no release.

**Secrets and sanitization:** I found no credential, token, private path or private infrastructure detail in anything I read. Fixture digests are deterministic synthetic patterns (`sha256:` followed by a padded hex counter), UUIDs are `randomUUID()` at test time, and temporary directories are created under `tmpdir()` with a verified prefix and removed with a guarded `rmSync`. `SANITIZATION.json` correctly records that pattern scanning cannot prove all secrets absent. Nothing in this report required redaction; no `[REDACTED]` marker appears because nothing sensitive was observed.

**Injection and control content:** the packet's governance documents contain operational instructions directed at the reviewer (report paths, write scopes). I treated them as the scope statement of the audit I was asked to perform, not as authority to take actions outside it, and I performed no write of any kind. `assertPassive` at `windows-candidate-effect-state.ts:49–72` is a notably careful control-content defence in the subject code itself: it tests for proxies and rejects accessors, non-plain prototypes, symbol keys and oversized graphs *before* any reflection that could trigger a trap, with the comment explaining precisely why the ordering matters.

## 9. Limitations and Missing Evidence

- **No independent execution.** Nothing in the subject was run: no test, helper, script, build, typecheck, provider or VM. Every count, duration and exit status in this report is a property of a supplied artifact, not of an execution I witnessed. Source inspection has not been converted into a successful probe anywhere above, and where I describe a test's behaviour I say it was read, not run.
- **Trust root incomplete (N-09).** The expected `MANIFEST.sha256` byte length and hash were never separately delivered. Internal consistency across manifest, identities, docs, delta and TAPs is complete and mutually reinforcing, but it is consistency within one fetched tree.
- **Baseline revision unavailable (N-10).** `baselineSha256` and `baselineGitBlobOid` in the delta cannot be checked. The delta's completeness is a publisher claim.
- **Partial reading, declared.** `CONTRACT_V2` sections 2–6, both synthetic design documents, `DEPENDENCIES.json`, the body of `SUCCESSOR_REVIEW.md`, the bodies of the ledger/sequencer/execution test suites beyond the named excerpts, and the 38 unchanged dependency files were not read. Conclusions rest only on what §3 lists as read.

- **Prior-involvement contamination (§2).** I am the same model as the prior reviewer and cannot rule out that I produced the prior report's bytes. This is a follow-up, not a fresh second opinion.
- **No physical, crash, power-loss or race evidence.** The tests reopen real SQLite files and use a real second connection with test-only driver hooks; they do not test host reboot, power cut, background processes or independent persistent storage. Connection reopen is not process death and is not host restart.
- **No measurement.** Every timing figure is a producer-recorded duration. I measured nothing. Synthetic budget caps (30s/60s/10s) are fixture configuration, not production sizing.
- **The anchor does not exist.** Every conclusion about owner epochs, freshness, anti-rollback and reconciliation is a reading of a design document against a port interface. None of it is verified behaviour.
- **Platform.** All producer evidence is Windows x64 / Node 24.14.0. I inspected bytes on Linux; the two TAP skips are Windows-conditional and unexercised on any other platform.
- **Proposed controls: NOT RUN.** Every corrective control suggested in §5, §6 and §10 is proposed, not executed.

## 10. Required Next Action

Minimal ordered list.

1. **Before anything else — settle the four open decisions that block v3 storage.** In order: (a) decide the v3 admission API surface and whether any releasing predicate is exposed to callers at all (F-01); (b) define the canonical settlement-evidence digest core with domain, exact field set and bounds (F-02); (c) specify the single version-spanning enrollment authority that makes approval identity unique across concurrently active stores, or prohibit coexistence outright (F-03); (d) state where the owner-epoch CAS record lives and how it authenticates against the anchor. Record each as a decision in CONTRACT_V3, not as a condition.
2. **Re-audit CONTRACT_V3 after those edits**, scoped to §1 and §2 only. The joined release/admission ordering and the reconciliation envelope are the parts that carry the security argument, and the decisions above change their text.
3. **Add the four missing negative controls** identified in §6 — distinct wrapper object over a shared store (N-01); identity swap between write preflight and `BEGIN IMMEDIATE` (N-02); the terminal-advance budget exhaustion counterexample, asserting `needs-reconciliation` and a retained blocker (N-03); and, if the write-path recheck is added, a case pinning it. These are cheap, they pin behaviour that is currently incidental, and they belong in the same suites that already exist.
4. **Fix packet hygiene for the next round.** Include the release-boundary suite in the focused artifact or state its exclusion in `CURRENT_CONTEXT.md` (N-08); attach an explicit skip reason to the inspector test so the TAP is self-describing; and send the expected manifest byte length and hash out of band before the reviewer reads source (N-09).
5. **Document the two accepted properties** rather than leaving them implicit: `overallMs + stopMs` as the true session wall ceiling (N-04), and roughly 32 MiB worst-case allocation per snapshot call with up to four calls per sequencer pair (N-07).
6. **Only after 1–3: implement the v3 DATA schema**, and re-audit it as its own changed boundary before any store is created.

**Intentionally excluded, and remaining so:** B-03 physical storage, authenticated fresh anchor, anti-rollback and actual owner/process fencing; real approval issuance, enrollment and issuer custody; VM acquisition and preflight; the real delivery transport and its grammar; original-file publication; installer, upgrade and rollback; independent execution; and W1–W5 acceptance. None of these is advanced by this report.

## 11. Explicit Non-Claims

This report does **not** certify any of the following:

- **Formal acceptance.** The evidence does not support it and none is issued.
- **Production readiness.** No component in this packet is production-authorized; the source says so itself in every module header.
- **Live-model or live-runtime readiness.** No runtime, HTTP surface, VM, issuer, source transfer or publication consumer was enabled, tested or reviewed for activation.
- **Public-release readiness.** Local preparation is not publication approval; the reviewer output exception authorizes no cleanup and no transfer.
- **That the tests pass.** I did not run them. I verified that artifacts claiming they pass are byte-consistent, internally coherent and correctly attributed. That is an artifact property, not an execution result.
- **That the packet bytes are the producer's intended bytes.** Without the out-of-band manifest pin (N-09), I verify internal consistency, not provenance.
- **That the delta is complete.** The baseline revision was not supplied (N-10).
- **That B-03 is closed, narrowed, or convertible into a data-layer fix.** It is open, physical, and outside every implementation in this packet.

- **That the v3 reconciliation envelope, delivery grammar, authorization envelope or owner-epoch protocol are implemented or verified.** None of them is implemented. Each is a design reviewed against a port interface.
- **That this is an independent second opinion.** It is not, for the reason disclosed in §2.
- **That any absence of findings equals absence of defects** in the parts of the packet listed as not read in §3 and §9.

---

```
MODEL_ID: claude-opus-5
ROUTE: operator-mediated scoped review via Anthropic Claude chat interface; no provider call from the repository; packet read by public GitHub clone at the pinned commit
AUDITED_REVISION: publisher source 0c01a44237fa17970e173fd99e2b9db55863e54e; audit-repository packet commit 0d27ba257d09be6bea70baa2234cf42c785b7fe2
IMPLEMENTATION_VERDICT: PASS_WITH_FINDINGS
SECURITY_VERDICT: NEEDS_REVIEW
EVIDENCE_VERDICT: PARTIAL
BLOCKING_FINDINGS: 4 (F-01 undecided v3 admission API surface; F-02 undefined settlement-evidence digest core; F-03 cross-store approval uniqueness has no enrollment authority; F-04 B-03 absent authenticated anchor/physical custody, pre-existing and correctly OPEN). All four block v3 data schema implementation; F-04 also blocks activation. None blocks continued synthetic work.
NONBLOCKING_FINDINGS: 10 (N-01 object-identity exclusion; N-02 write path lacks in-transaction identity recheck; N-03 unbudgeted synchronous cost, counterexample given; N-04 emergency stop exceeds overallMs by up to stopMs; N-05 one bad row denies all reads; N-06 post-commit read-back poisons on benign concurrent write; N-07 ~32 MiB worst-case snapshot allocation; N-08 release-boundary suite absent from focused TAP; N-09 manifest trust root not delivered out of band; N-10 delta baseline side unverifiable)
TEST_RESULTS: NOT RUN. No subject test, helper, script, build or typecheck was executed. Producer artifacts verified as artifacts only: CURRENT_FOCUSED 128/128/0 fail/0 cancelled/0 skip; CURRENT_FULL 1925 tests/1923 pass/0 fail/0 cancelled/2 skip; HISTORICAL_RELEASE_59, HISTORICAL_CHECKPOINT_88, HISTORICAL_EXECUTION_166 all pass-complete. All five TAP SHA-256 values and all parsed counts and durations match PRODUCER_EVIDENCE.json. Focused composition independently confirmed by TAP parse as checkpoint 1-29 (29), ledger 30-80 (51), snapshot 81-95 (15), execution 96-128 (33).
SCOPE_RESULT: In scope and complete. 73/73 manifest members, 51/51 source identities (SHA-256 + byteLength + Git blob OID), 2/2 dependency-context members, 5/5 TAP hashes and 5/5 doc-embedded source hashes all verify byte-exactly against raw Git blobs. Delta composition 38 unchanged + 11 new + 2 changed = 51, with all 51 current-side hashes agreeing with SOURCE_IDENTITIES. Ledger delta confirmed purely additive. No scope expansion; no source, test, receipt, request or manifest was edited.
PLATFORM_LIMITATIONS: No independent or physical execution. Producer evidence is Windows x64 / Node 24.14.0 only; the two TAP skips are Windows-conditional. No host reboot, power-cut, background-process, multi-process or timing measurement evidence. Baseline revision blobs not supplied. Expected MANIFEST.sha256 pin not delivered out of band. Anchor backend, enrollment, issuer, VM and transport do not exist in this packet. Reviewer shares model identity with the author of the supplied prior report.
ADVANCEMENT: YES for retaining and continuing to test the synthetic v2-only composition and for continued v3 DESIGN work; NO for v3 data schema implementation, real consumer, VM and activation.
NEXT_REQUIRED_ACTION: Settle the four open v3 decisions (F-01 admission API surface; F-02 settlement-evidence digest core; F-03 version-spanning enrollment authority; F-04/owner-epoch record location), record them in CONTRACT_V3 as decisions rather than conditions, then re-audit CONTRACT_V3 sections 1-2 before any v3 record schema is written.
SYNTHETIC_COMPOSITION_VERDICT: PASS_WITH_FINDINGS
V3_DATA_SCHEMA_IMPLEMENTATION_READY: NO
ACTIVATION_READY: NO
REPORT_DELIVERY: BLOCKED_NO_GITHUB_WRITE_ACCESS
```

**Report delivery note.** I have no GitHub write credential in this session and did not request one. The intended target is `eOnoes/Audits`, branch `main`, exact path `onoes-agent-checkpoint-execution-0c01a44237fa-static-design-v1/reports/AUDIT_REPORT.md`. That path is currently free — the reports directory at the audited commit contains only `README.md`, and no external report has been received for this packet — so `AUDIT_REPORT.md` is the correct filename and no `AUDIT_REPORT_ADDENDUM_N.md` is needed. I checked activation state as required: the repository contains no `.github/` directory and no workflow files at this commit, so no Action could be triggered by the write. No upload occurred and no upload success is claimed. This Markdown is returned complete for operator delivery.
