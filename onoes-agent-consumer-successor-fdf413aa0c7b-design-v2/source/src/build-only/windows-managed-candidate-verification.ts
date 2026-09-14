import { z } from "zod";
import { types } from "node:util";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { parseBuilderPatchPlan, parseBuilderTaskScope } from "../builder/schemas.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { isManagedCandidateReviewMaterial, type ManagedCandidateReviewMaterial } from "./windows-managed-candidate-review.js";
import { isResolvedManagedVerificationDefinition, type ResolvedManagedVerificationDefinition } from "./windows-managed-verification-catalog.js";
import { createManagedVerificationRequest, MANAGED_VERIFICATION_MAX_FILES } from "./windows-managed-verification-evidence.js";

// Dormant data composition only: no runner, VM, source transfer, approval,
// consumption, publication or effect. A retained compiler brand is NOT current
// source/policy/task liveness. The eventual host must revalidate those and obtain
// the separate dispatch authority; this module does neither and accepts no port.
// Matches the existing VM channel, without importing a process-owning adapter.
// A coupled regression must fail if the channel later narrows its ceiling.
export const MANAGED_CANDIDATE_VERIFICATION_MAX_REQUEST_BYTES = 65_536;
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identitySchema = z.object({ requestId: uuid, operationId: uuid }).strict();
// Read a projection of an already compiler-owned proposal, not a new parser or
// canonicalization rule for its historical bytes.
const bindingSchema = z.object({ catalogDigest: digest, definitionDigest: digest, commandContractDigest: digest,
  command: z.object({ verificationId: z.string() }).passthrough() }).passthrough();
const fail = (): never => { throw new Error("managed-candidate-verification-unavailable"); };
function snapshotIdentity(value: unknown) {
  if (typeof value !== "object" || value === null || types.isProxy(value)) return fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes("requestId") || !keys.includes("operationId")) return fail();
  const request = Object.getOwnPropertyDescriptor(value, "requestId"), operation = Object.getOwnPropertyDescriptor(value, "operationId");
  if (!request || !operation || !request.enumerable || !operation.enumerable
    || !("value" in request) || !("value" in operation)
    || typeof request.value !== "string" || typeof operation.value !== "string") return fail();
  return identitySchema.parse({ requestId: request.value, operationId: operation.value });
}
const issued = new WeakSet<object>();
export type ManagedCandidateVerificationPreparation = ReturnType<typeof prepareManagedCandidateVerification>;
export function isManagedCandidateVerificationPreparation(value: unknown): value is ManagedCandidateVerificationPreparation {
  return typeof value === "object" && value !== null && issued.has(value);
}

/** Build the existing content-free request from ALL reviewed predicted files,
 * including unchanged read-scope files. No caller-selected files or replacement
 * catalog identities are accepted. IDs are host bookkeeping, not single-use
 * approval: compiling twice neither authorizes nor consumes any operation. */
export function prepareManagedCandidateVerification(material: ManagedCandidateReviewMaterial,
  resolution: ResolvedManagedVerificationDefinition, identity: unknown) {
  // Reject copies/proxies before inspecting any of their properties.
  if (!isManagedCandidateReviewMaterial(material) || !isResolvedManagedVerificationDefinition(resolution)) return fail();
  try {
    const ids = snapshotIdentity(identity);
    uuid.parse(material.candidateStoreId);
    const scope = parseBuilderTaskScope(material.proposal["scope"]);
    const plan = parseBuilderPatchPlan(material.proposal["plan"]);
    const binding = bindingSchema.parse(material.proposal["commandBinding"]);
    if (plan.taskId !== scope.taskId || plan.verificationId !== resolution.definition.verificationId
      || binding.command.verificationId !== plan.verificationId || binding.catalogDigest !== resolution.catalogDigest
      || binding.definitionDigest !== resolution.definitionDigest || binding.commandContractDigest !== resolution.definition.commandContractDigest
      || canonicalJson(scope.allowedVerificationIds) !== canonicalJson([plan.verificationId])
      || scope.repositoryRoot !== material.workspace.repositoryRoot || scope.worktreeRoot !== material.workspace.worktreeRoot
      || scope.worktreeAttestationDigest !== material.workspace.worktreeAttestationDigest) return fail();
    if (material.files.length === 0 || material.files.length > MANAGED_VERIFICATION_MAX_FILES
      || material.fileCount !== material.files.length
      || canonicalJson([...scope.allowedReadFiles].sort()) !== canonicalJson(material.files.map(f => f.relativePath).sort())
      || material.beforeBytes > scope.maxTotalBytes || material.afterBytes > scope.maxTotalBytes
      || material.files.some(f => f.beforeBytes > scope.maxFileBytes || f.afterBytes > scope.maxFileBytes)) return fail();
    const request = createManagedVerificationRequest(resolution, { ...ids, subject: {
      workspaceDigest: material.workspace.workspaceDigest, policyBindingDigest: canonicalSha256Digest(material.policyBinding),
      files: material.files.map(f => ({ relativePath: f.relativePath, contentDigest: f.postimageDigest })),
    } });
    if (Buffer.byteLength(canonicalJson(request)) > MANAGED_CANDIDATE_VERIFICATION_MAX_REQUEST_BYTES) return fail();
    const core = { schemaVersion: "agent-managed-candidate-verification-preparation/v1" as const,
      kind: "predicted-candidate-request-not-dispatch" as const, candidateStoreId: material.candidateStoreId,
      artifactDigest: material.artifactDigest, workProposalDigest: material.workProposalDigest,
      reviewMaterialDigest: material.reviewMaterialDigest, request,
      sourceIncluded: false as const, fullReadScopeIncluded: true as const,
      freshness: "requires-host-revalidation-before-dispatch" as const, testStatus: "not-run" as const,
      approvalAvailable: false as const, executionEnabled: false as const, authority: "none" as const };
    const result = deepFreeze({ ...core, preparationDigest: canonicalSha256Digest(core) });
    issued.add(result); return result;
  } catch { return fail(); }
}
