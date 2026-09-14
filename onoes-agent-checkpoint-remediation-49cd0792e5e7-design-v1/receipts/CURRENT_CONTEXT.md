# Current and historical facts

Current source 49cd0792e5e7f48fff1798baebaa24e170ac5371; predecessor 0c01a44237fa17970e173fd99e2b9db55863e54e, public packet 0d27ba257d09be6bea70baa2234cf42c785b7fe2.
No previous packet or report is overwritten. New report capture metadata in
REPORT_CAPTURE.json supersedes only the pinned disposition's no-local-capture
statement. Preserve capture caveats and the prior missing hash-first acknowledgment.

V3 is DESIGN ONLY. The choices in its new sections are not reviewed/implemented
mechanisms. The only changed production-source blob is the dormant v2 ledger,
adding a private identity/schema/durability check under IMMEDIATE before scan.
V2 table/index/record bytes and state graph are unchanged. Seven tests were added:
snapshot 4, checkpoint 1, execution 2. Current focused includes ALL five suites:
checkpoint 30 + ledger 51 + snapshot 19 + execution 35 + release boundary 8 = 143.
Full offline receipt is 1932 tests / 1930 pass / zero fail / two existing skips.
These receipts measure producer execution before final docs commit, not auditor
execution, physical custody or release acceptance. Historical snapshot doc at
0c01a442 and prior report's 128/1925 counts remain historical, not current claims.
The disposition qualifies the report's N-03/N-04/N-07 claims; assess both fairly.

Minimum gate question: are the design decisions ready for data-only schema work?
Real enrollment/anchor/OS fencing/VM/approvals/effects remain unavailable and are
NOT authorized even by a favorable data-design verdict.
