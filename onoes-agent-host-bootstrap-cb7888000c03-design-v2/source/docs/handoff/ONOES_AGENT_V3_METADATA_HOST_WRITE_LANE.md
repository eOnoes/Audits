# Fixed host writes and endpoint handoff requirements

Follow-up: ONOES_AGENT_V3_METADATA_HOST_INERT_PAIR.md supplies a compile-only,
same-process inert factory and one-use lane admission. The prospective protected
cross-process map below remains unimplemented; inert ownership is not enrollment.

2026-09-19 UTC. Baseline `7eabc40`. Dormant native source, pure policy execution
and native COMPILE ONLY. No DLL load, native channel, process launcher, VM,
service, credential, provider, approval or protected storage operation occurred.

## Whole-frame write accounting

`MetadataHostWritePolicy` uses `MetadataHostReadPolicy.FrameSizes` so both
directions share the same six fixed itineraries. The route enum names the
RECEIVER-from-SENDER edge; its writer is the sender, not a second receiver.
FrameSizes returns a fresh array; no mutable global frame table is exposed.
The read policy's existing behavior is unchanged and was rerun in this capture.

Each frame is snapshotted only after its exact fixed length is checked, then
marked outstanding before the possible native submission. Only one frame can
be outstanding. The writer does not retry a suffix after a short write: zero,
partial, excess and uncertain completion permanently deny further frames.
Immediate submission success still requires the completion query/count. Exact
local completion advances the itinerary but proves neither peer acceptance nor
remote effect settlement. Final completion prohibits further writes.

The first reservation/ready/dispatch/early-stop write uses the original work
deadline; later report frames use original work+10000. W's retain input uses
that retention deadline from its first frame. The operation deadline stays
fixed through acknowledgment. Cancellation, inclusive expiry and regressing or
failed time permanently deny acknowledgment. Cancellation drain is nonrenewing,
at most 1000 ms from first denial and capped by original work+10000. Unknown
completion or exhausted drain never permits freeing a possibly live buffer.

## Native wrapper (not executed)

`MetadataHostWriteLane` has a private constructor and no endpoint factory or
runtime caller. Its six static route roots are absorbing for the fixture process.
Each operation owns a manual-reset event, unique OVERLAPPED, <=452-byte native
buffer and a pipe DangerousAddRef. Caller bytes are copied into owned memory
before WriteFile; no caller buffer remains the in-flight payload. A fresh sample
after copying denies submission if its original deadline passed. Since the
policy already marked possible work, a failure in this pre-call interval may
conservatively retain resources even though no write occurred; it cannot retry.

Poll makes at most one GetOverlappedResult(wait=false) call. There is no waiting
loop, sleep, storage callback or management operation. RequestClose requests
cancellation at most once and leaves Poll available for bounded cleanup.
Cancellation success/NOT_FOUND is not completion. Known completed work may
release its local resources; unknown work remains rooted for process lifetime.
After the final successful write the lane closes its own pipe handle. This
alone does not prove EOF at the peer: every other writer copy must also be gone.

These choices follow [WriteFile's buffer and completion contract](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-writefile).
Overlapped calls and a loop-free wrapper do not establish a hard scheduling or
native-call latency guarantee. Fair scheduling, bounded native behavior and
independent S lifetime remain physical review/test obligations. No FlushFileBuffers
is introduced: peer read acknowledgment must not block the safety decision loop.

The caller and managed realm are trusted. Same-process concurrent mutation of
input arrays, arbitrary reflection and privileged host compromise are not
contained by this byte snapshot. Payload semantic validation, expected context
and exact report provenance remain higher-layer obligations before BeginWrite.

## Exact prospective inheritance map

This table describes only the PURPOSE-BUILT CHANNEL handles inherited from L,
not every handle the CLR/Windows may subsequently create. It is a factory
requirement, not an observed runtime inventory.

| Child | Read ends | Write ends | Listed channel handles |
| --- | --- | --- | --- |
| G | C-to-G, W-to-G, S-to-G | G-to-C, G-to-W, G-to-S | 6 |
| C | G-to-C | C-to-G | 2 |
| W | G-to-W | W-to-G | 2 |
| S | G-to-S | S-to-G | 2 |

L must create one private overlapped byte-stream pipe per directed edge, six
pairs total, from independently enrolled scope. Only the listed child-specific
ends may be temporarily inheritable and included in its explicit creation list.
No evidence handle, credentials, unrelated file/job/process handle or opposite
pipe end belongs there. The list storage must live through native process
creation and attribute-list destruction; retain original returned process/thread
identities. Children clear inheritance and verify their exact type/direction/
access/context before readiness. Actual access masks, security descriptors,
endpoint connection proof and creator implementation are still open; they must
not be inferred from GetFileType or an echoed public nonce.

The native requirements for an explicit inheritance list are documented in
[UpdateProcThreadAttribute](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute).
L's child-creation sequence must be serialized while temporary inheritance is
enabled. It must close extra copies after successful transfer and on every
failed-creation/acknowledgment cut. In particular, once G owns G-to-S, L must
not retain another G-to-S writer. Otherwise G's death can be hidden from S.
[Pipe handle inheritance](https://learn.microsoft.com/en-us/windows/win32/ipc/pipe-handle-inheritance)
explains why unused inherited/creator ends affect EOF.

Start/prearm S before G readiness or C/W reservation. L loss before G handoff
must close the remaining lifeline writer, with S outside L/G teardown. No restart
or replacement stop issuer is elected. If no early-stop signal is sent, G holds
its writer as the lifeline. A sent early-stop signal may be followed by closure;
S's one-attempt latch must prevent a second attempt from that EOF. S's original
deadline/EOF/error trigger must act independently of read-cancellation drain,
report writes, peer acknowledgment or storage. Drain time is never extra time
to defer the already-required stop attempt. These are unexecuted composition
requirements, not guarantees provided by the current cores.

## Executed evidence and limits

Capture: `scripts/capture-v3-metadata-host-write.mjs initial|final`.
Raw create-only directories:
`../reports/v3-metadata-host-write-20260919-{initial,final}/`.

Both runs passed 55,590 read assertions and 29,814 write assertions using
fabricated return events. The write suite covers all six routes, each frame's
returned byte counts 0..453 plus uint32 max, immutable caller snapshots, exact
read/write itinerary composition with fragmented reads and separate EOF,
malformed lengths, duplicate submission, partial writes with no retry, original
deadlines, pre-submission expiry, cancellation/completion races, unknown errors,
nonrenewing drain, clock failure and independent stalled lanes.

The two pure binaries link only their declared policy/test sources. The separate
six-source native DLL compiled with warnings-as-errors, but was never loaded.
These are assertion counts, not native test-case or release-pass counts.
Nine source/capture inputs, Node/compiler/three framework identities, ten raw
outputs and five generated artifact/configuration identities are pinned in each
receipt. Sources/tools stayed unchanged during each run and binaries/configs
were rechecked afterward. These local receipts contain absolute tool/output
paths and must not be exported publicly without sanitization and approval.

A separate readback verified all 58 listed source/output/tool/artifact identities
across both receipts (29 per run). The earlier read-only receipts remain intact;
their old read-policy identity is historical, not claimed equal to this refactor.

Next: implement the restricted creator/admission path against this map, review
the combined ownership boundary, then separately authorize inert native fault
tests. No generic raw-handle admission is supplied. Protected runtime enrollment,
sole S survival, true management settlement, fresh final Off, retained storage,
external review, W1-W5 and release/operator acceptance remain open.
