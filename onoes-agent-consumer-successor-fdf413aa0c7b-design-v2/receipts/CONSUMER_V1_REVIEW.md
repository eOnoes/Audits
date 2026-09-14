# Audit Report — Onoes-Agent candidate consumer contract and ledger boundary / onoes-agent-candidate-consumer-7060f7058ae0-design-v1

## 1. Executive Summary

This is a DESIGN + STATIC_SOURCE review of the proposed candidate consumer
contract (`ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V1.md`) against the supplied
ledger, review, verification, source-codec, VM-lifecycle and workflow sources at
publisher revision `7060f7058ae0c2febf3cf9d5b1efb3b3169f9dba`, packet commit
`459aa620ae778d2d4f5eb5f2ec39f946b9f5c4be`. Every packet byte was recomputed:
all 47 `MANIFEST.sha256` entries verify, all 34 `SOURCE_IDENTITIES` members match
on Git blob OID, byte length and SHA-256, and all three raw TAP receipts match
their recorded hashes and counts. The seven boundary tests requested by the prior
review are present and falsifying in the current test bytes, and the two disputed
prior findings (start-barrier race assertion, Worker message ordering) are
resolved in the producer's favour on the current bytes and on the cited Node
24.14 documentation. The proposed contract is largely consistent with the
sources it cites, but it is not yet acceptable as the basis for a consumer: its
own failure table requires outcomes that the frozen v2 state graph cannot record
(a confirmed runner failure without a result wire, or a confirmed abort after the
first possible-effect marker, can only be recorded as absorbing quarantine, which
permanently retires that workspace in the store); its identity table names a
candidate-store qualification that no durable field carries; and its phase
ordering needs a versioned controller-channel protocol that does not exist.
B-03 (no protected freshness or anti-rollback anchor) remains open and is
correctly stated as open. **Advancement to consumer activation is blocked.** The
next synthetic composition slice may proceed once the state-graph decision in
CC-B-01 is recorded in the contract. No subject test, helper, script, provider or
VM was executed. Report-only GitHub delivery is addressed in chat, separately
from this document.

## 2. Audit Identity

- **Audit ID:** `onoes-agent-candidate-consumer-7060f7058ae0-design-v1`
- **Project:** Onoes-Agent candidate consumer contract and ledger boundary
- **Auditor/model:** Claude Fable 5.1 (`claude-fable-5-1`), as presented to this
  session by the operator's Claude Code client. **Prior involvement:** none. This
  session did not author any packet member, the proposed contract, or either
  prior report. The two prior reports preserved in the repository self-identify
  as Claude Opus 5 sessions; this reviewer treated them as external evidence
  only, per the request. No publisher workspace, product repository or private
  material was accessible or accessed.
- **Route/provider:** operator-mediated public GitHub reading: ordinary
  read-only `git clone` of `eOnoes/Audits`, read-only GitHub API metadata calls
  (repository permissions, Actions permission state, workflow count), and one
  public fetch of the Node.js v24.14.0 `worker_threads` documentation cited by
  the packet. No provider or model call was made from the repository.
- **Audit type:** DESIGN + STATIC_SOURCE; not activation or implementation PASS
- **Date/time UTC:** 2026-09-14T01:40:36Z (reviewer environment clock at start of
  report composition; packet prepared 2026-09-13)
- **Audited revision:** publisher source
  `7060f7058ae0c2febf3cf9d5b1efb3b3169f9dba`; packet commit
  `459aa620ae778d2d4f5eb5f2ec39f946b9f5c4be` (also the tip of `main` at review
  time); contract's own inspected product `ac279d223df8defcae9dc85ff7cc32ea5f89239d`
  (declared documentation-only delta to `7060f70`, not verifiable from the packet)

## 3. Scope and Method

- **In scope:** packet directory
  `onoes-agent-candidate-consumer-7060f7058ae0-design-v1/` only: the proposed
  consumer contract, the three handoff decision/disposition documents, the
  packet-local historical run index, the 17 supplied `src/` modules, the eight
  supplied test/helper files, both `tsconfig` files, `package-lock.json`, all
  receipts, and the report-output contract.
- **Exclusions:** wider product; the 13 `not-supplied` dependency edges (candidate
  store, task inspection, operator task preview, builder executor, agent-workflow
  schemas and types, builder types, two test fixtures); native controller;
  guest/VM; installer; protected storage; credentials; providers; deployment;
  any execution of subject code.
- **Files inspected:** all 47 manifest members. Read in full with line
  references: `AUDIT_REQUEST.md`, `SCOPE.md`, `REPORT_DELIVERY.md`,
  `reports/README.md`, all eight `receipts/*` members (the full producer TAP was
  scanned programmatically, not read line by line),
  `source/docs/handoff/*` (all five),
  `source/src/build-only/*` (all 13), `source/src/builder/*` (all three),
  `source/src/compatibility/canonical-json.ts`,
  `source/src/validation/deep-freeze.ts`, both `tsconfig*.json`,
  `tests/tests/unit/*` (all five) and `tests/tests/helpers/*` (all three).
  `source/package-lock.json` was hash-verified and its root and four relevant
  dependency entries read; it was not audited.
- **Commands/probes run:** `git clone` (twice: the first with the host's default
  CRLF conversion, discarded; the second with `core.autocrlf=false` and
  `core.longpaths=true`), `git rev-parse`, `git log`, `git ls-tree`,
  `git cat-file`, `git fetch`, `git show`, `sha256sum`, `sha256sum -c`, `diff`,
  `comm`, `file`, `grep`, `wc`, `tr`, `date -u`; two Python scripts that
  recomputed member digests, byte lengths and blob OIDs and cross-checked test
  names against the TAP; `gh auth status`, `gh api repos/eOnoes/Audits`,
  `gh api repos/eOnoes/Audits/actions/permissions`,
  `gh api repos/eOnoes/Audits/actions/workflows`; one HTTPS fetch of
  `https://nodejs.org/download/release/v24.14.0/docs/api/worker_threads.html`.
- **Cost/mutation controls:** no build, compile, install, test, script, helper,
  VM, provider or model call; no GitHub Actions or hosted runner (zero workflow
  files at `459aa62` and on `main`; see §7); no branch, PR, merge, reset, force
  push, deletion or edit of any packet member; the only prepared write is this
  report at the exact path named in the request. No secret was present,
  requested or emitted; the only credential observed was the operator's own
  masked `gh` token status line, which is not reproduced.

## 4. Verdict

```
IMPLEMENTATION_VERDICT: NEEDS_CHANGES
SECURITY_VERDICT: NEEDS_REVIEW
EVIDENCE_VERDICT: PARTIAL
ADVANCEMENT: NO
```

`NEEDS_CHANGES` applies to the proposed contract as the reviewed object: it must
resolve CC-B-01 before it can serve as the acceptance contract for a consumer.
The supporting source bytes are, in isolation, consistent with their own
comments and tests and would rate PASS_WITH_FINDINGS. `ADVANCEMENT: NO` denies
consumer activation, real approvals, real transfer, guest execution and original
writes. It does not deny the next synthetic composition slice, which may start
once the CC-B-01 decision is written into the contract (see §10).

## 5. Blocking Findings

### CC-B-01 — The frozen v2 state graph cannot record the contract's own confirmed-failure and abort outcomes

