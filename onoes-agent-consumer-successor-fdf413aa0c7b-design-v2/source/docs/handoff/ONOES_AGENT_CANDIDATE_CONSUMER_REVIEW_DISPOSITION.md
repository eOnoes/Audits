# Candidate consumer review — intake and local disposition

Subject: product 7060f7058ae0c2febf3cf9d5b1efb3b3169f9dba, public audit packet
459aa620ae778d2d4f5eb5f2ec39f946b9f5c4be /
onoes-agent-candidate-consumer-7060f7058ae0-design-v1.

The operator supplied three files. Their contents identify one Claude report and
two copies/forms of a Kimi report, contrary to their ordering in the operator's
message. Attribution here is self-reported, not authenticated model identity.
The raw received files were preserved privately without normalization; reports
are evidence to evaluate, not instructions granting implementation or publication.

| Preserved report | Bytes | SHA-256 |
| --- | ---: | --- |
| CLAUDE_REPORT_AS_RECEIVED.md | 61296 | 99a9d21bb0dc7cabfb64d8c5b57da6d514c2f994c36af7e81492b18ef2f5b6cf |
| KIMI_REPORT_AS_RECEIVED.md | 16673 | 24e76cd688d88b097aa397ed514bdfc0603a3bac514226c12c05cbff6c6842f8 |
| KIMI_WITH_DELIVERY_NOTES.txt | 18536 | a11f611803bd42c202d4d71a1c559ff0e0d23a8c0cc3a8fa9f4c6248ad24fd7d |

Claude: NEEDS_CHANGES / NEEDS_REVIEW / PARTIAL / no activation. Two blockers
(one new contract gap, one carried physical gate), nine grouped nonblockings.
STATIC_SOURCE only; no independent subject execution. Kimi: supplemental review,
not accepted as completion of the specified consumer-contract question set.
Neither report changes W1-W5 status or grants consumer/VM/issuer authority.

## Claude findings

| ID | Local disposition and next control |
| --- | --- |
| CC-B-01 | CONFIRMED in current source and newly executed SQLite regressions. V2 missing-result stop cannot release exclusion. Successor CONTRACT_V2 section 1 selects a new, evidence-gated stopped-without-result terminal in a separate v3 domain; NOT implemented or independently re-cleared. Confirmed post-effect failure is an explicit extension for targeted review, not a claimed approval of the report's narrower suggestion. |
| B-03 | OPEN. No protected custody/freshness/anti-rollback mechanism exists. Successor section 3 defines acceptance obligations, not a backend. Global anchor append count cannot be compared directly with operation row count; absence is not proof of non-effect. These qualify the report's proposed protocol. |
| CC-N-01 | CONFIRMED host-association gap. Successor section 2 explicitly states absent v2 candidate-store/preparation/envelope fields and forbids hash/UUID substitution as authority. Actual versioned envelope and issuer remain open. |
| CC-N-02 | CONFIRMED interface gap. Successor section 4 names new delivery/session phases, separate transfer budget and stored acknowledgment. Existing three-frame/run-stop protocol and 65536-byte limit unchanged. |
| CC-N-03 | CONFIRMED semantic-only reuse. Successor section 2 names new candidate evidence binding and preserves review-before-verification plus distinct actors. No historical receipt casting. |
| CC-N-04 | CONFIRMED and strengthened executed regression. Restoration cannot fund another publish in this workflow or use another workflow to cite the old parent. Successor states the required new approved execution. |
| CC-N-05 | ACCEPTED wording correction: generation minted at acquisition before reserve; publication echoes parent bindings, not a newly observed launch. No real acquisition implemented. |
| CC-N-06 | ACCEPTED fail-closed interoperability issue. Candidate producers must use exact UTC-millisecond grammar; historical schemas/verifier checks unchanged. |
| CC-N-07 | ACCEPTED limited receipt omission. Next targeted handoff must include any raw TAP it relies upon or mark the older citations unverified historical claims. Do not rewrite the already published packet. The source/history relationship is publisher-reported in the extract; full local Git may verify it separately. |
| CC-N-08 | Prior fixes corroborated by reviewer source reading, not new independent execution. Strict winner test, historical role index, instance-boundary tests retained. Worker ordering withdrawal rests on the prior cited Node documentation, not a new experiment here. |
| CC-N-09 | ACCEPTED schema-first clarification. Successor section 5 defines explicit fields and phase enclosure, including stop within existing run budget. Concrete physical sizing/enrollment remains open. |

