# Dormant V3 message and validation-session implementation

2026-09-17. Implementation under the scoped coordinator-model review permission
recorded in V3_MODEL_REVIEW_DISPOSITION. This is the message/validation portion
of the next coordinator, not the completed coordinator or a physical worker.
No runtime barrel, dashboard, task, storage, VM, provider or process-launch
consumer imports these new build-only modules.

Follow-up: V3_DORMANT_COORDINATOR records the subsequent actual coordinator with
synthetic ports. The verification below remains the historical session-only run;
the newer composition has separate source-bound evidence and no physical adapter.

## Implemented boundary

`windows-candidate-v3-messages.ts` implements distinct versioned bootstrap and
append requests/responses. External values are primitive canonical text only;
no caller object, Buffer, getter, proxy or toJSON is inspected. A private caller
phase selects the expected operation and its outer byte cap before JSON.parse.
Headers have a separate 4 KiB cap, responses 16 KiB, and existing metadata,
inventory/history and checkpoint caps still apply independently. Strict schemas
reject unknown keys, alternate encodings, duplicate keys, wrong domains and
cross-operation fallback. Inputs are copied by parsing and deeply frozen.

Request builders take a bounded canonical header and primitive inner strings.
They count the complete JSON envelope, including exact UTF-8 escaping, before
allocating its serialization. The counter rejects unpaired surrogates and stops
as soon as the remaining budget is exceeded. A header/tuple may be encoded
separately because its schema and small cap already bound it. This is not a
total-process memory guarantee: decoded copies, hashing, retained state and
native/V8 allocations still require physical C12 measurement and enforcement.

Each response binds the exact raw UTF-8 request digest, operation, lifetime,
request number, nonce, current epoch, original deadline, all inner digests and
the append pre-identity. It carries a four-digest post-identity and self-digest.
Correctly rehashing a stale/substituted echo cannot make it match the pending
request. Known post-components are independently checked: bootstrap metadata,
inventory and history digests must equal the request's exact input identities;
append metadata must equal the pre-state and inventory its exact input digest.
Unknown post-components remain CLAIMS: the coordinator must
compare it against its staged bytes and complete the separate durable-pair
protocol. The test suite explicitly preserves this negative control.

`windows-candidate-v3-validation-session.ts` keeps one private real incremental
validator for one supplied lifetime/epoch. Bootstrap does a full replay; no
summary import exists. Anchor-history equality is a supplied digest consistency
check, not authenticated discovery. Appends require the exact retained pre-state
tuple and the next request number, then use the existing incremental predicate.
The history wire grows by one bounded canonical checkpoint string; existing
history is not reparsed/re-encoded or full-reference-replayed on every append.
The aggregate history budget is checked before allocating the new string.

Any failed request permanently invalidates that session and clears its retained
strings/transcript. A failed bootstrap is charged once; repeated requests cannot
clear it. Busy re-entrant requests are refused with no queue and do not poison
the winner. Explicit close is one-way and idempotent. Clock values must be safe
nonnegative monotonic integers; a request cannot set a larger relative budget
than the proposed 30 s bootstrap / 10 s append limits. Expiry/cancellation are
checked before work and after validation and response encoding.

## Limits and deliberate non-claims

- This synchronous core belongs in future off-dashboard hosting. Post-work time
  checks cannot interrupt synchronous CPU work, enforce a watchdog, or make UI
  cancellation responsive. No shared host/worker clock conversion is implemented.
- `ready` in this session means ready to validate another request, NOT a confirmed
  ledger/anchor pair. The coordinator must retain old S while this session's T
  is advanced, and prohibit another request until the prior pair is confirmed.
- Session closure/attempt accounting is per retained session. Calling the factory
  again does not establish fresh ownership. The future coordinator/worker owner
  must retain one instance, block unauthenticated replacement and require the
  separately reviewed retirement/fencing/discovery procedure. No global string
  registry pretends to enforce physical lifetime identity.
- Host-supplied lifetime/epoch and nonce strings are descriptive bindings only.
  The future host must mint fresh nonces with a cryptographically secure source,
  hold protected IPC/executable custody, and establish authorization separately.
- No OS process, binary framing/UTF-8 byte decoder, error-frame transport,
  request-settlement witness, child termination, storage transaction or anchor
  protocol is implemented. Local failures throw one fixed redacted error.
- Parser/profile caps are unchanged. M-6 worst-admissible capacity and all physical
  B-03/W1-W5/C12 evidence remain open. No real effect or approval was consumed.

## Verification and next step

The new suite has 18 cases, including all eight outcome families/53 incremental
prefixes against a separate full-reference identity, nonempty bootstrap/restart,
missing genesis, stale/rehashed response bindings, wrong pre-state/counters,
permanent failure, time/abort seams, re-entrancy, primitive-only inputs and exact
UTF-8 size arithmetic. Both implementations share existing canonical/schema
primitives; this is producer differential evidence, not independent proof.

Compilation and no-emit typecheck pass. Final focused regression is 114/114, zero
failures/skips, 2360.8122 ms; raw TAP SHA-256
10ce777526909d73ee03dc6e182d98125cf1f1a04e38bdc10d89747372894bd4.
Final full offline verification: 2,109 tests / 2,107 pass / zero fail / two known
platform skips, 250691.4793 ms; UTC 2026-09-17T19:28:03.785Z--19:32:14.563Z.
The skips are unavailable Windows symlink privilege and the non-Windows-only
inspector refusal case. Final full TAP SHA-256:
f61828f282d830f2e574af3531fb34164f647cedc0f4f8955824b944662a8694.
Exact commands and matching selected before/after source/compiled identities are retained in
docs/reports/v3-validation-session-final-20260917.
The earlier test-only model remains separate and uses its own synthetic domains.

Self-review found that known post-state components were initially delegated to
the future coordinator. A new test independently rehashed contradictory replies
and failed with Missing expected exception before the correction; it now passes.
The actual failing TAP, source/compiled identities and an exact SHA-matched
reconstruction of the before-fix message module are retained separately in
docs/reports/v3-validation-session-post-binding-regression-20260917.
Before-fix source SHA-256:
c5fb76eccf50eed77ace2ef48984df9213367b6e8cf8ccd3e38f440b6e1e672b;
failing TAP SHA-256:
26a34bf201987ccf07189640659f38ee7241c206a8705a882d20494004062642.
The earlier 113-test / 2108-test run in v3-validation-session-20260917 is retained
as historical evidence only; it does not cover the final known-post correction.

Next: implement the dormant coordinator's one-owner/single-flight lifetime and
trusted synthetic ledger/anchor ports around this session, retaining complete
pre-state transaction comparisons, post-commit read-back, exact anchor confirmation,
and closed-state handling of uncertainty. This is unfinished work, not another
operator audit request. Request the narrow delta review when that composition
is ready; do not activate physical storage/worker/task consumers first.
