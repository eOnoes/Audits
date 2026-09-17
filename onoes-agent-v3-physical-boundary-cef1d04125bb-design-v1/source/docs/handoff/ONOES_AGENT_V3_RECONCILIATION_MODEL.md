# V3 exact local-tail maintenance — test-only design model

2026-09-17. Producer design evidence, NOT physical recovery or production code.
Baseline: `5fb924fad14ba8c23dc317d9e53bbda7bcc1f154`.
Read with V3_PHYSICAL_ADAPTER_CONTRACT_DESIGN and the coordinator implementation
review disposition. No new public packet or external review is claimed.

## Purpose and actual scope

The model in `tests/helpers/candidate-v3-reconciliation-model.ts` exercises the
proposed one-attempt maintenance journal BEFORE physical implementation/review.
It consumes real fixture inventory/history bytes and the existing full-reference
history/pair validator. It does not grant permission to reconcile anything.

All persistent-state words refer to ordinary JavaScript objects shared by model
lifetimes. `crash()` drops only private continuation state; `open()` creates a
new model handle over the same object. `rotateAfterSimulatedRetirement()` assumes
retirement; it neither stops nor observes a real process. One object assignment
models the REQUIRED atomic anchor+journal transaction. None of these establishes
SQLite durability, power-loss handling, OS custody, IPC or authenticated consent.

The host-controlled model clock and owner epoch stand for unresolved physical
obligations. Clock high-water is retained in the shared model authority across
client reopening, not reset in each client. Actual authority restart and clock
domain conversion still need design and independent evidence; this memory field
is not a persistent Windows clock or an anti-rollback mechanism.

## Controls and falsifiability

Four modeled persistent cuts: before preparation, preparation committed/reply
lost, possible-contact marker committed/reply lost, anchor+journal committed/reply
lost. Across all 53 fixture prefixes this yields 212 observations. These are four
different retained states, not 212 independent failure modes or exhaustive
concurrency schedules. Every prefix goes through the real full-history predicate;
the positive control requires the exact pre-existing tail to produce equality.

Fourteen top-level cases cover those cuts plus one active handle, absence of a
marker, repeated/renewed intent, stale owner, malformed/noncanonical/active input,
expiry at each stage, clock regression across reopening, local/anchor drift,
forbidden full-stream relations, equal/genesis discovery and invalid inventory.
Domain-specific errors are required on denial, rather than accepting arbitrary
TypeErrors as successful rejection. No model API accepts a path, command, task
callback, reset, delete, refund or new task approval.

After a possible-contact marker, neither a new handle, new consent expiration
nor a new epoch can allocate a second append. A lost successful append response
is discoverable as an equal pair without contact. Failed handling consumes that
handle's continuation even if a test later restores the old anchor. Discovery
does not mutate journal/history and always reports `authority: none`.

Preparation-only response loss is distinct: with the SAME still-current owner,
unchanged candidate, unexpired consent and an unspent prepared record, exact
discovery can precede the first possible-contact marker. It does not re-prepare,
renew consent or consume a second attempt. This models reconnect within the same
authority lifetime, NOT recovery after replacing a physical owner. A changed owner
or expiration denies that continuation; further availability recovery is open.

The test-only world holds one maintenance intent. It therefore does NOT test a
multi-intent database's uniqueness indexes, corruption scanning, journal capacity,
or retention. The physical design still requires independent uniqueness per
enrolled predecessor/candidate and conflicting-payload exclusion. No journal
schema or physical adapter is implemented by this helper.

## Verification

Test compilation passed. Initial final-source focused model run: 14/14 pass,
zero failures/cancellations/skips, 1271.8564 ms. A preceding sandboxed compilation
was denied generated-file write access; the approved canonical-workspace compile
then exited zero. No Windows permissions or dependencies were changed.

`docs/reports/v3-reconciliation-model-20260917/run.mjs` is a create-only producer
runner for the combined focused and full offline regressions. It refuses to run
until the reviewed source/harness is committed and the worktree is clean, pins
the execution revision plus before/after source/compiled/config identities, and
keeps raw TAP. The subsequent committed-source run completed at
`65b6a833d8641eae3f1a645ba6f21dc347be0fce` with a clean starting worktree,
Node v24.14.0 on win32 x64, 2026-09-17T22:15:53.186Z through
2026-09-17T22:20:01.426Z. The selected 57 source/compiled/config identities
were unchanged before/after and matched disk in the separate artifact read-back.

| Run | Actual result | Duration | Raw TAP SHA-256 |
| --- | --- | --- | --- |
| Combined focused | 157 passed; zero failed/cancelled/skipped | 1777.6961 ms | `fed6eda5c639355f9773583526a3d872500e88db3670718b9a2a03075c7f5d99` |
| Full offline | 2152 tests; 2150 passed; zero failed/cancelled; 2 skipped | 246312.6848 ms | `f2858e52c42a4a2028ee9656c0dd56a971beeb8a61def5636f8950cee596c8b3` |

The raw files are 38,785 and 501,402 bytes respectively. Receipt SHA-256:
`406ce68a15af7df3bf440e3a99fa77403ba7734238ea377810d905bb7f72228b`.
`check-artifacts.mjs` independently re-reads those local artifacts, count summaries,
selected inputs, runtime/helper identities and the 53-prefix/212-cut diagnostics.
It is a producer consistency check, not an independent execution or audit.

The full-run skips are the binary-symlink case (Windows link-creation privilege
unavailable) and the deliberately non-Windows-only inspector-refusal case. The
first is still missing physical acceptance evidence; the latter is inapplicable
on this win32 run. Neither is a newly executed PASS.

Only selected working/compiled inputs are pinned: this is NOT a packaged-product,
installed-dependency, EXACT_TREE, Windows-native recovery or power-loss claim.
No production `src`, native or runtime script changed relative to `5fb924f`.
The follow-up design wording makes `unknown` a discovery disposition of a
consumed/unconfirmed contact marker, not an extra compensating terminal write.
This reconciles the design text with the tested three-phase model; it does not
alter the executed helper or fixtures.

## What remains

Physical PA01-PA15, authentication, protected storage/anchor independence,
store-wide fencing, maintenance durable schema, bounded resource supervision,
original-report byte archival, whole-PC rollback scope and original W1-W5 release
acceptance are all open. Next scoped review should challenge the combined design
and this model, not mistake its test count for a built adapter or an installed Agent.
