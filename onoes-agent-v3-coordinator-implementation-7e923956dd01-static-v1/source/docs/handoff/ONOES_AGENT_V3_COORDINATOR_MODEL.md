# V3 coordinator executable fault model

2026-09-17. Test-only model, not the released coordinator. The real pure
`createCandidateV3IncrementalClaims` participates in asynchronous staged/confirmed
ordering. Ledger, anchor, owner, fence, authority and clocks are in-memory test
stand-ins. They are intentionally mutable by a test driver; their booleans and
strings prove no physical fact. No filesystem, SQL, process, provider, task or
production consumer port is present. No claim of independent execution is made.

`tests/helpers/candidate-v3-coordinator-model.ts` captures primitive candidate
bytes and pre-state before advancing T, validates bound request/response messages,
rechecks live epoch/head and complete pre-state, atomically assigns the modeled
local inventory/history, reads it back, records an anchor attempt before contact,
and promotes only after exact confirmation. A fault after staging closes T with
no rewind. Fault cuts inside the simulated transaction are synchronous test
instrumentation, not a proposed caller callback inside a real database transaction.

The synthetic worker intentionally uses full reference history checks for its
post-identity oracle as well as the actual incremental validator. This is useful
for correctness testing, but is NOT the intended incremental worker's performance
implementation. Repeated replay in this fixture must not be used to estimate the
future worker's throughput or memory. The smaller message profile likewise is not
the product's supported-capacity limit.

## Controls exercised at model level

| Controls | Executed failure seam / assertion |
| --- | --- |
| C01 | T advances, transactional preflight fails; later calls remain closed, no commit |
| C02 | Changed metadata, history, same-count row, unrelated completed row, or optional A context rejects before write |
| C03 / D4 | Wrong bound reply or live epoch/head drift after settlement rejects before transaction |
| C04 | Caller container changes during await; persisted primitive bytes remain exactly staged |
| C05 | Before/after local commit, read-back corruption/loss, before/after anchor append and pre-promotion loss; no compensating write or repeat |
| C06 | Virtual deadline or abort returns while synthetic work is unsettled; replacement stays blocked, late success never promotes |
| C07 | Revoked forward policy can witness a commit only with reserved settlement authority; owner remains closed afterward |
| C08 | Crash at every named phase; existing owner blocks re-instantiation; explicit test retirement allows only fresh full equal-stream replay, no redispatch |
| C09 | Competing client rejects with one pending request and no queue or second owner |
| C10 / C13 | Full bootstrap stream relation; one-ahead, two-ahead, shorter, divergent and missing genesis reject normal startup; transaction identity covers the local tail |
| C11 | Lost acknowledgment around outcome A / release B cannot yield forward readiness |
| D3 message model | Strict bootstrap/append envelopes, operation/lifetime/request number, rehashed identity substitutions, stale bootstrap/prior append replies, result digest and distinct request/response caps |

Eight outcome families have 53 successful sequential paired appends as positive
controls. This is not exhaustive pairwise scheduling, independent verification,
or proof that either physical side persists. Model crash leaves in-memory bytes
available to inspection; it does not simulate OS power loss. The world retains
its owner latch on faults; explicit test retirement is not authenticated fencing.

## Executed producer evidence

### Model-review follow-up (M-1, M-2, M-3)

The model now counts exact canonical UTF-8 string escaping before allocating a
complete request, including combined payload size and fixed envelope overhead.
requestEncodings increments only after this preflight. Tests cover individually
small but jointly oversized strings, escaping expansion, invalid surrogates,
and exact-cap versus cap-plus-one boundaries for ASCII/control/BMP/astral text.
Failed bootstrap attempts are counted before work and latched on the world;
constructor recreation cannot retry them. Only explicit synthetic retirement
after activity settles permits a new epoch/attempt, never an automatic reset.

A transaction-post anchor drift control deliberately observes one local commit,
zero anchor attempts and zero promotions, with the owner closed. This distinguishes
the pre-transaction/full-stream and post-commit relation checks from the local
transaction's pre-state identity check. It does not invent a cross-store atomic
snapshot or call the anchor inside the transaction.

