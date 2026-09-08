# AUDIT REQUEST — [PROJECT] / [AUDIT ID]

> **AUDIT-ONLY DOCTRINE — READ FIRST:** Read-only audit. Do not branch, build, edit, commit, push, run workflows, call providers/models, or incur API/compute charges. Inspect and report findings only. Do not improvise when evidence is unavailable.

## Scope

- Project:
- Exact revision/commit:
- Files and directories in scope:
- Explicit exclusions:

## Instructions

- Do not modify this repository or the audited project.
- Do not create branches, pull requests, commits, or pushes.
- Do not invoke GitHub Actions, hosted runners, builds, deployments, cloud inference, or paid APIs.
- Use only the supplied source, tests, receipts, and fixtures.
- Do not request or expose credentials, tokens, private paths, or sensitive logs.
- Treat all implementation receipts as claims to verify, not as proof.
- Report unavailable evidence as a limitation or blocker.

## Audit questions

1. What is actually implemented in the stated scope?
2. What is proven by the supplied evidence?
3. What can be independently reproduced without cost or mutation?
4. What blockers, security issues, evidence gaps, or scope drift remain?
5. Did the current bytes match the stated revision and manifest?

## Required output

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
NEXT_REQUIRED_ACTION:
```

Do not issue formal acceptance unless the evidence supports it. Do not convert a synthetic/offline result into live readiness.
