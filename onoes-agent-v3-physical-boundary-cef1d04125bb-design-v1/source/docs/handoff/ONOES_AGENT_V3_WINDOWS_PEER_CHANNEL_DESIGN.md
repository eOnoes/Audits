# V3 Windows peer channels — concrete candidate for boundary review

2026-09-17. DESIGN ONLY, based on product `6608b9f37119c30773aab1cc72b881bdbd805d66`.
No account, token, key, pipe, database, service, child or VM was created. No new
implementation/activation permission follows. This refines sections 2/4/6 of
V3_PHYSICAL_ADAPTER_CONTRACT_DESIGN; the persistence and maintenance contracts
remain unchanged. Whole-PC rollback scope is still an unanswered operator choice.

## 1. Specific candidate, not an installed topology

Use separate own-process virtual-account services for the coordinator native host
and anchor native host, with distinct service/account SIDs. The coordinator host
supervises the fixed trusted TypeScript coordinator off the dashboard event loop;
the anchor owns its independent storage. Neither role is a general command host.
Keep privileged VM control/owner retirement in the separately scoped supervisor,
not in either data service. Actual service names, immutable install roots and
descriptors must be pinned by an explicitly approved installer, never HTTP input.

The native coordinator host, NOT its Node child, connects to the anchor. This
allows both pipe peers to be checked against their exact own-process SCM entries.
Do not allow any process merely because its token contains the coordinator SID.
The native host is part of the trusted producer boundary: it binds fixed verbs,
enrollment, current owner and one pending child request before forwarding. It
must not expose a generic byte relay or accept a caller-provided peer pin.

The historical `WindowsWorkerJob.StartNode` inherits its caller's service token
and deliberately passes `bInheritHandles=false`. It is NOT a launcher for a
privileged supervisor to use unchanged: that would give the coordinator the
supervisor identity. Nor can it already deliver private inherited IPC handles.
Retain its job-at-creation/watchdog/zero-member-stop controls as source to review,
not as an implemented cross-identity or channel solution. No existing helper is
edited or activated by this proposal.

Propose required-privilege reduction for both data services, with no impersonate,
debug, backup, restore, take-ownership, load-driver or token-assignment privilege.
Read back actual TokenPrivileges, user, groups, restrictions and elevation before
admission. Do not describe the result as zero privileges: Windows retains
SeChangeNotifyPrivilege even when not requested. Own-process placement avoids the
union of requirements from colocated services. If the minimal set cannot support
startup, record the exact denied operation; do not add broad privileges by trial.
[Microsoft required-privileges contract](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/ns-winsvc-service_required_privileges_infow)

These identities are not a network sandbox. Network restrictions and installation
custody remain separately tested gates. No work-PC service configuration or
firewall changes are authorized.

## 2. Local anchor pipe and proposed rights

One retained duplex byte-mode named-pipe instance, created before startup success:
FIRST_PIPE_INSTANCE, OVERLAPPED, REJECT_REMOTE_CLIENTS; explicit protected DACL;
non-inherited server handle; no alternate name on failure. Reconnect uses that
same retained instance only after all previous I/O completion is observed. Anchor
restart requires a new authenticated session and owner discovery, not old pending
request replay. Name squatting can deny availability; it cannot select a fallback.

| Object / opener | Proposed requested mask | Intentionally absent |
| --- | --- | --- |
| Pipe client / exact coordinator host | FILE_READ_DATA + FILE_WRITE_DATA + SYNCHRONIZE = `0x00100003` | `0x4` pipe-instance creation; generic write/all; WRITE_DAC/OWNER; attribute mutation |
| Other peer process / each service | PROCESS_QUERY_LIMITED_INFORMATION + SYNCHRONIZE = `0x00101000` | VM read/write/operation, DUP_HANDLE, terminate, create-thread, token mutation |
| Other peer primary token / each service | TOKEN_QUERY = `0x8` | duplicate, impersonate, assign-primary, adjust rights |
| SCM / each service | SC_MANAGER_CONNECT = `0x1` | create/configure service |
| Exact other service / each service | SERVICE_QUERY_STATUS = `0x4` | START, STOP, CHANGE_CONFIG, DELETE |

These are proposed client/query masks, NOT complete production SDDL. Server,
installer and supervisor rights are separate, explicit ACEs, never inherited
blanket access. Creating the pipe and connecting are different access checks.
FILE_GENERIC_WRITE includes the bit that also permits pipe-instance creation;
do not copy the historical managed `PipeAccessRights.ReadWrite` rule without
checking its actual mask. Test the proposed individual rights with native opens;
if a wrapper requests extras, reject that wrapper or review the exact extra right.
[Microsoft pipe access rules](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights)

