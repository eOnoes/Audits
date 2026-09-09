# Scope and exclusions

This is a limited source extract at publisher-reported revision 44075c9a13e3c2f408c069b8933cc215db78cbea; no full project or history.

## Layout
- source/src/... retains product-relative source paths.
- tests/unit/... and tests/probes/... retain product-relative tests paths.
- source/package.json is dependency/script DECLARATION context only, not permission to run anything.
- receipts/source-manifest.json maps every copied member to its original path, raw Git blob OID, SHA-256 and size. Copied bytes are unchanged.
- All statically written relative import/export specifiers discovered from selected TS files are included. This lexical check is not a proof of runtime dependency closure. C# files are included together, not compiled.
- source and tests are separated for the handoff convention; their imports need not resolve in this delivery layout. It is deliberately not a runnable product.

## Excluded
Entire Git database/history, full project, packages/lockfile/dependency binaries, runtime state/databases, credentials, environment files, private paths, previous audit transcripts, raw logs, complete installer/guest harness and unrelated verifier/device experiments. Third-party dependencies and Node/.NET/Windows APIs are not embedded. Documentation referenced by source comments is not automatically included.

The guest worker/service/host scripts are NOT supplied or authorized to run. The static native class/session review cannot establish real service composition. Request exact missing context if necessary; do not assume absent runtime wiring is tested.

## Threat model and standing holds
Trusted coordinator/native service and adapters; untrusted candidate frames and workspace content. Administrator/SYSTEM/service compromise is outside the protection claim. Job lifecycle is not an untrusted-command sandbox. Protection of installed runtime, dependency closure, enrollment and confined verification remains unproven.

The live Windows guest/service/loader continuation was blocked by Defender at command launch. No bypass, OS setting change, fresh guest success, or production conclusion is authorized by this packet. A static pass cannot close that independent execution gate. Durable stores have finite limits with product retention/reconciliation work still outstanding.

## Independence
Publisher is the implementation agent. Reviewer should disclose prior involvement, re-derive findings and avoid treating producer tests/counts as independent proof. This packet deliberately supplies no historical PASS transcript as authority.
