# Audit Report — Onoes-Agent consumer successor recovery/anchor/delivery acceptance / onoes-agent-consumer-successor-fdf413aa0c7b-design-v2

## 1. Executive Summary

This is a targeted DESIGN + STATIC_SOURCE review of the successor contract
(`ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V2.md`) and its intake disposition at
publisher revision `fdf413aa0c7b8ed0972e5633302d59b3eac04957`, packet commit
`9c546c8e738418dc5273f7ca4bcb4ef14907bb8e`. **Disclosure first: this reviewer
authored `receipts/CONSUMER_V1_REVIEW.md`, which is a supplied input to this
audit.** That report's suggestions were re-derived from source here rather than
assumed, and two of its claims are found wrong and are withdrawn (§6, SC-N-10).
Packet integrity is complete: all 37 manifest entries, all 22 source identities
and all four raw TAPs verify byte-exactly, and `LEDGER_TEST_DELTA.patch` applied
to the immutable predecessor blob reproduces the supplied test file to the exact
recorded SHA-256. The source delta is accurate in all 22 claims: 19 files
unchanged, two documents new, one test file changed. The successor is
substantively stronger than the draft it replaces — its settlement-evidence list
is well constructed, it correctly refuses to let absence of a result, an anchor
or an acknowledgment stand as proof that no effect occurred, it declines to
migrate or reinterpret v2, and its statement that the existing verifier's run
allowance already includes stop is accurate against the bytes. One blocking
design gap remains. The workspace-exclusion release predicate is not durable:
the contract's own table permits a ledger terminal that is "releasing" while the
host is required to withhold release pending anchor and custody facts that no
row records, so a restarted or fresh host reading the ledger alone would permit
a new workflow on a workspace whose prior work was never established as settled.
That is precisely the failure CC-B-01 was raised to prevent, and it applies to
existing v2 `completed`/`restored` as well as to the proposed v3 terminal.
B-03 remains OPEN and correctly so. **Advancement to activation is blocked.**
The injected-port sequencer slice may proceed, scoped to the unchanged v2 ledger
and synthetic ports; the v3 record schema should wait for SC-B-01. No subject
test, helper, script, provider or VM was executed.

## 2. Audit Identity

- **Audit ID:** `onoes-agent-consumer-successor-fdf413aa0c7b-design-v2`
- **Project:** Onoes-Agent consumer successor recovery/anchor/delivery acceptance
- **Auditor/model:** Claude Opus 5 (`claude-opus-5`), as presented to this
  session by the operator's Claude Code client. **Prior involvement — material,
  disclosed:** this same conversation, running under a different model
  (Claude Fable 5.1), produced the report now supplied as
  `receipts/CONSUMER_V1_REVIEW.md` (61,296 bytes, SHA-256
  `99a9d21bb0dc7cabfb64d8c5b57da6d514c2f994c36af7e81492b18ef2f5b6cf`,
  recomputed here and matching both the packet copy and the byte/hash row in the
  intake disposition). This is therefore **not an independent second opinion on
  the prior report's own conclusions.** To limit that bias the successor was
  evaluated against current source and receipts directly; every prior-report
  claim relied upon here was re-derived; and the publisher's two explicit
  disputes with the prior report were adjudicated against the bytes and are
  **resolved in the publisher's favour** (SC-N-10). The operator should treat a
  genuinely independent review of the prior report's own analysis as still
  outstanding. This reviewer authored no packet member, no contract, no
  disposition and no test, and has no access to the publisher workspace or
  private product.
- **Route/provider:** operator-mediated GitHub review: ordinary read-only
  `git clone` and `git fetch` of `eOnoes/Audits`, read-only GitHub API metadata
  (Actions permission state, workflow count). No provider or model call was made
  from the repository. No external fetch was required for this packet.
- **Audit type:** DESIGN + STATIC_SOURCE targeted successor; not activation
- **Date/time UTC:** 2026-09-14T02:52:45Z (reviewer environment clock)
- **Audited revision:** publisher source
  `fdf413aa0c7b8ed0972e5633302d59b3eac04957`; packet commit
  `9c546c8e738418dc5273f7ca4bcb4ef14907bb8e` (tip of `main` at review time);
  producer run revision `a3fc968662a825a56cbb11b326e69d11f483d1d4`; declared
  baseline `7060f7058ae0c2febf3cf9d5b1efb3b3169f9dba` at packet
  `459aa620ae778d2d4f5eb5f2ec39f946b9f5c4be`

## 3. Scope and Method

- **In scope:** packet directory
  `onoes-agent-consumer-successor-fdf413aa0c7b-design-v2/` only: the successor
  contract, the intake/disposition document, the historical v1 contract as
  context, the 17 supplied `src/` modules, the changed ledger test and three
  helpers, all receipts including four raw TAPs and the test delta patch, and
  the report-output contract. Baseline comparison was limited to the
  `selectedMembers` blobs of the immutable predecessor packet, as SCOPE permits.
- **Exclusions:** private and wider product; any real v3, anchor, issuer,
  controller or consumer implementation; VM; credentials; OS configuration;
  providers; installer; production activation; subject execution. The Kimi
  report is not a supplied member and was not treated as an input; this review
  makes no finding about it beyond what the disposition itself records.
- **Files inspected:** all 37 manifest members. Read in full with line
  references: `AUDIT_REQUEST.md`, `SCOPE.md`, `REPORT_DELIVERY.md`,
  `reports/README.md`, `receipts/DELIVERY.json`,
  `receipts/PRODUCER_EVIDENCE.json`, `receipts/SOURCE_DELTA.json`,
  `receipts/SOURCE_IDENTITIES.json`, `receipts/LEDGER_TEST_DELTA.patch`,
  `source/docs/handoff/ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V2.md`,
  `source/docs/handoff/ONOES_AGENT_CANDIDATE_CONSUMER_REVIEW_DISPOSITION.md`,
  and the changed regions of
  `tests/tests/unit/windows-candidate-effect-ledger.test.ts`. The four TAPs and
  `receipts/CONSUMER_V1_REVIEW.md` were verified programmatically and read in
  the parts relied upon. `receipts/DEPENDENCIES.json` was read by status
  summary. The 17 `src/` modules are byte-identical to the predecessor packet
  audited by this conversation and were re-read at the specific lines cited in
  §5–§7 rather than re-audited in full, as SOURCE_DELTA and the request permit.
- **Commands/probes run:** `git clone`, `git fetch`, `git rev-parse`, `git log`,
  `git ls-tree`, `git cat-file`, `git show`, `git apply`, `git branch`,
  `git checkout --detach`, `sha256sum`, `sha256sum -c`, `diff`, `cmp`, `comm`,
  `wc`, `grep`, `xxd`, `ls`, `date -u`; two Python scripts recomputing member
  digests, byte lengths, blob OIDs, delta claims, TAP footers and test-name
  coverage; `gh api repos/eOnoes/Audits/actions/permissions` and
  `.../actions/workflows`. The clone used `core.autocrlf=false` and
  `core.longpaths=true`; one earlier default-conversion clone was discarded and
  contributed no figure to this report. Patch application was re-run with
  `core.autocrlf=false core.eol=lf` after an ambient-config line-ending artifact
  was detected and diagnosed (§7).
