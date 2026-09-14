import { performance } from "node:perf_hooks";
import { deepFreeze } from "../validation/deep-freeze.js";
import { pluginIdentitySchema } from "../kernel/index.js";
import type { KernelLeaseAuthority, PluginIdentity } from "../kernel/index.js";
import { DenyingBuilderWorktreeAttestor } from "./attestation.js";
import type { BuilderWorktreeAttestor } from "./attestation.js";
import { containsSecretLikeContent, countExactOccurrences, decodeBuilderText, replaceBuilderLiteral, sha256BuilderDigest } from "./content-policy.js";
import { BuilderReadLimitError, LocalBuilderFileSystem } from "./filesystem.js";
import type { BuilderFileSystem } from "./filesystem.js";
import { BuilderBoundaryError, resolveExactBuilderFile, verifyIsolatedBuilderRoots } from "./path-policy.js";
import { parseBuilderPatchExecutionRequest, parseBuilderPatchPlan, parseBuilderTaskScope } from "./schemas.js";
import { BUILDER_CONTRACT_VERSION } from "./types.js";
import type {
  BuilderPatchExecutionRequest,
  BuilderPatchPlan,
  BuilderPatchReason,
  BuilderPatchResult,
  BuilderTaskScope,
  BuilderVerifier,
} from "./types.js";

const ZERO_DIGEST = `sha256:${"0".repeat(64)}`;
const SAFE_DIGEST = /^sha256:[a-f0-9]{64}$/;

interface Preimage {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly bytes: Uint8Array;
  readonly text: string;
  readonly digest: string;
}

function safeId(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value) ? value : fallback;
}

function scopeDigest(scope: BuilderTaskScope): string {
  return sha256BuilderDigest(JSON.stringify(scope));
}

function patchSetDigest(plan: BuilderPatchPlan): string {
  return sha256BuilderDigest(JSON.stringify(plan));
}

export function computeBuilderWriteTargetDigest(scopeInput: unknown, planInput: unknown): string {
  const scope = parseBuilderTaskScope(scopeInput);
  const plan = parseBuilderPatchPlan(planInput);
  return sha256BuilderDigest(JSON.stringify({ scopeDigest: scopeDigest(scope), patchSetDigest: patchSetDigest(plan) }));
}

function preimageSetDigest(preimages: ReadonlyMap<string, Preimage>): string {
  const entries = [...preimages.values()]
    .map((preimage) => ({ pathDigest: sha256BuilderDigest(preimage.relativePath), contentDigest: preimage.digest }))
    .sort((left, right) => left.pathDigest.localeCompare(right.pathDigest));
  return sha256BuilderDigest(JSON.stringify(entries));
}

export interface BuilderPatchExecutorOptions {
  readonly leaseAuthority: KernelLeaseAuthority;
  readonly expectedPlugin: PluginIdentity;
  readonly verifier: BuilderVerifier;
  readonly worktreeAttestor?: BuilderWorktreeAttestor;
  readonly filesystem?: BuilderFileSystem;
  readonly now?: () => string;
}

export class BuilderPatchExecutor {
  readonly #leaseAuthority: KernelLeaseAuthority;
  readonly #expectedPlugin: PluginIdentity;
  readonly #verifier: BuilderVerifier;
  readonly #worktreeAttestor: BuilderWorktreeAttestor;
  readonly #filesystem: BuilderFileSystem;
  readonly #now: () => string;

