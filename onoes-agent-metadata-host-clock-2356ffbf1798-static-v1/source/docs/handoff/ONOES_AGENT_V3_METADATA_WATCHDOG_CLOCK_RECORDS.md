# Watchdog clock-bound retention and ARM V2

2026-09-19 UTC. Local implementation/self-review over baseline `58ec961`.
Native host code compiled only; no native storage, Hyper-V, guest, credential,
privileged installation, provider or external publication was invoked.

## Implemented composition

The retained watchdog bridge and native reservation both require the independently
pinned OMK1 context and join it to the exact existing run clock's origin,
frequency, nonce and work budget before storage. The bridge snapshots caller
inputs; the native call receives only the already-validated owned context and
artifact pins. Neither factory renews time or reconstructs an elapsed stopwatch.

The watchdog owns a separate reservation and handles, not the controller owner.
Its new create-only leaves are `<nonce>.watchdog-intent-v2` and
`<nonce>.watchdog-terminal-v2`. The old OMWI/OMWT reader remains historical-only;
no new writer emits its old names. V1 and V2 do not automatically fall back to
each other. Missing or invalid history never permits a retry or resets approvals.

## Formats

OMW2 is 292 bytes: magic at 0; root/inventory/bundle/fixture digests at
4/36/68/100; complete OMK1 at 132; checksum at 260. Checksum domain is
`onoes-metadata-watchdog-intent/v2`; reference domain is
`onoes-metadata-watchdog-intent-reference/v2`. Domain hashing is SHA-256 over
ASCII domain + NUL + the core (checksum) or complete wire (reference).
Root binding reuses the pinned volume-GUID root/file-identity derivation already
used by both roles; it does not infer enrollment from discovery.

OWT2 remains exactly 72 bytes: magic, intent reference at 4, trigger and flags at
36/37, two zero bytes at 38/39, checksum at 40 using
`onoes-metadata-watchdog-terminal/v2`. The existing bounded trigger/flag rules
are shared with the legacy parser, not changed. Its outer checksum/reference
and framing are new; an old terminal cannot satisfy the new parser.

ARM is exact UTF-8 JSON plus LF, with fields in this order:
`kind`, `inventoryDigest`, `runNonce`, `bundleDigest`, `workMs`, `stopMs`,
`clockReference`, `intentReference`. Kind is
`metadata-watchdog-armed-v2-not-authorization`. Both references are required
lowercase nonzero 64-character digest strings. The fixed maximum-budget vector
is 499 bytes, below the existing 1,024-byte transport ceiling.

The real retained bridge computes ARM from its owned intent. The PowerShell
wrapper passes its two reference properties to the core, whose exact generated
bytes are checked by that bridge before any output. The Node ARM window and
session require independent expected references and reject old ARM, mismatches,
extra fields/bytes and malformed framing. They cannot learn their expected
references from the incoming message.

## Lifecycle and history preserved

Full native retained-intent/root readback still precedes sending ARM. Once bytes
may be visible, flushing does not revisit storage or postpone entry into the
emergency stop loop. Outstanding writes/flushes cannot be declared settled or
promoted after disposal. Terminal bookkeeping follows stop observation, stays
single-attempt and uses the original retention deadline. A returned write remains
separate from later clock/cleanup uncertainty.

The new native V2 history reader validates independent context/root/artifact pins
before opening files, checks the required intent before the optional terminal,
rechecks both same-handle files/ancestors, and completes all cleanup within the
separate original five-second read budget. It does not make historical run time
live again. Returned copied records always require reconciliation and have
`MayDispatch`/`StopProven` false. Explicit file-not-found is the only missing-report
case; access/sharing failures are not absence.

## Verification and limits

The real C# bridge/record codecs run against a fake storage owner. Checks cover
all 292 intent byte mutations and 72 terminal mutations, all short prefixes,
oversize/null/legacy inputs, coherently rehashed wrong pins/context, 238
trigger/flag combinations, copied immutable historical data, and wrong context,
origin, frequency, reference, host-session and invalidated clock before storage.
The fake writer validates real terminal bytes against its retained real intent.
An independent Node vector matches the executing C# intent-reference and ARM hash.

Node child-process tests reject old-format ARM and wrong context/intent references.
Actual PowerShell core scripts run with mocked management functions; missing ARM
reference inputs deny before any management call. The wrapper ordering fixture
uses a fake bridge with synthetic references and does NOT validate real OMK1;
that behavior is covered separately by the executing real C# bridge tests.
No test here is an independent outside execution, filesystem custody, loader
custody, native durability or actual VM power-off result.

Final raw producer capture: `docs/reports/v3-metadata-watchdog-clock-20260919/`,
06:58:47-06:59:39 UTC. All 40 targets compile, 33 isolated suites pass and all
454 metadata Node checks pass (zero fail/skip/cancel, 43,402.3931 ms). The existing
ordinary-process clock-transfer regression also passes. All 191 selected
source/helper/test inputs remained unchanged during capture; six raw outputs
have hashes and byte lengths in the execution receipt. The focused 102-check
ARM/session/composition run passed before the final added vector/denial checks.

## Remaining prerequisites

The Node timer still uses `performance.now()`. Comparing a context reference does
not map that timer to QPC or recover time spent before Node construction. The
trusted launcher must establish that bridge without renewing the origin; these
seams are not yet a physical dispatch controller. A same-process injected clock
or a digest is not proof of an authenticated same-host/same-boot channel.

The old joined-history comparator remains V1-only and rejects these new lengths.
Next: a separate V2 comparison requiring independent shared clock/root pins,
then the Node/QPC launcher join, authenticated independent transport/lifetime,
protected host/bootstrap/runtime placement and enrollment. Fresh combined review
and scoped operator authority are required before physical M00-M12. Partial
rollback, upgrade/recovery and W1-W5 release/operator acceptance remain open.