- **ID:** CC-B-01
- **Severity:** blocker (for contract acceptance and for any consumer
  implementation; not a defect in the audited ledger bytes, which behave as
  their tests say)
- **File/symbol/line:**
  `source/src/build-only/windows-candidate-effect-state.ts` lines 95–114
  (`checkTransition`): line 102 (`quarantined` from any non-terminal state),
  line 103 (`cancelled` only from `reserved`), lines 99–101
  (`result-and-stop-observed` requires non-null `resultDigest` and
  `verificationPassed`), lines 106–110 (execute edges);
  `windows-candidate-effect-state.ts` lines 91–93 (`quarantined` never releases
  the workspace blocker);
  `source/src/build-only/windows-managed-vm-controller-channel.ts` lines 22–23
  and 132–134 (`vm-controller-run-failed/v1` carries no payload and rejects
  `run`);
  `source/src/build-only/windows-managed-vm-verifier.ts` lines 142 and 160
  (`runner-failed` is thrown with no result wire);
  `source/docs/handoff/ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V1.md` lines
  167–170 (§5 rows "source-delivery-possible without confirmed destination",
  "launch-possible without authenticated result", "confirmed stopped failure"),
  line 172 (quarantine is absorbing, no new workflow), line 11 (no ledger
  schema revised by this draft).
- **Observed fact:** After an execute operation has recorded
  `source-delivery-possible`, the only edges are `launch-possible` or
  `quarantined`; after `launch-possible`, the only edges are
  `result-and-stop-observed` (which requires a `resultDigest`) or `quarantined`.
  `cancelled` is reachable only from `reserved`; `failed` is reachable only from
  `result-and-stop-observed`. A controller `run-failed` frame, a runner
  exception, an aborted transfer, or a confirmed host decision to stop the owned
  generation before launch therefore produce no result wire and no legal
  `failed`/`cancelled` edge. The contract forbids fabricating a failure
  terminal (line 124–125) and forbids a resend or relaunch (lines 167–168). The
  only recordable outcome is `quarantined`, which the contract itself defines as
  an absorbing deny with no new workflow (line 172), and which
  `candidateEffectBlocked` treats as a permanent workspace blocker.
- **Why it matters:** The contract's §5 table promises "Record only the
  established result/stop facts; no inferred pass, refund or automatic retry"
  for a confirmed stopped failure, and "stop the exact owned generation" for a
  delivery marker without confirmed destination. Neither has a representation
  distinct from unknown-stop quarantine. Consequences: (a) an honest,
  host-confirmed failure or abort is indistinguishable in the durable record
  from an unresolved crash; (b) every such event permanently retires that
  `workspaceDigest` in the store, with no reviewed repair, store-replacement or
  forensic path (contract line 172; disposition N-04/N-05); (c) the consumer's
  §5 reconciliation logic has nothing to write. This is exactly the case the
  request's Q2 warns against: the prose assumes the host can satisfy it, and the
  frozen graph cannot.
- **Reproduction/probe:** Source reading only. The packet test
  `pure state graph rejects skipped effects, contradictory results and
  restoration of execution` (test file lines 114–127) pins that `cancelled` is
  denied from `source-delivery-possible` (line 120) and that
  `result-and-stop-observed` with a null `resultDigest` is denied (line 122).
  **NOT RUN** by this reviewer.
- **Required correction:** A recorded design decision in the contract, one of:
  (1) a separately versioned v3 record domain adding a distinct terminal (for
  example `aborted`) reachable from `source-delivery-possible` and
  `launch-possible` only with host-established stop/cleanup evidence and, once
  an anchor exists, only when the anchor shows the marker was never released to
  an effect; or (2) an explicit statement that any execute without a parseable
  result retires the workspace in this store permanently, together with the
  separately reviewed forensic/replacement procedure that then becomes a
  prerequisite. Historical v2 bytes must not be rewritten; either choice is a
  successor, not a patch.
- **Status:** new

### B-03 — No protected freshness or anti-rollback anchor (carried, still OPEN)

- **ID:** B-03 (identifier retained from the v1 and v2 reports)
- **Severity:** blocker for activation; not a defect in the audited bytes
- **File/symbol/line:** `windows-candidate-effect-ledger.ts` lines 11–12 and
  103; contract lines 208–225 (§7); pinned by tests
  `coherent in-store forgery is accepted` (test lines 471–485) and
  `coherent cross-store rewrite is accepted` (test lines 487–507).
- **Observed fact:** `record_digest` is an unkeyed SHA-256 over bytes the same
  file writer controls. Both negative controls construct a legal completed
  history offline, write it over a real row (or into a second same-namespace
  store with a rewritten `storeId`) and assert that a reopened store reads it
  back as genuine and funds a `publish` reservation. No anchor interface,
  counter, high-water mark, chained digest or external witness exists anywhere
  in the supplied bytes. The contract's steps 2, 3, 5, 7 and 9 each require a
  "protected freshness association" that has no field, no port and no protocol.
- **Why it matters:** Without it, the ledger's commit-before-effect ordering
  proves ordering only against an honest file; rollback to an earlier
  self-consistent snapshot, row deletion and coherent rewriting are all
  undetectable, and every uncertainty window in §7.1 Q7 stays open.
- **Reproduction/probe:** the packet's own negative controls. **NOT RUN.**
- **Required correction:** none inside the audited bytes. The minimal
  separately reviewable protocol is described in §7.1 Q7.
- **Status:** previously documented; still open; correctly labelled OPEN by the
  contract, the v2 successor document and the disposition

## 6. Nonblocking Findings

### CC-N-01 — Candidate-store identity is a caller-supplied string; no durable authorization association

- **Severity:** medium (design) · **Status:** new
- **File/symbol/line:**
  `source/src/build-only/windows-managed-candidate-review.ts` line 26
  (`compileManagedCandidateReview(storeId: string, artifactDigest: string, saved, inspection)`)
  and lines 79–80 (`candidateStoreId: storeId` enters the material core);
  `windows-managed-candidate-verification.ts` line 53 (`uuid.parse` is the only
  check) and lines 73–80 (`preparationDigest` binds `candidateStoreId`,
  `artifactDigest`, `workProposalDigest`, `reviewMaterialDigest` and the
  request, but is not a ledger field);
  `windows-candidate-effect-state.ts` lines 18–29 (intent fields);
  `windows-candidate-effect-ledger.ts` lines 63–64 (`subjectFields`);
  contract lines 40 and 65–73.
- **Observed fact:** The identity table says `candidateDigest` is the saved
  `artifactDigest` "qualified by its candidateStoreId in the authenticated host
  authorization context". In the bytes, `candidateStoreId` originates as a plain
  string parameter that nothing binds to the `saved` artifact's actual store; it
  reaches the ledger only transitively, inside `reviewMaterialDigest`. The ledger
  intent has no `candidateStoreId`, no `workProposalDigest`, no
  `preparationDigest`, and no digest of any approval envelope: `approvalId` is a
  bare UUID whose meaning is stored nowhere (`effectApprovalIdentity`, state
  lines 85–87, hashes only `{domain, namespaceId, approvalId}`). The row
  therefore records that some approval ID was spent, not what it authorized.
  The relationship among `candidateDigest`, `reviewMaterialDigest`,
  `requestDigest` and `sourceManifestDigest` is asserted by the host at reserve
  time and never re-derivable from the row.
