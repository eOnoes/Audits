# Audit Report — Onoes-Agent candidate effect ledger v2 remediation / onoes-agent-effect-ledger-v2-0d31bf742307-static-v1

## 1. Executive Summary

This is a STATIC_SOURCE review of the pinned v2 remediation packet. Every packet
member was recomputed byte-exactly: all 30 `MANIFEST.sha256` entries verify, and
all 15 `SOURCE_IDENTITIES` members match on `byteLength`, `sha256` and Git blob
OID. The two prior source blockers are corrected in the current bytes. B-01 is
closed: `intent.storeId` is a mandatory schema field, participates in the intent
and record digests, and is checked against the pinned store identity on every
scan, so a verbatim cross-store transplant now denies on every access path.
B-02 is closed: `#scan()` re-derives operation, approval-identity,
workflow/kind and blocked-workspace uniqueness across rows, independently of SQL
indexes, and the new driver-seam tests are genuinely falsifying for all four.
N-07 and N-12 are addressed by ECMAScript private fields with a private
read-back path, and by a new held-lock test that forces observed `SQLITE_BUSY`
while the parent demonstrably still owns `BEGIN IMMEDIATE`. B-04 is resolved as
an evidence-labelling defect, not a mismatched result: two historical runs of an
identical 18-test set are shipped intact with distinct durations and hashes, and
neither was rewritten. **Advancement to consumer activation remains blocked.**
B-03 is not merely open, it is now explicitly pinned as accepted: a coherent
in-store forgery with recomputed digests is accepted by design, so store binding
and unkeyed hashing must not be described as anti-rollback or authentication.
Residual defects are documentation and evidence hygiene, not source behaviour.
No subject test or helper was executed. The full-suite summary is unverifiable
from the packet by declared scope. Report delivery to GitHub is blocked: this
reviewer has public read-only access only.

## 2. Audit Identity

- **Audit ID:** `onoes-agent-effect-ledger-v2-0d31bf742307-static-v1`
- **Project:** Onoes-Agent candidate effect ledger v2 remediation
- **Auditor/model:** Claude Opus 5, as presented to this session by the operator's
  client. The prior report claims the same model name; this session cannot verify
  that it is the same run, and per the request the prior report was treated as
  external evidence, not task authority. **Prior involvement disclosed:** this
  reviewer holds general prior context on the Onoes-Agent project and its
  STATIC_SOURCE courier protocol from earlier operator conversations. It did not
  author the v2 changes, has no access to the publisher workspace, and inspected
  only the public repository contents named below.
- **Route/provider:** operator-supplied immutable GitHub URL; ordinary public
  read-only clone of `eOnoes/Audits`. No provider or model call was made from the
  repository; no credentials were used, requested or present.
- **Audit type:** STATIC_SOURCE security, implementation, data contract and regression
- **Date/time UTC:** 2026-09-13T21:58:23Z (reviewer environment clock)
- **Audited revision:** publisher source `0d31bf74230759482575340968f2340bb23d393e`;
  packet commit `2f6a42dec9fcddac975a312409e80d6f305ed72b`; declared baseline
  `76dc12a9474d626efcf1944c86f4ffd131bfef2f`

## 3. Scope and Method

- **In scope:** packet directory
  `onoes-agent-effect-ledger-v2-0d31bf742307-static-v1/` only — current v2
  modules, focused tests and three helpers, the explicitly labelled baseline
  modules, supplied receipts, the v2 disposition, the prior report as evidence,
  and the report-output contract.
- **Exclusions:** wider product, VM, installer, protected storage, credentials,
  live approvals or providers, consumers, deployment, and any packet member's
  behaviour under execution.
- **Files inspected:** all 30 manifest members. Read in full:
  `AUDIT_REQUEST.md`, `SCOPE.md`, `MANIFEST.sha256`, `REPORT_DELIVERY.md`,
  `reports/README.md`, all seven `receipts/*.json` and `.tap` files,
  `receipts/PRIOR_AUDIT_REPORT.md` (findings and method sections),
  `source/src/build-only/windows-candidate-effect-{ledger,state}.ts`,
  `source/baseline/src/build-only/windows-candidate-effect-{ledger,state}.ts`,
  `source/src/compatibility/canonical-json.ts`,
  `source/src/validation/deep-freeze.ts`, both `tsconfig*.json`,
  `source/docs/handoff/ONOES_AGENT_EFFECT_LEDGER_V2_AUDIT_DISPOSITION.md`,
  `source/docs/handoff/ONOES_AGENT_DISPATCH_LEDGER_DECISIONS.md`,
  `tests/tests/unit/windows-candidate-effect-ledger.test.ts` and all three
  helpers. `source/package-lock.json` and `source/context/better-sqlite3/*` were
  hash-verified but not read line by line.
