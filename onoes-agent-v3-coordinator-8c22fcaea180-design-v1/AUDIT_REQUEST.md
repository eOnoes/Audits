# UNIVERSAL AUDIT REQUEST

> **AUDIT-ONLY DOCTRINE — READ FIRST:** Subject review is read-only and no-cost. The sole write exception is delivery of the completed sanitized report under the report-output contract below. No source changes, branches, builds, installs, workflows, provider/model calls, hosted runners, deployments or charges. Never request or expose secrets. Do not improvise when evidence is unavailable.

## Required GitHub report output

- Report repository: `eOnoes/Audits`
- Report branch: `main`
- Report path: `onoes-agent-v3-coordinator-8c22fcaea180-design-v1/reports/AUDIT_REPORT.md` — publisher must fill this before handoff.
- Allowed write: add only the completed sanitized Markdown report; report-only commit/push or GitHub file API write using existing authorized access is permitted.

Inspect workflow files and activation state before writing. If Actions could run,
or their status cannot be determined, obtain Eddie's specific approval first.
Preserve earlier reports: use a new numbered addendum instead of overwriting.
Never edit source, tests, receipts, requests or manifests; the report is a new
output, not a frozen input member. No branches, PRs, force-pushes or deletions.
Read back the committed report, compare its bytes and return its immutable GitHub
link plus report commit in chat, distinct from the audited source commit.
If write access is missing, return complete Markdown with
`REPORT_DELIVERY: BLOCKED_NO_GITHUB_WRITE_ACCESS` and the exact target path; never
claim upload success or request secrets. See REPORT_DELIVERY.md at the repository
root for producer checks; this section is the packet's self-contained write scope.

## Audit identity

- Audit ID: `onoes-agent-v3-coordinator-8c22fcaea180-design-v1`
- Project: Onoes-Agent V3 coordinator pair design and incremental review remediation
- Auditor/model: operator-selected; report actual identity and prior involvement
- Route/provider: operator-mediated cloud reviewer of this GitHub packet; no repository-originated provider calls
- Audit type: STATIC_SOURCE design, security, data contract, regression and evidence
- Requested by: Onoes
- Date/time UTC: prepared 2026-09-16; reviewer records actual time

## Scope lock

- Exact audited revision/commit: publisher product 8c22fcaea18088ab2118fe89959bf609878c92aa; packet commit is the immutable GitHub commit provided at handoff, never mutable main
- Packet path: onoes-agent-v3-coordinator-8c22fcaea180-design-v1/
- Files/directories in scope: this packet only; selected pure TypeScript, complete relative closure, tests, proposed design, prior report and declared receipts
- Dependencies/evidence in scope: SOURCE_IDENTITIES, SOURCE_DELTA, DEPENDENCIES, DERIVATIONS, exact producer TAP and sanitized execution receipt/helper
- Explicit exclusions: wider/current product, actual coordinator/worker/storage/anchor/owner implementation, OS/VM/services, credentials, live approvals/tasks/providers, installer/activation and runtime consumers
- Allowed actions: read, inspect, bounded offline analysis, and the report-only GitHub delivery above

**Scope rule:** Audit only the named revision and packet. Do not expand the scope silently. If required evidence is missing, record a blocker or limitation.

## Cost and mutation controls

- No GitHub Actions or hosted runners.
- No model/provider/API calls beyond the explicitly approved audit route; default is no external call from the repository.
- No builds, deployments, package installs, downloads, or long-running jobs.
- No branches, pull requests, merges, resets, cleans, deletions, or file edits except the report-only delivery above.
- No credentials, tokens, private paths, private infrastructure details, or raw sensitive logs.
- Ordinary public GitHub browsing/cloning and the scoped report delivery are permitted; all other side effects are prohibited.

## Audit questions

1. What is actually implemented in scope?
2. What claims are supported by current bytes and reproducible evidence?
3. What security, integrity, correctness, reliability, or architectural weaknesses exist?
4. Are receipts, hashes, manifests, tests, and revision identifiers contemporaneous?
5. What important tests or evidence are missing?
6. Are there blockers that must stop advancement?
7. What is the smallest next corrective action?

## Required evidence method

