# Audit Report — Onoes-Agent candidate effect ledger S1 / onoes-agent-candidate-effect-ledger-76dc12a9474d-github-v1

## 1. Executive Summary

This is a read-only STATIC_SOURCE review of the eleven-blob S1 packet at GitHub commit `2130d72cc3db2304395c964071e11414469e631b`. All 21 manifest entries rehash correctly, all 11 declared product members match their recorded SHA-256, Git blob OID and byte length, and the manifest covers every packet file. The two build-only modules implement a coherent, fail-closed, data-only effect contract: input handling rejects proxies and accessors before any reflection, the transition graph is linear and absorbing, `BEGIN IMMEDIATE` is taken before every uniqueness decision, no caller callback runs inside a transaction, and every return is explicitly labelled recorded state rather than effect permission. I found no path by which this code grants, implies or manufactures permission to invoke an effect. I did find two source-level gaps that must be closed before any consumer is composed — records carry no binding to the store that holds them, and cross-row uniqueness invariants are enforced only by SQL indexes and reservation-time scanning, never independently re-derived on read — plus one evidence defect: the supplied focused TAP is not the run the decision document records as final. **Advancement is blocked for consumer composition and activation.** Dormant retention of these exact bytes is acceptable with the findings below recorded against them.

## 2. Audit Identity

- **Audit ID:** `onoes-agent-candidate-effect-ledger-76dc12a9474d-github-v1`
- **Project:** Onoes-Agent candidate effect ledger S1
- **Auditor/model:** Claude Opus 5 (Anthropic). Exact internal build string is not exposed to me; I can state the model family and tier only.
- **Prior involvement:** I am **not** a first-contact independent reviewer. Persistent memory in this account records prior conversations with the requester about the Onoes-Agent project generally — the managed-executor/LPAC-verifier architecture and the STATIC_SOURCE Markdown courier review protocol. I hold no record of having reviewed this S1 packet, its predecessor `…-static-v1`, or the design-v2 report, and no record of having authored or contributed to any blob in scope. `reports/README.md` states no independent report exists for this packet, consistent with that. Treat this review as informed-but-not-naive, and not as an independent second opinion on the earlier design-v2 report.
- **Route/provider:** Operator-mediated. The packet was fetched over public HTTPS and the public repository was cloned read-only into a local sandbox. No provider calls, no Actions, no hosted runners, no writes to GitHub.
- **Audit type:** STATIC_SOURCE + data-contract design, security, implementation and evidence
- **Date/time UTC:** 2026-09-13, review conducted within the day the packet was prepared
- **Audited revision:** packet commit `2130d72cc3db2304395c964071e11414469e631b`; declared publisher product revision `76dc12a9474d626efcf1944c86f4ffd131bfef2f`

## 3. Scope and Method

**In scope:** only `onoes-agent-candidate-effect-ledger-76dc12a9474d-github-v1/` — `AUDIT_REQUEST.md`, `SCOPE.md`, `MANIFEST.sha256`, `source/`, `tests/`, `receipts/`, `reports/README.md`.

**Exclusions:** the wider and current product tree, the VM, the native controller, credentials, real approvals, consumers, providers, deployment, the newer working product, and the model-recovery packet that shares this repository.

**Files inspected (all 21, in full):**

| Path | Read |
|---|---|
| `AUDIT_REQUEST.md`, `SCOPE.md`, `MANIFEST.sha256`, `reports/README.md` | full |
| `source/src/build-only/windows-candidate-effect-state.ts` | full (129 lines) |
| `source/src/build-only/windows-candidate-effect-ledger.ts` | full (181 lines) |
| `source/src/compatibility/canonical-json.ts` | full (103 lines) |
| `source/src/validation/deep-freeze.ts` | full (8 lines) |
| `tests/tests/unit/windows-candidate-effect-ledger.test.ts` | full (302 lines) |
| `tests/tests/helpers/candidate-effect-crash.ts` | full (11 lines) |
| `tests/tests/helpers/candidate-effect-racer.ts` | full (17 lines) |
| `source/docs/handoff/ONOES_AGENT_DISPATCH_LEDGER_DECISIONS.md` | full (166 lines) |
| `source/context/better-sqlite3/lib/methods/transaction.js`, `LICENSE` | full |
| `source/package-lock.json`, `source/tsconfig.json`, `source/tsconfig.test.json` | full |
| `receipts/SOURCE_IDENTITIES.json`, `DEPENDENCIES.json`, `PRODUCER_EVIDENCE.json`, `GITHUB_PACKET_PROVENANCE.json`, `FOCUSED_TESTS.tap` | full |

No file in scope was left unread.

**Commands/probes run (bounded offline only):**

1. `git clone` of the public repository, then `git checkout 2130d72c…` — ordinary public browsing/cloning, explicitly permitted.
2. `sha256sum -c MANIFEST.sha256` — 21/21 OK.
3. `git hash-object` + `wc -c` per member, compared programmatically against `SOURCE_IDENTITIES.json`.
4. Manifest-vs-disk set difference.
5. Python byte arithmetic computing the worst-case canonical record size.

**Cost/mutation controls observed:** no branch, commit, push, PR, edit, delete, workflow, runner, build, install, download, deployment, provider call or model call originating from the repository. No secrets were requested, encountered or exposed. The subject tests and helpers were **not executed** and were not compiled. No SQLite database was created. No dependency was installed; `better-sqlite3`, `zod` and `typescript` were not fetched.

## 4. Verdict

```
IMPLEMENTATION_VERDICT: PASS_WITH_FINDINGS
SECURITY_VERDICT: NEEDS_REVIEW
EVIDENCE_VERDICT: PARTIAL
ADVANCEMENT: NO
```

Scope of the verdict: this is a verdict **for dormant retention of the S1 contract only**. It is not a verdict for consumer design, and it is not a verdict for activation. `ADVANCEMENT: NO` means no consumer may be composed against this contract and no installation may be activated until B-01 through B-04 are closed. Retaining these exact bytes, dormant, with this report attached, is supported by the evidence.

## 5. Blocking Findings

### B-01 — Records carry no binding to the store that holds them
- **ID:** B-01
- **Severity:** blocker
- **File/symbol/line:** `source/src/build-only/windows-candidate-effect-state.ts` lines 15–26 (`common`, `effectIntentSchema`) and 33–34 (`effectRecordSchema`); `source/src/build-only/windows-candidate-effect-ledger.ts` lines 100–103 (`scan` row/record cross-checks)
- **Observed fact:** the intent schema binds `namespaceId` but no store identity. `SqliteCandidateEffectLedger.preflight` (lines 82–83) verifies that the meta row's `store_id` matches the constructor's `storeId`, but `scan()` cross-checks each record only against `this.namespaceId` (line 100). `canonicalSha256Digest(record)` (line 98) likewise covers no store identity. The `storeId` appears in the write return value (line 144) as metadata, not as a bound field.
- **Why it matters:** every row in a store is byte-portable to any other store that shares the same namespace UUID. An actor with file access can copy a completed, passed execution record from store A into store B and it validates cleanly — correct digests, correct columns, coherent history, matching namespace — and then funds a `publish` reservation in B via `verifiedParent` (lines 65–73). This is distinct from, and narrower than, the acknowledged "malicious host creates another store" gap: here the *records themselves* are the portable artifact, so an approval consumed once in A can be made to appear consumed-and-completed in B without the attacker having to forge anything. The design document's claim that one approval ID is "globally unique within the namespace" (decision doc line 46) is enforced only per-store, and nothing in the record resists relocation.
- **Trust assumptions:** assumes an actor with write access to the SQLite file or the ability to present a second store to a future consumer. It does not assume any key compromise.
- **Falsifiable proposed control (NOT RUN):** construct two initialized stores over the same `namespaceId` with distinct `storeId`s; copy one completed `execute` row verbatim from store A into store B; assert that `read()` on B fails with `identity-mismatch`. Under current bytes this probe is predicted to **succeed in reading the transplanted record**, i.e. the control fails.
- **Minimal correction:** add `storeId` to `common` in `effectIntentSchema`, assert `record.intent.storeId === this.storeId` in `scan()` alongside the existing namespace check, and add a `store_id` column with a CHECK or a covering assertion. This is a schema-version change, so it belongs in S1 while the store is empty and dormant rather than after any record exists.
- **Status:** new. This is an S1 source defect, not an intentionally absent future-host mechanism — no document in the packet defers store-binding to the host.

