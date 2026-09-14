# Candidate effect ledger: current v2 decision successor

Date: 2026-09-13. Follow-up implementation parent: af6cf1560183d705679afa0ee82d444cf4576a79.
Status: dormant data ledger; NO consumer activation or production acceptance.

## Read this before the historical decision document

This separately versioned successor is the current entry point. The original
`ONOES_AGENT_DISPATCH_LEDGER_DECISIONS.md` describes historical S1 bytes and
remains unchanged. Its unqualified namespace uniqueness and "final focused"
wording must not be used as current guarantees or identifiers of later runs.
`ONOES_AGENT_EFFECT_LEDGER_V2_AUDIT_DISPOSITION.md` superseded that implementation
description. This document now records the returned re-review and follow-ups;
the older disposition's "re-review pending" status is historical, not current.

Claude's operator-delivered STATIC_SOURCE report is `AUDIT_REPORT-1.md` at
public audit commit bb314be8a215429853422cfd7a9619cd0de0e0cf. It reviews packet
2f6a42dec9fcddac975a312409e80d6f305ed72b, source 0d31bf74230759482575340968f2340bb23d393e,
not the newer whole product. Raw report SHA-256:
810fcecac5bf53de0283325c8866cf51082157a9f37e1a439f5a62788994c2df (40875 bytes).
It confirms B-01/B-02, private read-back and held-lock contention corrections;
B-04 is resolved as historical evidence clarification. It ran NO subject tests.
Its ADVANCEMENT NO blocks activation, not the next consumer-boundary review.

## Current guarantees and deliberate limits

One store checks approval identity across its own namespace rows; it does not
coordinate separately enrolled stores. The unchanged spent-ID digest binds
namespace and approval ID, not store or record version. Sole protected enrollment
and retained global spent-ID history are mandatory host obligations, not ledger
features. Verbatim cross-store transplantation denies; coherent rewriting with
matching store identity and recomputed unkeyed digests does not. New acceptance
controls pin both limits, including publication reservation against a coherently
rewritten completed record. These values are never effect permission.

B-03 remains OPEN: protect file/WAL/SHM and identity/freshness anchors from the
task account, and design rollback/deletion detection together with retention.
A MAC alone cannot distinguish an older authentic snapshot from the current one.
The code does not establish authentic observations, protected installation,
old-owner fencing or a safe repair/reset path.

## Disposition of v2 review follow-ups

- V2-N-01: retained the 250 ms production lock budget. The start-barrier test
  admits storage-unavailable only for the non-winning connection, requires exactly
  one positive recorded winner, one exact durable row and blocker after reopen,
  no losing operation for distinct inputs, and exact replay of the winner. It
  does not infer contention from that error. Held-lock SQLITE_BUSY evidence stays
  a separate mandatory test. Added a 15-second test bound.
- V2-N-02: this versioned successor labels supersession without changing the
  original historical document or frozen packet.
- V2-N-03: `ONOES_AGENT_EFFECT_LEDGER_HISTORICAL_RUNS.json` names both TAP roles,
  durations, hashes and actual pinned packet paths. Its explicit alias maps the
  old receipt's FOCUSED_TESTS.tap field to HISTORICAL_PINNED.tap. Future packets
  must include an updated packet-local role index; never rewrite old receipts.
- V2-N-04: added the two accepted-boundary controls, same-connection instance
  poison recovery with durable blockers retained, constructor normalization of
  five configured pragmas, and legacy-v1 row rejection inside an intact v2 schema.
  The sixth pragma is different: configure does NOT reset ignore_check_constraints;
  a separate denial control pins this and corrects the blanket normalization claim.
- V2-N-05: accepted operational limitation. One bad row denies the whole store.
  Read-only protected forensic recovery is still needed; partial data cannot
  authorize effects and no repair/prune API is added.
- V2-N-06: storage-unavailable does not identify contention or authorize a retry.
  A future consumer must reconcile durable state and fence the old owner, not
  infer an absent effect from an exception.
- V2-N-07: disputed on the supported runtime's explicit API contract. Node
  24.14 documents worker message delivery before Worker exit. The existing listener
  is installed before releasing the worker and already asserts the expected
  message after successful exit. No extra acknowledgement or weakened assertion
  is needed. See [Node 24.14 Worker message](https://nodejs.org/download/release/v24.14.0/docs/api/worker_threads.html#event-message_1).
  This is documentation-backed reasoning, not independent runtime verification.
- V2-N-08: host-owned outcome/parent freshness, forward-clock recovery, lifetime
  retention, capacity, forensic access and physical containment remain release
  obligations. Linux/macOS evidence is not required for this Windows-only release;
  no non-Windows support is claimed.

The expected manifest digest announced by the publisher matches Claude's observed
digest, but he says the separate expected pin never reached him. Do not rewrite
his report or claim retroactive hash-first delivery. Manual upload supplied the
report successfully without granting the reviewer GitHub credentials.

## Historical run roles

The earlier decision-document capture is 18/18, 926.2852 ms, a7ecb823...c600.
The later post-76dc12a capture is 18/18, 1185.3941 ms, 119918de...0f35.
Both originals stay intact; neither proves v2 execution. The v2 reviewed capture
is a separate 39/39 producer run. The machine-readable index pins full hashes
and real paths, not these abbreviated labels.

## Verification status

Focused follow-up: 49 tests passed, zero failures/skips/cancellations,
3264.1282 ms. Typecheck and fresh test compilation passed with installed Node
24.14.0 on Windows x64; no dependency installation. Raw producer TAP:
`candidate-effect-v2-followup-focused-20260913.tap`, SHA-256
`61ec1dc396be51b43282d5a6399935dc703694e8fdadab64a335cc0f0196431c`.
The role index was checked against both pinned raw historical TAP files: each
SHA-256 and all six duration/count fields matched. This is artifact comparison,
not a rerun of either historical suite.

Full offline regression: 1838 tests, 1836 passed, zero failed/cancelled,
two existing skips, 49109.7181 ms. Raw producer TAP:
`candidate-effect-v2-followup-full-20260913.tap`, SHA-256
`7b4487b767c59b8f8858090a50cf5239875b07281eaec23ddf6c98124b7fb5b6`.
Skips: unavailable Windows symlink-creation privilege, and the intentionally
non-Windows-only inspector refusal test. Neither is claimed as executed evidence.
Full run used a fresh compilation, `--test-concurrency=4`, all compiled unit tests
and the existing candidate-review-http/candidate-crash script tests. This also
re-executed the changed suite alongside other work; no stress-load guarantee.
No product runtime, schema, capability, signer, provider, VM or OS configuration
changed. No independent execution or acceptance is implied. W1-W5 remain open.
