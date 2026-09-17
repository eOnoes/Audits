# Windows anchor backend candidate — physical B-03 design input

2026-09-16. DESIGN CANDIDATE ONLY. NOT SELECTED, REVIEWED, IMPLEMENTED OR INSTALLED.
Inspected product: `17153139286cff2ec912ca788675765204f78a2b`.
No changed wire, source implementation, account, service, ACL, VM or key.

## 1. Decision this resolves, and decisions it does not

The v3 contract requires an anchor independent of the ledger writer and rollback
domain. The current persistence draft names that role but no concrete Windows
placement. This candidate proposes a LOCAL own-process anchor service with its
own Windows identity and private durable state, outside task VM images and
outside coordinator-ledger backup/restore operations. A second SQLite file in
the coordinator's writable directory does not meet this design.

This is the proposed first backend to evaluate, not a production selection. It
uses Windows access control and local authenticated IPC rather than introducing
a paid external service or assuming TPM counters are available. Neither of those
alternatives is forbidden if requirements cannot be met locally. No new audit
packet is published; the frozen 16cb32e4 persistence-design packet is untouched.

The existing staging decision excludes administrator/root and fully compromised
privileged service attacks. CONTRACT_V3 separately states that an authorized
producer able to forge both histories is not defeated by the checkpoint root.
Do NOT widen either exclusion into permission to ignore ordinary task access,
ledger-only corruption/rollback, stale ownership, cross-store moves or compromised
unprivileged clients. The producer remains trusted for the truth of its claims;
the anchor enforces continuity and independently holds the claimed head.

Whole-host restoration is a separate unresolved product decision: this candidate
CANNOT detect restoring ledger, anchor, enrollment and their authentication state
together to a coherent old PC image. A MAC or another file on that PC cannot fix
that. If whole-host/offline rollback is in scope, choose and review an external
or hardware-backed monotonic authority before activation. Do not silently exclude
this threat or claim that documenting an unsupported restore detects it. Even
if excluded, normal supported upgrade/rollback must preserve the current anchor
and all spent-approval/quarantine continuity; binary rollback is not state rollback.

## 2. Proposed ownership and access matrix

Names below are logical roles, NOT existing service/account names or SDDL.
Physical identity read-back, exact masks and negative probes must establish them.

| Role | Proposed owned resources / allowed contacts | Required denied access |
| --- | --- | --- |
| Paired Studio host | Local UI/session handling; bounded coordinator requests | Direct ledger/anchor files, anchor mutation/owner API, service configuration, VM control |
| Enrolled coordinator | Its private ledger + WAL/SHM, supervised metadata replay, authenticated bounded anchor requests | Anchor files/WAL/SHM, enrollment editing, anchor process mutation/token duplication, service configuration, generic VM/shell control |
| Anchor service | Its own state/WAL/SHM and endpoint; transactional enrollment/epoch/head observations and compare-and-append | Task source, provider keys, generic file paths, task commands, VM control; no general file or execution RPC |
| Physical supervisor | Exact enrolled coordinator process/job and exact task VM/generation lifecycle; bounded custody/stop evidence | General task-controlled service names, paths, VM IDs, commands or arbitrary process handles |
| Task guest and descendants | Only approved copied input and constrained guest scratch/runtime | Host anchor/ledger/runtime, shared host directories, host service/IPC access, uncontrolled network/device mappings |
| Explicit installer/maintenance authority | Create-only provisioning and separately approved version-continuity operations | Implicit runtime reset, auto-adoption, delete-and-reenroll recovery or simultaneous active stores |

Anchor and coordinator must not share a process or a broadly writable account.
Per-service SID membership is an access-control ingredient, not proof of reduced
privileges: Windows distinguishes service SID type from the account/privileges
under which the process runs. Enumerate actual token user, groups, restricted
SIDs, privileges and object rights. Do not choose LocalSystem for convenience or
grant broad rights to every service/interactive user. Privileged supervisor needs
its own minimal, reviewed scope; it cannot be reached through arbitrary task IPC.
[Windows service SID documentation](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/ns-winsvc-service_sid_info)