### B-02 — Cross-row uniqueness invariants are never independently re-derived
- **ID:** B-02
- **Severity:** blocker
- **File/symbol/line:** `windows-candidate-effect-ledger.ts` lines 85–108 (`scan`), compared against lines 17–25 (`OPS`, `LOCK`) and lines 157–159 (`reserve` uniqueness checks)
- **Observed fact:** `scan()` re-derives every *row-internal* invariant — it re-parses `record_json`, replays the transition graph, recomputes the canonical bytes and digest, and compares all seven indexed columns plus the derived `blocked` value against the parsed record (lines 96–103). It re-checks publication parentage across rows (line 106). It does **not** re-derive the three cross-row invariants: uniqueness of `approval_identity_digest`, uniqueness of `(workflow_id, kind)`, and exclusivity of `workspace_digest` among rows with `blocked = 1`. Those exist only as SQL constraints (lines 18, 22, 24–25) and as forward-looking checks at reservation time (lines 157–159), which examine the scanned set but only to reject a *new* intent.
- **Why it matters:** the packet's own threat model is corruption that bypasses SQL CHECKs — `scan()`'s comment at line 86 says so explicitly, and the test suite exercises exactly that by writing rows directly and by toggling `ignore_check_constraints`. Under that same model, two rows sharing one `approval_identity_digest`, or two `blocked = 1` rows on one `workspace_digest`, validate cleanly and both remain advanceable. The store would then hold two live, independently advanceable possible-effect chains funded by one approval, or two concurrent blockers on one workspace, with no error raised on any read. `schema()` cannot catch this either: it filters `WHERE sql IS NOT NULL` (line 28), so the implicit indexes backing `UNIQUE` constraints are never inspected — only the table's CREATE text is.
- **Trust assumptions:** assumes the same file-write adversary or index-level corruption the rest of the module is explicitly hardened against. No stronger assumption than B-03 requires.
- **Falsifiable proposed control (NOT RUN):** insert two valid rows sharing one `approval_identity_digest` with the unique index bypassed; assert `listBlocked()` fails `state-invalid`. Predicted under current bytes: both rows return successfully.
- **Minimal correction:** at the end of `scan()`, before returning, assert that `approvalIdentityDigest`, `(workflowId, kind)` and blocked-`workspaceDigest` are each pairwise unique across `records`, failing `state-invalid`. Roughly six lines, no schema change, and it makes the application the independent checker the design already claims it to be (decision doc line 65: "indexed duplicates are checked against parsed records on every scan" — that claim is true for column↔record agreement, but not for row↔row uniqueness).
- **Status:** new. S1 source defect.

### B-03 — Unkeyed record digest and no anti-rollback anchor
- **ID:** B-03
- **Severity:** high
- **File/symbol/line:** `windows-candidate-effect-ledger.ts` line 98 (`canonicalSha256Digest(record) !== row.record_digest`) and lines 11–12 (trusted-host comment); `canonical-json.ts` lines 97–102
- **Observed fact:** `record_digest` is a plain SHA-256 over the canonical record bytes, computed from data the same actor can rewrite. Test 13 demonstrates that a rehashed *incoherent* forgery is caught — but it is caught by the transition-graph replay in `validateCandidateEffectRecord` (state.ts lines 117–119), not by the digest.
- **What unkeyed hashing does NOT detect (answering scoped question 4 directly):** (a) a fully coherent forged history — reserved → source-delivery-possible → launch-possible → result-and-stop-observed(passed) → completed — written with correct canonical bytes, correct digest and correct columns; nothing distinguishes it from a genuine record; (b) whole-file rollback to an earlier snapshot on the same disk, since every row in the older file is self-consistent (acknowledged, decision doc line 98); (c) wholesale deletion of rows, since there is no expected-count, high-water-mark or chained digest; (d) relocation of rows between stores (see B-01). It detects only accidental corruption, partial column drift, and forgeries whose *history* is illegal.
- **Trust assumptions:** the module explicitly delegates file/WAL/SHM protection to the host (line 12), and the decision document lists protected installation, enrollment and retention as open gates. This finding is therefore an **intentionally absent future-host mechanism**, recorded here because it is load-bearing for advancement, not because S1 promised it.
- **Falsifiable proposed control (NOT RUN):** author a syntactically and semantically legal five-event completed record offline, insert it, and assert the store rejects it. Predicted: accepted. This probe should be retained as a permanent negative control documenting the boundary.
- **Minimal correction:** none within S1. Before activation: protected storage ACLs that exclude the low-privilege task identity, plus a keyed MAC or an external monotonic anchor (counter or attested high-water mark) bound to `storeId` and row count, designed together with the retention/archival rules the decision document already defers.
- **Status:** previously documented (decision doc lines 88–98, 161–165); restated with the specific undetected-corruption enumeration the request asked for.

### B-04 — Supplied focused TAP is not the run recorded as final
- **ID:** B-04
- **Severity:** high
- **File/symbol/line:** `source/docs/handoff/ONOES_AGENT_DISPATCH_LEDGER_DECISIONS.md` lines 135–136 versus `receipts/PRODUCER_EVIDENCE.json` (`focused.durationMs`, `focused.sha256`) and `receipts/FOCUSED_TESTS.tap`
- **Observed fact:** the decision document records the final focused run as 18/18 in **926.2852 ms** with TAP SHA-256 **`a7ecb823a88766df28b044b0faed1de7b7c3f7b7a71f3a346645f795a0ccb600`**. The supplied TAP is 18/18 in **1185.3941 ms** and hashes to **`119918dea2ae0fc98c45f8dd153f1b80d067f88360a59d2a7fcb96b7d64c0f35`**, which is what `PRODUCER_EVIDENCE.json` and `MANIFEST.sha256` both record. These are two different executions. The wider full-run hash (`6e70f4ec…`) is consistent across both documents, so the divergence is confined to the focused run.
- **Why it matters:** scoped question 4 asks whether receipts, hashes and revision identifiers are contemporaneous. For the focused suite they are not. Either the decision document is stale relative to a later re-run, or the packet ships a receipt from a different run than the one the producer certified. Neither is detectable from within the packet, and both undermine using the decision document as the authoritative producer claim it is nominated to be (required reading order item 5). A related, milder instance: the decision document names source baseline `ebc0059bf3f5663454959ffc13875e3e829531fc` (line 4) while the packet's declared product revision is `76dc12a9474d…` — expected for a document written against a parent commit, but it means the document is not self-evidently contemporaneous with the audited revision either.
- **Trust assumptions:** none; this is an internal inconsistency in the supplied bytes.
- **Falsifiable proposed control (NOT RUN):** recompute SHA-256 over `.audit-preparation/candidate-effect-ledger-focused-20260913.tap` in the publisher workspace and state which of the two hashes it matches. I performed the packet-side half of this: `sha256sum receipts/FOCUSED_TESTS.tap` = `119918de…`, confirmed.
- **Minimal correction:** reconcile and correct the decision document (or re-issue the receipt) so one focused run, one duration and one hash are stated everywhere. Do not rewrite existing manifest members in place — publish the correction as a new member and note the supersession.
- **Status:** new. Evidence defect, not a source defect.

