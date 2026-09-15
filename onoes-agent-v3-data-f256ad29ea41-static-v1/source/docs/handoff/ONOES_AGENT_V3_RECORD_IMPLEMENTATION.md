# V3 record-history data validation

Implementation baseline: `075ab1756f12aaa3291801a94efd3a12fc7c0641` plus this
data-only module, synthetic fixture, tests and documentation delta (2026-09-15).
The checkpoint remediation review cleared this scope, not these later bytes.
No real admission is enabled.

## Implemented boundary

`windows-candidate-v3-record.ts` accepts primitive canonical JSON text only.
Record/checkpoint transports are capped before JSON parse at 32,768/4,096 UTF-8
bytes. Schemas are private and strict; results frozen; errors fixed. No caller
object reflection, callbacks, storage, clock, process or effect port exists.
Existing v2 contracts/consumers are unchanged. Added intent installation/owner/
authorization fields are descriptive bindings, not authenticated authorization.

Replay checks every allowed execution/publication history, monotonic timestamps,
strict forward-effect expiry and absorbing quarantine/release. Reservation is
implicit index zero; at most six explicit events. All result/release fields are
required with explicit nulls when inapplicable. Safe outcomes grant no availability.
Release binds the exact complete predecessor, the SAME settlement core digest as
the outcome, and checkpoint A naming that outcome-containing prefix. Missing A
before release is parseable history; missing A after release fails. An outcome
later quarantined retains its historical core and cannot release.

Settlement joins every shared intent subject, full intent digest, the predecessor
BEFORE the outcome and the historical result. Additional chronology decision:
settlement observation must not predate the preceding event (reservation for
cancellation). Equal times are allowed. Existing outcome/release validity edges
remain unchanged. There is no actual-clock freshness claim or validity renewal.

Checkpoint claims bind installation/namespace/store, historical producer, global
sequence, previous digest, operation, event index, record and approval identities,
inventory root/count. Self-digest excludes only checkpointDigest. Genesis requires
null predecessor/subject fields, zero count and the exact empty-inventory root;
it is not a missing-anchor fallback. Non-genesis requires all subject fields and
nonzero count. Sequence must be at least operationCount + subject.eventIndex:
each retained operation needs its reservation checkpoint, and this subject its
explicit events. This lower bound is NOT full inventory or chain verification.

## Remaining boundary

Complete inventory reconstruction, independent cross-row uniqueness/blocker
checks, publication parentage, checkpoint B joins and full chain validation are
NOT supplied. A's inventory root is a claim here, not independently reconstructed.
Return kind is `parsed-v3-record-not-admission`; no availability predicate exists.

Unkeyed coherent forgeries still parse. One boundary test changes a role-evidence
digest and recomputes every downstream commitment, expecting parsing success:
consistency cannot authenticate actual settlement, custody or physical fencing.
B-03, protected storage, enrollment, issuer, freshness, real approvals, Windows
installation and W1-W5 remain open. No runtime/UI/HTTP/barrel imports were added;
reference search finds only the synthetic helper and tests using the new module.

## Local executed verification

Windows x64 / Node v24.14.0: typecheck and fresh test compilation pass.
Seventeen new platform-neutral tests plus eighteen data-core tests: 35/35 pass,
zero failure/cancellation/skip, 164.3038 ms. Coverage includes every history cut
for eight legal path variants, rehashed substitutions, early release, quarantine,
malformed wire, proxy non-invocation, exact time edges, genesis and sequence bounds.

Full offline product suite: 1,967 tests / 1,965 pass / zero fail/cancel / two skips,
50,610.4375 ms. Existing skips remain link-creation privilege unavailable and the
non-Windows inspector refusal deliberately skipped on Windows; neither closes
W4's native link gate. Full command uses `.test-dist/tests/**/*.test.js` and the
synthetic candidate-review HTTP/crash script suites, not only unit tests.

Raw receipts in desktop `.audit-preparation/`:

- `v3-record-joins-focused-20260915.tap`: SHA-256
  `8c0042afdea14580cac553f72a1ab8700b5077fc35833596230b90c20762ac60`.
- `v3-record-joins-full-product-20260915.tap`: SHA-256
  `4d14830358b6ecc9799b4b90d1df6d2f137ac647fc0d6ef1964369bd40246d57`.

No independent review of the new implementation, VM/provider execution, OS change
or public publication occurred. Next: complete inventory/checkpoint B validation,
then targeted static review of the finished data-only delta.
