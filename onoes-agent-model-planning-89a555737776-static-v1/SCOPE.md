# Scope lock

Audit ID: onoes-agent-model-planning-89a555737776-static-v1
Publisher product revision: 89a5557377760e7be162e2cb0c40713e01b33a5e
Evidence requested: STATIC_SOURCE only.

The exact source/test inventory is receipts/SOURCE_IDENTITIES.json. Members are raw
Git blobs, not normalized/redacted reconstructions. The tests/tests prefix preserves
original product paths. The producer read its own object store; no Git bundle or
independent authentication of commit membership is supplied.

Primary boundary: model suggestion, draft planning, managed runner and model
allocation journal. Context includes inspection, policy, proposal schemas and
the provider adapter. The executor and Builder barrel are type/caller context
only; their omitted implementation dependencies are not implied to be reviewed.
Dependency inventory is lexical TypeScript-parser output, not runtime closure.

Excluded: UI/HTTP integration, native/installer/guest code, actual provider routing
and billing, secrets, private host paths/logs, compiled code, installed dependencies,
packages, privileged services, production consumers and the full project.
Request missing load-bearing context rather than guessing. No package/fixture
PASS is inferred from this source extract.

Receipts/PRODUCER_EVIDENCE.json (lowercase receipts/ on disk) is publisher-reported
local execution, not raw test output or reviewer evidence. Review metadata and
generator are authored after the pinned product source.

Delivery status: LOCAL_PENDING_TRANSFER_APPROVAL. Recipient is not selected.
The generator never publishes or calls a reviewer. Before any public transfer,
confirm recipient and this exact inventory, verify the immutable remote tree,
and send the MANIFEST.sha256 file digest separately. It does not authenticate
itself. Deletion from the public latest tree does not erase Git history.
