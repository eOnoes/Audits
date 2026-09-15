# Chronology and evidence scope

Reviewed design: 49cd0792e5e7f48fff1798baebaa24e170ac5371; prior report at Audits b86e08b.
Current implementation: f256ad29ea4176cdc60244db20fd3742769e1f0a; three new v3 modules with 47 tests
(data18 + record17 + inventory12). Dependency helpers are unchanged from design
baseline; SOURCE_DELTA gives exact status instead of relying on prose counts.
Earlier docs record intermediate 18/35 tests and broader run counts. Those remain
historical. CURRENT_FOCUSED and CURRENT_FULL are the only final run artifacts in
this packet: 47/47 and 1979/1977 pass/0 fail/2 skips. They were run locally by
producer before final documentation commit, not independently by the reviewer.

No real v3 store or consumer exists. New return values are data claims, not
availability, permission, enrollment or evidence authenticity. Full-history replay
checks every supplied prefix/root and overlap but cannot authenticate a fabricated
complete history. Physical B-03 and W1-W5 remain open. Desired verdict is whether
these contracts are sound enough for the NEXT scoped persistence design review,
not permission to install, write a real ledger, contact a provider or run tasks.
