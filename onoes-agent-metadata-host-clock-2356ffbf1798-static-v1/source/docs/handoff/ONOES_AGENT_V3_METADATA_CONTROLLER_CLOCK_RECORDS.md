# Controller retention bound to the original clock

2026-09-19 UTC. Local implementation and self-review over baseline `c9febe0`.
This is not a new independent audit, physical experiment or release approval.

## Implemented change

The controller retention factory now requires the exact OMK1 context plus an
independently supplied context reference and host-session pin. Before invoking
storage, it compares those pins, nonce and work budget, and joins the context to
the **existing** run clock's exact origin and frequency. It returns owned context
bytes after validation; it neither reconstructs a fresh clock nor reads mutable
caller pins again at the native boundary. The native factory repeats the join.
These checks require a separately trusted same-host/same-boot launcher; hashes
and an opaque host-session pin do not authenticate a channel or prove a boot ID.

The controller now writes only these versioned, create-only leaves:

- `<nonce>.controller-intent-v2`: 292-byte OMH2.
- `<nonce>.controller-report-v2`: 452-byte OHR2.

The old controller `.intent`/`.bootstrap` writer was removed. Its separate OMH1
historical reader and pure codecs remain unchanged. There is no try-new-then-old
fallback, migration, adoption, overwrite, approval reset or dispatch consumer.
Historical identities and approvals cannot be promoted by changing a filename.

## Exact framing

OMH2 has ASCII magic at 0; root/inventory/bundle/fixture digests at offsets
4/36/68/100; the entire 128-byte OMK1 at 132; and a checksum at 260. The root
digest reuses the existing `MetadataWatchdogRetentionPolicy.RootBinding` function
over the pinned volume-GUID evidence root and file identity. Thus the root domain
remains `onoes-metadata-watchdog-root/v1`, despite its use by both roles.

OMH2 checksum is SHA-256 of ASCII
`onoes-metadata-controller-intent/v2` + NUL + bytes 0..259. Its reference is
SHA-256 of ASCII `onoes-metadata-controller-intent-reference/v2` + NUL + all 292
bytes. The nonce, original ticks/frequency, host-session and exact deadlines are
in the embedded OMK1, not duplicated in an independently drifting field.

OHR2 contains ASCII magic at 0, the OMH2 reference at 4, the original checked
384-byte OMB1 bootstrap claims at 36, and a checksum at 420. Its checksum uses
ASCII `onoes-metadata-controller-report/v2` + NUL + bytes 0..419. Validation
reconstructs the exact envelope against the independently expected intent and
revalidates nested OMB1 semantics. These are retained claims, not an assertion
that the guest generated or signed the clock-bound outer envelope.

Exact lengths are checked before copies. Input, result and historical snapshot
arrays are owned copies. All clocks and report pins are joined before the first
possible native write. The existing original work deadline bounds reservation;
the original retention deadline bounds recording. Single-attempt recording and
independent cleanup/error accounting are preserved.

## Historical reads and compatibility

The V2 reader accepts independent context/root/run/artifact pins, checks the
intent before opening the optional report, then rechecks both retained files and
ancestors. Only explicit file-not-found means a missing report. Cleanup and the
original five-second **read** budget complete before disclosure. It does not
sample the historical run clock or make an expired run live again.

Both V1 and V2 history remain non-authorizing: reconciliation is required,
`MayDispatch` and `StopProven` are false, and missing reports mean unconfirmed.
No method grants a retry, clears quarantine or restores spent approvals.

## Verification scope

The synthetic controller target links the real clock/record/bootstrap codecs to
fake native storage, not to filesystem methods. It exercises all 292 intent byte
mutations, all 452 report byte mutations, every short prefix, oversize/null/legacy
inputs, coherently rehashed wrong root/artifact/clock identities, invalid nested
claims, defensive copies and missing-report history. A Node encoder independently
reproduces the fixed OMH2 reference pinned in the executing C# test.

Factory controls reject wrong nonce, budget, host-session, reference, framing,
invalidated clock and rehashed/new-reference origin or frequency mismatches before
the fake storage trace is touched. Prior reservation/write/cleanup fault controls
remain. The real native library is compiled but is **not loaded or executed**.

An initial focused source/link check passed 24/25: its old clock-context allowlist
omitted the newly linked fake-storage target. The allowlist was updated explicitly,
not broadened to arbitrary executables. The compile and executing isolated suites
had already passed. Final raw capture is in
`docs/reports/v3-metadata-controller-clock-20260919/`.

Final capture, 06:42:41-06:43:33 UTC: all 40 compile targets and 33 isolated
suites pass; 440 metadata Node checks pass, zero fail/skip/cancel,
42,768.146 ms. The existing ordinary-process clock transfer regression also
passes (198 ms received elapsed within independent 187..198 ms bounds). All 186
selected source/helper/test inputs stayed byte-identical during capture. Six raw
stdout/stderr outputs have separate hashes/lengths in `execution.json`.
This is producer execution, not an independent auditor's execution or native
durability/custody evidence.

## Open work, not discharged by this change

The watchdog still has the older OMWI/OMWT/ARM formats and cannot be treated as a
clock-bound peer of these controller records. Next: version its intent/terminal
and ARM agreement, migrate both ends of ARM admission, and extend the joined
history comparator. Keep old history readers explicitly separate.

Protected launcher/runtime placement, enrolled pins, authenticated independent
IPC, independent watchdog lifetime, the Node/QPC join, physical M00-M12 evidence,
partial rollback controls, upgrade/recovery, outside review and operator release
acceptance remain open. No VM, credential, privileged setup, real task, provider,
publication or deployment occurred. No W1-W5 release gate is closed here.
