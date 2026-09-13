# UNIVERSAL AUDIT REQUEST

> **AUDIT-ONLY DOCTRINE — READ FIRST:** This is a read-only, no-cost audit. Do not branch, build, edit, commit, push, run workflows, call providers/models, use hosted runners, deploy, or incur API/compute charges. Inspect the supplied packet and report findings only. Never request or expose secrets. Do not improvise when evidence is unavailable.

## Audit identity

- Audit ID: `onoes-agent-candidate-effect-ledger-76dc12a9474d-github-v1`
- Project: Onoes-Agent candidate effect ledger S1
- Auditor/model: operator-selected external reviewer; state actual identity and prior involvement
- Route/provider: operator-mediated GitHub static review; no provider calls from this repository
- Audit type: STATIC_SOURCE + data-contract design, security, implementation and evidence
- Requested by: Onoes
- Date/time UTC: packet prepared 2026-09-13; reviewer records actual review time

## Scope lock

- Exact audited revision/commit: publisher product 76dc12a9474d626efcf1944c86f4ffd131bfef2f; use the immutable GitHub packet commit in the handoff link
- Packet path: onoes-agent-candidate-effect-ledger-76dc12a9474d-github-v1/
- Files/directories in scope: only this packet; source/, tests/, receipts/, SCOPE.md and this request
- Dependencies/evidence in scope: exact SOURCE_IDENTITIES, DEPENDENCIES and producer-only focused TAP
- Explicit exclusions: wider/current product, VM, native controller, credentials, real approvals, consumers, providers and deployment
- Allowed actions: read, inspect, and bounded offline analysis only

**Scope rule:** Audit only the named revision and packet. Do not expand the scope silently. If required evidence is missing, record a blocker or limitation.

## Cost and mutation controls

- No GitHub Actions or hosted runners.
- No model/provider/API calls beyond the explicitly approved audit route; default is no external call from the repository.
- No builds, deployments, package installs, downloads, or long-running jobs.
- No branches, pull requests, commits, pushes, merges, resets, cleans, deletions, or file edits.
- No credentials, tokens, private paths, private infrastructure details, or raw sensitive logs.
- Ordinary public GitHub browsing/cloning is permitted; all other side effects are prohibited.

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
- Subject tests/helpers must NOT run under this STATIC_SOURCE request. Only bounded offline hashing/byte arithmetic is permitted. Report proposed tests as NOT RUN.
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

## Packet delivery and reconstruction

Compare MANIFEST.sha256 with the separately delivered expected hash, then hash every
raw member and recompute all SOURCE_IDENTITIES lengths and Git blob OIDs. Report
unavailable checks honestly. This is not a Git bundle or EXACT_TREE review.

This is a GitHub-layout successor to onoes-agent-candidate-effect-ledger-76dc12a9474d-static-v1. Its eleven product
blobs, installed transaction context and raw TAP are byte-identical; only packet
metadata/layout changed. The newer working product is NOT the audit target.

For path reasoning only, map source/<productPath> and tests/<productPath> back to
one hypothetical product root using SOURCE_IDENTITIES.productPath. The tests/tests
prefix is intentional. This extract is NOT runnable as laid out, contains no full
package.json, runtime or installed dependencies, and authorizes no reconstruction
for execution. Context code is under source/context/ and separately classified.

Return Markdown to the operator in the reviewing chat. Do not write to GitHub.
After review and sanitization, the publisher may retain it as reports/AUDIT_REPORT.md;
it is a new output, not an original manifest member. Preserve existing reports.

## What changed, and what did not

Two new build-only modules implement a pure effect-state contract and SQLite
ledger. They accept host-provided data, not signed approval capabilities. The
ledger maintains namespace-wide approval identity, operation and workflow/kind
uniqueness, blocks a workspace while unfinished OR terminal-quarantined, records
possible-effect markers before future effects, and binds a separately approved
publication record to a completed/passed execution record in the same store.
Exact replay returns `replayed` recorded state, not a fresh effect permission.
There is no effect port, runtime/barrel consumer, signer, VM or publication adapter.

The design-v2 reviewer allowed this S1 data-only step, conditional on transport,
timing and namespace decisions. The included successor design records them and
corrects overstatements in that report: timeout is not necessarily non-quiescence;
short runs can succeed; a workspace index requires a workspace field; terminal
quarantine must still block; and wrapping task stdout is not independent evidence.
Do not endorse this implementation simply because an earlier model suggested S1.

Source transfer stays a new complete-manifest design, not implemented. Existing
v1 request limits are unchanged. Separate VM orchestration and original publication
remain unimplemented. Historical ledgers/leases/MAC encoding are untouched and
not accepted by these DATA types. Full legacy consumer inventory, protected
namespace/store/enrollment identity and old-owner fencing remain consumer gates.

