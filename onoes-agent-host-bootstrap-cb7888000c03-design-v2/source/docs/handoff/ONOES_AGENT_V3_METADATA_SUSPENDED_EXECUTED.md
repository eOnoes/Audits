# Approved suspended-child native checks

2026-09-19 UTC. Producer-local execution against baseline
`4d0655865efe0b512421ae2e85532b1585571f3b`, following the operator's explicit
approval of the three suspended-child checks. This is not independent execution.

## Observed result

The create-only runner completed between 20:24:47.590Z and 20:24:52.181Z.
`docs/reports/v3-metadata-host-suspended-native-20260919/execution.json` and its
three separate mode receipts retain the results and source/runtime identities.

| Mode | Result | Fixture exit / close | Outer kill |
| --- | --- | --- | --- |
| dispose | PASS | 0 / observed | none |
| deadline | PASS | 0 / observed | none |
| duplicate-create | PASS | 0 / observed | none |

The unchanged runner reports inputsUnchanged=true and passed=true. Subsequent
read-only checks rehashed all eight recorded input/artifact pins (size and SHA-256)
and compared the three per-mode receipts against the aggregate: all match.
No failed attempt or automatic rerun occurred for this prepared sequence.

## Meaning and limits

The trusted native fixture checks retained process identity, job membership and
limits, a live intended pipe before stop, EOF after confirmed stop, exclusion of
an intentionally inheritable unlisted sentinel, and duplicate-creation denial.
Its stop observation requires both the retained process signal and zero job
members. All three modes create a fixed suspended child; no resume API is used.

The Node observer verifies exact fixture success output plus exit and close.
It does NOT independently observe the descendant: descendantStop remains
reported-by-native-fixture and processTreeSettlement remains false. This is
neither a kernel suspend-count measurement nor proof of protected loader custody.
Executable hashes detect drift; they are not immutable installation custody.
The historical artifact filename suspended-smoke-NOT-RUN.exe is a preparation
label; this receipt, not that filename, records its subsequent approved execution.

No VM contact, privileged installation, service activation, credential access,
provider calls, task execution or real approval consumption was performed.
The original preparation document is retained as historical evidence.

## Next boundary

Child endpoint admission and clearing of inherited flags remain unimplemented
in this suspended-only fixture. Prepare that fixed-role contract and its pure
failure controls next, without resuming this child or repurposing the three-mode
approval. Any new native execution needs its own scoped authorization.
Independent S prearming and G/S lifetime, protected runtime custody, physical
stop/storage composition and W1-W5 release acceptance remain open. These passes
do not authorize a production consumer or establish filesystem confinement.
