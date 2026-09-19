# Local host inputs package -- not an installer or executable experiment

2026-09-19 UTC. Baseline `5f4a0769faa1bf3c21060642e9dac3893fbe3247`.
Local producer packaging/test evidence, no external transfer or activation.

## Implemented build path

`prepare-v3-metadata-host-package.mjs` assembles exactly the three fixed inputs
expected by the joined host-code owner: `host-report-sink.dll`,
`windows-v3-metadata-watchdog.ps1`, and `windows-v3-metadata-retained-watchdog.ps1`.
The caller supplies the expected compile-receipt SHA-256 AND independent expected
hashes for both scripts. No expected pin is adopted from the input directory.

The new shared `windows-v3-metadata-build-inputs.mjs` extracts the existing guest
bundle's bounded file snapshot/compile-receipt checks. Both packagers now use the
same lstat/open/fstat identity/size/link checks, bounded complete reads, explicit
EOF and post-read drift checks. This is ordinary local build input validation,
not restrictive Windows sharing, protected ancestry, or install-time custody.
Caller-selected input/output locations remain trusted build inputs.

The pinned receipt must assert a successful compile-only run with unchanged
source/toolchain. The builder checks the current compiler script, every current
compile input, exact target/result ordering and paths. It independently checks
the selected library's actual bytes against that result. Toolchain measurements
and compilation still remain producer claims, not a signature or reproduced build.
Malformed UTF-8/JSON, changed inputs, absent or wrong pins, bad results, empty or
oversized library, and hardlinked input files are rejected before output creation.

All three input snapshots are complete before a create-only destination is made.
The builder writes the fixed leaves and `HOST_INPUTS.json` with exclusive-create
semantics, then reads every file back byte-exactly. Existing and partial output
directories are never adopted/repaired/overwritten/deleted. A failed write or
readback leaves the artifacts for diagnosis and fails; a retry cannot reuse that
directory. Owned input snapshots are cleared on exit. The assembly-only API
instead explicitly hands caller-owned buffers back; mutation invalidates their
recorded hashes and does not confer authority.

The manifest contains filenames, lengths, raw SHA-256 identities and the producer
receipt pin. It includes no host usernames, private absolute paths or credentials.
It explicitly keeps bootstrap inclusion, dependency closure, protected placement,
runtime custody and execution authorization FALSE, with `authority: none`.
The separately returned manifest hash is an integrity pin, not a trust root.

## Actual local artifact and evidence

The capture script reused the earlier successful compile recorded under
`v3-metadata-host-code-set-20260919`. It verified that capture's raw compiler-output
hash, compared the original on-disk receipt to the captured record, and had the
builder verify current compile sources plus the library bytes. No compilation
or C# suite was rerun in this turn. The two script pins were measured by this
local producer, not delivered or verified by an independent reviewer.

Prepared local directory (ignored build output, NOT committed/published):
`artifacts/v3-metadata-host-inputs-TlG6Lt/prepared/`.

- Retention library: 69,120 bytes.
- Watchdog core: 12,611 bytes.
- Retained-watchdog wrapper: 5,594 bytes.
- `HOST_INPUTS.json`: exact copy and all hashes retained in the report directory.

`scripts/capture-v3-metadata-host-package.mjs` retained raw evidence under
`docs/reports/v3-metadata-host-package-20260919/`, 05:30:39.402Z through
05:31:15.011Z on Windows / Node v24.14.0. All **164** selected inputs were unchanged;
**423 metadata checks passed**, zero failed/skipped/cancelled, 35,428.1719 ms.
The earlier focused run of host-package and existing guest-bundle tests passed
53/53; this overlaps the full run, not additional coverage.

New tests use synthetic, non-executable library bytes with explicitly fabricated
producer receipts. They cover all fixed outputs and nonauthority flags, detached
snapshots, each external pin, invalid UTF-8, source/result/identity substitutions,
size ceilings, hardlinks, existing output preservation, failed partial writes,
buffer clearing and incorrect destination bytes on readback. Existing guest
bundle cases still reproduce their original vector after the shared-code change.
The real compiled library was copied and hashed, never loaded or executed.

## Next boundary

This supplies concrete inputs for the protected launcher review, not that launcher.
The already-trusted bootstrap, independently enrolled program/evidence roots,
CLR/PowerShell/native/module resolution, independent watchdog process lifetime,
controller IPC, guest entry/delivery and physical stop/contact settlement remain
unfinished. The three-file package is NOT the whole dependency closure. No new
administrator prompt, service, task, policy change, VM action, credential or
provider call occurred. M00-M12, W1-W5, AJ09/PA06/PA07 and PA15 remain open.