  public constructor(options: BuilderPatchExecutorOptions) {
    this.#leaseAuthority = options.leaseAuthority;
    this.#expectedPlugin = deepFreeze(pluginIdentitySchema.parse(options.expectedPlugin)) as PluginIdentity;
    this.#verifier = options.verifier;
    this.#worktreeAttestor = options.worktreeAttestor ?? new DenyingBuilderWorktreeAttestor();
    this.#filesystem = options.filesystem ?? new LocalBuilderFileSystem();
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  public async execute(scopeInput: unknown, requestInput: unknown): Promise<BuilderPatchResult> {
    let scope: BuilderTaskScope;
    try {
      scope = parseBuilderTaskScope(scopeInput);
    } catch {
      return this.#receipt("invalid-task", "invalid-plan", "invalid-lease", "invalid-scope");
    }
    const resolvedScopeDigest = scopeDigest(scope);
    let request: BuilderPatchExecutionRequest;
    let plan: BuilderPatchPlan;
    try {
      request = parseBuilderPatchExecutionRequest(requestInput);
      plan = parseBuilderPatchPlan(request.plan);
    } catch {
      return this.#receipt(scope.taskId, "invalid-plan", "invalid-lease", "invalid-plan", resolvedScopeDigest);
    }
    const resolvedPatchDigest = patchSetDigest(plan);
    const operationCount = plan.patches.reduce((total, patch) => total + patch.operations.length, 0);
    const planInputBytes = new TextEncoder().encode(JSON.stringify(plan)).byteLength;
    if (plan.taskId !== scope.taskId
      || !scope.allowedVerificationIds.includes(plan.verificationId)
      || plan.patches.some((patch) => !scope.allowedWriteFiles.includes(patch.relativePath))
      || operationCount > scope.maxPatchOperations) {
      return this.#receipt(scope.taskId, plan.planId, "invalid-lease", "invalid-plan", resolvedScopeDigest, resolvedPatchDigest, ZERO_DIGEST, plan.verificationId);
    }
    const now = this.#now();
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs) || Date.parse(scope.issuedAt) > nowMs || Date.parse(scope.expiresAt) <= nowMs) {
      return this.#receipt(scope.taskId, plan.planId, "invalid-lease", "scope-not-active", resolvedScopeDigest, resolvedPatchDigest, ZERO_DIGEST, plan.verificationId);
    }

    const targetDigest = computeBuilderWriteTargetDigest(scope, plan);
    const leaseExpectation = {
      sessionId: scope.sessionId,
      profileId: scope.profileId,
      capability: "bounded-file-write",
      targetDigest,
      pluginId: this.#expectedPlugin.pluginId,
      pluginVersion: this.#expectedPlugin.version,
      pluginArtifactDigest: this.#expectedPlugin.artifactDigest,
      approvalRequired: true,
    } as const;
    const verification = this.#leaseAuthority.verify(request.authorization, leaseExpectation, now);
    if (!verification.valid || verification.lease === undefined) {
      return this.#receipt(scope.taskId, plan.planId, "invalid-lease", "authorization-invalid", resolvedScopeDigest, resolvedPatchDigest, ZERO_DIGEST, plan.verificationId);
    }
    const leaseId = verification.lease.leaseId;
    if (operationCount > verification.lease.bounds.maxOperations || planInputBytes > verification.lease.bounds.maxInputBytes) {
      return this.#receipt(scope.taskId, plan.planId, leaseId, "patch-budget-exceeded", resolvedScopeDigest, resolvedPatchDigest, ZERO_DIGEST, plan.verificationId);
    }
    if (this.#leaseAuthority.isConsumed(leaseId)) {
      return this.#receipt(scope.taskId, plan.planId, leaseId, "authorization-replayed", resolvedScopeDigest, resolvedPatchDigest, ZERO_DIGEST, plan.verificationId);
    }

