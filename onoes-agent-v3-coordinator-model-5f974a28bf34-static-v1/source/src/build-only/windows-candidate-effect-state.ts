import { z } from "zod";
import { types } from "node:util";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";

// Dormant DATA contracts. Neither parsed intents nor recorded observations are
// approval, liveness, physical custody, or permission to invoke a port.
export const CANDIDATE_EFFECT_DOMAIN = "agent-candidate-effect-ledger/v2" as const;
// Keep spent-approval identity stable across record/schema upgrades and stores.
// Store binding prevents verbatim relocation, NOT duplicate host enrollment.
const APPROVAL_IDENTITY_DOMAIN = "agent-candidate-effect-ledger/v1" as const;
export const CANDIDATE_EFFECT_MAX_RECORD_BYTES = 32_768;
export const CANDIDATE_EFFECT_MAX_OPERATIONS = 1_000;
export const effectUuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const effectTime = z.string().refine(v => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v);
const common = {
  schemaVersion: z.literal(CANDIDATE_EFFECT_DOMAIN), namespaceId: effectUuid, storeId: effectUuid,
  operationId: effectUuid, workflowId: effectUuid, approvalId: effectUuid,
  workspaceDigest: digest, policyBindingDigest: digest, candidateDigest: digest,
  reviewMaterialDigest: digest, sourceManifestDigest: digest, requestDigest: digest,
  guestImageDigest: digest, guestGeneration: effectUuid, controllerIdentityDigest: digest,
  resourcePolicyDigest: digest, expiresAt: effectTime,
};
export const effectIntentSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("execute") }).strict(),
  z.object({ ...common, kind: z.literal("publish"), executionOperationId: effectUuid, resultDigest: digest }).strict(),
]);
export const effectStateSchema = z.enum(["reserved", "source-delivery-possible", "launch-possible",
  "result-and-stop-observed", "publication-possible", "completed", "failed", "restored", "cancelled", "quarantined"]);
const eventSchema = z.object({ state: effectStateSchema, recordedAt: effectTime, evidenceDigest: digest,
  resultDigest: digest.nullable(), verificationPassed: z.boolean().nullable() }).strict();
export const effectAdvanceSchema = z.object({ operationId: effectUuid, intentDigest: digest,
  state: effectStateSchema, evidenceDigest: digest, resultDigest: digest.nullable(), verificationPassed: z.boolean().nullable() }).strict();
export const effectRecordSchema = z.object({ intent: effectIntentSchema, intentDigest: digest,
  approvalIdentityDigest: digest, reservedAt: effectTime, events: z.array(eventSchema).max(6) }).strict();
export type CandidateEffectIntent = z.infer<typeof effectIntentSchema>;
export type CandidateEffectRecord = z.infer<typeof effectRecordSchema>;
export type CandidateEffectAdvance = z.infer<typeof effectAdvanceSchema>;
export type CandidateEffectReason = "input-invalid" | "state-invalid" | "transition-denied" | "expired"
  | "clock-invalid" | "schema-invalid" | "durability-invalid" | "identity-mismatch" | "transaction-active"
  | "storage-unavailable" | "write-poisoned" | "operation-missing" | "intent-conflict" | "approval-reused"
  | "workflow-reused" | "workspace-blocked" | "limit-exceeded" | "execution-unverified";