- **Commands/probes run:** `git clone` (public, read-only), `git checkout`,
  `git hash-object`, `git ls-tree`, `git rev-parse`, `git log`, `sha256sum`,
  `sha256sum -c`, `diff`, `comm`, `grep`, `sed`, `find`, `stat`, and one Python
  script that recomputed member digests, byte lengths and blob OIDs. All operate
  on packet bytes only.
- **Cost/mutation controls observed:** no build, install, download of
  dependencies, deployment or long-running job; no GitHub Actions or hosted
  runner (the repository contains no `.github/` directory at `2f6a42de` or on
  `main`); no branch, PR, merge, reset, deletion or file edit; no subject code
  executed; no secrets present or requested. The clone is a read-only copy in a
  scratch container.

## 4. Verdict

```
IMPLEMENTATION_VERDICT: PASS_WITH_FINDINGS
SECURITY_VERDICT: NEEDS_REVIEW
EVIDENCE_VERDICT: PARTIAL
ADVANCEMENT: NO
```

`ADVANCEMENT: NO` is scoped: it denies consumer activation and production use,
not the next design step. Nothing found here blocks a consumer-boundary review
of the changed record/scan/read-back boundary, which is the correct next
activity.

## 5. Blocking Findings

### B-03 — Unkeyed record digest and no anti-rollback anchor (carried, still OPEN)

- **ID:** B-03 (v1 identifier retained)
- **Severity:** blocker for activation; not a defect in the audited bytes
- **File/symbol/line:** `source/src/build-only/windows-candidate-effect-ledger.ts`
  lines 11–12 (trusted-host comment) and line 103 (`canonicalSha256Digest(record)
  !== row.record_digest`); `source/src/compatibility/canonical-json.ts` lines
  97–102; pinned by test `coherent in-store forgery is accepted: negative boundary
  control, not authenticated evidence` (test file lines 458–472).
- **Observed fact:** `record_digest` remains a plain SHA-256 over canonical bytes
  computed from data the same actor can rewrite. The new test constructs a legal
  reserved → source-delivery-possible → launch-possible →
  result-and-stop-observed(passed) → completed history entirely offline, writes it
  over a real row with recomputed `record_json` and `record_digest`, and asserts
  that a reopened store **reads it back as genuine** and then funds a `publish`
  reservation against it. The v2 store binding does not change this: the forgery
  is written into the store that already owns it, so `intent.storeId` matches.
- **Why it matters:** B-01's closure must not be read as an integrity
  improvement against a file-write adversary. Store binding defeats *verbatim*
  relocation only. An adversary who can rewrite the file can also rewrite
  `storeId` and recompute every digest — and because the spent-approval digest
  deliberately excludes `storeId`, a coherent rewrite preserves approval identity,
  which is exactly the field an attacker would want preserved. Whole-file rollback
  to an earlier self-consistent snapshot, and wholesale row deletion, likewise
  remain undetectable: there is no keyed MAC, no expected count, no high-water
  mark and no chained digest.
- **Reproduction/probe:** the packet's own negative control, listed above.
  **NOT RUN** by this reviewer under STATIC_SOURCE; verified by source reading
  only. Its presence, and the disposition's explicit language, are what this
  finding relies on.
- **Required correction:** none inside S1. Before activation: protected
  file/WAL/SHM custody that excludes the low-privilege task identity, plus a
  separately protected freshness/rollback anchor (keyed MAC bound to `storeId`
  plus an external monotonic counter or attested high-water mark), designed
  together with retention and archival rules. A MAC alone is insufficient — it
  cannot distinguish an older authentic snapshot from the current one.
- **Status:** previously documented; **still open**, correctly, and now pinned by
  a permanent negative control rather than left implicit.

## 6. Nonblocking Findings

### V2-N-01 — The retained simultaneous-start race test still cannot accept observed contention

- **Severity:** medium (test evidence) · **File:** test file lines 291–308 ·
  **Status:** previously documented (N-12, second half), not corrected
- **Observed fact:** the new held-lock test fully addresses N-12's first half.
  The retained start-barrier test was honestly renamed to "outcome consistency,
  not proof of contention", but its assertion is unchanged:
  `assert.deepEqual(results.sort(), same ? ["recorded","replayed"] :
  ["recorded","workspace-blocked"])`. With `busy_timeout = 250` ms, genuine
  overlap on a loaded machine yields `storage-unavailable` from one worker, which
  this multiset rejects.
- **Why it matters:** the latent flake is in the false-failure direction, so it
  cannot manufacture a passing claim — but it makes the suite load-sensitive, and
  a spurious red on CI is the kind of result that invites weakening an assertion
  later.
- **Required correction:** widen the accepted multiset to admit
  `storage-unavailable`, or raise `busy_timeout` on that test path only, and
  state which was chosen.

### V2-N-02 — The in-tree decision document is stale at the audited revision and carries no forward pointer

- **Severity:** medium (documentation integrity) · **File:**
  `source/docs/handoff/ONOES_AGENT_DISPATCH_LEDGER_DECISIONS.md` lines 4, 46,
  135–136 · **Status:** new (B-04 residue)