## Required reading order

1. `source/src/build-only/windows-candidate-effect-state.ts` in full.
2. `source/src/build-only/windows-candidate-effect-ledger.ts` in full.
3. Their full canonical-JSON and deep-freeze dependencies.
4. The full ledger test suite and BOTH helper sources. Inspect fault seams, not
   just case names. Never run them under this request.
5. `source/docs/handoff/ONOES_AGENT_DISPATCH_LEDGER_DECISIONS.md` as producer claims.
6. Receipts, dependency pins and the supplied transaction-library context.

## Questions requiring evidence-backed answers

1. Can one approval ID fund multiple operations/workflows/phases, including
   execute versus publish, within a single pinned namespace/store? Distinguish
   that property from a malicious host creating another store/enrollment, which
   S1 does not prevent and future acceptance rules must prohibit.
2. Is one execution approval used for transfer plus launch without a second
   consumption? Does publication require a fresh approval, exact subject, same
   workflow and completed/passed parent? Can missing/stale/substituted parent,
   result, image/generation/controller, policy or source-manifest data be accepted?
3. Are possible-effect markers ordered and absorbing? Can a repeated marker,
   lost reservation/marker/terminal response, new connection or operation ID
   become permission to repeat an effect? State which future host rules are still
   needed to prevent a stale controller from invoking a port after a marker.
4. Does every unknown/quarantined outcome keep workspace exclusion across reopen,
   even though terminal? Can partial SQL-column drift or a rehashed illegal
   history clear it? What corruption does unkeyed hashing NOT detect?
5. Are completed/failed/restored/cancelled transitions internally coherent? Where
   does an external protected observation remain necessary for truthful terminal
   state? Do not mistake a valid evidence digest for proof the observation occurred.
6. Are transaction locks acquired before scan/uniqueness decisions? Are writes
   short/synchronous with no user callback inside? Does post-COMMIT read-back loss
   latch writes and preserve discovery rather than compensate? Is a new trusted
   connection sufficient for discovery but insufficient for automatic execution?
7. Do expiry and time ordering fail closed for forward markers, while permitting
   stop/failure bookkeeping after expiry? Are clock/replay/recovery semantics
   documented accurately, including any availability limitations?
8. Can proxies/getters/exotic/repeated-reference inputs run code before rejection,
   change a stored record via caller mutation, or evade canonical byte binding?
   Inspect the passive prewalk AND later canonical/schema parsing.
9. Check exact schema/read-back, TEMP/ATTACH/pragma handling, SQL parameterization,
   row/materialization caps, record/event/operation ceilings and indexed duplicate
   fields. Identify any missing uniqueness or invariants not independently checked.
10. Do the fault-injection tests actually fire after real COMMIT? Do both worker
    connections and the abrupt child exit genuinely exercise SQLite? Identify
    vacuous assertions, nondeterminism and meaningful missing negative controls.
11. Are data-only/non-authorizing and deployment limitations honest? Record the
    1,000-operation lifetime limit and missing retention/anti-rollback mechanism
    as operational gates, not invisible production promises.
12. Is this S1 contract safe to retain for dormant continuation? List exact fixes
    needed before composing a future consumer. Do NOT infer that passing S1
    clears protected Windows control, old-consumer inventory, enrollment, source
    transfer, original publication or release gates.

## Required Markdown report

Use these sections: Executive Summary; Audit Identity and Prior Involvement;
Scope and Method; Verdict; Blocking Findings; Nonblocking Findings; Verification
Results; Security and Integrity Review; Limitations and Missing Evidence;
Required Next Action; Explicit Non-Claims.

For each finding include stable ID, severity, exact file/symbol/line, observed
fact, consequence, trust assumptions, falsifiable proposed control (NOT RUN),
minimal correction and whether new, already documented or out of scope. Distinguish
an S1 source defect from an intentionally absent future-host mechanism. State
whether the verdict is for dormant retention, consumer design, or actual activation.
Name every unread file or unsupported claim; request only load-bearing missing
context. Do not quietly widen the review to the entire product.

End with: MODEL_ID (as actually known), ROUTE, AUDITED_REVISION,
IMPLEMENTATION_VERDICT, SECURITY_VERDICT, EVIDENCE_VERDICT, BLOCKING_FINDINGS,
NONBLOCKING_FINDINGS, TEST_RESULTS, SCOPE_RESULT, PLATFORM_LIMITATIONS,
ADVANCEMENT, NEXT_REQUIRED_ACTION. Test results must say NOT RUN by reviewer.
