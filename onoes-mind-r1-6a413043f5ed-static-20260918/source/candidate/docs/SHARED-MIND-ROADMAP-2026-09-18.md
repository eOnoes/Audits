# Shared Mind roadmap and implementation contract proposal

Status: REVIEW REQUIRED. This reconciles current operator requirements with v4.2 and the September audit. It is not a deployment approval or evidence that planned capabilities exist. The canonical plan remains unchanged until independent review. Source baseline: 6a413043f5ed18fe1f8e27b446971775cb5fe39c.

## Agent identities and runtime families

| Identity | Runtime family | Intended placement | Evidence |
|---|---|---|---|
| Echo | Hermes | User PC; stays there | Operator instruction |
| Cyony | Hermes | Cloud | Operator instruction; deployment unverified |
| Tripp | OpenClaw | Existing installation; exact active binding to verify | Operator instruction |
| trial-hermes | Hermes trial adapter | X:/SANITIZED/LOCAL_PATH | Folder/docs inspected; real executable unverified |
| trial-openclaw | OpenClaw trial adapter | X:/SANITIZED/LOCAL_PATH | Folder/docs inspected; real executable unverified |
| trial-pi | Pi trial adapter | X:/SANITIZED/LOCAL_PATH | Folder/docs inspected; variant/executable unverified |
| Onoes-Agent | Custom agent | Separately built client | Operator requirement; adapter contract to be implemented |

Identity is independent of model, runtime family and device. Echo and Cyony must never share credentials, private memory, or session identity merely because both use Hermes. Trial identities must not reuse production principals. Pi's simple/coding/kitchen-sink variants are operator-described options; inventory and capability negotiation must establish the exact installed variant. Do not infer compatibility from its name or shared ancestry with Onoes-Agent.

## Architecture and authority

One Mind service owns canonical memory, revisions, project knowledge, reviewed skills, durable checkpoints and coordination receipts. Every client uses a versioned adapter. Model hosting is independent: Echo can stay on the PC and call the future LLM server while using the same Mind endpoint.

Production destination preference: cloud primary once qualified. Local qualification comes first. Mind gets its own service identity and lifecycle, even if initially on Cyony's VM. That VM remains a shared failure domain until separated. SQLite resides on the service host; no shared-file database across PCs/cloud, and no simultaneous local/cloud canonical writers.

Information categories:

| Category | Authority | Local treatment |
|---|---|---|
| Identity and hard constraints | Governed agent kernel | Minimal protected boot material |
| Session recovery | Agent session store, with synchronized verified checkpoints | Continuous local saves; not automatic trusted knowledge |
| Project facts and build details | Scoped canonical memory; source files in Git/artifact storage | Relevant authorized cache and working files |
| Universal skills | Reviewed skill registry with immutable versions | Verified compatible cached packages |
| Custom skills | Agent-private until reviewed promotion | Agent-specific cache/package |
| Uncommitted observations | Pending journal, never canonical until acknowledged | Bounded durable queue and visible pending status |

The operator's continuous local session backups refine the former no-spill default. They do not authorize a second semantic-memory authority. Healthy-mode pending synchronization is a newly proposed bounded feature needing a contract, secret scanning, size/age limits and recovery tests. Full session transcripts remain local by default; curated facts and minimal task checkpoints may be synchronized according to policy. No real memory ingestion in the repair slice.

Mind content never authorizes shell/browser/deployment operations. Agent/Control retains execution policy. The librarian proposes normalization, deduplication, review and retention; deterministic policy enforces state changes. No automatic deletion based only on an LLM judgment.

## Sequence and acceptance matrix

| Slice | Planned work | Acceptance gate | v4.2 ownership |
|---|---|---|---|
| R0 | Hash-bound baseline/ownership receipt, new plan, independent review | Existing protected work preserved; exact patch and report reviewed before promotion | Prerequisite |
| R1 | Authentication replay, expiry, transaction atomicity, secret-write coverage, integrity | Reproducing regressions; no failed writes leak side effects; full local suite | A/A.1 |
| R2 | One memory identity/revision contract across search/context/deletion; checkpoints | Submit/correct/delete consistent in every read path; restart restores objective and checkpoint | A |
| R3 | Durable skills and scoped promotion | Same approved hash across clients; private isolation; restart/rollback/revocation | A and E governance |
| R4 | Versioned service and adapters, resource bounds, deployment packaging | Installed runtime/version/capabilities verified; offline contract tests; Windows/Linux qualification | C |
| R5 | Sequential runtime handoff trials | First trial stopped, second resumes from accessible artifacts; stale writes denied; roles rotated | C |
| R6 | Cloud and distributed availability continuity | Backup/restore, partition, stolen-device revocation, replay/ack, recovery barrier, bounded cache | A.1/C |
| R7 | Retrieval quality and controlled production onboarding | Measured retrieval/latency; narrow Echo pilot, then expansion with rollback evidence | D/E |