- **Observed fact:** the decision document is shipped at revision `0d31bf74` and
  still records the focused run as "Final focused: 18/18 pass … 926.2852 ms" with
  TAP SHA-256 `a7ecb823…`; still asserts unqualified "One approval ID is globally
  unique within the namespace"; still names baseline
  `ebc0059bf3f5663454959ffc13875e3e829531fc`. The corrections live only in
  `ONOES_AGENT_EFFECT_LEDGER_V2_AUDIT_DISPOSITION.md`, which declares the
  supersession. The superseded file contains no reference to the superseding one.
- **Why it matters:** the packet nominates the decision document as required
  reading. A reader who opens it alone re-derives B-04 from scratch and reads a
  namespace-uniqueness claim that only holds per-store under sole protected host
  enrollment. Preserving historical bytes is correct; leaving them unlabelled is
  the defect.
- **Required correction:** add a new, separately versioned successor or header
  note that names the superseding document and the two run roles. Do not rewrite
  the historical record.

### V2-N-03 — Receipt points at a filename that does not exist in this packet; one TAP has no receipt-level role

- **Severity:** low (evidence hygiene) · **File:**
  `receipts/HISTORICAL_PRODUCER_EVIDENCE.json` (`focused.rawTap`);
  `receipts/HISTORICAL_PRECOMMIT.tap` · **Status:** new
- **Observed fact:** `HISTORICAL_PRODUCER_EVIDENCE.focused.rawTap` is
  `receipts/FOCUSED_TESTS.tap`, which is absent from this packet. Its recorded
  `sha256` `119918de…` resolves unambiguously to `receipts/HISTORICAL_PINNED.tap`
  (recomputed, matches). Separately, `receipts/HISTORICAL_PRECOMMIT.tap`
  (`a7ecb823…`) is a manifest member whose role is stated only in the disposition
  Markdown table; no receipt JSON names it, its phase or its duration.
- **Why it matters:** the whole point of the B-04 remediation is that each run
  carries a machine-checkable role label. One of the two runs still does not.
- **Required correction:** in the next packet, give each historical TAP a receipt
  entry with `phase`, `durationMs`, `sha256` and its true packet path.

### V2-N-04 — Remaining negative controls

- **Severity:** medium (test evidence) · **Status:** new; supersedes N-13 items
  1–7 for the ones now covered
- **Now covered** (verified by reading the test source): coherent in-store
  forgery; four driver-seam cross-row duplicates; `ATTACH`; all six `durability()`
  pragmas; successful publication `restored`; record-byte and seven-event
  ceilings; forward-clock permanence across reopen; v1 input and v1 schema
  refusal; verbatim cross-store transplant; public-`read` override.
- **Still missing:**
  1. **Coherent cross-store rewrite.** Only *verbatim* relocation is pinned. No
     test writes a rewritten record whose `storeId` is store B's, with recomputed
     `intentDigest`/`record_digest` and an unchanged `approvalIdentityDigest`, and
     asserts that it is **accepted** — which is the honest boundary of B-01's fix.
  2. **Two stores, one namespace, one approval ID.** Nothing pins that each store
     independently accepts the same `approvalId`, i.e. that namespace-global
     uniqueness rests entirely on sole protected host enrollment.
  3. **N-02's own control.** No test constructs a second
     `SqliteCandidateEffectLedger` over the **same** connection after poisoning and
     asserts the write succeeds. Only `reopen()` (new connection) is exercised.
  4. **Constructor pragma normalisation.** The new pragma loop proves the current
     instance denies drift; nothing pins that `configure()` silently restores the
     drifted connection when a new ledger is constructed over it.
  5. **A v1-shaped record row inside a v2-shaped table** (as distinct from a v1
     schema), which should deny `state-invalid` on the `schemaVersion` literal.
- **Required correction:** add 1 and 2 before consumer-boundary work; they
  document the limits the disposition already states in prose. 3–5 can follow.

### V2-N-05 — Store binding widens single-row whole-store denial

- **Severity:** low · **File:**
  `windows-candidate-effect-ledger.ts` line 105 · **Status:** new (an instance of
  N-04, which remains open)
- **Observed fact:** a single row whose `intent.storeId` differs now fails
  `identity-mismatch` inside `#scan()`, and every read and write routes through
  `#scan()`. The packet's own transplant test asserts exactly this across
  `read`, `listBlocked`, `reserve` and `advance`, before and after reopen.
- **Why it matters:** the direction is correct and intended (fail closed), but
  one inserted foreign row is now a cheap, permanent bricking primitive for the
  same file-write adversary, with no partial-discovery or repair path. This does
  not raise the adversary's required capability — they could already corrupt a row
  — but it belongs in the forensic/operational path N-04 defers, not left
  implicit.
- **Required correction:** none in S1. Record it against the N-04 operational
  prerequisite.

