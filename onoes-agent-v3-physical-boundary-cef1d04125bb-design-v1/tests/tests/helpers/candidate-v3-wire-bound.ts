import { canonicalJson } from "../../src/compatibility/canonical-json.js";

// TEST/RESEARCH ONLY. Conservative structural supersets, NOT legal histories,
// claims to authenticate, new parser limits or a runtime admission policy.
// The associated test pins the inspected source and checks every object key.
const id = "ffffffff-ffff-4fff-bfff-ffffffffffff", digest = "sha256:" + "f".repeat(64), at = "9999-12-31T23:59:59.999Z";
const fields = (keys: string[], value: string) => Object.fromEntries(keys.map(k => [k, value]));
export function maximumStructuralShapes() {
  const metadata = { domain: "agent-candidate-effect-ledger/v3", ...fields(["installationId", "namespaceId", "storeId"], id) };
  const intent = { schemaVersion: metadata.domain,
    ...fields(["installationId", "namespaceId", "storeId", "operationId", "workflowId", "approvalId", "ownerGeneration", "guestGeneration", "executionOperationId"], id),
    ...fields(["authorizationDigest", "workspaceDigest", "policyBindingDigest", "candidateDigest", "reviewMaterialDigest", "sourceManifestDigest",
      "requestDigest", "guestImageDigest", "controllerIdentityDigest", "resourcePolicyDigest", "resultDigest"], digest),
    expiresAt: at, kind: "publish" };
  const event = { state: "result-and-stop-observed", recordedAt: at, evidenceDigest: digest, resultDigest: digest,
    verificationPassed: false, outcome: "stopped-without-result", predecessorRecordDigest: digest, outcomeCheckpointDigest: digest };
  const record = { intent, intentDigest: digest, approvalIdentityDigest: digest, reservedAt: at,
    events: Array.from({ length: 6 }, () => ({ ...event })) };
  const settlement = { domain: "agent-candidate-settlement-evidence/v1",
    ...fields(["installationId", "namespaceId", "storeId", "operationId", "workflowId", "ownerGeneration", "guestGeneration"], id),
    ...fields(["intentDigest", "requestDigest", "sourceManifestDigest", "workspaceDigest", "policyBindingDigest", "controllerIdentityDigest",
      "resourcePolicyDigest", "priorOutcomeRecordDigest", "resultDigest", "contactAccountingDigest", "ownerFenceEvidenceDigest",
      "processSettlementEvidenceDigest", "generationRetirementEvidenceDigest", "custodyReleaseEvidenceDigest", "publicationExclusionEvidenceDigest",
      "workspaceSafetyEvidenceDigest"], digest),
    kind: "execute", outcome: "stopped-without-result", verificationPassed: false, observedAt: at, validUntil: at };
  const checkpoint = { domain: "agent-candidate-checkpoint/v1",
    ...fields(["installationId", "namespaceId", "storeId", "producerGeneration", "operationId"], id),
    ...fields(["previousCheckpointDigest", "recordDigest", "approvalIdentityDigest", "inventoryRootDigest", "checkpointDigest"], digest),
    sequence: Number.MAX_SAFE_INTEGER, eventIndex: null, operationCount: 1000 };
  // null (4 bytes) is larger than eventIndex 0..6 (1 byte). Do not assume
  // the numeric maximum is the largest JSON encoding of a nullable field.
  return { metadata, intent, event, record, settlement, checkpoint };
}
export interface JsonByteProfile { bytes: number; quotes: number; backslashes: number }
export function profile(text: string): JsonByteProfile {
  let quotes = 0, backslashes = 0;
  for (let i = 0; i < text.length; i++) { if (text.charCodeAt(i) === 34) quotes++; else if (text.charCodeAt(i) === 92) backslashes++; }
  return { bytes: Buffer.byteLength(text), quotes, backslashes };
}
const sum = (items: JsonByteProfile[]): JsonByteProfile => items.reduce((a, b) => ({ bytes: a.bytes + b.bytes,
  quotes: a.quotes + b.quotes, backslashes: a.backslashes + b.backslashes }), { bytes: 0, quotes: 0, backslashes: 0 });