## 6. Nonblocking Findings

### N-01 — Observation and terminal events are unbounded by expiry
- **Severity:** medium · **File:** `windows-candidate-effect-state.ts` lines 101–102 · **Status:** new
- **Observed fact:** the expiry gate applies to exactly three states: `source-delivery-possible`, `launch-possible`, `publication-possible`. `result-and-stop-observed`, `completed`, `failed` and `restored` are never compared against `intent.expiresAt`. The only remaining time constraint is monotonic `recordedAt` (line 95).
- **Consequence:** an execution whose `launch-possible` marker was committed one millisecond before expiry may have a *passed* observation and a `completed` terminal recorded arbitrarily later — hours or days — and that completed record then satisfies `verifiedParent` and funds a publication. The producer framing is "permitting stop/failure bookkeeping after expiry" (test 7), which is correct and desirable; what is unstated is that *successful* bookkeeping is equally unbounded. `expiresAt` therefore bounds when effects may be *started*, not the window within which their outcome remains meaningful.
- **Trust assumptions:** relies on the future host never recording a stale success. The store cannot distinguish a stale success from a fresh one.
- **Proposed control (NOT RUN):** advance to `launch-possible` at `expiresAt - 1 ms`, jump the clock forward one year, record `result-and-stop-observed(passed)` and `completed`, then reserve a publication. Predicted: all succeed.
- **Minimal correction:** either add a separate observation deadline field to the intent, or document explicitly in the consumer contract that the host owns outcome freshness and must refuse to record an observation outside its own settlement budget.

### N-02 — Instance-scoped protections are cleared by re-instantiation
- **Severity:** medium · **File:** `windows-candidate-effect-ledger.ts` line 75 (`#writePoisoned`), 126, 145; lines 40–44 (`configure`) called from 78 · **Status:** new
- **Observed fact:** write poisoning is a private in-memory field on one `SqliteCandidateEffectLedger` object. Separately, the constructor calls `configure()`, which *sets* `journal_mode`, `synchronous`, `foreign_keys`, `trusted_schema` and `busy_timeout` — so pragma drift is silently normalised at construction, whereas `preflight()` on every subsequent read and write only *checks* via `durability()`.
- **Consequence:** both protections are one `new SqliteCandidateEffectLedger(...)` away from being cleared. The suite proves this by design — test 12 poisons the instance and then reopens to obtain a successful `replayed` — which is the intended recovery path, but the same move clears the poison for a host that should not be writing at all. Likewise a host that drifted durability pragmas restores its own write path by reconstructing. Neither is a defect in the recovery story; both mean the phrase "poisons writes" in the decision document (line 90) and in test names should read "poisons that instance's writes", which the document does say at line 90 but the test titles do not.
- **Proposed control (NOT RUN):** after poisoning, construct a second ledger over the *same* connection and assert the write is still denied. Predicted: the write succeeds.
- **Minimal correction:** none required for S1 data-only retention. For a consumer: persist an uncertainty marker in the meta table rather than in process memory, and make `configure()` a separate explicit call not reachable from the constructor.

### N-03 — A single forward clock excursion permanently denies all writes
- **Severity:** medium · **File:** `windows-candidate-effect-ledger.ts` line 136 · **Status:** new
- **Observed fact:** `write()` denies `clock-invalid` if the sampled `at` precedes the latest `recordedAt` (or `reservedAt`) of *any* record in the store, not just the record being touched. There is no delete, prune, reset or repair path anywhere in the module (decision doc line 94).
- **Consequence:** one event recorded while the host clock was jumped forward — to 2099, say — denies every subsequent write to that store until wall time catches up, with no remedy short of abandoning the store. Combined with the 1,000-operation lifetime quota this is a permanent, unrecoverable denial. The direction of failure is correct (closed, not open), and the cross-operation regression check is the right idea; the availability consequence is simply not documented.
- **Proposed control (NOT RUN):** reserve with `now()` returning a year-2099 timestamp, restore a real clock, then attempt any write. Predicted: `clock-invalid`, permanently.
- **Minimal correction:** document it as an operational gate alongside the quota; a future consumer should validate the sampled clock against a sane window before it reaches the ledger.

### N-04 — One corrupt row denies the entire store with no repair path
- **Severity:** medium · **File:** `windows-candidate-effect-ledger.ts` lines 93–107 · **Status:** new (behaviour is intentional; the unrecoverability is the finding)
- **Observed fact:** `scan()` throws on the first row that fails validation, and every read and every write routes through `scan()`. Test 13 confirms that a single drifted `blocked` column denies `listBlocked()` wholesale.
- **Consequence:** fail-closed and correct for integrity, but the store has no partial-discovery mode, no per-row quarantine, and no delete. A host that must inspect durable state to decide whether an effect occurred loses all visibility the moment any row is damaged — which is precisely the situation in which discovery matters most. "Fresh read-only discovery can inspect durable state" (decision doc line 91) holds only while every row is intact.
- **Minimal correction:** none for S1. A consumer needs a documented forensic path — for example an out-of-band raw-row dump procedure — so that whole-store denial does not become whole-store blindness.

### N-05 — `reserve()` replay succeeds silently on quarantined and terminal operations
- **Severity:** medium · **File:** `windows-candidate-effect-ledger.ts` lines 152–156 · **Status:** new
- **Observed fact:** the replay branch matches on `operationId` and identical canonical intent, then returns `{ disposition: "replayed", record }` before the approval-reuse, workflow-reuse, workspace-blocked, quota, expiry and `verifiedParent` checks at lines 157–161. It applies regardless of the record's current state, including `quarantined`.
- **Consequence:** a caller that keys on `disposition` rather than inspecting `record` will read "replayed, no error" for an operation that is absorbing-quarantined. Idempotency requires this branch, and the return `kind` is literally `"recorded-state-not-effect-permission"`, so the guard exists — but it is a naming convention, not a mechanism. This is the single most likely way a future consumer misreads this API.
- **Minimal correction:** state it as a mandatory consumer rule; optionally surface the record's state in the returned envelope so that a consumer cannot act on `disposition` alone.

### N-06 — `touched` is latched before the write is attempted
- **Severity:** low · **File:** `windows-candidate-effect-ledger.ts` line 138 · **Status:** new
- **Observed fact:** `touched = true` is assigned before `this.save(...)` executes, so any failure inside `save()` — including a `SQLITE_BUSY` that exhausts the 250 ms `busy_timeout` (line 43) — poisons the instance even though the transaction rolled back and nothing was written.
- **Consequence:** conflates "the write outcome is uncertain" with "the write definitely did not happen", in the conservative direction. The practical window is narrow, because `BEGIN IMMEDIATE` contention throws before the closure runs and `reserve()`'s uniqueness checks precede `save()`. Under a contended multi-writer host the short busy timeout makes it reachable.
- **Minimal correction:** set `touched` after `save()` returns, so that only post-write uncertainty poisons; or leave as-is and document the conservatism.

### N-07 — Integrity read-back uses the public, overridable `read()`
- **Severity:** low · **File:** `windows-candidate-effect-ledger.ts` line 141; `private` modifiers at lines 76–77, 80, 85, 109, 116, 125 · **Status:** new
- **Observed fact:** post-commit verification calls `this.read(...)`, a public method, and compares canonical bytes (line 142). The test suite itself replaces `f.store.read` at test 12 line 208 to inject the fault — demonstrating that the integrity check is caller-overridable. All other members use TypeScript `private`, which has no runtime effect; only `#writePoisoned` is a true private field.
- **Consequence:** defence-in-depth only — the host owns the object and the connection, so this is not an escalation path. It does mean the read-back guarantee is structurally softer than the `#`-private poison flag next to it.
- **Minimal correction:** add a `#readOne()` used by both `read()` and the read-back path, and convert `db`, `storeId`, `namespaceId` and the internal methods to `#` fields.