### V2-N-06 — Lock contention is not distinguishable from storage failure by consumers

- **Severity:** low · **File:** `windows-candidate-effect-ledger.ts` line 46
  (`guard`) · **Status:** new
- **Observed fact:** `guard()` maps every non-`CandidateEffectError` to
  `storage-unavailable`. The new contention helper confirms the intended mapping —
  raw SQLite reports `SQLITE_BUSY`, the ledger reports `storage-unavailable` — but
  a consumer sees the same reason for benign contention, a corrupt file and a
  driver fault.
- **Required correction:** none in S1. State in the consumer contract that
  `storage-unavailable` is not retry-safe on its own and must be reconciled
  through durable blocker discovery, never by assuming contention.

### V2-N-07 — Contention test depends on message-before-exit delivery

- **Severity:** low (test reliability) · **File:** test file lines 311–343 ·
  **Status:** new
- **Observed fact:** the final `afterRelease` message is posted immediately
  before the worker exits; the promise resolves on `exit`, and the assertion on
  `afterRelease` runs after. If that message were not drained before `exit`, the
  assertion fails on `undefined`.
- **Why it matters:** the failure mode is a false failure, not a false pass, so
  the control is sound. Worth a bounded acknowledgement alongside V2-N-01.

### V2-N-08 — Carried findings restated, not re-opened

- N-01 / N-08 (outcome and parent freshness unbounded): unchanged in source and
  now demonstrated by the "expired success is historical bookkeeping" test.
  Correctly deferred to the host; **still open** as a consumer rule.
- N-03 (forward-clock permanence): unchanged; now tested across reopen.
- N-04 (one corrupt row denies the store): unchanged; see V2-N-05.
- N-05 (`replayed` on quarantined records): unchanged; now pinned by regression.
- N-06 (`touched` latched before save): unchanged and, in this reviewer's
  judgment, correct — see §7.1 Q8.
- N-09 (once-at-a-time, not once-ever): unchanged; now pinned by the restoration
  test.
- N-10 (two full scans per write): unchanged, plus the new O(n) set derivation
  and per-record `verifiedParent`. No scalability claim should be made from
  1,000-row fixtures.
- N-11 (32 KiB ceiling): the v1 byte arithmetic is **not** reused. `storeId` adds
  roughly 50 canonical bytes per intent; the ceiling remains a corruption and
  allocation bound, not measured legitimate size. No v2 measurement was performed.
- N-07, N-12: corrected; see §7.1 Q4 and Q5.
- N-13 item 8 (cross-platform): **still open**. All evidence remains Windows x64.

## 7. Verification Results

- **Test command/result:** **NOT RUN.** STATIC_SOURCE scope. No subject module,
  focused test or helper was compiled or executed by this reviewer. All statements
  about test behaviour below are source reading, not reproduction.
- **Probe command/result:** read-only clone of `eOnoes/Audits` at
  `2f6a42dec9fcddac975a312409e80d6f305ed72b`; digest, byte-length and blob-OID
  recomputation over packet bytes; textual diff of baseline against current
  modules. No writes, no network access beyond the public clone.
- **Hash/manifest comparison:**
  - `MANIFEST.sha256` self-digest as observed:
    `b5de1538f0e78ce22118c13cd9e0c2127f7dc5137daf806a24dd24a910936734`.
    **No expected manifest hash was supplied to this reviewer through any channel**,
    so this value is recorded, not verified. See §9.
  - All **30/30** manifest entries recomputed and matched; zero mismatches.
  - The only file present in the packet and absent from the manifest is
    `MANIFEST.sha256` itself, as expected.
  - `SOURCE_IDENTITIES.memberCount` is 15 and 15 members are listed. For every
    member, `byteLength`, `sha256` and `gitBlobOid` were independently recomputed
    and **all matched**.
- **Receipt comparison:**
  - `receipts/FOCUSED_V2.tap`: 39 `ok` lines, 0 `not ok`, plan `1..39`, summary
    `tests 39 / pass 39 / fail 0 / cancelled 0 / skipped 0`, `duration_ms 2716.74`.
    Internally consistent and byte-identical to the hash recorded in both
    `PRODUCER_EVIDENCE.json` and `MANIFEST.sha256`.
  - `receipts/HISTORICAL_PINNED.tap` (`119918de…`): 18/18, 0 skipped,
    `duration_ms 1185.3941`.
  - `receipts/HISTORICAL_PRECOMMIT.tap` (`a7ecb823…`): 18/18, 0 skipped,
    `duration_ms 926.2852`.
  - The two historical TAPs carry an **identical, identically ordered list of 18
    test names**; they differ only in per-test and total durations. Neither shows
    any sign of rewriting to force agreement.
  - Full-run summary (1,828 tests / 1,826 pass / 2 skips, sha256 `8040823c…`):
    raw TAP not included by declared scope; **unverifiable**.
