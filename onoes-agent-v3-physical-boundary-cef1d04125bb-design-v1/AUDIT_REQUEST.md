# UNIVERSAL AUDIT REQUEST

> **AUDIT-ONLY DOCTRINE — READ FIRST:** Subject review is read-only and no-cost. The sole write exception is delivery of the completed sanitized report under the report-output contract below. No source changes, branches, builds, installs, workflows, provider/model calls, hosted runners, deployments or charges. Never request or expose secrets. Do not improvise when evidence is unavailable.

## Required GitHub report output

- Report repository: `eOnoes/Audits`
- Report branch: `main`
- Report path: `onoes-agent-v3-physical-boundary-cef1d04125bb-design-v1/reports/AUDIT_REPORT.md` — publisher must fill this before handoff.
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

- Audit ID: `onoes-agent-v3-physical-boundary-cef1d04125bb-design-v1`
- Project: Onoes-Agent V3 physical boundary design and synthetic recovery context
- Auditor/model: proposed Claude via operator-mediated browser; actual model/route and source transfer require Eddie approval; disclose prior involvement
- Route/provider: STATIC_SOURCE/DOCUMENT_ONLY; no repository-originated inference or provider call
- Audit type: STATIC_SOURCE / DOCUMENT_ONLY physical boundary design, security, recovery, architecture and evidence
- Requested by: Onoes
- Date/time UTC: prepared 2026-09-17; reviewer records actual UTC review time

## Scope lock

- Exact audited revision/commit: publisher source cef1d04125bb82fb222ca1ff6deb613746daba69; public immutable INPUT commit supplied after approved publication
- Packet path: onoes-agent-v3-physical-boundary-cef1d04125bb-design-v1/
- Files/directories in scope: Only named packet: proposed physical designs, current/baseline doc/source delta, pure coordinator/recovery/byte-bound tests with relative TS closure, two historical native reference files and producer evidence
- Dependencies/evidence in scope: SOURCE_IDENTITIES, SOURCE_DELTA, DEPENDENCIES, DEPENDENCY_PINS, EXECUTION_SOURCE_MATCH, raw TAP and producer receipt
- Explicit exclusions: Wider product, new physical implementation, installers, VM, actual accounts/keys/credentials/consent/tasks/providers, live activation and production consumers
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

## Decision sought and reading order

Read receipts/CURRENT_CONTEXT.md, then the physical adapter, Windows peer-channel, authority-journal, anchor-backend and enrollment-recovery designs. Read the real coordinator, pure dependency closure, recovery model and tests; compare historical native job/broker code to proposed changes. Inspect current/baseline document delta, capacity design and receipts. State each unread file explicitly. Hash coverage is not semantic coverage.

Decide whether this proposal is sufficiently specified to prepare a separately authorized bounded disposable-Windows METADATA-ONLY primitive implementation/probe, or name the minimum missing design decisions first. NO production adapter, owner admission, real task/VM contact, enrollment, service installation or activation is authorized by the report. This request asks for a critical design review, not acceptance of an implemented physical system. Whole-PC rollback scope, all-custody-loss recovery and long-lived retention are expressly OPEN; do not silently waive them or pretend a successful synthetic model closes them. Distinguish blockers to a metadata-only experiment from blockers to production.

## Focused questions

1. Does the proposed transaction ordering preserve full pre/post identity, independent cross-row invariants and no callback/IPC inside the write transaction? What exact DDL/open/physical assumptions still must be supplied?
2. Is service/pipe peer authentication sufficient against wrong-principal, stale-process, relay and handle-transfer races? Challenge both directions and the absence of impersonation fallback. A nonce alone is not authentication.
3. Is supervisor PULL of narrowed job/root duplicates actually downward-only? Find any way lower-privilege code gains supervisor/anchor handle rights or an arbitrary-handle RPC. Does source-handle reuse defeat the offer?
4. Does child launch remain suspended until independently observed custody? Which rights/API support or missing physical evidence prevents the proposed positive case? Historical StartNode is NOT assumed to implement inherited IPC or this handoff.
5. Does restart keep every unresolved owner and effect closed? Challenge KILL_ON_JOB_CLOSE with a surviving observer handle. Identify the minimum real reattachment/retirement experiment without treating persisted names/PIDs as handles.
6. Are normalized owner/maintenance invariants complete independently of SQL indexes? Is anchor restart/session invalidation distinct from an old active record?
7. Does the prepared -> contact-possible -> witnessed protocol admit ANY retry after uncertainty? Is the T1/T2 private continuation consistent with the synthetic fault seams? Can a fresh ID, epoch or consent reset it?
8. Is exact one-ahead reconciliation for sequence 1 (genesis predecessor) supported without task replay or new history? Does equality discovery avoid another append?
9. Do clock and capacity reservations preserve settlement/retirement paths without claiming disk guarantees? Preserve 7001 structural checkpoint capacity, not merely the 6001 performance sample.
10. Which synthetic tests are genuinely falsifiable, which claims are only author-reported, and what must be measured in the disposable experiment? Subject tests/helpers/native code remain NOT RUN.
11. Do live-channel observations remain nonportable evidence? Identify any accidental waiver of existing signed approvals, issuer custody, whole-PC rollback, immutable runtime or full W1-W5 acceptance.
12. Give ONE minimal ordered corrective/probe plan. Do not recommend wholesale product rewrite, lower limits merely to pass, paid services or privileged changes to the working PC.

## Integrity delivery

Publisher sends expected MANIFEST.sha256 SHA-256 and byte length in a separate pin-only chat message FIRST. Reviewer must actually acknowledge it before receiving the immutable packet link/source. If that did not happen, report delivery-order limitation, never infer or retroactively claim acknowledgment. Hash raw manifest and every member; verify selected source lengths/blob OIDs where available. Reconstructed/rendered checks must be labeled precisely. Never obtain missing private source/dependencies.

## Report output agreement

Report repository: eOnoes/Audits. Branch: main. Exact report output: onoes-agent-v3-physical-boundary-cef1d04125bb-design-v1/reports/AUDIT_REPORT.md. Sole write exception: add the completed sanitized report using existing authorized access, after checking workflow files AND activation state. If Actions could run or status is unknown, stop and obtain Eddie's specific approval. No input/source/manifest edits, branches, PRs, force-push, deletions, subject execution, installs, providers or charges. Preserve prior reports with the next numbered AUDIT_REPORT_ADDENDUM_N.md. Read back the committed report and return its immutable GitHub link and distinct output commit. Without write access return complete Markdown with REPORT_DELIVERY: BLOCKED_NO_GITHUB_WRITE_ACCESS and the exact path. Public Git history persists after cleanup.
