# V3 authority journal and owner replacement — proposed durable contract

2026-09-17. DESIGN FOR THE COMBINED PHYSICAL BOUNDARY REVIEW, NOT IMPLEMENTATION.
Baseline: `9f525e208d05694976d4d451a3aa7add3e2ad8ec`. Read with the physical-adapter,
Windows peer-channel, anchor-backend and enrollment-recovery designs. Existing
canonical v3 records/checkpoints/approval identity bytes are unchanged. No SQL,
service, account, enrollment, signature, task or OS operation is executed here.

## 1. Authority placement and limits of the proposal

Put enrollment, current-owner history, complete checkpoint history and maintenance
attempt accounting in ONE anchor-owned transactional database, separate from the
coordinator ledger and its restore domain. This makes an anchor append and its
maintenance witness atomic within that authority, not with the ledger. Keep the
entire authoritative state inaccessible to the coordinator/task identities,
including WAL/SHM, parent renames, process injection and service reconfiguration.
PEER_CHANNEL_DESIGN proposes the contact authentication; it does not prove storage.

Only one active store/domain is enrolled per namespace. Version transitions and
retired/prepared entries keep their reservation of names and spent approvals.
The v1 namespace+approval identity remains unchanged; a new store, schema version,
installation request or owner UUID is not a way to consume it again. No v2/v3
parallel enrollment, automatic empty initialization or missing-file adoption.

This local candidate still cannot detect coherent rollback of all PC authorities.
The operator's scope choice is pending. Unkeyed canonical digests detect byte and
consistency drift, not coherent forgery by an actor who controls the anchor. No
extra file, MAC or counter on the same restored PC is claimed to solve that.

## 2. Proposed normalized data and independent read checks

The following is a logical schema with explicit keys and invariants for review,
not executable SQL or permission to initialize a database. Exact SQLite DDL,
connection/open flags, file custody and schema read-back will be implementation
review inputs. Use primitive strict canonical wire parsing, fixed domains,
bounded exact UTC timestamps/UUIDs/digests and safe nonnegative integer counters.
Never deserialize a function, caller object, native handle or process pointer.

| Relation | Stored subject and key | Independently re-derived constraints |
| --- | --- | --- |
| `authority_meta` | Singleton schema/domain, authorityId, installationId, configuration identity | Exact externally enrolled identity/version; absence is not a new install; unknown columns/schema deny |
| `enrollments` | Namespace key; store/domain, immutable genesis+initial producer generation, original install authorization identity, state `prepared/active/retired`, physical-root/runtime pins when active | Same state ordering as ENROLLMENT_RECOVERY_DESIGN; no second store/domain; unique install authorization; retired never reactivates |
| `owner_events` | `(namespace, ordinal)`; epoch, event, previous-event digest, authenticated request binding and observation metadata | Contiguous event chain from enrolled genesis; fresh epochs unique across history; legal state transitions; at most one unresolved owner; summaries agree with replay |
| `checkpoints` | `(namespace, sequence)`; exact canonical v3 checkpoint wire and digest | Contiguous sequence; genesis equals enrollment; every predecessor, store identity and digest agrees; derive current head from stream, never from a caller's counter |
| `maintenance_intents` | Stable tuple `(installation, namespace, store, predecessor checkpoint digest, candidate checkpoint digest)`; exact consent subject described below | Tuple unique, and at most one candidate intent per enrolled predecessor; no different request ID/epoch can bypass either rule |
| `maintenance_events` | `(intent tuple, phase ordinal)` with phase `prepared/contact-possible/witnessed`, original request binding and exact result identity | Exactly one ordered phase chain; immutable intent; witnessed joins the exact stored checkpoint; contact-possible never returns to prepared |

An implementation may retain a transactionally updated summary for lookup, but
must independently recompute it during bootstrap/discovery from canonical rows.
SQL PRIMARY KEY/UNIQUE/CHECK/FK constraints are defense in depth, not the only
checker. Reads must detect duplicate approvals/enrollments/epochs/intents,
conflicting candidates, gaps, changed indexed columns, impossible phase chains,
wrong store/authority and orphaned witnesses even if index/check enforcement was
bypassed. Reject the entire authoritative view; never return unverified partial
state as live admission. Redacted forensic export would be a separate interface.