### N-08 — Publication parent freshness is unbounded
- **Severity:** low · **File:** `windows-candidate-effect-ledger.ts` line 72 · **Status:** new
- **Observed fact:** `verifiedParent` enforces ordering (`reservedAt >= parent.events.at(-1).recordedAt`) but no maximum age. The publish intent's own `expiresAt` governs only its forward marker.
- **Consequence:** a publication may be reserved against an execution that completed arbitrarily long ago, provided the approval and `(workflowId, 'publish')` slot are unused. Combined with N-01 this widens the window in which a stale result can be promoted.
- **Minimal correction:** decide the policy explicitly at consumer design; either bind a maximum parent age or document that the host owns it.

### N-09 — Terminal release frees the workspace for unlimited re-execution
- **Severity:** low · **File:** `windows-candidate-effect-state.ts` lines 88–90; `windows-candidate-effect-ledger.ts` line 159 · **Status:** new (intended behaviour, stated for the consumer contract)
- **Observed fact:** `candidateEffectBlocked` returns false for `completed`, `failed`, `restored` and `cancelled`, so the partial unique index releases. A fresh `operationId`, `workflowId` and `approvalId` may then reserve against the same `workspaceDigest`.
- **Consequence:** the ledger provides a once-at-a-time guarantee per workspace, not a once-ever guarantee. The decision document's "A new workflow never bypasses a retained workspace blocker" (line 52) is true and is *only* about retained blockers. A consumer that reads it as once-ever would be wrong.
- **Minimal correction:** state the distinction in the consumer contract.

### N-10 — Two full scans per write
- **Severity:** low · **File:** `windows-candidate-effect-ledger.ts` lines 134–142 · **Status:** new
- **Observed fact:** every write performs a full `scan()` inside the `IMMEDIATE` transaction and a second full `scan()` via `read()` for read-back. Each scan JSON-parses, canonicalises, hashes and graph-replays every row, up to 1,000 rows. `verifiedParent` is additionally re-run per record (line 106).
- **Consequence:** cost grows linearly with lifetime operations and is paid twice per write. The producer's own quota test measured 246.99 ms with 1,000 seeded rows. Not a security property; relevant to any future host with a settlement budget.

### N-11 — The 32 KiB record ceiling is unreachable for valid records
- **Severity:** informational · **File:** `windows-candidate-effect-state.ts` line 9; `windows-candidate-effect-ledger.ts` lines 21, 90, 117 · **Status:** new
- **Observed fact (reproduced by byte arithmetic):** every record field is length-bounded by regex — UUID 36 bytes, digest 71 bytes, timestamp 24 bytes — and `events` is capped at 6. A maximal `publish` record with six maximal observation events canonicalises to **3,329 bytes**, 9.8× below the 32,768-byte ceiling.
- **Consequence:** the SQL `CHECK`, the `scan()` `CASE` guard and the `save()` check can only ever fire on corrupted or forged input, never on legitimate growth. That is a sound design, and worth recording so a future reader does not treat 32 KiB as a live headroom figure.

### N-12 — The race test's assertions are satisfied by fully serialized execution
- **Severity:** medium (test evidence) · **File:** `tests/tests/unit/windows-candidate-effect-ledger.test.ts` lines 283–301; `tests/tests/helpers/candidate-effect-racer.ts` · **Status:** new
- **Observed fact:** the `SharedArrayBuffer` barrier releases both workers once both report ready, but nothing establishes that the two `BEGIN IMMEDIATE` statements overlap. The asserted multiset — `["recorded","replayed"]` or `["recorded","workspace-blocked"]` — is exactly what fully serialized execution produces. A run in which worker A completes before worker B begins passes identically.
- **Consequence:** the test proves that the *outcome* is correct under two independent connections to one real on-disk SQLite file, which is genuine and valuable. It does **not** prove mutual exclusion under true lock contention, and it cannot fail in a way that distinguishes the two. Separately, `busy_timeout = 250 ms` makes the test load-sensitive: genuine overlap on a busy machine can yield `storage-unavailable`, which the assertion does not accept — a latent flake in the direction of false failure rather than false pass.
- **Minimal correction:** instrument the workers to report the SQLite lock outcome, or assert that at least one worker observed contention; and widen the accepted result set or raise the timeout for the test path.

### N-13 — Missing negative controls and untested branches
- **Severity:** medium (test evidence) · **Status:** new
- **Observed gaps**, none of which are covered by the 18 focused tests:
  1. **No coherent-forgery control.** Nothing pins the boundary of unkeyed hashing (B-03). The suite tests only forgeries with illegal histories.
  2. **No cross-row duplicate control.** Nothing tests two rows sharing an approval identity or a blocked workspace with the index bypassed (B-02).
  3. **`ATTACH` is untested.** The `database_list` branch at line 32 has no test; only the temp-table branch and one pragma (`synchronous`) are exercised. `journal_mode`, `foreign_keys`, `trusted_schema`, `busy_timeout` and `ignore_check_constraints` drift each have an untested branch in `durability()`.
  4. **`restored` is never exercised.** The publication → `restored` transition (state.ts line 109) is implemented and reachable but appears in the suite only inside test 5's *denial* loop for `execute`. No test records a successful `restored`.
  5. **Record-byte and event ceilings untested.** `limit-exceeded` is exercised only for the 1,000-operation quota; the `save()` byte ceiling (line 117), the `effectParse` byte ceiling (state.ts line 76) and `z.array(...).max(6)` have no test.
  6. **Clock-forward permanence untested** (N-03).
  7. **Re-instantiation clearing poison or pragma drift untested** (N-02).
  8. **Windows-only execution.** The producer states cross-platform execution was not performed (decision doc line 142). WAL and file-locking semantics differ materially on POSIX; the crash and race tests are the ones most sensitive to that.
- **Minimal correction:** add items 1, 2 and 4 before any consumer work; the rest can follow.

## 7. Verification Results

**Hash/manifest comparison:** `sha256sum -c MANIFEST.sha256` → **21/21 OK**. Manifest covers every packet file; the only on-disk file absent from the manifest is `MANIFEST.sha256` itself, which is correct.

**Identity comparison:** all 11 members in `SOURCE_IDENTITIES.json` matched on all three axes — SHA-256, Git blob OID, byte length. `memberCount` 11 equals the actual member count. Reproduced OIDs, for the record:

| productPath | gitBlobOid | bytes |
|---|---|---|
| `src/build-only/windows-candidate-effect-ledger.ts` | `bcf7a4532d2b854f328a14256294dc61afda4189` | 12745 |
| `src/build-only/windows-candidate-effect-state.ts` | `9213f7dbd4b16081b1a9848fad98b0f65f166923` | 8833 |
| `src/compatibility/canonical-json.ts` | `ac2bbf20f26a59742496063da80270b521d8a2f7` | 4581 |
| `src/validation/deep-freeze.ts` | `80c50ff8ee793f6ff62dc619eae705a54b4dadcf` | 378 |
| `tests/unit/windows-candidate-effect-ledger.test.ts` | `30e14f68ba31ce2a344650c4b71d6fde3075fd2f` | 20204 |
| `tests/helpers/candidate-effect-crash.ts` | `de7340f80d212086cfadad13c193498746ae1467` | 764 |
| `tests/helpers/candidate-effect-racer.ts` | `2c9de26b67bfa7c5b5e105a6c9d7a0fa1cbf5fa5` | 1136 |
| `docs/handoff/ONOES_AGENT_DISPATCH_LEDGER_DECISIONS.md` | `d4e176e23765575b249949b695ec91006f6bca7c` | 10410 |
| `package-lock.json` | `e7226a428c03ab0f2ffe412cd735a09a9c1ff080` | 18577 |
| `tsconfig.json` | `0e4f41fae7583e14588a57b04bbacf9f87ed9b1e` | 638 |
| `tsconfig.test.json` | `7c0f33a1a2c8a677ed9e7fea74be04849b787c2a` | 154 |