- **Why it matters:** The request asked for the missing durable authorization
  association, not merely matching hashes. This is it: the ledger can prove an
  approval ID was consumed once, and cannot prove which candidate, store,
  proposal or review that approval named. The contract correctly defers the
  envelope to §3, but the identity table's wording ("qualified by") reads as if
  the qualification were carried.
- **Required correction:** State in §2 that `candidateStoreId`, the
  artifact/proposal distinction and the approval's content binding are host
  obligations with no ledger field in v2, and that any future envelope digest
  (or `preparationDigest`) added to the intent is a versioned successor domain.

### CC-N-02 — The phase ordering needs a controller-channel protocol that does not exist

- **Severity:** medium (design/interface) · **Status:** new
- **File/symbol/line:**
  `windows-managed-vm-controller-channel.ts` lines 13–16
  (`outputFrames: 3`, `requestBytes: 65_536`), lines 19–26 (exactly four inbound
  kinds: ready, result, run-failed, stopped), lines 37–44 ("Request and stop are
  the only commands"), lines 154–176 (`run`, `stopAndConfirm`);
  `windows-managed-vm-verifier.ts` lines 13–28 (`ManagedVmVerificationSession`
  has `run` and `stopAndConfirm` only); `windows-candidate-source-transfer.ts`
  lines 7–9 and 138–139 (codec only; transport must enforce EOF and peer);
  contract lines 107–110 (step 4) and 201–206.
- **Observed fact:** Step 4 requires transferring the complete manifest and
  every file, then "authenticated transport EOF/settlement, destination physical
  custody and complete read-back separately", before step 5's `launch-possible`.
  The only host→controller commands are `vm-controller-run/v1` (capped at
  65,536 bytes, the historical limit the contract says must not widen) and
  `vm-controller-stop/v1`. There is no delivery command, no custody
  acknowledgement frame, and the inbound frame budget of three (ready,
  result-or-failed, stopped) has no slot for one. The `ManagedVmVerificationSession`
  interface has no delivery phase, and `acquireManagedVmController` marks the
  channel one-shot before any transfer could occur.
- **Why it matters:** The ordering is implementable with the existing ledger,
  codecs and verifier, but not with the existing channel or session interface.
  The contract says a new request transport "needs a separately versioned
  end-to-end capacity review" (line 206) but does not name the interface.
- **Required correction:** Name it: a versioned controller-channel protocol
  (new command kind for source frames carrying the pinned manifest digest, a
  new inbound `source-stored`/custody frame bound to `manifestDigest`, an
  inbound frame budget of at least four, and a separate byte budget for the
  transfer path), plus a versioned session interface with a delivery phase
  between `ready` and `run`. Distinguish this from the unchanged 65,536-byte run
  request.

### CC-N-03 — Review-before-verification chronology is semantically reusable, not wire-compatible

- **Severity:** medium (design) · **Status:** new
- **File/symbol/line:** `source/src/builder/agent-workflow.ts` lines 293–316
  (`reviewTime`, `verificationTime`, reviewer ≠ builder, reviewer ≠ verifier,
  verifier ≠ builder, `verificationTime >= reviewTime`), lines 479–491
  (`verifyCommandResults` requires per-command `commandId` and `commandDigest`
  matching `task.commands`), lines 5–41 (imports from not-supplied
  `agent-workflow-schemas.js`, `agent-workflow-types.js`, `types.js`);
  `windows-managed-candidate-review-verifier.ts` lines 23–28 (assertion binds
  `reviewMaterialDigest`, `phase: "pre-dispatch-source-review"`, `reviewedAt`,
  `expiresAt`); `windows-managed-verification-evidence.ts` lines 27–43 (result
  has no `commandId`, `commandDigest`, actor or time); contract lines 142–152.
- **Observed fact:** The ordering rule the contract cites is real: a review
  dated after the verification fails `verifierPassed`, so a post-run review
  cannot borrow a prior run. But `createAgentWorkResult` consumes
  `AgentWorkEvidence` whose `review` carries `proposalDigest` and
  `reviewSnapshotDigest`, and whose `verification` carries `commandResults`
  with `commandDigest`. The candidate path's signed review assertion carries
  `reviewMaterialDigest` only; the VM result carries neither command identity
  nor time nor actor. Feeding either into the historical workflow would require
  synthesising fields the signer never signed. The candidate review assertion
  also has no binding to any verification run; freshness at publication rests
  on `assertCurrent` (review-verifier lines 102–105), which checks expiry, not
  age relative to the run.
- **Why it matters:** The contract's sentence "not automatic compatibility with
  the historical workflow receipt issuer or its serialization" is correct; a new
  evidence format (or a versioned adapter that signs nothing new) is required
  where the contract says it is. Because the schema and type modules are not
  supplied, even the historical wire could not be fully verified here.
- **Required correction:** Record that the reused element is the ordering
  invariant (review time ≤ verification time, three distinct actors), and that
  the candidate path needs its own evidence schema binding the review
  assertion's `envelopeDigest`, the verification `resultDigest`, the execute
  `operationId` and the measured run/stop interval.

### CC-N-04 — A restored publication exhausts the workflow; the verified execution can never be published

- **Severity:** medium (design consequence to state explicitly) · **Status:** new
- **File/symbol/line:** `windows-candidate-effect-ledger.ts` line 22
  (`UNIQUE(workflow_id,kind)`), line 178 (`workflow-reused`), lines 65–72
  (`verifiedParent` requires `parent.intent.workflowId === intent.workflowId`
  via `subjectFields`); test lines 581–595.
- **Observed fact:** `publish` must share the execute's `workflowId` and a
  workflow admits one `publish` row. After `publication-possible → restored`,
  the workspace blocker is released and the approval stays spent (tested), but
  a second `publish` in that workflow is `workflow-reused`, and a `publish` in a
  new workflow cannot cite the old execution as parent. Re-publication of the
  same verified result therefore requires a complete new execute workflow
  (transfer, launch, verification) under new approvals.
- **Why it matters:** This is consistent with "one execution per workflow" and
  is defensible, but it is a cost the contract does not state, and a consumer
  author could be tempted to relax `verifiedParent` to allow cross-workflow
  parents. That relaxation would break the one-publish-per-execution invariant.
- **Required correction:** State the consequence in §4 or §5 and forbid
  cross-workflow parent references explicitly.

### CC-N-05 — Guest generation and controller identity are pinned at reserve, before any launch

- **Severity:** low (wording) · **Status:** new
- **File/symbol/line:** `windows-candidate-effect-state.ts` line 23
  (`guestImageDigest`, `guestGeneration`, `controllerIdentityDigest` are
  required intent fields); `windows-candidate-effect-ledger.ts` lines 63–64
  (publish must echo all three); `windows-managed-vm-controller-channel.ts`
  lines 19 and 120 (the ready frame's `vmId`/`sessionId` are checked for
  equality with caller-supplied values, never authenticated); contract line 45
  ("a fresh host-observed launch generation").
- **Observed fact:** All three values must be known when `reserve` runs (step
  2), which precedes transfer (step 4) and launch (step 5). Nothing in the
  supplied bytes observes any of them from a guest; the channel compares
  identities the host already chose. The publish intent must carry the execute
  parent's values verbatim although publication launches nothing.
- **Required correction:** Reword to "host-minted at acquisition, before
  reserve" and note that publish echoes the parent's values as subject
  identity, not as a fresh observation.

### CC-N-06 — Time-grammar mismatch between builder scope and review binding fails closed

- **Severity:** low (interoperability, fail-closed) · **Status:** new
- **File/symbol/line:** `source/src/builder/schemas.ts` line 10
  (`dateTime = z.string().datetime({ offset: true })`) and lines 56–57
  (`issuedAt`, `expiresAt`); `windows-managed-candidate-review-verifier.ts`
  lines 15–16 (`time` requires exact `YYYY-MM-DDTHH:MM:SS.mmmZ`) and lines
  115–116 (`time.parse(task.createdAt)`, `time.parse(scope.issuedAt)` inside
  `bind`).
- **Observed fact:** A builder task scope whose `issuedAt`/`expiresAt` use an
  offset or non-millisecond precision is valid under `builderTaskScopeSchema`
  but can never be bound to a review assertion: `bind` throws
  `candidate-review-authentication-denied`. `agent-workflow.ts` compares such
  times with `Date.parse` and would accept them.
- **Why it matters:** Not a security defect (deny direction), but a latent
  false-deny that a consumer author might "fix" by loosening the verifier's
  grammar rather than tightening the scope's.
- **Required correction:** Pin the canonical UTC-millisecond grammar for all
  candidate-path times in the contract and treat any other shape as a producer
  defect.

### CC-N-07 — Two cited producer TAP receipts are not supplied; the contract's own revision differs from the packet's

- **Severity:** low (evidence hygiene) · **Status:** new
- **File/symbol/line:** contract lines 3 and 281–284 (inspected product
  `ac279d2…`; inventory suite 12/12, raw TAP
  `candidate-consumer-contract-inventory-20260913.tap`, SHA-256 `941640a4…`);
  `ONOES_AGENT_DISPATCH_LEDGER_DECISIONS_V2.md` lines 93–97 (focused follow-up
  49/49, raw TAP `candidate-effect-v2-followup-focused-20260913.tap`, SHA-256
  `61ec1dc3…`); `receipts/PRODUCER_EVIDENCE.json` (`phase`: full run precedes the
  `ac279d2` commit; `7060f70` is documentation-only).
- **Observed fact:** Only the full regression TAP (`7b4487b7…`) and the two
  historical 18-test TAPs are supplied. The 12/12 inventory run and the 49/49
  focused run are cited by hash and not present. The `ac279d2 → 7060f70`
  documentation-only claim cannot be checked from the packet, which contains no
  product history. The 49 test names in the supplied ledger test file do all
  appear as `ok` in the full TAP (see §7), which is consistent with, but not
  proof of, the cited focused run.
- **Required correction:** Supply cited TAPs in the packet that cites them, or
  do not cite them by hash. State the `ac279d2 → 7060f70` diff as a producer
  claim.

### CC-N-08 — Prior review follow-ups: disposition on current bytes

- **Severity:** informational · **Status:** resolved but unverified (by
  execution); verified by source reading
- **V2-N-01 (start-barrier race assertion):** resolved. Test lines 309–318 now
  require exactly one `recorded` result, admit `storage-unavailable` only for
  the loser, and check one durable row after reopen, exact winner intent, zero
  events, a row count of one, no losing row for distinct inputs, and exact
  replay of the winner. This is the strict single-winner form the prior report
  asked for.
- **V2-N-07 (Worker message ordering):** resolved in the producer's favour. The
  Node.js v24.14.0 `worker_threads` documentation, fetched by this reviewer on
  2026-09-14, states under the Worker `'message'` event that all messages sent
  from the worker thread are emitted before the `'exit'` event, and under
  `'exit'` that it is the final event emitted by any Worker instance. The
  listener in test lines 331–346 is installed before the worker can exit, and
  the comment cites the same section. The prior finding is withdrawn as a
  reliability concern for the supported runtime. This is documentation-backed
  reasoning, not a runtime probe.
- **V2-N-02 (stale decision document):** resolved by the separately versioned
  successor `ONOES_AGENT_DISPATCH_LEDGER_DECISIONS_V2.md`, which labels the
  historical document, the two run roles and the per-store qualification
  without altering the original bytes.
- **V2-N-03 (receipt role labels):** resolved by
  `receipts/HISTORICAL_RUNS.json` and the in-tree
  `ONOES_AGENT_EFFECT_LEDGER_HISTORICAL_RUNS.json`; both name each TAP's true
  path, phase, duration, counts and hash; both were recomputed and match (§7).
  The two files differ only in packet-local versus product-local provenance
  fields, and agree on every hash and count.
- **V2-N-04 items 1–5:** all present; see §7.1 Q8.
- **V2-N-06 (`storage-unavailable` ambiguity):** now stated as a consumer rule
  in contract §5 row 3. Carried as documented.
- **N-01/N-08, N-02, N-03, N-04, N-05, N-09, N-10, N-11, N-13 item 8:** unchanged
  in the bytes; carried as host or release obligations exactly as the v2
  successor lists them.

### CC-N-09 — Symbolic budgets need a schema decision, not numbers

- **Severity:** low (design) · **Status:** new; see §7.1 Q6
- **Required correction:** Define the resource-policy document whose digest
  `resourcePolicyDigest` already stores, with explicit named ceilings and an
  explicit enclosure rule. Numbers for transfer, overall and parent age remain
  measured release inputs, not review substitutes.

## 7. Verification Results

- **Test command/result:** **NOT RUN.** STATIC_SOURCE scope. No subject module,
  test, helper, script, provider or VM was compiled or executed. Every
  statement about test behaviour is source reading.
- **Probe command/result:** read-only clone of `eOnoes/Audits` at
  `459aa620ae778d2d4f5eb5f2ec39f946b9f5c4be`; digest, byte-length and blob-OID
  recomputation over packet bytes; programmatic extraction of TAP subtest names
  and counts; one public documentation fetch. No writes to any packet member.
- **Hash/manifest comparison:**
  - `MANIFEST.sha256` self-digest over its committed bytes (LF, 47 lines):
    `ef632f43f702c42142d322d4fedd0842b541d034c10008b12c7d7e773f54edf0`.
    **No expected pin reached this reviewer through any channel**; the value is
    recorded for the operator to compare, not verified. (A first clone with the
    host's default CRLF conversion produced a different working-tree digest,
    `69a13289…`; that clone was discarded and all figures here are from
    committed bytes with conversion disabled.)
  - All **47/47** manifest entries recomputed and matched; zero mismatches. The
    only packet file absent from the manifest is `MANIFEST.sha256` itself.
  - `SOURCE_IDENTITIES.json`: `memberCount` 34, 34 members listed; for every
    member `gitBlobOid` (from `git ls-tree`), `byteLength` (tree and disk) and
    `sha256` matched, and each member's `sha256` equals its manifest entry. No
    `source/` or `tests/` file is missing from the identity list.
  - `receipts/PRIOR_LEDGER_V2_REVIEW.md`: SHA-256 `810fcecac5bf…994c2df`,
    40,875 bytes, byte-identical to root `AUDIT_REPORT-1.md` (blob
    `a067bf3f…`) at both `459aa62` and the cited `bb314be`; matches the v2
    successor's citation exactly. Root `AUDIT_REPORT.md` is blob `824c1d96…`,
    67,364 bytes, matching the disposition's citation.
- **Receipt comparison:**
  - `PRODUCER_FULL_REGRESSION.tap`: SHA-256 `7b4487b767c59b8f…fb7b5b6`
    matches `PRODUCER_EVIDENCE.full.sha256`; plan `1..1838`; footer
    `tests 1838 / pass 1836 / fail 0 / cancelled 0 / skipped 2 / todo 0 /
    duration_ms 49109.7181`; zero `not ok` lines; 1,838 top-level subtests. The
    two skips are line 4311 (`symlinked binary paths … # SKIP Windows link
    creation privilege unavailable`) and line 8763 (`managed inspector refuses
    unsupported hosts … # SKIP`), matching the receipt's two stated reasons.
  - All **49** test names derivable from the supplied ledger test file (29
    static plus 20 template-expanded) appear as `ok` in the full TAP. All 10
    manifest-codec, 9 transfer-codec, 6 evidence and 26 VM-verifier test names
    (including the three template-expanded `disk workflow … composition` cases
    and the three Windows-conditional executor compositions) appear as `ok`.
    This is artifact consistency, not independent execution.
  - `HISTORICAL_PINNED.tap`: SHA-256 `119918de…0f35`, 18/18/0, 0 skipped,
    `duration_ms 1185.3941`. `HISTORICAL_PRECOMMIT.tap`: SHA-256
    `a7ecb823…c600`, 18/18/0, 0 skipped, `duration_ms 926.2852`. Both match
    `HISTORICAL_RUNS.json` on path, hash and all six count/duration fields. The
    two files carry an identical ordered list of 18 test names. Three of those
    18 historical names no longer exist in the current 49-test file (they were
    renamed by the v2 follow-ups), which is consistent with
    `appliesToV2Execution: false`.
  - Cited but absent: `941640a4…` (contract inventory 12/12) and `61ec1dc3…`
    (focused 49/49). **Unverifiable.**
- **Scope check:** PASS. Only packet files were inspected; the only reads
  outside the packet directory were root `REPORT_DELIVERY.md` (byte-identical
  to the packet copy), root `README.md`, root
  `EXTERNAL_AUDIT_AGENT_INSTRUCTIONS.md` (grepped for a manifest pin only), the
  two root historical reports (hash comparison only), `git ls-tree` of other
  packets' `reports/` directories (all contain only `README.md`), and the
  workflow-presence check the write contract requires.
- **Workflow/activation check (required before any write):** the repository has
  no `.github/` directory at `459aa62` or on `main` at review time;
  `GET /repos/eOnoes/Audits/actions/workflows` returns `total_count: 0`;
  `GET /repos/eOnoes/Audits/actions/permissions` reports Actions enabled at the
  repository level, which is inert with zero workflow files. A report-only
  commit adding one Markdown file cannot trigger a run. `main` was re-fetched
  after report composition and was still `459aa62`.
- **Unexpected output or failure:** `git show HEAD:<path>` failed with
  "Filename too long" for four members on the first clone; resolved by
  `core.longpaths=true` and by hashing via `git cat-file` on blob OIDs. Not a
  packet defect.

### 7.1 Answers to the ten required consumer-contract questions

**Q1 — Identity binding.** Partially. The ledger intent (state lines 18–29)
binds namespace, store, operation, workflow, approval, kind, workspace, policy,
candidate, review material, source manifest, request, guest image, guest
generation, controller identity, resource policy and expiry; publish adds
`executionOperationId` and `resultDigest`. `reserve` rejects a foreign
namespace/store before any write (ledger line 170), and `#scan` rejects any row
whose `intent.storeId` differs (line 105). `requestDigest` transitively binds
the request's `operationId`, `requestId`, workspace subject and post-edit file
digests (evidence lines 80–90); `reviewMaterialDigest` transitively binds
`candidateStoreId`, `artifactDigest`, `workProposalDigest` and the full
predicted source (review lines 78–92). What is **not** bound durably: the
candidate store as an object (CC-N-01: a string parameter), the
artifact-versus-proposal distinction (only `candidateDigest` is stored; the
ledger cannot tell an `artifactDigest` from a `workProposalDigest`), the
association between the four subject digests (asserted by the host at reserve
only), and any content of the approval (`approvalId` is a spent UUID with no
envelope digest). `operationId` equality with the request's `operationId`
(contract line 38) is host-checkable through `requestDigest` but not
ledger-checkable. The publish parent check (ledger lines 65–72) is strong for
what it covers: `completed`, `verificationPassed === true`, exact `resultDigest`,
all 13 subject fields including `workflowId` and `storeId`, and reservation not
earlier than the parent's last event. The missing durable authorization
association is the approval envelope digest (and, optionally,
`preparationDigest`), which the contract correctly places in §3 as future work
but whose absence §2 should state plainly.

**Q2 — Can replay, restart, a new ledger instance, storage-unavailable, or
uncertain anchor acknowledgement reach an effect?** Not through the ledger, and
the contract's rules are consistent with the bytes for every cut that ends in
`replayed`, `recorded` or an exception:
- *Replay:* `reserve` returns `replayed` for a byte-identical intent at any
  state, including `completed` and `quarantined` (lines 172–175; tests 56–71,
  626–641); `advance` returns `replayed` for an identical prior event (lines
  192–197). Neither is permission; contract §5 row 1 says so.
- *Restart / new instance:* a new connection discovers durable rows and
  blockers (tests 276–289, 526–540); instance poison does not survive, durable
  history does. Contract §5 row 4 correctly forbids reconstructing dispatch
  capability from saved bytes.
- *storage-unavailable:* `guard` maps every non-ledger exception to it (line
  46). Before `BEGIN IMMEDIATE` succeeds nothing was written and the instance is
  not poisoned (contention test 322–355); after `touched` (line 158) the instance
  is poisoned even if the transaction rolled back. Contract §5 row 3's "do not
  classify as untouched or retryable" is the right consequence.
- *Anchor:* there is no anchor, so "uncertain anchor acknowledgement" is not a
  reachable state in the bytes; every marker is committed without one. Under
  the contract's own rule that an effect requires both ledger commit and anchor
  ack, a crash between them leaves a committed marker with no way to record
  that the effect was never released. That is CC-B-01's second half: the only
  outcome is quarantine.
The crash cuts: (1) after `reserve` commit, before read-back: poison; restart
replays `reserved`; `cancelled` is available. (2) After
`source-delivery-possible` commit, before the first byte: restart replays the
marker; the contract forbids resend; no `cancelled`/`failed` edge exists; only
quarantine. (3) During transfer: same as (2); the receiver's poison is
in-process only. (4) After `launch-possible` commit, before `run`: same;
quarantine. (5) After `run`, before result/Off: verifier `unconfirmed` never
resolves (vm-verifier lines 151–156); quarantine. (6) Controller `run-failed`
with confirmed Off: no result wire; quarantine (CC-B-01). (7) After
`result-and-stop-observed` commit, before terminal: restart replays; the
terminal is derivable from `verificationPassed`; `expired` does not block it
(state line 104–105 exempts terminals; test 150–163). (8) After `completed`,
before publication reserve: safe; publication needs a fresh approval. (9) After
`publication-possible`, before the original write: replay; the contract forbids
a second write; `restored` is available only if the host can establish exact
restoration, otherwise quarantine. No cut reaches an effect from ledger state
alone; several cuts reach permanent workspace retirement, which the contract
should own explicitly.

**Q3 — One execute approval for transfer plus launch; separate publish
approval; no legacy conversion or spent-ID reset.** Yes in the bytes.
`source-delivery-possible` and `launch-possible` are events on one operation
(state lines 107–108); there is no second reserve or consumption between them,
and `approval_identity_digest` is `UNIQUE` (ledger line 18) and re-derived per
scan (lines 114–122). Publish requires a distinct `approvalId` (tests 76–77:
reusing the execute's approval for publish is `approval-reused`) under the same
`workflowId` (`subjectFields`) and one `publish` per workflow (line 22).
`APPROVAL_IDENTITY_DOMAIN` excludes kind, store and record version (state lines
9–11, 85–87; test 357–375), so no phase, alias or store move mints a fresh
spent ID. Legacy capability conversion is **not** detectable by the ledger: any
v4 UUID is an acceptable `approvalId`; strict schemas reject extra keys (test
line 80) but cannot know a UUID's provenance. Rejection of leases, remediation
approvals, MCP grants and compiler brands (contract lines 59–63) is therefore a
host entry-point obligation, correctly placed. Spent-ID reset by a new store is
real and pinned (test 509–524); sole enrollment remains a host gate.

**Q4 — Are source EOF, destination custody, runner authenticity, whole-work
stop and VM Off kept distinct? Is the ordering implementable?** The five are
distinct in the bytes and the contract preserves the distinctions: the receiver's
`finish()` yields `endOfInputDeclared: true, destinationStored: false` and its
comment requires the caller to invoke it only after actual transport
EOF/settlement (transfer lines 48–60, 138–143); destination custody has no
representation anywhere; `parseManagedVerificationResult` validates identity and
ceilings, not origin (evidence lines 98–99); whole-work settlement in the
verifier requires both `runDone` and `stopDone` plus a monotonic read-back
inside the stop budget (vm-verifier lines 143–150), separately from the result's
own `allRelatedWorkSettled: true` literal, which is a runner claim; Off requires
a host-side `vm-controller-stopped/v1` frame followed by a clean close with
exit code 0, no signal and no partial frame (channel lines 74–82). The ordering
is implementable with the existing ledger, codecs, review verifier and lifecycle
verifier, and is **not** implementable with the existing controller channel or
session interface: there is no delivery command, no custody acknowledgement,
and no inbound frame budget for one (CC-N-02). The exact interfaces that must
be new or versioned are the controller-channel wire protocol
(`messageSchema` and its command set, `outputFrames`, a transfer byte budget
separate from `requestBytes`) and `ManagedVmVerificationSession` (a delivery
phase). The 65,536-byte run request and the executor's 5-second step must stay
as they are.

**Q5 — Review-before-verification chronology.** The ordering rule in
`agent-workflow.ts` (lines 299–316) is as the contract states: review time must
be at or before verification time, and builder, reviewer and verifier must be
three distinct actors. A newly dated post-run review therefore fails
`verifierPassed`; a still-valid pre-dispatch review can precede the run and be
revalidated at publication via `assertCurrent` without rewriting `reviewedAt`
(the assertion is deep-frozen and its signed payload is not re-serialised;
review-verifier lines 94, 102–105, 120–126). A new workflow is required where
the contract says it is (line 148–150) because `UNIQUE(workflow_id, kind)` and
`verifiedParent` make a second execution or publication in the same workflow
impossible. Semantic reuse: yes. Wire compatibility: no (CC-N-03). The
historical workflow's schema and type modules are not supplied, so its wire is
verified only as far as `agent-workflow.ts` itself shows.

**Q6 — Do symbolic budgets prevent implementation?** They prevent enabling a
real adapter, not designing or synthetically composing one. The existing
ceilings the contract lists are exactly the bytes: acquisition 30,000 ms and
failed-start stop 10,000 ms (`VM_ACQUISITION_LIMITS`, acquisition line 6);
run-and-stop within `min(60,000, request.timeoutMs)` with stop within 10,000 ms
(`MANAGED_VM_VERIFIER_LIMITS`, vm-verifier lines 29 and 101); request
`timeoutMs` 1,000–60,000 (evidence line 22); 128 files, 1 MiB per file, 16 MiB
total, 128 KiB manifest (manifest lines 11–14); 65,536-byte request (verification
line 16, channel line 15). No transfer deadline, overall deadline or maximum
parent age exists in any byte. The smallest concrete decision is a **schema**,
not a number: define `agent-candidate-resource-policy/v1` as a canonical
document with explicit integer fields (`acquisitionMs ≤ 30000`,
`transferMs`, `launchMs`, `runMs ≤ 60000`, `stopMs ≤ 10000`, `settlementMs`,
`overallMs`, `maxParentAgeMs`), an explicit enclosure rule (each phase may
begin only if `overallMs` minus elapsed exceeds that phase's ceiling plus
`stopMs` plus `settlementMs`), the rule that `overallMs` is a stated value and
never an implicit sum, and `resourcePolicyDigest` as its canonical SHA-256. The
three unknown numbers are then measured before enablement on the real transport,
as the contract already requires. This widens no existing contract, removes no
file and substitutes no median.

**Q7 — Does B-03 remain genuinely OPEN?** Yes, and the packet keeps it open
correctly. Ledger-versus-anchor ordering: the ledger commits each marker
(`#write`, lines 145–167) with `BEGIN IMMEDIATE`, reads back, and returns; there
is no anchor step between commit and return, and no field records that any
external witness saw the commit. Uncertainty windows: (a) commit-to-read-back
(poison; recoverable by discovery); (b) commit-to-anchor-ack (no anchor; every
marker is unwitnessed); (c) anchor-ack-to-effect (a crash here leaves a marker
that an honest host cannot distinguish from an effect that started); (d)
effect-to-observation (verifier `unconfirmed`); (e) observation-commit-to-anchor
(same as b); (f) any window against a file-write adversary, who can roll back,
delete or coherently rewrite (tests 471–507). A MAC or same-disk counter closes
none of (b)–(f) because an older authentic snapshot carries an older authentic
MAC and counter. The minimal separately reviewable protocol, stated without
prescribing an OS mechanism or claiming one exists: an append-only anchor log
held under a principal distinct from the task identity and from the ledger
file's writer, each entry `{storeId, operationId, eventIndex, recordDigest,
previousEntryDigest, sequence}` with a strictly increasing `sequence`, written
**after** the ledger commit and **before** any effect, whose acknowledgement is
a prerequisite for the effect; at discovery, the host compares each operation's
latest ledger record digest to the anchor's latest entry and the anchor's
sequence to the ledger's row count: ledger behind anchor is rollback or
deletion (deny, forensic); ledger ahead of anchor is an unwitnessed marker,
which by construction never released an effect and could be closed by the v3
`aborted` edge proposed in CC-B-01. Spent-ID retention must be carried in the
anchor across rotation, backup and restore. What protects the anchor is a
custody question for a separate review; nothing in this packet supplies it.

**Q8 — New boundary tests.** All seven are present and, by source reading,
falsifying:
1. *Coherent cross-store rewrite acceptance* (test lines 487–507): rewrites
   `storeId` to store B, recomputes `intentDigest`, keeps
   `approvalIdentityDigest`, inserts, asserts `read` returns the rewrite and a
   `publish` reserve is `recorded`. Would fail if store binding became
   authentication.
2. *Two stores, one approval* (509–524): same namespace, same `approvalId`,
   both `recorded`, equal `approvalIdentityDigest`, distinct `intentDigest`,
   each reopened store replays its own and denies a second use as
   `approval-reused`.
3. *Same-connection poison recovery* (526–540): after a post-commit response
   loss, a second `SqliteCandidateEffectLedger` over the same `Database` reads
   the durable row, replays it, denies a same-workspace intent, records a
   different-workspace intent, and the poisoned instance stays poisoned.
4. *Five pragma normalisations* (542–552): `synchronous`, `foreign_keys`,
   `trusted_schema`, `busy_timeout`, `journal_mode` drift denies on the old
   instance and is restored by a new instance's `configure()` (ledger lines
   40–44 set exactly these five).
5. *Sixth pragma denial* (554–560): `ignore_check_constraints=ON` is not reset
   by `configure()` and the constructor denies `durability-invalid`, with the
   pragma still `1` afterwards; `durability()` (lines 34–39) checks it, so the
   asymmetry is real and the test pins it.
6. *v1 row in v2 schema* (562–579): a `schemaVersion: …/v1` record without
   `storeId`, with recomputed digests, inside an intact v2 table denies
   `state-invalid` on all four access paths before and after reopen, leaving
   `version = 2` and the row bytes unchanged.
7. *Strict single-winner race* (291–320): exactly one `recorded`, loser in
   `{replayed | workspace-blocked, storage-unavailable}`, one durable blocked
   row after reopen equal to the winner's intent with zero events, row count
   one, no losing row for distinct inputs, exact replay of the winner.
Each test's assertions are specific enough that deleting the corresponding
source check (or, for 1, 2 and 7, adding an unintended one) would fail it. A
mutation run confirming that is **NOT RUN**.

**Q9 — Historical run roles; full TAP; Worker ordering.** Machine-checkable:
yes. `receipts/HISTORICAL_RUNS.json` names both TAPs by true packet path with
phase, duration, six counts and SHA-256; every field was recomputed and matched
without touching either historical file; the alias entry maps the old
`FOCUSED_TESTS.tap` field to `HISTORICAL_PINNED.tap`, and the older packet path
and commit are retained. The full TAP verifies as an artifact (§7), with 1,838
subtests, 0 failures, 2 skips whose reasons match the receipt, and every test
name from the five supplied test files present as `ok`. This is not independent
execution and is not claimed as such. The Worker ordering finding (V2-N-07) is
reassessed against the fetched Node v24.14.0 documentation and withdrawn
(CC-N-08).

**Q10 — Prioritised minimal next slice.** In order:
1. *Contract corrections, no code:* record the CC-B-01 decision; add the
   CC-N-01 statement; name the new interfaces of CC-N-02; state CC-N-04; adopt
   the CC-N-09 schema; adopt the CC-N-06 grammar rule. These are prerequisites
   for an acceptance contract, not for starting design.
2. *Synthetic composition slice (permitted to proceed after step 1):* a
   host-side sequencer over injected ports only, with the real
   `SqliteCandidateEffectLedger`, the real codecs and verifiers, and synthetic
   anchor, transfer, session and publication ports. Falsifiable controls,
   each asserting exact port call counts and durable read-back: contract §8
   items 1–5 and 9 in synthetic form; crash cuts (1)–(9) from Q2 by throwing at
   each seam and reopening; replay after every terminal calling zero ports;
   anchor-ahead and ledger-ahead discovery outcomes; the CC-B-01 edge, if
   chosen, reachable only with synthetic stop evidence and anchor absence.
   Review prerequisite: an agreed acceptance contract for the synthetic anchor
   and delivery interfaces. Physical prerequisite: none.
3. *Separately authorised, not part of the slice:* the real anchor custody
   review (B-03); the versioned controller-channel protocol and its capacity
   review; the approval envelope and issuer; real key enrollment; the G0-A
   controller/task identity probe; consumer activation; and W1–W5. None of
   these is implied by permission to continue step 2.

## 8. Security and Integrity Review

- **Secrets:** none present in the packet; none required; none emitted.
  `[REDACTED]` was not needed. The review verifier holds public keys only
  (review-verifier lines 7–9, 59–64); the content policy's secret patterns are
  applied to review material and context entries (review line 65, 90;
  agent-workflow line 223).
- **Injection and control content:** ledger inputs pass `assertPassive` before
  any reflection (state lines 49–72: proxies, cycles, exotic prototypes,
  accessors, symbol keys, >4,096 nodes, >16 depth, >512 keys, >32 KiB), then a
  canonical round-trip that must reproduce the input bytes (lines 78–81). The
  codecs snapshot typed arrays through intrinsic getters and reject proxies,
  shared and detached buffers (manifest lines 32–46; transfer lines 17–29;
  tests 114–130, 131–161). The channel bounds chunks, frames and bytes before
  allocation and drains without retaining after any fault (channel lines
  91–116). SQL is parameterised; DDL is compared verbatim to `sqlite_schema`
  (ledger lines 28–33). **Untested by this reviewer.**
- **Authorization:** none exists by design in any supplied module; every
  return value is labelled data, not permission (`recorded-state-not-effect-permission`,
  `authority: "none"`, `approvalAvailable: false`). The gap is the absence of
  a durable envelope (CC-N-01), which the contract defers to §3.
- **Isolation:** no callback runs inside a ledger transaction; the host clock is
  sampled outside it (ledger lines 149–151) and the fixture asserts it (test
  line 30). The lifecycle verifier and channel never spawn, kill or
  authenticate (channel lines 8–12; vm-verifier lines 7–12). The review
  compiler and verifier hold no signer, storage or network.
- **Mutation:** no delete, prune, reset, repair or migration exists; `#save`
  updates three columns and requires `changes === 1` (ledger lines 136–144);
  legacy v1 schemas and rows deny without rewriting (tests 389–399, 562–579).
- **Concurrency:** `BEGIN IMMEDIATE` writers rescan inside the transaction
  (lines 154–160); `busy_timeout` 250 ms is set and re-checked; contention is
  positively observed in the held-lock test; the race test is now strict
  single-winner. Multi-process evidence is Windows-only and author-reported.
- **Provenance:** all 34 identities recomputed and matched; provenance is
  publisher-local by the receipt's own declaration
  (`publisher-local-git-not-independent-bundle`). This review verifies internal
  consistency, not that these bytes are what any build used.
- **Replay:** idempotent replay is keyed on `operationId` plus byte-identical
  canonical intent, or an identical prior event; divergence fails
  `intent-conflict`. Replay never repeats an effect because no effect exists in
  the bytes; the contract's §5 row 1 must remain the consumer's rule.
- **Rollback:** **not defended.** B-03. Coherent forgery, snapshot rollback,
  row deletion and cross-store rewrite are all accepted by the store and are
  pinned as accepted.
- **Fail-closed behaviour:** consistent and aggressive: one foreign or corrupt
  row denies the whole store; one drifted pragma denies every operation; one
  uncertain write poisons the instance; the lifecycle verifier's `unconfirmed`
  never resolves; the channel fails on any stderr byte. The one direction in
  which fail-closed becomes fail-permanent is CC-B-01: every non-result outcome
  after the first marker is absorbing.
- **Time:** ledger time is strict UTC-millisecond and monotonic across
  operations (state lines 16–17; ledger line 156); forward-clock excursions
  deny all earlier writes until time catches up (test 613–624), which is the
  documented N-03 limitation. The review verifier latches its own clock and
  closes on regression (review-verifier lines 71–77). CC-N-06 notes the grammar
  mismatch with the builder scope.

## 9. Limitations and Missing Evidence

1. **No execution.** STATIC_SOURCE. No compile, typecheck, test, helper,
   script, VM, provider or model call. Source reading was never converted into a
   probe result.
2. **No manifest pin.** The separately supplied expected `MANIFEST.sha256` digest
   did not reach this reviewer; the observed committed-bytes digest is recorded
   in §7 for the operator to compare.
3. **Two cited TAPs absent** (`941640a4…`, `61ec1dc3…`); the `ac279d2 → 7060f70`
   documentation-only delta is a producer claim (CC-N-07).
4. **Thirteen not-supplied dependency edges.** `windows-managed-candidate-store`,
   `windows-managed-task-inspection`, `windows-operator-task-preview`,
   `windows-managed-builder-executor`, `agent-workflow-schemas`,
   `agent-workflow-types`, builder `types`, and two test fixtures are unknown.
   Every statement about `Artifact`, `ManagedTaskInspection`,
   `SqliteManagedCandidateStore.readPrivateArtifact`, `BuilderTaskScope`,
   `AgentWorkEvidence` and the executor's 5-second step is limited to what the
   supplied files show at their import boundary.
5. **Producer-reported execution only.** Both receipts self-classify as
   author-reported and not independent. Nothing here upgrades them.
6. **Platform.** All evidence is Windows x64 / Node 24.14.0. No POSIX, no
   physical index corruption, no power loss, no protected storage, no guest,
   no real controller, no real approval, no consumer.
7. **Measurement.** No latency, throughput, transfer-time or record-size
   measurement was taken or reused.
8. **Dependencies.** `package-lock.json` was hash-verified and its
   `better-sqlite3 12.11.1`, `zod 4.4.3`, `typescript 5.9.3` and
   `@types/node 24.13.3` entries read; it was not audited and no dependency was
   installed or inspected.
9. **Documentation fetch.** The Node.js documentation quoted in CC-N-08 was
   fetched once over public HTTPS on 2026-09-14 and read as data; its content
   is that site's, not this packet's.
10. **Composition.** The wider product, installer, protected storage, real
    controller, anchor custody and every consumer entry point are outside this
    packet and unreviewed.

## 10. Required Next Action

Minimal, ordered:

1. **Fix (contract, no code):** record the CC-B-01 decision (a versioned v3
   `aborted` terminal with evidence gates, or explicit permanent workspace
   retirement plus a reviewed forensic/replacement procedure). Add the CC-N-01
   statement that candidate-store identity, artifact-versus-proposal and
   approval content are host obligations with no v2 ledger field. Name the
   versioned controller-channel protocol and session interface of CC-N-02.
   State CC-N-04. Adopt the resource-policy schema of CC-N-09 and the time
   grammar of CC-N-06.
2. **Audit again:** the corrected contract, plus the synthetic anchor and
   delivery interface acceptance contracts, before the synthetic sequencer is
   written. That review needs no new production code and no execution.
3. **Then permitted:** the synthetic composition slice of §7.1 Q10 step 2, with
   its listed controls, on synthetic ports only.
4. **Separately authorised, before any activation:** anchor custody design and
   review (B-03); real channel protocol and capacity review; approval envelope
   and issuer; independent (non-producer) execution of the supplied suites;
   W1–W5.
5. **Intentionally excluded and to remain so:** the wider product, installer,
   VM, protected storage, credentials, live approvals, providers, deployment,
   any migration or repair path for v1 data, and any widening of the 5-second
   executor step or 65,536-byte request limit.

## 11. Explicit Non-Claims

This report does **not** certify: formal acceptance of the proposed consumer
contract; production readiness; readiness for live-model, provider or consumer
activation; public-release readiness; or the Windows W1–W5 release criteria,
which remain unfulfilled. It does not certify that the supplied bytes are what
any build, test run or product revision used, only that they are internally
consistent with the supplied identities and receipts. It does not certify any
test result: no subject test, helper or script was executed, and every
producer-reported run remains author-reported. It does not certify the absence
of physical index corruption, power-loss, POSIX or protected-host behaviour. It
does not certify that coherent forgery, snapshot rollback, row deletion or
cross-store rewriting are detectable; they are not, and B-03 remains open. It
does not certify the behaviour of any not-supplied module, the real controller,
the guest, the anchor or any consumer entry point. It confers no permission to
invoke any effect, transfer any source, launch any VM, obtain or spend any
approval, or write any original: every value the audited modules return is
recorded state or parsed data, not authorization.

---

```text
MODEL_ID: Claude Fable 5.1 (claude-fable-5-1), as presented to this session; no prior involvement with this project or its prior reports
ROUTE: operator-mediated public GitHub reading; read-only clone and read-only API metadata of eOnoes/Audits; one public fetch of Node.js v24.14.0 worker_threads documentation; no provider or model call from the repository
AUDITED_REVISION: publisher source 7060f7058ae0c2febf3cf9d5b1efb3b3169f9dba; packet commit 459aa620ae778d2d4f5eb5f2ec39f946b9f5c4be; contract-declared inspected product ac279d223df8defcae9dc85ff7cc32ea5f89239d (documentation-only delta, unverifiable from packet)
IMPLEMENTATION_VERDICT: NEEDS_CHANGES
SECURITY_VERDICT: NEEDS_REVIEW
EVIDENCE_VERDICT: PARTIAL
BLOCKING_FINDINGS: 2 (CC-B-01 new: frozen v2 state graph cannot record the contract's confirmed-failure/abort outcomes, only absorbing quarantine; B-03 carried: no protected freshness or anti-rollback anchor)
NONBLOCKING_FINDINGS: 9 (CC-N-01 … CC-N-09; CC-N-08 records V2-N-01, V2-N-02, V2-N-03, V2-N-04 and V2-N-07 as resolved on current bytes and documentation)
TEST_RESULTS: NOT RUN (STATIC_SOURCE). Receipts verified as artifacts only: PRODUCER_FULL_REGRESSION.tap 1838/1836/0 fail/2 skip, hash-matched, all 100 supplied test names present as ok; HISTORICAL_PINNED 18/18 at 1185.3941 ms and HISTORICAL_PRECOMMIT 18/18 at 926.2852 ms hash- and count-matched to HISTORICAL_RUNS.json; two cited TAPs (941640a4…, 61ec1dc3…) not supplied
SCOPE_RESULT: PASS — packet-only inspection; 47/47 manifest members and 34/34 source identities recomputed and matched; no execution, build, install, provider call, credential, workflow or packet mutation
PLATFORM_LIMITATIONS: Windows x64 / Node 24.14.0 producer evidence only; no POSIX, physical corruption, power-loss, protected storage, guest/VM, real controller, anchor or independent execution; 13 not-supplied dependency edges; expected MANIFEST.sha256 pin not supplied (observed ef632f43f702c42142d322d4fedd0842b541d034c10008b12c7d7e773f54edf0)
ADVANCEMENT: NO
NEXT_REQUIRED_ACTION: Record the CC-B-01 state-graph decision and the CC-N-01/02/04/06/09 statements in the contract, re-review the corrected contract with the synthetic anchor and delivery interface acceptance contracts, then and only then begin the synthetic composition slice on injected ports. B-03 custody and anchor design remain the gate for activation.
```
