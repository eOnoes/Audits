# Windows guest broker: OS peer identity and create-time permissions

Date: 2026-09-06. Evidence: LOCAL_DISPOSABLE_GUEST_PROTOTYPE and self-review.
Source base: `97492427bf94c5000982ad94c2b172ebbcdb83ac` plus this delta.
Not production admission, not an independent audit, not W1-FS-1 closure.
The initial identity/create-time checkpoint is `5779436`. The current pipe
lifecycle follow-up below builds on it; its new file hashes supersede the old
probe hashes for reproduction, without rewriting the earlier execution record.

## Implemented changes

The fixture client no longer treats the pipe's `identity` reply as proof of
identity. Before sending ANY request bytes on EACH connection it:

1. Opens the local SCM with CONNECT and the fixed service with QUERY_STATUS only.
2. Requires the service to be running, own-process, with a nonzero PID.
3. Compares that PID with `GetNamedPipeServerProcessId` on the connected pipe.
4. Opens and retains that process object with QUERY_LIMITED_INFORMATION only.
5. Checks liveness, the fixed installed executable path, and the token's exact
   virtual-service-account SID. It rechecks SCM PID/state and process liveness.
6. Keeps the process handle through the exchange, then closes it. No caller
   supplies a service name, executable path or expected identity on the normal
   fixture request path.
   `RequestTo` is a private probe helper for the negative fixture only.

The virtual-account service explicitly grants the fixture LOCAL SERVICE principal
process query-limited access and token QUERY access. It preserves existing DACL
entries; it does not grant memory/handle mutation or token duplication. These
are guest process/token object changes, NOT working-PC OS changes. A failed
grant prevents service startup. This is an intentional metadata permission,
not an operator-approval credential or a production pairing design.

The guest installer now passes a protected security descriptor directly to
`CreateDirectoryW` for the new root, private directory and client directory.
An existing object is an error, not an invitation to change its permissions.
The root initially grants SYSTEM full access and LOCAL SERVICE read/execute;
after SCM creates the virtual account, SYSTEM adds that account's read/execute
access. The private child is created with SYSTEM/service-only full access from
the outset. Neither directory starts with inherited desktop-user write access.

The identity checkpoint transported C# as an in-memory gzip/base64 payload in
one fixed guest command. The lifecycle follow-up uses bounded guest-only pieces
as described below. Expanded source remains capped at 65,536 bytes, checked
against the host-read byte length and SHA-256, decoded with fatal UTF-8, and
compiled inside the guest. The command retains its 29,000-character encoded
limit. No writable host mapping or source download is introduced. This hash
checks transfer consistency, not an independent source approval.

## Executed controls

Reproduce from `product/companion-v1` on the approved Sandbox-capable host:

```powershell
pwsh -NoLogo -NoProfile -File tests/probes/windows-sandbox-broker.ps1 -DisposableOnly
```

Two runs of the exact final harness passed in separate fresh guests. Both
completed all phases and confirmed destruction before emitting their reports:

- The real service passes the OS identity checks on every fixture request,
  including a new connection following graceful service restart.
- An alternate-name fake server connects successfully while the real service is
  running. An unverified control client delivers its fixed canary byte. The
  verifying client is denied specifically on `peer-service-mismatch`, and the
  same observer sees zero request bytes/closed pipe. This tests different-server
  PID rejection; it is not a first-instance/name-squatting availability test.
- Existing-folder creation with an intentionally permissive replacement
  descriptor fails with ERROR_ALREADY_EXISTS (183). Before/after SDDL is equal.
- Valid fixed-file replacement, stale-input and malformed-input denials,
  postimage read-back and graceful restart continue to pass.
- Direct target read/write, private-directory/root rename, private-directory
  child creation, and service-binary write fail with access denied.
- Client-owned hardlink creation succeeds; a link to the protected target fails.
- Each process VM_OPERATION, VM_READ, VM_WRITE and DUP_HANDLE open succeeds on
  the client's own process and fails with error 5 against the service.
- Each token DUPLICATE, IMPERSONATE, ADJUST_PRIVILEGES, ADJUST_GROUPS,
  ADJUST_DEFAULT and ADJUST_SESSIONID access open succeeds against the client's
  token and fails with error 5 against the service token. Query remains allowed.
- Service CHANGE_CONFIG, START and STOP opens fail with error 5 from the client.

Development failures are not hidden: initial runs returned generic client 99,
then 129 for the closed-pipe observer, then 123 for denied process queries
(including query-only). The observer gained an actual byte-delivery positive
control and exact closed-pipe handling; the service gained explicit query-only
grants rather than broad access. One setup run failed because a diagnostic
variable collided with PowerShell's automatic `$Error`; that variable was
renamed. Every guest attempt used teardown in `finally`; no failure was treated
as a passing identity check.

Historical raw SHA-256, without normalization, of the identity checkpoint's
final probe files (NOT the lifecycle follow-up):

- `tests/probes/windows-guest-broker.cs`:
  `ba8ac0515afdc2953f11cfc00945f27d13faf4252c885472045a193608f7888c`
- `tests/probes/windows-sandbox-broker.ps1`:
  `c58ae86996f5766e7ddac13a5649173aff4805efd8a9ce914b02c20ac7dd6bd3`

Source security scan and its two regression tests pass locally. These checks
do not execute production TS/package paths. Existing hosted verification at
`9749242` is completed/success; it predates this delta and is not guest-probe
evidence. No new full TS/package result is asserted here.

## Still open before a production consumer

- General availability/rate limits under repeated hostile clients and a complete
  production health/readiness protocol. The lifecycle follow-up below adds
  first-instance ownership before startup success, held-name reconnects and
  malformed/idle recovery, but does not promise fairness under a continuous flood.
