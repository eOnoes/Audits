# Onoes Mind — Current Codex Build Plan

> **Status:** CANONICAL BUILD GUIDANCE — proposal/implementation contract, not deployment authorization.
> **Owner:** Onoes Mind repository.
> **Last reconciled:** 2026-09-01 local working tree.

## Source-of-truth order

1. Current executable code, migrations/schema, tests, and actual runtime behavior.
2. Canonical path and architecture documents in this repository.
3. This file.
4. `ONOES_MIND_CODEX_EXECUTION_PLAN.md`, `RUNTIME_INTEGRATION_PHASE_10_PLAN.md`, and `PHASE_BRIDGE_POC_PLAN.md`.
5. Historical audit reports and summaries.

If documents conflict with code/schema/tests, stop and record the contradiction. Do not create a second ledger or silently retrofit a different architecture.

## Authority boundary

```text
Agent/Control adapter → authenticated Mind API → canonical durable store
                                          ↓
                                  reviewed projections
```

Mind owns durable identity, scoped memory, shared knowledge, cross-agent history, corrections, forget/reset, provenance, and coordination events. Mind does not execute local shell/SSH, GPU, process, deployment, or browser commands.

## Always preserve

- Existing canonical ledger and path decisions.
- Immutable identity/content separation.
- Parent work items separate from child stage executions.
- Transactional outbox where stage state and outbound intent must agree.
- Optimistic lease/version fencing; late workers cannot mutate newer state.
- Quarantine and scope enforcement in policy/database constraints, not agent discipline.
- Provider credentials remain in the owning adapter; never pass raw keys to workers.
- Local operation remains possible when remote Mind is unavailable.
- Dirty working-tree changes are preserved; no reset/clean/overwrite.

## Build order

### Phase 0 — Current-state audit

Confirm repository path, remote/branch, working tree, entrypoints, schema/migrations, tests, integrations, and current uncommitted work. Write or update an exact audit artifact before implementation.

Gate: baseline failures are separated from new failures; no live providers or credentials are used.

### Phase 1 — Canonical memory contract

Verify/implement scoped records with candidate, active, rejected, superseded, disputed, expired, and archived states. Every record carries provenance, principal, scope, generation, and source reference.

Gate: source row is authoritative; derived indexes cannot resurrect deleted or superseded content.

### Phase 2 — Scoped operations

Implement/verify submit, query, correct, forget, and reset with principal/scope checks, idempotency, generation fences, and explicit receipts.

Gate: no cross-scope recall, no deleted recall, no unexplained writes.

### Phase 3 — Replay and restart safety

Implement/verify durable cursors, event IDs, duplicate handling, stale cursor behavior, outbox/inbox semantics, lease expiry, and restart recovery.

Gate: replay is deterministic and late workers cannot mutate newer state.

### Phase 4 — Control/Agent adapter

Expose only authenticated, versioned adapter operations. Browser and local executors do not access Mind storage directly. Mind data cannot authorize Control execution.

Gate: offline, auth failure, schema mismatch, and stale-state behavior are explicit.

### Phase 5 — Derived retrieval (later)

Add FTS, embeddings, graphs, capsules, or semantic retrieval only after the canonical layer passes deletion, correction, reset, and scope tests. Derived data is rebuildable and marked stale when invalid.

## Codex per-task contract

Every task must include:

```text
Goal
Exact files in scope
Schema/source-of-truth checked
Existing behavior to preserve
Acceptance checks
Forbidden actions
Stop conditions
```

Codex must not invent paths, create a second authority, use credentials, contact live providers during audit, or call a fluent result verified without evidence.

## Required closure evidence

- exact schema/migration files inspected;
- changed-file list;
- tests and exact results;
- authoritative source rows checked;
- derived-index/projection state checked;
- redacted receipt/trace;
- restart/replay result where applicable;
- unresolved gaps classified.

A completion message without this evidence is `CONDITIONAL`, not `VERIFIED`.

## Drift check

Before every phase and at closure, compare plan claims against actual migrations, column names, state enums, imports, runtime entrypoints, API routes, tests, and current repository status. Record contradictions and stop rather than guessing.
