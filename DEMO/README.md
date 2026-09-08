# Canonical Audit Packet Layout

> **AUDIT-ONLY DOCTRINE — READ FIRST:** This repository is for read-only, no-cost audits. Do not branch, build, edit, commit, push, run workflows, call providers/models, use hosted runners, deploy, or incur API/compute charges. Inspect and report findings only. Never request or expose secrets.

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
- `reports/` starts empty and receives the auditor’s Markdown report after return.
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
9. Store returned reports under `reports/`.
10. Remove the active packet after closure if no further work is needed.

Deleting a packet from the latest commit does not erase Git history. Sensitive material must never be pushed to a public repository.

## Handoff message format

```text
Audit packet: https://github.com/eOnoes/Audits/tree/<branch-or-path>
Purpose: <one sentence>
Auditor: <model/provider>
Scope: <exact boundary>
Cost controls: read-only; no Actions; no provider/model calls from the repo
Return: <report filename and required sections>
```