**Important qualifier:** computing `git hash-object` over a packet copy and finding it equal to the recorded OID proves the recorded OID is the correct OID *of these bytes*. It does **not** prove these bytes are what the publisher's repository holds at `76dc12a9474d…`. `SOURCE_IDENTITIES.sourceRevisionEvidence` states this honestly as `publisher-local-git-not-independent-bundle`. Source-revision provenance remains unverified by me.

**Receipt comparison:** `FOCUSED_TESTS.tap` is internally consistent — 18 subtests, all `ok`, `1..18`, `# pass 18 # fail 0 # cancelled 0 # skipped 0 # todo 0`, `# duration_ms 1185.3941` — and its 18 test names correspond one-to-one with the 18 tests generated by the suite source (12 single tests plus 3 from the `seam` loop plus 2 from the `same` loop, plus the publication test = 18; the loop-generated names match the template literals at lines 188 and 283 exactly). Its hash matches `PRODUCER_EVIDENCE.json` and the manifest. It does **not** match the decision document — see B-04. `widerFullRun` TAP is declared not included (`rawTapIncluded: false`); its 1,788/1,786/2-skip figures are consistent between `PRODUCER_EVIDENCE.json` and decision doc lines 137–139 and are unverifiable here.

**Dependency comparison:** `DEPENDENCIES.json` import edges match the actual `import` statements in all seven TypeScript members; the two `new URL(...)` worker/child edges are correctly recorded as `dynamicFileEdges`. Pins for `better-sqlite3@12.11.1`, `zod@4.4.3`, `typescript@5.9.3`, `@types/better-sqlite3@7.6.13`, `@types/node@24.13.3` match `package-lock.json` (lockfileVersion 3, `onoes-agent@1.1.0`, 46 packages) on version and integrity string. `tarballVerified: false` and `packageSupplied: false` are honest — no tarball was fetched or verified, by me or by the producer.

**Scope check:** no member outside the packet was analysed for findings. The sibling packet `onoes-agent-model-recovery-http-48c7c0e7415f-static-v1` and the repository-root instruction files were listed but are not part of this review; I read the root `EXTERNAL_AUDIT_AGENT_INSTRUCTIONS.md` header only to confirm the packet layout requirement, and it contributes no finding.

**Test command/result:** **NOT RUN by reviewer.** No compilation, no `node --test`, no SQLite instantiation, no dependency installation. All 18 producer results are `AUTHOR_REPORTED_LOCAL_EXECUTION_NOT_INDEPENDENT`, as the receipt itself declares.

**Probe command/result:** only the five bounded offline operations listed in §3. Every proposed control in §5–§6 is **NOT RUN**.

**Unexpected output or failure:** none mechanical. The one unexpected *content* result is B-04.

### 7.1 Answers to the twelve scoped questions

**1. Can one approval ID fund multiple operations/workflows/phases within a single pinned namespace/store?**
No, within one store. `effectApprovalIdentity` digests canonical `{domain, namespaceId, approvalId}` only — kind, phase, workflow and operation are deliberately excluded (state.ts lines 82–84) — so any reuse of `approvalId` within the namespace collides. Enforcement is doubled: `approval_identity_digest TEXT UNIQUE` (ledger line 18) and the reservation-time scan at line 157. `execute` and `publish` collide with each other, which test 2 exercises in both directions. **Distinguished from the deferred gap:** a malicious host that creates a second store or a second enrollment defeats this entirely, and S1 does not attempt to prevent it — correctly out of scope. **What S1 additionally fails to prevent, and should:** record relocation between two stores of the same namespace, because records carry no store binding (B-01). Future acceptance rules must prohibit both, and B-01 is the cheaper half to fix now.

**2. Is one execution approval used for transfer plus launch without a second consumption? Does publication require a fresh approval, exact subject, same workflow and completed/passed parent? Can missing/stale/substituted parent data be accepted?**
Yes to the first: one `reserve()` consumes the approval, and `source-delivery-possible` and `launch-possible` are subsequent events on the same record requiring no further approval (state.ts lines 104–105). Publication requires a fresh approval by construction (the digest uniqueness forces a different `approvalId`) and a fresh `operationId`; `UNIQUE(workflow_id, kind)` (line 22) permits exactly one execute and one publish per workflow. `verifiedParent` (lines 65–73) requires the parent to exist, to be `kind === "execute"`, to be in state `completed`, to carry a `result-and-stop-observed` event with `verificationPassed === true`, to have `observation.resultDigest === intent.resultDigest`, and to match on all twelve subject fields including `workflowId`, `guestGeneration` and `controllerIdentityDigest`. A bare result digest is insufficient — test 3 walks nine substituted fields plus `guestGeneration` and a failed parent. **Missing** parent: rejected. **Substituted** parent data: rejected. **Stale** parent: **accepted** — there is no maximum age between parent completion and publication reservation (N-08), and the parent's own success may itself have been recorded long after expiry (N-01). Note also that `verifiedParent` is re-run for every publish record on every scan (line 106), so a parent that later becomes invalid poisons discovery of the whole store rather than just that row (N-04).

**3. Are possible-effect markers ordered and absorbing? Can a repeated marker, lost reservation/marker/terminal response, new connection or operation ID become permission to repeat an effect? Which future host rules are still needed?**
Ordered: strictly. `checkTransition` (lines 92–111) admits exactly one linear chain per kind; test 5 confirms every skip is denied. Absorbing: `terminal()` (line 91) includes `quarantined`, so no transition leaves a terminal state; test 4 confirms across a cold reopen. **Repeated marker:** `advance()` matches an existing event by state (line 172) and returns `replayed` only if `evidenceDigest`, `resultDigest` and `verificationPassed` all match, otherwise `intent-conflict`. So a repeat is never a second event and never a second permission. **Lost response:** the write is latched (`#writePoisoned`), and a fresh connection recovers by exact read returning `replayed` — tests 9–12. **New connection:** sufficient for discovery, not for execution — the envelope is literally `kind: "recorded-state-not-effect-permission"` and `disposition: "replayed"`. **New operation ID:** blocked while the workspace is blocked; *not* blocked once the prior operation reaches a non-quarantine terminal state (N-09). **Host rules still needed to stop a stale controller invoking a port after a marker:** (a) physical ownership fencing and old-owner termination, which the decision document lists as prerequisites (line 92) and which S1 cannot supply — `controllerIdentityDigest` is recorded data compared against nothing live; (b) a rule that consumers branch on the record's *state*, never on `disposition` (N-05); (c) a rule that write-uncertainty must not be cleared by re-instantiating the ledger (N-02); (d) an outcome-freshness budget (N-01).