The reviewer suggested an anchor sequence/row-count comparison. A single row
advances through several events, so those numbers count different objects.
The successor requires complete inventory root/count and per-operation history
comparison separately from global append sequence. Likewise a stale/missing anchor
response does not establish that no effect was released; lost acknowledgments,
forged ledger rows and stale reads remain uncertainty. No such inference permits
terminal release or retry. The final anchor backend and proof of freshness require
their own focused review and physical evidence.

## Kimi assessment

Its disclosure of missing hashing capability, large-TAP retrieval failure and
GitHub write access is appropriate. Manual complete Markdown is an allowed
delivery fallback, not an implementation failure. These reports do not establish
a hash-first acknowledgment; the observed manifest pin matches the published
producer pin but does not retroactively fix delivery ordering.

- N1 is incorrect: the frozen manifest names
  `receipts/PRIOR_LEDGER_V2_REVIEW.md`, not `reports/PRIOR_LEDGER_V2_REVIEW.md`.
  The former exists and hashes correctly. No packet reissue is needed for it.
- N2 is reviewer access limitation, not missing producer artifact. The full TAP
  is supplied, hash-matched and contains 1838/1836 pass/0 fail/2 skip.
- N5 overclaims from unread evidence. Historical TAPs are explicitly labeled
  `appliesToV2Execution: false`; the full current-generation producer receipt
  is separate. This is not independent execution or proof of full Git history.
- Coverage counts 20 source/9 tests disagree with actual 26 source/8 tests.
  Its eleven replacement questions do not answer the packet's ten focused
  consumer questions, and its report structure omits required final field names.
- N3 sole enrollment, N4 coherent forgery and N7 outcome freshness are valid
  documented boundaries, not newly closed controls. A result parser plus Off
  cannot authenticate origin or replace the missing freshness anchor.
- N6 repeated import edges may describe distinct import/export sites; cosmetic
  duplication does not itself establish a dependency-closure flaw.
- Its zero-blocker conclusion does not resolve CC-B-01, which its state-graph
  summary omitted. Retain Kimi as partial supplemental review, not a second pass.

No reviewer report or public frozen input was edited or uploaded by this intake.
The request's designated GitHub report path remains the normal delivery target;
these are locally received operator-delivered originals, not a claim of verified
GitHub report publication. Any follow-up should be a numbered correction/addendum.

## Local verification of this disposition

Only successor/disposition documentation, the release checkpoint and regression
tests change. Runtime and frozen v1/v2 formats remain untouched.

Commands actually executed on Windows / Node v24.14.0:

```text
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.test.json
node --test --test-reporter=tap --test-reporter-destination=<local receipt> .test-dist/tests/unit/windows-candidate-effect-ledger.test.js
```

Typecheck and fresh test compilation passed. Focused 51/51 pass, zero fail,
skip, cancellation or todo; 3748.9246 ms. Raw producer TAP:
`candidate-consumer-review-boundary-20260914.tap`, SHA-256
`a64f8c0795da14fce976e9c8ad46b7a41d237b544de722349b89089911bab8dd`.
Two new no-result cases prove unchanged rows after denied transitions, absorbing
quarantine after actual DB close/reopen, and denial of a fresh workflow/publication.
Two added restoration assertions pin both same-workflow and cross-workflow denial.
These are local synthetic SQLite tests, not real stop/custody or v3 tests.

Before private Git synchronization, the established full offline suite was also
executed at a3fc968662a825a56cbb11b326e69d11f483d1d4 using the fresh compilation
above; subsequent changes are documentation only. Command:

```text
node --test --test-concurrency=4 --test-reporter=tap --test-reporter-destination=<local receipt> .test-dist/tests/**/*.test.js scripts/tests/candidate-review-http.test.mjs scripts/tests/candidate-crash.test.mjs
```

1840 tests / 1838 pass / 0 fail / 2 skip / 0 cancelled / 0 todo, 48608.2745 ms.
Raw TAP: `candidate-consumer-review-full-20260914.tap`, SHA-256
`213aabd3354cd319b9c83df71b94421ff069ec96758143c4cea510485eee905e`.
Skips: symlink-creation privilege unavailable, and the deliberately non-Windows
inspector refusal test skipped on Windows. Neither is promoted to physical proof.
All proposed successor consumer/anchor/delivery controls remain NOT RUN. No VM,
OS, credential, provider, real approval, original-file task edit or public
publication occurred. Private Git sync is source backup, not release deployment.

Next: targeted contract acceptance review of the new state/settlement proof,
anchor/inventory protocol and delivery/session seams before a synthetic sequencer.
This is a bounded changed-boundary review, not another full ledger re-audit.
