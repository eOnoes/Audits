# Current versus historical evidence

Current source: 0c01a44237fa17970e173fd99e2b9db55863e54e; clean pinned producer tree. All product members
are raw Git blobs from this commit; no private Git bundle is supplied.
Baseline successor source: fdf413aa0c7b8ed0972e5633302d59b3eac04957; packet 9c546c8e738418dc5273f7ca4bcb4ef14907bb8e.
SOURCE_DELTA.json and SOURCE_DELTA.patch enumerate the current selected changes
against that private source revision (publisher comparison, not independent
commit-membership proof). The previous public packet is not this audit target.

CONTRACT_V3 was written at baseline 06cb638 and remains a proposed design, NOT a
v3 ledger schema. Its old statement that v2 has no public all-record snapshot
was true at that writing checkpoint. It is superseded factually by the additive
snapshot() implementation at current HEAD and ATOMIC_LEDGER_SNAPSHOT.md.
The original CHECKPOINT_SEQUENCER doc pins its initial implementation and 88-test
focused run. EXECUTION_COMPOSITION pins its later 166-test focused run. Both are
historical receipts, NOT current counts or current fixture hashes. Current
fixtures now use snapshot(); the checkpoint source also has the later identity
getter. Do not apply initial source/test hashes to current blobs.

Current focused run is 128/128 (snapshot 15 + ledger 51 + checkpoint 29 + execution
33), at the current source/test bytes. Full offline is 1925/1923 pass/0 fail/2 skip.
All source/test changes were compiled and tested before the final documentation
commit; the identities in ATOMIC_LEDGER_SNAPSHOT.md match this packet. Compilation
and test results are PRODUCER-LOCAL, not independent or physical execution proof.
Prior focused 59/88/166 artifacts are supplied only to ground historical citations.
Historical full-run hashes in those old documents are references; those old full
TAPs are not supplied, not required for the current-run check, and not new claims.

The prior successor review was received as a local operator attachment. Its model
and prior-involvement declarations are reviewer-reported. This packet does not
claim that report was written back to GitHub. It is not a fresh independent
second opinion on the prior author's own suggestions. No prior review authorizes
new effects; use its concrete findings, not its confidence as evidence.

All supplied test helpers are original complete product files. managed-executor-
fixture.ts contains d/verificationResolution/verificationResult used by the new
synthetic tests as well as unrelated fixture construction. The latter is context,
not an activated operator issuer. Direct relative dependencies are supplied so
no import edge is silently assumed. Fixtures, synthetic keys, hashes and paths
are test data, not live credentials or private workstation identity.
