# Original host clock in Node collectors

2026-09-19. Dormant integration and LOCAL PRODUCER evidence only. No VM, native
retention, protected runtime loading, installation, provider or approval use.

## Change and scope

The default synthetic ARM/session constructors measured time from construction.
That must not be the physical launcher's contract: elapsed host preparation must
not be added back to work or report deadlines. `MetadataNodeHostClock` receives
exact OMK1 bytes plus separately supplied reference, host session, nonce and work
pins. It retains the original QPC origin. New `fromHostClock` factories bind ARM,
watchdog session and bootstrap collector to that privately branded clock, with
start zero and original work / work+5000 deadlines. Pending timer delays subtract
current original elapsed time. Attach, arm, claim, final decode and wire handoff
keep their existing synchronous deadline rechecks; timers are not termination
evidence and do not establish an atomic liveness/dispatch boundary.

No callers or process-launching consumers are activated. Existing public
clock-callback constructors remain **synthetic seams**, not alternatives for a
protected physical composition. No caller callback/reset is accepted by the new
clock. Copies of OMK1 are bounded before allocation; proxies, shared/detached
buffers, mismatched pins and invalid domains deny. Binding uses a private WeakMap
and fixed closure, not a caller-overridable method. Binding mismatch or sample
failure/regression latches that clock unavailable, including existing bindings.
Work expiry alone does not invalidate the later stop/retention clock.

## Pinned implementation, not a general hrtime promise

Supported here: Windows x64, Node **v24.14.0**, libuv **1.51.0**. Other runtime
tuples deny. The module captures the sampler before exposing its interface.

Upstream primary sources inspected:

- [Node v24.14.0 process methods](https://raw.githubusercontent.com/nodejs/node/v24.14.0/src/node_process_methods.cc):
  `HrtimeBigIntImpl` preserves the unsigned 64-bit value returned by `uv_hrtime`.
- [The same release's Windows libuv util](https://raw.githubusercontent.com/nodejs/node/v24.14.0/deps/uv/src/win/util.c):
  frequency comes from QueryPerformanceFrequency; `uv__hrtime` uses binary64
  conversions/divisions of QPC and frequency before truncating to integer ns.

Inference from these exact sources, conditioned on an unmodified runtime and
valid same-host/same-boot QPC: the C# original counter and Node sample share an
epoch. This is not portable behavior guaranteed for arbitrary Node versions.
Version strings alone are NOT executable provenance, loader custody, proof of
same boot, or an independent current-frequency measurement. A future protected
launcher must establish those facts; context reference and host-session equality
are only binding to independently trusted input, not authentication themselves.

## Conservative arithmetic

Supported counter/frequency values are positive signed Int64. Original scaled
ns and Node samples must be positive and at most 2^63-1; there is no wrap support.
Underlying QPC stability and valid, non-overflowing libuv conversion are host/OS
assumptions. No claim is made for a broken/hooked QPC, forged frequency, restored
boot epoch or integer-conversion overflow in a corrupted/unsupported runtime.

For valid positive normal operands, the two integer-to-binary64 conversions and
two divisions have aggregate relative error less than 2^-49 (a deliberately
loose bound, including directed rounding). Within true scaled ns <2^64 this is
less than 32768 ns; integer truncation adds less than 1 ns. The implementation
uses a larger **1,000,000 ns allowance plus ceil(1e9/frequency) ns** for one QPC
tick. It requires the sample beyond original floor-ns plus this allowance plus
1 ns, denying too-fresh/uncertain/future origins instead of inventing a fresh
start. A 1ms work window can therefore be conservatively unusable on reception.

Elapsed is ceil((sample + allowance - floor(origin*1e9/frequency))/1e6), using
BigInt subtraction/scaling before a bounded Number conversion. At 35000ms it
saturates expired. This is an upper elapsed bound: it may deny early but must
not extend an original deadline. The C# tick oracle and floating conversion
simulation are separate arithmetic in the tests; the tests supplement, rather
than prove, the numeric argument.

## Evidence and remaining gates

Focused pre-capture run: 131/131 Node tests passed, including 24 new cases.
The new arithmetic corpus checks 2,484 exponent/frequency/rounding combinations;
all 128 context-byte mutations and every wrong length deny. Seven isolated
processes check sampler throw/regression/range failure and four unsupported
runtime identifiers. Real synthetic children exercise ARM/EOF/report/close and
one-use bootstrap handoff. Frozen-clock controls falsify timer renewal itself.

`test-v3-metadata-node-clock-process.mjs` separately invokes the pinned existing
C# clock-only executable with bounded execution. It brackets the captured
original QPC against Node, deliberately spends 125ms, compares the live C# and
Node elapsed values, then reconstructs a receiver without renewing time. Pins
travel through synthetic stdout in this experiment: **not authenticated IPC**.

Final capture: **492/492 metadata Node tests passed**, zero failures/skips/cancels,
44,120.7352ms. All 40 fixed targets compiled; all 33 isolated pure/fake/clock
suites, the C# clock transfer, joined history and Node clock join passed. Capture
ran 2026-09-19 **07:29:12.927–07:30:06.514 UTC** on Windows x64 Node v24.14.0 /
libuv 1.51.0. The Node/C# comparison recorded 153ms before the receiving process,
196ms in C#, and 202ms back in Node. These are producer observations, not an
independently executed gate.

Raw output and receipt are in `docs/reports/v3-metadata-node-clock-20260919/`.
All 200 selected source/script inputs were unchanged across capture; all ten raw
stdout/stderr outputs and input identities were rechecked from disk. The receipt
and raw outputs, not this narrative, are the source of final command outcomes.
No earlier capture or immutable audit packet is rewritten.

Before physical composition, obtain combined review of this pinned-runtime
clock join alongside protected runtime/loader custody and authenticated clock
transport. Runtime update requires reviewing the conversion again, not changing
the version guard blindly. Protected launcher, native storage placement,
cross-process ownership/IPC, VM tests and W1-W5 remain OPEN. None of these local
tests grant dispatch, guest-stop proof, verification evidence or release status.
