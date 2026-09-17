# UNIVERSAL AUDIT REQUEST

> **AUDIT-ONLY DOCTRINE — READ FIRST:** Subject review is read-only and no-cost. The sole write exception is delivery of the completed sanitized report under the report-output contract below. No source changes, branches, builds, installs, workflows, provider/model calls, hosted runners, deployments or charges. Never request or expose secrets. Do not improvise when evidence is unavailable.

## Required GitHub report output

- Report repository: `eOnoes/Audits`
- Report branch: `main`
- Report path: `onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/reports/AUDIT_REPORT.md` — publisher must fill this before handoff.
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

- Audit ID: `onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1`
- Project: Onoes-Agent V3 synthetic coordinator/message model and capacity evidence
- Auditor/model: operator-selected Claude; disclose actual identity and prior involvement
- Route/provider: operator-mediated review; no repository-originated provider calls
- Audit type: STATIC_SOURCE design, synthetic composition, message contracts, regression and evidence
- Requested by: Onoes
- Date/time UTC: prepared 2026-09-17; reviewer states actual time

## Scope lock

- Exact audited revision/commit: publisher product 5f974a28bf34e097713a17020e3b7b086102d22e; immutable packet commit supplied separately at handoff, never mutable main
- Packet path: onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/
- Files/directories in scope: this named packet only: selected pure source/closure, test-only model/tests, proposed designs, exact prior report/TAP/probe outputs and labelled receipt/helper derivatives
- Dependencies/evidence in scope: SOURCE_IDENTITIES, SOURCE_DELTA, DEPENDENCIES, DERIVATIONS, EXECUTION_SOURCE_MATCH and both producer receipts
- Explicit exclusions: wider/current product, real storage/owner/anchor/worker, IPC/enrollment/installer, OS/VM settings, credentials, real approvals/tasks/providers and activation
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

## Required reading order and precise decision

Read CURRENT_CONTEXT and PRIOR_REPORT, then the corrected coordinator/message designs, the actual test-only coordinator-model helper and its tests, pair-claims helper, pure validator dependencies, capacity probe and all evidence identities. Enumerate unread files. Do not mistake a prior review, a boolean test-world fence or a test child for physical admission.

Decide whether this modeled ordering and proposed message contract may proceed to a narrowly scoped dormant coordinator/adapter implementation with synthetic ports, or identify corrections first. NO real storage/owner/worker/consumer/installer/activation is sought. C12 remains partial probe evidence, not a completed physical control. Do not require already-excluded production mechanisms to exist before permitting only the next dormant implementation step; do record them as mandatory admission gates.

## Focused evidence-backed questions

1. D-1/D-2: retained local history, one unconfirmed tail, exact canonical metadata/inventory/history/head identities; do complete stream comparisons and transaction rechecks cover context-only and unrelated-row drift?
2. In the actual model, can T advance then be reused after a no-write rejection, local commit loss, malformed read-back, lost anchor reply, clock/fence/epoch drift, abort or settlement expiration? Trace private S promotion, attempt accounting, no compensation and no queue.
3. D-3: review both bootstrap and append primitive canonical schemas, operation/lifetime/request number/nonce/epoch/deadline and full echo/result binding. Can a rehashed stale/mismatched reply, bootstrap replacement, duplicate request or request-counter edge bypass the intended phase? Identify gaps between the executable model and proposed physical contract.
4. D-4/C03: after worker settlement, changed live epoch/head must deny BEFORE any transaction; prove that separately from a bad-shaped response.
5. Are C01-C11/C13 test assertions falsifiable with real incremental T rather than only mocked PASS flags? Inspect fixture state indices, valid/invalid corruption assumptions, async settlement and busy loser semantics. State precisely which C12/physical controls they cannot prove.
6. Does the distinction between virtual timeout, cancellation return, modeled activity settlement and direct test-child close remain honest? Can stale activity or a reset world accidentally become a proposed production permission?
7. Does revocation after local commit allow only previously reserved bounded settlement, never new task authority or renewed forward readiness? Challenge the future physical hold across every asynchronous seam.
8. Does full-reference replay in the small model distort any performance claim? Capacity probe instead measures fixed pure validation pieces; rederive corpus cardinalities and explain 1000 operations/6001 checkpoints versus 7001 structural bound, maximum bytes and all histories.
9. Check exact normal/cancel stdout against receipt timing, exit, digest and memory claims. Parent heartbeat is not the dashboard; V8 old-space is not a process memory cap; direct-child close is not descendant/job settlement. What evidence is still needed for proposed 30 s bootstrap/10 s pair/5 s stop budgets and 2 GiB per process?
10. Verify source delta relative to 8c22fcaea18088ab2118fe89959bf609878c92aa: identify any actual production-source changes versus test-only additions. Check current selected source hashes against executed receipts; distinguish full offline test names from supplied full-product code.
11. Are strict request/response caps and proposed outer/inner encoding budgets coherent? Identify allocation-before-cap hazards and lifecycle/message limits needing explicit contracts before physical implementation.
12. Give one minimal ordered next step and list remaining physical B-03/W1-W5, installation/retention and independent/operator acceptance gates without turning synthetic or static evidence into a release approval.

## Integrity and delivery

Acknowledge the independently supplied MANIFEST.sha256 file size/digest BEFORE source review. If missing, report delivery incomplete; do not infer a trust root from filenames or the manifest itself. Hash raw members, byte lengths and Git blob OIDs where possible. A manifest-only reconstruction does not verify source fetches. Publisher product membership remains publisher-reported without independent bundle/tree authentication. No repairs/normalization of frozen inputs. Subject tests/helpers NOT RUN; bounded offline hashing/byte/count arithmetic only.

Report repository: eOnoes/Audits. Branch: main. Exact output: onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/reports/AUDIT_REPORT.md. Only add the sanitized completed Markdown report using existing authorized access. Check current workflow files AND activation state first; if Actions could run or status is unknown, stop and ask Eddie for specific approval. No subject/input/manifest edits, branches, PRs, force-push, deletion, builds, installs, subject execution, providers or charges. Preserve prior outputs with the next numbered AUDIT_REPORT_ADDENDUM_N.md. Read back the committed report bytes and return its immutable link/commit, distinct from the input commit. If write access is unavailable, return the complete Markdown with REPORT_DELIVERY: BLOCKED_NO_GITHUB_WRITE_ACCESS and this exact output path. Never request secrets. Public history persists after cleanup.
