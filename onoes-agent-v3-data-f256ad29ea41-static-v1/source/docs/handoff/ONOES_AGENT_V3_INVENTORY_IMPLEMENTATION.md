# V3 inventory and checkpoint-history data validation

Baseline `0420349cf66ef16e6bc1b0e84de388938995509b` plus this data-only delta.
Date: 2026-09-15. This is new implementation for targeted review, not evidence
that the earlier design reviewer inspected these bytes. No store, admission,
runtime/UI/HTTP consumer, enrollment, credentials, VM or provider is activated.

## Exact new data surfaces

`windows-candidate-v3-inventory.ts` accepts canonical primitive JSON text, with
metadata independently supplied to every call. No object, callback, I/O, clock,
authority flag or availability predicate is accepted or exported. Public results
explicitly say `not-admission`. Existing v2 modules and consumers are unchanged.

The inventory transport is exactly
`{domain:"agent-candidate-inventory-transport/v1",records:[{recordWire,settlementWire,checkpointAWire}]}`.
Each nested wire is canonical text independently parsed by the existing v3 record
module; absent historical settlement/A is explicit null where that parser allows
it. Record order must be strictly ascending operation UUID; duplicates deny rather
than normalize. There are at most 1,000 rows. The aggregate wire is capped at
64 MiB before JSON.parse; row count is checked before schema traversal/error
collection, and each nested wire retains its separate byte/shape cap. This is a
bounded offline data transport, not a recommended HTTP body size or latency SLA.

Every row is validated, including terminal/quarantined rows. Independent sets
reject reused approval identity, workflow/kind and currently blocking workspace.
No SQL index is relied on. Only released rows leave the private validation set;
that set is not returned as permission. Publication requires its retained released,
completed, passed execution with a matching result and every shared subject field,
and reservation no earlier than parent release. Approval uniqueness also requires
a separately identified publication approval. Actual approval authenticity is not
established by this comparison.

The hash core is the CONTRACT_V3 tuple inventory, not the whole nested records.
Every tuple contains operationId, explicit eventIndex, complete recordDigest,
approvalIdentityDigest and last state. Metadata and operation count are included
in the root. Empty means the exact domain-separated empty root, never a zero hash.

Checkpoint snapshot validation compares this complete SUPPLIED inventory with
checkpoint count/root/subject/event/approval/producer. Global sequence is exactly
the sum of each retained reservation plus explicit events. This deliberately
supports no pruning, migration or extra non-ledger checkpoint kind. The subject
cannot predate any other row's last event under the global monotonic chronology.

The adjacent release-pair checker requires A and B to differ by one global
sequence and one appended release, with B.previousCheckpointDigest equal to A.
No unrelated record or evidence context can change. It is deliberately labeled
an adjacent model, not the only permissible interleaving.

The COMPLETE retained-history checker additionally accepts exactly
`{domain:"agent-candidate-checkpoint-history/v1",checkpoints:[canonicalCheckpointWire]}`.
It requires explicit genesis plus one checkpoint per reservation/event, capped
at 7,001 checkpoint strings and 64 MiB aggregate. It checks each previous digest,
exact sequence, producer, event progression, prefix digest, approval and full
post-commit tuple root. A private historical blocker set rejects overlapping
workspace lifetimes even when final rows are both released. Publication cannot
precede its parent's release checkpoint. Every supplied A must equal its actual
historical checkpoint, including its inventory root. Intervening operations
between A and B are supported and checked; missing or conflicting history fails.
The final checkpoint must cover every complete final record with no omissions.

## Limits and non-claims

Unkeyed consistency does not authenticate completeness. Deleting a row while
retaining the old checkpoint fails; coherently deleting history and replacing its
checkpoint remains a parseable claim. Tests preserve this negative boundary.
Snapshot-only validation does not validate historical A roots; use the full-history
data checker for that relationship, then separately authenticate actual storage,
anchor head, ownership, freshness and all role-specific evidence. Neither checker
supplies those physical facts, actual consent, signing, revocation or admission.

History replay repeatedly hashes bounded growing tuple inventories. Its worst-case
work is proportional to checkpoints times retained rows. The representative 1,000
reserved/released snapshot tests are not a worst-case full-history benchmark, a
memory ceiling proof, hard preemption or production settlement-time evidence.
Those remain host-composition/resource gates, not claims from a pure parser.

Protected storage/anchor/anti-rollback/fencing B-03, enrollment, issuer custody,
real consumers, installer and W1-W5 remain open. The data-only implementation
should receive changed-boundary static review before persistence/consumer design
depends on it. No new public transfer has been approved or performed this turn.

## Local executed evidence

Windows x64 / Node v24.14.0. Typecheck and fresh test compilation pass.
Twelve new platform-neutral inventory/history tests plus the 35 record/data-core
tests: 47/47 pass, no failure/cancellation/skip, 1,210.0111 ms.
Tests include 1,000 reserved and 1,000 released records, 1,001-row rejection,
rehashed cross-row conflicts, omission/substitution, failed/unreleased publication
parents, A/B unrelated-row drift, full interleaved A-to-B history, historical
workspace overlap, missing/reordered checkpoints, and substituted A claims.

Raw focused receipt: desktop `.audit-preparation/v3-inventory-history-focused-20260915.tap`.
Full offline receipt: desktop `.audit-preparation/v3-inventory-history-full-product-20260915.tap`.
Focused SHA-256: `8afc426d0e7951671909e3934240f5825f7a66681f910e6dd7a12c08c984502c`.
Full SHA-256: `b20f8a8eef5ea95e408dd848c41c1f53fb8460eeb284bbd1b9d5f03841b46039`.
Full result: 1,979 tests / 1,977 pass / zero fail/cancel / two skips,
49,212.4926 ms. The unchanged skips remain unavailable Windows link-creation
privilege and the deliberate Windows skip of the unsupported-host inspector test.
They do not close the W4 link/native gate. Full command includes all compiled
test directories plus the synthetic candidate HTTP and crash script suites.
Local execution is producer evidence, not independent execution or release approval.
