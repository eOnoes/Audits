# Candidate execution/publication consumer contract — review draft v1

Date: 2026-09-13. Inspected product: ac279d223df8defcae9dc85ff7cc32ea5f89239d.
Status: DESIGN FOR REVIEW, not a consumer implementation, approval format,
protected-storage mechanism, permission to run a VM, or activation clearance.

This is the next contract review requested by Claude's ledger-v2 report at
audit commit bb314be8a215429853422cfd7a9619cd0de0e0cf. Its reviewed input remains
0d31bf74230759482575340968f2340bb23d393e; the subsequent test/doc-only corrections
are documented in `ONOES_AGENT_DISPATCH_LEDGER_DECISIONS_V2.md`. No frozen input,
historical lease/MAC, ledger schema or result format is revised by this draft.

## 1. Product outcome and owners

The operator reviews a complete predicted candidate, explicitly approves one
bounded verification execution, receives authenticated result/stop evidence and
a fresh review, then separately approves publication of the exact changes to
permitted originals. Producing a candidate or running synthetic fixtures alone
does not finish the Agent. Original writes and allowlisted task execution remain
required release outcomes, not replaced with permanent read-only operation.

The host owns enrollment, approval verification, the sole ledger and freshness
anchor, policy, physical source/publication custody and old-owner fencing. A
protected guest controller owns the allowlisted runner and its observation
channel; repository-controlled task code must not share that controller's
identity, write its output, replace its binaries or edit its verification subject.
The UI and models are untrusted requesters. The ledger is a data service, not
the issuer or controller. No actor gains a role from a model-name string.

## 2. Existing values: exact bindings, no authority conversion

These mappings are proposed acceptance obligations, not a new wire parser.
All cited source paths are relative to `src/build-only/` unless stated otherwise.

| Ledger field / association | Required source and check |
| --- | --- |
| namespaceId, storeId | Sole protected host enrollment, never HTTP/model-selected IDs or a path chosen by the task. Exact match to the opened ledger and protected freshness anchor. |
| operationId | Host-created execution ID; equals the genuine verification request's operationId for execute. Publication gets a distinct host operationId and retains executionOperationId as parent. Never rewrite the parent's verification request to use the publication ID. |
| workflowId, approvalId, kind | Host-owned workflow and separately authenticated capability. One execute approval covers transfer AND launch; publish has a fresh approval ID, same workflow, distinct capability/issuer-acceptance purpose. |
| candidateDigest | Exact saved artifactDigest used by `compileManagedCandidateReview`, qualified by its candidateStoreId in the authenticated host authorization context. Do not substitute workProposalDigest. |
| reviewMaterialDigest | Exact compiler-produced reviewMaterialDigest, matched by authenticated pre-dispatch review and current complete source reinspection. |
| workspaceDigest, policyBindingDigest | Genuine preparation.request fields; compare to current host policy and physically identified source workspace. Hash equality is not physical identity. |
| requestDigest | preparation.request.requestDigest produced by `prepareManagedCandidateVerification`; catalog, runner, command and full unchanged/edited file set remain bound. A parsed JSON copy cannot recreate WeakSet provenance. |
| sourceManifestDigest | manifest.manifestDigest from `createCandidateSourceManifest` / `parseCandidateSourceManifest`, bound to the same request and complete subject. No file subset or old 64-file import conversion. |
| guestImageDigest, guestGeneration, controllerIdentityDigest | Independently enrolled image/artifact pins and a fresh host-observed launch generation. A VM UUID, Saved state, checkpoint ID, file hash or guest echo is not a substitute for all three. |
| resourcePolicyDigest | Separately pinned, versioned host policy defining all physical resource, transport, deadline and outcome-age limits. The ledger stores only its digest; no such policy issuer is implemented here. |
| expiresAt | Exact signed authorization expiry, no later than task/scope/review/policy validity. Bounds new forward activity; late stop/failure bookkeeping cannot renew it. |
| publish resultDigest / executionOperationId | Exact independently authenticated passed result and completed execution in the same enrolled store/workflow. The ledger's parent check alone is insufficient. |

`windows-managed-candidate-review-verifier.ts` authenticates a separately pinned
reviewer's signed assertion, not human consent or an execution approval.
`windows-managed-candidate-verification.ts` and the source manifest/transfer
codecs supply identities and bounded bytes, not physical custody or dispatch.
`parseManagedVerificationResult` validates a trusted runner's claims, not the
runner's identity. `WindowsManagedVmVerifier` joins run settlement and a trusted
Off observation but is only an in-memory lifecycle composition. Its interface
does not supply the protected controller, durable ownership or source transport.