- **Cost/mutation controls:** no build, compile, install, test, helper, script,
  VM, provider or model call; no GitHub Actions or hosted runner (zero workflow
  files; see §7); no branch, PR, merge, force-push or deletion on any remote; no
  edit to any packet member. One purely local branch ref was created in the
  disposable reviewer clone to preserve an earlier unpushed report commit; it
  was never pushed and touches no frozen input. The only prepared write is this
  report at the exact path named in the request. No secret was present,
  requested or emitted.

## 4. Verdict

```
IMPLEMENTATION_VERDICT: NEEDS_CHANGES
SECURITY_VERDICT: NEEDS_REVIEW
EVIDENCE_VERDICT: PARTIAL
ADVANCEMENT: NO
```

`NEEDS_CHANGES` applies to the successor contract as the reviewed object, for
SC-B-01 alone; every other question is answered affirmatively or with
nonblocking corrections. The supplied source bytes are unchanged from the
predecessor packet and are not re-rated here. `ADVANCEMENT: NO` denies
activation, real approvals, real transfer, guest execution, original writes and
any real v3 store. It does not deny the injected-port sequencer slice, whose
scoped permission is stated in §7.1 Q6 and in the final fields.

## 5. Blocking Findings

### SC-B-01 — Workspace-exclusion release is gated on facts no durable record carries

- **ID:** SC-B-01
- **Severity:** blocker (for acceptance of the successor's state decision and
  for the v3 record schema; not a defect in the unchanged v2 bytes, which
  behave exactly as their tests assert)