**4. Does every unknown/quarantined outcome keep workspace exclusion across reopen? Can partial SQL-column drift or a rehashed illegal history clear it? What corruption does unkeyed hashing not detect?**
Yes. `candidateEffectBlocked` excludes `quarantined` from the releasing set (state.ts line 89) while `terminal()` includes it, so quarantine is simultaneously absorbing and permanently blocking — the intended asymmetry, and test 4 confirms it survives a close/reopen. The partial unique index is keyed on `blocked = 1`, not on non-terminal state, matching decision doc line 68. **Column drift:** cannot clear it — `scan()` recomputes `Number(candidateEffectBlocked(record))` and compares to the stored column (line 103), so drift denies the whole store rather than releasing the lock; test 13 confirms. **Rehashed illegal history:** cannot clear it — the digest matches but `validateCandidateEffectRecord` replays the graph from empty and rejects an illegal chain; test 13 confirms. **Unkeyed hashing does not detect:** a coherent forged history, whole-file rollback, row deletion, or cross-store relocation. Full enumeration in B-03.

**5. Are completed/failed/restored/cancelled transitions internally coherent? Where is an external protected observation still necessary?**
Coherent. `completed` versus `failed` is forced by the *recorded* `verificationPassed` of the immediately preceding observation (line 107), so the terminal cannot contradict the observation; test 5 confirms. `restored` is reachable only from `publication-possible` (line 109), so an execution can never be restored. `cancelled` is reachable only from `reserved` (line 100) and deliberately precedes the expiry gate, so cancellation after expiry is permitted; test 8 confirms. `quarantined` is reachable from any non-terminal state and also precedes the expiry gate (line 99). The `observing` XOR at lines 96–98 forces `resultDigest` and `verificationPassed` to be non-null exactly at `result-and-stop-observed` and null everywhere else. **Where external observation remains necessary:** everywhere that matters. The store validates sequencing and binding only; it has no way to know whether the guest actually stopped, whether the result bytes correspond to that run, or whether the controller that reported them still held custody. A valid `evidenceDigest` is a well-formed 71-byte string, nothing more — it is not proof the observation occurred, and the decision document says so (lines 81–82, 105). Protected guest-manager observation with distinct manager and task identities, and host-observed shutdown evidence, remain prerequisites.

**6. Are transaction locks acquired before scan/uniqueness decisions? Are writes short and synchronous with no user callback inside? Does post-COMMIT read-back loss latch and preserve discovery? Is a new trusted connection sufficient for discovery but insufficient for execution?**
Locks: yes. Every write runs `db.transaction(...).immediate()` (line 140), which the supplied `better-sqlite3` context confirms issues `BEGIN IMMEDIATE` (transaction.js lines 16, 44, 52–63), so the write lock is held before `scan()` and before the uniqueness decisions at lines 157–159. Reads use `.deferred()` (line 110), correctly. Initialization re-checks emptiness *inside* the immediate transaction (line 54) as well as outside (line 51), closing the TOCTOU. **No user callback inside:** confirmed. The host clock is sampled at line 131, outside the transaction — the suite asserts this from inside the injected clock (test fixture line 30). The `operation` callback is an internal closure. Caller data is copied and isolated before the transaction by `effectParse`'s JSON round-trip. Nothing in the transaction body performs I/O beyond SQLite. **Read-back loss:** latches — `touched` plus `#writePoisoned` (lines 138, 145) — and preserves rather than compensates: there is no rollback, no delete, no compensating write anywhere in the module, so the committed record stands and a later exact repeat returns `replayed`; tests 9–12 exercise this at three seams with a fault the harness proves fires exactly once after a real COMMIT. **New connection:** sufficient for discovery, insufficient for execution, subject to the caveats in N-02 and N-05.

**7. Do expiry and time ordering fail closed for forward markers while permitting stop/failure bookkeeping after expiry? Are clock/replay/recovery semantics documented accurately?**
Forward markers fail closed — `source-delivery-possible`, `launch-possible` and `publication-possible` are denied at or after `expiresAt` (lines 101–102), and `reserve()` denies at line 161. Bookkeeping after expiry is permitted, and cancellation and quarantine bypass the gate entirely by returning early. Time ordering is monotonic per record (line 95, equality allowed) and store-wide at write time (ledger line 136). `effectTime` demands exact `YYYY-MM-DDTHH:MM:SS.sssZ` with a round-trip check (state.ts lines 13–14), and `reservedAt >= expiresAt` is rejected at line 116. **Two accuracy gaps in the documentation:** the framing "permitting stop/failure bookkeeping after expiry" understates what is permitted — successful observation and `completed` are equally unbounded (N-01); and the store-wide monotonicity check's availability consequence under a forward clock excursion is undocumented (N-03). The clock is entirely host-supplied with no monotonic source and no external anchor, which the decision document does not state explicitly.

**8. Can proxies, getters, exotic or repeated-reference inputs run code before rejection, mutate a stored record, or evade canonical byte binding?**
No, on all three, and this is the strongest part of the implementation. `assertPassive` (state.ts lines 46–69) runs before `canonicalJson` and tests `types.isProxy(item)` at line 55 *before* `Object.getPrototypeOf` at line 57 — the ordering the comment claims, and it is correct, since a `getPrototypeOf` trap would otherwise fire first. Accessors are rejected via `!("value" in descriptor)` (line 64) before any property read. Symbol keys, exotic prototypes (anything but `Object.prototype`, `null`, `Array.prototype`), repeated references and cycles are all rejected, with node, depth, key-count and byte budgets. Nested proxies are caught because `visit` recurses through `descriptor.value`; test 6 asserts `traps === 0` for both a top-level proxy and one nested under `extra`, and `getter === false` for a throwing getter. **Later parsing:** `effectParse` then canonicalises, re-checks the byte cap, `JSON.parse`s a *fresh* object from the wire string — so the parsed value shares no memory with the caller — runs the `.strict()` schema, and re-canonicalises the parsed result comparing it byte-for-byte against the wire (line 78). That last step is what closes the loop: any zod coercion, default, strip or reorder would change the bytes and fail. Test 2 confirms an appended `keyId` is rejected; test 6 confirms post-`reserve()` caller mutation does not reach the stored record. `canonicalJson` independently re-checks prototypes, array shape including holes, enumerability, symbol keys and unpaired surrogates. I found no evasion.

**9. Schema/read-back, TEMP/ATTACH/pragma handling, SQL parameterization, caps and ceilings, indexed duplicate fields, missing uniqueness.**
`schema()` (line 28–33) compares the canonical JSON of `main.sqlite_schema` against the frozen DDL text byte-for-byte, denies any `temp.sqlite_schema` object, and denies any attached database other than `main`/`temp`. Durability pragmas are re-verified on every read and write. **SQL parameterization: every value is bound via `?`; there is no string interpolation anywhere in the module.** Caps: `LIMIT 1001` with a `> 1000` denial (lines 91–92); `record_json` bounded at the SQL layer (`BETWEEN 2 AND 32768`), again in `scan()`'s `CASE typeof(record_json)='text' AND length(...)<=32768` (line 90), and again in `save()` (line 117); events capped at 6; `substr()` limits of 37 and 72 are each exactly one byte longer than a legitimate UUID or digest, which bounds driver allocation while still guaranteeing an over-long corrupted value fails the subsequent equality check — a neat detail worth preserving. Indexed duplicate fields are re-derived per row from the parsed record (lines 100–103). **Missing uniqueness / invariants not independently checked:** the three cross-row invariants — see B-02, which is the direct answer to this question. Secondarily, `schema()` cannot see the implicit indexes that back `UNIQUE` constraints because it filters `sql IS NOT NULL`, so index-level damage that leaves the table's CREATE text intact is invisible to it.

