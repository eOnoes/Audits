# Child local handle measurement — compile only

2026-09-19 UTC, baseline `da9925390c538351e0643cc963a039e0b53c9204`.
This implements a prerequisite of native startup, not a complete admission path.

`MetadataHostChildLocal.ClearAndMeasure` temporarily retains the caller-owned
SafePipeHandle across all queries and clears only its INHERIT flag. It requires
pipe type 3 and exact flags 1 beforehand, then type 3 and exact flags 0 afterward.
Unknown/protect-from-close flags deny. The same retained raw handle is used
throughout, including the final recheck. Cleanup releases only the temporary
reference and scratch buffer; the caller still owns the endpoint and must close
it after failure. No pending I/O is issued or canceled.

The helper resolves NtQueryObject from the already-loaded ntdll.dll, requests
ObjectBasicInformation into a fixed 56-byte buffer and requires exact success
and length. It returns GrantedAccess, not an authorization boolean. No type name,
object name, token, PID lookup, payload, file or process operation is requested.
This relies on Microsoft's documented PUBLIC_OBJECT_BASIC_INFORMATION layout;
API absence/layout drift fails closed rather than allocating an arbitrary buffer.
Microsoft warns the API may change or be removed. Source:
[NtQueryObject](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntqueryobject).

The supplied original MetadataHostRunClock is checked around work, including
after the native query. This is not hard preemption of synchronous OS calls.
It does not authenticate the clock's origin; future protected startup must do so.

## Explicitly unresolved

- There is no caller or raw-handle transport/parser. This internal primitive
  must never be exposed as admission for arbitrary caller-supplied numbers.
- The returned access mask still requires comparison with the enrolled exact
  role contract. No inferred server mask is silently accepted or widened.
- Pipe type and flags do not establish access direction, peer identity, enrolled
  context, or immutable binary custody. Those proofs remain separate requirements.
- Clearing flags does not close previously duplicated handles. Creator ownership,
  independent S/G survival and no concurrent broad inheritance remain required.
- The child policy is not wired to this helper. Its synthetic observation tests
  must not be described as tests of the native API or its return-length behavior.

## Evidence

The isolated three-source DLL compiled with warnings-as-errors through
`scripts/capture-v3-metadata-child-local.mjs`, without assembly load or execution.
The create-only report `docs/reports/v3-metadata-child-local-20260919-compile`
pins four source/capture inputs, five tools, two raw outputs and one DLL. All
twelve identities were checked after compilation. No native API, child resume,
VM, service, provider or W1-W5 release acceptance ran. A bounded native fixture
and fresh authorization are required before physical results can be claimed.
