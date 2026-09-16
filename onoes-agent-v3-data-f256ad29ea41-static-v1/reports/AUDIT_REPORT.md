# Audit Report — Onoes-Agent v3 data-only record, inventory and checkpoint-history implementation / onoes-agent-v3-data-f256ad29ea41-static-v1

## 1. Executive Summary

This is a STATIC_SOURCE review of the three new v3 data modules (`windows-candidate-v3-data.ts`, `windows-candidate-v3-record.ts`, `windows-candidate-v3-inventory.ts`), their three test files, the synthetic fixture and the exact supplied dependency closure at publisher product revision `f256ad29ea4176cdc60244db20fd3742769e1f0a`, reviewed from the operator's LOCAL, UNPUBLISHED packet directory (packet `DELIVERY.json` records `published: false`; no immutable packet commit exists to cite). Packet integrity is complete against the local bytes: all 33 `MANIFEST.sha256` members verify; all 15 `SOURCE_IDENTITIES` members verify by SHA-256, byte length and Git blob OID; every one of the 11 changed/new members is reproduced byte-for-byte by applying `SOURCE_DELTA.patch` to the supplied baseline blob; all 15 blob OIDs match `git ls-tree` at `f256ad29` in the publisher's local clone (same workstation — not independent); the two TAP receipts hash exactly as the producer states and contain all 47 test titles found in the source. The modules implement what CONTRACT_V3 §1–§2 and the N-01..N-04 decisions describe: primitive-text-only parsing with pre-parse byte caps, strict private schemas, canonical-wire round-trip equality, deep-frozen results, a full replay of every execute/publish event path with absorbing quarantine and a release that binds the outcome, the exact predecessor digest, the SAME settlement-evidence digest and checkpoint A; settlement joined to every shared intent field without circular hashing; index-free cross-row uniqueness and workspace-blocking checks; an adjacent A→B pair model explicitly labeled adjacent; and a complete retained-history replay that recomputes every root and rejects workspace-lifetime overlap and substituted A claims. No blocking defect was found inside the data-only scope. Findings are nonblocking: specific missing negative tests (most importantly, no history-level publication-parentage test at all), an unmeasured worst-case replay cost, aggregate 64-MiB caps that exceed the largest legitimate payload, loose event/checkpoint ceilings, duplicated domain literals, one ambiguous baseline line, and evidence limitations (no hash-first acknowledgment, producer-only execution, non-independent Git membership). Advancement is YES for the next scoped persistence DESIGN review only; it is NO for any real store, admission, provider, VM, installer or activation, which remain blocked by the unchanged B-01/B-03 and W1–W5 items.

## 2. Audit Identity

- Audit ID: `onoes-agent-v3-data-f256ad29ea41-static-v1`
- Project: Onoes-Agent v3 data-only record, inventory and checkpoint-history implementation
- Auditor/model: `claude-opus-5` (Claude Opus 5), operator-mediated via Claude Code (Claude desktop app, Code tab) on the operator's Windows workstation. Prior involvement disclosure: the prior DESIGN report at Audits `b86e08b793bfffd5a47a68c85a3bf99b18a1b017` was, per `PRIOR_DESIGN_REVIEW.md` §11 and the producer disposition, also authored by `claude-opus-5` via Claude Code. This session has no memory of that session, but it is the same model and tool family; this report is therefore NOT an independent second opinion. This reviewer had no part in writing the audited source.
- Route/provider: operator-mediated; local read of the unpublished packet directory; no API/provider call was made from the repository or packet; no GitHub write was attempted (see §7, report delivery).
- Audit type: STATIC_SOURCE implementation, security, integrity and regression (data-only scope)
- Date/time UTC: review performed 2026-09-15 approximately 03:05–03:45 UTC (packet preparation dated 2026-09-15; audited commit authored 2026-09-14T21:16:02−05:00 = 2026-09-15T02:16:02Z)
- Audited revision: publisher product `f256ad29ea4176cdc60244db20fd3742769e1f0a` ("Validate v3 complete inventories and retained checkpoint histories"). Design baseline `49cd0792e5e7f48fff1798baebaa24e170ac5371`. Immutable packet commit: NONE — packet not published.

## 3. Scope and Method