Current model suite: 27/27; focused regression: 96/96, zero failures/skips.
Exact follow-up evidence and limitations are retained in
docs/reports/v3-model-review-followup-20260917; see
V3_MODEL_REVIEW_DISPOSITION for full-run status. Prior runs below remain historical,
not receipts for the revised helper. These tests do not implement a production
coordinator or close C12/physical admission.

### Current bootstrap/lifetime follow-up

At base `09be9332f9274c71373d1ce9192a0a0e57fdfe3d` plus explicit working-tree
delta, test compilation/no-emit checks passed. The model now has **23** cases;
focused data/record/inventory/pair/model **92/92**, zero failures/skips,
1389.4636 ms. Full offline **2087 tests, 2085 pass, zero failures, two known
skips**, 246919.845 ms. Window 2026-09-17T03:06:06Z–03:10:14Z, Node v24.14.0,
win32 x64. Selected before/after source/compiled identities match. Exact evidence
is `docs/reports/v3-worker-messages-20260917/` and supersedes the earlier run below
for the current message-model bytes, without rewriting that historical receipt.
Focused SHA-256: `a960ec0397490af5f905e53641010f3f0bac4e9f236825acb55117757fcef39c`.
Full SHA-256: `e9b31e6ed7f50497f79b7903639acbc24b6965257088e1ee7edb8a8d4feb34ee`.
The skips remain unavailable Windows symlink privilege and the non-Windows-only
inspector refusal. The separate capacity probe has different exact source scope,
commands and evidence; do not merge it into this test count.

### Prior model-only checkpoint

At base `2e1ec6db2c66df4d708b1b703000e09ff3199c07` plus the explicit new
working-tree delta, direct test compilation and no-emit type checking passed.
On win32 / Node v24.14.0, 2026-09-17T02:49:05Z–02:54:00Z:

- Focused data/record/inventory/pair-claims/model: **87/87**, zero failures/skips,
  1397.7352 ms. The model suite contributes 18 cases and 53 paired appends.
- Full offline: **2082 tests, 2080 pass, zero failures, two skips**, 293148.7136 ms.
  Skips are unavailable Windows symlink-creation privilege and the intentionally
  non-Windows-only inspector refusal test. Neither proves link isolation.
- Selected source/compiled dependency identities match before and after both
  runs. Existing configured source-pattern scan passed; no secret-absence proof
  beyond that scan is implied.

Exact raw TAP, helper and receipt: `docs/reports/v3-coordinator-model-20260917/`.
Focused TAP SHA-256:
`9a1e7a464da4789a97362aa7e4a2307edfa8d2efbafc967264aa737d13d220e0`.
Full TAP SHA-256:
`f8e1a87384f0116bc454137a3127db7f8adcb20b551bc7964a1d7b811bf52305`.
Receipt paths are private; any future public packet needs explicitly labelled
sanitized derivatives and the operator's scoped transfer approval. These are
producer executions, not independent verification or release acceptance.

## Outstanding physical and capacity work

C01-C13 physical composition remains NOT RUN. C12 maximum-history end-to-end
allocation, deadline, stop and dashboard responsiveness is not covered even at
model scale by the current small-fixture tests. True transactional isolation,
cross-process ownership/races, storage protection, fresh authenticated anchor
read-back, real worker request settlement, termination/descendants, persisted
restart discovery and installer recovery require separately authorized physical
tests. There is no one-ahead reconciliation implementation; the model denies it
rather than creating an implicit repair path. D3 bootstrap JSON envelopes are now
modeled; binary transport, authenticated lifetime and resource enforcement remain
design-only. See WORKER_MESSAGE_DESIGN and the separate WORKER_CAPACITY_PROBE.

This model is a combined-review input, not the production acceptance gate. Do not
wire it through a runtime barrel or dashboard; do not convert test-world flags
into trusted host APIs. Next work is the missing capacity/worker-boundary evidence
and review of the proposed actual composition before activating any such boundary.
