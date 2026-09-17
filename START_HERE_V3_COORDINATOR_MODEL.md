# Start here: scoped Onoes-Agent coordinator audit

This is a **GitHub-hosted STATIC_SOURCE audit of one component, not the whole app**.
The operator can hand over this page from a phone; no desktop or local repository
access is needed. This page only supplies navigation to the already published
packet. It does not amend its authority, files, manifest or questions.

## Scope and task authority

- Audit ID: `onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1`
- Audited input commit: `1f84e1ab6db1834e108070b1a1febfa5717e551e`
- Publisher-reported product revision: `5f974a28bf34e097713a17020e3b7b086102d22e`
- Task authority: [AUDIT_REQUEST.md](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/AUDIT_REQUEST.md)
- 48 packet files: 47 manifest-covered members plus the manifest itself.

Review the test-only coordinator ordering, proposed worker-message contract,
supporting pure validators, tests, documentation and producer evidence. Answer
the twelve focused questions in the request. The decision sought is whether to
continue narrowly scoped dormant implementation with synthetic ports.
Do not review the whole application or other packets in this repository.
No real storage, owner, worker, VM, consumer, installer or activation approval is
sought. Producer TAP/probe results are not independently executed evidence.

## Integrity first

The publisher supplies this expected pin; the operator must also convey it in
the chat handoff, separately from the packet, before source review:

```text
MANIFEST.sha256 size: 5,137 bytes
SHA-256: 5616b581a9ef56d1d247509a9200230244935deb0675b269d90ad440fd954e6b
```

Acknowledge that separately supplied value before reviewing source. If it has
not reached the chat, ask for it; this page does not retroactively satisfy a
missing acknowledgment. Recompute raw member hashes where possible. Distinguish
raw-byte verification from rendered text inspection; do not invent verification.

## Review order and limits

Read CURRENT_CONTEXT and PRIOR_REPORT first after the request/integrity step,
then the corrected coordinator/message designs, actual coordinator-model helper
and tests, pair-claims helper, pure dependencies, capacity probe and evidence
identities. All direct blob links are below, so directory listing is unnecessary.
Enumerate unread or inaccessible files and disclose limitations.
Disclose actual model identity and prior involvement. General prior project
context is not automatically disqualifying, but do not label the review a fresh
independent second opinion when it is not one.

Subject review is read-only and no-cost. No source edits, builds, installs,
subject tests/helpers, Actions, providers, deployments or charges. Bounded offline
hash/byte arithmetic is permitted under the request. No secrets or credentials.

## Return the full report

Use the eleven-section Markdown report and final fields in AUDIT_REQUEST.md.
Report output path on eOnoes/Audits main:

```text
onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/reports/AUDIT_REPORT.md
```

If existing authorized GitHub write access is available, follow the request's
narrow report-only output exception: inspect current workflow files AND activation
state before writing, preserve inputs/prior reports/concurrent work, and return a
verified immutable report link after byte read-back. Do not assume this navigation
page's commit is the audited input commit.

**If write access is unavailable, complete the audit and return the entire
Markdown report in chat or as an attachment**, headed
`REPORT_DELIVERY: BLOCKED_NO_GITHUB_WRITE_ACCESS`, with that exact target path.
The publisher will handle delivery after its own sanitization/workflow checks.
Missing write access or unavailable Actions-status inspection prevents your
publication, not read-only review. Do not request Actions approval or credentials
merely to return Markdown. Preserve previous reports using numbered addenda.

## All 48 direct links — frozen input commit