The checkpoint stream cannot by itself validate the full ledger inventory; joined
bootstrap still uses the existing complete history+inventory reference validator.
The authority validates its own append continuity/current-owner/consent rules;
it does not claim to observe the truth of producer filesystem or task results.
The authority database has no task source, provider credential, user command,
raw diagnostic or arbitrary file-path column.

## 3. Owner state machine and physical prerequisites

Distinguish ENROLLMENT active, an OWNER active, and task admission. None implies
the others. Owner history uses `prepared -> active -> retiring -> retired`; a
prepared owner may instead go directly to retiring. Only retired permits a new
prepared epoch. Retired is absorbing; never reuse an earlier epoch. There is no
`unknown -> active` transition and no elapsed-time takeover.

1. **Prepare:** with an active enrollment and no unresolved prior owner, the
   authenticated supervisor reserves a fresh epoch and exact package/configuration
   and physical-resource plan under explicit installation/maintenance authority.
   This grants no task permission or child launch by itself.
2. **Establish custody:** the supervisor/native coordinator host constructs only
   the fixed metadata runtime and channels allowed by that maintenance plan.
   It proves process identity, exact job membership, protected ledger/runtime,
   no task activity and authenticated anchor peer. Possible launch/contact must
   have its prior durable accounting; losing setup response is not a clean slate.
3. **Activate owner:** transactionally compare the prepared epoch and original
   request; bind the freshly authenticated supervisor incarnation, coordinator
   service/process instance and custody evidence identity. Active owner is only
   eligible for full joined bootstrap. No local ready flag or this receipt admits.
4. **Retire:** close admission and durably append retiring before proposing a
   replacement. Stop/drain the exact old generation. Re-authenticate settlement
   observations from the current custody owner, not from the old worker result.
5. **Retired:** only with complete stop/contact/custody evidence, append retired
   and preserve that evidence identity. Create the next epoch in a separate
   transaction, never by overwriting the old owner or clearing unresolved work.

Owner retirement does not settle an operation, free a workspace, remove a
quarantine, forgive an unknown effect or consume a new task approval. New owners
cannot continue old-generation forward effects. Any old-row stop/outcome
bookkeeping remains subject to the separately reviewed recovery authorization
and original v3 outcome/A/release/B rules.

Owner observations must include the exact old epoch, supervisor incarnation,
coordinator/native and Node process lifetimes, job custody identity, guest
generation (when one exists), ledger and anchor identities, complete host-contact
accounting identity, observation time/validity, and retirement request digest.
These fields are claims until authenticated by the selected physical observers.
Do not accept one input `allStopped: true` or a caller-computed evidence hash.

## 4. Supervisor and anchor restart — no implicit resurrection

Retain exact process and job handles for the lifetime of an admitted owner and
through retirement. Do not store numeric handle values as a recoverable identity.
Job membership is established before the trusted child can run; child inheritance
and handle duplication are explicitly limited. The separate supervisor requires
its OWN retained/queryable custody, not just a report from the native host.

This design chooses fail-closed discovery after a custody-owner restart, not
automatic adoption by a name/PID. A surviving, authenticated custody peer may
support a future reviewed reattachment that proves the same kernel objects. A
persisted job name, matching PID/creation-time tuple or newly created empty job
is insufficient alone. If no live trusted handle chain can be established,
replacement remains blocked for separately authorized recovery. No unimplemented
reattachment protocol is counted as available restart support.
The peer-channel design now specifies a downward supervisor pull of restricted
job/root-handle duplicates before child resume as the first experiment candidate.
It does not grant the lower-privilege host duplication rights on the supervisor,
or solve the loss of both custody holders. No such experiment has run.

