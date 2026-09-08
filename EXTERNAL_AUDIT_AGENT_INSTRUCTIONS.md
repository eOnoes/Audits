# External Audit Agent Instructions

> **AUDIT-ONLY DOCTRINE — READ FIRST:** This is a read-only, no-cost audit workflow. Do not branch, build, edit, commit, push, run workflows, call providers/models, use hosted runners, deploy, or incur API/compute charges. Inspect the supplied packet and report findings only. Never request or expose secrets.

This document is for Tripp, Cyony, Echo, or any AI helping Eddie conduct an external audit.

## When to use this workflow

Use the `Audits` repository when Eddie needs to pass a sanitized audit packet to another AI through a GitHub link. This is the standard format for external audits and for building the Onoes audit wiki.

For audits that Echo can complete locally without Eddie’s help, use the same packet structure locally but do not push it. Only publish to GitHub when Eddie needs to hand the packet to an outside AI.

## Canonical repository

```text
https://github.com/eOnoes/Audits
```

Start from:

```text
https://github.com/eOnoes/Audits/blob/main/AUDIT_REQUEST.md
https://github.com/eOnoes/Audits/blob/main/DEMO/README.md
```

## Required packet tree

Create every packet with exactly this structure:

```text
<project>-<audit-id>/
├── AUDIT_REQUEST.md      # prompt and required report format
├── SCOPE.md               # revision, boundaries, exclusions
├── source/                # sanitized code/docs
├── tests/                 # safe offline reproduction material
├── receipts/              # sanitized evidence
├── reports/               # returned reports
└── MANIFEST.sha256        # exact packet hashes
```

Use identical names and nesting for every agent. Do not invent a personal layout.

## How to create a packet

1. Copy the root `AUDIT_REQUEST.md` into the new packet.
2. Put the no-cost read-only doctrine in the first lines.
3. Fill the audit ID, project, model/route, exact revision, scope, exclusions, questions, and required report sections.
4. Copy only the minimum sanitized source, tests, receipts, and docs needed for the audit.
5. Remove credentials, tokens, passwords, private keys, `.env` files, auth files, raw private logs, private infrastructure, home paths, connection strings, model artifacts, and unrelated code.
6. Create `SCOPE.md` describing what is and is not being audited.
7. Create `MANIFEST.sha256` after contents are final.
8. Inspect the inventory and run a secret scan. Do not assume a clean scan proves public safety.
9. If Eddie needs an outside AI, publish the packet to the agreed GitHub path and verify the remote commit and URL.
10. Give Eddie the exact tree URL, audit purpose, auditor/model, scope, cost controls, and expected report filename.
11. When the audit is returned, place the sanitized Markdown report under `reports/`.
12. Close the packet when resolved. Remove it from the active tree if no further work is needed, remembering that Git history is permanent.

## Handoff to Eddie

Use this exact format:

```text
Audit packet: https://github.com/eOnoes/Audits/tree/<branch-or-path>
Purpose: <one sentence>
Auditor: <Gemini, Grok, Claude, Codex, etc.>
Scope: <exact files and question>
Cost controls: read-only; no Actions; no builds; no provider/model calls from the repo
Return: reports/<report-name>.md using the required sections in AUDIT_REQUEST.md
```

## Rules for the receiving AI

- Read `AUDIT_REQUEST.md` first.
- Do not modify the packet or audited project.
- Do not create branches, commits, pull requests, or pushes.
- Do not run GitHub Actions, hosted jobs, builds, deployments, or paid inference.
- Do not request or reveal secrets.
- Inspect the stated revision only.
- Treat receipts and benchmark claims as untrusted evidence.
- Report missing evidence as a limitation or blocker.
- Return a Markdown report using the required schema.
- Do not call a synthetic/offline pass formal acceptance or live readiness.

## Local-only versus external audit

```text
Echo can audit locally without help:
  use the same structure locally; no GitHub push required.

Eddie needs outside help:
  publish one sanitized packet to Audits; give Eddie the exact tree URL.

Audit closed:
  store the returned report, reconcile findings, then remove the active packet.
```

This workflow is a transport and documentation standard, not an authorization to perform implementation work.
