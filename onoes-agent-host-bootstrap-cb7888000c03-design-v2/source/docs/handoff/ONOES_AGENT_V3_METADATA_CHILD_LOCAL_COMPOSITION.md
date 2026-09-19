# Trusted-child local check composition — not authentication

2026-09-19 UTC, working inputs atop `49d474f2ec83dcd2cff0f83832008f87215780e4`.

MetadataHostChildChecks now composes the pure startup order with the native local
checker. It snapshots the fixed role's endpoint list and expected nonce, claims
one attempt per role/process, retains every SafePipeHandle before inspecting any
slot, rejects duplicate raw values, and supplies actual observations to the pure
policy before/after each inheritance clear. Granted access must exactly match the
fixed role map. Final completion rechecks the existing clock's nonce/work binding
and original elapsed deadline. No new clock origin is captured.

A partial failure closes the policy and invalidates that supplied run clock.
The caller still owns all endpoints and must close them on denial. Temporary
references unwind in reverse order; a denial is not evidence of child stop.
The static attempt latch cannot be reset by another policy instance. It is scoped
to the trusted managed process, not persistent history or a hostile realm.

The method is internal and returns no handles, acknowledgment, role capability,
or execution permission. There is still no runtime caller, raw-handle parser,
child-resume path or production consumer. Expected role, clock, nonce and work
must arrive from the authenticated launcher, not from task input or by echoing
the pipe's bytes. Equal access masks cannot establish peer/endpoint identity.

## Reuse and remaining boundary

The existing OMK1 MetadataHostClockContext/Transfer already validates the exact
origin, frequency, nonce, host-session reference and work budget against external
pins. Do not introduce a second clock format or reset origin on child receipt.
That parser is expressly not authentication: protected delivery of those pins
and the exact inherited endpoint list remains the missing launcher composition.
The older OMC1 guest-service context is a different role protocol and is not
silently reused for the host G/C/W/S topology.

Next, design/implement the dedicated launcher's trusted bootstrap delivery and
the bounded child fixture together; ensure no circular claim where the endpoints
or clock attest to their own identity. Native physical execution must be separately
authorized. G/S independent lifetime and physical release gates remain open.

## Evidence

The initial compile capture `v3-metadata-child-local-20260919-composition` failed
CS0165 (flags not definitely assigned through a short-circuit assertion).
It is retained, not overwritten. Initializing the local flags variable corrected
it; `...-composition-final` compiles the six-source DLL with warnings-as-errors.
Its seven source/capture inputs, five tools, two outputs and one DLL are pinned.
Native assembly NOT LOADED, native APIs NOT RUN. This turn did not re-execute
the earlier pure tests, whose historical receipts remain distinct. No VM,
provider, service, real approval or W1-W5 acceptance occurred.
