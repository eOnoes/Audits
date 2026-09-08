# Onoes Audits

> **AUDIT-ONLY DOCTRINE — READ FIRST:** This repository is for read-only audits only. Do not branch, build, edit, commit, push, run workflows, call providers/models, or incur API/compute charges. Inspect the supplied packet and report findings only. Any unavailable evidence is a blocker or limitation, never a reason to improvise.

This repository is a sanitized handoff point for external AI audits of Onoes projects. Every audit starts from the root `AUDIT_REQUEST.md`, which is the systematic request and wiki-report contract. Copy it into each active audit packet and fill only the bracketed/project-specific fields.

## Non-negotiable rules

1. **No-cost operation:** Do not invoke GitHub Actions, hosted runners, provider APIs, model APIs, cloud inference, builds, deployments, or paid tools. Ordinary repository browsing and cloning are the only expected GitHub operations.
2. **Read-only:** Do not modify the repository, create branches, open pull requests, commit, push, merge, or rewrite history. Do not edit the audited project.
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

Normal `git clone`, `git pull`, and `git push` operations do not consume GitHub Actions minutes. This repository still forbids pushes by auditors and forbids Actions/workflows so the audit process cannot create unintended charges or quota usage.
