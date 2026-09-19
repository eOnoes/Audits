# Original host deadline across independent processes

Implementation follow-ups: `ONOES_AGENT_V3_METADATA_HOST_CLOCK_IMPLEMENTATION.md`
records the immutable runtime primitive and code-custody migration;
`ONOES_AGENT_V3_METADATA_RETENTION_CLOCK.md` records the retention/watchdog API
migration. Versioned authenticated origin binding is still unfinished. The
original probe evidence and design statements below retain their historical scope.

2026-09-19 UTC. Source baseline `2c97e4421ef95a4ba8d8d260eafa35c65d3fc448`.
Design decision supported by ordinary-process, read-only probes. No physical
metadata methods, VM/remoting, privileged setup, credentials or provider calls.

## Concrete integration constraint

The current watchdog, retained-watchdog bridge, native sinks, controller retention
and host-code owners consume an existing `System.Diagnostics.Stopwatch`. This
correctly counts reservation/preflight against invocation in ONE process. It is
not a cross-process timing protocol, and the detached physical launcher does not
exist yet. No passing native result is being withdrawn.

The new guarded PowerShell fixture serializes/deserializes a running Stopwatch
through PSSerializer locally. The result is not a Stopwatch and cannot bind to
the typed parameter. In a separate control, a second ordinary PowerShell process
reads the original process's counter origin and frequency. The focused run
measured 359 ms since that origin versus 8 ms on its newly started local watch.
The exact values are scheduling-dependent; the discrepancy, not those values,
is the control. Starting the watchdog's clock on receipt/ARM would grant startup
time back, so that is not an acceptable adapter.

## Chosen direction for the physical host -- NOT implemented yet

1. The already-trusted host launcher captures one high-resolution counter origin
   before reservation, watchdog creation and dispatch. Carry original counter
   ticks, frequency, run nonce and original work/stop/retention budgets in the
   authenticated same-host startup context. A tick value is not authentication.
2. Receiving host processes obtain CURRENT ticks from their own QPC-backed
   `Stopwatch.GetTimestamp`, not a serialized object or a new elapsed Stopwatch.
   Require high-resolution support, positive bounded integer values and exact
   frequency agreement. Subtract ticks BEFORE scaling. Use exact bounded integer
   or decimal arithmetic, not floating-point absolute ticks or Unix wall time.
3. Use the same original work deadline (at most 25 s), stop cap (work + 5 s),
   retention cap (work + 10 s), and first-five-seconds code-preparation bound.
   Subtract elapsed startup/handshake/verification work; never renew a deadline.
   Enforce inclusive expiry. Account conservatively for cross-thread one-tick
   uncertainty at the boundary rather than granting an extra tick.
4. The runtime clock owner must be immutable with no public restart/reset method.
   Invalid origin, changed frequency, future/regressing counter or clock failure
   latches it unavailable. Expiry/failure preserves existing uncertainty and never
   retries an effect or abandons the independent stop attempt already required.
5. Bind the same origin and budgets into a VERSIONED startup/ARM/retention context
   before any forward effect. Existing OMH1/OMWI and historical result bytes must
   not silently acquire different meanings. The precise versioned wire layout
   and implementation remain work, not an already satisfied gate.
6. Scope is the SAME Windows host and boot with authenticated retained peer/run
   identity. Frequency agreement alone cannot prove same-host origin. Never
   compare host and guest counters, translate through UTC, persist the timestamp
   as reboot authority, or accept it as permission to resume after restart.

The next source change is a shared host-run clock abstraction and adapters for
the watchdog/retention path, followed by the versioned transport and binding.
In-process read-only discovery and historical-read clocks need not become remote
run capabilities. Node `performance.now()` has a different API/origin: a future
Node enforcement participant must use an explicit trusted host-clock bridge,
not assume its existing collector clock is the same counter epoch. The Node
synthetic collectors are not that bridge.

Preserve separate guest clocks inside the disposable VM and the external host
watchdog's independent cutoff. No new authority, reboot adoption, owner reset,
approval reuse, environment relaxation or physical consumer follows from this
choice. Review the resulting combined startup/clock/transport boundary before
requesting an authorized physical run.

## Falsifiers for the integration (NOT RUN against a new clock API)

- Delay process creation/receive/reservation; every participant has less remaining
  time, including denial before effects when startup exhausts the work allowance.
- Substitute origin, nonce, frequency or budgets; deny before reservation/ARM.
- Future/regressing/failed clock latches closed; a later valid sample cannot heal it.
- Exact deadline equality, one-tick boundaries, very large absolute ticks, tiny
  elapsed differences and integer overflow cases produce conservative results.
- No serialized Stopwatch, fresh local watch or legacy retained intent can be
  treated as a valid new authenticated clock context.
- Guest/reboot origins cannot be adopted as this host's fresh run clock.

## Executed evidence

`tests/helpers/v3-metadata-clock-origin-fixture.ps1` uses only built-in timing and
serialization plus the Utility module for JSON output. Module autoload is disabled.
The test starts separate ordinary local PowerShell processes with no profiles;
it does NOT open a remote session. Three tests check serialization rejection,
same-host origin subtraction with Node BigInt cross-check, and rejection of a
changed frequency/future origin. The 125 ms deliberate delay is test-only; it is
not a production synchronization technique. These observations neither prove
an authenticated channel nor a hard real-time stop.

`scripts/capture-v3-metadata-clock-origin.mjs` captured raw regression output and
167 unchanged selected input identities under
`docs/reports/v3-metadata-clock-origin-20260919/`. **426 metadata checks passed**,
zero failures/skips/cancellations, 35,340.7998 ms. No C# compilation was rerun and
`clockApiMigrated: false` is explicit in the receipt. M00-M12, W1-W5 and the
partial-rollback/upgrade gates remain open.

## Primary references

Microsoft documents the same-machine counter model, fixed boot frequency and
one-tick cross-thread uncertainty in
[Acquiring high-resolution time stamps](https://learn.microsoft.com/en-us/windows/win32/sysinfo/acquiring-high-resolution-time-stamps).
The [PowerShell remoting documentation](https://learn.microsoft.com/en-us/powershell/scripting/learn/ps101/08-powershell-remoting?view=powershell-7.5)
distinguishes deserialized snapshots from live objects. The local probes above
test this specific Stopwatch behavior rather than treating that general guidance
as executed evidence.