export class CandidateEffectError extends Error {
  constructor(public readonly reason: CandidateEffectReason) { super(`candidate-effect-${reason}`); this.name = "CandidateEffectError"; }
}
export function effectFail(reason: CandidateEffectReason): never { throw new CandidateEffectError(reason); }
function assertPassive(value: unknown): void {
  const seen = new Set<object>(); let nodes = 0, bytes = 0;
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 4096 || depth > 16) effectFail("input-invalid");
    if (typeof item === "string") bytes += Buffer.byteLength(item);
    if (bytes > CANDIDATE_EFFECT_MAX_RECORD_BYTES) effectFail("input-invalid");
    if (item === null || typeof item !== "object") return;
    // Test before ANY reflection: even canonicalJson's prototype/descriptor
    // operations could otherwise invoke a proxy trap.
    if (types.isProxy(item) || seen.has(item)) effectFail("input-invalid");
    seen.add(item);
    const proto = Object.getPrototypeOf(item);
    if (proto !== Object.prototype && proto !== null && proto !== Array.prototype) effectFail("input-invalid");
    const keys = Reflect.ownKeys(item); if (keys.length > 512) effectFail("input-invalid");
    for (const key of keys) {
      if (typeof key !== "string") effectFail("input-invalid");
      bytes += Buffer.byteLength(key);
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !("value" in descriptor)) effectFail("input-invalid");
      visit(descriptor.value, depth + 1);
    }
  };
  visit(value, 0);
}
export function effectParse<T>(schema: z.ZodType<T>, value: unknown, reason: CandidateEffectReason = "input-invalid"): T {
  try {
    // Descriptor-only canonicalization rejects getters/proxies/exotic objects
    // before schema property access, then isolates all caller-owned data.
    assertPassive(value);
    const wire = canonicalJson(value);
    if (Buffer.byteLength(wire) > CANDIDATE_EFFECT_MAX_RECORD_BYTES) return effectFail(reason);
    const parsed = schema.parse(JSON.parse(wire));
    if (canonicalJson(parsed) !== wire) return effectFail(reason);
    return parsed;
  } catch { return effectFail(reason); }
}
export function effectApprovalIdentity(intent: CandidateEffectIntent): string {
  return canonicalSha256Digest({ domain: APPROVAL_IDENTITY_DOMAIN, namespaceId: intent.namespaceId, approvalId: intent.approvalId });
}
export function candidateEffectState(record: CandidateEffectRecord): z.infer<typeof effectStateSchema> {
  return record.events.at(-1)?.state ?? "reserved";
}
export function candidateEffectBlocked(record: CandidateEffectRecord): boolean {
  return !["completed", "failed", "restored", "cancelled"].includes(candidateEffectState(record));
}
function terminal(state: string): boolean { return ["completed", "failed", "restored", "cancelled", "quarantined"].includes(state); }
function checkTransition(record: CandidateEffectRecord, next: z.infer<typeof eventSchema>): void {
  const previous = candidateEffectState(record), last = record.events.at(-1);
  if (terminal(previous)) effectFail("transition-denied");
  if (next.recordedAt < (last?.recordedAt ?? record.reservedAt)) effectFail("clock-invalid");
  const observing = next.state === "result-and-stop-observed";
  if (observing ? next.resultDigest === null || next.verificationPassed === null
    : next.resultDigest !== null || next.verificationPassed !== null) effectFail("transition-denied");
  if (next.state === "quarantined") return;
  if (next.state === "cancelled" && previous === "reserved") return;
  if (["source-delivery-possible", "launch-possible", "publication-possible"].includes(next.state)
    && next.recordedAt >= record.intent.expiresAt) effectFail("expired");
  const valid = record.intent.kind === "execute"
    ? (previous === "reserved" && next.state === "source-delivery-possible")
      || (previous === "source-delivery-possible" && next.state === "launch-possible")
      || (previous === "launch-possible" && observing)
      || (previous === "result-and-stop-observed" && next.state === (last?.verificationPassed ? "completed" : "failed"))
    : (previous === "reserved" && next.state === "publication-possible")
      || (previous === "publication-possible" && ["completed", "restored"].includes(next.state));
  if (!valid) effectFail("transition-denied");
}
export function validateCandidateEffectRecord(value: unknown): CandidateEffectRecord {
  const record = effectParse(effectRecordSchema, value, "state-invalid");
  if (record.intentDigest !== canonicalSha256Digest(record.intent)
    || record.approvalIdentityDigest !== effectApprovalIdentity(record.intent)
    || record.reservedAt >= record.intent.expiresAt) effectFail("state-invalid");
  const replay: CandidateEffectRecord = { ...record, events: [] };
  try { for (const event of record.events) { checkTransition(replay, event); replay.events.push(event); } }
  catch { effectFail("state-invalid"); }
  return deepFreeze(record);
}
export function advanceCandidateEffectRecord(record: CandidateEffectRecord, input: CandidateEffectAdvance, at: string): CandidateEffectRecord {
  const current = validateCandidateEffectRecord(record), next = effectParse(effectAdvanceSchema, input);
  if (next.operationId !== current.intent.operationId || next.intentDigest !== current.intentDigest) effectFail("intent-conflict");
  const event = effectParse(eventSchema, { state: next.state, evidenceDigest: next.evidenceDigest,
    resultDigest: next.resultDigest, verificationPassed: next.verificationPassed, recordedAt: at });
  checkTransition(current, event);
  return validateCandidateEffectRecord({ ...current, events: [...current.events, event] });
}
