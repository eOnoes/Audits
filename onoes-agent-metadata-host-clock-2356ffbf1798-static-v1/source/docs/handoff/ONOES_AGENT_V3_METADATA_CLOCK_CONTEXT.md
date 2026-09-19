# Versioned original-clock data and actual local process transfer

2026-09-19 UTC. Baseline `7f5de54fef6c3fe097984becd97e74d86e59da78`.
This checkpoint adds bounded clock data and a receiving adapter. It does NOT
establish an authenticated host channel or migrate the existing retention/ARM
formats. All physical and production-consumer gates remain open.

## Implemented fixed wire

`windows-v3-metadata-host-clock-context.cs` defines OMK1, exactly 128 bytes.
Unsigned integers are little-endian. No text decoding, variable lengths, paths,
commands, environment, credentials, callbacks or handles occur in this wire.

| Offset | Bytes | Meaning |
| --- | --- | --- |
| 0 | 4 | ASCII `OMK1` |
| 4 | 32 | Original nonzero run nonce |
| 36 | 8 | Original host counter ticks, 1..Int64.MaxValue |
| 44 | 8 | Counter frequency, 1..Int64.MaxValue |
| 52 | 4 | Original work deadline, 1..25,000 ms |
| 56 | 4 | Stop deadline from the original origin, exactly work+5,000 |
| 60 | 4 | Retention deadline from that origin, exactly work+10,000 |
| 64 | 32 | Nonzero independently supplied host-session pin |
| 96 | 32 | SHA-256 of ASCII `onoes-metadata-host-clock-context/v1` + NUL + bytes 0..95 |

The reference is SHA-256 of ASCII
`onoes-metadata-host-clock-reference/v1` + NUL + the entire 128-byte wire.
Length is checked before cloning. Construction and parsing validate every field;
mutable caller arrays and returned arrays cannot alter the owned context.

`MetadataHostClockTransfer.CreateInTrustedHost` snapshots an existing immutable
run clock, checking work liveness before and after encoding. It does not capture
a new origin. `ReceiveInTrustedHost` first validates the record and matches the
independently supplied reference, host-session pin, nonce and original work
budget. Only then does it construct the receiving runtime clock with the original
ticks and frequency. The receiver samples its own current QPC and rejects future
origins, changed frequency and expired work. No wire can make it restart a watch.

## Authentication boundary — still not implemented

The host-session pin is an opaque binding supplied by the already-trusted host,
not an OS boot identifier, token, machine identity or proof of a retained peer.
The protected launcher must associate it with ONE live host/boot/launcher
generation and independently authenticate the receiving participant. A checksum
or caller-supplied expected pin does not perform that work. Do not derive the
expected reference or expected host-session pin from the untrusted incoming wire
and call that authentication. Public factories confer no authority.

Legacy OMH1 controller intents (164 bytes), OMWI watchdog intents (208 bytes),
terminal records and ARM JSON are untouched. They still do not bind OMK1. Before
physical composition, explicit successor formats must bind this exact context
reference, separately enrolled evidence root, writer role and all existing run/
inventory/bundle/fixture pins. ARM must echo the same independently expected
context, and controller admission must compare it before any guest dispatch.
New records need explicit versioned handling; no automatic reinterpretation,
old-record adoption, silent fallback or historical approval reuse is acceptable.
The existing historical readers must remain non-authorizing.

Receiving a live clock must occur before work expiry; late/restarted processes
may inspect historical data but may not manufacture a renewed run. Node's local
`performance.now()` is not this clock epoch. An actual enforcement participant
still needs the trusted host-clock bridge and independently retained lifetime.

## Executed tests

The isolated C# context suite checks all 128 single-byte mutations, every short
prefix, oversize/legacy lengths, wrong header, zero pins, unsigned values above
Int64.MaxValue, invalid budgets, defensive copies and independently mismatched
reference/session/nonce/work. Coherently rehashed changes still fail the original
external reference. It also exercises the runtime encoder/receiver and refuses
encoding from an invalidated clock. No native metadata methods are linked into
that test target.

`scripts/test-v3-metadata-clock-transfer-process.mjs` verifies the fixed test
executable against the just-produced pinned compile receipt, then launches only
its guarded synthetic modes. It does not run the native host DLL. Separate local
processes capture and receive the real facade through test-only command-line
arguments. This is explicitly NOT the future protected startup channel.

Node independently reconstructs field bytes and BOTH hash domains, including a
golden vector with ticks `123456789012345678` (above JavaScript's safe-number
range). The receiving process retains the original ticks and frequency exactly.
After a deliberate 125 ms test delay, its elapsed reading was **197 ms**, within
independent BigInt bounds **186..197 ms** bracketed by the receiver's own QPC
samples. The observed values depend on scheduling; the inequalities and unchanged
origin are the controls. Four rehashed origin/frequency/nonce/session edits deny
against the original pin. Even with freshly recomputed pins, changed frequency,
a future origin and an expired origin deny at the real runtime clock.

The producer capture `scripts/capture-v3-metadata-clock-transfer.mjs` retained
raw outputs and before/after identities under
`docs/reports/v3-metadata-clock-transfer-20260919/`:

- 40 C# targets compiled; 33 isolated data/arithmetic/local-counter/fake suites
  passed. Native targets were compiled only.
- The local process-transfer experiment passed (10 bounded process invocations).
- 435 metadata Node tests passed, zero failures/skips/cancellations,
  42,531.7539 ms. This is not an independent execution or release pass.
- 181 selected source/test/script inputs stayed unchanged, win32 / Node
  v24.14.0, 06:25:41–06:26:32 UTC.

The executable checks are local build snapshots followed by ordinary path launch,
NOT protected install-root/loader custody. No privileged setup, VM, Hyper-V,
guest, credential, provider, network transfer or real approval was used.
Current storage/ARM version migration, protected authentication and lifetime,
physical M00–M12, partial rollback/upgrade, packaged workflows and W1–W5 remain.
The combined startup/clock/transport boundary needs review before physical use.