- **File/symbol/line:**
  `source/docs/handoff/ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V2.md` line 22
  ("execute-only absorbing terminal"), lines 54–55 ("Only after terminal commit,
  matching anchor acknowledgment and independently checked safe custody may the
  host release workspace exclusion"), line 150 (table row: "Terminal commit
  without confirmed anchor | Withhold success/publication and workspace-fence
  release, **even if DB terminal is releasing**"), lines 154–155 (same
  obligation extended to existing v2 `completed`/`restored`);
  `source/src/build-only/windows-candidate-effect-state.ts` lines 91–93
  (`candidateEffectBlocked` is a pure function of the last event's state) and
  line 37 (`events` capped at six);
  `source/src/build-only/windows-candidate-effect-ledger.ts` line 139
  (`blocked` column is `Number(candidateEffectBlocked(record))`), line 179
  (reserve denies `workspace-blocked` purely from that predicate), line 109
  (scan requires the column to equal the recomputed predicate).
- **Observed fact:** In the audited implementation, workspace exclusion is
  derived solely from the record's last state: `completed`, `failed`, `restored`
  and `cancelled` release it, everything else retains it, and the stored
  `blocked` column must equal that recomputation or the whole store denies. The
  successor places two additional preconditions on release — a matching anchor
  acknowledgment and an independently checked safe custody result — and then
  states plainly at line 150 that the database terminal may be "releasing" while
  those preconditions are unmet. Neither precondition has a field, an event, or
  any other durable representation in the record the contract declines to
  change. The proposed terminal is also declared *absorbing*, so no later event
  could record the missing facts even in v3.
- **Why it matters:** The two predicates can disagree, and only one of them is
  durable. A host that crashes, is fenced, restarts, or is replaced by a new
  owner reads the ledger and sees a releasing terminal; the anchor
  acknowledgment and custody check live only in the memory of the process that
  is gone. Under the successor's own sequencing that host may then reserve a new
  execute operation on a workspace whose prior guest work, source custody and
  task generation were never independently established as settled. That is the
  exact hazard CC-B-01 was raised about — unknown work releasing exclusion —
  relocated from the state graph to the release predicate. The finding is
  broader than the new terminal: lines 154–155 apply it to v2 `completed` and
  `restored`, so it is a live gap in any anchor-gated consumer over the current
  ledger, not only in the proposed successor domain.
- **Reproduction/probe:** Source reading only. The v2 half of the boundary is
  pinned by the two new regressions (`v2 no-result stop after
  source-delivery-possible …` and `… after launch-possible …`), which assert
  that quarantine is absorbing and retains the blocker across a real database
  close and reopen. No test exists, or could exist in v2, for the proposed
  release predicate. **NOT RUN** by this reviewer.
- **Required correction:** Make the release predicate durable and
  state-derived, so a fresh reader reaches the same answer as the process that
  performed the release. Smallest form: in the v3 domain, keep
  `stopped-without-result` non-releasing, and define one further
  non-absorbing-to-absorbing step — a `released` (or `custody-cleared`) event
  carrying the settlement-evidence digest and the anchor checkpoint identity —
  with `candidateEffectBlocked` releasing only at that event. The execute path
  currently uses four events, so a fifth fits the existing six-event ceiling
  without changing it. If instead release is to remain host-side, then the v3
  predicate must treat every terminal as blocking in the store, the ledger's
  workspace index must be documented as advisory only, and the contract must
  require the host to consult the anchor before every reserve — a larger change
  that also alters how the unchanged v2 store may be used. Either way, delete or
  qualify the "even if DB terminal is releasing" allowance at line 150, and
  state which predicate is authoritative.
- **Status:** new

### B-03 — No protected freshness or anti-rollback anchor (carried, still OPEN)

- **ID:** B-03 (identifier retained)
- **Severity:** blocker for activation; not a defect in the audited bytes
- **File/symbol/line:** contract lines 105–157 (§3, acceptance obligations only);
  `windows-candidate-effect-ledger.ts` lines 11–12 and 103; pinned by the
  unchanged tests `coherent in-store forgery is accepted` and `coherent
  cross-store rewrite is accepted`.
- **Observed fact:** No anchor backend, interface, port or protocol exists in
  any supplied byte. The record digest remains an unkeyed SHA-256 over data the
  file writer controls. §3 defines obligations and explicitly declines to select
  a backend, and the request confirms B-03 stays OPEN.
- **Why it matters:** Every effect gate in the successor depends on an anchor
  acknowledgment that nothing yet provides; rollback, deletion and coherent
  rewriting remain undetectable.
- **Reproduction/probe:** the packet's own unchanged negative controls.
  **NOT RUN.**
- **Required correction:** none inside the audited bytes. The specific protocol
  decisions still missing are listed in §7.1 Q2 and in SC-N-01 through SC-N-03;
  they are narrower than "a backend is absent".
- **Status:** previously documented; still open; correctly labelled OPEN by the
  contract, the disposition and the request

## 6. Nonblocking Findings

### SC-N-01 — The anchor does not fence a superseded owner generation

- **Severity:** medium (protocol) · **Status:** new
- **File/symbol/line:** contract lines 112–114 (entries bind owner generation),
  lines 125–128 (synthetic ports model compare-and-append with an expected prior
  checkpoint), lines 136–139 (a new owner "first fences the old one and
  reconciles the unresolved pair").
- **Observed fact:** Fencing is described as something the new owner does to the
  old owner on the ledger and effect side. Nothing states that the **anchor**
  rejects an append presented by a generation that is no longer current. An
  append is accepted on the strength of a matching expected prior checkpoint,
  which a fenced-but-still-running old owner may well hold.
- **Why it matters:** A delayed old owner could append a checkpoint and receive
  an acknowledgment it treats as its remaining effect permission, or interleave
  with the new owner and corrupt the chain the new owner is reconciling. The
  anchor is the one component specifically intended to survive a compromised or
  confused host, so owner-epoch enforcement belongs there.
- **Required correction:** Give the anchor an owner epoch claimed by
  compare-and-swap. Every append carries the owner generation; the anchor denies
  any append whose generation is not the current epoch, and epoch advance is
  itself an anchored, append-only event. State that acquiring the epoch is the
  first step of ownership, before any ledger mutation.

### SC-N-02 — Inventory root construction is deferred, and the anchor never validates it

- **Severity:** medium (protocol) · **Status:** new
- **File/symbol/line:** contract lines 115–117 (inventory root and operation
  count bound; "Canonical formats and root construction are separately reviewed
  protocol inputs, not an implemented hash tree"), lines 119–123.
- **Observed fact:** Deletion detection rests entirely on the complete-inventory
  root, whose construction is explicitly deferred. Separately, the host computes
  the root and the anchor stores it; the anchor cannot check it against a ledger
  it does not read. The property delivered is therefore tamper-**evidence** to a
  later honest reader with an authenticated fresh anchor history, not tamper-
  proofing at append time.
- **Why it matters:** Deferral is reasonable for a design document, but the
  deferred item is the load-bearing one for the deletion case the contract
  correctly says row-presence discovery cannot cover. And the honest-reader
  qualification should be stated, so no later document claims the anchor
  "prevents" rollback.
- **Required correction:** Specify, before implementation: the domain separator;
  the exact per-operation tuple entering the root (operation identity, latest
  event index, latest record digest, terminal and spent-approval status); the
  canonical ordering; the empty-store representation; whether the root in entry
  N covers the state including entry N; and the archive-boundary rule. Add one
  sentence stating that the anchor orders and retains a host-claimed root and
  does not verify it, so the guarantee is tamper-evidence on authenticated fresh
  read.

### SC-N-03 — Reconciliation has no stated exit for a lost terminal acknowledgment

- **Severity:** medium (protocol) · **Status:** new
- **File/symbol/line:** contract lines 126–127 ("exact duplicate acknowledgment
  without a new entry, conflicting replay denial"), lines 132–139 (serialized
  pair, do not begin a subsequent mutation while unresolved), line 150.
- **Observed fact:** The unresolved ledger/anchor pair must be reconciled by a
  new owner after fencing, but the permitted action is not named. If the anchor
  shows the checkpoint, the pair resolves by observation. If it does not, the
  only way forward is to re-present the same checkpoint — which the duplicate-
  acknowledgment rule already makes safe — yet the contract never says that
  re-append is permitted, and elsewhere forbids compensating writes.
- **Why it matters:** Without an explicit exit, an honest host that loses a
  terminal acknowledgment has a store it may never mutate again, which converts
  a transient failure into the permanent retirement the successor set out to
  avoid.
- **Required correction:** State that idempotent re-append of the exact
  unresolved checkpoint, after acquiring the owner epoch and fencing, is the
  only anchor write permitted during reconciliation, and that it is not a
  compensating write. Define the bounded retry count and what happens when it is
  exhausted.

### SC-N-04 — Delivery grammar: no failure frame is named, and the transfer budget is exactly derivable

- **Severity:** medium (interface) · **Status:** new
- **File/symbol/line:** contract lines 172–174 ("Budget at least ready, stored,
  result-or-run-failure, stopped as distinct inbound messages; derive exact
  maxima from the reviewed grammar including failure paths"), lines 169–170
  ("OCS1 bytes have their own transfer budget");
  `windows-managed-vm-controller-channel.ts` lines 13–16
  (`outputFrames: 3`, `chunkBytes: 65_536`, `requestBytes: 65_536`);
  `windows-candidate-source-transfer.ts` lines 11–14
  (`wireBytes = totalBytes + 44 * files`).
- **Observed fact:** Four inbound kinds are named, but no **delivery-failure**
  inbound message is among them, so a controller that cannot store the source
  has no way to say so and the host must infer failure from a timeout. That
  leaves the exact inbound maximum undetermined at four or five. Separately, the
  outbound transfer budget is not an open release input at all: the OCS1 wire
  length is fully determined by the pinned manifest as
  `manifest.byteLength + fileCount * 44`, bounded by the existing constant at
  16,777,216 + 5,632 = **16,782,848 bytes**.
- **Why it matters:** An unnamed failure path becomes a timeout in the
  implementation, which is the weakest possible signal and collides with the
  contract's own rule that a timeout proves nothing. And leaving a derivable
  constant "open" invites a later reviewer to treat it as a measured value.
- **Required correction:** Either add a `delivery-failed` inbound kind bound to
  the operation, manifest and generation, fixing the inbound budget at five, or
  state explicitly that delivery failure is signalled only by absence of the
  stored acknowledgment within `transferMs` followed by stop, fixing it at four.
  State the outbound transfer budget as the derived value above rather than as
  an unselected input.

### SC-N-05 — The stored acknowledgment should bind a destination-recomputed digest, not bytes and counts

- **Severity:** medium (interface) · **Status:** new
- **File/symbol/line:** contract lines 170–172 ("binds those identities,
  complete bytes/counts, physical destination custody and read-back");
  `windows-candidate-source-manifest.ts` lines 16–17 (per-file `contentDigest`),
  lines 136–149 (`copyCandidateSourceFile` proves one copy only);
  `windows-candidate-source-transfer.ts` lines 145–149
  (`endOfInputDeclared: true, destinationStored: false`).
- **Observed fact:** The acknowledgment is specified to bind identities, byte
  and file counts, custody and "read-back", but read-back is not tied to any
  digest the host can compare. Counts alone are satisfied by a destination that
  wrote the right number of wrong bytes.
- **Why it matters:** The whole purpose of separating stored from
  `endOfInputDeclared` is to get a fact about the destination's bytes rather
  than the transport's. A count is a fact about the transport.
- **Required correction:** Require the acknowledgment to carry a
  destination-recomputed value over bytes re-read from the destination — either
  the per-file digests or a single canonical root over them — and require the
  host to compare it to the pinned `manifestDigest` subject before any launch
  marker. Keep the existing statement that this authenticates neither the
  controller nor physical custody.

### SC-N-06 — The envelope/intent digest binding is circular as written

- **Severity:** medium (design) · **Status:** new
- **File/symbol/line:** contract lines 76–79 ("The future versioned
  envelope/intent association must durably bind … exact complete authorization
  content"), read against the v1 draft's requirement that the envelope bind "the
  complete immutable ledger intent"; house pattern in
  `windows-managed-verification-evidence.ts` lines 89–90,
  `windows-managed-candidate-review.ts` lines 90–92,
  `windows-managed-verification-launch-contract.ts` lines 57–59.
- **Observed fact:** If the v3 intent gains an authorization digest field and
  the envelope in turn binds the complete intent, neither value can be computed:
  each is an input to the other. The text does not resolve the direction.
- **Why it matters:** This is the one place where an implementer would discover
  the problem only after choosing a schema, and the fix is free if stated now.
  The codebase already solves it three times in the same idiom.
- **Required correction:** Adopt the existing house pattern explicitly: the
  envelope signs a domain-separated canonical **intent core** — every v3 intent
  field except the authorization digest — the intent then carries
  `authorizationDigest`, and `intentDigest` is computed over the complete intent
  including it. One sentence, and it also fixes the ordering question of which
  value the issuer validates.

### SC-N-07 — The resource policy has no budget for the anchor round trip

- **Severity:** medium (design) · **Status:** new
- **File/symbol/line:** contract lines 188–191 (field list: acquisitionMs,
  transferMs, launchMs, runMs, stopMs, settlementMs, overallMs, maxParentAgeMs),
  lines 197–200 (phase-entry reserve rule), line 128 ("All anchor calls occur
  outside SQLite transactions").
- **Observed fact:** The anchor append and acknowledgment now sit on the
  critical path before every effect and before every release, and are explicitly
  serialized across the whole enrolled store. No policy field bounds that round
  trip, and the phase-entry reserve rule does not account for it.
- **Why it matters:** A slow, retrying or hung anchor consumes the overall
  budget invisibly, and the "sufficient remainder" test at each phase entry will
  pass on arithmetic that omits the one call most likely to stall. The
  serialization requirement makes this worse: a single stalled pair blocks every
  other operation in the store.
- **Required correction:** Add explicit `anchorAppendMs` and
  `anchorDiscoveryMs` fields with the same positive-safe-integer rules, include
  the applicable anchor allowance in every phase-entry reserve, and state the
  bounded behaviour when the anchor allowance is exhausted (latch closed,
  reconcile; never proceed).

### SC-N-08 — The verifier-wrapper reserve understates worst-case wall time by the stop budget

- **Severity:** low (arithmetic) · **Status:** new
- **File/symbol/line:** contract lines 194–195 ("Run allowance includes stop, as
  the current verifier does"), lines 198–200 ("For the existing verifier wrapper
  reserve runMs + settlementMs, since runMs already includes stop"), line 201;
  `windows-managed-vm-verifier.ts` line 101 (`deadline = started +
  min(runMs, request.timeoutMs)`), line 126 (run timer fires at that bound and
  calls `stopOnce`), line 114 (stop timer is then armed for a further `stopMs`),
  lines 147–150 (success requires `now < deadline`), line 155 (uncertain path
  returns a promise that never settles).
- **Observed fact:** The contract's **acceptance** claim is correct and was
  verified: a successful result requires the monotonic read-back to be strictly
  before the run deadline, so run and stop together are accepted only within
  `min(runMs, request.timeoutMs)`. The **budget** claim does not follow from it.
  On the uncertain path the wrapper can consume the full run deadline and then a
  further `stopMs` before latching `unconfirmed`, so reserving `runMs +
  settlementMs` understates the wall time the host may wait by up to `stopMs`.
- **Why it matters:** Small and bounded at ten seconds, but it is the kind of
  off-by-one-phase that survives into an enclosure proof and then quietly
  permits the overall ceiling to be exceeded.
- **Required correction:** Reserve `min(runMs, request.timeoutMs) + stopMs +
  settlementMs` for the verifier wrapper, and keep the acceptance rule exactly
  as written. Note in the same place that the uncertain path never settles, so
  the independently owned watchdog, not this arithmetic, is what ends the wait.

### SC-N-09 — v2 and v3 coexistence multiplies the sole-enrollment obligation

- **Severity:** low (carried constraint) · **Status:** previously documented
- **File/symbol/line:** contract lines 19–20, 67–69;
  `windows-candidate-effect-state.ts` lines 9–11 and 85–87
  (`APPROVAL_IDENTITY_DOMAIN` deliberately pinned to the v1 domain over
  `{domain, namespaceId, approvalId}`); `windows-candidate-effect-ledger.ts`
  line 18 (uniqueness is per store).
- **Observed fact:** Keeping the approval-identity domain unchanged is correct
  and is what allows a spent identity to be recognised across record versions.
  But uniqueness is enforced only among one store's rows, so a v3 store standing
  alongside a v2 store is a second store: the same approval identity can be
  spent once in each. The contract says a transition needs separate
  retention/enrollment review, which covers this, but does not name it.
- **Required correction:** State in §1 that during any v2/v3 coexistence the
  sole-protected-enrollment obligation extends across **both** domains and that
  the spent-identity history is global to the namespace, not per store.

### SC-N-10 — Two claims in the prior report are withdrawn; the publisher's disputes are upheld

- **Severity:** informational (correction to a supplied input) · **Status:**
  resolved
- **File/symbol/line:** `receipts/CONSUMER_V1_REVIEW.md` §7.1 Q7; disposition
  lines 41–48; contract lines 119–123 and 149.
- **Observed fact and adjudication:** The prior report proposed comparing "the
  anchor's sequence to the ledger's row count", and asserted that a ledger ahead
  of the anchor "by construction never released an effect".
  1. **Sequence versus row count — the publisher is right.** A global append
     sequence counts events; the operations table counts operations, each of
     which advances through up to six events. The two quantities count different
     objects and cannot be compared. The successor's replacement — per-operation
     event index and digest comparison, plus a complete inventory root and
     operation count, kept separate from the global sequence — is the correct
     construction. The prior wording is withdrawn.
  2. **Ledger-ahead does not prove non-effect — the publisher is right.** The
     prior claim silently assumed an authenticated, fresh, complete anchor read
     and an honest, non-crashed host. A stale replica, a suppressed or
     rolled-back anchor entry, or a lost acknowledgment after the entry
     persisted all produce "ledger ahead of observed anchor" while an effect may
     have been released. Since authenticated fresh anchor reads are exactly what
     B-03 does not yet provide, the inference was circular. Contract line 149
     states the correct consequence and this reviewer endorses it on the merits,
     not because it cites the prior report.
- **Required correction:** none for the publisher. Recorded so that neither
  withdrawn claim is carried forward from the supplied prior report.

### SC-N-11 — Prior-finding disposition, verified

- **Severity:** informational · **Status:** resolved but unverified by execution
- **CC-B-01:** confirmed by the publisher and pinned by two new regressions that
  this reviewer verified as source; the successor's answer is partial, see
  SC-B-01.
- **CC-N-01, CC-N-02, CC-N-03:** confirmed and addressed in contract §2 and §4,
  with the residual corrections in SC-N-04 through SC-N-06.
- **CC-N-04:** confirmed and strengthened. The two added assertions are correct
  against the bytes: a same-workflow republish denies `workflow-reused` at
  ledger line 178, and a new-workflow republish denies `execution-unverified`
  because `workflowId` is in `subjectFields` (line 63) and `verifiedParent`
  compares it (lines 65–72).
- **CC-N-05, CC-N-06, CC-N-09:** accepted and correctly restated in contract §2
  and §5.
- **CC-N-07: closed.** Both once-missing TAPs are now supplied and match the
  hashes cited in the predecessor packet exactly — `941640a4…` for the 12-test
  inventory run and `61ec1dc3…` for the 49-test focused run (§7). The inventory
  suite's twelve subtests are source-scanning and import-reachability checks,
  which supports the receipt's own caution that it is "NOT architecture
  validation".
- **CC-N-08:** unchanged; corroborated by source reading only, as the
  disposition correctly states.

## 7. Verification Results

- **Test command/result:** **NOT RUN.** STATIC_SOURCE scope. No subject module,
  test, helper, script, provider or VM was compiled or executed. Every statement
  about test behaviour is source reading.
- **Probe command/result:** read-only clone and fetch of `eOnoes/Audits` at
  `9c546c8e738418dc5273f7ca4bcb4ef14907bb8e`; digest, byte-length and blob-OID
  recomputation; independent re-derivation of every `SOURCE_DELTA` claim against
  the immutable predecessor commit; patch application into a disposable scratch
  directory outside the clone; TAP footer and test-name extraction. No writes to
  any packet member; no network access beyond the public clone and two read-only
  API metadata calls.
- **Integrity acknowledgment (requested first):** **No separately delivered
  expected `MANIFEST.sha256` size and hash reached this reviewer through any
  channel in this session.** Per the request, that is stated rather than
  inferred. The observed values, recorded for operator comparison and not
  verified against any pin: size **4,044 bytes**, 37 entries, SHA-256
  `82b835ac303abcfbb46d21be7e5a673289638fa65a841dbb118f5c9196719475` over the
  committed bytes. The working tree was confirmed byte-identical to the Git
  blobs before hashing, so no CRLF conversion affected any figure in this report.
- **Hash/manifest comparison:**
  - All **37/37** manifest entries recomputed and matched; zero mismatches. The
    only packet file absent from the manifest is `MANIFEST.sha256` itself, and
    no manifest entry is missing from disk.
  - `SOURCE_IDENTITIES.json`: `memberCount` 22, 22 members listed; for every
    member `gitBlobOid`, `byteLength` (tree and disk) and `sha256` were
    independently recomputed and all matched, and each member's `sha256` equals
    its manifest entry. No `source/` or `tests/` file is missing from the list.
    All 22 members carry the single source revision `fdf413aa0c7b…`.
  - `receipts/CONSUMER_V1_REVIEW.md` recomputes to
    `99a9d21bb0dc7cabfb64d8c5b57da6d514c2f994c36af7e81492b18ef2f5b6cf` at 61,296
    bytes, matching both the disposition's `CLAUDE_REPORT_AS_RECEIVED.md` row and
    the report this conversation produced.
- **Source delta verification (independent):** all **22/22** `selectedMembers`
  claims verified against the immutable predecessor packet
  `459aa620ae778d2d4f5eb5f2ec39f946b9f5c4be`: 19 `unchanged` members whose
  baseline blob rehashes to the claimed baseline digest **and** equals the
  current bytes; 2 `new` members genuinely absent from the predecessor's
  identity list; 1 `changed` member whose bytes genuinely differ. Every claimed
  baseline SHA-256 and blob OID also matches the predecessor's own receipt. The
  14 predecessor members not supplied here (including the verification catalog
  and launch-contract modules, four test suites, both tsconfigs and the
  lockfile) are recorded as a scope limitation in §9, not as a defect.
- **Test delta verification:** `LEDGER_TEST_DELTA.patch` applied to the
  predecessor's test blob reproduces the supplied test file **byte-for-byte**,
  hashing to `dedadadc4f4d473b161e9cfaeaa54c9087bcc3280b2e9f953fe3d387a8486f31`,
  exactly the `currentSha256` recorded in `SOURCE_DELTA.json`. An independent
  `diff` of the two files shows the same two hunks and nothing else, so the patch
  is both accurate and complete: 641 lines to 671, two added regressions and two
  added assertions, no deletion or modification of any existing test.
- **Receipt comparison:** all four TAPs verified as artifacts — SHA-256, plan
  line, and every recorded count and duration:

  | Receipt | SHA-256 | Plan | tests/pass/fail/skip/cancel | duration_ms | `not ok` |
  |---|---|---|---|---|---|
  | `CURRENT_FOCUSED.tap` | `a64f8c07…` OK | `1..51` | 51/51/0/0/0 | 3748.9246 | 0 |
  | `CURRENT_FULL.tap` | `213aabd3…` OK | `1..1840` | 1840/1838/0/2/0 | 48608.2745 | 0 |
  | `HISTORICAL_FOCUSED_49.tap` | `61ec1dc3…` OK | `1..49` | 49/49/0/0/0 | 3264.1282 | 0 |
  | `HISTORICAL_INVENTORY_12.tap` | `941640a4…` OK | `1..12` | 12/12/0/0/0 | 1026.4848 | 0 |

  All 51 test names derivable from the supplied ledger test file (29 static plus
  22 template-expanded) appear as `ok` in both current TAPs, with zero missing.
  The two new no-result regression names appear as `ok` in
  `CURRENT_FOCUSED.tap` and `CURRENT_FULL.tap` and are **absent** from both
  historical TAPs, which is the correct and expected relationship. The two skips
  in the full run are the Windows symlink-privilege case and the deliberately
  non-Windows inspector refusal case, matching the receipt's two stated reasons.
  This is artifact consistency, not independent execution.
- **Contract claims checked against source:** the statement that the existing
  verifier's run allowance already includes stop is **accurate** (success
  requires the monotonic read-back to precede `started + min(runMs,
  request.timeoutMs)`); the cited ceilings of acquisition 30,000 ms, run
  60,000 ms and stop 10,000 ms match `VM_ACQUISITION_LIMITS` and
  `MANAGED_VM_VERIFIER_LIMITS`; the three-frame inbound ceiling and
  65,536-byte request limit match `VM_CONTROLLER_CHANNEL_LIMITS`; the claim that
  v2 contains no `candidateStoreId`, `preparationDigest` or envelope digest is
  accurate against the intent schema.
- **Scope check:** PASS. Only packet files were inspected, plus the
  `selectedMembers` blobs of the predecessor packet that SCOPE expressly permits,
  the root `REPORT_DELIVERY.md` (byte-identical to the packet copy), and the
  workflow-presence check the write contract requires. No wider product path,
  VM, installer, credential or provider was touched.
- **Workflow/activation check (required before any write):** the repository has
  no `.github/` directory at `9c546c8` or on `main`;
  `GET /repos/eOnoes/Audits/actions/workflows` returns `total_count: 0`;
  `GET /repos/eOnoes/Audits/actions/permissions` reports Actions enabled at the
  repository level, which is inert with zero workflow files. A report-only commit
  adding one Markdown file cannot trigger a run. The target
  `reports/` directory contains only `README.md`, so this report is a first
  report at the exact named path, not an addendum.
- **Unexpected output or failure:** the first patch-application attempt produced
  a file differing from the supplied one on every line. Diagnosed as CRLF
  conversion from the ambient global Git configuration applying to a scratch
  directory outside the clone, exactly the hazard the request warns about;
  re-running with `core.autocrlf=false core.eol=lf` reproduced the file
  byte-exactly. Not a packet defect, and no figure in this report derives from
  the converted attempt.

### 7.1 Answers to the six targeted successor questions

**Q1 — Does `stopped-without-result` genuinely resolve CC-B-01 without letting
unknown work release exclusion?** Partly, and not yet fully. What is right: the
choice of a separately versioned domain over permanent retirement is the correct
one of the two options the prior report offered, and the refusal to migrate,
reinterpret or let v2 impersonate v3 is unambiguous and is now pinned by two
executed regressions whose source this reviewer verified. The terminal is
execute-only, absorbing, retains `resultDigest: null` and
`verificationPassed: null`, cannot support publication, and does not reopen an
existing quarantine — all correct. The settlement-evidence list at lines 33–43
is the strongest part of the successor: it requires old-owner fencing, accounting
for delivery and run contacts including synchronous throws and partial transfers,
separate host-Off establishment, permanent task-generation retirement, custody
release, proof that execution held no publication authority, and confirmation
against the freshness protocol. Line 45–47 is exactly right that a runner
exception, timeout, AbortSignal, closed pipe, root exit, empty anchor lookup or
caller boolean proves none of it, and that a result may be missing even after an
effect occurred. The **post-effect extension is the more important half** and is
correctly identified as an extension beyond the prior report's narrower
no-effect-only case, correctly marked as needing its own review, and correctly
not treated as authorized by acceptance of that report. Both cases are therefore
addressed in principle: never-released work is covered by the fencing and
contact-accounting clauses, already-attempted work by the custody, generation-
retirement and workspace-safety clauses. What is not resolved is the release
itself. The evidence gates the *terminal*, but the *release of exclusion* is
gated on an anchor acknowledgment and a custody check that no durable record
carries, and line 150 explicitly contemplates a releasing database terminal while
those are unmet. A fresh reader therefore cannot reproduce the release decision.
That is SC-B-01, and until it is fixed the answer to "without allowing unknown
work to release exclusion" is no.

**Q2 — Is the complete-inventory anchor model coherent?** Substantially yes, and
markedly better than what the prior report proposed. The three quantities are now
correctly separated: a **global append sequence** ordering events, a
**per-operation event index and record digest** for history comparison, and a
**complete inventory root with operation count** for deletion detection. The
contract is right that the global sequence must never be compared to the
operations row count, and right that discovering only rows still present cannot
detect deletion — both corrections are upheld against the prior report (SC-N-10).
Denial on a missing expected row, changed digest, substituted installation or
reused sequence is correct. Authenticated fresh discovery, global serialization
of each ledger/anchor pair across the whole enrolled store rather than per
workspace, the requirement that anchor calls sit outside SQLite transactions, and
the explicit note that this is host sequencing rather than a transaction held
across an await are all correct and are implementable against the unchanged
ledger, whose `#write` performs commit and read-back internally and returns
before any anchor call would occur. The cut table is sound, and the
ledger-ahead row states the right consequence. The exact protocol decisions still
missing are: **(a)** anchor-side owner-epoch fencing (SC-N-01); **(b)** inventory
root construction and the fact that the anchor stores an unverified host-claimed
root, making the property tamper-evidence on authenticated fresh read rather than
prevention (SC-N-02); **(c)** the permitted reconciliation write after a lost
terminal acknowledgment (SC-N-03); **(d)** whether the root in entry N covers the
state including entry N, which determines whether the host must read the full
inventory inside the serialized pair; **(e)** the archive and rotation boundary
rule for inventory and spent-identity continuity, given that the ledger caps at
1,000 operations while the anchor grows per event; and **(f)** the bounded anchor
latency budget (SC-N-07). None of these is "a backend is absent"; all are
decidable on paper now. B-03 stays OPEN regardless.

**Q3 — Does the versioned session preserve the four independent facts, and is it
enough to specify synthetic ports?** The four facts are preserved and kept
distinct. Transport EOF stays the receiver's `endOfInputDeclared` with
`destinationStored: false`; destination custody becomes a separate authenticated
stored acknowledgment, and the contract states explicitly that `Receiver.finish`
or a task-produced acknowledgment is insufficient — the correct answer to
CC-N-02. Whole-work settlement and host-Off remain separate, with stop available
from every acquired phase and no forward work after stopping or uncertainty. The
phase list ready → delivering → stored → running → stopping → settled/uncertain
is coherent, the ordering rule that no run may begin before an exact stored
acknowledgment plus a fresh launch marker plus an anchor acknowledgment is right,
and latching each attempt before any reentrant callback matches how the existing
verifier and acquisition modules already behave. Old limits are not widened: the
existing channel and session are kept unchanged, the 65,536-byte run request is
preserved, the full 128-file scope is preserved, and larger run-request support
is explicitly deferred to a new bounded grammar. The required synthetic control
list — missing, truncated and extra source, wrong digest or generation, stored
before EOF, duplicate stored or run, cancellation at each seam, early result,
stopped before stdio settles, stale fulfilled readiness, delayed old-owner
callbacks, each asserting zero subsequent forward calls and exact bounded
cleanup — is sufficient to specify synthetic ports. Two gaps keep it from being
complete: no delivery-failure inbound message is named, leaving the exact inbound
maximum at four or five (SC-N-04), and the stored acknowledgment binds counts
rather than a destination-recomputed digest (SC-N-05). The outbound transfer
budget should be stated as the derived 16,782,848-byte bound rather than left
open. With those three sentences added, the interface is specified well enough to
write injected ports against.

**Q4 — Are the identity, chronology, generation and restoration statements
accurate?** Accurate, with one circularity to fix. The §2 statements match the
bytes: v2 genuinely lacks `candidateStoreId`, `preparationDigest` and any
envelope digest; the candidate store parameter genuinely is a host-supplied
string whose transitive presence in a review hash authenticates nothing; and
`candidateDigest` must indeed mean the saved artifact digest, never the work
proposal digest. Forbidding a bare approval UUID from standing as authority, and
requiring issuer acceptance to validate purpose, consent, revocation and every
field against genuine host objects before reservation, are the right
requirements. Chronology is stated correctly: reuse only the historical
workflow's ordering and three-distinct-actor invariant, give candidate evidence
its own versioned schema binding the review envelope, execute operation, request,
result, measured run and stop interval and authenticated actors, and never cast
a VM result into a historical receipt or invent historical command identifiers —
which matches what the source supports, since the VM result carries no command
identity, actor or time. The UTC-millisecond grammar decision resolves CC-N-06 in
the fail-closed direction, correctly tightening producers rather than loosening
the review verifier. Generation timing is corrected exactly as CC-N-05 asked:
minted at protected acquisition before reserve, with publication echoing the
parent's identities as historical subject bindings rather than fresh
observations, and VM UUIDs and controller echoes explicitly not custody.
Restoration is stated accurately and is now pinned by two assertions this
reviewer verified against the ledger's uniqueness constraint and
`verifiedParent`. Historical approval identity does not reset: the domain stays
pinned to the v1 value over `{domain, namespaceId, approvalId}`, and no v2 spent
identity is forgotten — subject to SC-N-09, since per-store uniqueness means
v2/v3 coexistence widens the sole-enrollment obligation. The one correction
needed before implementation is SC-N-06: as written, the envelope binds the
complete intent while the intent would carry the envelope's digest, which cannot
be computed. The smallest fix is the codebase's own existing pattern — sign a
domain-separated intent core that omits the authorization digest.

**Q5 — Does resource-policy enclosure hold?** Mostly, and the central claim is
verified rather than assumed. Requiring explicit positive safe-integer
milliseconds for every field, with no missing, zero, unlimited, inferred-sum or
implicit-default value, binding the whole document through
`resourcePolicyDigest`, and keeping all arithmetic within safe-integer bounds,
is the right schema-first answer to CC-N-09. The per-phase caps match the source
constants. **Stop is correctly kept inside the current run allowance**: this
reviewer confirmed from the verifier that a successful result requires the
monotonic read-back to fall strictly before `started + min(runMs,
request.timeoutMs)`, so run and stop are jointly accepted within the run
allowance and the contract's instruction not to double-count stop or grant an
extra run budget after transfer is correct. Reserving cleanup and settlement for
the other phases as `phaseMs + stopMs + settlementMs` is right, inclusive expiry
denial and an explicit parent-age cutoff are right, and the statements that
wall-clock timestamps do not extend monotonic deadlines and that JS timers are
not the watchdog are both correct and important. Absent and infinite values are
denied by construction; unsafe arithmetic is denied by the safe-integer rule.
Two gaps: there is no anchor round-trip budget even though the anchor is now on
the critical path and globally serialized (SC-N-07), and the verifier-wrapper
reserve of `runMs + settlementMs` understates worst-case wall time by `stopMs`
on the uncertain path (SC-N-08). The separation the question asks about is
properly drawn: the **schema** is acceptable for synthetic work now, while
concrete transfer, overall and parent-age ceilings and physical resource limits
remain unselected release inputs, enrollment lacking them must be rejected, and
synthetic timing is explicitly not production sizing. This reviewer endorses
that separation and adds that no number appearing in a synthetic test should
ever be promoted into the enrolled policy.

**Q6 — May the injected-port sequencer/data-contract slice be implemented now?**
**Yes for the sequencer, no for the v3 record schema.** The sequencer slice as
the contract scopes it — injected test ports only, over the unchanged v2 ledger,
with exact call counts and durable state at every crash cut, no real approval,
source export, VM or original write — is specified well enough to build, and
nothing in B-03 forbids it: an unresolved physical gate does not prevent
designing test-only ports, and equally no injected success will close that gate.
The v3 record schema should wait, because SC-B-01 is a decision about the
record's own release predicate and implementing the schema first would bake the
ambiguity in. Finite falsifiable acceptance cases for the permitted slice, each
asserting exact port call counts and durable read-back rather than an error
string: authenticated stop missing any single required fact from lines 33–43
denies, once per fact; a fabricated no-effect claim and an empty anchor lookup
each deny; a changed owner or guest generation denies; terminal acknowledgment
loss retains the fence and performs no compensating write; replay of every
terminal invokes zero ports; a fresh workflow after a confirmed non-result
cannot reuse the approval, workflow or result; anchor row deletion, rollback and
coherent rewriting each deny; the ten delivery controls of contract §4; the
crash cuts before and after each of reserve, marker, anchor append,
acknowledgment, first source byte, stored acknowledgment, launch, result, stop
and terminal; ledger-ahead and anchor-ahead discovery each reaching
reconciliation rather than a forward effect or an automatic abort; and a full
success path reaching publication only under its own separate approval. The two
new no-result regressions and the two restoration assertions were checked as
source and are correct against the ledger's transition rules, uniqueness
constraints and parent verification; all four TAP artifacts were verified without
execution. Accordingly **SYNTHETIC_IMPLEMENTATION_READY: YES**, scoped as above
and conditional on the v3 record schema being excluded until SC-B-01 is
resolved; **ACTIVATION_READY: NO**, unconditionally, with B-03, the real anchor
backend, the issuer and envelope, the real channel protocol, independent
execution and W1–W5 all outstanding.

## 8. Security and Integrity Review

- **Secrets:** none present in the packet, none required, none emitted.
  `[REDACTED]` was not needed. The disposition records private report intake by
  hash only and exposes no content of the third-party report beyond its findings.
- **Injection and control content:** unchanged from the predecessor and
  re-confirmed at the cited lines: ledger inputs pass `assertPassive` before any
  reflection and then a canonical round-trip that must reproduce the input
  bytes; the codecs snapshot typed arrays through intrinsic getters and reject
  proxies, shared and detached buffers; the channel bounds chunks, frames and
  bytes before allocation; SQL is parameterised and the DDL is compared verbatim.
  The proposed delivery protocol adds a new inbound kind and a new outbound
  command, both of which must inherit these bounds — the contract says so at
  lines 174–175 (duplicate, unsolicited and out-of-phase frames deny).
  **Untested by this reviewer.**
- **Authorization:** still none, by design, in any supplied module. The
  successor correctly refuses to let a recorded approval UUID, a matching hash,
  a compiler brand or an anchor acknowledgment stand as authorization, and
  correctly defers the envelope and issuer. SC-N-06 is the only structural
  defect in that deferral.
- **Isolation:** the requirement that all anchor calls occur outside SQLite
  transactions preserves the existing no-callback-inside-transaction property,
  which the ledger enforces by sampling the host clock outside the transaction
  and which the test fixture asserts. Global serialization of the
  ledger/anchor pair is a host obligation and is correctly distinguished from a
  transaction held across an await.
- **Mutation:** no delete, prune, reset, repair or migration is introduced. The
  successor explicitly forbids auto-migration, approval reset, quarantine
  reopening, refund and automatic re-dispatch. The test delta adds only
  assertions and removes nothing.
- **Concurrency:** unchanged in the bytes. The new global serialization
  requirement is stricter than the existing per-workspace exclusion and is
  correctly scoped to the enrolled store. The new hazard it introduces — one
  stalled pair blocking the whole store — is unbudgeted (SC-N-07).
- **Provenance:** all 22 identities and all 37 manifest entries recomputed and
  matched; the source delta independently re-derived against an immutable public
  predecessor, which is a materially stronger provenance position than the
  predecessor packet had. Provenance remains publisher-local by the receipt's own
  declaration; the `a3fc968` run revision, the `fdf413aa` source revision and the
  claim that only three documents changed between them are publisher-reported and
  not verifiable from this packet.
- **Replay:** unchanged and correct. The successor adds that replay of every
  terminal must invoke zero ports and that an anchor replay is never permission
  to resume a forward effect — both right.
- **Rollback:** not defended. B-03. The successor's inventory-root model is the
  first construction offered that could detect deletion, subject to SC-N-02.
- **Fail-closed behaviour:** consistently correct in direction throughout the
  successor, and in one place now *less* permanently fail-closed than v2, which
  is the intended improvement. The single place where the contract permits a
  permissive outcome — a releasing database terminal ahead of anchor and custody
  confirmation — is SC-B-01.
- **Chronology and time:** the exact UTC-millisecond grammar decision removes the
  latent false-deny in CC-N-06 in the safe direction. Monotonic deadlines with a
  separate trusted wall-clock validity check are preserved.

## 9. Limitations and Missing Evidence

1. **Reviewer independence.** This reviewer authored the supplied prior report.
   §2 states the mitigations; an independent review of that report's own
   analysis remains outstanding.
2. **No execution.** STATIC_SOURCE. No compile, typecheck, test, helper, script,
   VM, provider or model call. Source inspection was not converted into a probe
   result anywhere.
3. **No manifest pin.** No expected size or hash reached this reviewer; the
   observed values are recorded in §7 for operator comparison.
4. **Product history unverifiable.** The `a3fc968` run revision, the `fdf413aa`
   source revision, and the claim that only three documentation files changed
   between them are publisher-reported. The packet contains no product history,
   and a raw TAP does not prove which revision was executed — a limit the
   producer receipt itself states.
5. **Fourteen predecessor members not supplied.** The verification catalog and
   launch-contract modules, four unit test suites, both tsconfigs, the lockfile
   and four handoff documents are absent from this packet. They are byte-identical
   in the immutable predecessor and were read by this conversation during that
   audit, but SCOPE permits baseline reads only for `selectedMembers`, so no
   finding here rests on them.
6. **Not-supplied dependency edges** remain unknown and were not inferred.
7. **Producer-reported execution only.** All four TAPs self-classify as
   author-reported and not independent. Nothing here upgrades them.
8. **Platform.** All evidence is Windows x64 / Node 24.14.0. No POSIX, no
   physical index corruption, no power loss, no protected storage, no guest, no
   real controller, no anchor, no real approval, no consumer.
9. **Measurement.** No latency, throughput, transfer-time, anchor-latency or
   record-size measurement was taken or reused. The synthetic durations in the
   TAPs are not sizing inputs.
10. **The third-party report** is not a packet member and was not read; this
    review makes no finding about it or about the disposition's assessment of it.
11. **Composition.** The wider product, installer, protected storage, real
    controller, anchor custody, issuer and every consumer entry point are outside
    this packet and unreviewed.

## 10. Required Next Action

Minimal, ordered:

1. **Fix in the contract, no code:** resolve SC-B-01 by making the
   workspace-release predicate durable and state-derived, and remove or qualify
   the "even if DB terminal is releasing" allowance. Add the six protocol
   decisions of §7.1 Q2 (SC-N-01, SC-N-02, SC-N-03, root coverage, archive
   boundary, anchor budget). Add the delivery-failure decision and the derived
   transfer budget (SC-N-04), the destination-recomputed stored digest
   (SC-N-05), the non-circular envelope binding (SC-N-06), the anchor budget
   fields (SC-N-07), the corrected verifier reserve (SC-N-08) and the
   coexistence sentence (SC-N-09).
2. **Then implement, without further review:** the injected-port sequencer over
   the unchanged v2 ledger with synthetic anchor, delivery and policy ports, and
   the falsifiable acceptance cases listed in §7.1 Q6. This does not require the
   v3 record schema and must not implement it.
3. **Audit again, before the v3 record schema is written:** the corrected
   successor, specifically the release predicate, the anchor protocol decisions
   and the delivery grammar. A bounded changed-boundary review, not a full
   ledger re-audit.
4. **Separately authorised, before any activation:** anchor custody design,
   backend selection and review (B-03); the real channel protocol and its
   capacity review; the approval envelope and issuer with real key enrollment;
   measured transfer, overall and parent-age ceilings; independent
   (non-producer) execution of the supplied suites; W1–W5.
5. **Intentionally excluded and to remain so:** the wider product, installer,
   VM, protected storage, credentials, live approvals, providers, deployment,
   any migration or repair path for v1 or v2 data, and any widening of the
   five-second executor step, the 65,536-byte request limit or the 128-file
   source scope.

## 11. Explicit Non-Claims

This report does **not** certify: formal acceptance of the successor contract;
production readiness; readiness for live-model, provider or consumer activation;
public-release readiness; or the Windows W1–W5 criteria, which remain
unfulfilled. It does not certify that the supplied bytes are what any build,
test run or product revision used, only that they are internally consistent with
the supplied identities, delta and receipts, and consistent with an immutable
public predecessor where that comparison was permitted. It does not certify any
test result: no subject test, helper or script was executed, and every
producer-reported run remains author-reported. It does not certify that the
`a3fc968` run revision corresponds to the `fdf413aa` source revision. It does not
certify the absence of physical index corruption, power-loss, POSIX or
protected-host behaviour. It does not certify that coherent forgery, snapshot
rollback, row deletion or cross-store rewriting are detectable; they are not, and
B-03 remains open. It does not certify the proposed v3 terminal, anchor,
delivery session, envelope or resource policy as implemented, reviewed-complete
or safe — all are data reviewed as design. It does not endorse any mechanism on
the ground that a prior reviewer, including this reviewer, suggested it; two such
prior claims are withdrawn in SC-N-10. Because this reviewer authored the
supplied prior report, this document is not an independent second opinion on that
report's own conclusions. It confers no permission to invoke any effect, transfer
any source, launch any VM, obtain or spend any approval, create any real v3
store, or write any original.

---

```text
MODEL_ID: Claude Opus 5 (claude-opus-5), as presented to this session; MATERIAL PRIOR INVOLVEMENT: this conversation authored the supplied receipts/CONSUMER_V1_REVIEW.md under model Claude Fable 5.1 — see section 2
ROUTE: operator-mediated GitHub review; read-only clone/fetch and read-only API metadata of eOnoes/Audits; no provider or model call from the repository; no external fetch required
AUDITED_REVISION: publisher source fdf413aa0c7b8ed0972e5633302d59b3eac04957; packet commit 9c546c8e738418dc5273f7ca4bcb4ef14907bb8e; producer run revision a3fc968662a825a56cbb11b326e69d11f483d1d4; baseline 7060f7058ae0c2febf3cf9d5b1efb3b3169f9dba at packet 459aa620ae778d2d4f5eb5f2ec39f946b9f5c4be
IMPLEMENTATION_VERDICT: NEEDS_CHANGES
SECURITY_VERDICT: NEEDS_REVIEW
EVIDENCE_VERDICT: PARTIAL
BLOCKING_FINDINGS: 2 (SC-B-01 new: workspace-exclusion release is gated on anchor and custody facts that no durable record carries, so a fresh reader cannot reproduce the release decision and the contract itself permits a releasing DB terminal ahead of them; B-03 carried: no protected freshness or anti-rollback anchor)
NONBLOCKING_FINDINGS: 11 (SC-N-01 … SC-N-11; SC-N-10 withdraws two claims of the prior report and upholds both publisher disputes; SC-N-11 records CC-N-07 as closed and every other prior finding as dispositioned)
TEST_RESULTS: NOT RUN (STATIC_SOURCE). Four TAPs verified as artifacts only, all hash-matched with every recorded count and duration reproduced and zero not-ok lines: CURRENT_FOCUSED 51/51/0/0 at 3748.9246 ms; CURRENT_FULL 1840/1838/0/2 at 48608.2745 ms; HISTORICAL_FOCUSED_49 49/49/0/0 at 3264.1282 ms; HISTORICAL_INVENTORY_12 12/12/0/0 at 1026.4848 ms. All 51 supplied ledger-test names present as ok in both current TAPs; the two new no-result regressions present in both current TAPs and absent from both historical TAPs. The two once-missing receipts cited in the predecessor packet are now supplied and match their cited hashes exactly, closing CC-N-07
SCOPE_RESULT: PASS — packet-only inspection plus the permitted predecessor selectedMembers blobs; 37/37 manifest entries, 22/22 source identities and 22/22 source-delta claims independently recomputed and matched; LEDGER_TEST_DELTA.patch reproduces the supplied test file byte-exactly to its recorded SHA-256; no execution, build, install, provider call, credential, workflow or packet mutation
PLATFORM_LIMITATIONS: Windows x64 / Node 24.14.0 producer evidence only; no POSIX, physical corruption, power-loss, protected storage, guest/VM, real controller, anchor, issuer or independent execution; product history between run revision a3fc968 and source revision fdf413aa is publisher-reported and unverifiable from the packet; 14 predecessor members not supplied; expected MANIFEST.sha256 pin NOT received (observed 4044 bytes, 82b835ac303abcfbb46d21be7e5a673289638fa65a841dbb118f5c9196719475); reviewer authored the supplied prior report
ADVANCEMENT: NO
NEXT_REQUIRED_ACTION: Resolve SC-B-01 by making the workspace-release predicate durable and state-derived (smallest form: a non-absorbing released event carrying the settlement-evidence digest and anchor checkpoint, with candidateEffectBlocked releasing only there, within the existing six-event ceiling), and remove the "even if DB terminal is releasing" allowance. Then add the anchor owner-epoch, inventory-root, reconciliation-write, delivery-failure, stored-digest, envelope-core, anchor-budget and verifier-reserve corrections. The injected-port sequencer over the unchanged v2 ledger may proceed in parallel; the v3 record schema may not.
SYNTHETIC_IMPLEMENTATION_READY: YES — scoped to the injected-port sequencer over the unchanged v2 ledger with synthetic anchor, delivery and policy ports and the acceptance cases in section 7.1 Q6; NOT the v3 record schema, which is blocked by SC-B-01
ACTIVATION_READY: NO
```