- **Scope check:** PASS. Only packet files were inspected; no wider product path,
  VM, installer, credential or provider was touched; the only repository read
  outside the packet directory was `REPORT_DELIVERY.md` at the root, which the
  packet itself cites and which is byte-identical to the packet copy, plus a
  workflow-presence check required by the write contract.
- **Unexpected output or failure:** none.

### 7.1 Answers to the ten focused remediation questions

**Q1 — `storeId` binding, verbatim relocation, v1 rejection, coherent rewriting.**
Yes on all three, with one boundary to state plainly. `storeId` is in `common`, so
both `execute` and `publish` intents require it; it therefore enters
`intentDigest` and the record digest. `reserve()` (line 170) rejects a mismatched
`storeId` with `identity-mismatch` before any write; `#scan()` (line 105) rejects
any row whose `intent.storeId` differs, on every access path, before the
row-vs-column checks. `subjectFields` now includes `storeId`, though that
comparison is redundant once `#scan()` has pinned every record to one store —
harmless defence in depth. Legacy v1 denies twice over: a v1 intent fails the
`schemaVersion` literal (`input-invalid`), and a v1-shaped database fails the
exact-DDL comparison in `schema()` because `CHECK (version = 1)` differs from the
expected text (`schema-invalid`); no migration, adoption or rewrite path exists,
and the test asserts the legacy schema is left untouched. **Coherent rewriting is
explicitly not prevented and must not be described as prevented.** An actor who
can write the file can set `storeId` to the target store and recompute every
digest; because `effectApprovalIdentity` excludes `storeId` (see Q2), such a
rewrite preserves approval identity exactly. What v2 buys is that *verbatim*
byte-portability between same-namespace stores is gone — which was B-01's actual
claim — and this is pinned by a test that checks all four access paths before and
after reopen.

**Q2 — Historical approval identity; namespace-global uniqueness.**
Unchanged, deliberately. `APPROVAL_IDENTITY_DOMAIN` is pinned to
`agent-candidate-effect-ledger/v1` and the digest input is still
`{domain, namespaceId, approvalId}` — no store, no phase, no record version, no
key alias. The test asserts the literal digest and asserts
`effectApprovalIdentity(input) === effectApprovalIdentity(alternate)` where
`alternate` differs only in `storeId`, while the intent digests differ. So a spent
approval cannot be refreshed by moving stores or bumping the record version.
**Namespace-global uniqueness still depends entirely on sole protected host
enrollment.** Uniqueness is enforced only among the rows of one store — by the SQL
`UNIQUE` constraint and, now, by the independent scan derivation. Two
independently enrolled stores over the same namespace each accept the same
`approvalId` once. The disposition says this; no test pins it (V2-N-04 item 2).

**Q3 — Independent re-derivation on every scan; are the seam tests falsifying?**
Yes, and yes for all four. `#scan()` lines 114–122 build four sets and fail
`state-invalid` on a repeated `operationId`, repeated `approvalIdentityDigest`,
repeated `${workflowId}:${kind}`, or a second blocked record on one
`workspaceDigest`. The composite workflow key is unambiguous because both
components are strictly parsed (UUID regex, `kind` enum), so no separator
confusion is reachable. This runs inside both the deferred read transaction and
the `IMMEDIATE` write transaction, so all four access paths are covered — which
the test asserts directly via `corruptScans === 4`.
On falsifiability: the seam replaces the driver's result rows *after* a real
SQLite read, so SQL indexes never see the injected duplicate. I traced each of the
four cases against every other check in `#scan()` — the injected row is internally
coherent (recomputed `intentDigest`, `approvalIdentityDigest`, `record_json`,
`record_digest`, and columns that agree with the record), and `blocked: 1` matches
its reserved state. In each case **no other check rejects it**; only the new
cross-row derivation does. Remove lines 114–122 and all four tests fail. Two
honest caveats: `corruptScans === 4` proves the corrupted scan was *reached*, not
which specific check fired; and a mutation run confirming the four failures is
**NOT RUN**. The tests prove application validation, exactly as their comment says
— not physical index corruption.

**Q4 — Public read override; private fields and fault seams.**
The override path is closed. `#write()` now verifies the post-commit read-back
through `#readOne()`, a true ECMAScript private method, and the test replaces
`f.store.read` with a throwing stub and asserts `overridden === 0`. `db`,
`storeId`, `namespaceId` and `now` are `#` fields, which the test confirms by
asserting they do not appear in `Reflect.ownKeys(f.store)`; `target: "ES2022"`
means these compile to real private fields, not `WeakMap` emulation or bare
TypeScript `private`. **Do not overclaim this.** The trusted host still passes the
`Database` object into the constructor and keeps its own reference — the packet's
own seam tests monkey-patch `db.prepare` to prove the point. Private fields defend
the integrity check against accidental or public-surface substitution, not against
the host that owns the connection. That is the correct scope and the disposition
states it.