- Inspect current source/docs before relying on receipts.
- Preserve identifiers and hashes exactly as observed.
- Separate observed facts, reproduced results, model judgment, and assumptions.
- Under STATIC_SOURCE requests, do not run subject tests or helpers; report them as NOT RUN. Execution requires a separately authorized scope.
- Do not treat a worker claim, benchmark, or model confidence as proof.
- Redact sensitive values in the report; use `[REDACTED]`.

## Required wiki-ready report

Return a separate Markdown document using this exact structure.

```markdown
# Audit Report — [PROJECT] / [AUDIT ID]

## 1. Executive Summary
One paragraph: scope, overall result, and whether advancement is blocked.

## 2. Audit Identity
- Audit ID:
- Project:
- Auditor/model:
- Route/provider:
- Audit type:
- Date/time UTC:
- Audited revision:

## 3. Scope and Method
- In scope:
- Exclusions:
- Files inspected:
- Commands/probes run:
- Cost/mutation controls:

## 4. Verdict
IMPLEMENTATION_VERDICT: PASS | PASS_WITH_FINDINGS | NEEDS_CHANGES | NOT_IMPLEMENTED
SECURITY_VERDICT: PASS | NEEDS_REVIEW | BLOCKED | NOT_APPLICABLE
EVIDENCE_VERDICT: COMPLETE | PARTIAL | INSUFFICIENT
ADVANCEMENT: YES | NO

## 5. Blocking Findings
For each finding:
- ID:
- Severity: blocker | high | medium | low
- File/symbol/line:
- Observed fact:
- Why it matters:
- Reproduction/probe:
- Required correction:
- Status: new | previously documented | resolved but unverified

Write `None observed in the scoped audit.` only when the evidence supports it.

## 6. Nonblocking Findings
Use the same fields as Blocking Findings.

## 7. Verification Results
- Test command/result:
- Probe command/result:
- Hash/manifest comparison:
- Receipt comparison:
- Scope check:
- Unexpected output or failure:

## 8. Security and Integrity Review
Discuss secrets, injection/control content, authorization, isolation, mutation, concurrency, provenance, replay, rollback, and fail-closed behavior as relevant. Mark untested items explicitly.

## 9. Limitations and Missing Evidence
List platform, access, unavailable-fixture, race, crash, provider, or measurement limitations. Never convert source inspection into a successful probe.

## 10. Required Next Action
One minimal ordered action list. Identify what must be fixed, what must be audited again, and what remains intentionally excluded.

## 11. Explicit Non-Claims
State what this report does NOT certify: formal acceptance, production readiness, live-model readiness, public-release readiness, or excluded features.
```

## Final required fields

```text
MODEL_ID:
ROUTE:
AUDITED_REVISION:
IMPLEMENTATION_VERDICT:
SECURITY_VERDICT:
EVIDENCE_VERDICT:
BLOCKING_FINDINGS:
NONBLOCKING_FINDINGS:
TEST_RESULTS:
SCOPE_RESULT:
PLATFORM_LIMITATIONS:
ADVANCEMENT: YES/NO
NEXT_REQUIRED_ACTION:
```

Do not issue formal acceptance unless the evidence explicitly supports it. Do not call synthetic/offline success live readiness. Return the completed report as a Markdown file suitable for direct storage in an audit wiki.

## Reading order and advancement decision

Read receipts/CURRENT_CONTEXT.md, then source/docs/handoff/ONOES_AGENT_V3_COORDINATOR_PAIR_DESIGN.md and the persistence/incremental design context. Inspect current TypeScript and complete relative dependencies, tests (especially incremental-negative and pairwise), then prior report, disposition, delta and execution identities. Enumerate unread files and their impact. Do not rely on the prior verdict as endorsement.

Review the combined response to prior N-1 through N-6 and the proposed coordinator boundary. Decide whether the design is precise enough for the NEXT dormant, synthetic composition/fault harness, or needs corrections first. Distinguish that from real storage/owner/worker/consumer admission, which this request does not seek. Physical B-03/W1-W5 remain open. Installation/anchor documents are proposed context, NOT selected or implemented mechanisms.

## Focused questions — cite file, symbol/section and falsifiable controls

