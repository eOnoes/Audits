# Host child bootstrap: proposed trust and ownership contract

2026-09-19 UTC, source checkpoint `54f6682a1bb29810eab1b30f367bbbae1ae16a8c`.
DESIGN FOR REVIEW, NOT implementation, enrollment or physical-run authorization.

## Problem and selected direction

Current child helpers can order local checks, clear inheritance and measure exact
pipe access. They cannot authenticate the source of their role, handles or OMK1
pins. Do not add a self-checksum, secret command-line string, or public nonce and
call that authentication. The root is protected launcher/runtime enrollment and
kernel-controlled creation/ownership; these mechanisms are not yet implemented.

Use one dedicated serialized launcher L, under its protected host identity, to
create the exact enrolled fixed-role image with a complete minimal environment
and explicit handle list. L chooses all role/run/context values from its own
verified configuration and retained run state. Task content cannot choose a
binary, argument, handle, role, clock, host-session pin or environment variable.
No public endpoint accepts a user-constructed startup envelope as admission.

The startup envelope is metadata, not a bearer credential. Its eventual encoding
may travel in a fixed launcher-created environment entry without granting anyone
who copies it permission to act. Do NOT implement that encoding yet: reviewers
must first resolve the provenance and process-access controls below. No second
clock schema is needed; preserve the existing exact OMK1 bytes and reference.

## Authority and identity requirements

1. Installer/enrollment must establish L and role binary/runtime custody before
   loading them. Neither the child-local helper nor a hash of its own loaded DLL
   supplies that root. Preserve held code objects and fixed loader dependencies.
2. The ordinary task/operator identity must not be able to modify L's configuration,
   rewrite the child image, inject into a role process, duplicate its private
   handles, or supply an alternate environment. Test actual process/token access;
   different filenames, a PID, or an ACL comment do not prove this separation.
3. L owns an immutable run record containing selected role, retained created
   process/thread identity, exact endpoint slot map, original clock context and
   independent host-session/run/image pins. Child-returned bytes cannot replace it.
4. Parent/child startup metadata is accepted only for that already-created role.
   Manually launching the same binary with copied metadata must yield no effect
   authority. Downstream G/W/S admission must also remain bound to L's actual
   retained endpoint ownership, never just equal payload digests.
5. Do not infer the eventual inherited peer from pipe creator/client PID queries:
   the current inert pair is created and connected in L before transfer. Those
   initial connection observations are not evidence of the later role holder.
6. Distinct handle values prove neither distinct kernel objects nor the correct
   route. L must derive each slot from a distinct owned pair and prevent route
   substitution before duplication; child rights checks are only defense in depth.

## Ordered startup and failure ownership

- L captures the existing host clock before any reservation/preparation. Receivers
  use MetadataHostClockTransfer with independently held pins and the original
  timestamp; no new receipt-time origin, guest QPC adoption or reboot reuse.
- Keep the fixed six-edge topology. L stages only the fixed role's reduced-right
  endpoints. No ledger, anchor, credentials, job-control or unrelated handles in
  the inherited list. Serialize creation while inheritable duplicates exist.
- S must be prearmed with independently retained lifetime before G readiness or
  C/W reservation. The C-only kill-on-close test owner cannot own G/S lifetimes.
- Retain the original creation handles; bind the role/run to that exact child.
  Finish native attribute cleanup before releasing creator copies. Preserve the
  separate stop obligation on any failed or uncertain startup.
- Child startup retains all slots, validates local properties/access, clears and
  verifies inheritance, checks trusted context and original time, then emits one
  bounded startup response. This is local readiness only, not permission to edit,
  launch a verifier, consume an approval, publish, or access a VM.
- L validates a response only from the exact retained channel and child instance.
  Response loss, timeout, wrong context or unknown stop never authorizes retry,
  owner replacement, fresh budget, or automatic resume. EOF requires all extra
  copies gone; parent exit alone is not descendant/management settlement.

## Required falsifiers — all NOT RUN for this proposed composition

| Control | Required negative/positive evidence |
| --- | --- |
| HB01 | Copy legitimate startup bytes into a manual launch; no authority or accepted startup |
| HB02 | Substitute role, one slot, OMK1 origin/reference, run nonce or image; deny before readiness |
| HB03 | Substitute equal-rights unrelated pipes or aliased objects in distinct slots; deny |
| HB04 | Attempt process injection/handle duplication/config rewrite from the denied task identity; actual access denied |
| HB05 | Delay startup through the original deadline; deny, never reset origin |
| HB06 | Keep an extra lifeline writer; negative control detects lost EOF protection |
| HB07 | Kill L/G separately at every transfer cut; S remains able to fulfill its sole stop obligation |
| HB08 | Clear flag call succeeds but read-back/access query fails; no readiness, owned cleanup preserved |
| HB09 | Lose/duplicate/mutate startup response; no second attempt or automatic resume |
| HB10 | Correct fixed-role startup from protected L; observed identity/access/deadline checks all succeed |

## Review and execution gate

Review the proposed trust root, delivery mechanism, process-access matrix and
independent G/S ownership as one boundary before adding a native startup consumer.
Scope should include this design, the existing clock/code-custody/topology
contracts, the child/inheritance/suspended code and their narrowly relevant tests
and receipts. Historical native passes remain older-source evidence; compile-only
and synthetic checks do not close HB01-HB10. A later physical probe needs separate
scoped operator authorization and appropriate disposable/protected placement.
No public upload, provider call, privileged installation or activation is approved
by this document. W1-W5 and the full release objective remain incomplete.
