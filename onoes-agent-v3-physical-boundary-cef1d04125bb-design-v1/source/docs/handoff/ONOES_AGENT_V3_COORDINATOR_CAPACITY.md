# Actual dormant coordinator capacity sample — synthetic ports only

2026-09-17. This measures the real build-only coordinator/session/messages and
snapshot code against the retained dense synthetic corpus. It is not the earlier
pure-validator-only timing, nor a physical worker/storage/owner/IPC experiment.
No production source changed. The published 71-file audit packet is unchanged;
this later evidence is private and outside its frozen scope.

## Method and predeclared controls

One sequential fixed Node child, 512 MiB V8 old-space ceiling, 180-second parent
guard, 64 KiB stdout/stderr byte caps, minimal SystemRoot/TEMP/TMP environment,
no stdin or child-spawning branch in the child. These are test resource controls,
not a sandbox or OS committed-memory/RSS limit. No task, real approval, VM,
provider, privileged installation or OS change occurs.

The deterministic corpus retains 1,000 execute/completed operations. Bootstrap
sees 6,000 checkpoints with the last release pending; one append reaches 6,001.
It is a dense valid-history workload, not an assertion of maximum admissible
bytes, maximum cost, every lifecycle outcome or the 7,001 structural cap.

The existing coordinator test fixture supplies in-memory string ledger and
anchor ports, the actual validation session and exact read-back checks. Its
ordinary fake clock is replaced for this probe by a getter using floored
performance.now(), so deadlines advance during synchronous validation. No budget
override is passed: bootstrap remains 30 seconds and append 10 seconds. Setting
a frozen fake clock would have made the deadline result meaningless.

After successful bootstrap, zero local/anchor assignments are required. After
the final append, exact final identity/head/anchor equality and one assignment
each are required. Coordinator status must show one bootstrap, one request, one
commit, one anchor append, one promotion, zero pending ports and ready phase.
These are synthetic call/assignment counts, not physical effect evidence.

Both parent and child schedule 25 ms heartbeats. The child deliberately yields
after the back-to-back bootstrap/append before reading the heartbeat result;
otherwise zero callbacks during a blocked loop could be misreported as no lag.
Its heartbeat is neither the actual dashboard nor a per-phase stall breakdown.

## Observed result

Base product: 3787b7e4db9632574a63eb12b5626bd5e65da04e.
Node v24.14.0, win32 x64. UTC 20:45:44.714Z–20:46:16.782Z on 2026-09-17.
One normal sample only; no percentile, minimum-hardware or concurrency claim.

| Quantity | Observed |
| --- | ---: |
| Corpus setup, excluded from operation budgets | 13,949.6001 ms |
| Actual coordinator bootstrap | 15,745.3998 ms |
| Actual coordinator append | 1,642.4389 ms |
| Final inventory | 6,819,063 bytes |
| Bootstrap history | 5,379,600 bytes |
| Bootstrap local snapshot | 13,586,477 bytes |
| Child maximum heartbeat interval, back-to-back work | 17,491.2635 ms |
| Separate parent maximum heartbeat interval | 45.9119 ms |
| Child peak RSS, including setup | 498,792 KiB |

The pair confirmed and the child closed with exit 0, no stderr, no timeout or
output overflow. The exact final inventory, bootstrap history and final head
match the retained earlier pure-validator corpus, checked from separate retained
files. All 29 selected source/compiled/lock identities were unchanged before/after.

The operation deadlines passed for THIS sample. Responsiveness did not: the
in-process synthetic composition blocks its event loop for seconds. Do not run
this whole workload on the dashboard/request/cancellation event loop, and do not
label the parent heartbeat as evidence that doing so would be safe. Separating
the validation process alone still requires measuring the coordinator's own
encoding, hashing, snapshot parsing and read-back work. No worker or deployment
choice is approved by this result.

## Evidence and next gate

docs/reports/v3-coordinator-capacity-20260917 retains measure.mjs, receipt.json,
sample.stdout.jsonl and a separate check-artifacts.mjs read-back verifier.
Raw sample SHA-256:
1f681409c14cc287c81a30fdc22075f83bcd29b15fb062e7de748d125e3bc949
Receipt SHA-256:
dead8cbc4da2dff87e4b685db81291b6867b304e86e91cf69c39fa044e24ec05

The verifier checks recorded exits/limits/counts, raw hashes, selected identities,
earlier corpus equality and the observed responsiveness gap. It is producer
read-back, not an independent execution or audit. The previous 143-focused /
2,138-total offline suite was not rerun for these evidence/docs-only additions;
selected executed code is unchanged from that checkpoint.

C12 stays OPEN: actual responsive coordinator/dashboard hosting and cancellation,
bounded authenticated transport, storage/anchor timing, OS-wide memory and
descendant stop, high-cost/adversarial valid and invalid input, representative
hardware and independent evidence are still missing. The pending external
coordinator review is also not replaced by this measurement. No physical
storage/owner/worker/consumer/installer or activation is enabled.
