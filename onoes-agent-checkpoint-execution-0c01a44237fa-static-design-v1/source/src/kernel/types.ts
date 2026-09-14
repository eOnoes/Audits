import type { ProfileId } from "../profiles/types.js";

export const KERNEL_CONTRACT_VERSION = "1.1.0" as const;

export const ACTION_EFFECT_CLASSES = [
  "pure",
  "read",
  "write",
  "destructive",
  "communications",
  "admin",
  "lifecycle",
] as const;
export type ActionEffectClass = (typeof ACTION_EFFECT_CLASSES)[number];

export const APPROVAL_LEVELS = ["none", "standard", "elevated", "critical"] as const;
export type ApprovalLevel = (typeof APPROVAL_LEVELS)[number];

export const POLICY_OUTCOMES = ["allow", "deny", "approval-required"] as const;
export type PolicyOutcome = (typeof POLICY_OUTCOMES)[number];

export const POLICY_REASON_CODES = [
  "allowed",
  "approval-required",
  "invalid-proposal",
  "unknown-capability",
  "capability-not-effective",
  "plugin-not-pinned",
  "plugin-identity-mismatch",
  "effect-not-allowed",
  "rollback-required",
  "approval-missing",
  "approval-invalid",
  "approval-expired",
  "result-contract-mismatch",
  "budget-exceeded",
  "lease-expired",
  "lease-revoked",
] as const;
export type PolicyReasonCode = (typeof POLICY_REASON_CODES)[number];

export interface ExecutionBounds {
  readonly timeoutMs: number;
  readonly maxOperations: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
}

export interface PluginIdentity {
  readonly pluginId: string;
  readonly version: string;
  readonly artifactDigest: string;
}

export interface ActionTarget {
  readonly resourceType: string;
  readonly normalizedRef: string;
}

export interface ExpectedResultContract {
  readonly schemaId: string;
  readonly maxBytes: number;
}

export interface RollbackPlan {
  readonly strategy: "none" | "restore-preimage" | "compensate" | "control-managed";
  readonly verificationRef?: string;
}

export interface ActionProposal {
  readonly schemaVersion: typeof KERNEL_CONTRACT_VERSION;
  readonly proposalId: string;
  readonly sessionId: string;
  readonly actorId: string;
  readonly profileId: ProfileId;
  readonly capability: string;
  readonly plugin: PluginIdentity;
  readonly effect: ActionEffectClass;
  readonly target: ActionTarget;
  readonly input: unknown;
  readonly requiredApproval: ApprovalLevel;
  readonly requestedBounds: ExecutionBounds;
  readonly expectedResult: ExpectedResultContract;
  readonly rollback: RollbackPlan;
}

export interface PolicyDecision {
  readonly schemaVersion: typeof KERNEL_CONTRACT_VERSION;
  readonly decisionId: string;
  readonly proposalId: string;
  readonly outcome: PolicyOutcome;
  readonly reasonCode: PolicyReasonCode;
  readonly effectiveBounds: ExecutionBounds;
  readonly requiredApproval: ApprovalLevel;
  readonly policyVersion: string;
  readonly evaluatedAt: string;
}

export interface ApprovalRequest {
  readonly schemaVersion: typeof KERNEL_CONTRACT_VERSION;
  readonly requestId: string;
  readonly proposalId: string;
  readonly decisionId: string;
  readonly requiredLevel: Exclude<ApprovalLevel, "none">;
  readonly summaryCode: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
}

export interface ApprovalEvidence {
  readonly schemaVersion: typeof KERNEL_CONTRACT_VERSION;
  readonly approvalId: string;
  readonly proposalId: string;
  readonly decisionId: string;
  readonly level: Exclude<ApprovalLevel, "none">;
  readonly approvedByHash: string;
  readonly approvedAt: string;
  readonly expiresAt: string;
}

export interface CapabilityLease {
  readonly schemaVersion: typeof KERNEL_CONTRACT_VERSION;
  readonly leaseId: string;
  readonly proposalId: string;
  readonly decisionId: string;
  readonly sessionId: string;
  readonly actorId: string;
  readonly profileId: ProfileId;
  readonly capability: string;
  readonly plugin: PluginIdentity;
  readonly targetDigest: string;
  readonly bounds: ExecutionBounds;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly approvalId?: string;
  readonly revokedAt?: string;
}

export interface ExecutionResult {
  readonly schemaVersion: typeof KERNEL_CONTRACT_VERSION;
  readonly leaseId: string;
  readonly outcome: "succeeded" | "failed" | "cancelled" | "timed-out";
  readonly resultSchemaId: string;
  readonly resultDigest: string;
  readonly outputBytes: number;
  readonly operations: number;
  readonly elapsedMs: number;
  readonly rollbackApplied: boolean;
  readonly reasonCode?: string;
}

export interface ExecutionReceipt {
  readonly schemaVersion: typeof KERNEL_CONTRACT_VERSION;
  readonly receiptId: string;
  readonly proposalId: string;
  readonly decisionId: string;
  readonly leaseId: string;
  readonly capability: string;
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly targetDigest: string;
  readonly policyOutcome: PolicyOutcome;
  readonly executionOutcome: ExecutionResult["outcome"];
  readonly resultDigest: string;
  readonly rollbackApplied: boolean;
  readonly reasonCode: string;
  readonly completedAt: string;
}

export interface CapabilityDescriptor {
  readonly schemaVersion: typeof KERNEL_CONTRACT_VERSION;
  readonly capability: string;
  readonly plugin: PluginIdentity;
  readonly effects: readonly ActionEffectClass[];
  readonly profiles: readonly ProfileId[];
  readonly maximumBounds: ExecutionBounds;
  readonly requiresRollback: boolean;
}

export interface EffectiveCapabilitySnapshot {
  readonly schemaVersion: typeof KERNEL_CONTRACT_VERSION;
  readonly snapshotId: string;
  readonly profileId: ProfileId;
  readonly policyVersion: string;
  readonly capabilities: readonly CapabilityDescriptor[];
  readonly deniedCapabilities: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface PinnedPlugin {
  readonly pluginId: string;
  readonly version: string;
  readonly artifactDigest: string;
}

export interface PolicyEvaluationContext {
  readonly policyVersion: string;
  readonly decisionId: string;
  readonly evaluatedAt: string;
  readonly effectiveCapabilities: readonly string[];
  readonly allowedEffects: readonly ActionEffectClass[];
  readonly pinnedPlugins: readonly PinnedPlugin[];
  readonly kernelMaximums: ExecutionBounds;
}

export interface LeaseIssuanceContext {
  readonly leaseId: string;
  readonly issuedAt: string;
  readonly targetDigest: string;
}
