# GitHub Audit Handoff Skill

> **AUDIT-ONLY DOCTRINE — READ FIRST:** This is a read-only, no-cost audit workflow. Do not branch, build, edit, commit, push, run workflows, call providers/models, use hosted runners, deploy, or incur API/compute charges. Inspect the supplied packet and report findings only. Never request or expose secrets. Do not improvise when evidence is unavailable.

## Purpose

Use this workflow only when the local agent cannot complete a needed audit and Eddie must hand the audit to an external AI. If the audit can be completed locally, keep it local. This repository is a sanitized handoff channel, not a build workspace.

Canonical repository:

```text
https://github.com/eOnoes/Audits
```

## Canonical packet tree

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

Every packet created by Echo, Codex, Cyony, Tripp, or an external auditor must use this exact structure.

## Packet procedure

1. Copy the root `AUDIT_REQUEST.md` into the packet and keep the doctrine in the first lines.
2. Fill the audit ID, project, auditor/model, route, exact revision, scope, questions, and exclusions.
3. Copy only the minimum sanitized source, tests, docs, and receipts needed.
4. Exclude `.env`, auth files, keys, tokens, passwords, private keys, private paths, private infrastructure, raw sensitive logs, connection strings, model artifacts, and unrelated code.
5. Add `SCOPE.md` and an exact `MANIFEST.sha256`.
6. Run a secret scan and inventory check before publication.
7. Never enable GitHub Actions or hosted runners. No builds or paid provider calls.
8. Verify the remote commit and exact tree URL before giving it to Eddie.
9. Store returned Markdown reports under `reports/` after sanitizing them.
10. Close the packet when resolved. Deleting it from the latest tree does not erase public Git history.

## Handoff message to Eddie

```text
Audit packet: https://github.com/eOnoes/Audits/tree/<branch-or-path>
Purpose: <one sentence>
Auditor: <model/provider>
Scope: <exact boundary>
Cost controls: read-only; no Actions; no builds; no provider/model calls from the repo
Return: reports/<report-name>.md using AUDIT_REQUEST.md
```

## Receiving-auditor rules

- Read `AUDIT_REQUEST.md` first.
- Inspect only the named revision and packet.
- Do not modify, branch, build, commit, push, run Actions, deploy, or call paid services.
- Do not request or reveal secrets.
- Treat receipts, benchmarks, and worker claims as untrusted evidence.
- Report missing evidence as a limitation or blocker.
- Return the required Markdown report.
- Do not call synthetic/offline success formal acceptance or live readiness.

## Verification rules

- Never claim a link exists until remote readback confirms it.
- Never call a worker receipt an independent audit.
- Keep implementation, audit evidence, and formal acceptance separate.
- A clean report from one scoped audit does not certify the complete system.
- If current hashes differ from the supplied receipt, report the mismatch; do not silently substitute another revision.

## Codex installation/use

Codex can use this file as project instructions or as prompt context. It is not automatically installed as a Hermes skill merely by visiting the URL. For any external audit, give Codex this file plus the packet URL and say: `Follow the audit-only doctrine and return the required report; do not modify anything.`
