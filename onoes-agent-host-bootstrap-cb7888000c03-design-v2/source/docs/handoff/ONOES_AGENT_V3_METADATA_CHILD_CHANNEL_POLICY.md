# Child inherited-channel local checks

2026-09-19 UTC, working inputs atop `ce0dbe10e5c87eecb1b25c86f7804ca4a302566d`.
Pure test-only bookkeeping; no native child adapter or product consumer added.

## Implemented prerequisite, not admission

HostChildChannelPolicy consumes the existing fixed HostInheritancePolicy role
map, in order. Each endpoint has a distinct positive fixture token and two
observations: before clear, exact pipe type 3 / inheritance flags 1; after clear,
successful call plus exact type 3 / flags 0 on the same token. Duplicate tokens,
wrong route/direction, out-of-order observations, unknown flags, partial startup,
second completion and extra endpoints latch denial. No retry or reset exists.

All observations and final consumption use monotonically nondecreasing original
elapsed time, with inclusive denial at min(workMs,5000). A child-local fresh clock
must NOT be substituted by a future adapter. The policy owns no native handles;
it neither closes them nor says that denial proves cleanup. LocallyChecked is a
historical local result, not a live authority check; RequireLocallyChecked samples
the original elapsed time again and can revoke that result.

Route signs and tokens do not prove kernel access masks, pipe direction, endpoint
identity, enrolled context or peer identity. A future native caller must retain
the actual handles, obtain these observations itself and separately prove those
properties before readiness. No API here returns launch/effect permission or
turns a caller's booleans into physical evidence. G/S independent lifetime and
the creator's no-concurrent-broad-inheritance requirement are unchanged.

## Producer execution

Two create-only captures under
`docs/reports/v3-metadata-host-child-policy-20260919-{initial,final}` each pass
876 pure checks, warnings-as-errors compilation, zero native cases. The harness
compiles only the topology policy, this policy and its tests; it rejects native
interop/process/file API markers in those sources. Tests inject all observations.
Four inputs, five tools, four raw outputs and two binary/config identities per
capture are pinned; all 30 identities were rehashed locally. Sources and tools
were unchanged during each capture. This is producer evidence, not an audit.

## Next work

Implement the fixed-role native startup adapter and its separately bounded
synthetic driver. Resolve inherited-handle delivery, original-clock continuity,
actual access/direction/context proof and cleanup ownership without accepting
arbitrary public handle values as authority. Compile-only work and pure tests
can continue; new native child execution is outside the earlier three-mode
suspended-only approval. No VM/provider/service/installer ran. W1-W5 remain open.
