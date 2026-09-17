import { canonicalSha256Digest as hash } from "../../src/compatibility/canonical-json.js";
import { CANDIDATE_V3_DOMAIN, CANDIDATE_SETTLEMENT_DOMAIN, CANDIDATE_V3_INVENTORY_ROOT_DOMAIN } from "../../src/build-only/windows-candidate-v3-data.js";
import { CANDIDATE_V3_CHECKPOINT_DOMAIN } from "../../src/build-only/windows-candidate-v3-record.js";

// Synthetic CLAIM construction. No parser is used to certify its own fixture;
// no storage, checkpoint service, actual evidence, issuer or effects exist here.
export const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
export const digest = (n: number) => "sha256:" + n.toString(16).padStart(64, "0");
export const time = (n: number) => new Date(Date.UTC(2026, 8, 15) + n).toISOString();
export const metadata = { domain: CANDIDATE_V3_DOMAIN, installationId: uuid(1), namespaceId: uuid(2), storeId: uuid(3) };
export function event(state: string, n: number) {
  return { state, recordedAt: time(n), evidenceDigest: digest(n + 100), resultDigest: null as string | null,
    verificationPassed: null as boolean | null, outcome: null as string | null,
    predecessorRecordDigest: null as string | null, outcomeCheckpointDigest: null as string | null };
}
export function fixture(kind = "execute", outcome = "completed", stopAfterDelivery = false) {
  const intent = { schemaVersion: CANDIDATE_V3_DOMAIN, installationId: uuid(1), namespaceId: uuid(2), storeId: uuid(3),
    operationId: uuid(4), workflowId: uuid(5), approvalId: uuid(6), ownerGeneration: uuid(7), authorizationDigest: digest(20),
    workspaceDigest: digest(1), policyBindingDigest: digest(2), candidateDigest: digest(3), reviewMaterialDigest: digest(4),
    sourceManifestDigest: digest(5), requestDigest: digest(6), guestImageDigest: digest(7), guestGeneration: uuid(8),
    controllerIdentityDigest: digest(8), resourcePolicyDigest: digest(9), expiresAt: time(10), kind,
    ...(kind === "publish" ? { executionOperationId: uuid(9), resultDigest: digest(10) } : {}) };
  const record = { intent, intentDigest: hash(intent),
    approvalIdentityDigest: hash({ domain: "agent-candidate-effect-ledger/v1", namespaceId: intent.namespaceId, approvalId: intent.approvalId }),
    reservedAt: time(0), events: [] as ReturnType<typeof event>[] };
  if (outcome !== "cancelled") {
    record.events.push(event(kind === "execute" ? "source-delivery-possible" : "publication-possible", 1));
    if (kind === "execute" && !stopAfterDelivery) record.events.push(event("launch-possible", 2));
    if (kind === "execute" && ["completed", "failed"].includes(outcome)) record.events.push({ ...event("result-and-stop-observed", 3), resultDigest: digest(10), verificationPassed: outcome === "completed" });
  }
  const outcomeIndex = record.events.length;
  const core = { domain: CANDIDATE_SETTLEMENT_DOMAIN, installationId: intent.installationId, namespaceId: intent.namespaceId,
    storeId: intent.storeId, kind, operationId: intent.operationId, workflowId: intent.workflowId,
    intentDigest: record.intentDigest, requestDigest: intent.requestDigest, sourceManifestDigest: intent.sourceManifestDigest,
    workspaceDigest: intent.workspaceDigest, policyBindingDigest: intent.policyBindingDigest, ownerGeneration: intent.ownerGeneration,
    guestGeneration: intent.guestGeneration, controllerIdentityDigest: intent.controllerIdentityDigest, resourcePolicyDigest: intent.resourcePolicyDigest,
    priorOutcomeRecordDigest: hash(record), outcome,
    resultDigest: kind === "execute" && ["completed", "failed"].includes(outcome) ? digest(10) as string | null : null,
    verificationPassed: kind === "execute" && ["completed", "failed"].includes(outcome) ? (outcome === "completed") as boolean | null : null,
    observedAt: time(outcomeIndex + 1), validUntil: time(20), contactAccountingDigest: digest(21), ownerFenceEvidenceDigest: digest(22),
    processSettlementEvidenceDigest: digest(23), generationRetirementEvidenceDigest: digest(24), custodyReleaseEvidenceDigest: digest(25),
    publicationExclusionEvidenceDigest: digest(26), workspaceSafetyEvidenceDigest: digest(27) };
  record.events.push({ ...event(outcome, outcomeIndex + 1), evidenceDigest: hash(core) });
  const checkpointA = { domain: CANDIDATE_V3_CHECKPOINT_DOMAIN, installationId: intent.installationId,
    namespaceId: intent.namespaceId, storeId: intent.storeId, producerGeneration: intent.ownerGeneration,
    sequence: outcomeIndex + 2, previousCheckpointDigest: digest(80) as string | null, operationId: intent.operationId as string | null,
    eventIndex: outcomeIndex + 1 as number | null, recordDigest: hash(record) as string | null,
    approvalIdentityDigest: record.approvalIdentityDigest as string | null, inventoryRootDigest: digest(81), operationCount: 1, checkpointDigest: "" };
  record.events.push({ ...event("released", outcomeIndex + 2), evidenceDigest: hash(core), outcome,
    predecessorRecordDigest: checkpointA.recordDigest, outcomeCheckpointDigest: "" });
  const value = { record, core, checkpointA, outcomeIndex };
  rebind(value);
  return value;
}
export function rebind(value: ReturnType<typeof fixture>): void {
  const { record, core, checkpointA, outcomeIndex } = value;
  record.events[outcomeIndex]!.evidenceDigest = hash(core);
  const prior = { ...record, events: record.events.slice(0, outcomeIndex + 1) };
  checkpointA.recordDigest = hash(prior);
  checkpointA.inventoryRootDigest = hash({ domain: CANDIDATE_V3_INVENTORY_ROOT_DOMAIN, installationId: metadata.installationId,
    namespaceId: metadata.namespaceId, storeId: metadata.storeId, operationCount: 1,
    entries: [{ operationId: record.intent.operationId, eventIndex: prior.events.length, recordDigest: hash(prior),
      approvalIdentityDigest: record.approvalIdentityDigest, state: prior.events.at(-1)!.state }] });
  rehashCheckpoint(checkpointA);
  const release = record.events[outcomeIndex + 1]!;
  release.evidenceDigest = hash(core); release.predecessorRecordDigest = checkpointA.recordDigest; release.outcomeCheckpointDigest = checkpointA.checkpointDigest;
}
export function rehashCheckpoint(checkpoint: ReturnType<typeof fixture>["checkpointA"]): void {
  const { checkpointDigest: _unused, ...core } = checkpoint;
  checkpoint.checkpointDigest = hash(core);
}
