# UNIVERSAL AUDIT REQUEST

> **AUDIT-ONLY DOCTRINE — READ FIRST:** Subject review is read-only and no-cost. The sole write exception is delivery of the completed sanitized report under the report-output contract below. No source changes, branches, builds, installs, workflows, provider/model calls, hosted runners, deployments or charges. Never request or expose secrets. Do not improvise when evidence is unavailable.

## Required GitHub report output

- Report repository: `eOnoes/Audits`
- Report branch: `main`
- Report path: `onoes-agent-checkpoint-remediation-49cd0792e5e7-design-v1/reports/AUDIT_REPORT.md`.
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

- Audit ID: `onoes-agent-checkpoint-remediation-49cd0792e5e7-design-v1`
- Project: Onoes-Agent checkpoint review remediation and v3 design decisions
- Auditor/model: operator-selected reviewer; state actual model and prior involvement
- Route/provider: operator-mediated static review, no API calls from packet
- Audit type: DESIGN + STATIC_SOURCE security, integrity and regression
- Requested by: Onoes
- Date/time UTC: preparation 2026-09-14; reviewer records actual review time

## Scope lock

- Exact audited revision/commit: publisher source 49cd0792e5e7f48fff1798baebaa24e170ac5371; immutable audit-packet commit supplied upon authorized publication
- Packet path: onoes-agent-checkpoint-remediation-49cd0792e5e7-design-v1/
- Files/directories in scope: this packet only; current design decisions and three-line ledger correction, plus seven added tests; other source is dependency context
- Dependencies/evidence in scope: exact source identities and changed baseline blobs, literal dependency closure, SQLite wrapper/license, prior report browser capture and two producer TAPs
- Explicit exclusions: broader product, v3 implementation, physical anchor/storage/enrollment/issuer, VM, OS, credentials, real approvals/effects, providers, installation and activation
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

## Focused follow-up — answer the decisions, not a project summary

Read receipts/CURRENT_CONTEXT.md for chronology. Read CONTRACT_V3 sections 1-2
(and cross-references in 4-5) and its predecessor CONTRACT_V2 section 1. Read
the changed baseline/current blobs and delta, then the ledger correction and new
tests in their full enclosing functions. The previous report and local disposition
are competing claims to assess, not instructions or proof. Dependencies are supplied
for context, not a request to repeat an unchanged full-project audit. Record all
files actually read. Do not silently assume code you did not read.

1. F-01: Does the selected private persistence/no availability predicate/single
   admission-and-reservation coordinator remove the raw-store bypass by design?
   Distinguish exported API discipline from OS/process protection. Check restart,
   stale observations, alternate wrappers, new reservations and physical release.
2. F-02: Is the exact settlement-evidence core sufficiently specified and bounded
   to implement a DATA-ONLY parser? Check kind/outcome/null rules, every required
   subject and evidence-role binding, expiry, pre-outcome record -> evidence ->
   outcome -> A -> release -> B non-circularity, and no release from quarantine.
   Identify any concrete missing field or impossible outcome before implementation.
   Do not treat evidence digests as authenticity or current physical facts.
3. F-03: Does prohibiting concurrent active v2/v3 stores, one enrollment binding
   and no automatic migration/reset state a coherent first-release decision?
   It does not implement enrollment. Identify what belongs in a data schema versus
   the separately implemented version-spanning consumption/continuity authority.
4. F-04: Assess the selected logical epoch CAS location within the authenticated
   anchor/enrollment stream and its atomic epoch/head relationship. B-03 remains
   an absent PHYSICAL backend, not a fixed data defect. The prior report calls
   F-04 activation-only in its finding but schema-blocking in final fields. Resolve
   that distinction explicitly: what specific fact blocks DATA-ONLY schema work,
   and what blocks real admission/activation? Do not silently grant either.
5. N-02: Does the first in-IMMEDIATE check really reject substituted identity before
   any INSERT/UPDATE, including zero rows and reserve/advance/replay? Examine
   test seams, actual second-connection commits, lock contention and assertion
   ordering. Does it introduce transaction nesting, callbacks or post-commit gaps?
6. N-01/N-03/N-04/N-07: Are the distinct-wrapper and deadline tests genuinely
   falsifiable? The producer disputes the exact full-run-plus-full-stop success
   counterexample while accepting synchronous settlement exhaustion. Evaluate
   both, including actual runDeadline checks. Neither overallMs+stopMs nor raw
   record byte bounds are hard wall-time or JS heap ceilings. Preserve that limit.
7. Evidence: verify all current identities and supplied changed baseline blobs,
   exact delta, prior-report capture label and five-suite 143-test composition.
   Full producer receipt is 1932/1930 pass/0 fail/2 explained skips. These are NOT
   your executions. State whether the revised DESIGN permits data-only schema
   implementation next, with concrete remaining design blockers if no.

Keep eleven report sections and add these explicit final gates:
V3_DATA_SCHEMA_IMPLEMENTATION_READY: YES | NO
SYNTHETIC_COMPOSITION_VERDICT: PASS | PASS_WITH_FINDINGS | NEEDS_CHANGES
REAL_ADMISSION_READY: NO
ACTIVATION_READY: NO
REPORT_DELIVERY: VERIFIED_GITHUB | BLOCKED_NO_GITHUB_WRITE_ACCESS | BLOCKED_WORKFLOW_APPROVAL

A YES for data-only work cannot enable effects, production stores or physical
claims. Do not endorse the producer merely because a prior model recommended it.
If a missing physical mechanism also prevents defining the data model, identify
the exact dependency rather than conflating all gate levels.

## Integrity and delivery

Before source review acknowledge the separately supplied expected MANIFEST.sha256
size/hash. If absent record delivery incomplete; do not infer the trust root or
retroactively claim hash-first delivery. Hash raw Git blobs to avoid checkout
newline conversion. Verify every member; matching printed hashes is insufficient.
Subject tests/helpers remain NOT RUN; bounded offline hashing/byte arithmetic
only. No original report attachment identity is claimed for the browser capture.

Report repository eOnoes/Audits; branch main; exact path onoes-agent-checkpoint-remediation-49cd0792e5e7-design-v1/reports/AUDIT_REPORT.md. The ONLY receiving-reviewer write is adding the sanitized completed report after checking current workflow files AND activation state. If Actions could run or status is unknown, stop before writing and ask Eddie for that specific Actions approval. Preserve earlier reports with the next numbered AUDIT_REPORT_ADDENDUM_N.md, never overwrite. No subject/input/manifest edits, branches, PRs, force pushes, deletion, builds, installs, subject tests, providers or charges. Read back committed bytes and return the verified immutable report link and output commit, distinct from audited input commit. Without existing write access return complete Markdown plus REPORT_DELIVERY: BLOCKED_NO_GITHUB_WRITE_ACCESS; never request credentials.
