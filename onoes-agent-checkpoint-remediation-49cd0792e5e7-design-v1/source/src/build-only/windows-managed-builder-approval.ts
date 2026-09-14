import { win32 } from "node:path";
import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { containsSecretLikeContent, countExactOccurrences, decodeBuilderText, replaceBuilderLiteral, sha256BuilderDigest } from "../builder/content-policy.js";
import { builderPatchPlanSchema, builderTaskScopeSchema, computeBuilderInspectionScopeDigest } from "../builder/schemas.js";
import { computeBuilderWriteTargetDigest } from "../builder/patch-executor.js";
import { KernelLeaseAuthority } from "../kernel/lease-authority.js";
import { pluginIdentitySchema } from "../kernel/schemas.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { WindowsBuilderEffectJournal, type BuilderEffectJournalReceipt } from "./windows-builder-effect-journal.js";
import { SqliteWindowsBuilderRecoveryStore, type RecoveryPreimage } from "./windows-builder-recovery-store.js";
import { previewWindowsWorkspaceAccess } from "./windows-workspace-policy.js";
import { SqliteWindowsWorkspacePolicyStore } from "./windows-workspace-policy-store.js";

// Build-only approval binding and bookkeeping. NOT an effect consumer. Physical
// custody, independent admission/review and worker lifecycle remain mandatory.
export const MANAGED_BUILDER_SUBJECT_VERSION = "agent-managed-builder-subject/v1" as const;
export const MANAGED_BUILDER_MAX_FRAME_BYTES = 4_194_304;
export const MANAGED_BUILDER_MAX_PATCH_SCAN_BYTES = 268_435_456;
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const exactTime = (v: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const subjectSchema = z.object({ schemaVersion: z.literal(MANAGED_BUILDER_SUBJECT_VERSION),
  operationId: uuid, workspaceDigest: digest,
  policyBinding: z.object({ storeId: uuid, revision: z.number().int().min(1).max(10_001), policyDigest: digest }).strict(),
  scope: builderTaskScopeSchema, plan: builderPatchPlanSchema }).strict();
export type ManagedBuilderSubject = Readonly<z.infer<typeof subjectSchema>>;
const frameSchema = z.object({ subject: subjectSchema, authorization: z.unknown() }).strict();
const workspaceSchema = z.object({ workspaceDigest: digest, repositoryRoot: z.string().min(1).max(2048),
  worktreeRoot: z.string().min(1).max(2048), worktreeAttestationDigest: digest }).strict();
type Workspace = Readonly<z.infer<typeof workspaceSchema>>;
export class ManagedBuilderApprovalError extends Error {
  constructor(public readonly reason: "invalid-request" | "unsupported-platform" | "workspace-mismatch"
    | "policy-denied" | "authorization-invalid" | "authorization-replayed" | "preimage-mismatch"
    | "patch-invalid" | "budget-exceeded" | "scope-expired" | "clock-invalid" | "recording-unconfirmed" | "busy") {
    super(`managed-builder-${reason}`); this.name = "ManagedBuilderApprovalError";
  }
}
const fail = (reason: ManagedBuilderApprovalError["reason"]): never => { throw new ManagedBuilderApprovalError(reason); };

/** Bounded data decoding only. This produces no approval or execution token. */
export function decodeManagedBuilderFrame(frame: Uint8Array): Readonly<z.infer<typeof frameSchema>> {
  if (!(frame instanceof Uint8Array) || frame.buffer instanceof SharedArrayBuffer
    || frame.byteLength < 2 || frame.byteLength > MANAGED_BUILDER_MAX_FRAME_BYTES) return fail("invalid-request");
  try {
    const bytes = Buffer.from(frame), text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const decoded = frameSchema.parse(JSON.parse(text));
    if (canonicalJson(decoded) !== text) return fail("invalid-request");
    return deepFreeze(decoded);
  } catch { return fail("invalid-request"); }
}

/** New version/domain only. Historical Builder target/signed bytes are unchanged.
 * There is deliberately no fallback to a lease over scope+plan alone.
 */
export function computeManagedBuilderTargetDigest(input: unknown): string {
  const parsed = subjectSchema.safeParse(input); if (!parsed.success) return fail("invalid-request");
  return canonicalSha256Digest({ domain: "agent-managed-builder-lease-target/v1", subject: parsed.data,
    builderWriteTargetDigest: computeBuilderWriteTargetDigest(parsed.data.scope, parsed.data.plan) });
}

export interface ManagedBuilderApprovalOptions {
  readonly authority: KernelLeaseAuthority;
  readonly expectedPlugin: unknown;
  /** Trusted host's selected workspace record, NOT a client attestation. This
   * module compares it but does not establish OS custody for it. */
  readonly workspace: Workspace;
  readonly policy: SqliteWindowsWorkspacePolicyStore;
  readonly recovery: SqliteWindowsBuilderRecoveryStore;
  readonly now?: () => string;
}

export class WindowsManagedBuilderApprovalRecorder {
  readonly #workspace: Workspace;
  readonly #plugin: z.infer<typeof pluginIdentitySchema>;
  readonly #authority: KernelLeaseAuthority;
  readonly #policy: SqliteWindowsWorkspacePolicyStore;
  readonly #journal: WindowsBuilderEffectJournal;
  readonly #now: () => string;
  #busy = false;

  constructor(options: ManagedBuilderApprovalOptions) {
    try {
      this.#workspace = deepFreeze(workspaceSchema.parse(options.workspace));
      this.#plugin = deepFreeze(pluginIdentitySchema.parse(options.expectedPlugin));
    } catch { throw new ManagedBuilderApprovalError("invalid-request"); }
    this.#authority = options.authority; this.#policy = options.policy;
    this.#journal = new WindowsBuilderEffectJournal(options.recovery, options.policy);
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  /** Records a verified lease-bound intent only. Returned journal data cannot
   * authorize a filesystem RPC. Production callers and external effects remain
   * forbidden pending the independent consumer/custody integration gate.
   */
  recordIntent(frame: Uint8Array, preimages: readonly RecoveryPreimage[]): BuilderEffectJournalReceipt {
    if (this.#busy) return fail("busy");
    if (process.platform !== "win32") return fail("unsupported-platform");
    this.#busy = true;
    try {
      const decoded = decodeManagedBuilderFrame(frame);
      const { subject, authorization } = decoded, { scope, plan } = subject;
      if (subject.workspaceDigest !== this.#workspace.workspaceDigest || scope.repositoryRoot !== this.#workspace.repositoryRoot
        || scope.worktreeRoot !== this.#workspace.worktreeRoot || scope.worktreeAttestationDigest !== this.#workspace.worktreeAttestationDigest)
        return fail("workspace-mismatch");
      if (!exactTime(scope.issuedAt) || !exactTime(scope.expiresAt) || plan.taskId !== scope.taskId
        || !scope.allowedVerificationIds.includes(plan.verificationId)
        || plan.patches.some(p => !scope.allowedWriteFiles.includes(p.relativePath))) return fail("patch-invalid");
      // Windows claim comparison uses exact spellings. Case aliases never replace
      // paths in signed bytes; policy preview only rejects/narrows lexical scope.
      const writable = [...scope.allowedWriteFiles].sort();
      if (writable.length === 0 || new Set(writable.map(p => p.toLowerCase())).size !== writable.length) return fail("patch-invalid");
      const operations = plan.patches.reduce((n, p) => n + p.operations.length, 0);
      if (operations > scope.maxPatchOperations) return fail("budget-exceeded");
      const expected = { sessionId: scope.sessionId, profileId: scope.profileId, capability: "bounded-file-write",
        targetDigest: computeManagedBuilderTargetDigest(subject), pluginId: this.#plugin.pluginId,
        pluginVersion: this.#plugin.version, pluginArtifactDigest: this.#plugin.artifactDigest, approvalRequired: true } as const;
      let lastTime = "";
      const verify = () => {
        const time = this.#now();
        if (!exactTime(time) || time < lastTime) return fail("clock-invalid"); lastTime = time;
        if (time < scope.issuedAt || time >= scope.expiresAt) return fail("scope-expired");
        const result = this.#authority.verify(authorization, expected, time);
        if (!result.valid || result.lease === undefined || result.lease.approvalId === undefined) return fail("authorization-invalid");
        if (this.#authority.isConsumed(result.lease.leaseId)) return fail("authorization-replayed");
        if (operations > result.lease.bounds.maxOperations || frame.byteLength > result.lease.bounds.maxInputBytes) return fail("budget-exceeded");
        return result.lease;
      };
      const lease = verify();
      const snapshot = this.#policy.snapshot();
      if (canonicalJson(snapshot.binding) !== canonicalJson(subject.policyBinding)) return fail("policy-denied");
      for (const relativePath of writable) {
        const access = previewWindowsWorkspaceAccess(snapshot.policy, { path: win32.join(scope.worktreeRoot, relativePath), operation: "write" });
        if (access.decision !== "requires-filesystem-validation") return fail("policy-denied");
      }
      if (!Array.isArray(preimages) || preimages.length !== writable.length) return fail("preimage-mismatch");
      let total = 0;
      const copied = preimages.map((f, i) => {
        if (!f || f.relativePath !== writable[i] || !(f.bytes instanceof Uint8Array) || f.bytes.buffer instanceof SharedArrayBuffer)
          return fail("preimage-mismatch");
        if (f.bytes.byteLength > scope.maxFileBytes || (total += f.bytes.byteLength) > scope.maxTotalBytes) return fail("budget-exceeded");
        return { relativePath: f.relativePath, bytes: Buffer.from(f.bytes) };
      });
      let outputBytes = total, scannedBytes = 0;
      for (const f of copied) {
        let text: string;
        try { text = decodeBuilderText(f.bytes); } catch { return fail("preimage-mismatch"); }
        if (containsSecretLikeContent(text)) return fail("preimage-mismatch");
        const patch = plan.patches.find(p => p.relativePath === f.relativePath);
        if (!patch) continue;
        if (sha256BuilderDigest(f.bytes) !== patch.expectedPreimageDigest) return fail("preimage-mismatch");
        for (const op of patch.operations) {
          const priorSize = Buffer.byteLength(text);
          if ((scannedBytes += priorSize) > MANAGED_BUILDER_MAX_PATCH_SCAN_BYTES) return fail("budget-exceeded");
          if (countExactOccurrences(text, op.before) !== 1) return fail("patch-invalid");
          const nextSize = priorSize - Buffer.byteLength(op.before) + Buffer.byteLength(op.after);
          if (nextSize > scope.maxFileBytes || outputBytes - f.bytes.byteLength + nextSize > scope.maxTotalBytes
            || outputBytes - f.bytes.byteLength + nextSize > lease.bounds.maxOutputBytes) return fail("budget-exceeded");
          text = replaceBuilderLiteral(text, op.before, op.after);
        }
        if (containsSecretLikeContent(text)) return fail("patch-invalid");
        const size = Buffer.byteLength(text); outputBytes += size - f.bytes.byteLength;
        if (size > scope.maxFileBytes || outputBytes > scope.maxTotalBytes || outputBytes > lease.bounds.maxOutputBytes) return fail("budget-exceeded");
      }
      if (outputBytes > lease.bounds.maxOutputBytes) return fail("budget-exceeded");
      verify(); // Recheck expiry/revocation after bounded decoding/hashing work.
      this.#policy.assertCurrentBinding(subject.policyBinding);
      const receipt = this.#journal.recordStart({ operationId: subject.operationId,
        taskDigest: canonicalSha256Digest({ taskId: scope.taskId, sessionId: scope.sessionId, profileId: scope.profileId }),
        proposalDigest: expected.targetDigest, workspaceDigest: subject.workspaceDigest,
        scopeDigest: computeBuilderInspectionScopeDigest(scope), policyBinding: subject.policyBinding,
        // Stable across lease reissue and process/key rotation in this recovery
        // store. It DOES NOT unify historical admission stores automatically.
        authorizationDigest: canonicalSha256Digest({ domain: "agent-managed-builder-approval-id/v1", approvalId: lease.approvalId }),
      }, copied);
      verify(); // Failure here retains the durable blockers; never erase/retry.
      if (!this.#authority.consume(lease.leaseId)) return fail("authorization-replayed");
      return receipt;
    } catch (error) {
      if (error instanceof ManagedBuilderApprovalError) throw error;
      return fail("recording-unconfirmed");
    } finally { this.#busy = false; }
  }
}
