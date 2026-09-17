import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { effectTime, effectUuid } from "./windows-candidate-effect-state.js";
import { CANDIDATE_V3_DOMAIN, CANDIDATE_V3_INVENTORY_ROOT_DOMAIN, CandidateV3DataError, candidateV3ApprovalIdentity,
  parseCandidateV3Metadata, parseCandidateSettlementCore, parseCandidateSettlementTimeline,
} from "./windows-candidate-v3-data.js";

// DATA ONLY: replay supplied histories and digest relations. No mutation/store,
// enrollment, availability predicate, authenticated anchor, issuer or effect API.
export const CANDIDATE_V3_MAX_RECORD_BYTES = 32_768;
export const CANDIDATE_V3_CHECKPOINT_DOMAIN = "agent-candidate-checkpoint/v1" as const;
export const CANDIDATE_V3_MAX_CHECKPOINT_BYTES = 4_096;
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const common = {
  schemaVersion: z.literal(CANDIDATE_V3_DOMAIN), installationId: effectUuid, namespaceId: effectUuid, storeId: effectUuid,
  operationId: effectUuid, workflowId: effectUuid, approvalId: effectUuid, ownerGeneration: effectUuid,
  authorizationDigest: digest, workspaceDigest: digest, policyBindingDigest: digest, candidateDigest: digest,
  reviewMaterialDigest: digest, sourceManifestDigest: digest, requestDigest: digest,
  guestImageDigest: digest, guestGeneration: effectUuid, controllerIdentityDigest: digest,
  resourcePolicyDigest: digest, expiresAt: effectTime,
};
const intentSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("execute") }).strict(),
  z.object({ ...common, kind: z.literal("publish"), executionOperationId: effectUuid, resultDigest: digest }).strict(),
]);
const outcomes = ["completed", "failed", "restored", "cancelled", "stopped-without-result"] as const;
const outcomeSchema = z.enum(outcomes);
const stateSchema = z.enum(["source-delivery-possible", "launch-possible", "result-and-stop-observed",
  "publication-possible", ...outcomes, "quarantined", "released"]);
const eventSchema = z.object({ state: stateSchema, recordedAt: effectTime, evidenceDigest: digest,
  resultDigest: digest.nullable(), verificationPassed: z.boolean().nullable(),
  outcome: outcomeSchema.nullable(), predecessorRecordDigest: digest.nullable(), outcomeCheckpointDigest: digest.nullable(),
}).strict();
const recordSchema = z.object({ intent: intentSchema, intentDigest: digest, approvalIdentityDigest: digest,
  reservedAt: effectTime, events: z.array(eventSchema).max(6) }).strict();
const checkpointSchema = z.object({ domain: z.literal(CANDIDATE_V3_CHECKPOINT_DOMAIN),
  installationId: effectUuid, namespaceId: effectUuid, storeId: effectUuid, producerGeneration: effectUuid,
  sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), previousCheckpointDigest: digest.nullable(),
  operationId: effectUuid.nullable(), eventIndex: z.number().int().min(0).max(6).nullable(), recordDigest: digest.nullable(),
  approvalIdentityDigest: digest.nullable(), inventoryRootDigest: digest,
  operationCount: z.number().int().min(0).max(1_000), checkpointDigest: digest,
}).strict();
export type CandidateV3Record = Readonly<z.infer<typeof recordSchema>>;
export type CandidateV3Checkpoint = Readonly<z.infer<typeof checkpointSchema>>;
function fail(): never { throw new CandidateV3DataError(); }
function parse<T>(schema: z.ZodType<T>, wire: unknown, maxBytes: number): T {
  try {
    if (typeof wire !== "string" || wire.length > maxBytes || Buffer.byteLength(wire, "utf8") > maxBytes) return fail();
    const value = schema.parse(JSON.parse(wire));
    if (canonicalJson(value) !== wire) return fail();
    return deepFreeze(value);
  } catch { return fail(); }
}
function outcome(state: string): state is z.infer<typeof outcomeSchema> { return (outcomes as readonly string[]).includes(state); }
function state(record: CandidateV3Record): string { return record.events.at(-1)?.state ?? "reserved"; }
function prefix(record: CandidateV3Record, length: number): CandidateV3Record { return { ...record, events: record.events.slice(0, length) }; }

/** Digest-consistent checkpoint CLAIM only. The full inventory root, previous
 * checkpoint chain and actual authenticated freshness must be checked separately. */
export function parseCandidateV3Checkpoint(wire: unknown, metadataWire: unknown): CandidateV3Checkpoint {
  const pins = parseCandidateV3Metadata(metadataWire), value = parse(checkpointSchema, wire, CANDIDATE_V3_MAX_CHECKPOINT_BYTES);
  for (const key of ["installationId", "namespaceId", "storeId"] as const) if (value[key] !== pins[key]) return fail();
  const { checkpointDigest, ...core } = value;
  if (canonicalSha256Digest(core) !== checkpointDigest) return fail();
  if (value.sequence === 0) {
    if (value.previousCheckpointDigest !== null || value.operationId !== null || value.eventIndex !== null
      || value.recordDigest !== null || value.approvalIdentityDigest !== null || value.operationCount !== 0) return fail();
    const emptyRoot = canonicalSha256Digest({ domain: CANDIDATE_V3_INVENTORY_ROOT_DOMAIN,
      installationId: pins.installationId, namespaceId: pins.namespaceId, storeId: pins.storeId, operationCount: 0, entries: [] });
    if (value.inventoryRootDigest !== emptyRoot) return fail();
  } else if (value.previousCheckpointDigest === null || value.operationId === null || value.eventIndex === null
    || value.recordDigest === null || value.approvalIdentityDigest === null || value.operationCount === 0) return fail();
  // Each retained operation needs its reservation checkpoint, and this subject
  // alone needs eventIndex additional checkpoints. Full-inventory checking is
  // separate; this lower bound is not a claim that all other rows were supplied.
  if (value.eventIndex !== null && value.sequence < value.operationCount + value.eventIndex) return fail();
  return value;
}

