# Dense coordinator direct-child stop probe — not physical settlement

2026-09-17. Follow-up to V3_COORDINATOR_CAPACITY's 17.49-second same-event-loop
stall. The parent stays in a separate process and stops the fixed synthetic
child after observing entry to the actual validation port. No production code,
budget, physical adapter, VM, provider, real approval or OS setting changed.
This evidence is outside the unchanged published 71-file audit packet.

## Method

Two children run sequentially, never concurrently: one stops during bootstrap;
the other completes bootstrap then stops during append validation. Each builds
the same deterministic 1,000-operation dense corpus and uses the actual dormant
coordinator/session with in-memory string ledger/anchor ports. Real monotonic
milliseconds replace the ordinary fixture's frozen clock; the normal 30-second
bootstrap and 10-second append budgets remain unchanged.

The test-only port-entry hook emits a fixed numeric/phase message immediately
before validation work. After receiving the requested phase, the parent schedules
its kill call for 50 ms later, then waits for child `close`. Kill's return value
alone never passes the check. The predeclared stop-to-close ceiling is 5,000 ms.
Entry is a test seam, not authenticated evidence of exact CPU position at kill.

Each fixed child has a 180-second parent timeout, 512 MiB V8 old-space setting,
64 KiB stdout/stderr caps, minimal SystemRoot/TEMP/TMP environment, no stdin and
no child-spawning code in its executed branch. These are bounded test controls,
not a sandbox or OS-enforced total-process memory boundary. Only each probe's
own child handle is terminated; no VM, other application or arbitrary PID is used.

## Observations

Base product d7f10ffa7502a6e39bce0b6737fe50a302ad1f73; Node v24.14.0, win32 x64.
UTC window 2026-09-17T20:52:06.377Z–20:52:50.300Z. One sample per phase.

| Stop phase | Entry receipt to kill | Kill to direct-child close | Parent maximum heartbeat interval |
| --- | ---: | ---: | ---: |
| Bootstrap validation | 62.4024 ms | 18.8569 ms | 45.7573 ms |
| Append validation | 51.5664 ms | 31.4637 ms | 47.1669 ms |

Both closes reported SIGTERM with no numeric exit code, stderr, outer timeout,
protocol fault or output overflow. Neither emitted a final completed sample.
The entry messages reported zero local and anchor assignments at that seam.
This is not post-kill state discovery or a claim that arbitrary physical effects
could not have happened. All fixture state was volatile and there were no
filesystem/anchor/approval/task effects to reconcile in this experiment.

The parent scheduler remained responsive to the stop request even though the
child's JavaScript could be busy. This supports using a separately scheduled
supervisor, but does not implement one for the product or prove UI cancellation.
It also does not show that validation-only offload removes coordinator-side
parsing/hashing stalls; that remains a separate placement/measurement question.

## Evidence and limits

docs/reports/v3-coordinator-stop-20260917 retains the exact measure.mjs, receipt,
both raw stdout streams and check-artifacts.mjs. All 29 selected source/compiled/
lock identities were unchanged before/after. Separate producer read-back
(not an independent reviewer) verifies byte hashes, phase order, close results,
stop budgets, sequential child lifetimes and absence of completion output.

Receipt SHA-256:
32412db5fd05c817c059d4521ae11324759872b9782218e713612255df928644
Bootstrap stdout SHA-256:
91f56cdb6004f881e8e81c8b87f0fd83aabc6a10f909ddf4894b6f0192395d9f
Append stdout SHA-256:
52a0f268425a0d0ed71a69aa2c9d8a00b0c593a500a17b811ccf745aac8dbcb2

No production source or unit test changed; the preceding full suite was not
rerun. Its selected identities still verify. These are two executed probe samples,
not two added production tests or a Windows job-wide termination PASS.

C12 remains open: descendant/job settlement, no-replacement-before-confirmation,
authenticated request identity/transport, persistent owner fencing and recovery,
actual dashboard responsiveness, physical storage/anchor and adverse/high-cost
inputs remain unproved. Direct-child closure is insufficient for any of those.
Do not authorize a new owner, worker, retry, task or release from this receipt.
