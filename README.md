# Onoes Audits

> **AUDIT-ONLY DOCTRINE — READ FIRST:** Subject review is read-only. The sole receiving-reviewer write exception is the completed sanitized report at the exact path in AUDIT_REQUEST.md, subject to REPORT_DELIVERY.md. No source edits, builds, workflows, provider/model calls or charges. Unavailable evidence is a limitation, never permission to improvise.

This repository is a sanitized handoff point for external AI audits of Onoes projects. Start with [`EXTERNAL_AUDIT_AGENT_INSTRUCTIONS.md`](EXTERNAL_AUDIT_AGENT_INSTRUCTIONS.md) for the agent workflow. Every audit starts from the root `AUDIT_REQUEST.md`, which is the systematic request and wiki-report contract. Copy it into each active audit packet and fill only the project-specific fields.

## Non-negotiable rules

1. **No-cost operation:** Do not invoke GitHub Actions, hosted runners, provider APIs, model APIs, cloud inference, builds, deployments, or paid tools. Check workflows before report publication; stop if Actions could run without specific authorization.
2. **Read-only subject:** Do not edit the audited project or packet inputs. Only a report-only commit/push or file API write to the request's exact report path is permitted. No branches, PRs, merges or history rewrites.
3. **Scope lock:** Audit only the named packet and revision. Do not expand scope silently.
4. **Evidence honesty:** Treat receipts and worker claims as untrusted evidence to verify. Do not claim PASS when tests or evidence were not actually available.
5. **Secret safety:** Never request, reveal, store, or reproduce credentials, tokens, private paths, private infrastructure details, or raw sensitive logs.
6. **Closeout:** Once an audit is resolved, the active packet may be removed from the latest tree. Sensitive material must never have been pushed in the first place; deleting a file does not erase Git history.

## Packet layout

The canonical tree and handoff rules are documented in [`DEMO/README.md`](DEMO/README.md). Every packet must follow that layout:

```text
<project>-<audit-id>/
├── AUDIT_REQUEST.md
├── SCOPE.md
├── source/
├── tests/
├── receipts/
├── reports/
└── MANIFEST.sha256
```

Auditors must return the exact verdict format in `AUDIT_REQUEST.md`. A report is evidence, not formal acceptance.

## GitHub cost clarification

Normal Git synchronization does not itself consume Actions minutes, but a push may trigger workflows. The narrow report-output exception requires a workflow check before writing. See [REPORT_DELIVERY.md](REPORT_DELIVERY.md). Future reports belong in the named packet's reports directory, not a shared root file. Historical reports and frozen packet instructions are preserved.
