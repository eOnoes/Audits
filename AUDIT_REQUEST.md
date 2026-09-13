# UNIVERSAL AUDIT REQUEST

> **AUDIT-ONLY DOCTRINE — READ FIRST:** Subject review is read-only and no-cost. The sole write exception is delivery of the completed sanitized report under the report-output contract below. No source changes, branches, builds, installs, workflows, provider/model calls, hosted runners, deployments or charges. Never request or expose secrets. Do not improvise when evidence is unavailable.

## Required GitHub report output

- Report repository: `eOnoes/Audits`
- Report branch: `main`
- Report path: `[PACKET-ID]/reports/AUDIT_REPORT.md` — publisher must fill this before handoff.
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

- Audit ID: `[PROJECT]-[YYYYMMDD]-[SEQUENCE]`
- Project:
- Auditor/model:
- Route/provider:
- Audit type: `security | implementation | evidence | architecture | structural | regression | release | other`
- Requested by: Onoes
- Date/time UTC:

## Scope lock

- Exact audited revision/commit:
- Packet path:
- Files/directories in scope:
- Dependencies/evidence in scope:
- Explicit exclusions:
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
