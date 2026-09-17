# UNIVERSAL AUDIT REQUEST

> **AUDIT-ONLY DOCTRINE — READ FIRST:** Subject review is read-only and no-cost. The sole write exception is delivery of the completed sanitized report under the report-output contract below. No source changes, branches, builds, installs, workflows, provider/model calls, hosted runners, deployments or charges. Never request or expose secrets. Do not improvise when evidence is unavailable.

## Required GitHub report output

- Report repository: `eOnoes/Audits`
- Report branch: `main`
- Report path: `onoes-agent-v3-coordinator-implementation-7e923956dd01-static-v1/reports/AUDIT_REPORT.md` — publisher must fill this before handoff.
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

- Audit ID: `onoes-agent-v3-coordinator-implementation-7e923956dd01-static-v1`
- Project: Onoes-Agent dormant V3 message/session/coordinator implementation and synthetic fault composition
- Auditor/model: proposed operator-selected Claude; actual route awaits Eddie approval; disclose model identity and all prior involvement
- Route/provider: operator-mediated STATIC_SOURCE review only; no repository-originated provider calls
- Audit type: STATIC_SOURCE implementation, security, message/data contracts, synthetic composition, regression and evidence
- Requested by: Onoes
- Date/time UTC: prepared 2026-09-17; reviewer states actual review time

## Scope lock

- Exact audited revision/commit: publisher product 7e923956dd014f44e8eb20449499de31c3e4d7f7; immutable public packet commit supplied separately after authorized publication, never mutable main
- Packet path: onoes-agent-v3-coordinator-implementation-7e923956dd01-static-v1/
- Files/directories in scope: this named packet only: selected TS source and complete relative TS closure, synthetic tests, exact current/baseline docs, prior report, raw TAP and labelled receipt/helper derivatives
- Dependencies/evidence in scope: SOURCE_IDENTITIES, SOURCE_DELTA (includes docs), historical M-5 supplement, DEPENDENCIES, DEPENDENCY_PINS, DERIVATIONS, EXECUTION_SOURCE_MATCH and current producer receipt
- Explicit exclusions: wider/current product, real physical storage/owner/anchor/worker, IPC/enrollment/installer, OS/VM settings, credentials, real approvals/tasks/providers, runtime consumers and activation
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

## Reading order and decision sought

Read receipts/CURRENT_CONTEXT.md and the prior report/disposition first. Then read the actual coordinator and snapshot transport, message contract and validation session, all relative TS dependencies, the synthetic ports and coordinator/session tests, corrected designs, source/doc delta and producer evidence. Enumerate unread files. Older model code is comparison context, not the implementation under review.

Decide whether the actual dormant implementation obeys the reviewed ordering and can be retained for the next separately reviewed physical-adapter/worker design step, or list source corrections first. No permission to implement/activate real storage, authentication, workers, task consumers or installation is sought here. Distinguish a source defect from a deliberately absent physical gate. Do not infer the desired verdict from prior advancement or passing producer tests.

## Focused evidence-backed questions

1. Does the coordinator retain old S while the real validation session advances T, stage exactly one candidate C, and promote only after exact fresh local/anchor read-back and current authority? Find any queue, alternate pre-state input, summary import or retry path.
2. Are every bootstrap/append request and response bound to canonical primitive transport, operation, private counter, random nonce, epoch/lifetime, original deadline, complete pre/input/post identity and self-digest? Can a correctly rehashed wrong reply or acknowledgment satisfy another request?
3. Does local snapshot parsing overclaim validation? Trace its deliberately partial byte-claim check versus full bootstrap replay and incremental validation. Inspect escaping/cap checks before composition, JSON parse/canonicalization allocation, and the staged history append.
4. Does the commit port receive only data, never an arbitrary callback inside a transaction? Precisely separate coordinator guarantees from the trusted adapter obligation to check schema/durability/physical store and all pre/post bytes under one synchronous transaction. Can the test fixture mask a missing coordinator check?
5. Challenge unrelated/context-only row, metadata, schema, epoch and history drift after validation. Distinguish pre-write local drift rejection from anchor drift DURING a local commit, which may leave one unconfirmed tail. No simultaneous anchor transaction is claimed.
6. Trace lost commit/anchor replies, malformed or stale acks, corrupt read-back, late success and exceptions. Are counters recorded exactly at actual contact? Does anything imply no write merely because a promise rejected? Is uncertainty ever cleared by compensation or automatic reuse?
7. One bootstrap attempt and one active append: what does the ports-object WeakSet actually prevent? Explicitly test the reasoning for module reload/clone/new adapter object and physical store-wide identity. Is the unresolved host lifetime gate honest and adequate for dormant-only retention?
8. Sweep cancellation/deadline/revocation at every asynchronous seam, including bootstrap refresh and final promotion. Inspect the 32 append and 18 bootstrap before/after cuts, 16 settled expiry cuts, pending-port accounting and late uncooperative commit. Timer/promise settlement is NOT physical termination or preemption of synchronous work.
9. After local commit, can forward revocation permit only the old exact pair under separate still-valid settlement authority and original budget, with no promotion? Confirm expired settlement causes zero anchor contact and old S is retained even if both writes actually happened.
10. Are all 53 family prefixes checked through actual message/session/incremental code against the full-reference identity, rather than a PASS flag? Which properties share helpers/primitives, and which physical or worst-capacity controls cannot be inferred from these fixtures?
11. Reconcile current focused 136/136 and full 2131/2129 pass/0 fail/2 skips with exact TAP, selected 49 execution identities and source mapping. All 23 selected TS blobs match; two raw executed configs are CRLF while Git blobs are LF. Check the explicit mapping rather than claiming EXACT_TREE. Full-suite names are not supplied full-product source.
12. Disposition prior M-1..M-6: bounded encoding, bootstrap lifetime accounting, local/anchor boundary precision, independently delivered manifest pin, full new doc delta plus old eight-doc supplement, and still-open maximum admissible M-6/C12. State minimal corrections and next physical design/evidence gates without approving excluded activation.

## Integrity and delivery

Before source review, acknowledge the expected MANIFEST.sha256 file size/digest supplied by Eddie in CHAT, separate from this repository. Missing pin means delivery incomplete, not a guessed trust root. Hash raw members/lengths/Git blob OIDs where possible; one successfully reconstructed manifest does not validate all source fetches. Product membership remains publisher-reported without an independent bundle/tree authentication. Do not normalize frozen bytes. Subject tests/helpers NOT RUN; only bounded offline hash/byte/count/diff arithmetic is allowed.

Report repository: eOnoes/Audits. Branch: main. Exact output: onoes-agent-v3-coordinator-implementation-7e923956dd01-static-v1/reports/AUDIT_REPORT.md. Only add the sanitized completed Markdown report using existing authorized access. Check current workflow files AND activation state first; if Actions could run or status is unknown, stop and ask Eddie for specific approval. No subject/input/manifest edits, branches, PRs, force-push, deletion, builds, installs, subject execution, providers or charges. Preserve prior outputs with the next numbered AUDIT_REPORT_ADDENDUM_N.md. Read back the committed report bytes and return its immutable link/commit, distinct from the input commit. If write access is unavailable, return the complete Markdown with REPORT_DELIVERY: BLOCKED_NO_GITHUB_WRITE_ACCESS and this exact output path. Never request secrets. Public history persists after cleanup.