**10. Do the fault-injection tests fire after real COMMIT? Do the worker connections and the abrupt child exit genuinely exercise SQLite? Vacuous assertions, nondeterminism, missing negative controls?**
**After COMMIT: genuinely, yes.** `loseCommitResponse` (lines 173–187) wraps `db.transaction` so the returned `immediate` calls the real `immediate` — which BEGINs, runs the body and COMMITs — then asserts `db.inTransaction === false`, increments `fired`, and only then throws. The restore function asserts `fired === 1`. Both halves matter: the `inTransaction` assertion proves the transaction had ended, and the `fired` count proves the fault was neither skipped nor multiplied. The wrapper deliberately leaves `deferred` as the real function, so the recovery read path is unfaulted — correct. This seam is well built, and the decision document's account of the earlier 13/16 harness failure (lines 153–157) is a credible and creditable disclosure. **Worker connections: genuine** — two real `Worker` threads, each with its own `new Database(path)` against a real on-disk temp file, no shared connection. **Abrupt child exit: genuine** — a real separate process via `spawnSync`, real COMMIT, `process.exit(23)` with no close, parent asserting exit status and empty stderr as a negative control, then recovery on a fresh connection. It is process-exit evidence, not power loss, and the receipt says exactly that. **Vacuous assertions and nondeterminism:** the race test is the weak one — its assertions pass under fully serialized execution, so it cannot distinguish contention from sequencing, and the 250 ms busy timeout makes it flaky toward false failure (N-12). **Missing negative controls:** eight, enumerated in N-13; the two that matter most are the absence of any coherent-forgery control and any cross-row duplicate control.

**11. Are data-only, non-authorizing and deployment limitations honest?**
Substantially yes, with one correction. The non-authorizing framing is carried in the code itself, not just the prose: the write envelope's `kind` is the literal string `"recorded-state-not-effect-permission"`, module headers state that neither parsed intents nor recorded observations constitute approval or permission to invoke a port, and `PRODUCER_EVIDENCE.json` classifies its own results as `AUTHOR_REPORTED_LOCAL_EXECUTION_NOT_INDEPENDENT` with five candid limitations including "process exit is not power-loss" and "observations are trusted-host claims". `GITHUB_PACKET_PROVENANCE.json` records `independentReviewReceived: false` and `publicHistoryPersists: true`. The request itself warns against endorsing S1 merely because an earlier model suggested it. **Recorded as operational gates, not invisible production promises:** (a) the **1,000-operation lifetime limit** with no pruning, delete, refund or reset — exhaustion is a permanent hard stop requiring a new store, and that store-replacement procedure does not exist; (b) the **absent retention and anti-rollback mechanism** — same-disk snapshot rollback is undetected, and protected archival with continued global spent-ID retention must be designed before install or long-lived activation. To these I add (c) the clock-forward permanence trap (N-03) and (d) whole-store denial on single-row damage with no forensic path (N-04). **The correction:** B-04 — the focused receipt is not the run the decision document certifies.

**12. Is this S1 contract safe to retain for dormant continuation? What must be fixed before composing a consumer?**
Safe to retain, yes. Nothing in scope executes, installs, calls a provider, opens a port, touches a filesystem beyond SQLite, or performs any effect; there is no consumer, barrel, signer, adapter or VM port, and `DEPENDENCIES.json` confirms the import closure is limited to Node builtins, `zod`, `better-sqlite3` and four local modules. Dormant retention of these exact bytes, with this report attached, is supported. **Before composing a consumer, in order:** fix B-01 and B-02 in source while the store is empty; reconcile B-04; add the three missing negative controls from N-13; decide and document N-01, N-05, N-08 and N-09 as explicit consumer-contract rules. **Passing S1 clears none of:** protected Windows control-plane experiment, complete legacy consumer inventory, protected namespace/store/enrollment identity, old-owner fencing, complete source transport, original publication adapter and approval gate, production retention and restore rules, and release stages W1–W5.

## 8. Security and Integrity Review

**Secrets:** none present. No credential, token, key, connection string, private path or account identifier appears in any member. All identifiers in tests are synthetic UUIDs and padded digests. The only real-world paths are `tmpdir()`-derived at runtime. `PRODUCER_EVIDENCE.json` and the decision document reference a publisher-local `.audit-preparation/` directory by name only.

**Injection and control content:** SQL injection is not reachable — every value is parameterized, and the only dynamic SQL is `db.exec(item.sql)` over three frozen constants during initialization. Prototype-pollution and accessor-trap vectors are closed by `assertPassive` before any reflection. No `eval`, no `Function`, no dynamic `require`, no template-built SQL. The three DDL strings are compared byte-for-byte against `sqlite_schema` on every operation, so schema substitution is detected. `trusted_schema=OFF` is asserted, closing the function-in-index vector.

**Authorization:** by design, none. The module authorizes nothing; it records data and labels its own return value as not-a-permission. Approval *identity* uniqueness is enforced, but there is no signature, no issuer, no capability and no verifier — correct for S1 and stated repeatedly. The consequence a future consumer must internalise: this store can tell you an approval ID has been consumed within this store; it cannot tell you the approval was ever legitimately issued.

**Isolation:** caller data is fully isolated by the canonical-JSON round-trip; returned records are deep-frozen. Runtime encapsulation of the ledger object itself is weak (N-07), but the host owns the object, so this is defence-in-depth rather than a boundary.

**Mutation:** append-only in practice — no `DELETE`, no `DROP` outside tests, no pruning, no compensating write. `save()` updates only `blocked`, `record_json` and `record_digest`, and the record's event array only ever grows.

**Concurrency:** `BEGIN IMMEDIATE` before every uniqueness decision, WAL with `synchronous=FULL`, `busy_timeout=250`, uniqueness enforced at both the SQL and application layers. Verified by reading the supplied `better-sqlite3` transaction implementation rather than assuming it. The 250 ms timeout is short for a contended store (N-06, N-12). **Untested:** true overlapping-lock behaviour (N-12) and all non-Windows filesystem semantics.

**Provenance:** internally consistent and externally unverified. Packet-internal hashes all check out; the link to the publisher's product revision rests on publisher-local Git and is explicitly labelled as such. The claim that this packet's eleven blobs are byte-identical to the predecessor `…-static-v1` packet is **unverifiable here** — that packet is not present in this repository at this commit or in its history, so `originalManifestSha256` `5eccf491…` has nothing to compare against.

**Replay:** exact-repeat replay is well constructed — bound by operation identity plus full canonical intent equality for `reserve`, and by state plus all three evidence fields for `advance`. Replay returns recorded state, never a fresh permission. The residual risk is consumer misreading (N-05), not store behaviour.

**Rollback:** **untested and undetected.** No anti-rollback mechanism exists. Whole-file restoration from a same-disk snapshot returns the store to an earlier consistent state with every invariant satisfied. This is the single largest integrity gap for activation, and it is acknowledged.

**Fail-closed behaviour:** consistently and, in places, aggressively closed — a single bad row denies the entire store, drifted pragmas deny, a nested transaction denies, a temp object denies, an attached database denies, a backwards clock denies store-wide. The direction is right throughout. The cost is availability with no repair path (N-03, N-04), which should be recorded as an operational property rather than discovered in production.

## 9. Limitations and Missing Evidence

