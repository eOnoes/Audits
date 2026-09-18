# Onoes-Mind repair candidate R1 — review receipt

Status: IMPLEMENTED AND TESTED IN ISOLATION; NOT APPLIED TO CANONICAL SOURCE.
Baseline: X:/SANITIZED/LOCAL_PATH at 6a413043f5ed18fe1f8e27b446971775cb5fe39c.
Worker for this new slice: Codex in the current operator session. This is a work receipt, not a cryptographically authenticated ownership assertion for historical work.

Operator authorized starting the shared-Mind roadmap and offered the trial agents. Earlier instructions explicitly preserve the unowned bridge/cloud-readiness slice and require independent canonical-plan review. The inherited slice has no new closure receipt. This candidate makes the repairs reviewable without overwriting that work. No independent review is claimed.

## Candidate changes

- A01: validate current authentication before cached-response access. Reject malformed MACs and requests signed with the previous key after rotation. Direct dispatch still authenticates.
- A02: reject expired leases at heartbeat and initial/final completion/failure checks. Recovery includes exact expiry. Use explicit immediate transactions for heartbeat/completion/failure/recovery. Retry insertion failure rolls back the predecessor state; retry retains input_context_ref.
- A03, partial only: apply existing credential-pattern screening to worker results before persistence. Does not solve shared-result scope, provenance attribution, arbitrary secrets, all other write paths or authenticated device identity. Those remain deployment blockers.
- A06: require one current revision for active/promoted records, including detection of zero current revisions. Purged records are excluded from this live-record invariant.
- Tests: 21 new regression cases. Fix pre-existing fixture time inconsistencies exposed by real expiry checks and use exact workspace equality rather than a checkout-name suffix.
- Documentation: proposed canonical-plan amendment, staged roadmap and trial inventory. Canonical v4.1 remains unchanged.
- Candidate manifest: refreshed source/test hashes and collection count, with a repair-candidate annotation. Historical campaign artifacts remain inherited and are not claimed to have been regenerated. The full suite does exercise the campaign tests; that is distinct from rebuilding published campaign artifacts.

## Verification actually performed

Before repairs, the 21 new regression cases produced 20 failures / 1 pass against baseline behavior. After repair, all 21 passed (23.61s).

Initial full candidate run: 184 passed / 4 failed. Causes: checkout-name test assumption, inconsistent future recovery clock, and two campaign checks claiming a lease at Unix time 100 then completing at current time. These were corrected without relaxing the new expiry checks.

Final full candidate run: **188 passed in 39.40s**, exit 0. XML: candidate-tests.xml. Python imports explicitly pointed to the isolated candidate using PYTHONSAFEPATH=1 and PYTHONPATH; printed module identity confirmed the candidate. Working directory remained X:/SANITIZED/LOCAL_PATH because the existing task-continuity harness hardcodes that directory. Synthetic suite fixtures may transiently write there and clean themselves; canonical tracked implementation remained unchanged. This is Windows/local evidence only.

Commands used: uv run --offline --no-project --with pytest python, then pytest.main with the candidate tests directory, -q, -p no:cacheprovider, --tb=short and --junitxml. PYTHONDONTWRITEBYTECODE=1. No dependency installation over the network.

The canonical plan amendment was added after the full code suite; only documentation changed after that run. Final candidate inventory consistency is checked separately and recorded with this packet.

Final manifest checks: 2 passed in 20.14s after the documentation amendment.
Git-index applicability check: `git apply --cached --check repair.patch` passed
without writing the index. A working-tree check initially failed because the
Windows archive/checkout and Git blobs have different line endings. The patch
is normalized to LF; the candidate ZIP and manifest bind the raw tested bytes.
Raw archive, current canonical working-preimage and normalized hashes are
recorded separately. At eventual promotion, regenerate the inventory for the
chosen checkout bytes using the provided helper, and rerun manifest tests.
Do not claim the historical raw-byte manifest is portable across EOL conversion.

## Scope still open

Task objectives/checkpoints, cross-store retrieval, persistent shared skills, per-agent/device keys, server resource limits, comprehensive secret policy, worker scope/provenance, migration history and restore policy, recovery capsules/journals, cloud and real runtime qualification remain unfinished. Authentication replay fix does not make a shared test key a production identity system. The replay cache is still volatile and is not durable operation idempotency.

Inventory found X:/SANITIZED/LOCAL_PATH at f7bd479580a59c3d1ea78a523917a6cc7050e84a with existing dirty work. README requires one real test agent at a time. Existing adapter uses legacy HTTP routes, while current canonical bridge is task-only JSON-lines. No trial agent launched and no live endpoint probed. No .env/key files read.

## Promotion gate

Review repair.patch, manifest.json preimages/output hashes, candidate.zip and the test XML against the recorded baseline. Resolve historical ownership by explicit operator/supervisor disposition; do not infer it from this test result or the prior GitHub publication. Review the canonical-plan amendment separately. No automatic patch application, commits, pushes, credentials, cloud, fallback, agent binding or Control boundary changes are authorized by this receipt.

The next implementation slice after promotion should cover common write policy/private results plus persistent objectives/checkpoints and consistent memory retrieval. Do not start real trials before those gates.