Legacy kernel leases, remediation approvals, model funding/consent, MCP grants,
planning acknowledgments and compiler brands MUST be rejected at a candidate
execute/publish entry point. No field renaming, cast, matching digest, shared key
alias or familiar actor name creates interoperability. Any future bridge requires
its own exact acceptance/source review; historical bytes remain unchanged.

## 3. Authentic authorization and durable ownership prerequisites

Before implementing an effect-capable consumer, specify and review a candidate
authorization envelope with a distinct signed purpose/domain and pinned issuer
acceptance for execute versus publish. It must bind the complete immutable ledger
intent, candidate-store identity, genuine consent evidence, authenticated review,
builder/reviewer/verifier identities, issuer policy/revocation generation and
validity interval. This list is NOT an implemented signature schema or issuer.
Signing or enrolling real keys remains separately authorized work.

The host must establish a single dispatch owner and generation, with a physical
fence enforced by the effect adapter, not only a DB row or in-memory boolean.
Every callback capable of causing an effect must reject an old generation even
if the old process wakes after cancellation, lease expiry, restart or timeout.
The task cannot set or replace that fence. Verify ownership before and after
each asynchronous boundary and at the effect itself; checking twice is not a
substitute for enforcing the fence during the effect.

An exclusive in-process handle may track one live sequence and latch each phase
attempt before callback invocation. A brand is only misuse resistance: the real
protection comes from host custody/fencing and the separately authenticated
approval. No caller-supplied `approved: true`, `fresh: true`, nonce or fake adapter
can satisfy a production prerequisite. Synthetic ports remain test-only.

## 4. Intended forward sequence

Each durable step is a short transaction. Never await or call a caller-provided
filesystem, VM, review, clock, signing or network callback inside one.

1. Authenticate the session and exact execute intent; compile/reinspect the whole
   candidate with current rules and review. Verify physical source and enrolled
   host/guest/resource identities. Deny before source disclosure or ledger
   consumption if any prerequisite is absent, expired, revoked or mismatched.
2. Acquire the protected owner/fence and cleanup budget. Reserve exactly once in
   the sole ledger. Only a new, exact, confirmed `recorded` result can continue
   this live sequence; any `replayed` result goes to read-only reconciliation.
   Couple the committed row to the protected authenticated freshness state
   described in section 7 before releasing any effect.
3. Recheck all forward prerequisites. Commit/read back `source-delivery-possible`
   and its protected freshness association BEFORE the first source byte leaves
   the host's authorized custody. Latch delivery-attempted before invoking the
   adapter. Partial transfer is an attempted effect, not a retry opportunity.
4. Transfer the complete new-version manifest and every exact file, including
   unchanged files. A successful receiver finish only declares end of input.
   Require authenticated transport EOF/settlement, destination physical custody
   and complete read-back separately. Acquisition must not run repository code.
5. Recheck authority, policy, remaining deadlines, owner and immutable subject.
   Commit/read back `launch-possible` and freshness association before invoking
   the one fixed runner. Latch launch-attempted before synchronous or async port
   contact. No second reserve/consumption for this same execute approval.
6. Withhold results until exact run, channel and descendant settlement AND the
   matching host-Off observation. Bind the authenticated controller result to
   the original request, source, runner, generation and measured execution/stop
   interval. A syntactically passed result, zero root exit or Off alone cannot
   establish this. Parse with the existing exact result parser only after bounded
   transport and authentic origin checks.
7. Record result-and-stop-observed, then completed/failed, using the original
   operation, only for established facts. Persist the protected freshness
   association before publishing a successful receipt. A write/read-back/anchor
   uncertainty stops the sequence; it never triggers a compensating retry or
   a fabricated failure terminal. A completed record remains historical data.
8. Before publication revalidate the authenticated fresh review and independent
   verification evidence, enforce actual builder/reviewer/verifier separation,
   current original bytes, current allow/deny policy and authenticated parent
   freshness. Preserve review-before-verification chronology as described below.
   Obtain a NEW
   explicit publish approval for the exact result/diff and original destinations.
9. Reserve the publish operation under the same namespace/store/workflow, bind
   its completed execution parent, then commit/read back publication-possible
   and freshness association before any original write. Use the separately
   reviewed physical publication adapter. Keep parent/target custody through
   exact attempted-only replacement, read-back and any safe restoration.
10. Complete publication only after exact originals read back and all related
    work settles. Restore only attempted files with matching expected state;
    third-party bytes or uncertain work force quarantine. Do not invoke the
   legacy in-place executor or reuse a cached result in a different request.

