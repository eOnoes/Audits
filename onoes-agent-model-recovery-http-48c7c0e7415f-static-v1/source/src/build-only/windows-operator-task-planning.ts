import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { WindowsManagedDraftPlanningSession, ManagedDraftPlanningError } from "./windows-managed-draft-planning.js";

// Paired local disclosure contract only. No provider, saved-proposal write,
// approval, command, import, restore or execution action is representable.
export const OPERATOR_TASK_PLANNING_LIMITS = Object.freeze({ bodyBytes: 5_242_880, responseBytes: 4_259_840,
  attemptsPerMinute: 10, inspectionsPerMinute: 2 });
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const selector = z.object({ storeId: uuid, taskId: uuid, creationEpoch: z.number().int().min(1).max(1_000_000_000),
  expectedRevision: z.number().int().min(1).max(63) }).strict();
const selected = { inspectionHandle: uuid, selection: z.unknown(), discloseSource: z.literal(true) };
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("plan-description"), selector, readPlanMetadata: z.literal(true) }).strict(),
  z.object({ action: z.literal("prepare-plan"), plan: z.unknown() }).strict(),
  z.object({ action: z.literal("discard-plan") }).strict(),
  z.object({ action: z.literal("guided-proposal"), ...selected, edit: z.unknown(), workPlanDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal("inspect"), selector, readManagedFiles: z.literal(true) }).strict(),
  z.object({ action: z.literal("context"), ...selected }).strict(),
  z.object({ action: z.literal("edits"), ...selected, edit: z.unknown() }).strict(),
  z.object({ action: z.literal("proposal"), ...selected, edit: z.unknown(), proposal: z.unknown() }).strict(),
  z.object({ action: z.literal("discard") }).strict(),
]);
const invalid = (): never => { throw new ManagedDraftPlanningError("input-invalid"); };
export function parseOperatorTaskPlanningRequest(input: unknown) {
  try {
    const wire = canonicalJson(input); if (Buffer.byteLength(wire) > OPERATOR_TASK_PLANNING_LIMITS.bodyBytes) return invalid();
    const parsed = requestSchema.parse(JSON.parse(wire));
    if (canonicalJson(parsed) !== wire) return invalid();
    return deepFreeze(parsed);
  } catch { return invalid(); }
}
export async function accessOperatorTaskPlanning(input: unknown, session: WindowsManagedDraftPlanningSession, signal?: AbortSignal) {
  const r = parseOperatorTaskPlanningRequest(input);
  let value: unknown;
  switch (r.action) {
    case "plan-description": value = session.describeWorkPlan(canonicalJson(r.selector)); break;
    case "prepare-plan": value = session.prepareWorkPlan(canonicalJson(r.plan)); break;
    case "discard-plan": session.discardWorkPlan(); value = { discarded: true, processStopConfirmed: false }; break;
    case "guided-proposal": value = session.prepareGuidedProposal(r.inspectionHandle, canonicalJson(r.selection), canonicalJson(r.edit), r.workPlanDigest); break;
    case "inspect": {
      const result = await session.inspect(canonicalJson(r.selector), signal), inspection = result.inspection;
      // Never disclose complete source text just because an inspection happened.
      // The paired caller chooses bounded excerpts explicitly with context().
      value = { schemaVersion: "agent-managed-inspection-index/v1", kind: "saved-draft-inspection-metadata-not-source-or-approval",
        selector: result.selector, inspectionHandle: result.inspectionHandle, inspectionDigest: inspection.inspectionDigest,
        briefDigest: inspection.briefDigest, requestDigest: inspection.requestDigest, policyBinding: inspection.policyBinding,
        workspace: inspection.workspace, verification: result.verification,
        files: inspection.files.map(f => ({ relativePath: f.relativePath, byteLength: f.byteLength, contentDigest: f.contentDigest })),
        totalBytes: inspection.totalBytes, reuseLimitMs: result.reuseLimitMs, freshness: result.freshness,
        sourceTextIncluded: false, executionEnabled: false, approvalAvailable: false, authority: "none" };
      break;
    }
    case "context": value = session.compile(r.inspectionHandle, canonicalJson(r.selection)); break;
    case "edits": value = session.prepareEdits(r.inspectionHandle, canonicalJson(r.selection), canonicalJson(r.edit)); break;
    case "proposal": value = session.prepareProposal(r.inspectionHandle, canonicalJson(r.selection), canonicalJson(r.edit), canonicalJson(r.proposal)); break;
    case "discard": session.discard(); value = { discarded: true, processStopConfirmed: false }; break;
  }
  const result = deepFreeze({ schemaVersion: "agent-operator-task-planning-response/v1", kind: "paired-local-planning-not-approval",
    action: r.action, requestDigest: canonicalSha256Digest(r), value, persisted: false, providerInvoked: false,
    approvalAvailable: false, executionEnabled: false, authority: "none" });
  if (Buffer.byteLength(canonicalJson(result)) > OPERATOR_TASK_PLANNING_LIMITS.responseBytes) {
    session.discard(); return invalid();
  }
  return result;
}