**Q5 — Held-lock evidence; cleanup and timeouts.**
Yes, this is materially stronger than the start barrier. The parent executes
`BEGIN IMMEDIATE`, asserts `db.inTransaction === true`, then releases the gate.
The worker's raw `BEGIN IMMEDIATE` fails, then `store.reserve()` fails, and only
then does it post both outcomes. On receipt the parent **re-asserts that it still
owns the write lock** and that the operations table is still empty before rolling
back — so the contention is observed, not inferred from a start time. Phase 2 then
proves recovery: after explicit release the worker's reserve returns `recorded`,
and the parent's replay returns `replayed`. Serialisation without contention
cannot produce `sqliteCode === "SQLITE_BUSY"` with the parent's transaction still
open. Bounds are adequate: test `timeout: 15_000`, helper barrier deadline
10,000 ms with a hard throw, `Atomics.wait` with a shrinking remaining budget, and
a `finally` that rolls back, opens the gate, terminates the worker and removes the
temp directory with a validated path. One low residual: the last message must be
drained before `exit` (V2-N-07); its failure mode is a false failure.

**Q6 — Do the new tests support their stated scope? Remaining negative controls.**
Yes, with scope language that is accurate rather than flattering. Restoration
pins release of the once-at-a-time workspace exclusion *and* the non-release of
approval identity, plus denial of a post-`restored` transition. The pragma loop
covers exactly the six pragmas `durability()` checks. `ATTACH` denies through the
`database_list` branch without reading the attached database. Corruption is
covered at two distinct layers — direct row mutation and the driver seam — and the
test comments state clearly that neither is physical index corruption. Expiry and
replay pin that late bookkeeping is permitted, that `replayed` is returned for a
quarantined record, and that this is not permission. Remaining gaps are listed in
V2-N-04; the two that matter before consumer work are the coherent cross-store
rewrite acceptance and the two-stores-one-approval case, because both document
limits the prose already claims.

**Q7 — Do the two historical TAPs and the phase field resolve B-04?**
Yes, and correctly, without rewriting either run. Both files are shipped and both
verify: `a7ecb823…` at 926.2852 ms is the decision document's earlier run;
`119918de…` at 1185.3941 ms is the run shipped in the earlier packet, and
`HISTORICAL_PRODUCER_EVIDENCE.focused.phase` explicitly reads
`fresh-compile-and-execution-after-pinned-commit`. Both are 18/18/0 with zero
skips and — as recomputed here — carry an identical ordered list of 18 test names,
which is consistent with two executions of the same compiled suite and
inconsistent with a substituted or edited run. The reading that the word "final"
in the older document was not a durable identifier for every later execution is
supported by the bytes. Accepted. Two residues remain, both documentation rather
than chronology: the superseded decision document still carries the older number
with no forward pointer (V2-N-02), and one of the two TAPs has no receipt-level
role label (V2-N-03). The current v2 capture is a third, separate run and neither
historical result carries any weight for v2.

**Q8 — Is retaining `touched`-before-save correct?**
Yes. The flag is set immediately before `#save()` and the instance poisons if
anything downstream throws. The alternative — latching after `#save()` returns —
assumes that a driver which did not return also did not write, which is precisely
the uncertainty the ledger exists to survive. Under `BEGIN IMMEDIATE` the ordering
is favourable: contention throws before the closure body runs, so it does not
reach the latch at all (the new contention test exercises exactly that path and
the store is demonstrably usable afterwards), and `reserve()`'s uniqueness checks
also precede `#save()`. What remains is genuine post-attempt uncertainty, which
should poison. The conservatism costs availability on one instance and is
recoverable by construction, which is the documented and intended trade. N-06 is
correctly dispositioned as "keep".

**Q9 — Does B-03 stay open?**
It must, and the packet keeps it open honestly. See §5. Neither the MAC that does
not exist nor the store binding that does makes rollback impossible: store binding
stops verbatim relocation between stores, nothing else; unkeyed hashing detects
incoherence, not authorship; and no anchor exists that could distinguish an older
authentic snapshot, or a store with rows deleted, from the current one. The
coherent-forgery test's acceptance is the correct permanent record of that
boundary and should never be "fixed" to pass.

**Q10 — Disposition of every prior finding; what blocks what.**
- **Locally corrected:** B-01, B-02, N-07, N-12 (first half).
- **Accepted documented limitation:** N-02, N-04, N-05, N-06, N-09, N-10, N-11.
- **Still open:** B-03 (host gate), N-01, N-03, N-08, N-13 item 8
  (cross-platform), N-12 (second half — see V2-N-01).
- **Resolved as evidence clarification:** B-04, with V2-N-02 and V2-N-03 residual.
- **Disputed:** none. No prior finding is rejected by this review.
- **Blocking the next consumer-boundary review:** nothing in the source. The two
  negative controls in V2-N-04 items 1–2 and the documentation correction in
  V2-N-02 should land first so the review starts from accurate claims, but they
  are cheap and do not touch implementation.