In particular, KILL_ON_JOB_CLOSE triggers when the LAST job handle closes, not
when one supervisor dies. Extra observer/host handles change that behavior.
Never keep an observer handle while also claiming supervisor death necessarily
terminated the job. Absence of an opened job, an elapsed stop timer or root exit
is not accepted here as a zero-member observation. A proposed name-based recovery
would need its own object lifetime/name-reuse proof and physical adversarial tests.
[Windows job lifetime](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)

Anchor startup creates a fresh ephemeral service incarnation and accepts NO
previous session. It reads the complete durable authority history before serving
discovery. A persisted active owner from another anchor incarnation is not live:
admission stays closed and the owner must enter retiring under the current
authenticated supervisor/recovery protocol. A failure to record that transition
does not reopen admission. Read-only disclosure is separately authenticated and
explicitly labels the persisted owner as non-admitted.

Supervisor restart similarly invalidates its local pending contexts immediately.
Its durable owner entry stays unresolved; a new service instance cannot simply
replay activate or claim the old observation was fresh. Both services restarting
does not clear either record. A Windows reboot may establish some new physical
facts, but a reboot/time/boot-ID string is not an implemented substitute for
retirement, guest-state checks or reconciliation. No reboot is requested here.

This is an explicit availability gap for abrupt loss of all custody handles.
Orderly service restart can complete retirement first; abrupt restart support
is NOT release-complete until a reviewed physical recovery procedure works.
The logical journal must not hide that gap behind a passing synthetic reopen test.

## 5. Maintenance attempt subject and transaction cuts

Each intent stores the stable tuple from section 2, full expected local metadata/
inventory/history/head digests, full anchor history digest, exact candidate
checkpoint wire, current maintenance epoch, anchor/service session binding,
operator consent evidence digest and original bounded validity. Consent says
witness the already committed checkpoint only. It does not authorize a task,
publication, deletion, fresh history event or replacement of original bytes.

Use a create-only intent transaction. Under BEGIN IMMEDIATE, verify current
enrollment/owner/expected anchor and capacity; reject existing conflicting tuple
or predecessor; write prepared intent+event together; commit; independently
read back exact canonical state. No await, callback, IPC, native effect or
operator interaction inside a transaction. Reads do not create attempts.

After fresh full-local validation and live checks, the authority itself handles
one authenticated witness request in TWO short transactions:

- T1 rechecks prepared intent, exact owner/session, original deadline and expected
  predecessor. Append contact-possible and commit. Only successful durable T1
  read-back in THIS handler creates a private continuation to T2. Reopening a
  connection/process or reading that marker cannot reconstruct the continuation.
- T2 consumes that continuation before validation, rechecks the same original
  subject/time/owner and exact predecessor, then appends the checkpoint AND
  witnessed event atomically. Commit, then independent fresh read-back. No anchor
  call or second database is inside either transaction.

This resolves an ambiguity of the test model's separately callable mark/commit
methods: they are fault-injection seams, not two public retryable RPC methods.
T1 acknowledgement uncertainty, crash before T2, failed T2 or lost read-back
consume the attempt. Fresh discovery may establish a witnessed equal pair after
success; contact-possible still one-ahead cannot attempt T2 again. `unknown` is
a discovery disposition, not another terminal/compensating database mutation.

Prepared-only response loss remains recoverable by exact discovery and the FIRST
witness request within the same still-current maintenance epoch/anchor lifetime
and unexpired consent. It does not allocate another intent. Changed epoch,
expiration or any consumed marker denies continuation. An unconsumed expired
intent is not garbage to be deleted; escalation/retention requires separate design.

All write paths acquire transaction locks BEFORE scan/conflict decisions, recheck
the exact enrolled storage/schema/durability profile, scan independent invariants,
validate the full post-state, commit and read back. No permissive pragma repair
on reopen. Any attempted-commit uncertainty poisons that live writer; recreation
cannot turn unresolved durable records into an available namespace.

## 6. Clock and capacity obligations

Use each live authority's own monotonic request deadline. Do not compare raw
monotonic numbers from different processes or reboots. Bind original budget and
timestamps into authenticated requests; the authority clamps to its own remaining
budget, never refreshes it on a replay, and checks it again at both T1/T2.
Persisted expiration is an additional bound, not permission to reconstruct lost
monotonic time after restart. Clock error/regression closes the live authority;
restart must use new sessions/retirement, not restart the same attempt's timer.