- In scope: the packet only — `source/src/build-only/windows-candidate-v3-data.ts` (5,778 B), `windows-candidate-v3-record.ts` (11,143 B), `windows-candidate-v3-inventory.ts` (12,459 B); `tests/tests/unit/windows-candidate-v3-{data,record,inventory}.test.ts`; `tests/tests/helpers/candidate-v3-record-fixture.ts`; dependency closure `src/compatibility/canonical-json.ts`, `src/validation/deep-freeze.ts`, `src/build-only/windows-candidate-effect-state.ts`; handoff docs CONTRACT_V2/V3, V3 record/inventory implementation notes, data review disposition; receipts (`SOURCE_IDENTITIES`, `SOURCE_DELTA.json/.patch`, `DEPENDENCIES`, `PRODUCER_EVIDENCE`, `CURRENT_CONTEXT`, `SANITIZATION`, `DELIVERY`, `PRIOR_REVIEW_IDENTITY`, `PRIOR_DESIGN_REVIEW.md`, baseline CONTRACT_V3 blob, two TAPs).
- Exclusions (as requested, honored): wider product, SQLite store, native controller, VM, OS, protected anchor/storage, enrollment, issuer, credentials, real approval/effects, runtime/UI/HTTP consumers, providers, installer, activation. `docs/handoff/ONOES_AGENT_WINDOWS_RELEASE_GOAL.md` also changed in `f256ad29` but is not a packet member; it was not reviewed. Commits after `f256ad29` (four exist on the publisher's local branch, including one titled as a "bounded complete v3 history replay measurement") are outside scope and are NOT used as evidence here.
- Files inspected: fully read — all three v3 modules, all three test files, the fixture, `canonical-json.ts`, `deep-freeze.ts`, `windows-candidate-effect-state.ts`, `AUDIT_REQUEST.md`, `HANDOFF.md`, `SCOPE.md`, `REPORT_DELIVERY.md`, `reports/README.md`, `MANIFEST.sha256`, all JSON receipts, `CURRENT_CONTEXT.md`, `ONOES_AGENT_V3_RECORD_IMPLEMENTATION.md`, `ONOES_AGENT_V3_INVENTORY_IMPLEMENTATION.md`, `ONOES_AGENT_V3_DATA_REVIEW_DISPOSITION.md`, `CURRENT_FOCUSED.tap`. Partially read (targeted sections) — `ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V3.md` (§1 incl. F-01/F-02, §2 F-03/F-04, §5, plus the full baseline→current diff), `PRIOR_DESIGN_REVIEW.md` (§1, §4, §5, §6 N-01, §10, §11), `CURRENT_FULL.tap` (summary lines, skip lines, `ok`/`not ok` lines and test-title extraction only), `SOURCE_DELTA.patch` (file list and CONTRACT_V3 hunk; applied in full mechanically). Not read — `ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V2.md` (identity verified only).
- Commands/probes run (all read-only, offline, bounded byte arithmetic; no subject code executed): `sha256sum`/`wc -c` on `MANIFEST.sha256`; `sha256sum -c MANIFEST.sha256` (33/33 OK); Python SHA-256 / byte-length / `sha1("blob <len>\0"+bytes)` over the 15 identity members, the baseline blob, the prior report and both TAPs; `git ls-tree <commit> <path>` and `git log` in the publisher's local clone (read-only); `git apply` of `SOURCE_DELTA.patch` onto the baseline blob in a scratch directory with `core.autocrlf=false`, followed by SHA-256 comparison of all 11 reproduced members; `grep`-based TAP summary/title extraction and set comparison against source test titles; local documentation/code indexing of the packet for navigation. Subject tests, typecheck and compilation: NOT RUN.
- Cost/mutation controls: no GitHub Actions, no hosted runners, no provider/model calls from the packet, no builds, installs, downloads, branches, PRs, force-pushes, deletions or source/receipt/manifest edits. The only write is this report file, added under the packet's `reports/` directory at the operator's explicit in-chat instruction (see §7).

## 4. Verdict

```
IMPLEMENTATION_VERDICT: PASS_WITH_FINDINGS
SECURITY_VERDICT: NEEDS_REVIEW
EVIDENCE_VERDICT: PARTIAL
ADVANCEMENT: YES — for the next scoped persistence DESIGN review only. NO — for a real store, admission, provider, VM, installer or activation.
```

`SECURITY_VERDICT: NEEDS_REVIEW` reflects the stated trust boundary, not a defect: the parsers' own input hardening passes static review, but by construction nothing in scope authenticates storage completeness, anchor freshness, ownership fencing or evidence authenticity (B-01/B-03 open). Those remain separate reviews.

## 5. Blocking Findings

No new blocker was observed inside the data-only scope. The following previously documented blocker is carried forward unchanged because it gates the verdicts above:

- ID: B-01 (carries forward B-03 / prior F-04)
- Severity: blocker — for REAL_ADMISSION and ACTIVATION only; explicitly NOT a blocker for this data-only implementation or for the next persistence DESIGN review.
- File/symbol/line: `ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V3.md` §2 (F-03/F-04, "The anchor's backend, anti-rollback root, authentication keys, old-owner physical fencing and provisioning still do not exist in this packet"); `windows-candidate-v3-inventory.ts:8–9, 66–68, 109–111` (module comments stating the same boundary); `ONOES_AGENT_V3_DATA_REVIEW_DISPOSITION.md` findings table row "B-01 / physical B-03".
- Observed fact: no authenticated anchor, protected storage, enrollment authority, issuer custody, owner-epoch CAS or physical fencing exists in the packet. Every return kind in the new modules is suffixed `-not-admission`; no availability predicate is exported.
- Why it matters: a coherently forged inventory + checkpoint stream (or a coherently deleted history with a recomputed checkpoint) parses successfully; only the excluded protected composition can convert these data claims into admission.
- Reproduction/probe: static — `windows-candidate-v3-inventory.test.ts:119–123` ("coherent omitted history plus a recomputed checkpoint remains a claim") and `windows-candidate-v3-record.test.ts:71–74` (rehashed role-evidence digest still parses) pin this boundary as expected behavior. NOT RUN by this reviewer.
- Required correction: none within this scope; resolve with independently reviewed physical evidence before any admission or activation claim.
- Status: previously documented.

## 6. Nonblocking Findings

- ID: N-01
- Severity: medium
- File/symbol/line: `windows-candidate-v3-inventory.ts:139–145` (`parseCandidateV3CheckpointHistory`, index-0 publish parent check) vs. `windows-candidate-v3-inventory.test.ts:172–213` (all history tests use execute rows only).
- Observed fact: no test — positive or negative — exercises a `publish` row through the complete-history replay. Line 143 (`!parent || parent.state !== "released"`) is reachable only when a publication's reservation checkpoint appears in the stream before its parent's release checkpoint with EQUAL timestamps (unequal timestamps are already denied by the inventory-level `reservedAt < release.recordedAt` check at line 54 and by the stream monotonic check at line 137). That exact interleaving is untested. Because `parentFields` (line 18–20) forces the child to share the parent's `workspaceDigest`, line 140 (`blocked.has(...)`) also denies this case, so lines 141–144 are partly redundant with the workspace blocker — but that redundancy is itself unpinned.
- Why it matters: Q9 of the request asks specifically for "publication reservation before parent release checkpoint" to be checked; the code has the check, but the 47 tests do not falsify it. A future refactor that changes the workspace model (e.g., allowing publication in a different workspace) would silently rely on lines 141–144 with no test.
- Reproduction/probe: static reading; test-title inventory shows no history test constructing a `publish` fixture. NOT RUN.
- Required correction: add (a) a positive history test with an execute parent released then a publish reserved and released, with an unrelated interleaved row between A and B; (b) a negative test with `pub.record.reservedAt === parent release.recordedAt` and stream order `[…, pub index 0, parent release]`; (c) a negative with the publish reservation preceding the parent's outcome checkpoint. This is the smallest correction before persistence DESIGN depends on the history checker.
- Status: new.

- ID: N-02
- Severity: medium
- File/symbol/line: `windows-candidate-v3-record.ts:118`; `windows-candidate-v3-record.ts:90`; `windows-candidate-v3-inventory.ts:45–48`; `windows-candidate-v3-inventory.ts:39, 51`; `windows-candidate-v3-inventory.ts:137`.
- Observed fact: additional untested negative branches: (1) `record.ts:118` — settlement and/or checkpoint-A wire supplied for a record with no outcome must fail; the record test helper `parse()` (`record.test.ts:9–11`) always passes `null` for pre-outcome cuts, so this branch is never hit. (2) `record.ts:90` — `reservedAt >= expiresAt` is never constructed (tests only move event times to/after `expiresAt`). (3) Inventory workspace blocking by a `quarantined` or non-released terminal row (`inventory.ts:45–48`) is untested; only reserved-vs-reserved collisions are tested (`inventory.test.ts:48–53`). (4) Publication whose parent sorts AFTER it by operation UUID (`byId` is prebuilt at line 39, so the code handles it) is untested — every test orders the parent first. (5) The history stream monotonic-time denial (`inventory.ts:137`, `at < lastAt`) has no dedicated negative; the reordered-checkpoint case at `inventory.test.ts:180–181` fails on sequence before time is compared.
- Why it matters: these are exactly the fail-closed edges the request names (explicit-null/absent context, expiry edges, terminal/quarantined blockers, adjacency vs. general history). Coverage is by construction, not by falsification.
- Reproduction/probe: static reading of tests vs. branches. NOT RUN.
- Required correction: add one negative test per branch above (five small tests). No source change is required.
- Status: new.

- ID: N-03
- Severity: medium
- File/symbol/line: `windows-candidate-v3-inventory.ts:129–159` (per-checkpoint recomputation: `[...entries.values()].sort(...)` at 153 and `canonicalSha256Digest(core)` at 154, plus prefix digest at 137); `PRODUCER_EVIDENCE.json` "limits"; `ONOES_AGENT_V3_INVENTORY_IMPLEMENTATION.md` "Limits and non-claims".
- Observed fact: complete-history replay re-sorts and re-hashes the entire tuple inventory once per checkpoint. At the schema maximum (1,000 rows, up to 7,001 checkpoints) that is O(C·N): roughly 7,001 × (sort of ≤1,000 entries + canonical encoding of ≈1,000 tuples ≈ 230 KB + SHA-256) plus 7,001 prefix digests of ≤32 KiB records — on the order of 1.5–2 GB of canonical bytes hashed synchronously on the event loop (static estimate; the reachable maximum is 6,001 checkpoints since no valid path has 6 events). The producer states the 1,000-row tests are representative snapshots, not worst-case measurements; this reviewer confirms none of the 47 tests measures a full-history worst case. All work is bounded and terminating; this is a cost, not a correctness, finding.
- Why it matters: CONTRACT_V3 §5 requires synchronous hashing/validation to be reserved against a measured deadline; a persistence design cannot size that reservation from this packet.
- Reproduction/probe: static complexity reading. NOT RUN. (A later publisher commit is titled as a history-replay measurement; it is outside this packet and was not examined.)
- Required correction: before a persistence design depends on `parseCandidateV3CheckpointHistory`, either supply a measured worst-case (1,000 rows × 6 events, max-size records) receipt or restructure to incremental root maintenance (e.g., hash only changed tuples with a bounded per-step cost) and document the chosen budget.
- Status: new (producer-acknowledged limitation).

- ID: N-04
- Severity: low
- File/symbol/line: `windows-candidate-v3-inventory.ts:11, 27–29, 115–116` (`CANDIDATE_V3_MAX_INVENTORY_BYTES = 64 MiB` applied to both transports); `:29` and `:117` (`JSON.parse` of the full wire before shape checks); `:36` and `:124` (`canonicalJson(input)` re-encode).
- Observed fact: the largest CONFORMING inventory transport is ≈46 MB (1,000 × (≤32,768 + ≤8,192 + ≤4,096 bytes of nested wire, plus JSON escaping overhead)) and the largest conforming history is ≈29 MB (7,001 × ≤4,096); the 64 MiB cap therefore admits 18–38 MB that can only be non-conforming bytes which `JSON.parse` must fully materialize before `transport.parse`/strict rejection. Peak memory is roughly 3× wire (input string + parsed object + canonical re-encode string). The pre-zod row-count check (`:32–34`, `:118–120`) does bound schema error collection as claimed.
- Why it matters: bounded and fail-closed, so not a defect; but the persistence design should not treat 64 MiB as a measured heap ceiling or an HTTP body size (the producer's note already says so).
- Reproduction/probe: arithmetic from the constants. NOT RUN.
- Required correction (optional): derive the aggregate caps from the row caps, or record the ≈3× peak-memory multiplier in the persistence design inputs.
- Status: new.

- ID: N-05
- Severity: low
- File/symbol/line: `windows-candidate-v3-record.ts:36` (`events: z.array(eventSchema).max(6)`), `:40` (`eventIndex ... max(6)`); `windows-candidate-v3-inventory.ts:120, 122` (`7 * CANDIDATE_V3_MAX_OPERATIONS + 1`).
- Observed fact: the longest valid path is 5 explicit events (delivery, launch, observed, outcome, release); a 6th event is always denied by transition replay (`record.ts:94, 105–112`) and `record.test.ts:25, 105` pins 6-after-release and 7 events. The schema ceilings (6 events, `eventIndex ≤ 6`, 7,001 checkpoints) are therefore loose by one event per record. CONTRACT_V3 §1 explicitly asks to keep the six-event ceiling, so this is consistent with the contract.
- Why it matters: harmless slack; noted so the persistence design does not size storage from the schema ceiling instead of the reachable maximum (6,001 checkpoints).
- Reproduction/probe: static path enumeration. NOT RUN.
- Required correction: none required; optionally add a test asserting no 6-event history is accepted for any kind/outcome.
- Status: new.

- ID: N-06
- Severity: low
- File/symbol/line: `windows-candidate-v3-record.ts:69` and `windows-candidate-v3-inventory.ts:59` (inline `"agent-candidate-inventory-root/v1"`); `inventory.ts:12` (`"agent-candidate-inventory-transport/v1"`), `:121` (`"agent-candidate-checkpoint-history/v1"`); fixture `:60`, `inventory.test.ts:23`.
- Observed fact: the inventory-root domain literal is duplicated across two modules and the tests rather than exported once; transport/history domains are inline literals.
- Why it matters: a future edit to one copy would make genesis validation (`record.ts:66–71`) and root recomputation (`inventory.ts:59–62`) disagree silently; tests would also need to be updated in lockstep and could mask the drift.
- Reproduction/probe: grep. NOT RUN.
- Required correction: export the three domain constants from one module and import them in the other module and the fixture.
- Status: new.

- ID: N-07
- Severity: low
- File/symbol/line: `windows-candidate-v3-record.ts:66–71` (genesis rules) — `producerGeneration` is not constrained at sequence 0.
- Observed fact: a genesis checkpoint validates with any well-formed `producerGeneration`; two genesis claims differing only in that field are both valid for the same store. The chain (`previousCheckpointDigest`) binds a history to one genesis, so this does not weaken chain validation.
- Why it matters: the persistence design must define what the genesis producer generation means (enrollment-time owner?) and whether the anchor pins it; the data layer currently leaves it free.
- Reproduction/probe: static. NOT RUN.
- Required correction: decide and document in the persistence design; optionally pin in a later schema revision.
- Status: new.

- ID: N-08
- Severity: low
- File/symbol/line: `ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V3.md` header line "Current inventory implementation baseline: 0420349cf66ef16e6bc1b0e84de388938995509b"; `ONOES_AGENT_V3_RECORD_IMPLEMENTATION.md` "Raw receipts" (TAP hashes `8c0042…`, `4d1483…`).
- Observed fact: `0420349c` is the record-implementation commit, i.e. the baseline the inventory work built ON, not the commit that contains the inventory implementation (`f256ad29`). The wording is ambiguous. The record note cites two TAP receipts that are not packet members (labeled historical by `CURRENT_CONTEXT.md`); they cannot be verified here.
- Why it matters: minor chronology clarity; no evidence claim depends on it.
- Reproduction/probe: `git log 49cd0792..f256ad29` in the publisher's local clone shows `075ab17` (data) → `0420349` (record) → `f256ad2` (inventory). NOT independent.
- Required correction: reword to "inventory implementation baseline (pre-inventory): 0420349c; implemented at f256ad29" in the next doc edit.
- Status: new.

- ID: N-09
- Severity: low (design/diagnostics)
- File/symbol/line: `windows-candidate-v3-data.ts:38–41` (single fixed `CandidateV3DataError`, no reason); all `fail()` sites.
- Observed fact: every denial collapses to one message with no reason code (deliberately, to avoid echoing input). A consumer cannot distinguish oversize, wire drift, cross-row conflict or history mismatch.
- Why it matters: fail-closed uniformity is correct for a parser; a persistence/reconciliation design will need a bounded, input-free reason taxonomy (as v2's `CandidateEffectReason` provides) to act on denials without logging input.
- Reproduction/probe: static. NOT RUN.
- Required correction: none now; decide in the persistence design.
- Status: new.

## 7. Verification Results

- Test command/result: NOT RUN by this reviewer (STATIC_SOURCE). Producer receipts: `CURRENT_FOCUSED.tap` — 47 tests / 47 pass / 0 fail / 0 skip / 1,210.0111 ms; `CURRENT_FULL.tap` — 1,979 / 1,977 pass / 0 fail / 2 skips / 49,212.4926 ms (skips: "Windows link creation privilege unavailable"; unsupported-host inspector case skipped on Windows). Both are `AUTHOR_REPORTED_LOCAL_EXECUTION_NOT_INDEPENDENT`.
- Probe command/result: (1) all 47 focused TAP titles equal the 47 titles derivable from the three test sources (27 static titles + 12 settlement-matrix + 8 history-cut template titles); all 47 also appear in the full TAP; 0 `not ok` lines in either TAP. (2) `SOURCE_DELTA.patch` applied cleanly to the supplied baseline blob and reproduced all 11 changed/new members byte-for-byte (an initial mismatch was traced to the scratch repository's `core.autocrlf=true` and disappeared with CRLF conversion disabled; the packet files and patch are LF-only). (3) Dependency closure in `DEPENDENCIES.json` matches every `import` statement in the packet sources; externals are `zod` and Node builtins only; all relative targets are supplied.
- Hash/manifest comparison: `MANIFEST.sha256` — 3,500 bytes, SHA-256 `dd4be3ae5bdc7304dd76796a00b906810ac9283ed3aab0e7254b2583edb4123c` (reviewer-computed AFTER the fact; NOT an operator-supplied hash-first acknowledgment — see §9). `sha256sum -c`: 33/33 OK; the only unlisted file is the manifest itself. `SOURCE_IDENTITIES.json`: 15/15 members match SHA-256, byteLength and Git blob OID. Baseline CONTRACT_V3 blob: SHA-256 `856c8653…ffdde1`, 23,049 B, OID `b0cfdfb1…6ed4` — matches `SOURCE_DELTA.json` and `git ls-tree 49cd0792`. Prior report: 44,733 B, SHA-256 `ac20989a…82a2`, OID `339e7b2c…389f` — matches `PRIOR_REVIEW_IDENTITY.json`.
- Receipt comparison: TAP SHA-256s match `PRODUCER_EVIDENCE.json` and `ONOES_AGENT_V3_INVENTORY_IMPLEMENTATION.md` (`8afc426d…502c`, `b20f8a8e…6039`). The data-module SHA-256 in `ONOES_AGENT_V3_DATA_REVIEW_DISPOSITION.md` (`2beda5cf…0760`) equals the packet's `windows-candidate-v3-data.ts` — the data module is unchanged since commit `075ab17`. Dependency helpers `canonical-json.ts`, `deep-freeze.ts`, `windows-candidate-effect-state.ts` have identical SHA-256/OID to the design baseline (`SOURCE_DELTA.json` status `unchanged`), so no v2 authority or wire bytes were altered. Commit membership: all 15 OIDs match `git ls-tree f256ad29` in the publisher's local clone on the same workstation — NOT independent proof.
- Scope check: scope honored. Observed but not reviewed: `docs/handoff/ONOES_AGENT_WINDOWS_RELEASE_GOAL.md` changed in the same commit and is not a member; four later commits exist on the publisher's branch and were not examined.
- Report delivery: `REPORT_DELIVERY.md`/`AUDIT_REQUEST.md` name `eOnoes/Audits` `main` `onoes-agent-v3-data-f256ad29ea41-static-v1/reports/AUDIT_REPORT.md`. The operator instructed in chat, mid-review, to place the report back in the local packet directory for the producer agent to pick up. Accordingly this report was written ONLY to the local, unpublished packet's `reports/AUDIT_REPORT.md`. No GitHub write, workflow inspection, commit or push was attempted; no claim of GitHub delivery is made; no immutable link or output commit exists yet. The publisher may deliver it after sanitization and the workflow check per `REPORT_DELIVERY.md`.
- Unexpected output or failure: none, other than the CRLF artifact described above (reviewer-side, resolved).

## 8. Security and Integrity Review

- Secrets: none present in the packet; `SANITIZATION.json` scan result accepted as producer evidence, not proof. Nothing sensitive is echoed by the modules (single fixed error, no input in messages).
- Injection/control content: parsers accept `string` only (`data.ts:46`, `record.ts:49`, `inventory.ts:27, 115`); non-strings (objects, Proxies, Buffers, `String` wrappers, functions) fail before any reflection; tests assert zero trap invocations (`data.test.ts:101–114`, `record.test.ts:117–120`, `inventory.test.ts:115–116`). `JSON.parse` output is passive; `__proto__` becomes an own key rejected by `.strict()`. Canonical round-trip (`canonicalJson(value) !== wire`) rejects BOM, whitespace, duplicate keys, alternate escaping, key order, `1e3`, `-0` and omitted nulls (nullable ≠ optional in zod). Nested depth is bounded by the byte caps; a stack-depth `RangeError` from `JSON.parse` is caught and converted to denial.
- Authorization: none is granted; every result kind is `…-not-admission`; no `available`/`canReserve` export (asserted at `record.test.ts:23`, `inventory.test.ts:43`). `authorizationDigest` in the v3 intent is descriptive only.
- Isolation: results are deep-frozen; schemas are module-private; no I/O, clock, callbacks or storage.
- Mutation: none; v2 modules byte-identical to baseline.
- Concurrency: not applicable to pure parsers; the synchronous cost (N-03) is the relevant consequence for a future serialized store.
- Provenance: intent digest, approval identity (v1 domain preserved, `data.ts:10`, `record.ts:89`, tested against the live v2 helper at `data.test.ts:38–51`), predecessor digest, settlement digest, checkpoint self-digest and previous-checkpoint chain are all recomputed, not trusted. Checkpoint A is bound to the exact outcome-containing prefix (`record.ts:136`) and to the release event (`record.ts:139`) and must equal the stream's historical checkpoint (`inventory.ts:157`).
- Replay: full event replay per record (`record.ts:92–116`); complete stream replay with exact sequence, previous digest, per-row event progression, monotonic time and per-step root recomputation (`inventory.ts:129–161`).
- Rollback/deletion/substitution: detected when the retained checkpoint stream or a supplied A disagrees (omitted row, extra row, reordered/missing genesis, changed root, substituted A — all tested at `inventory.test.ts:172–191`). NOT detected when an attacker rewrites records AND every checkpoint coherently (`inventory.test.ts:119–123`); the modules say so honestly and export no completeness/freshness claim. Unkeyed hashing authenticates nothing; anchor freshness, owner CAS, fencing and role evidence are absent by scope.
- Fail-closed behavior: every branch denies with the same error; no partial results are returned.
- Untested by this reviewer: everything above is static; no probe was executed.

## 9. Limitations and Missing Evidence

- Hash-first delivery incomplete: no operator-supplied expected `MANIFEST.sha256` size/SHA-256 was received or acknowledged before source review in this handoff. The manifest hash in §7 is reviewer-computed afterward and must not be read as a hash-first acknowledgment. (Same limitation as prior N-10.)
- Packet unpublished: reviewed from the operator's local directory; there is no immutable packet commit or URL to pin; "publisher commit membership" was checked only against the publisher's local Git on the same machine.
- Not independent: same model and tool family as the prior design reviewer; the packet, the publisher clone and this session share one workstation.
- No execution: subject tests, typecheck and compilation NOT RUN; the two TAPs are producer artifacts; the TAPs do not embed source hashes, so their binding to these exact bytes rests on the producer's `sourceBinding` statement.
- No environment: no `package.json`, lockfile, `zod` version or `tsconfig` supplied; zod behaviors relied upon (nullable ≠ optional, strict unknown-key rejection, output key materialization) were reasoned from the code, not verified against a pinned version.
- Worst-case cost unmeasured (N-03); no heap ceiling, preemption or production settlement budget is evidenced.
- Platform: reasoning assumes V8/Node semantics for `JSON.parse`, `Buffer.byteLength` and string ordering of fixed-format ISO timestamps; not exercised on any host.
- Out of scope and unexamined: later publisher commits; `ONOES_AGENT_WINDOWS_RELEASE_GOAL.md`; CONTRACT_V2 body; the broader 1,932 tests named in the full TAP.

## 10. Required Next Action

1. Add the missing negative tests: history-level publication parentage (N-01, three cases) and the five branch negatives in N-02. No source change is required for either.
2. Export the domain constants once (N-06) and reword the CONTRACT_V3 baseline line (N-08) in the same small docs/tests commit.
3. Supply or reference a measured worst-case full-history replay receipt (1,000 rows × 6 events × max-size records) or an incremental-root redesign decision (N-03), and record the ≈3× peak-memory multiplier / cap derivation (N-04) as inputs to the persistence design.
4. Re-audit only that delta as a narrow changed-boundary static review, citing this report and `f256ad29ea41`; then proceed to the scoped persistence DESIGN review, which must decide genesis producer semantics (N-07) and the denial-reason taxonomy (N-09).
5. Publish this packet (or its successor) to `eOnoes/Audits` with hash-first acknowledgment before the next external review, and deliver this report there under the packet's `reports/` path after the workflow-activation check.
6. Intentionally excluded and still open: B-01/B-03 physical anchor, protected storage, anti-rollback, fencing, enrollment and spent-approval commitment, issuer custody, real approvals/effects, VM, installer, activation, W1–W5.

## 11. Explicit Non-Claims

This report does NOT certify: formal acceptance of the product or of CONTRACT_V3; production readiness; live-model or provider readiness; public-release or installer readiness; real admission; activation; enrollment; physical anchor freshness, anti-rollback or fencing; protected storage or custody; issuer, approval or consent handling; that any supplied inventory or checkpoint history is complete or authentic; VM, OS or transport behavior; that the producer's tests pass on any machine other than the producer's; that this review is an independent second opinion; or GitHub delivery of this report. A YES on persistence-design readiness authorizes a DESIGN review only — no store, admission path, provider, VM, installer or activation.

---

## Focused implementation questions — answers with source evidence

1. **Primitive wire, caps, strict schemas, canonical equality, freezing.** Yes. `data.ts:46`/`record.ts:49` check `typeof === "string"`, UTF-16 length and UTF-8 bytes against the cap BEFORE `JSON.parse`; `inventory.ts:27–34, 115–120` cap at 64 MiB and check the array length before zod traverses it. All schemas are `.strict()`; `canonicalJson(value) !== wire` rejects any alternate spelling; results are `deepFreeze`d. No caller object is reflected on (tests assert zero Proxy trap hits). Nested allocation is bounded by the caps (see N-04 for the loose aggregate cap); schema error collection is bounded by input size and the pre-check.
2. **Identity join and v2 authority.** Metadata `{domain v3, installationId, namespaceId, storeId}` is parsed independently for every call and compared field-by-field with the intent (`record.ts:87`) and checkpoint (`record.ts:63`). Intent immutability is bound by `intentDigest` (`record.ts:88`). Approval identity uses the unchanged v1 domain over `{namespaceId, approvalId}` (`data.ts:10, 63–66`; `record.ts:89`) and is tested equal to the live v2 `effectApprovalIdentity` including across store IDs (`data.test.ts:46–47`). No v2 file changed (identical OIDs); v3 imports only `effectTime`/`effectUuid`; v2 records (`schemaVersion …/v2`) are rejected by the v3 literal.
3. **Path replay.** `record.ts:105–111`: execute reserved→{delivery, cancelled}; delivery→{launch, stopped-without-result}; launch→{observed, stopped-without-result}; observed→completed iff `verificationPassed`, else failed. Publish reserved→{publication-possible, cancelled}; publication-possible→{completed, restored}. `quarantined` is allowed from any non-terminal state and is absorbing (`:94, :99`); `released` requires the previous state to be an outcome, `outcome === previous`, `predecessorRecordDigest === digest(prefix before release)`, non-null `outcomeCheckpointDigest`, and `evidenceDigest === outcome event's` (`:100–103`). Nothing releases early (release after quarantine denied; release without outcome denied) and no result is hidden by the parser: result fields must be present exactly on `result-and-stop-observed` (`:95–97`) and are re-joined to the settlement core (`:129–130`). Six-event ceiling: `.max(6)` at `:36`, with 5 reachable (N-05). All non-applicable fields must be explicit `null` (nullable, not optional; canonical round-trip enforces presence).
4. **Settlement binding.** `record.ts:122–124` joins 14 shared fields including `kind` (N-01 decision); `:126` binds `intentDigest`, `priorOutcomeRecordDigest === digest(prefix BEFORE the outcome event)`, `outcome === event.state`, `observedAt >= preceding event time (or reservedAt)`, and `digest(core) === outcome event evidenceDigest`; `:132` enforces `observedAt <= outcomeRecordedAt < validUntil` and `outcomeRecordedAt <= releaseRecordedAt < validUntil` via `parseCandidateSettlementTimeline` (`data.ts:90–92`). No circular hash: the core excludes the event that carries its digest and excludes A/B. Equality edges are permitted; equality with `validUntil` denies (`data.ts:72, 90–92`; tested at `data.test.ts:118–129`, `record.test.ts:123–132`).
5. **A and release; which API for which claim.** A must name `operationId`, `producerGeneration === intent.ownerGeneration`, `eventIndex === outcomeIndex + 1`, `recordDigest === digest(prefix through the outcome)` and the approval identity (`record.ts:135–137`); the release event must carry `outcomeCheckpointDigest === A.checkpointDigest` (`:139`) and the SAME `evidenceDigest` as the outcome (`:102`). API mapping: `parseCandidateV3Record` = one record's history + settlement + A shape/relations (no root/chain); `parseCandidateV3CheckpointSnapshot` = one checkpoint vs. one complete supplied inventory (root, count, sequence, subject, latest-by-time), no chain; `parseCandidateV3ReleasePair` = strictly adjacent A→B with a single appended release and no other change (`inventory.ts:84–107`); `parseCandidateV3CheckpointHistory` = complete retained stream with genesis, chain, per-step roots, workspace lifetimes, publication ordering and A-equals-history (`:112–165`). Only the last supports general-history claims. No consumer exists.
6. **Inventory uniqueness without SQL.** `inventory.ts:43–48`: strictly ascending `operationId` (duplicates and disorder deny), `Set` on approval identity, `Set` on `workflowId/kind`, `Set` on `workspaceDigest` for every row whose last state is not `released` (so reserved, in-flight, outcome-without-release, quarantined and cancelled rows all block). Root = SHA-256 over the canonical tuple inventory `{domain, ids, operationCount, entries[{operationId,eventIndex,recordDigest,approvalIdentityDigest,state}]}` (`:56–62`), ≤1,000 entries, order enforced ascending and re-sorted identically in history (`:153`). Bounded: ≈6,000 canonical nodes, far under `CANONICAL_JSON_MAX_NODES`.
7. **Publication parentage.** `inventory.ts:50–54`: parent must exist in the same inventory, be `execute`, have last event `released` with `outcome === "completed"`, settlement `verificationPassed === true` and `resultDigest === intent.resultDigest`, all 14 `parentFields` equal, and `reservedAt >= release.recordedAt`; approval reuse is denied by the approval `Set`. History adds stream-order parent-released-first (`:141–144`, untested — N-01). This is historical parentage only; actual consent and authenticated result evidence are absent by scope and the modules say so.
8. **Global sequence and roots.** Inventory `sequence = Σ(events.length + 1)` (`:49`); snapshot requires `checkpoint.sequence === sequence` and root/count equality (`:71–72`); history requires exactly `sequence + 1` checkpoints (`:124`), genesis at 0 with null subject fields and the exact empty root (`record.ts:66–71`), `cp.sequence === index`, `previousCheckpointDigest === previous.checkpointDigest`, per-row `eventIndex` progression 0,1,2…, prefix digest per step, monotonic time, per-step root and count (`inventory.ts:131–154`), then final size/root/recordDigest agreement (`:160–161`). Omitted row → `rows.get` fails or final count mismatch; extra row → count/root mismatch; relocated record → metadata pin mismatch; substituted A → `:157`. Tested at `inventory.test.ts:172–191` except as noted in N-01/N-02.
9. **Workspace overlap and interleavings.** Inventory alone cannot see historical overlap when both rows end `released` (asserted `inventory.test.ts:203`); history denies it via the `blocked` map (`:139–149`, tested `:193–205`). Intervening operations between A and B are supported and tested (`:172–179`). Adjacent-pair validation is labeled "restricted adjacent" in code (`:84–85`) and "deliberately … an adjacent model, not the only permissible interleaving" in the implementation note; no document or code in scope uses it as a general-history claim.
10. **Still-accepted coherent forgery.** Any attacker who rewrites both the records and every checkpoint (or deletes rows and regenerates the stream from genesis) produces a valid claim; likewise a stale-but-coherent snapshot. Nothing in scope checks storage completeness, freshness, physical fencing, owner CAS or role evidence. Return kinds (`parsed-…-not-admission`, `matched-…-not-admission`) and the absence of any availability API are honest about that boundary; `inventory.test.ts:119–123` pins it.
11. **Cost surfaces.** 64 MiB aggregate caps, 1,000 rows, 7,001 checkpoints (reachable 6,001), tuple-only root hashing; repeated per-step root re-hash in history is O(C·N) (N-03); aggregate cap exceeds the largest conforming payload and peak memory ≈3× wire (N-04); all error paths deny uniformly. The 1,000-row tests are representative snapshots only.
12. **Are the 47 tests falsifiable and bound to current source?** The 47 titles in `CURRENT_FOCUSED.tap` equal the titles derivable from the packet's test sources and all appear in the full TAP; the fixture builds claims by recomputing digests (`rebind`/`rehashCheckpoint`) rather than by calling the parser, and each negative test mutates one commitment and expects denial — so they are falsifiable against the current source. Binding to these exact bytes is by the producer's statement only; execution is producer-reported (1,979/1,977/0/2), not independent. Missing negative tests: N-01 (history-level publication parentage, three cases) and N-02 (settlement-before-outcome, `reservedAt >= expiresAt`, quarantined/terminal workspace blocker, child-before-parent UUID order, history time monotonicity). Smallest correction before persistence DESIGN can depend on these contracts: add those eight tests (no source change). No implementation of a real store, admission, provider, VM, installer or activation is authorized by this report.

```text
DATA_CONTRACT_VERDICT: PASS_WITH_FINDINGS
PERSISTENCE_DESIGN_READY: YES (design only, not storage implementation; conditioned on the eight missing negative tests and a worst-case replay measurement or incremental-root decision as design inputs)
REAL_ADMISSION_READY: NO
ACTIVATION_READY: NO
REPORT_DELIVERY: NOT VERIFIED_GITHUB — delivered only to the local unpublished packet's reports/AUDIT_REPORT.md at the operator's in-chat instruction; no GitHub write attempted; target path when published: eOnoes/Audits main onoes-agent-v3-data-f256ad29ea41-static-v1/reports/AUDIT_REPORT.md
```

```text
MODEL_ID: claude-opus-5
ROUTE: operator-mediated static review via Claude Code (Claude desktop app) on the operator's Windows workstation; local unpublished packet directory; read-only use of the publisher's local Git clone on the same machine for blob membership; no provider call from the repository; offline hashing, patch application and byte arithmetic only
AUDITED_REVISION: publisher product f256ad29ea4176cdc60244db20fd3742769e1f0a (design baseline 49cd0792e5e7f48fff1798baebaa24e170ac5371); packet commit: none (unpublished)
IMPLEMENTATION_VERDICT: PASS_WITH_FINDINGS
SECURITY_VERDICT: NEEDS_REVIEW
EVIDENCE_VERDICT: PARTIAL
BLOCKING_FINDINGS: 0 new; 1 carried forward (B-01/B-03 — blocks REAL_ADMISSION and ACTIVATION only)
NONBLOCKING_FINDINGS: 9 (N-01 history publication-parentage untested; N-02 five untested negative branches; N-03 worst-case replay cost unmeasured; N-04 aggregate cap above max conforming payload / ~3x peak memory; N-05 loose event/checkpoint ceilings; N-06 duplicated domain literals; N-07 unbound genesis producerGeneration; N-08 ambiguous baseline line and non-member TAP citations; N-09 no denial-reason taxonomy)
TEST_RESULTS: NOT RUN by reviewer; producer TAPs 47/47 focused and 1979/1977/0 fail/2 skips full, hashes verified, titles match source
SCOPE_RESULT: honored; one non-member doc changed in the same commit and four later commits observed but not reviewed
PLATFORM_LIMITATIONS: no execution; no lockfile/zod version; same-machine non-independent Git; no hash-first acknowledgment; packet unpublished; worst-case cost and heap unmeasured
ADVANCEMENT: YES (next scoped persistence DESIGN review only) / NO (store, admission, provider, VM, installer, activation)
NEXT_REQUIRED_ACTION: add the eight missing negative tests (N-01, N-02) and export the shared domain constants (N-06) in one small delta; supply a worst-case history-replay measurement or an incremental-root decision (N-03) and the cap/memory derivation (N-04) as persistence-design inputs; re-audit that delta as a narrow changed-boundary review, then proceed to the scoped persistence DESIGN review; publish the packet with hash-first acknowledgment and deliver this report to eOnoes/Audits after the workflow check
```
