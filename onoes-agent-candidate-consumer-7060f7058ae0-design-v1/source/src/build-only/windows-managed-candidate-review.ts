import { canonicalJson, canonicalSha256Digest, sha256Digest } from "../compatibility/canonical-json.js";
import { containsSecretLikeContent, decodeBuilderText, countExactOccurrences, replaceBuilderLiteral } from "../builder/content-policy.js";
import { parseBuilderPatchPlan } from "../builder/schemas.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { isManagedTaskInspection, type ManagedTaskInspection } from "./windows-managed-task-inspection.js";
import type { SqliteManagedCandidateStore } from "./windows-managed-candidate-store.js";
import { OPERATOR_TASK_PREVIEW_LIMITS } from "./windows-operator-task-preview.js";

// Source-bearing local review INPUT, never a review result or an approval.
// No signing, enrollment, network, storage, commands or file adapter. The planning
// session owns consent and freshness. No production export route is supplied.
export const MANAGED_CANDIDATE_REVIEW_LIMITS = Object.freeze({ requestBytes: 1024, wireBytes: 33_554_432 });
const issuedMaterials = new WeakSet<object>();
export type ManagedCandidateReviewMaterial = ReturnType<typeof compileManagedCandidateReview>;
/** In-process compiler provenance only, never freshness, review or approval.
 * Serialized review input deliberately cannot recover this identity. */
export function isManagedCandidateReviewMaterial(value: unknown): value is ManagedCandidateReviewMaterial {
  return typeof value === "object" && value !== null && issuedMaterials.has(value);
}
type Artifact = ReturnType<SqliteManagedCandidateStore["readPrivateArtifact"]>;
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const fail = (): never => { throw new Error("managed-candidate-review-unavailable"); };

/** Compiler only. Serialized output carries no in-process approval provenance.
 * Stable content identity excludes the ephemeral inspection handle and request ID. */
export function compileManagedCandidateReview(storeId: string, artifactDigest: string, saved: Artifact, inspection: ManagedTaskInspection) {
  if (!isManagedTaskInspection(inspection) || canonicalSha256Digest(saved) !== artifactDigest
    || inspection.inspectionDigest !== saved.inspectionDigest || inspection.briefDigest !== saved.intakeDigest
    || !same(inspection.workspace, saved.workspace)) return fail();
  const proposal = JSON.parse(saved.proposalWire) as Record<string, unknown>;
  const { workProposalDigest, ...proposalCore } = proposal;
  if (canonicalJson(proposal) !== saved.proposalWire || workProposalDigest !== saved.workProposalDigest
    || canonicalSha256Digest(proposalCore) !== workProposalDigest || !same(proposal["policyBinding"], inspection.policyBinding)) return fail();
  const plan = parseBuilderPatchPlan(proposal["plan"]), patches = new Map(plan.patches.map(p => [p.relativePath, p]));
  if (patches.size !== plan.patches.length || patches.size !== saved.files.length
    || plan.patches.reduce((n, p) => n + p.operations.length, 0) > OPERATOR_TASK_PREVIEW_LIMITS.operations) return fail();
  const changed = new Map(saved.files.map(f => [f.relativePath, f]));
  let scanBytes = 0, sourceJsonBytes = 0;
  const files = inspection.files.map(file => {
    const edit = changed.get(file.relativePath), before = file.text;
    if (Buffer.byteLength(before) !== file.byteLength || sha256Digest(Buffer.from(before)) !== file.contentDigest) return fail();
    let after = before;
    if (edit) {
      const patch = patches.get(file.relativePath);
      if (!patch || patch.expectedPreimageDigest !== file.contentDigest) return fail();
      let predicted = before;
      for (const operation of patch.operations) {
        scanBytes += Buffer.byteLength(predicted);
        if (scanBytes > OPERATOR_TASK_PREVIEW_LIMITS.scanBytes || operation.before === operation.after
          || countExactOccurrences(predicted, operation.before) !== 1) return fail();
        const length = Buffer.byteLength(predicted) - Buffer.byteLength(operation.before) + Buffer.byteLength(operation.after);
        if (length > OPERATOR_TASK_PREVIEW_LIMITS.postimageBytes) return fail();
        predicted = replaceBuilderLiteral(predicted, operation.before, operation.after);
      }
      const bytes = Buffer.from(edit.afterBase64, "base64");
      try {
        if (edit.preimageDigest !== file.contentDigest || edit.beforeBytes !== file.byteLength
          || Buffer.from(before).toString("base64") !== edit.beforeBase64 || bytes.toString("base64") !== edit.afterBase64
          || bytes.length !== edit.afterBytes || sha256Digest(bytes) !== edit.predictedPostimageDigest) return fail();
        after = decodeBuilderText(bytes);
        if (predicted !== after) return fail();
      } finally { bytes.fill(0); }
      changed.delete(file.relativePath);
    }
    if (containsSecretLikeContent(before) || containsSecretLikeContent(after)) return fail();
    // Reject excessive JSON escaping before constructing the complete material
    // string. Count each unchanged value twice without encoding it twice. This
    // is only a lower bound (source values alone); the final exact wire check
    // below still covers all metadata, punctuation and the material digest.
    const beforeJsonBytes = Buffer.byteLength(JSON.stringify(before));
    sourceJsonBytes += beforeJsonBytes + (after === before ? beforeJsonBytes : Buffer.byteLength(JSON.stringify(after)));
    if (sourceJsonBytes > MANAGED_CANDIDATE_REVIEW_LIMITS.wireBytes - 128) return fail();
    return { relativePath: file.relativePath, changed: edit !== undefined,
      preimageDigest: file.contentDigest, postimageDigest: edit?.predictedPostimageDigest ?? file.contentDigest,
      beforeBytes: file.byteLength, afterBytes: Buffer.byteLength(after), before, after };
  });
  if (changed.size !== 0) return fail();
  const core = { schemaVersion: "agent-managed-candidate-review-material/v1" as const,
    kind: "complete-source-review-input-not-review-evidence" as const, candidateStoreId: storeId, artifactDigest,
    workProposalDigest: saved.workProposalDigest, inspectionDigest: saved.inspectionDigest,
    selector: { ...saved.selector }, workspace: { ...saved.workspace }, policyBinding: { ...inspection.policyBinding },
    proposal, files, fileCount: files.length, changedFileCount: saved.files.length,
    beforeBytes: files.reduce((n, f) => n + f.beforeBytes, 0), afterBytes: files.reduce((n, f) => n + f.afterBytes, 0),
    fullReadScopeIncluded: true as const, sourceIncluded: true as const, sourceRole: "untrusted-review-data" as const,
    exactPatchReplayMatched: true as const,
    ruleStatus: "not-independently-verified" as const, reviewStatus: "not-performed" as const,
    testStatus: "not-run" as const, externalTransferAuthorized: false as const,
    approvalAvailable: false as const, executionEnabled: false as const, authority: "none" as const };
  const content = canonicalJson(core);
  if (Buffer.byteLength(content) > MANAGED_CANDIDATE_REVIEW_LIMITS.wireBytes - 128 || containsSecretLikeContent(content)) return fail();
  const material = deepFreeze({ ...core, reviewMaterialDigest: sha256Digest(Buffer.from(content)) });
  issuedMaterials.add(material); return material;
}