- [AUDIT_REQUEST.md](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/AUDIT_REQUEST.md)
- [HANDOFF.md](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/HANDOFF.md)
- [MANIFEST.sha256](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/MANIFEST.sha256)
- [SCOPE.md](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/SCOPE.md)
- [receipts/CURRENT_CONTEXT.md](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/receipts/CURRENT_CONTEXT.md)
- [receipts/DELIVERY.json](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/receipts/DELIVERY.json)
- [receipts/DEPENDENCIES.json](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/receipts/DEPENDENCIES.json)
- [receipts/DERIVATIONS.json](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/receipts/DERIVATIONS.json)
- [receipts/EXECUTION_SOURCE_MATCH.json](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/receipts/EXECUTION_SOURCE_MATCH.json)
- [receipts/PRIOR_REPORT.md](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/receipts/PRIOR_REPORT.md)
- [receipts/PRIOR_REPORT_IDENTITY.json](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/receipts/PRIOR_REPORT_IDENTITY.json)
- [receipts/SANITIZATION.json](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/receipts/SANITIZATION.json)
- [receipts/SOURCE_DELTA.json](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/receipts/SOURCE_DELTA.json)
- [receipts/SOURCE_DELTA.patch](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/receipts/SOURCE_DELTA.patch)
- [receipts/SOURCE_IDENTITIES.json](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/receipts/SOURCE_IDENTITIES.json)
- [receipts/capacity/PRODUCER_RECEIPT.json](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/receipts/capacity/PRODUCER_RECEIPT.json)
- [receipts/capacity/cancel-sample.stdout.jsonl](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/receipts/capacity/cancel-sample.stdout.jsonl)
- [receipts/capacity/sample.stdout.jsonl](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/receipts/capacity/sample.stdout.jsonl)
- [receipts/messages/PRODUCER_RECEIPT.json](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/receipts/messages/PRODUCER_RECEIPT.json)
- [receipts/messages/focused.tap](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/receipts/messages/focused.tap)
- [receipts/messages/full.tap](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/receipts/messages/full.tap)
- [reports/README.md](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/reports/README.md)
- [source/docs/handoff/ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V3.md](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/source/docs/handoff/ONOES_AGENT_CANDIDATE_CONSUMER_CONTRACT_V3.md)
- [source/docs/handoff/ONOES_AGENT_V3_COORDINATOR_MODEL.md](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/source/docs/handoff/ONOES_AGENT_V3_COORDINATOR_MODEL.md)
- [source/docs/handoff/ONOES_AGENT_V3_COORDINATOR_PAIR_DESIGN.md](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/source/docs/handoff/ONOES_AGENT_V3_COORDINATOR_PAIR_DESIGN.md)
- [source/docs/handoff/ONOES_AGENT_V3_COORDINATOR_REVIEW_DISPOSITION.md](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/source/docs/handoff/ONOES_AGENT_V3_COORDINATOR_REVIEW_DISPOSITION.md)
- [source/docs/handoff/ONOES_AGENT_V3_INCREMENTAL_VALIDATION_DESIGN.md](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/source/docs/handoff/ONOES_AGENT_V3_INCREMENTAL_VALIDATION_DESIGN.md)
- [source/docs/handoff/ONOES_AGENT_V3_PERSISTENCE_DESIGN_DRAFT.md](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/source/docs/handoff/ONOES_AGENT_V3_PERSISTENCE_DESIGN_DRAFT.md)
- [source/docs/handoff/ONOES_AGENT_V3_WORKER_CAPACITY_PROBE.md](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/source/docs/handoff/ONOES_AGENT_V3_WORKER_CAPACITY_PROBE.md)
- [source/docs/handoff/ONOES_AGENT_V3_WORKER_MESSAGE_DESIGN.md](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/source/docs/handoff/ONOES_AGENT_V3_WORKER_MESSAGE_DESIGN.md)
- [source/src/build-only/windows-candidate-effect-state.ts](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/source/src/build-only/windows-candidate-effect-state.ts)
- [source/src/build-only/windows-candidate-v3-data.ts](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/source/src/build-only/windows-candidate-v3-data.ts)
- [source/src/build-only/windows-candidate-v3-incremental.ts](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/source/src/build-only/windows-candidate-v3-incremental.ts)
- [source/src/build-only/windows-candidate-v3-inventory.ts](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/source/src/build-only/windows-candidate-v3-inventory.ts)
- [source/src/build-only/windows-candidate-v3-record.ts](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/source/src/build-only/windows-candidate-v3-record.ts)
- [source/src/compatibility/canonical-json.ts](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/source/src/compatibility/canonical-json.ts)
- [source/src/validation/deep-freeze.ts](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/source/src/validation/deep-freeze.ts)
- [tests/research/measure-v3-worker-capacity.mjs.txt](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/tests/research/measure-v3-worker-capacity.mjs.txt)
- [tests/research/verify-v3-worker-messages.mjs.txt](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/tests/research/verify-v3-worker-messages.mjs.txt)
- [tests/tests/helpers/candidate-v3-coordinator-model.ts](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/tests/tests/helpers/candidate-v3-coordinator-model.ts)
- [tests/tests/helpers/candidate-v3-history-fixture.ts](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/tests/tests/helpers/candidate-v3-history-fixture.ts)
- [tests/tests/helpers/candidate-v3-pair-claims.ts](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/tests/tests/helpers/candidate-v3-pair-claims.ts)
- [tests/tests/helpers/candidate-v3-record-fixture.ts](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/tests/tests/helpers/candidate-v3-record-fixture.ts)
- [tests/tests/unit/windows-candidate-v3-coordinator-model.test.ts](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/tests/tests/unit/windows-candidate-v3-coordinator-model.test.ts)
- [tests/tests/unit/windows-candidate-v3-data.test.ts](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/tests/tests/unit/windows-candidate-v3-data.test.ts)
- [tests/tests/unit/windows-candidate-v3-inventory.test.ts](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/tests/tests/unit/windows-candidate-v3-inventory.test.ts)
- [tests/tests/unit/windows-candidate-v3-pair-claims.test.ts](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/tests/tests/unit/windows-candidate-v3-pair-claims.test.ts)
- [tests/tests/unit/windows-candidate-v3-record.test.ts](https://github.com/eOnoes/Audits/blob/1f84e1ab6db1834e108070b1a1febfa5717e551e/onoes-agent-v3-coordinator-model-5f974a28bf34-static-v1/tests/tests/unit/windows-candidate-v3-record.test.ts)
