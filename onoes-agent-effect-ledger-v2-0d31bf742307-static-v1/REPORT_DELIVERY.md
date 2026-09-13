# GitHub report delivery contract

Eddie requests that future GitHub-hosted audits return their completed report to
this GitHub repository, not only to chat. Review of the subject remains read-only.
This is a narrow report-output exception, not permission to change implementation.

## Required fields in every new packet request

- Report repository: `eOnoes/Audits`
- Report branch: `main`
- Report path: `<packet-id>/reports/AUDIT_REPORT.md` (fill the exact packet ID)
- Audited packet commit: the immutable commit supplied by the publisher
- Allowed write: add the completed, sanitized Markdown report at that path only

Do not use a shared root `AUDIT_REPORT.md` for new audits. Do not overwrite a
previous report: use `AUDIT_REPORT_ADDENDUM_1.md` or the next unused number in the
same reports directory, citing the prior report and exact audited revision.
The existing root report is historical evidence and must be preserved.

## Receiving reviewer

1. Review only the pinned packet. Record actual identity, prior involvement,
   evidence class, inspected files, limitations and all required verdict fields.
2. Sanitize the report before publication. Never include credentials, private logs,
   private paths, unrelated source or secrets. Public Git history persists.
3. Inspect the current repository workflow files and workflow activation state
   before any write. If the report commit could trigger Actions or this cannot be
   determined, stop before publishing and ask Eddie for that specific run approval.
   Never create, edit, enable, dispatch or rerun workflows, or incur charges.
4. Use existing authorized GitHub write access to add only the report on `main`.
   A report-only commit/push or equivalent GitHub file API write is permitted.
   Do not create branches or PRs, force-push, rewrite history, delete files, change
   source, tests, receipts, requests or manifests, or modify the audited project.
   Do not execute subject code, build, install, deploy or call providers.
5. Preserve concurrent work. On a conflict, reread current state; never overwrite
   another report or force a push. Reports are new outputs, not original manifest
   members. Do not regenerate the frozen input manifest to include a report.
6. Read back the actual committed report and compare its bytes with the intended
   output. Return its immutable GitHub file link and report commit in chat. Keep
   that output commit distinct from the commit whose source was audited.

If write access is unavailable, return the complete Markdown to the operator,
state `REPORT_DELIVERY: BLOCKED_NO_GITHUB_WRITE_ACCESS`, and name the exact target
path. Never ask for a token in chat or claim GitHub delivery succeeded. The
publisher can deliver it after sanitization and the same workflow check.

## Producer checks

Every future packet's AUDIT_REQUEST.md, SCOPE.md, reports/README.md, handoff message
and provenance fields must agree on this output exception and the exact report
path. Include these instructions in the packet itself; do not depend on a mutable
root document to authorize a frozen packet. Reject contradictory instructions
such as an unconditional 'do not write to GitHub' alongside required GitHub output.
Do not regenerate historical packets to change their original review authority.

Monitor the exact reports path and any operator-supplied report URL. A root report
with a matching audit ID can be received as a legacy exception. Preserve it and
read it fully; do not move or delete it merely to enforce the new convention.
Pause the per-audit monitor once the completed report has been received and
disposition recorded. Close and clean active source packets only after findings
are resolved and evidence is retained; deletion does not erase public history.