    let roots;
    try {
      roots = await verifyIsolatedBuilderRoots(scope.repositoryRoot, scope.worktreeRoot, this.#filesystem);
    } catch (error) {
      const reason = error instanceof BuilderBoundaryError ? error.reasonCode : "worktree-not-isolated";
      return this.#receipt(scope.taskId, plan.planId, leaseId, reason === "symlink-rejected" ? "symlink-rejected" : "worktree-not-isolated", resolvedScopeDigest, resolvedPatchDigest, ZERO_DIGEST, plan.verificationId);
    }
    try {
      const attestation = await this.#worktreeAttestor.attest(roots.repositoryRoot, roots.worktreeRoot);
      if (!attestation.valid || attestation.attestationDigest !== scope.worktreeAttestationDigest || !SAFE_DIGEST.test(attestation.attestationDigest)) {
        return this.#receipt(scope.taskId, plan.planId, leaseId, "worktree-attestation-failed", resolvedScopeDigest, resolvedPatchDigest, ZERO_DIGEST, plan.verificationId);
      }
    } catch {
      return this.#receipt(scope.taskId, plan.planId, leaseId, "worktree-attestation-failed", resolvedScopeDigest, resolvedPatchDigest, ZERO_DIGEST, plan.verificationId);
    }

    const preimages = new Map<string, Preimage>();
    const resolvedPaths = new Set<string>();
    let totalBytes = 0;
    for (const relativePath of scope.allowedWriteFiles) {
      let absolutePath: string;
      try {
        absolutePath = await resolveExactBuilderFile(roots.worktreeRoot, relativePath, scope.allowedWriteFiles, this.#filesystem, { requireSingleLink: true });
        const comparisonPath = process.platform === "win32" ? absolutePath.toLowerCase() : absolutePath;
        if (resolvedPaths.has(comparisonPath)) throw new BuilderBoundaryError("path-unsafe");
        resolvedPaths.add(comparisonPath);
      } catch (error) {
        const reason = error instanceof BuilderBoundaryError ? error.reasonCode : "preimage-missing";
        const mapped: BuilderPatchReason = reason === "path-not-allowed" ? "path-not-allowed"
          : reason === "path-unsafe" ? "path-unsafe"
            : reason === "symlink-rejected" ? "symlink-rejected"
              : reason === "hardlink-rejected" ? "hardlink-rejected"
                : "preimage-missing";
        return this.#receipt(scope.taskId, plan.planId, leaseId, mapped, resolvedScopeDigest, resolvedPatchDigest, ZERO_DIGEST, plan.verificationId);
      }
      let bytes: Uint8Array;
      try {
        bytes = await this.#filesystem.read(absolutePath, Math.min(scope.maxFileBytes, scope.maxTotalBytes - totalBytes));
      } catch (error) {
        return this.#receipt(scope.taskId, plan.planId, leaseId, error instanceof BuilderReadLimitError ? "patch-budget-exceeded" : "preimage-missing", resolvedScopeDigest, resolvedPatchDigest, ZERO_DIGEST, plan.verificationId);
      }
      totalBytes += bytes.byteLength;
      if (bytes.byteLength > scope.maxFileBytes || totalBytes > scope.maxTotalBytes) {
        return this.#receipt(scope.taskId, plan.planId, leaseId, "patch-budget-exceeded", resolvedScopeDigest, resolvedPatchDigest, ZERO_DIGEST, plan.verificationId);
      }
      let text: string;
      try {
        text = decodeBuilderText(bytes);
      } catch {
        return this.#receipt(scope.taskId, plan.planId, leaseId, "binary-rejected", resolvedScopeDigest, resolvedPatchDigest, ZERO_DIGEST, plan.verificationId);
      }
      if (containsSecretLikeContent(text)) {
        return this.#receipt(scope.taskId, plan.planId, leaseId, "secret-content-rejected", resolvedScopeDigest, resolvedPatchDigest, ZERO_DIGEST, plan.verificationId);
      }
      preimages.set(relativePath, { relativePath, absolutePath, bytes: new Uint8Array(bytes), text, digest: sha256BuilderDigest(bytes) });
    }
    const resolvedPreimageDigest = preimageSetDigest(preimages);
    const outputs = new Map<string, Uint8Array>();
    let outputTotal = totalBytes;
    for (const patch of plan.patches) {
      const preimage = preimages.get(patch.relativePath);
      if (preimage === undefined) return this.#receipt(scope.taskId, plan.planId, leaseId, "preimage-missing", resolvedScopeDigest, resolvedPatchDigest, resolvedPreimageDigest, plan.verificationId);
      if (preimage.digest !== patch.expectedPreimageDigest) return this.#receipt(scope.taskId, plan.planId, leaseId, "preimage-mismatch", resolvedScopeDigest, resolvedPatchDigest, resolvedPreimageDigest, plan.verificationId);
      let result = preimage.text;
      for (const operation of patch.operations) {
        if (countExactOccurrences(result, operation.before) !== operation.expectedOccurrences) {
          return this.#receipt(scope.taskId, plan.planId, leaseId, "patch-context-mismatch", resolvedScopeDigest, resolvedPatchDigest, resolvedPreimageDigest, plan.verificationId);
        }
        result = replaceBuilderLiteral(result, operation.before, operation.after);
      }
      if (containsSecretLikeContent(result)) return this.#receipt(scope.taskId, plan.planId, leaseId, "secret-content-rejected", resolvedScopeDigest, resolvedPatchDigest, resolvedPreimageDigest, plan.verificationId);
      const bytes = new TextEncoder().encode(result);
      outputTotal += bytes.byteLength - preimage.bytes.byteLength;
      if (bytes.byteLength > scope.maxFileBytes || outputTotal > scope.maxTotalBytes || outputTotal > verification.lease.bounds.maxOutputBytes) {
        return this.#receipt(scope.taskId, plan.planId, leaseId, "patch-budget-exceeded", resolvedScopeDigest, resolvedPatchDigest, resolvedPreimageDigest, plan.verificationId);
      }
      outputs.set(patch.relativePath, bytes);
    }

    for (const patch of plan.patches) {
      const preimage = preimages.get(patch.relativePath)!;
      let current: Uint8Array;
      try {
        const checkedPath = await resolveExactBuilderFile(roots.worktreeRoot, patch.relativePath, scope.allowedWriteFiles, this.#filesystem, { requireSingleLink: true });
        // Equal bytes at a newly resolved path are not evidence for the path
        // whose preimage we captured and will write. Deny before consumption.
        // This does not pin physical identity across the later write interval.
        if (checkedPath !== preimage.absolutePath) throw new BuilderBoundaryError("path-unsafe");
        current = await this.#filesystem.read(checkedPath, preimage.bytes.byteLength);
      } catch {
        return this.#receipt(scope.taskId, plan.planId, leaseId, "preimage-mismatch", resolvedScopeDigest, resolvedPatchDigest, resolvedPreimageDigest, plan.verificationId);
      }
      if (sha256BuilderDigest(current) !== preimage.digest) {
        return this.#receipt(scope.taskId, plan.planId, leaseId, "preimage-mismatch", resolvedScopeDigest, resolvedPatchDigest, resolvedPreimageDigest, plan.verificationId);
      }
    }

    const effectAt = this.#now();
    const effectAtMs = Date.parse(effectAt);
    if (!Number.isFinite(effectAtMs) || Date.parse(scope.issuedAt) > effectAtMs || Date.parse(scope.expiresAt) <= effectAtMs) {
      return this.#receipt(scope.taskId, plan.planId, leaseId, "scope-not-active", resolvedScopeDigest, resolvedPatchDigest, resolvedPreimageDigest, plan.verificationId);
    }
    const effectVerification = this.#leaseAuthority.verify(request.authorization, leaseExpectation, effectAt);
    if (!effectVerification.valid || effectVerification.lease?.leaseId !== leaseId) {
      return this.#receipt(scope.taskId, plan.planId, leaseId, "authorization-invalid", resolvedScopeDigest, resolvedPatchDigest, resolvedPreimageDigest, plan.verificationId);
    }
    if (!this.#leaseAuthority.consume(leaseId)) {
      return this.#receipt(scope.taskId, plan.planId, leaseId, "authorization-replayed", resolvedScopeDigest, resolvedPatchDigest, resolvedPreimageDigest, plan.verificationId);
    }
    const changed: Preimage[] = [];
    try {
      for (const patch of plan.patches) {
        const preimage = preimages.get(patch.relativePath)!;
        changed.push(preimage);
        await this.#filesystem.write(preimage.absolutePath, outputs.get(patch.relativePath)!);
      }
    } catch {
      const restored = await this.#restore([...preimages.values()], changed);
      return this.#receipt(scope.taskId, plan.planId, leaseId, restored ? "write-failed" : "restoration-failed", resolvedScopeDigest, resolvedPatchDigest, resolvedPreimageDigest, plan.verificationId, changed.length, "not-run", restored);
    }
    if (!await this.#matchesExpected(preimages, outputs)) {
      const restored = await this.#restore([...preimages.values()], changed);
      return this.#receipt(scope.taskId, plan.planId, leaseId, restored ? "write-failed" : "restoration-failed", resolvedScopeDigest, resolvedPatchDigest, resolvedPreimageDigest, plan.verificationId, changed.length, "not-run", restored);
    }

    const controller = new AbortController();
    const remainingLeaseMs = Date.parse(effectVerification.lease.expiresAt) - effectAtMs;
    const remainingScopeMs = Date.parse(scope.expiresAt) - effectAtMs;
    const verificationTimeoutMs = Math.max(1, Math.min(effectVerification.lease.bounds.timeoutMs, remainingLeaseMs, remainingScopeMs));
    const verificationStarted = performance.now();
    const timedOut = (): boolean => controller.signal.aborted || performance.now() - verificationStarted >= verificationTimeoutMs;
    const timeout = setTimeout(() => controller.abort(), verificationTimeoutMs);
    let passed = false;
    try {
      // Abort requests cancellation; it does not prove that I/O has stopped.
      // Never race ahead into rollback while the verifier can still write.
      // A host runner must bound termination and settle only after quiescence.
      const result = await this.#verifier.verify(roots.worktreeRoot, plan.verificationId, controller.signal);
      passed = !timedOut() && result.passed && SAFE_DIGEST.test(result.resultDigest)
        && await this.#matchesExpected(preimages, outputs) && !timedOut();
    } catch {
      passed = false;
    } finally {
      clearTimeout(timeout);
    }
    if (!passed) {
      const restored = await this.#restore([...preimages.values()]);
      return this.#receipt(scope.taskId, plan.planId, leaseId, restored ? "verification-failed" : "restoration-failed", resolvedScopeDigest, resolvedPatchDigest, resolvedPreimageDigest, plan.verificationId, changed.length, "failed", restored);
    }

    return this.#receipt(scope.taskId, plan.planId, leaseId, "completed", resolvedScopeDigest, resolvedPatchDigest, resolvedPreimageDigest, plan.verificationId, changed.length, "passed", false);
  }

  async #matchesExpected(preimages: ReadonlyMap<string, Preimage>, outputs: ReadonlyMap<string, Uint8Array>): Promise<boolean> {
    try {
      for (const preimage of preimages.values()) {
        const expected = outputs.get(preimage.relativePath) ?? preimage.bytes;
        const current = await this.#filesystem.read(preimage.absolutePath, expected.byteLength);
        if (sha256BuilderDigest(current) !== sha256BuilderDigest(expected)) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  async #restore(preimages: readonly Preimage[], attempted: readonly Preimage[] = preimages): Promise<boolean> {
    // Before verification starts, only attempted patches can need our writes
    // undone. The failed write itself is included: it may have partially written.
    // Still check the full preimage set; an unrelated change is quarantine, not
    // permission to overwrite a file we never attempted to change.
    let complete = true;
    for (const preimage of attempted) {
      try { await this.#filesystem.write(preimage.absolutePath, preimage.bytes); }
      catch { complete = false; }
    }
    // A failure on one target must not abandon independent remaining restores
    // or skip read-back. Any write/read failure keeps the result quarantined,
    // even if a failed write happened to leave matching bytes behind.
    for (const preimage of preimages) {
      try {
        const restored = await this.#filesystem.read(preimage.absolutePath, preimage.bytes.byteLength);
        if (sha256BuilderDigest(restored) !== preimage.digest) complete = false;
      } catch { complete = false; }
    }
    return complete;
  }

  #receipt(
    taskId: string,
    planId: string,
    leaseId: string,
    reasonCode: BuilderPatchReason,
    resolvedScopeDigest = ZERO_DIGEST,
    resolvedPatchDigest = ZERO_DIGEST,
    resolvedPreimageDigest = ZERO_DIGEST,
    verificationId = "not-run",
    changedFiles = 0,
    verificationStatus: "not-run" | "passed" | "failed" = "not-run",
    restored = false,
  ): BuilderPatchResult {
    const outcome = reasonCode === "completed" ? "completed"
      : reasonCode === "restoration-failed" ? "quarantined"
        : ["write-failed", "verification-failed"].includes(reasonCode) ? "failed"
          : "denied";
    return deepFreeze({
      receipt: {
        contractVersion: BUILDER_CONTRACT_VERSION,
        taskId: safeId(taskId, "invalid-task"),
        planId: safeId(planId, "invalid-plan"),
        leaseId: safeId(leaseId, "invalid-lease"),
        outcome,
        reasonCode,
        scopeDigest: resolvedScopeDigest,
        patchSetDigest: resolvedPatchDigest,
        preimageSetDigest: resolvedPreimageDigest,
        changedFiles,
        verificationId: safeId(verificationId, "not-run"),
        verificationStatus,
        restored,
        completedAt: this.#now(),
      },
    });
  }
}
