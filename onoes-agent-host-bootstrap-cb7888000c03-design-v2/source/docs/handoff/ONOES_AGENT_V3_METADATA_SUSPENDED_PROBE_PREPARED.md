# Suspended-child physical probe — PREPARED, NOT RUN

2026-09-19 UTC, baseline `2a97752a6ea50edfe01808bfb94f2f759aa72d21`.
This is a local inert test preparation, not a protected consumer or VM request.
The earlier three native pipe checks did not authorize this new process-creation
test. A separate approval question names the exact three modes below.

## Fixed test scope

Each mode runs one trusted fixture EXE and creates at most one fixed inert child
in a creation-time job (one-process, 256 MiB, 20% CPU limits). Child creation uses
CREATE_SUSPENDED; no resume API is present. No task command, script, VM operation,
service, administrator action, credential, network or provider is involved.

| Mode | Distinct check |
| --- | --- |
| dispose | Explicit cleanup, then retained-root signal and zero job members |
| deadline | No early Dispose; original 4-second setup deadline triggers cleanup |
| duplicate-create | A second creation request is denied while the first retained child remains live; then cleanup |

All modes check the intended child's output pipe is open and empty before stop,
and broken-pipe EOF (109) after confirmed stop. All creator copies except the
counterpart reader are closed. A deliberately inheritable sentinel writer,
excluded from the explicit handle list, must show EOF while the child remains
live. Accidentally broad inheritance would keep it open and fail the test.
The endpoint identity/property and job/retained-process checks run inside the
trusted native fixture; they are not independently repeated by Node.

The no-resume source and suspended creation flags are checked; this is not an
independent kernel query of thread suspend count. The child fixture would exit
73 if accidentally run, but that alone is not a complete unauthorized-resume
detector. Child role admission and initialization remain future work.

## Bounds, receipts and failure interpretation

The fixture has a 6.5-second cooperative loop ceiling and 8-second exit timer.
The Node observer starts a 10-second deadline before spawn, requests termination
at most once, and waits up to 2 seconds for direct-child close. It caps combined
output at 4 KiB, accepts only one exact fixed success record and exit 0/close,
and stops the mode sequence at the first failure. No automatic retry/directory
reuse. Synchronous native stalls still require this outer process observation.

The pipe observer was refactored to share mechanics, not success identities:
pipe and suspended profiles cannot substitute for each other. New numeric stage
diagnostics are allowlisted; arbitrary stderr is never retained. On success the
new receipt says descendant stop was `reported-by-native-fixture`; on failure it
says `unconfirmed`. `processTreeSettlement` remains false at the Node observer.
Killing the fixture closes its job handle and requests descendant termination,
but direct fixture close is NOT independent proof that its child/job settled.
An unknown outcome stops work, not a new PID search or another creation attempt.

The prepared command is `node scripts/run-v3-metadata-host-suspended-inert.mjs
--approved-inert-suspended-creation`. It MUST NOT be invoked without scoped
operator approval; that flag is an accidental-execution guard, not consent.
Its `--check-only` alternative is read-only and has passed. It rehashes 19 source
inputs plus five executable/config/runtime pins, requires unique regular files
and exact configs, and creates no native execution output directory. Hashes are
drift checks, not immutable install-time runtime or loader custody.

## Executed preparation evidence

Three compile/pure captures (`probe-initial`, `probe-final`, `probe-ready`) are
preserved under `docs/reports/v3-metadata-host-suspended-20260919-*`.
Only `probe-ready` includes the final sentinel control and is selected by the
runner. Each passes 428 inheritance / 160 suspended lifecycle checks, compiles
the native DLL, fixed child and smoke executable without loading/running them,
and records 19 input identities, five tools, fourteen outputs and nine artifacts.
The ready-source hashes describe working edits atop the baseline, not baseline
commit content. Earlier probe versions are historical.

The observer captures `v3-metadata-inert-observer-20260919-suspended` and
`...-suspended-final` preserve raw TAP. They run mocks plus three harmless Node
children only; no suspended native fixture. The initial observer suite passed
68 tests; the final adds golden/malformed suspended-response controls and passes
72 tests with zero failures/cancellations/skips. Separate readback verifies 113
identities across ready-source, raw outputs, tools and artifacts; historical input
versions are not claimed to equal current source. The source-security scan passes.

The native directory `docs/reports/v3-metadata-host-suspended-native-20260919`
does not exist at preparation. No physical PASS, independent audit, W1-W5 closure
or release authorization is claimed. After actual scoped execution, retain its
results separately and investigate any failed boundary before further composition.
