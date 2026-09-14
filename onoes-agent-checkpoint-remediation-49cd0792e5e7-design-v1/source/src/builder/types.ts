export const BUILDER_CONTRACT_VERSION = "1.1.0" as const;

export interface BuilderTaskScope {
  readonly contractVersion: typeof BUILDER_CONTRACT_VERSION;
  readonly taskId: string;
  readonly sessionId: string;
  readonly profileId: "builder" | "kitchen-sink";
  readonly repositoryRoot: string;
  readonly worktreeRoot: string;
  readonly worktreeAttestationDigest: string;
  readonly allowedReadFiles: readonly string[];
  readonly allowedWriteFiles: readonly string[];
  readonly allowedVerificationIds: readonly string[];
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly maxPatchOperations: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface BuilderInspectionRequest {
  readonly taskId: string;
  readonly requestedFiles: readonly string[];
}

export interface BuilderInspectedFile {
  readonly relativePath: string;
  readonly content: string;
  readonly contentDigest: string;
  readonly bytes: number;
  readonly lines: number;
  readonly imports: readonly string[];
  readonly testNames: readonly string[];
}

export type BuilderInspectionReason =
  | "completed"
  | "invalid-scope"
  | "invalid-request"
  | "scope-not-active"
  | "worktree-not-isolated"
  | "path-not-allowed"
  | "path-unsafe"
  | "symlink-rejected"
  | "hardlink-rejected"
  | "file-missing"
  | "binary-rejected"
  | "secret-content-rejected"
  | "file-too-large"
  | "total-budget-exceeded"
  | "read-failed";

export interface BuilderInspectionReceipt {
  readonly contractVersion: typeof BUILDER_CONTRACT_VERSION;
  readonly taskId: string;
  readonly outcome: "completed" | "denied" | "failed";
  readonly reasonCode: BuilderInspectionReason;
  readonly scopeDigest: string;
  readonly filePathDigests: readonly string[];
  readonly totalBytes: number;
  readonly completedAt: string;
}

export interface BuilderInspectionResult {
  readonly receipt: BuilderInspectionReceipt;
  readonly files?: readonly BuilderInspectedFile[];
}

export interface BuilderReplaceExactOperation {
  readonly operation: "replace-exact";
  readonly before: string;
  readonly after: string;
  readonly expectedOccurrences: 1;
}

export interface BuilderFilePatch {
  readonly relativePath: string;
  readonly expectedPreimageDigest: string;
  readonly operations: readonly BuilderReplaceExactOperation[];
}

export interface BuilderPatchPlan {
  readonly contractVersion: typeof BUILDER_CONTRACT_VERSION;
  readonly planId: string;
  readonly taskId: string;
  readonly verificationId: string;
  readonly patches: readonly BuilderFilePatch[];
}

export interface BuilderPatchExecutionRequest {
  readonly plan: unknown;
  readonly authorization: unknown;
}

export type BuilderPatchReason =
  | "completed"
  | "invalid-scope"
  | "invalid-plan"
  | "scope-not-active"
  | "authorization-invalid"
  | "authorization-replayed"
  | "worktree-not-isolated"
  | "worktree-attestation-failed"
  | "path-not-allowed"
  | "path-unsafe"
  | "symlink-rejected"
  | "hardlink-rejected"
  | "preimage-missing"
  | "preimage-mismatch"
  | "binary-rejected"
  | "secret-content-rejected"
  | "patch-context-mismatch"
  | "patch-budget-exceeded"
  | "write-failed"
  | "verification-failed"
  | "restoration-failed";

export interface BuilderPatchReceipt {
  readonly contractVersion: typeof BUILDER_CONTRACT_VERSION;
  readonly taskId: string;
  readonly planId: string;
  readonly leaseId: string;
  readonly outcome: "completed" | "denied" | "failed" | "quarantined";
  readonly reasonCode: BuilderPatchReason;
  readonly scopeDigest: string;
  readonly patchSetDigest: string;
  readonly preimageSetDigest: string;
  readonly changedFiles: number;
  readonly verificationId: string;
  readonly verificationStatus: "not-run" | "passed" | "failed";
  readonly restored: boolean;
  readonly completedAt: string;
}

export interface BuilderPatchResult {
  readonly receipt: BuilderPatchReceipt;
}

export interface BuilderVerificationResult {
  readonly passed: boolean;
  readonly resultDigest: string;
}

export interface BuilderVerifier {
  // Trusted runner contract: settle only after all related I/O and descendants
  // have stopped. Abort is a cancellation request, not proof of quiescence.
  // No detached work. Production runners must enforce bounded termination;
  // the executor cannot safely roll back while an unsettled verifier may write.
  verify(worktreeRoot: string, verificationId: string, signal: AbortSignal): Promise<BuilderVerificationResult>;
}
