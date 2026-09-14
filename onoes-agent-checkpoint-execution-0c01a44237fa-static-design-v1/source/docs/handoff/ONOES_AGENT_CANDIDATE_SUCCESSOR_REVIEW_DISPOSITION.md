# Successor review disposition — packet 9c546c8

The operator supplied the complete Claude successor review, 65,101 bytes, SHA-256
`a5854d629f48803888d6931560b5053c24419f66d95186a859b0502ba1c1d6ce`.
Original bytes are retained privately. The public frozen input packet is
`9c546c8e738418dc5273f7ca4bcb4ef14907bb8e`, publisher product
`fdf413aa0c7b8ed0972e5633302d59b3eac04957`. Current baseline 06cb638 changes only
Studio/package tests and their handoff/goal documentation, not audited boundaries.

Reported verdict: NEEDS_CHANGES / NEEDS_REVIEW / PARTIAL. Two blockers and eleven
nonblocking entries. Synthetic v2-only sequencer readiness YES; activation NO;
v3 schema remains blocked pending changed-boundary review. The reviewer discloses
authorship of the prior review. This is a useful follow-up, not a fresh independent
second opinion. No report instruction authorizes effects.

The observed manifest hash matches our frozen 4,044-byte manifest:
`82b835ac303abcfbb46d21be7e5a673289638fa65a841dbb118f5c9196719475`.
Expected-pin acknowledgment did not reach the reviewer; do not retroactively claim
hash-first delivery. The reviewer reports 37 member/22 identity checks and four
TAP artifacts verified; no subject tests executed. CC-N-07's missing-receipt gap
is closed as packet evidence, not independent execution. Report arrival monitor
is paused after local intake. GitHub report publication has not been claimed.

| Finding | Disposition / next evidence |
| --- | --- |
| SC-B-01 | Accepted design gap. CONTRACT_V3 separates outcome/release and mandates fresh joined admission on restart. A release event alone cannot close a cross-store crash gap. Proposed correction still needs bounded review; unchanged v2 is not an activated consumer. |
| B-03 | Open physical gate: protected storage, authenticated fresh anchor, anti-rollback and actual owner fencing. No mock closes it. |
| SC-N-01 | Proposed anchor-enforced owner CAS/epoch and old-callback denial, separate from physical fencing. |
| SC-N-02 | Proposed complete post-commit inventory domain, deterministic tuples/order, empty-root and count, no archive/migration shortcut. Anchor stores authenticated claims, not knowledge of SQLite bytes. |
| SC-N-03 | Proposed bounded exact-payload reconciliation under a new-owner envelope; never rewrite historical generation and call it exact replay. |
| SC-N-04 | Explicit delivery-failed alternative and grammar-derived four-frame maximum; exact OCS1 maximum 16,782,848 bytes plus separate manifest/control budgets. |
| SC-N-05 | Destination reread digests and inventory under authentic custody, not count/hash echoes. |
| SC-N-06 | Non-circular intent core -> envelope -> authorization digest -> complete intent; no existing signed bytes changed. |
| SC-N-07 | Explicit anchor/discovery deadlines, per-pair/global reserve and bounded reconciliation, no unlimited queue. |
| SC-N-08 | Accepted: success run/stop deadline differs from timeout cleanup reserve; add stopMs on worst-case failure plus settlement/anchor costs. |
| SC-N-09 | Sole version-spanning enrollment/consumption required; unchanged digest domain does not enforce cross-store uniqueness. |
| SC-N-10 | Record withdrawal of two prior reviewer claims; event sequence is not row count, absent/stale ack is not no-effect proof. |
| SC-N-11 | Earlier findings retain individual disposition; formerly missing TAPs available/verified as artifacts, no new execution claim. |

CONTRACT_V3 is a new local design artifact, not a rewritten frozen audit input.
No v3 parser/store, physical adapter, approval envelope, issuer or real consumer is
implemented by these changes. Physical operator work and full release scope remain.

## Local executed boundary evidence

At baseline 06cb638 plus this documentation/test delta, Windows x64 Node v24.14.0:

- `node node_modules/typescript/bin/tsc --noEmit`: exit 0.
- `node node_modules/typescript/bin/tsc -p tsconfig.test.json`: exit 0 under the
  project owner's context. Initial sandbox emission failed EPERM on existing
  generated outputs; it was not a passing compile. No ACL/ownership/OS adjustment.
- `node --test --test-reporter=tap .test-dist/tests/unit/windows-candidate-release-boundary.test.js .test-dist/tests/unit/windows-candidate-effect-ledger.test.js`:
  59 tests / 59 pass / 0 fail / 0 cancelled / 0 skipped, 2868.9276 ms.
- PowerShell-captured TAP artifact `candidate-release-boundary-20260914.tap`,
  SHA-256 `151806b29b078e04776853e796f90b31d7d4f92026f22ae75a3ef19d0dad7f67`.
  It is retained in the local audit-preparation workspace, not claimed as an
  independently executed report or byte-identical pre-capture stdout stream.
- New test source SHA-256:
  `5a9fa80a8a368bed249cd68730f533f54ab26195e8ec5b1a8fa97930ec28bff8`.

Eight new cases plus the existing 51 ledger cases execute, without platform skips.
The new cases affirmatively reproduce raw v2 reservation after releasing terminals,
checkpoint-mismatch detection by a separately retained test oracle, terminal-row
deletion invisible to `listBlocked`, and unchanged absorbing v2 quarantine. They
are NEGATIVE controls documenting the need for composition, not an implemented
release/admission fix. SQLite connections really close/reopen; no host reboot,
power-cut, independent persistent anchor or authentic physical custody is tested.
The synthetic inventory helper assumes no concurrent second writer and is not a
production atomic snapshot API. No full offline-suite rerun is claimed for this
test/documentation-only change; historical full receipts retain their own revisions.
