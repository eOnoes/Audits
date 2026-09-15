import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { effectTime, effectUuid } from "./windows-candidate-effect-state.js";

// DATA ONLY. No database, enrollment, anchor, issuer, admission or effect port.
// A parsed claim is NOT authenticated evidence, custody, freshness or permission.
// V2 records and consumers are unchanged. These exports are not a v3 store API.
export const CANDIDATE_V3_DOMAIN = "agent-candidate-effect-ledger/v3" as const;
export const CANDIDATE_V3_APPROVAL_IDENTITY_DOMAIN = "agent-candidate-effect-ledger/v1" as const;
export const CANDIDATE_SETTLEMENT_DOMAIN = "agent-candidate-settlement-evidence/v1" as const;
export const CANDIDATE_SETTLEMENT_MAX_BYTES = 8_192;
export const CANDIDATE_V3_META_MAX_BYTES = 1_024;
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identity = { installationId: effectUuid, namespaceId: effectUuid, storeId: effectUuid };
const metaSchema = z.object({ domain: z.literal(CANDIDATE_V3_DOMAIN), ...identity }).strict();
const approvalSchema = z.object({ namespaceId: effectUuid, approvalId: effectUuid }).strict();
const settlementSchema = z.object({
  domain: z.literal(CANDIDATE_SETTLEMENT_DOMAIN), ...identity,
  kind: z.enum(["execute", "publish"]), operationId: effectUuid, workflowId: effectUuid,
  intentDigest: digest, requestDigest: digest, sourceManifestDigest: digest,
  workspaceDigest: digest, policyBindingDigest: digest,
  ownerGeneration: effectUuid, guestGeneration: effectUuid,
  controllerIdentityDigest: digest, resourcePolicyDigest: digest,
  priorOutcomeRecordDigest: digest,
  outcome: z.enum(["completed", "failed", "cancelled", "restored", "stopped-without-result"]),
  resultDigest: digest.nullable(), verificationPassed: z.boolean().nullable(),
  observedAt: effectTime, validUntil: effectTime,
  contactAccountingDigest: digest, ownerFenceEvidenceDigest: digest,
  processSettlementEvidenceDigest: digest, generationRetirementEvidenceDigest: digest,
  custodyReleaseEvidenceDigest: digest, publicationExclusionEvidenceDigest: digest,
  workspaceSafetyEvidenceDigest: digest,
}).strict();
const timelineSchema = z.object({ outcomeRecordedAt: effectTime, releaseRecordedAt: effectTime.nullable() }).strict();

export type CandidateV3Metadata = Readonly<z.infer<typeof metaSchema>>;
export type CandidateSettlementCore = Readonly<z.infer<typeof settlementSchema>>;
export class CandidateV3DataError extends Error {
  constructor() { super("candidate-v3-data-invalid"); this.name = "CandidateV3DataError"; }
}
function fail(): never { throw new CandidateV3DataError(); }
function parse<T>(schema: z.ZodType<T>, wire: unknown, cap: number): T {
  try {
    // Primitive text only: no Buffer getters, proxies, accessors, toJSON or
    // caller-owned objects are reflected on. Bound bytes BEFORE JSON.parse.
    if (typeof wire !== "string" || wire.length > cap || Buffer.byteLength(wire, "utf8") > cap) return fail();
    const value = schema.parse(JSON.parse(wire));
    // Reject BOM, duplicate keys, unknown/omitted fields, alternative escaping,
    // key order or whitespace. Existing canonicalJson also rejects bad UTF-16.
    if (canonicalJson(value) !== wire) return fail();
    return deepFreeze(value);
  } catch { return fail(); }
}

/** Descriptive identity only. A future store must bind these exact fields
 * durably and recheck them inside each transaction; this function opens none. */
export function parseCandidateV3Metadata(wire: unknown): CandidateV3Metadata {
  return parse(metaSchema, wire, CANDIDATE_V3_META_MAX_BYTES);
}

/** Stable namespace + approvalId identity. Does not establish that an approval
 * was issued/consumed or that version-spanning enrollment is exclusive. */
export function candidateV3ApprovalIdentity(wire: unknown): string {
  const key = parse(approvalSchema, wire, CANDIDATE_V3_META_MAX_BYTES);
  return canonicalSha256Digest({ domain: CANDIDATE_V3_APPROVAL_IDENTITY_DOMAIN, ...key });
}

/** Self-checking core shape, NOT authenticated role-specific evidence. A future
 * record parser must additionally join every subject/predecessor/digest field. */
export function parseCandidateSettlementCore(wire: unknown): CandidateSettlementCore {
  const core = parse(settlementSchema, wire, CANDIDATE_SETTLEMENT_MAX_BYTES);
  if (core.observedAt >= core.validUntil) return fail();
  const executionResult = core.kind === "execute" && (core.outcome === "completed" || core.outcome === "failed");
  if (executionResult) {
    if (core.resultDigest === null || core.verificationPassed !== (core.outcome === "completed")) return fail();
  } else {
    const allowed = core.kind === "execute"
      ? core.outcome === "cancelled" || core.outcome === "stopped-without-result"
      : core.outcome === "completed" || core.outcome === "restored" || core.outcome === "cancelled";
    if (!allowed || core.resultDigest !== null || core.verificationPassed !== null) return fail();
  }
  return core;
}

/** Check supplied historical timestamps, not the actual clock or a live release.
 * null releaseRecordedAt represents outcome-only evidence, never availability. */
export function parseCandidateSettlementTimeline(coreWire: unknown, timelineWire: unknown) {
  const core = parseCandidateSettlementCore(coreWire);
  const timeline = parse(timelineSchema, timelineWire, CANDIDATE_V3_META_MAX_BYTES);
  if (timeline.outcomeRecordedAt < core.observedAt || timeline.outcomeRecordedAt >= core.validUntil
    || (timeline.releaseRecordedAt !== null && (timeline.releaseRecordedAt < timeline.outcomeRecordedAt
      || timeline.releaseRecordedAt >= core.validUntil))) return fail();
  return deepFreeze({ core, timeline });
}