The existing `src/builder/agent-workflow.ts` requires verification time no earlier
than review time, and reviewer/verifier identities distinct from each other and
the builder. Do not append a newly dated post-run review and claim that the prior
run verifies it. A still-valid pre-dispatch review of the exact unchanged candidate
can precede the authentic verification run and be revalidated at publication;
revalidation must not rewrite its signed time. If review/material/subject changes
or freshness demands a new review after that run, obtain a new properly approved
execution workflow after valid old-work settlement, then verify after the new
review. One execution per workflow and all spent approval IDs remain retained.
This is a consumer ordering obligation, not automatic compatibility with the
historical workflow receipt issuer or its serialization.

No production consumer implementing these steps exists yet. The current
fixture-only ledger dependency guard must eventually be replaced by explicit
approved-consumer checks, not deleted to bypass review or retained as a reason
to call permanent dormancy finished.

## 5. Replay, failure and restart decisions

| Observed condition | Required behavior; no hidden effect |
| --- | --- |
| Any reserve/marker returns replayed | Return historical status or explicit recovery-needed. Never invoke transfer, run or publication from replay, even if state is reserved/completed. |
| Invalid/expired/revoked input before reserve | Deny, no ledger write or effect; dispose any already owned preparation resources. |
| storage-unavailable or response/read-back loss | Do not classify as SQLITE_BUSY, untouched or safely retryable. Latch the live operation closed, retain blockers/fence and request only bounded authorized cleanup. Reconcile from independently protected state. |
| New process or new ledger instance | Discovery only until old owner is physically fenced and protected freshness verified. A missing row in a rollbackable DB is not proof of no prior operation. Do not reconstruct a live dispatch capability from saved bytes. |
| Source-delivery-possible without confirmed destination | No resend under this approval; stop the exact owned generation. If facts/stop are uncertain, preserve exclusion/quarantine. |
| launch-possible without authenticated result AND confirmed stop | No second launch, successful receipt, rollback of live work or new workflow on that workspace. Stop is still permitted after authority expiry. |
| Off but unknown host/guest work | Off is one observation, not release of every process/handle/channel or fence. Retain uncertainty until each required owner settles. |
| Confirmed stopped failure | Record only the established result/stop facts; no inferred pass, refund or automatic retry. A later run needs new legitimate approval and must not bypass a blocker. |
| Late success outside host result deadline | Preserve as a historical observation through separately defined reconciliation evidence, never authorize publication from it. Ledger permissiveness is not freshness policy. |
| Quarantine, corrupt row or invalid anchor | Absorbing deny; no new workflow, prune, repair, partial-inventory authority or automatic store replacement. Protected forensic inspection is separate. |
| Publication already original | Count an attempted file as already restored only after exact read-back; never rewrite unattempted files. This cannot prove other attempted files restored. |

Cleanup does not require a still-live forward approval, but its authority is
limited to the already owned generation/resources and bounded stop/restoration.
Do not kill unrelated processes or change VM/OS/security configuration as recovery.
If a durable write was attempted and its outcome is uncertain, do not issue
another terminal write merely to persist the in-memory poison reason. Record
local diagnostics separately and withhold effect permission.

## 6. Deadlines, freshness and complete scope

The future enrolled resource policy must explicitly set acquisition, transfer,
verification, stop, settlement and overall budgets, plus maximum parent age at
publication. No default unlimited value or implicit sum is accepted. Existing
caps remain: acquisition <=30 s, failed-acquisition cleanup <=10 s, verifier
acceptance of run AND stop <min(60 s, request.timeoutMs), stop <=10 s. These are
ceilings, not predicted durations; current complete-source codec supplies byte
caps, not a transfer deadline. Transfer/outer/parent-age values remain review
inputs to be selected and measured before a real adapter is enabled.

Use a monotonic live deadline; retain a trusted UTC validity check separately.
Require enough remaining budget for the next bounded phase AND stop/settlement
before beginning it. A delayed timer, Promise rejection or clock jump cannot
declare quiescence. If the host event loop is blocked or dies, an independently
owned watchdog/fence must prevent delayed work; a JS timer is not that watchdog.
Do not wrap the whole VM lifecycle inside the old executor's 5 s step or widen
that historical ceiling to conceal a mismatch.

Preserve 128 files, complete unchanged/edited scope and the codecs' existing
byte/count limits. The preparation/channel still rejects requests above 65536
bytes. The new complete-source manifest can describe larger path sets but does
not remove that request limit. Do not silently narrow files or claim all
128 maximum-length paths can dispatch through the old channel; any new request
transport needs a separately versioned end-to-end capacity review.

## 7. Protected storage is an unsolved prerequisite, not a boolean