- Real operator authentication/approval, policy/C-drive restrictions, durable
  intent/effect/settlement, cancellation and crash/response-loss recovery.
  Every valid fixture-principal request is still admitted without real approval.
- Production installation ancestor custody, hostile pre-created roots/reparse
  points, old handles/mappings, ACL/config integrity and least privilege across
  all supported principals. Create-time DACLs close the ordinary child creation
  window, not these broader installer questions. The fixed guest path is not a
  promise that an arbitrary operator-selected parent is trustworthy.
- Arbitrary verification code confinement and separately authorized publication
  back to original/shared folders. No original user files are modified here.
- Fresh outside review of the changed trust boundary before product consumption.
  C# remains a probe-only helper, not a chosen/shipped production broker.

The test uses 4 GiB network-disabled Windows Sandbox with no host mappings,
clipboard, camera, audio input or printer redirection. No working-PC service,
identity, permissions, registry, security setting or boot configuration changed.
`productionApprovalEnforced` and `filesystemReleaseGatePassed` remain false.

Primary API references used for implementation:
[pipe server PID](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeserverprocessid),
[SCM status and PID validity](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/nf-winsvc-queryservicestatusex),
[query-only exit status](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getexitcodeprocess),
[handle-based DACL update](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-setsecurityinfo),
and [create-time directory security](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createdirectoryw).

The test executable never returns STILL_ACTIVE (259) as an exit code. A general
production executable must preserve that rule or use another liveness mechanism.

## Executed follow-up: held pipe name and bounded reconnect lifecycle

Source base: `57794360de9e0f3f57bd00626fd263e126fd563a` plus this follow-up.
Evidence remains local disposable Windows guest execution and self-review only.

The service now uses native `CreateNamedPipeW` with DUPLEX, OVERLAPPED and
FILE_FLAG_FIRST_PIPE_INSTANCE (`0x40080003`), byte mode, maximum one instance,
a non-inherited handle and the existing explicit DACL. Creation occurs in
`OnStart` before it can return success. The same server instance remains open
between requests; `Disconnect` resets the connection instead of disposing and
recreating the name. An unavailable/preclaimed name fails startup. No alternate
name or unchecked fallback is tried, and the test never kills the name holder.

PIPE_REJECT_REMOTE_CLIENTS (`8`) is explicitly requested. This is a checked
source/API configuration, NOT an executed remote-SMB denial: the guests have
networking disabled, and no cross-machine connection was attempted.

Disconnecting can discard unread replies. The normal client reads its reply and
then closes. The broker waits for that close with a 3-second bound instead of
an unbounded pipe drain. Bounded read/write waits cancel timed-out operations
with `CancelIoEx`, then wait up to another second for their actual completion
before allowing instance reuse. A cancellation request alone is not enough.
An unconfirmed cancellation or broken reconnect lifecycle ends the fixed guest
service process with code 93 rather than recreating an unreserved name while
appearing healthy. That terminal branch exists in source but has NOT been
fault-injected; durable effect recovery after such a failure remains open.

Two fresh runs of the exact final harness passed, including all earlier
identity/file/token/control checks and these new controls:

1. Creating a free probe pipe succeeds as a positive control. Forty takeover
   attempts surrounding twenty valid snapshot requests fail with native error
   5. No fixed-file bytes change during these read-only requests.
2. Invalid ASCII, a 1,025-byte overlong frame, an idle-before-request client and
   a client that reads a reply but refuses to close each get disconnected within
   the observer's 6-second bound. Name-takeover attempts before/after those
   disconnects still fail; subsequent identity/snapshot requests succeed with
   the SAME service PID and expected preimage. This exercises cancellation and
   reconnect rather than passing because the service restarted.
3. Guest SYSTEM stops the service. A LOCAL SERVICE task successfully preclaims
   its actual pipe name and signals readiness. Starting the service fails and
   SCM reports Stopped while the holder task remains running. SYSTEM signals
   the fixture holder to release; its task exits zero. The service then starts,
   and a new verified client confirms the earlier postimage survived. This is
   a specific startup preclaim test, not just an alternate-name fake server.
4. Both final guests are destroyed, with no working-PC OS changes.

The first expanded test attempt stopped at the host command-size check before
compilation: `guest-broker-command-too-large`. The harness now transfers gzip
bytes in at-most-4,096-byte pieces, at most 65,536 compressed bytes total, into
CreateNew files under the protected guest root. It reassembles only the numbered
pieces it generated, checks compressed length and expanded size, verifies the
original source SHA-256/length, then compiles. The 29,000-character per-command
ceiling is unchanged. No folder is mapped from the host, no source is fetched,
and no aggregate size bound is evaded by the split. Piece files disappear with
the guest; they are not source edits or artifacts on the working PC.

Current raw SHA-256 for reproducing this lifecycle follow-up:

- `tests/probes/windows-guest-broker.cs`:
  `eb64d4a6ecefd5b3e228917d38bfbc5da1e3cd7beb7eaf557dd10fa8c04ade57`
- `tests/probes/windows-sandbox-broker.ps1`:
  `fde5a9092d8873332fddb367fc0e32fe94425bca569781b55882ac5a5e580fa5`

Source security scan, its two regression tests, and `git diff --check` pass.
No new full TS/package or hosted result is asserted for this probe-only delta.
The next integration is reviewed policy/approval plus durable intent/effect/
settlement in disposable fixtures; no real approval or product consumer is
authorized by these transport results.

API references:
[first-instance and remote-client modes](https://learn.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-createnamedpipew),
[disconnect semantics](https://learn.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-disconnectnamedpipe),
and [cancellation is not completion](https://learn.microsoft.com/en-us/windows/win32/api/ioapiset/nf-ioapiset-cancelioex).