export function embed(p: JsonByteProfile): JsonByteProfile {
  // Inner canonical JSON is printable ASCII here. Quotes and backslashes
  // are the ONLY characters re-escaped when it becomes a JSON string.
  return { bytes: 2 + p.bytes + p.quotes + p.backslashes, quotes: 2 + p.quotes, backslashes: p.quotes + 2 * p.backslashes };
}
export function arrayBound(p: JsonByteProfile, n: number): JsonByteProfile {
  if (!Number.isSafeInteger(n) || n < 0) throw Error("invalid-research-count");
  return { bytes: 2 + Math.max(0, n - 1) + n * p.bytes, quotes: n * p.quotes, backslashes: n * p.backslashes };
}
export function objectBound(fields: Record<string, JsonByteProfile>): JsonByteProfile {
  const keys = Object.keys(fields), all = sum(keys.flatMap(k => [profile(JSON.stringify(k)), fields[k]!]));
  return { ...all, bytes: all.bytes + 2 + Math.max(0, keys.length - 1) + keys.length };
}
export function structuralWireBounds() {
  const shapes = maximumStructuralShapes(), members = {
    metadata: profile(canonicalJson(shapes.metadata)), record: profile(canonicalJson(shapes.record)),
    settlement: profile(canonicalJson(shapes.settlement)), checkpoint: profile(canonicalJson(shapes.checkpoint)),
  };
  const row = objectBound({ recordWire: embed(members.record), settlementWire: embed(members.settlement), checkpointAWire: embed(members.checkpoint) });
  const inventory = objectBound({ domain: profile(JSON.stringify("agent-candidate-inventory-transport/v1")), records: arrayBound(row, 1000) });
  const history = objectBound({ domain: profile(JSON.stringify("agent-candidate-checkpoint-history/v1")), checkpoints: arrayBound(embed(members.checkpoint), 7001) });
  const snapshot = objectBound({ domain: profile(JSON.stringify("agent-candidate-v3-local-snapshot/v1")), metadataWire: embed(members.metadata),
    inventoryWire: embed(inventory), historyWire: embed(history) });
  return { kind: "conservative-structural-byte-ceiling-not-admissible-corpus-or-resource-measurement" as const,
    members, row, inventory, history, snapshot, operations: 1000, structuralEventsPerRow: 6, structuralCheckpoints: 7001 };
}

// Bound is valid only for these inspected definitions and canonicalization.
// Pins use LF-normalized source so checkout CRLF conversion is not schema drift.
// A change fails the research test and requires deriving/reviewing the bound
// again; do not update these hashes merely to make the test green.
export const BOUND_SOURCE_PINS = Object.freeze({
  "src/build-only/windows-candidate-effect-state.ts": "4ba88b9e8441856ef8a753ab01aa74c51097c38c1f0602a021448fbb955974d9",
  "src/build-only/windows-candidate-v3-data.ts": "4731e9871acc8175b2b1a7ff09999aa2fe9d46e2d5cf32f978dfcd5b73bf27c2",
  "src/build-only/windows-candidate-v3-record.ts": "5c85cc13739f03b8daf1b1bae187732fac25431b044453598d99556fd842c8ef",
  "src/build-only/windows-candidate-v3-inventory.ts": "668599f256016ee5cf16f2c9c3ce1d1f9cca49fcb8593f9f1e89ae2fd62365ba",
  "src/build-only/windows-candidate-v3-messages.ts": "4d53d888056084569ae7757b2f1cd9d5bd72127fe8ccf44146d870670bcbefb6",
  "src/build-only/windows-candidate-v3-coordinator-data.ts": "170bdaa6c22e65d97e16d5de3b3aafa4fb15a69561e79e37e26ebcb9365d0869",
  "src/compatibility/canonical-json.ts": "5615f2c1374bd71d1691527a1a970bb3d884540a642a980bf32b7e8ae5af5424",
});