The current DB and unkeyed hashes cannot detect coherent rewriting, older
snapshots or deletion. A protected anchor must bind at least installation,
namespace/store identity, owner generation, an authenticated committed-state
digest/history position, relevant approval evidence and retained spent IDs.
It cannot live solely in the same rollbackable file/image or accept a restored
snapshot's claim about its own freshness. Key rotation, archival, backup and
restore must preserve spent-ID/freshness continuity; no new namespace resets it.

Commit-to-anchor ordering is an OPEN implementation protocol: forward effect
requires both exact ledger commit/read-back and matching independently protected
anchor acknowledgement. A crash/response loss between them leaves reconciliation,
not dispatch. Likewise a terminal cannot release the physical fence or support
publication while its anchor association is uncertain. Merely writing a second
SQLite file, MAC, signature or count is not an atomic freshness protocol. Review
every crash cut, restored image, deleted row and anchor outage before choosing
the backend. No TPM, service, key enrollment or external anchor is installed here.

## 8. Required falsifiable consumer controls (not yet executed)

Each control must assert exact effect-port call counts and durable read-back,
not only an error string or a returned boolean. Happy-path controls must also
prove real effects in the scoped guest/managed workspace when independently
authorized; mocked success does not close physical or release gates.

1. Substitute each identity in section 2, legacy capabilities and clone/proxy
   provenance: zero dispatch/publication calls, no unintended consumption.
2. Concurrent duplicate clicks: one owner and at most one delivery/launch;
   replay after success, cancellation, quarantine, restart and response loss
   never calls an effect. Same-namespace second-store enrollment must deny at
   the host boundary even though the data-ledger test deliberately accepts it.
3. Kill/interrupt before and after each reservation, marker, anchor confirmation,
   source byte, launch call, result, stop and terminal commit. Old-generation
   delayed callbacks deny at the adapter; no automatic resend/relaunch.
4. Force storage-unavailable before lock, after commit and during read-back;
   identical visible errors must not cause the host to infer the same history.
5. Revocation/expiry/cancellation at every await seam and immediately before
   actual effect: zero additional forward calls; bounded owned cleanup only.
6. Forge coherent rows, rewrite store IDs, roll back/deletions and rotate keys:
   protected host freshness fails closed without resetting spent IDs.
7. Supply fake passed result, stale/mismatched request/generation, mutable subject,
   missing EOF, root-only exit, late result and wrong Off observation: no pass
   or publication. Preserve authenticated failure separately from corrupt wire.
8. Publication parent age at inclusive cutoff, changed unchanged-source file,
   new deny/policy revision, absent fresh independent review, and execute approval
   substituted for publish: zero original writes.
9. Publish then lose response; reopen and inspect actual target state under
   physical custody. No second write from replay; attempted-only restoration and
   third-party drift yield exact counts and quarantine as appropriate.
10. Full package negative entry-point audit: no CLI/HTTP/barrel/script can reach
    unreviewed effect ports or bypass enrolled issuer/policy/fence checks.

## 9. Review/implementation exit criteria

Review this contract against the exact ledger, preparation, source codecs,
review verifier, VM lifecycle and publication custody design. Resolve symbolic
budget values, authenticated authorization format, physical fence, independent
anchor/retention protocol and concrete adapter feasibility before enabling a
production consumer. Independent execution and original W1-W5 remain required.
This draft closes none of those missing mechanisms by describing them.

Next implementable slice is a reviewed synthetic controller composition only
after its acceptance contract is agreed; a real controller/task identity probe
is still separate from that composition. The canceled G0-A prompt has not been
retried. No source transfer, real approval, guest task or original write follows
from drafting or reviewing this document.

## 10. Producer checks of this draft

Only this document and the release-goal checkpoint changed. Current source was
read directly after the 74-file code index explicitly reported itself stale;
the index was orientation, not proof of present behavior or entry-point closure.
The existing syntax-inventory and source-pattern suites passed 12/12, zero
failures/skips/cancellations, 1026.4848 ms. Raw local producer TAP:
`candidate-consumer-contract-inventory-20260913.tap`, SHA-256
`941640a4b75cdad1820559b61c6b344d7b6712d6e514146473d661e9da5dd790`.
These checks retain the fixture-only ledger dependency guard and test scanner
behavior; they do not validate this proposed security architecture. No new
full runtime regression was needed for a documentation-only delta; the prior
ac279d2 checkpoint's 1838/1836/2-skip producer run remains the runtime evidence.
All ten section-8 consumer controls are proposed, NOT RUN. No outside review
of this new contract has yet occurred and no new review packet was published.
