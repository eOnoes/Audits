# Host code read holds: preparation, not a protected loader

2026-09-19 UTC. Baseline `403550624b78c9a0c4e5814880a0f1f41f49b076`
plus exact inputs in the executed receipt. Native compilation only; no protected
root, code load, privileged setup, VM, enrollment or execution authority.

## Implemented boundary

`MetadataHostReportSink.HostCodeReadHold` opens only existing files under the
fixed proposed program root `<volume-GUID-root>OnoesMetadataHost01`, separate
from `OnoesMetadataEvidence01`. Selecting this leaf in dormant code is not
approval to create it. The caller must independently enroll its volume serial
and root file ID and independently supply expected content hashes and lengths.
There is no discover-and-adopt, creation, ACL repair, overwrite or delete path.

The pure immutable pin allows exactly three leaves:

- `host-report-sink.dll`: 1 through 4,194,304 bytes.
- `windows-v3-metadata-watchdog.ps1`: 1 through 131,072 bytes.
- `windows-v3-metadata-retained-watchdog.ps1`: the same script bound.

Unknown roles, zero/out-of-range lengths, and absent/wrong-sized/all-zero SHA-256
pins deny. Digest input is copied; no arbitrary relative path or command enters
the API. These are three selected inputs, NOT a declaration of complete runtime
dependency coverage.

The native open requires Windows x64/SYSTEM, fixed NTFS with persistent ACLs,
volume-GUID final names, non-reparse directory ancestry and the exact independently
pinned root identity. Parent handles are retained without delete sharing. The
root and file reuse the existing exact protected SYSTEM/Administrators descriptor
checker. File open uses GENERIC_READ plus READ_CONTROL, FILE_SHARE_READ only,
OPEN_EXISTING and OPEN_REPARSE_POINT, with no inherited handle. File checks reject
reparse/directory/unexpected attributes, hardlinks, extra streams, wrong length,
wrong final name or volume and later file-ID/creation/write-time drift.

`TakeCheckedBytes` consumes one local opportunity, reads through the retained
file in chunks of at most 4,096 bytes, checks explicit EOF and final length,
compares raw SHA-256, then rechecks retained file/parent identities and security.
Allocation happens only after the fixed cap and exact stream length checks.
Failures clear the allocated buffer and poison that owner; no read retry. A
successful caller-owned byte array is returned without closing the retained
handles. The caller owns and must clear that array after use. `CheckForUse`
requires the successful byte check, then revalidates the held objects. Disposal
attempts every owned release even after a failure and never closes foreign handles.

Opening and byte preparation must finish inside five seconds of the original
running clock, further bounded by the caller's 1-25,000 ms work limit. Subsequent
use checks obey that original work limit; no new clock is started. Synchronous
Win32/stream calls are not preemptible: post-call denial is not a hard-stop claim.

## Bootstrap and loader limits -- still load-bearing

An ALREADY trusted bootstrap must run this helper. It is compiled into the native
host library for later reviewed composition, NOT invoked as a self-authenticating
check of the DLL/CLR that has already loaded it. Neither returned bytes nor a
successful held-file check establishes that bootstrap's origin or gives permission
to execute code. No new public loader or runtime entry point is supplied.

This is not closed-directory inventory, CLR/GAC/native dependency custody, trusted
PowerShell module resolution, process-creation custody, OS identity authentication,
or a defense against a privileged compromised host. The future launcher must
retain every required hold throughout use, authenticate its own placement and
runtime before execution, constrain resolution/environment, and connect the
separate retention/transport owners. Check-by-path followed by releasing the hold
would not satisfy that contract. Root provisioning/enrollment and independent
watchdog lifetime remain separate missing mechanisms.

## Executed tests and evidence

`scripts/capture-v3-metadata-host-code.mjs` captured 155 unchanged input identities,
commands and raw outputs under `docs/reports/v3-metadata-host-code-20260919/`.
Windows x64 / Node v24.14.0; 05:12:40.928Z through 05:13:23.550Z:

- 37 C# targets compiled with warnings treated as errors. The native hold appears
  only in `host-report-sink.dll`, which was NOT loaded or executed.
- 30 allowlisted pure/fake-native suites passed. New `host-code-tests.exe` links
  only its memory fixture and the pure pin/reader; no native hold/Win32 source.
  It checks fragmented reads, the 4 KiB call ceiling, exact output, copied pins,
  short/long input rejection before reading, EOF overrun, wrong hash, read failure,
  stopped clocks during read and EOF, role/size/digest denial, buffer clearing
  and continued caller ownership of the stream. No real slow disk or ACL race.
- 397 metadata Node tests passed, zero failed/skipped/cancelled, 35,163.0505 ms.
  Three new source/link checks pin the fixed read-only open, one-use sequencing
  and pure/native separation. Those checks are not OS execution evidence.

This is local producer evidence, not outside review or a full product regression.
Physical aliases, sharing conflicts, ADS/hardlink/reparse substitution, root
replacement, real access matrices and loader behavior still need authorized
positive/negative controls. M00-M12, W1-W5, AJ09/PA06/PA07 and PA15 remain open.

## Primary API references reviewed

[CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)
defines share compatibility, OPEN_EXISTING and non-following opens;
[GetFinalPathNameByHandleW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew)
defines normalized volume-GUID final paths. The implementation additionally checks
the opened object's attributes/security/identity; path syntax alone proves none
of those properties.
