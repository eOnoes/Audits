# UNIVERSAL AUDIT REQUEST

> **AUDIT-ONLY DOCTRINE — READ FIRST:** Subject review is read-only and no-cost. The sole write exception is delivery of the completed sanitized report under the report-output contract below. No source changes, branches, builds, installs, workflows, provider/model calls, hosted runners, deployments or charges. Never request or expose secrets. Do not improvise when evidence is unavailable.

## Required GitHub report output

- Report repository: `eOnoes/Audits`
- Report branch: `main`
- Report path: `onoes-agent-v3-data-f256ad29ea41-static-v1/reports/AUDIT_REPORT.md`.
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

- Audit ID: `onoes-agent-v3-data-f256ad29ea41-static-v1`
- Project: Onoes-Agent v3 data-only record, inventory and checkpoint-history implementation
- Auditor/model: operator-selected reviewer; disclose actual model and prior involvement
- Route/provider: pending operator confirmation; operator-mediated review, no API calls from packet
- Audit type: STATIC_SOURCE implementation, security, integrity and regression
- Requested by: Onoes
- Date/time UTC: preparation 2026-09-15; reviewer states actual review time

## Scope lock

- Exact audited revision/commit: publisher product f256ad29ea4176cdc60244db20fd3742769e1f0a; immutable packet commit supplied only after authorized publication
- Packet path: onoes-agent-v3-data-f256ad29ea41-static-v1/
- Files/directories in scope: this packet only; three new v3 modules, three tests, fixture, exact relative dependency closure, selected design/implementation context
- Dependencies/evidence in scope: SOURCE_IDENTITIES, dependency edges, design delta/baseline, prior design report and two producer TAPs
- Explicit exclusions: wider product, SQLite store, native controller, VM, OS, protected anchor/storage, enrollment, issuer, credentials, real approval/effects, runtime/UI/HTTP consumers, providers, installer and activation
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

## Focused implementation questions — answer with exact source evidence

Read the three v3 modules and their tests/helpers FIRST. Then inspect canonical
JSON, v2 time/UUID/approval helpers, CONTRACT_V3 and current implementation notes.
Use the prior DESIGN report/disposition for context, not endorsement. No v3 source
existed in that review. Read CURRENT_CONTEXT.md for receipt chronology.

1. Do primitive-wire, pre-parse byte/collection caps, strict schemas, canonical
   equality and deep freezing reject malformed/exotic input without invoking
   caller code? Inspect nested JSON wire allocation and schema error collection.
2. Are installation/namespace/store/domain, immutable intent and stable v1 approval
   identity correctly joined? Does any new code alter v2 authority or wire bytes?
3. Replay every execute/publish path, including non-result failure, pre-contact
   cancellation, quarantine after an outcome and release. Does any malformed path
   release early or hide a result? Check six-event limits and explicit-null fields.
4. Does settlement bind every shared intent field, prior record before outcome,
   historical result, exact evidence core and validity interval without circular
   hashing? Evaluate observedAt >= predecessor time and equality/expiry edges.
5. Does A name the exact outcome-containing prefix and does release bind A and
   the SAME evidence? Distinguish record parsing, snapshot matching, adjacent pair
   checking and complete retained-history validation: which claims need which API?
6. Does inventory independently reject operation/approval/workflow-kind duplicates
   and blocking-workspace collisions, including terminal/quarantined rows, without
   SQL indexes? Is canonical tuple hashing bounded and sorted correctly?
7. Can publication refer to missing, failed, unreleased or wrong-subject execution,
   or reuse an approval? Distinguish historical parentage from actual consent and
   authenticated result evidence, which are absent.
8. Verify exact global sequence = retained reservations + explicit events, genesis,
   previous hashes, prefix event order and monotonic time. Check every historical
   root, including an omitted/extra row, relocated record or substituted A.
9. Test by static reasoning historical workspace overlap when final rows are both
   released. Check publication reservation before parent release checkpoint and
   interleavings between A and B. Is adjacent-pair validation incorrectly used as
   a general-history claim anywhere? No current consumer exists.
10. Identify coherent-forgery/rollback/deletion cases STILL accepted when an attacker
    rewrites both records and checkpoint claims. No unkeyed parser authenticates
    storage completeness, freshness, physical fencing, owner CAS or role evidence.
    Are return kinds and missing availability APIs honest about this boundary?
11. Inspect aggregate 64-MiB transports, 1000-row/7001-checkpoint caps, tuple versus
    full-record canonical complexity, repeated hashing and error paths. The 1000-row
    tests are representative snapshots, NOT worst-case full-history measurements,
    hard preemption, a heap ceiling or a production settlement budget.
12. Are the 47 producer tests falsifiable and correctly bound to current source?
    Full receipt is 1979 tests /1977 pass /0 fail /2 explained skips; do not infer
    independent execution or repeat broader source review from those names.
    Name missing negative tests and the smallest correction before persistence
    DESIGN can depend on these data contracts. Do not authorize implementation
    of a real store, admission, provider, VM, installer or activation.

Add final fields:
DATA_CONTRACT_VERDICT: PASS | PASS_WITH_FINDINGS | NEEDS_CHANGES
PERSISTENCE_DESIGN_READY: YES | NO (design only, not storage implementation)
REAL_ADMISSION_READY: NO
ACTIVATION_READY: NO
REPORT_DELIVERY: VERIFIED_GITHUB | BLOCKED_NO_GITHUB_WRITE_ACCESS | BLOCKED_WORKFLOW_APPROVAL

## Integrity and honest delivery

Before reading source acknowledge the expected MANIFEST.sha256 size and SHA-256
provided separately by the operator. If absent, record delivery incomplete; do
not invent or retroactively infer hash-first delivery. Hash raw Git blobs; compare
all manifest members and source identities (SHA-256, byte length, Git blob OID).
Printed digest agreement is not raw-byte verification. Publisher commit membership
is not independently proved without the private Git objects. Subject code/tests
remain NOT RUN; only bounded offline hash/byte arithmetic is allowed.

Report repository eOnoes/Audits; branch main; exact path onoes-agent-v3-data-f256ad29ea41-static-v1/reports/AUDIT_REPORT.md. The only receiving-reviewer write is adding the completed sanitized report after checking workflow files AND activation state. If Actions could run or status is unknown, stop before writing and obtain Eddie's specific run approval. No input/source/manifest edits, branches, PRs, force pushes, deletion, builds, installs, subject execution, providers or charges. Preserve existing reports using the next unused AUDIT_REPORT_ADDENDUM_N.md in the same reports directory. Read back committed report bytes and return a verified immutable report link and output commit, distinct from the audited input commit. Without existing write access return full Markdown plus REPORT_DELIVERY: BLOCKED_NO_GITHUB_WRITE_ACCESS and the target path. Never request credentials.