1. Do staged T/C and confirmed S remain separate until exact ledger/anchor confirmation? Is S captured before T advances? Can a clean no-write rejection accidentally reuse or rewind advanced T?
2. Does complete in-transaction pre-state comparison cover metadata, every row, retained contexts and checkpoint history, rather than root/count alone? Is the separate post-commit read-back and promotion sequence coherent? Identify any unclosed TOCTOU assumption rather than treating F as evidence.
3. Challenge persistent-worker request settlement versus process termination; request nonce/input/epoch/pre-head/deadline binding, timeout/late reply, replacement bootstrap, singleflight and resource limits. Which exact contracts must be specified before dormant implementation, and which require physical execution?
4. Do commit-unknown/read-back failure/anchor-loss/revocation cuts remain closed, without compensation, repeat or invented absence? Is bounded pre-reserved settlement authority sufficiently distinguished from permission for new effects?
5. Do outcome/A/release/B, current-owner epoch versus immutable historical generation, fencing and re-entry preserve previous boundaries? Does any design statement secretly allow fresh instances to clear uncertainty?
6. Are N-1's six prefix rewrites snapshot-valid and one-change/one-extra-event, with independent reference denial and latched subsequent valid append? Is exact subject-prefix equality correctly identified as load-bearing?
7. Do N-2 tests cover A arriving first on quarantine for all eight families and wrong-but-self-consistent A arriving in the outcome frame itself? Are cores/prefix digests correctly reconstructed?
8. Re-derive pairwise counts: 36 fixed-shape family pairs, 6724 full two-subject schedules, 84146 reference prefixes, 39195 resumed appends. Parents are serial preludes, one A mode/equal times, one rotating nonempty cut per schedule. Keep these distinct from the older 3774/25416/80052 matrix. Are claimed bounds and targeted workspace/increasing-time/duplicate-publication cases meaningful?
9. Does the frozen shared outcome tuple preserve exact historical accepted values/order without making fixtures certify themselves? Are other production changes present in SOURCE_DELTA?
10. Audit C01-C12 as proposed future composition controls, ALL NOT RUN. Is there a missing high-value crash/concurrency/authority cut? Give the smallest corrective next step, not an unrelated platform redesign.
11. Verify raw TAP, current selected-source identity and chronology. Runs used base 907f896 plus an explicit working-tree delta subsequently committed here. Source and compiled hashes were observed before/after; compiled dependencies/runtime not supplied. Does receipt scope support precisely the local claims without implying independent execution or physical tests?
12. Identify remaining physical/enrollment/retention/whole-PC-rollback questions. Whole-PC coherent rollback scope is unresolved, not silently excluded. Do not turn the pure predicate or this design into activation approval.

## Integrity and report delivery

Obtain the expected MANIFEST.sha256 file digest through the separate operator message and acknowledge it BEFORE reviewing source. If missing, say delivery incomplete rather than deriving a trust root from the packet. Recompute raw member hashes, lengths and Git blob OIDs when possible; disclose exact limitations. A reconstructed-manifest match does not validate every source fetch. Publisher product Git membership remains publisher-reported without an independently authenticated tree/bundle. Never normalize or repair frozen inputs. Subject tests/helpers: NOT RUN. Only bounded offline hashing/byte/OID/count arithmetic is authorized.

Report repository: eOnoes/Audits. Branch: main. Exact output: onoes-agent-v3-coordinator-8c22fcaea180-design-v1/reports/AUDIT_REPORT.md. The only reviewer write exception is adding the completed sanitized Markdown report there using existing authorized access. Inspect current workflow files AND activation state first; if Actions could run or status is unknown, stop before writing and ask Eddie for specific run approval. No branches, PRs, force pushes, deletions, source/test/input/manifest changes, subject execution, installs, providers or charges. Preserve prior reports as the next unused AUDIT_REPORT_ADDENDUM_N.md in this reports directory, citing the prior output. Read back committed output bytes and return the immutable report link and commit, distinct from the input commit. Without write access return complete Markdown with REPORT_DELIVERY: BLOCKED_NO_GITHUB_WRITE_ACCESS and the exact target. Never ask for credentials. Public Git history persists after cleanup.
