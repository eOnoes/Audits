# Canonical Audit Packet Layout

> **AUDIT-ONLY DOCTRINE — READ FIRST:** Subject review is read-only and no-cost. Only the sanitized report may be added to the exact GitHub path authorized by AUDIT_REQUEST.md and root REPORT_DELIVERY.md. No source edits, branches, builds, workflows, providers, deployments or charges. Never request or expose secrets.

Every audit created by Echo, Cyony, Tripp, or any external helper must use the same layout below.

## Required tree

```text
<project>-<audit-id>/
├── AUDIT_REQUEST.md      # prompt, doctrine, scope, questions, output contract
├── SCOPE.md               # exact boundary, revision, exclusions
├── source/                # sanitized source/docs only
├── tests/                 # relevant safe/offline tests only
├── receipts/              # sanitized implementation evidence
├── reports/               # returned auditor reports
└── MANIFEST.sha256        # hashes of packet files
```

## File rules

- `AUDIT_REQUEST.md` is always first and must begin with the no-cost read-only doctrine.
- `SCOPE.md` identifies the exact project revision and prevents scope drift.
- `source/` contains only the files necessary for the audit.
- `tests/` contains only safe tests or fixtures needed to reproduce claims.
- `receipts/` contains sanitized receipts; never raw logs with secrets or private infrastructure.
- `reports/` receives the completed sanitized Markdown report directly on GitHub at the request's exact path; reports are new outputs, never retroactive input-manifest members.
- `MANIFEST.sha256` records exact packet hashes; do not normalize identifiers.

## Never include

```text
.env, auth.json, API keys, OAuth tokens, passwords, private keys,
connection strings, raw private logs, home-directory paths, private IPs,
model credentials, large model artifacts, unrelated repositories,
unsanitized prompts, or hidden instructions from another system.
```

## Agent handoff checklist

1. Copy the root `AUDIT_REQUEST.md` into the packet.
2. Fill the project, audit ID, model, route, scope, revision, questions, and exclusions.
3. Copy only sanitized files required by that scope.
4. Generate and inspect `MANIFEST.sha256`.
5. Run a secret scan and inventory check.
6. Push only the packet; never enable Actions.
7. Verify the remote commit and exact GitHub tree URL.
8. Give Eddie the link and state the expected report sections.
9. Require report-only GitHub delivery under `reports/`, workflow checks before writing, and a verified immutable report link. Missing write access must be stated explicitly with complete Markdown for operator delivery.
10. Remove the active packet after closure if no further work is needed.

Deleting a packet from the latest commit does not erase Git history. Sensitive material must never be pushed to a public repository.

## Handoff message format

```text
Audit packet: https://github.com/eOnoes/Audits/tree/<branch-or-path>
Purpose: <one sentence>
Auditor: <model/provider>
Scope: <exact boundary>
Cost controls: subject read-only; report-only GitHub write exception; workflow check before writing; no Actions or provider/model calls
Return: add <packet-id>/reports/AUDIT_REPORT.md on GitHub main; verify read-back and return its immutable link
```