- **Blocking production activation:** B-03 in full — protected file/WAL/SHM
  custody plus a separately protected freshness and anti-rollback anchor; the host
  freshness and authenticated-outcome binding of N-01/N-08; sole protected
  enrollment with global spent-ID retention (Q2); a protected restart and
  reconciliation policy for N-02/N-03; a forensic path for N-04; independent
  (non-producer) execution of the suite; cross-platform evidence if any non-Windows
  target is contemplated; and the unchanged, unfulfilled W1–W5 Windows release
  criteria.

## 8. Security and Integrity Review

- **Secrets:** none present in the packet and none required. No credential, token
  or private path was read, requested or emitted. `[REDACTED]` was not needed.
- **Injection and control content:** `effectParse` runs `assertPassive` *before*
  any reflection, rejecting proxies, cycles, exotic prototypes, accessors,
  symbol keys, >4,096 nodes, >16 depth, >512 keys and >32 KiB of string bytes; it
  then round-trips through `canonicalJson` → `JSON.parse` → schema, and rejects any
  parse whose canonical bytes differ from the input's. `canonicalJson` independently
  rejects accessors, non-`Object`/`Array` prototypes, sparse or shaped arrays,
  repeated references, non-finite numbers and unpaired surrogates. SQL is entirely
  parameterised; the only dynamic SQL is the frozen DDL compared verbatim against
  `sqlite_schema`. `trusted_schema=OFF` is both set and re-checked. **Untested by
  this reviewer** (static reading only).
- **Authorization:** none exists, by design. The return envelope is literally
  `kind: "recorded-state-not-effect-permission"`, and `replayed` is returned for
  quarantined records (N-05). No consumer may treat any value here as permission.
- **Isolation:** the module holds no signer, port, filesystem effect, consumer or
  migration path. No callback runs inside a transaction: the host clock is sampled
  outside it, and the test fixture asserts `db.inTransaction === false` on every
  injected clock call. `schema()` rejects any attached database and any temp
  object.
- **Mutation:** no delete, prune, reset, quarantine clearing or repair exists.
  `advance` is append-only within a ≤6-event record; `#save` updates only
  `blocked`, `record_json` and `record_digest`, and requires `changes === 1`.
- **Concurrency:** writes use `BEGIN IMMEDIATE` with a re-scan inside the
  transaction; reads use a deferred transaction. `busy_timeout = 250` ms is
  enforced and re-checked. Contention is now positively demonstrated (Q5) rather
  than inferred. Multi-process behaviour is evidenced on Windows only.
- **Provenance:** every member's Git blob OID, byte length and SHA-256 recomputed
  and matched. Provenance is nonetheless publisher-local by the packet's own
  declaration (`publisher-local-git-not-independent-bundle`); this review verifies
  internal consistency, not that these bytes are what any build actually used.
- **Replay:** idempotent replay is keyed on `operationId` plus byte-identical
  canonical intent, or on an identical prior event; divergence fails
  `intent-conflict`. Replay never repeats an effect because no effect exists here.
- **Rollback:** **not defended.** See B-03.
- **Fail-closed behaviour:** consistent and, if anything, aggressive — one bad row
  denies the whole store, one forward-clock excursion denies all earlier writes,
  one uncertain write poisons the instance, one drifted pragma denies every
  operation. All correct in direction; all with availability consequences that are
  now documented rather than discovered.

## 9. Limitations and Missing Evidence

1. **No execution of any kind.** STATIC_SOURCE. Every statement about test
   behaviour is derived from reading test source against module source. Source
   inspection was not converted into a probe result anywhere in this report.
2. **No expected manifest hash.** The request instructs the reviewer to hash
   `MANIFEST.sha256` against a separately supplied expected value. No such value
   reached this reviewer through any channel. The observed self-digest is recorded
   in §7 for the operator to compare; treat that comparison as outstanding.
3. **Full-suite TAP absent.** The 1,828/1,826/2-skip summary and its hash
   `8040823c…` cannot be checked against anything in the packet. Declared scope,
   recorded as a limitation, not a defect.
4. **Producer-reported execution only.** `PRODUCER_EVIDENCE` self-classifies as
   `AUTHOR_REPORTED_LOCAL_EXECUTION_NOT_INDEPENDENT`. Nothing here upgrades it.
   Independent execution remains the single largest missing evidence class.
5. **Platform.** All evidence is Windows x64 / Node 24.14.0 / ABI 137. WAL and
   file-locking semantics differ materially on POSIX, and the crash, race and
   contention tests are the most sensitive to that. N-13 item 8 stands.
6. **No physical fixtures.** Driver-seam substitution is not physical index
   corruption; `process.exit(23)` is not power loss; an ordinary-user temp SQLite
   file is not a protected installation; no guest, VM, provider, real approval or
   consumer was involved.
7. **Measurement.** No latency, throughput or record-size measurement was taken
   or reused. The prior report's v1 byte arithmetic is explicitly not carried into
   v2.