Private roots need create-time descriptors, protected ancestors, exact file/volume
identity and rejection of reparse/ADS/hardlink/alias substitution. Protect process,
token, executable, loader dependencies, configuration and service objects as well
as data. A coordinator denied file writes but permitted anchor process injection
or service reconfiguration still owns the anchor in practice. Installer and
uninstaller must retain evidence and continuity, not recursively erase state.
[Service object access rights](https://learn.microsoft.com/en-us/windows/win32/services/service-security-and-access-rights)

## 3. Authentication and bounded contact

Candidate transport: local named pipe, explicit protected DACL, remote clients
rejected, bounded instance/connection count, first-instance ownership and retained
name custody. No default security descriptor and no blanket FILE_GENERIC_WRITE
grant to clients: that grant also includes pipe-instance creation. Individual
client rights and actual wrong-principal/name-squatting tests are required.
[Named-pipe security](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights),
[CreateNamedPipeW](https://learn.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-createnamedpipew)

Authenticate BOTH ends on every connection before disclosing namespace state or
accepting a mutation. The historical guest broker illustrates retained process
handle + exact SCM service/PID/token/image checks, not a magic identity string.
A PID, path, service-name reply, localhost address or caller-supplied true flag
alone is insufficient. Native identity queries, process-lifetime races and any
impersonation level must be reviewed and tested; do not add impersonation rights
to make the prototype pass. No port may accept task-provided expected peer pins.

Bind each request/response to protocol version, request nonce, enrolled identities,
operation, current owner epoch and exact expected head. Discovery returns one
atomically observed enrollment/epoch/head tuple. Fresh nonce echo without peer
authentication is not freshness proof; authentication without request/deadline
binding does not make a replay fresh. Session or process replacement invalidates
outstanding observations. Persisted receipt bytes are historical evidence, never
a bearer token or a replacement for current authenticated discovery.

Authentication of locally returned evidence and any cross-process/exported
signature key remains an explicit interface design task. Do not replace the
existing requirement with an unkeyed digest, introduce a new public envelope or
claim that a retained pipe authenticates separately saved bytes. The service must
not accept generic signing, path-read, import, reset, refund or execute methods.

Use bounded framing, preallocation limits, one in-flight namespace mutation,
reject-on-busy behavior and a measured shared deadline. Slow/malformed clients
must not hold a database transaction. Timeouts do not prove canceled I/O or an
uncommitted append. After uncertainty, close forward work and use the existing
fresh-owner discovery/reconciliation rule; no alternate-name fallback or retry
loop. Pipe buffers are not a demonstrated process memory ceiling.

## 4. Persistence, owner death and restore domain

The anchor owns a separate database and transaction boundary. Enrollment, owner
epoch and head comparisons must happen in one short durable transaction before
acknowledgment. The concrete schema, storage primitive, key lifetime, filesystem
flush behavior, corruption handling and capacity remain implementation/review
inputs. SQLITE WAL/FULL is not independent durability or power-loss proof.

Preserve ledger -> exact read-back -> anchor order and outcome -> A -> released
-> B. No distributed atomicity claim. A lost anchor response leaves an unknown
outcome; do not compensate by inventing a terminal event. Exact duplicates may
acknowledge an existing append only under the reviewed current-owner recovery
protocol, never permit another task contact. No automatic absent-anchor genesis.

The supervisor must retain the old coordinator's process/job and the exact guest
generation, reject delayed old-owner operations, and confirm all relevant task
activity is fenced before replacement is admitted. The anchor's durable epoch
CAS alone does not stop a process, terminate a guest or revoke an open file handle.
Owner/anchor service restart must not clear in-flight uncertainty. Confirmed guest
Off alone also does not settle an outstanding host transfer/publication callback.
No root PID or elapsed timer may substitute for the complete contact settlement.

Ledger-only restore and guest snapshot restore must NOT restore the anchor. A
fresh joined read should then expose missing/old inventory and deny admission.
Restoring only the anchor must likewise deny mismatched ledger history. An
authenticated anchor missing its namespace must not create one on demand.
Backup, uninstall, capacity exhaustion and disaster recovery need explicit policy:
preserve records, stop safely and offer bounded diagnostics; do not rotate an
empty namespace to evade lifetime limits. Availability recovery is still open.

## 5. Falsifiable physical acceptance cases — ALL NOT RUN

Each negative needs a positive control proving that the exact attempted API was
reached, plus before/after bytes/identity and no-effect counters. Run initially
inside a separately approved disposable Windows environment, not on the work PC.

| ID | Required experiment | Passing observation |
| --- | --- | --- |
| P01 | Coordinator/task/interactive identities attempt anchor file, WAL, SHM and ancestor mutation, rename, deletion, links and ACL changes | Authorized anchor access succeeds; each unauthorized operation denies; protected bytes/identity unchanged |
| P02 | Same identities attempt anchor VM_WRITE/VM_OPERATION/DUP_HANDLE, token duplication/adjustment, service CHANGE_CONFIG/START/STOP and binary/config mutation | Exact denied rights with own-object controls; metadata-only identity queries remain narrowly usable |
| P03 | Wrong server, wrong client, same-name squatter, remote pipe and disconnect/reconnect | No protected request disclosure or mutation; no name/transport fallback; correct peer works afterward when safely available |
| P04 | Replay nonce/epoch/head, race two owner claims and delay old-owner response after replacement | Exactly one durable winner; old owner cannot append or resume effects; observations from different tuples cannot compose |
| P05 | Restore/delete/coherently rewrite ledger only, including terminal and spent-approval rows | Fresh authenticated unchanged anchor causes denial, not empty inventory or free workspace |
| P06 | Restore guest disk/checkpoint while keeping host anchor; repeat with anchor-only stale restore | Current host history cannot be spent again; mismatches deny; no guest-provided Off claim trusted |
| P07 | Kill at each enrollment, ledger commit, anchor append and A/release/B acknowledgment cut | Exact durable discovery or explicit uncertainty; no auto-genesis, task replay, compensating terminal or double approval |
| P08 | Coordinator death, anchor restart, host-side callback that survives guest Off, unresolved child/job stop | New owner remains non-admitted until full fencing/settlement; old callbacks cannot regain authority |
| P09 | Reparse/alias/hardlink/ADS substitution of roots, configuration and executable dependencies, including retained old handles | Deny before authority contact; no path-string or hash-before-spawn claim promoted to custody |
| P10 | Disk full, corrupted anchor, bounded slow clients and maximum history under measured memory/CPU limits | No success on uncertain flush/commit; bounded output and observed stop; no silent reset or unbounded queue |
| P11 | Supported binary upgrade and rollback with unchanged current authoritative state | Same enrollment, current epoch/head, spent approvals and quarantines retained; incompatible version denies |
| P12 | Restore ledger AND anchor/enrollment to a coherent old host image | LOCAL-ONLY CANDIDATE CANNOT DETECT; record as unsupported assurance, not a passing security test |

These tests supplement, not replace, signed approval/issuer custody, exact subject
transfer, constrained guest command execution, independent result verification,
original-file publication custody and W1-W5 acceptance. Host Hyper-V administration
is privileged; do not give that group to the ordinary coordinator or task identity.
Microsoft does not define Hyper-V Administrators as isolated from full administrators.
[Windows security boundaries](https://www.microsoft.com/en-us/msrc/windows-security-servicing-criteria)

## 6. Evidence and immediate sequence

Observed now: current v3 files are data validators; there is no physical anchor
implementation in that slice. Existing synthetic checkpoint sequencing and old
guest broker evidence do not implement this service. The G0-A handoff still says
guest token observation NOT RUN; later release notes record a canceled admin
prompt. Do not infer a live process or usable credential from either document.

Source and design inspection plus primary Microsoft documentation only in this
checkpoint. No tests, compilation, OS probes or installations were run for this
candidate; every P-case above remains NOT RUN. The indexed source snapshot is
stale/incomplete, so direct current named-file inspection controls these claims.
Git whitespace and the local source-pattern security checks passed. A separate
read-only SHA-256 check still matches all 46 frozen persistence-packet manifest
members and the separately pinned manifest digest
`d76de2507dc837cc48c3f9c2959e892d417fd24b8fd3a92a366a2801015f9fe5`.
Its report path is absent. This confirms unchanged local delivery bytes, not a
reviewer's receipt, active audit, independent execution or physical protection.

1. Obtain the pending logical persistence-design review; report any physical
   assumptions it rejects. No unpublished packet is assumed under active review.
2. Review this placement and explicitly settle whole-host rollback scope. If the
   local candidate is inadequate, stop before provisioning and select a stronger
   independent authority; do not weaken the existing gate to fit available tests.
3. Specify exact identities/masks, authenticated IPC/evidence, genesis creation
   cuts and owner-fencing protocol. Reuse historical broker controls only after
   current validation; do not rerun or repackage a Defender-held harness.
4. Prepare a separately pinned disposable-environment experiment with bounded
   resources, create-only targets, cleanup/uncertainty behavior and scoped operator
   approval. A working-PC service/permission change is NOT authorized by this draft.
5. Only after reviewed implementation and physical evidence, connect real v3
   persistence/admission; then clean-host package and end-to-end release gates.