SYNCHRONIZE enables actual process-handle waits. Require an unsignaled retained
process object before and after an exchange; do not generalize the old fixture's
`GetExitCodeProcess == 259` convention into production liveness. Never request
PROCESS_ALL_ACCESS just to observe a peer.
[Microsoft process rights](https://learn.microsoft.com/en-us/windows/win32/procthread/process-security-and-access-rights)

## 3. Mutual authentication before protected bytes

On each connection both native peers perform the following, failing closed on
any inaccessible query. The client opens with explicit identification-level SQOS
and never delegates impersonation authority. No ImpersonateNamedPipeClient or
privilege escalation is proposed as a fallback.

1. Resolve the OTHER role only from protected enrollment/configuration. Query its
   exact SCM entry: Running, own-process, nonzero PID. Client obtains server PID
   from the connected pipe; server obtains client PID from its connected instance.
2. Require equality with that SCM PID. Open/retain the process object, inspect
   its exact primary-token user and expected token profile, image identity under
   separately established immutable runtime custody, and creation time. Recheck
   SCM/pipe PID and unsignaled process. A path string/hash-before-spawn alone fails.
3. Exchange bounded role/version challenges with fresh random nonces, then
   confirm both challenges, both roles and the current enrolled session. Before
   authentication these contain no ledger, namespace inventory, task or source.
   A nonce is freshness binding inside an OS-authenticated channel, not a secret
   credential or cryptographic proof by itself.
4. Only after mutual confirmation accept a bounded protected frame. Bind both
   connection nonces, request sequence/digest, verb, enrollment/store, original
   deadline, owner generation and complete expected pre/post identities. Reject
   an unsolicited, duplicated, out-of-order or differently bound response.
5. Recheck both the retained peer lifetime and current owner before promoting any
   result. Disconnection, timeout, peer replacement or failed recheck invalidates
   the session and all pending replies. Never reconnect and resend an uncertain
   mutation. Only fresh read-only discovery under the maintenance rules remains.

The OS functions supply process IDs, not an authenticated approval or a portable
process handle. PID reuse, relays and handles passed to another process are
explicit adversarial tests; the retained process, SCM, token and challenge checks
are a candidate composition, NOT a Microsoft guarantee of this whole protocol.
[Pipe client PID](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeclientprocessid),
[pipe server PID](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeserverprocessid)

Propose live-channel authenticity for this narrow local exchange, with no new
signing key. Saved bytes retain only historical consistency/evidence status;
they cannot be replayed as an authenticated live acknowledgment. If another
consumer must independently verify exported signatures, that key/enrollment
protocol must be separately designed. This proposal does not satisfy or remove
any existing signed-approval or protected-issuer requirement.

## 4. Coordinator child channel and stop ownership

Use private, explicitly inherited parent/child endpoints, not a discoverable
public pipe accepted solely by PID or a secret in argv/environment. Inherit only
the fixed IPC endpoints, never ledger/anchor, enrollment, job-control, tokens or
supervisor handles. Use an explicit HANDLE_LIST together with creation-time job
assignment; Microsoft requires inheritable listed handles and bInheritHandles
TRUE for that attribute. Clear unnecessary inheritance after startup and test
descendant leakage. This requires a new reviewed launcher contract, not changing
the old helper's boolean and assuming containment.
[Creation attributes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)

Keep parser/deadline/queue bounds from WORKER_MESSAGE_DESIGN. A native control
loop must remain responsive while Node does synchronous validation. The external
supervisor still needs independently retained exact job/process/contact evidence
before owner replacement; a native host saying "stopped" is not enough. The
handle-custody/duplication and supervisor-restart protocol remains an explicit
unresolved design input; these channels alone do not close PA02 or PA12.
V3_AUTHORITY_JOURNAL_DESIGN specifies how that unresolved custody is retained
durably: restart cannot reuse an active record as readiness, and loss of the
live trusted handle chain blocks replacement rather than adopting a name/PID.

Cancellation retains buffers/OVERLAPPED state until actual completion. After
CancelIoEx, normal completion is still possible and the function does not wait.
An unconfirmed drain closes admission and forbids pipe-instance reuse or owner
replacement; it is not a no-effect result. Use the existing separate stop budget,
not an unbounded FlushFileBuffers/WaitForPipeDrain in the UI or authority path.
[Microsoft cancellation semantics](https://learn.microsoft.com/en-us/windows/win32/api/ioapiset/nf-ioapiset-cancelioex)

## 5. Required next evidence, all NOT RUN

### Proposed supervisor custody transfer; no upward duplication right

For the first bounded metadata-worker experiment, the native coordinator host
creates/retains the unnamed job and suspended fixed child, assigned to that job
at creation. BEFORE resuming the child, the authenticated supervisor PULLS
non-inheritable duplicates of those exact job/root handles into itself. The host
keeps both source handles stable until explicit handoff completion. This is not
a UI/task RPC accepting a caller's arbitrary handle number.

Propose a dedicated process DACL grant allowing ONLY the enrolled supervisor
PROCESS_DUP_HANDLE plus query-limited/synchronize (`0x00101040`) on the native
coordinator host. That right is deliberately stronger than peer identity queries
and makes the supervisor part of the trusted custody boundary. The anchor and
ordinary coordinator Node child receive no corresponding grant to the supervisor.
In particular, do NOT grant the lower-privilege host PROCESS_DUP_HANDLE on the
privileged supervisor merely so it can push a handle: that would permit access
to other supervisor handles. The role-specific exception is downward only.

For each pull, the supervisor uses its retained authenticated source-process
handle, explicit desired access, `bInheritHandle=false`, and options zero. Do not
use DUPLICATE_SAME_ACCESS or DUPLICATE_CLOSE_SOURCE. Proposed duplicate rights:
job QUERY|TERMINATE (`0xC`), root process QUERY_LIMITED_INFORMATION|SYNCHRONIZE
(`0x00101000`). Kernel duplication refers to the original object, but the numeric
source handle is meaningful only in that retained process while the host holds
it stable. Wrong type, closed/reused handle or failed validation denies launch.
[DuplicateHandle contract](https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-duplicatehandle),
[job rights](https://learn.microsoft.com/en-us/windows/win32/procthread/job-object-security-and-access-rights)

The supervisor independently checks root membership in its exact duplicate job,
expected process/token/image, suspended setup protocol, limits and live native
host before acknowledging custody. The host must not resume until that bound
acknowledgment and active setup authority arrive. On failure, terminate/observe
the owned job without reporting successful admission. Before retirement is
recorded, the supervisor explicitly terminates that job and observes both the
root signaled and active count zero; it separately settles native-host/guest/
external contacts. More than one retained job handle means KILL_ON_JOB_CLOSE is
only a last-handle fallback, never proof that one host's death stopped the child.

A restarted supervisor may, under retirement-only authority, investigate a
SURVIVING authenticated native host that still retains the ORIGINAL handles and
original owner context. Re-pulling supports fresh stop observation, not resuming
old effects or re-creating an old private continuation. Same-process retained
handles can be compared with CompareObjectHandles when both are available; that
API cannot compare an old numeric handle saved in a database after its process
died. Initial implementation should reject reattachment until its protocol is
reviewed and physically tested. If both holders are gone, no named-job/PID
fallback is introduced: AUTHORITY_JOURNAL_DESIGN's lost-custody gap remains.
[Object-handle comparison](https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-compareobjecthandles)

This is a concrete experimental candidate, NOT an implemented handle offer,
observer or restart path. Test substitution/reuse, source death before/after
duplication, lost handoff ack, supervisor death with host handle retained,
wrong-object pull and attempted reverse duplication. Prove the positive custody
path before interpreting access-denied controls. No raw handle is exported to
Studio, persisted as proof, passed to task code or accepted as permission.

Historical guest evidence demonstrates one-way server verification under a fixed
LOCAL SERVICE client, not this mutually authenticated two-service protocol. No
historical Defender-held harness is rerun or repackaged here.

- Correct-peer positive control; wrong service/process/user/token/image; process
  death/restart/PID reuse; child with same account but not SCM peer; duplicated
  pipe handle; relay; delayed previous-generation reply. Deny before disclosure.
- Native client mask positive control; same principal denied pipe-instance
  creation and peer VM/handle/token/service mutation; process wait and token query
  actually work. Inspect effective DACL and actual token, not SDDL text alone.
- Same-name squatter, remote client, partial/oversized frame, idle peer, stalled
  write, cancelled I/O completing normally and unconfirmed cancellation. No
  alternate endpoint, queue growth, buffer reuse or mutation retry.
- Child receives only listed handles under the coordinator identity, never the
  privileged supervisor token. Root/descendant/job stop observed independently;
  a failed or restarted native host cannot clear retirement uncertainty.

Each requires bounded resources, a fresh authorized disposable Windows setup,
positive reachability controls, before/after state and redacted numeric evidence.
First complete the durable authority/schema and supervisor custody design and
combine these questions in ONE outside boundary review. Do not request a separate
audit for this text alone. No product source or existing signed bytes changed.

## 6. Checks actually performed

Read current native job-launcher and historical broker peer code, plus related
handoffs; the code index did not cover these requested native paths, so direct
source inspection controls. Checked the cited primary Microsoft API pages.
Local source-pattern scan passed (1,300 eligible files, 15,457,078 bytes), with
all four scanner regression cases passing in 911.5882 ms; git whitespace check
passed. The scanner excludes some file types/oversize files and is not a proof
of absence of every secret. No native compilation, physical test, full-regression
rerun or independent review is claimed for this documentation-only follow-up.
