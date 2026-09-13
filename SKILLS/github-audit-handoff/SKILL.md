# GitHub Audit Handoff Skill

> **AUDIT-ONLY DOCTRINE — READ FIRST:** Subject review is read-only and no-cost. The only receiving-reviewer write exception is adding the completed sanitized report to GitHub under the exact packet output contract and root REPORT_DELIVERY.md. No source changes, branches, builds, workflows, providers, deployments or charges. Never request or expose secrets or improvise missing evidence.

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
9. Every new request must name `<packet-id>/reports/AUDIT_REPORT.md` on GitHub main and explicitly permit report-only delivery after sanitization and a workflow check. Require verified read-back and an immutable report link. Preserve old reports with numbered addenda; never edit frozen manifests. Align SCOPE, reports/README, handoff and provenance fields with this exception. Missing write access must be reported, not hidden behind a chat-only completion claim.
10. Close the packet when resolved. Deleting it from the latest tree does not erase public Git history.

## Handoff message to Eddie

```text
Audit packet: https://github.com/eOnoes/Audits/tree/<branch-or-path>
Purpose: <one sentence>
Auditor: <model/provider>
Scope: <exact boundary>
Cost controls: subject read-only; report-only GitHub write exception; workflow check before writing; no Actions, builds or providers
Return: add <packet-id>/reports/AUDIT_REPORT.md on GitHub main using AUDIT_REQUEST.md; return its verified immutable GitHub link
```

## Receiving-auditor rules

- Read `AUDIT_REQUEST.md` first.
- Inspect only the named revision and packet.
- Do not modify subject code, branch, build, run Actions, deploy or call paid services. A report-only commit/push or file API write is allowed solely at the request's exact output path, after the workflow check. Follow root REPORT_DELIVERY.md; preserve existing reports and packet inputs.
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

Codex can use this file as project instructions or as prompt context. It is not automatically installed as a Hermes skill merely by visiting the URL. Give the reviewer this skill and the immutable packet URL: `Follow the audit-only doctrine. Add only the completed sanitized report at the exact GitHub output path in AUDIT_REQUEST.md after checking workflows; return its verified immutable link. Do not modify the audited code or packet inputs.` Historical packets retain their original authority unless Eddie explicitly authorizes a separate report-delivery override.
