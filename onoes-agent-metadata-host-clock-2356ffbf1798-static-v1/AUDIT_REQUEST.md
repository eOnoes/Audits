# UNIVERSAL AUDIT REQUEST

> **AUDIT-ONLY DOCTRINE — READ FIRST:** Subject review is read-only and no-cost. The sole write exception is delivery of the completed sanitized report under the report-output contract below. No source changes, branches, builds, installs, workflows, provider/model calls, hosted runners, deployments or charges. Never request or expose secrets. Do not improvise when evidence is unavailable.

## Required GitHub report output

- Report repository: `eOnoes/Audits`
- Report branch: `main`
- Report path: `onoes-agent-metadata-host-clock-2356ffbf1798-static-v1/reports/AUDIT_REPORT.md` — publisher must fill this before handoff.
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

- Audit ID: `onoes-agent-metadata-host-clock-2356ffbf1798-static-v1`
- Project: Onoes-Agent original host clock, code holds and metadata retention
- Auditor/model: reviewer must state actual identity and prior involvement
- Route/provider: operator-selected external review; not yet transferred by publisher
- Audit type: STATIC_SOURCE security, timing, custody/composition prerequisites and evidence
- Requested by: Onoes
- Date/time UTC: packet prepared 2026-09-19; reviewer records actual review time

## Scope lock

- Exact audited revision/commit: publisher source 2356ffbf179872f40314f84992cdfa7642aadbdf; immutable packet commit supplied only after approved publication
- Packet path: onoes-agent-metadata-host-clock-2356ffbf1798-static-v1/
- Files/directories in scope: exactly the manifest-covered packet, source/, tests/, receipts/ and this request
- Dependencies/evidence in scope: SOURCE_IDENTITIES, DEPENDENCIES, selected declared C# closures, producer-only evidence; no runtime binaries
- Explicit exclusions: wider/current product, guest services/worker implementation, VM, credentials, protected setup, real approvals/providers, installation, physical execution and release
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

## Focused boundary questions (answer each with file/symbol/line evidence)

1. Does the Node conversion really upper-bound original elapsed for the documented runtime/numeric domain? Identify assumptions the accepted sample alone cannot establish, especially cast overflow, boot/frequency identity and runtime provenance.
2. Can constructor delay, re-instantiation, ARM receipt, report close or one-use handoff renew work/stop/retention time? Are timers AND synchronous paths tied to the original origin? Assess deliberately too-fresh denial and small budgets.
3. Can bad samples, proxy/accessor/shared/detached buffers, reference/run/budget mismatch or public-method replacement reach a usable clock or revive an invalidated one? State the trusted-module/global boundary.
4. Do C# clock receivers, Node receiver, OMH2/OMW2 retained intents and ARM V2 agree on the original identity and deadline meanings? What does an unkeyed checksum/reference NOT prove?
5. Does controller reservation happen before any permitted later effect? Do attempted/readback/cleanup/uncertainty remain distinct after deadline or cleanup failures? Can report claims be upgraded without authenticated transport and settlement?
6. Does retained watchdog ARM require its own exact persisted intent and original clock before output? Is emergency stop attempted before storage bookkeeping? Identify blocking synchronous work and absence of hard termination guarantees.
7. Are all three code handles acquired before bytes are read, and held through one-use handoff? Does the self-loaded helper create an unresolved bootstrap/loader trust cycle? The package is explicitly not the runtime dependency closure.
8. Do physical share modes, ancestor/file identities, ACL/owner, reparse/hardlink/stream checks and create-only output look correct statically? List falsifiers needed; do NOT report their execution.
9. Do historical readers/comparison ever imply freshness, atomic pairing, reconciliation, authorization, replay or stop proof? Check V1/V2 separation and optional versus corrupt records.
10. Are selected inputs byte-identical to the executed capture identities? Distinguish raw TAP/clock outputs from derived sanitized compile summaries, unverified originals, publisher Git membership and actual independent evidence.
11. Are supplied tests genuinely falsifiable at this boundary? Identify untested numeric edge cases, same-process versus cross-process assumptions, and fake/native closure differences. Subject tests NOT RUN by auditor.
12. What is the smallest concrete protected-bootstrap/authenticated-IPC composition that can proceed next? Separate source corrections from design/host gates. Nothing in this packet authorizes physical use, setup, VM contact or production.

## Reading order and integrity

Read CURRENT_CONTEXT.md, Node clock policy/runtime + collectors, C# clocks/context,
retention bridges/formats/storage, code holds/set, then the corresponding tests.
Read producer narratives/receipts last. Enumerate unread files. All current source
is supplied; SOURCE_DELTA is only the final Node change since 27f63ab3e2b504f544a453c29001e6d7ada91e88,
NOT an independently reviewed baseline for the larger host boundary.

Before source review, compare raw MANIFEST.sha256 bytes with the separately
announced size and SHA-256 from the operator handoff. Missing pin/raw bytes means
delivery incomplete, not an inferred trust root. Recompute each member SHA-256
and each source length/Git blob OID. Hashing/byte arithmetic only is authorized;
subject code, tests and helpers are NOT RUN. Receipts are publisher claims.

Local preparation is not transfer approval. Publication is pending Eddie's
confirmation of the exact sanitized packet and reviewer/service. Once the
publisher supplies the approved immutable packet, the sole reviewer write
exception is onoes-agent-metadata-host-clock-2356ffbf1798-static-v1/reports/AUDIT_REPORT.md under the report contract above.
No existing report or frozen input/manifest may be overwritten.
