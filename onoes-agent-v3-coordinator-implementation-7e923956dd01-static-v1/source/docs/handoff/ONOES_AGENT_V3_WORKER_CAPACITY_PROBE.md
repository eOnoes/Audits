# Fixed-child capacity/stop probe — not the product worker

2026-09-17. Producer execution of fixed synthetic data validation in two sequential
Node test children. No product worker, storage adapter, authenticated anchor, VM,
provider, approval, task, installer or Windows configuration was activated.

## Method and limits

One normal sample, then one cancellation sample. Each child has a 180-second
parent timeout and `--max-old-space-size=512` (V8 old-space, **not** OS/RSS/total
process memory enforcement). There is at most one child, with a fixed script and
minimal SystemRoot/TEMP/TMP environment, no stdin, bounded 64 KiB stdout, and no
child-spawning code in its executed measurement branch. This is not a sandbox.

The corpus is 1000 execute/completed operations: all reservations, then all five
event rounds. Bootstrap sees 6000 checkpoints, then one final release reaches
6001. This fills the operation ceiling, NOT the 7001 structural history ceiling,
maximum permitted wire bytes, all event shapes or worst-case histories. Corpus
generation is separate from validation timing. All original metadata, records,
checkpoints, roots and historical generations use the existing pure contracts.

The probe JSON-encodes/decodes bootstrap strings, performs full-reference
bootstrap, one incremental append, a synthetic read-back snapshot validation,
and hashes the post-state wires. It does not transmit a real IPC request or
write/read SQLite/anchor storage. Parent 25 ms heartbeats measure the probe host's
event-loop scheduling, not the real dashboard. No minimum-hardware or percentile
result is claimed; compiler activity elsewhere overlapped part of this run.

Cancellation is triggered 50 ms after the child reports bootstrap entry. The
parent records the return from kill and then waits for **close**, not merely the
kill return or stdout. This demonstrates direct test-child closure only; it is
not authenticated request settlement, job-wide descendant termination, nor a
replacement-worker admission witness.

## Observed sample

Node v24.14.0 / win32 x64; source base `09be9332f9274c71373d1ce9192a0a0e57fdfe3d`
with the explicit working-tree delta recorded, selected source/compiled
identities unchanged before/after. Window 2026-09-17T03:02:18Z–03:03:19Z.

| Quantity | Observation |
| --- | --- |
| Final inventory | 6,819,063 bytes |
| Bootstrap history | 5,379,600 bytes |
| Encoded bootstrap probe envelope | 13,586,464 bytes |
| Corpus setup (excluded below) | 19001.4916 ms |
| JSON encode/decode | 85.6694 ms |
| Full bootstrap | 21368.6174 ms |
| Final incremental append | 618.3072 ms |
| Synthetic read-back validation | 371.8989 ms |
| Post-identity hashing | 8.3024 ms |
| Sum of those measured validation/transport pieces | 22452.7953 ms |
| Peak RSS including setup (Node-reported) | 328572 KiB |
| Largest parent heartbeat interval, normal/cancel sample | 47.1992 / 46.3030 ms |
| Cancellation kill-to-direct-child-close | 12.9506 ms |

The normal child exited zero with no stderr; the cancellation child closed with
SIGTERM and emitted no completion result. Neither hit the 180-second guard.
The normal bootstrap sample fits the proposed 30-second bootstrap target, but
one sample cannot establish usable margin or worst-case support. The 10-second
ordinary-pair target is **not** verified by a 0.62-second pure append: database,
authenticated IPC/anchor, checks and scheduling are missing.

## Exact evidence and remaining acceptance

`docs/reports/v3-worker-capacity-20260917/receipt.json` binds the helper, runtime,
selected input identities, timestamps, both exits, raw stdout and byte hashes.
Normal stdout SHA-256:
`920ed8da7eeac84a872a0106def9297b7a76d7861746af34f28faf9bc7cbec92`.
Cancelled stdout SHA-256:
`ced8cb500cabf474eb79bea0b66b087c2fac5157991ac873549383b468d91b0b`.
Exact script retained as `measure-v3-worker-capacity.mjs.txt`; private checkout
paths require labelled sanitization before any approved public transfer.

C12 remains PARTIAL at probe level and NOT RUN for actual composition. Missing:
maximum-byte/adversarial histories, repeated/concurrent representative workloads,
real coordinator/dashboard responsiveness, whole-process resource enforcement,
storage/anchor latencies, physical settlement/descendants and independent runs.
Do not silently lower product capacity or increase its proposed budgets to claim
completion. This evidence informs the combined design/harness review, not release.