Phase B remains an optional synthetic Supermemory comparison lane, with no dependency on it for storage, authority, skill registry or offline operation.

Audit disposition: A01/A02/A06 are addressed by the first isolated repair candidate; A03 only gains a worker-result credential guard. Full cross-path admission, private result scope and authenticated provenance remain open. A04/A05 are next canonical-contract work. A07 requires service identity/transport changes. A08 belongs to the durable skill slice. A09 requires retrieval evaluation and serialization budgets. A10 requires portability/migration/restore closure. A11 requires this review and a current documentation index. No audit item is rejected.

## Distributed continuity reconciliation

Retain all DC-01 through DC-15 from the existing v4.2 reconciliation proposal. Their adoption remains architecture-level until their gates pass.

- DC-01/02/03: mandatory primary routing, deterministic breaker, distinguish client partition from independently corroborated service outage. Authentication/schema failures do not activate offline privileges.
- DC-04/05/06: bounded, signed/encrypted device capsules, content lineage, separate agent kernel/cache/journal. Session backups are separate from the capsule; they are not blanket authority to recall private/shared material.
- DC-07/08: journal durability, stable event IDs, local acknowledgement distinct from canonical commit; no minting new IDs to evade conflict checks.
- DC-09/10: enrollment, revocation, sensitivity TTLs, anti-rollback and per-device key roles. Offline revocation latency is bounded by expiry, not instant revocation claims.
- DC-11: independent recovery/monitoring and documented cloud/agent failure domains.
- DC-12/13: authorization before capsule selection; poisoned, invalid, expired or revoked content cannot be used as dynamic authority.
- DC-14: recovery barrier reconciles pending outcomes, revocations/deletions, ownership and watermarks before healthy mode.
- DC-15: preserve the three states `MIND_PRIMARY_HEALTHY`, `CONFIRMED_OUTAGE_CONTINUITY`, `RECOVERY_RECONCILIATION`; uncontrolled native semantic stores are never substitute shared authority.

Breaker numbers, retention/TTL and byte/token budgets stay unset until measurements and operator decisions. A capsule and session backup must not each silently consume the entire local storage budget.

## Handoff contract proposal

Required durable information: task ID/revision, objective, acceptance criteria, project scope, owner/lease epoch, completed steps, latest checkpoint, next action, blockers, unresolved decisions, required capabilities, skill hashes, artifact logical URI/revision/hash, tests and pending external-operation status.

Guarantee resumption from the last verified checkpoint, not recovery of unsaved model context. Save before and after consequential operations. Resolve an ambiguous operation status before retry. Cloud clients need accessible artifacts or separately authorized remote execution; a PC file path alone is insufficient.

## Adapter contract proposal

Future versioned operations: negotiate identity/schema/capabilities; submit/search/correct/forget memory; create/checkpoint/claim/heartbeat/release/complete task; retrieve approved skill/version; acknowledge canonical synchronization and report health. These are proposed semantic operations, not implemented endpoints.

Every mutation carries a stable event ID, schema version and content digest. Server derives scope from authenticated agent/device/project permissions. Responses distinguish rejected, needs-correction, local-pending and canonical-committed, with IDs/versions/receipts. An adapter must not report saved-to-Mind on timeout or route errors. Cached data carries source revision, watermark, expiry and integrity metadata. Credential values never enter memory envelopes.

For Onoes-Agent, implement a small contract client and fixture suite independently of its model/backend. Do not copy Mind storage or permission logic into Onoes-Agent. Integrating it is a separate bounded change in its own repository.

## Review and remaining decisions

The current operator instruction authorizes starting this work. It does not resolve the documented historical ownership gap or supply an independent reviewer. This candidate preserves the baseline and is not evidence that the inherited cloud-readiness slice has closed. First repair promotion requires review of the exact patch and an explicit ownership/handoff disposition.

Before affected later slices: choose RPO/RTO and cloud topology, define default project-sharing policy, approve local backup/queue retention, define skill approvers and artifact accessibility. Credentials and live deployment remain separately gated.

## Folder proposal

Keep source/tests in X:/SANITIZED/LOCAL_PATH Current contracts/runbooks under docs/, dated receipts under audits/, historical plan versions retained. Place actual databases, local recovery stores, immutable artifacts and redacted logs outside source control in configured host data roots; backups off-host. No folder migration in this slice.