/** Parse a history with its exact settlement core and checkpoint-A claims.
 * null context means not yet observed, not permission. Missing A after a local
 * release is rejected; missing B is NEVER represented as successful admission. */
export function parseCandidateV3Record(recordWire: unknown, metadataWire: unknown,
  settlementWire: unknown = null, checkpointAWire: unknown = null) {
  const pins = parseCandidateV3Metadata(metadataWire), record = parse(recordSchema, recordWire, CANDIDATE_V3_MAX_RECORD_BYTES);
  for (const key of ["installationId", "namespaceId", "storeId"] as const) if (record.intent[key] !== pins[key]) return fail();
  if (record.intentDigest !== canonicalSha256Digest(record.intent)
    || record.approvalIdentityDigest !== candidateV3ApprovalIdentity(canonicalJson({ namespaceId: record.intent.namespaceId, approvalId: record.intent.approvalId }))
    || record.reservedAt >= record.intent.expiresAt) return fail();
  let outcomeIndex = -1;
  for (let index = 0; index < record.events.length; index++) {
    const next = record.events[index]!, prior = prefix(record, index), previous = state(prior), last = prior.events.at(-1);
    if (previous === "quarantined" || previous === "released" || next.recordedAt < (last?.recordedAt ?? record.reservedAt)) return fail();
    if (next.state === "result-and-stop-observed"
      ? next.resultDigest === null || next.verificationPassed === null
      : next.resultDigest !== null || next.verificationPassed !== null) return fail();
    if (next.state !== "released" && (next.outcome !== null || next.predecessorRecordDigest !== null || next.outcomeCheckpointDigest !== null)) return fail();
    if (next.state === "quarantined") continue;
    if (next.state === "released") {
      if (!outcome(previous) || next.outcome !== previous || next.predecessorRecordDigest !== canonicalSha256Digest(prior)
        || next.outcomeCheckpointDigest === null || next.evidenceDigest !== last?.evidenceDigest) return fail();
      continue;
    }
    const valid = record.intent.kind === "execute"
      ? (previous === "reserved" && ["source-delivery-possible", "cancelled"].includes(next.state))
        || (previous === "source-delivery-possible" && ["launch-possible", "stopped-without-result"].includes(next.state))
        || (previous === "launch-possible" && ["result-and-stop-observed", "stopped-without-result"].includes(next.state))
        || (previous === "result-and-stop-observed" && next.state === (last?.verificationPassed ? "completed" : "failed"))
      : (previous === "reserved" && ["publication-possible", "cancelled"].includes(next.state))
        || (previous === "publication-possible" && ["completed", "restored"].includes(next.state));
    if (!valid) return fail();
    if (["source-delivery-possible", "launch-possible", "publication-possible"].includes(next.state)
      && next.recordedAt >= record.intent.expiresAt) return fail();
    if (outcome(next.state)) outcomeIndex = index;
  }
  if (outcomeIndex < 0) {
    if (settlementWire !== null || checkpointAWire !== null) return fail();
    return deepFreeze({ kind: "parsed-v3-record-not-admission" as const, record, settlementEvidence: null, outcomeCheckpoint: null });
  }
  const core = parseCandidateSettlementCore(settlementWire), event = record.events[outcomeIndex]!;
  for (const key of ["installationId", "namespaceId", "storeId", "kind", "operationId", "workflowId", "requestDigest",
    "sourceManifestDigest", "workspaceDigest", "policyBindingDigest", "ownerGeneration", "guestGeneration",
    "controllerIdentityDigest", "resourcePolicyDigest"] as const) if (core[key] !== record.intent[key]) return fail();
  const before = prefix(record, outcomeIndex), observation = before.events.at(-1);
  if (core.intentDigest !== record.intentDigest || core.priorOutcomeRecordDigest !== canonicalSha256Digest(before)
    || core.outcome !== event.state || core.observedAt < (observation?.recordedAt ?? record.reservedAt)
    || canonicalSha256Digest(core) !== event.evidenceDigest) return fail();
  if (record.intent.kind === "execute" && ["completed", "failed"].includes(event.state)
    && (core.resultDigest !== observation?.resultDigest || core.verificationPassed !== observation?.verificationPassed)) return fail();
  const release = record.events.find(e => e.state === "released");
  parseCandidateSettlementTimeline(settlementWire, canonicalJson({ outcomeRecordedAt: event.recordedAt, releaseRecordedAt: release?.recordedAt ?? null }));
  const checkpointA = checkpointAWire === null ? null : parseCandidateV3Checkpoint(checkpointAWire, metadataWire);
  if (checkpointA !== null) {
    if (checkpointA.operationId !== record.intent.operationId || checkpointA.producerGeneration !== record.intent.ownerGeneration
      || checkpointA.eventIndex !== outcomeIndex + 1 || checkpointA.recordDigest !== canonicalSha256Digest(prefix(record, outcomeIndex + 1))
      || checkpointA.approvalIdentityDigest !== record.approvalIdentityDigest) return fail();
  }
  if (release && (!checkpointA || release.outcomeCheckpointDigest !== checkpointA.checkpointDigest)) return fail();
  return deepFreeze({ kind: "parsed-v3-record-not-admission" as const, record, settlementEvidence: core, outcomeCheckpoint: checkpointA });
}