Preserve current structural limits: 1000 ledger operations and at most 7001
checkpoints (`7 * CANDIDATE_V3_MAX_OPERATIONS + 1`), not the smaller 6001-checkpoint
performance sample. At most one maintenance intent per predecessor, INCLUDING
genesis when the missing witness is for sequence 1; candidates are non-genesis.
Additional proposed initial authority limits:
4 KiB candidate checkpoint, 16 KiB canonical owner/maintenance event, and a
64 MiB bounded canonical owner+maintenance scan. These are proposal limits, not
measured SQLite/WAL/RSS ceilings or a production lifetime promise. Exact record
counts and aggregate escaped sizes must both be bounded before allocation.

Before admitting an owner or preparing an intent, reserve logical space for its
maximum remaining retirement/maintenance events. Normal work cannot consume that
reservation. Disk/WAL growth and emergency physical space still need measured
limits; a logical reservation does not guarantee an OS write will succeed. On
failure preserve uncertainty, not delete old records or rotate a namespace.

The long-lived retention/capacity-extension design remains a W3/W4 release blocker.
The initial extract does not solve it by silently limiting the final product to
1000 lifetime tasks. Historical spent approvals, publication parentage, quarantine
and anchor continuity must survive the later reviewed retention procedure.

## 7. Review controls and honest evidence

All physical controls below are NOT RUN. Each needs a valid positive control,
exact before/after protected state and independent process/contact observations.

| ID | Falsifier |
| --- | --- |
| AJ01 | Copy enrollment/owner/checkpoint/maintenance rows between distinct authorities/stores; reads deny independently of indexed columns. |
| AJ02 | Bypass SQL constraints: duplicate epochs, install approvals, maintenance tuple or predecessor; split owner chains, gaps or orphaned witness; discovery denies. |
| AJ03 | Lose each prepare/activate/retire response; no second creation, active owner or freed namespace. |
| AJ04 | Restart anchor with an active durable owner and late old replies; no prior session/ready state resurrects. |
| AJ05 | Restart supervisor with a live child, guest or host contact; no new owner from a PID/name, newly empty job or timeout. |
| AJ06 | Keep a job observer handle after supervisor loss; kill-on-close assumption must NOT count as observed settlement. |
| AJ07 | Crash after T1 before T2; reconnect/new epoch/new consent cannot invoke T2 or replace the intent. |
| AJ08 | Commit T2, lose reply; exact witnessed discovery succeeds without a second append and without task permission. |
| AJ09 | Roll back ledger only, then maintenance local files; unchanged protected authority retains consumed attempts and detects joined drift. |
| AJ10 | Fill normal capacity, then require retirement; reserved logical event capacity remains; actual disk failure remains unknown/non-admitted. |
| AJ11 | Clock regression, expired consent, anchor restart and stale monotonic numbers; no renewed timer or stale success promotion. |
| AJ12 | Retain a local released row while retiring owner or losing authority; no workspace admission until physical checks and matching B are fresh. |

Actual evidence in this checkpoint is source/design inspection and primary Windows
documentation, not execution of this schema. The existing 53-prefix/212-cut model
uses ordinary JavaScript memory and does not establish AJ01-AJ12. The next combined
review must evaluate this protocol, peer/owner custody, enrollment, transactional
ledger and recovery model together. Physical implementation is not authorized by
writing these documents. Original W1-W5 and independent execution gates stay open.

Local verification: refreshed the handoff documentation index without embeddings
or AI/provider summaries at source `9f525e2`; inspected actual parser limits and
the test-only recovery model. Self-review corrected the sample-versus-structural
checkpoint distinction and retained genesis as a valid maintenance predecessor.
Git whitespace check passed. Bounded source-pattern scan passed over 1,301 eligible
files / 15,477,093 bytes before this verification note was added; no subject tests
were rerun for the documentation-only delta. This is producer design work, not
independent review or proof of a durable journal.