8. **Dependencies.** Only `better-sqlite3`'s historical `transaction.js` and
   LICENSE are supplied; this is not a dependency distribution, integrity check or
   authenticity proof. `package-lock.json` was hash-verified, not audited.
9. **Composition.** The wider product, installer, protected storage and every
   consumer boundary are outside this packet and unreviewed.

## 10. Required Next Action

Minimal, ordered:

1. Add the two missing negative controls that document B-01's true boundary:
   coherent cross-store rewrite is **accepted**, and two same-namespace stores each
   accept one `approvalId` once (V2-N-04 items 1–2).
2. Publish a successor or header note for
   `ONOES_AGENT_DISPATCH_LEDGER_DECISIONS.md` naming the superseding disposition,
   the two historical run roles, and the per-store qualification of approval
   uniqueness. Preserve the historical bytes (V2-N-02).
3. Give both historical TAPs receipt-level role labels with true packet paths in
   the next packet (V2-N-03).
4. Widen the retained start-barrier race assertion to admit
   `storage-unavailable`, or raise that test's busy timeout (V2-N-01).
5. Re-audit scope: the changed record/scan/read-back boundary composed against a
   *consumer contract* — specifically `replayed`-is-not-permission, the
   `storage-unavailable` reconciliation rule, and host-owned outcome freshness.
   That review needs no new implementation.
6. Before any activation, and separately from the above: design and review
   protected custody plus a freshness/anti-rollback anchor (B-03), and obtain at
   least one independent (non-producer) execution of the focused suite.
7. Intentionally excluded and to remain so in this line of work: the wider
   product, installer, VM, protected storage, credentials, live approvals,
   providers, deployment, and any migration or repair path for v1 data.

## 11. Explicit Non-Claims

This report does **not** certify: formal acceptance of the v2 remediation;
production readiness; readiness for live-model, provider or consumer activation;
public-release readiness; or the Windows W1–W5 release criteria, which remain
unfulfilled. It does not certify that the supplied bytes are what any build or
release used, only that they are internally consistent with the supplied
identities. It does not certify any test result: **no subject test or helper was
executed**, and every producer-reported run remains author-reported and not
independently reproduced. It does not certify the absence of physical index
corruption, power-loss, POSIX or protected-host behaviour, none of which were
exercised. It does not certify that coherent forgery, snapshot rollback, row
deletion or cross-store rewriting are detectable — they are not, and B-03 remains
open. It does not certify anything about the wider Onoes-Agent product, its
installer, its protected storage or any consumer boundary, all of which are
outside this packet. Finally, it does not confer permission to invoke any effect:
every value this ledger returns is recorded state, not authorization.

---

```
MODEL_ID: Claude Opus 5 (as presented to this session; prior general project involvement disclosed in §2)
ROUTE: operator-supplied immutable GitHub URL; public read-only clone of eOnoes/Audits; no provider call from the repository
AUDITED_REVISION: source 0d31bf74230759482575340968f2340bb23d393e; packet commit 2f6a42dec9fcddac975a312409e80d6f305ed72b; baseline 76dc12a9474d626efcf1944c86f4ffd131bfef2f
IMPLEMENTATION_VERDICT: PASS_WITH_FINDINGS
SECURITY_VERDICT: NEEDS_REVIEW
EVIDENCE_VERDICT: PARTIAL
BLOCKING_FINDINGS: 1 (B-03, carried, still open; blocks activation, not the next review)
NONBLOCKING_FINDINGS: 8 (V2-N-01 … V2-N-08, the last restating carried N-01…N-13 dispositions)
TEST_RESULTS: NOT RUN (STATIC_SOURCE). Receipts verified only as artifacts: FOCUSED_V2.tap 39/39/0 internally consistent and hash-matched; HISTORICAL_PINNED 18/18/0 at 1185.3941 ms; HISTORICAL_PRECOMMIT 18/18/0 at 926.2852 ms, identical ordered test-name lists; full-suite TAP not supplied and unverifiable
SCOPE_RESULT: PASS — packet-only inspection; no execution, build, install, provider call, credential, workflow or mutation
PLATFORM_LIMITATIONS: Windows x64 / Node 24.14.0 evidence only; no POSIX, no physical corruption, no power-loss, no protected storage, no guest/VM, no independent execution; expected MANIFEST.sha256 value not supplied to this reviewer
ADVANCEMENT: NO
NEXT_REQUIRED_ACTION: Add the coherent-cross-store-rewrite and two-stores-one-approval negative controls, then correct the superseded decision document, before opening the consumer-boundary review. B-03 custody and anti-rollback design remain the gate for activation.
REPORT_DELIVERY: BLOCKED_NO_GITHUB_WRITE_ACCESS
REPORT_TARGET_PATH: eOnoes/Audits @ main : onoes-agent-effect-ledger-v2-0d31bf742307-static-v1/reports/AUDIT_REPORT.md
```