1. **No execution of any kind.** Compilation, the 18 focused tests, both helpers, and every proposed control in this report are **NOT RUN**. No SQLite database was created; no dependency was installed. Source inspection is not a successful probe, and nothing in §5–§8 should be read as a reproduced result except the hashing and byte-arithmetic explicitly attributed in §7.
2. **Platform.** Review was performed on Linux from a public clone. The subject targets Windows x64 with Node v24.14.0 and native ABI 137. Nothing platform-specific was exercised or could be.
3. **Source-revision provenance unverified.** I cannot confirm the packet bytes equal the publisher's Git blobs at `76dc12a9474d…`; only internal consistency was checked (§7 qualifier).
4. **Predecessor packet unavailable.** The byte-identity claim against `…-static-v1` could not be tested — that packet is absent from this repository.
5. **Wider full run unverifiable.** `widerFullRun` ships no raw TAP (`rawTapIncluded: false`); its 1,788/1,786/2-skip figures and hash `6e70f4ec…` are producer claims only. The excluded product tests were neither supplied nor audited.
6. **Dependency tarballs unverified.** `better-sqlite3`, `zod` and `typescript` were not fetched; integrity strings were compared between two supplied documents, which proves only their mutual agreement. The `better-sqlite3` context files are publisher-installed copies, not product Git blobs, and I could not confirm they match an authentic 12.11.1 distribution.
7. **Races, crashes and power loss.** No concurrency, crash-consistency or durability behaviour was independently reproduced. Producer evidence is process-exit, not power-cut; no protected installation, real VM, real approval or authentic invocation evidence exists anywhere in the packet.
8. **No measurement.** All timing figures are producer-reported.
9. **Single-reviewer, single-pass, not independent of prior project context.** See §2. A second reviewer with no prior exposure to the Onoes-Agent project would strengthen the record, particularly on B-01 and B-02.
10. **`zod` semantics assumed.** The correctness of `.strict()`, `z.discriminatedUnion` and `.max(6)` is assumed from the pinned version, not verified against its source, which was not supplied. The canonical round-trip at state.ts line 78 substantially reduces reliance on this assumption.

## 10. Required Next Action

Minimal ordered list.

1. **Correct B-04.** Reconcile the focused-run hash and duration between the decision document, `PRODUCER_EVIDENCE.json` and `FOCUSED_TESTS.tap`. Publish the correction as a new member; do not rewrite existing manifest members or hashes.
2. **Fix B-01 in source** while the store is empty and dormant: add `storeId` to the intent schema and assert it in `scan()`. This is a schema-version change and is far cheaper now than after any record exists.
3. **Fix B-02 in source:** re-derive the three cross-row uniqueness invariants at the end of `scan()`, failing `state-invalid`.
4. **Add the three missing negative controls** from N-13: the coherent-forgery boundary control, the cross-row duplicate control, and a successful publication → `restored` case.
5. **Re-audit** the amended modules and their tests as a new packet at a new revision — `ADVANCEMENT` cannot be reconsidered on this revision, whose bytes are now fixed.
6. **Decide and document, as explicit consumer-contract rules,** N-01 (outcome freshness), N-05 (branch on record state, never on `disposition`), N-08 (parent age) and N-09 (once-at-a-time, not once-ever). Record N-02, N-03, N-04 and the 1,000-operation quota as operational gates.
7. **Then, and only then,** begin consumer design — starting with the complete legacy consumer inventory, protected namespace/store/enrollment identity and old-owner fencing, all of which remain untouched by this audit.

**Intentionally excluded and still excluded:** B-03's protected storage and keyed or anchored integrity; anti-rollback and retention design; the Windows control-plane experiment; complete source transport; the original-publication adapter and approval gate; the VM, native controller, signer and every consumer. None of these is deferred by oversight; each is a named gate.

## 11. Explicit Non-Claims

This report does **not** certify, and must not be cited as certifying:

- **Formal acceptance.** `ADVANCEMENT: NO`. B-01 and B-02 are open source defects.
- **Production readiness**, installation readiness, or readiness for long-lived activation.
- **Live-model, live-VM or live-approval readiness.** No provider, VM, signer, enrollment, port or consumer was reviewed, because none exists in scope.
- **Public-release readiness.** W1–W5 remain open.
- **That any test passes.** Every test result herein is producer-reported. Nothing was executed by me.
- **That the packet bytes match the publisher's product at `76dc12a9474d…`,** or that they are byte-identical to the predecessor `…-static-v1` packet. Neither was verifiable.
- **That the store resists an actor with write access to its file.** It does not, and does not claim to — see B-03.
- **That absence of a finding implies absence of a defect.** This is one reviewer's single static pass over 12 KB and 8 KB of dense TypeScript plus a 20 KB suite, with no execution.
- **Anything about the wider or current product,** the newer working product, excluded features, or the sibling packet in this repository.

---

```
MODEL_ID: Claude Opus 5 (Anthropic); exact build string not exposed to the reviewer
ROUTE: operator-mediated GitHub static review; public HTTPS fetch plus read-only public clone; no provider or model calls originating from the repository
AUDITED_REVISION: packet commit 2130d72cc3db2304395c964071e11414469e631b; declared product revision 76dc12a9474d626efcf1944c86f4ffd131bfef2f (unverified)
IMPLEMENTATION_VERDICT: PASS_WITH_FINDINGS
SECURITY_VERDICT: NEEDS_REVIEW
EVIDENCE_VERDICT: PARTIAL
BLOCKING_FINDINGS: 4 — B-01 no store binding in records (blocker, new, source defect); B-02 cross-row uniqueness invariants never independently re-derived (blocker, new, source defect); B-03 unkeyed digest, no anti-rollback anchor (high, previously documented, deferred host mechanism); B-04 supplied focused TAP is not the run the decision document records as final (high, new, evidence defect)
NONBLOCKING_FINDINGS: 13 — N-01 expiry does not bound observation or terminal events (medium); N-02 poison and pragma normalization cleared by re-instantiation (medium); N-03 forward clock excursion permanently denies all writes (medium); N-04 one corrupt row denies the whole store with no repair path (medium); N-05 reserve() replay succeeds silently on quarantined operations (medium); N-06 touched latched before save (low); N-07 integrity read-back uses overridable public read() (low); N-08 publication parent freshness unbounded (low); N-09 terminal release permits workspace re-execution (low); N-10 two full scans per write (low); N-11 32 KiB ceiling unreachable, worst case 3,329 bytes (informational); N-12 race test assertions satisfied by serialized execution (medium, test evidence); N-13 eight missing negative controls and untested branches (medium, test evidence)
TEST_RESULTS: NOT RUN by reviewer. No compilation, no node --test, no SQLite instantiation, no dependency installation, and no proposed control executed. Producer-reported focused run 18/18 pass, 0 fail, 0 skipped, 0 cancelled, 1185.3941 ms, TAP sha256 119918dea2ae0fc98c45f8dd153f1b80d067f88360a59d2a7fcb96b7d64c0f35 — classified AUTHOR_REPORTED_LOCAL_EXECUTION_NOT_INDEPENDENT, and inconsistent with the decision document per B-04. Producer-reported wider run 1,788/1,786/2 skipped is unverifiable; its raw TAP is not included.
SCOPE_RESULT: PASS. All 21 packet files read in full; no member left unread; no analysis widened beyond the packet. MANIFEST.sha256 verified 21/21; all 11 SOURCE_IDENTITIES members matched on sha256, Git blob OID and byte length; manifest coverage complete. No mutation, no branch, commit, push, workflow, runner, build, install, download, deployment or provider call. No secrets requested or exposed. No write to GitHub.
PLATFORM_LIMITATIONS: Review from Linux against a Windows x64 / Node v24.14.0 / ABI 137 subject. No execution, compilation, SQLite instantiation, concurrency, crash, power-loss or timing evidence reproduced. Source revision provenance rests on publisher-local Git. Predecessor static-v1 packet absent, so the byte-identity claim is untestable. Wider full-run TAP not supplied. Dependency tarballs not fetched or verified. zod semantics assumed from the pinned version.
ADVANCEMENT: NO
NEXT_REQUIRED_ACTION: Reconcile the focused-run receipt (B-04), then fix B-01 and B-02 in source while the store is empty, add the three missing negative controls from N-13, and re-audit as a new packet at a new revision. Do not compose any consumer against this revision.
```

*This report is a new output returned to the operator in chat. It is not an original manifest member. It was not written to GitHub.*
