# Immutable original host clock: runtime primitive and code custody

Follow-up: `ONOES_AGENT_V3_METADATA_RETENTION_CLOCK.md` now records controller/
watchdog API migration and the PowerShell clock-method correction. The remaining
work listed below describes this earlier checkpoint; authenticated versioned
transport and physical acceptance remain open in both checkpoints.

2026-09-19 UTC. Baseline `418e21bec4856b91385a225b9ac9acd41fdcb3bf`.
This is local implementation and producer execution, not independent review,
authenticated transport, native file custody or VM evidence.

## Implemented

`tests/probes/windows-v3-metadata-host-clock.cs` supplies a sealed host-run clock.
It captures or receives one original counter timestamp and frequency and owns an
immutable copy of the 32-byte nonzero run nonce and original 1..25,000 ms budget.
There is no public constructor, reset, restart, stop or injected time-reader API.
The receiving factory does not renew time. Every runtime sample obtains current
`Stopwatch.GetTimestamp`, frequency and high-resolution support in the receiver.

The separate internal arithmetic state subtracts original ticks before scaling
using exact decimal integer arithmetic. It charges one extra tick conservatively
for the documented same-host cross-thread uncertainty. Inclusive expiry uses
integer deadlines; elapsed readings saturate at 35,000 ms instead of overflowing.
Invalid origin, changed frequency, missing high-resolution support, regressing
counter or mismatched run/budget permanently invalidates that instance. A public
factory is not proof that input came from the trusted host: authentication and
same-host/boot peer identity remain prerequisites imposed on the future caller.

Work expiry alone does not invalidate the clock: the already-required stop and
retention paths still need their original work+5,000 and work+10,000 deadlines.
The code-preparation deadline remains min(work, 5,000). A clock is never effect
permission, remote stop proof or a persistent authority after a restart.

The existing host-code pin reader, fixed native read hold and joined code-set
owner now accept this clock instead of a mutable Stopwatch. Both native and
joined factories check exact budget agreement before opening any hold. Existing
one-use reads, exact digest checks, disposal ordering, failure poisoning and
retained handle lifetime are unchanged. Fault substitutes can only invalidate
the real clock; they cannot supply or move time. Native methods were compiled,
not executed. The run nonce is intrinsic to the clock; these code-custody helpers
have no independent expected nonce. The future authenticated run owner must call
`RequireRun` with its independent expected binding, not infer it from the clock.

## Executed falsifiers and retained evidence

The new isolated C# suite exercises wrong origin/frequency/budget/nonce shapes,
input and returned-nonce copying, original timestamp/frequency preservation,
future origin, expired receipt, permanent failure after regression/frequency
change, and no public reset surface. Deterministic cases cover every deadline
at work budgets 1/2/5,000/24,999/25,000 and two frequencies, before/at/after the
one-tick conservative boundary; Int64-sized absolute counters, very short
differences and saturation are included. Work-expired/stop-live is explicit.
Local runtime sampling exercises the actual facade. This new suite does not
launch a second process; the prior cross-process QPC probe remains separate
historical evidence, not a test of an authenticated clock transport.

Existing real set-owner/fake-hold tests now invalidate this clock during opening,
reading and checking; mismatched work budget rejects before any fake hold and
cannot be healed by retrying the original budget. Memory-reader fault tests
retain their byte-erasure and one-use checks under the new clock type.

`scripts/capture-v3-metadata-host-clock.mjs` retained create-only raw outputs in
`docs/reports/v3-metadata-host-clock-20260919/`. All **39 compile targets** and
**32 isolated arithmetic/local-counter/fake suites** passed. All **429 metadata
Node tests** passed, zero failures/skips/cancellations, 35,610.4022 ms. The capture
ran on win32/Node v24.14.0, 05:56:25–05:57:09 UTC, with 172 selected source/test/
script identities unchanged. These are producer results. `codeLoaded: false`
in the receipt refers to the protected host-input package/native library, not
the explicitly executed arithmetic and fake-test executables.

## Unfinished integration — no physical advancement

Controller/native retention and PowerShell watchdog paths still require their
old process-local Stopwatch; they must migrate to this shared origin before a
physical launcher can compose them. Existing OMH1/OMWI/ARM bytes are unchanged
and do not authenticate or persist the origin. The versioned startup/retention
binding, cross-process facade test, protected bootstrap and runtime placement,
independent watchdog lifetime and Node host-clock bridge remain work. Do not
adapt between the two APIs by starting a new clock or treating legacy bytes as
the new context. Historical read-only clock APIs remain separate by design.

No loader, service, protected root, VM, guest command, credential operation,
provider, network transfer or privileged setup was used. The previous local host
package remains a historical artifact, not an updated package for these sources.
All M00–M12/W1–W5, partial-rollback, upgrade and release acceptance gates remain.
Review the combined clock/startup/transport boundary before requesting a scoped
physical run; no outside audit or production authorization follows from this pass.
