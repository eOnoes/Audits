# Audit request — paired model recovery HTTP composition

AUDIT-ONLY: read-only STATIC_SOURCE. No installs, builds, tests, providers, charges,
Git writes, Actions, guests, deployment or source forwarding. Return Markdown only.

Audit ID: onoes-agent-model-recovery-http-48c7c0e7415f-static-v1.
Publisher source: 48c7c0e7415f18d2da1b23007a544de8d5e95424.
Reviewer: operator selects; report actual model, route, date and prior involvement.
Source identities are publisher-reported commit membership, not a verified bundle.
This is a new composition review, not production authorization.

Read first: windows-operator-settings-http.ts, windows-operator-model-recovery.ts,
windows-operator-session.ts, windows-managed-model-budget.ts and their tests.
All are under source/src/build-only or tests/tests/unit. Other supplied code is
schema/caller context, not permission to expand into the wider product.

Verify the separately supplied MANIFEST.sha256 file hash and all member hashes,
byte lengths and Git blob OIDs if raw-byte access permits. Report limitations:
matching printed digests is not hashing files; reconstructing a manifest does
not validate the fetch pipeline. Do not infer the expected hash from the packet.
No package-lock or installed dependency is supplied. DEPENDENCIES.json records
missing lexical imports; request missing load-bearing context instead of guessing.

## Questions

1. Is the route absent by default and fresh handler-observed pairing required?
2. Are the host book/pin fixed before pairing, never selected by HTTP input?
3. Does one controller survive requests, failures, logout and fixed-window resets?
4. Do Origin/Host/port/peer/method/content-type and cookie/CSRF checks deny access?
5. Can body receipt, callback or response serialization outlive session authority?
6. Do malformed, oversized, incomplete and canceled authenticated bodies count
   against the sliding transport quota before any book access? Distinguish global,
   outer transport and inner controller quotas and their different sample times.
7. Can canonical reserialization admit input whose original spelling was rejected?
8. Can disconnect or post-snapshot revocation disclose inventory or cause retry?
9. Does response serialization remain bounded without double JSON encoding?
10. Is metadata read scope distinct from human identity, funding/source consent,
    actual charge, approval, task execution and release authorization?
11. Are immutable missing/unknown/observed histories preserved with no refund,
    rewrite, reset, hidden correction or redispatch path?
12. Are prior settings/task/effect routes and pairing scopes unchanged when disabled?
13. Do tests distinguish trusted mock ports from real temporary query-only SQLite?
    Find vacuous assertions and absent cross-process/browser/native evidence.
14. What minimal remaining fixes/gates are needed before a production consumer?

Known limits: handler/session lifetime is trusted-host-owned; restart resets
in-memory quotas. Cookies have no port isolation. Same-user and same-origin script
compromise are not solved by CSRF. No real bootstrap/UI integration or human
identity evidence exists. No provider, native or installer acceptance is supplied.
Do not treat declarative metadata or author test counts as executed proof.

## Required report

Return Executive Summary; Audit Identity; Scope and Method (files actually read);
Verdict; Blocking Findings; Nonblocking Findings; Verification Results; Security
and Integrity Review; Limitations and Missing Evidence; Required Next Action;
Explicit Non-Claims. Findings need ID, severity, exact file/symbol/line, observed
fact, consequence, trust assumptions, and a falsifiable proposed test. Do not run
proposed probes. Separate inspected source from author claims and hash arithmetic.

Finish with MODEL_ID, ROUTE, AUDITED_REVISION, IMPLEMENTATION_VERDICT
(PASS/PASS_WITH_FINDINGS/NEEDS_CHANGES/NOT_IMPLEMENTED), SECURITY_VERDICT
(PASS/NEEDS_REVIEW/BLOCKED/NOT_APPLICABLE), EVIDENCE_VERDICT
(COMPLETE/PARTIAL/INSUFFICIENT), BLOCKING_FINDINGS, NONBLOCKING_FINDINGS,
TEST_RESULTS (NOT RUN), SCOPE_RESULT, PLATFORM_LIMITATIONS, ADVANCEMENT
(dormant only), NEXT_REQUIRED_ACTION. No production activation verdict permitted.
