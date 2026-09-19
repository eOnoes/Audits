# Joined host-code custody owner -- not a loader

2026-09-19 UTC; baseline `54d786952eb24129b1c01aca5c97967862d17b99`.
Local producer compile/fake-hold evidence only. No native holds, code load,
privileged setup, VM, credentials, providers or external transfer.

## Composition

`MetadataHostCodeSet` joins the existing `HostCodeReadHold` instances for the
retention library, watchdog core and retained-watchdog wrapper. The API accepts
three immutable pins in those exact roles, one independently enrolled program
root/file ID and one original clock/work budget. It refuses swapped roles before
opening anything; all three holds receive the identical root and clock inputs.
There is no supplied factory callback or duck-typed hold in the native assembly.

The factory acquires ALL three native holds before any byte read. It then obtains
each hold's exact checked bytes, rechecks every hold and the shared five-second
preparation bound, and only then returns an owner. Nothing returns a partial set
or a file path. Failed setup attempts every acquired disposal in reverse order,
clears captured bytes and throws a fixed unavailable error without raw diagnostics.

For each role, `TakeCheckedBytes` consumes one opportunity, checks the complete
set, clones its checked bytes, checks the complete set again and checks the
original preparation deadline before returning. The owned original is cleared;
the returned copy belongs to the trusted caller. Duplicate or invalid-role calls,
failed rechecks and invalid/expired clocks poison the owner permanently.

Once an owner has been returned, a failure does NOT automatically dispose its
native holds: already returned code may be executing. The poisoned owner denies
further handoff/use but retains custody until the trusted caller finishes use and
disposes it. Disposal attempts each hold independently even when another fails,
clears all remaining byte buffers, and is single-attempt/idempotent thereafter.
The caller must not dispose while loaded code depends on these files. This API
cannot observe or prove that such code has stopped.

`CheckForUse` checks all three original holds inside the original 1-25,000 ms
work allowance; all preparation/handoffs use its first five seconds. No clock
starts or renews here, and synchronous native calls remain non-preemptible.

## Tests actually run

The same set-owner source is compiled against the real holds in the native DLL,
and separately against a test-only nested hold class in `host-code-set-tests.exe`.
That isolated test links no filesystem, P/Invoke, process or runtime loader.
It verifies:

- exact open-all/read-all/check-all ordering and the identical root/clock inputs;
- a failure at each of the three open/read/check positions, without partial return;
- reverse cleanup of every acquired hold and clearing of every captured buffer;
- all eight combinations of disposal failures, with no skipped or repeated close;
- stopped clocks during open, read and final checking (injection, not slow disk);
- one-use role handoffs, caller-copy independence after disposal, poison persistence,
  invalid roles, swapped pins and pre-open invalid clock;
- no premature disposal after a failure following successful factory return.

Three Node source/link assertions additionally cover native/fake closure
separation, factory ordering, rechecks around copying, and absence of a loader.
These are source assertions, not OS-level custody tests.

`scripts/capture-v3-metadata-host-code-set.mjs` captured 05:20:51.759Z through
05:21:35.190Z, Windows x64 / Node v24.14.0. **38 C# targets compiled**, **31
pure/fake-native suites passed**, and **400 metadata tests passed**, zero
failures/skips/cancellations, 35,676.8167 ms for the Node suites. All **160**
selected input identities remained unchanged. Exact commands, source/toolchain
identities and raw outputs are in `docs/reports/v3-metadata-host-code-set-20260919/`.
No independent review or full product regression is claimed.

## Unchanged trust and release boundary

This groups three selected inputs; it does NOT define the entire executable,
CLR/GAC/native dependency, PowerShell module or directory-inventory closure.
The already-trusted bootstrap requirement in ONOES_AGENT_V3_METADATA_HOST_CODE_HOLD.md
still applies: loading the helper first does not authenticate that earlier load.
No root is provisioned or enrolled and no caller is authenticated by these APIs.

Protected bootstrap/runtime placement, constrained dependency resolution,
independent watchdog lifetime, controller IPC and guest delivery still need
implementation and combined review before an explicitly authorized physical run.
This result does not close M00-M12, W1-W5, AJ09/PA06/PA07 or PA15, nor authorize
production dispatch or reset any approval, owner or quarantine state.
