import { deepFreeze } from "../validation/deep-freeze.js";
import {
  parseActionProposal,
  parseApprovalEvidence,
  parseCapabilityLease,
  parseExecutionResult,
  parsePolicyDecision,
} from "./schemas.js";
import {
  KERNEL_CONTRACT_VERSION,
} from "./types.js";
import type {
  ActionEffectClass,
  ActionProposal,
  ApprovalEvidence,
  ApprovalLevel,
  CapabilityLease,
  ExecutionBounds,
  ExecutionResult,
  LeaseIssuanceContext,
  PolicyDecision,
  PolicyEvaluationContext,
  PolicyReasonCode,
} from "./types.js";

const APPROVAL_RANK: Readonly<Record<ApprovalLevel, number>> = deepFreeze({
  none: 0,
  standard: 1,
  elevated: 2,
  critical: 3,
});

const KERNEL_MINIMUM_APPROVAL: Readonly<Record<ActionEffectClass, ApprovalLevel>> = deepFreeze({
  pure: "none",
  read: "none",
  write: "standard",
  communications: "standard",
  destructive: "critical",
  admin: "critical",
  lifecycle: "critical",
});

export class KernelAuthorizationError extends Error {
  public constructor(public readonly reasonCode: PolicyReasonCode) {
    super(reasonCode);
    this.name = "KernelAuthorizationError";
  }
}

function minimumBounds(requested: ExecutionBounds, maximums: ExecutionBounds): ExecutionBounds {
  return deepFreeze({
    timeoutMs: Math.min(requested.timeoutMs, maximums.timeoutMs),
    maxOperations: Math.min(requested.maxOperations, maximums.maxOperations),
    maxInputBytes: Math.min(requested.maxInputBytes, maximums.maxInputBytes),
    maxOutputBytes: Math.min(requested.maxOutputBytes, maximums.maxOutputBytes),
  });
}

function stricterApproval(first: ApprovalLevel, second: ApprovalLevel): ApprovalLevel {
  return APPROVAL_RANK[first] >= APPROVAL_RANK[second] ? first : second;
}

function decision(
  context: PolicyEvaluationContext,
  proposalId: string,
  effectiveBounds: ExecutionBounds,
  requiredApproval: ApprovalLevel,
  outcome: PolicyDecision["outcome"],
  reasonCode: PolicyReasonCode,
): PolicyDecision {
  return parsePolicyDecision({
    schemaVersion: KERNEL_CONTRACT_VERSION,
    decisionId: context.decisionId,
    proposalId,
    outcome,
    reasonCode,
    effectiveBounds,
    requiredApproval,
    policyVersion: context.policyVersion,
    evaluatedAt: context.evaluatedAt,
  });
}

export function evaluateActionProposal(input: unknown, context: PolicyEvaluationContext): PolicyDecision {
  const invalidBounds = minimumBounds(context.kernelMaximums, context.kernelMaximums);
  let proposal: ActionProposal;
  try {
    proposal = parseActionProposal(input);
  } catch {
    return decision(context, "invalid-proposal", invalidBounds, "critical", "deny", "invalid-proposal");
  }

  const effectiveBounds = minimumBounds(proposal.requestedBounds, context.kernelMaximums);
  const requiredApproval = stricterApproval(proposal.requiredApproval, KERNEL_MINIMUM_APPROVAL[proposal.effect]);

  if (!context.effectiveCapabilities.includes(proposal.capability)) {
    return decision(context, proposal.proposalId, effectiveBounds, requiredApproval, "deny", "capability-not-effective");
  }

  const pinned = context.pinnedPlugins.find((plugin) => plugin.pluginId === proposal.plugin.pluginId);
  if (pinned === undefined) {
    return decision(context, proposal.proposalId, effectiveBounds, requiredApproval, "deny", "plugin-not-pinned");
  }

  if (pinned.version !== proposal.plugin.version || pinned.artifactDigest !== proposal.plugin.artifactDigest) {
    return decision(context, proposal.proposalId, effectiveBounds, requiredApproval, "deny", "plugin-identity-mismatch");
  }

  if (!context.allowedEffects.includes(proposal.effect)) {
    return decision(context, proposal.proposalId, effectiveBounds, requiredApproval, "deny", "effect-not-allowed");
  }

  if (!["pure", "read"].includes(proposal.effect) && proposal.rollback.strategy === "none") {
    return decision(context, proposal.proposalId, effectiveBounds, requiredApproval, "deny", "rollback-required");
  }

  if (requiredApproval !== "none") {
    return decision(context, proposal.proposalId, effectiveBounds, requiredApproval, "approval-required", "approval-required");
  }

  return decision(context, proposal.proposalId, effectiveBounds, requiredApproval, "allow", "allowed");
}

function validApproval(
  proposal: ActionProposal,
  policyDecision: PolicyDecision,
  approval: ApprovalEvidence | undefined,
  issuedAt: string,
): PolicyReasonCode | undefined {
  if (policyDecision.requiredApproval === "none") return undefined;
  if (approval === undefined) return "approval-missing";
  if (approval.proposalId !== proposal.proposalId || approval.decisionId !== policyDecision.decisionId) return "approval-invalid";
  if (APPROVAL_RANK[approval.level] < APPROVAL_RANK[policyDecision.requiredApproval]) return "approval-invalid";
  if (Date.parse(approval.approvedAt) > Date.parse(issuedAt)) return "approval-invalid";
  if (Date.parse(approval.expiresAt) <= Date.parse(issuedAt)) return "approval-expired";
  return undefined;
}

export function issueCapabilityLease(
  proposalInput: unknown,
  decisionInput: unknown,
  issuance: LeaseIssuanceContext,
  approvalInput?: unknown,
): CapabilityLease {
  const proposal = parseActionProposal(proposalInput);
  const policyDecision = parsePolicyDecision(decisionInput);
  if (policyDecision.proposalId !== proposal.proposalId) throw new KernelAuthorizationError("approval-invalid");
  if (policyDecision.outcome === "deny") throw new KernelAuthorizationError(policyDecision.reasonCode);
  const minimumApproval = stricterApproval(proposal.requiredApproval, KERNEL_MINIMUM_APPROVAL[proposal.effect]);
  if (APPROVAL_RANK[policyDecision.requiredApproval] < APPROVAL_RANK[minimumApproval]) {
    throw new KernelAuthorizationError("approval-invalid");
  }
  if (minimumApproval !== "none" && policyDecision.outcome !== "approval-required") {
    throw new KernelAuthorizationError("approval-invalid");
  }
  const bounds = policyDecision.effectiveBounds;
  if (bounds.timeoutMs > proposal.requestedBounds.timeoutMs
    || bounds.maxOperations > proposal.requestedBounds.maxOperations
    || bounds.maxInputBytes > proposal.requestedBounds.maxInputBytes
    || bounds.maxOutputBytes > proposal.requestedBounds.maxOutputBytes) {
    throw new KernelAuthorizationError("budget-exceeded");
  }
  const issuedAtMs = Date.parse(issuance.issuedAt);
  if (!Number.isFinite(issuedAtMs) || Date.parse(policyDecision.evaluatedAt) > issuedAtMs) {
    throw new KernelAuthorizationError("approval-invalid");
  }

  let approval: ApprovalEvidence | undefined;
  if (approvalInput !== undefined) approval = parseApprovalEvidence(approvalInput);
  const approvalFailure = validApproval(proposal, policyDecision, approval, issuance.issuedAt);
  if (approvalFailure !== undefined) throw new KernelAuthorizationError(approvalFailure);

  const expiresAt = new Date(Date.parse(issuance.issuedAt) + policyDecision.effectiveBounds.timeoutMs).toISOString();
  const base = {
    schemaVersion: KERNEL_CONTRACT_VERSION,
    leaseId: issuance.leaseId,
    proposalId: proposal.proposalId,
    decisionId: policyDecision.decisionId,
    sessionId: proposal.sessionId,
    actorId: proposal.actorId,
    profileId: proposal.profileId,
    capability: proposal.capability,
    plugin: proposal.plugin,
    targetDigest: issuance.targetDigest,
    bounds: policyDecision.effectiveBounds,
    issuedAt: issuance.issuedAt,
    expiresAt,
  } as const;

  return parseCapabilityLease(approval === undefined ? base : { ...base, approvalId: approval.approvalId });
}

export interface ExecutionVerification {
  readonly valid: boolean;
  readonly reasonCode: "verified" | "result-contract-mismatch" | "budget-exceeded" | "lease-expired" | "lease-revoked";
  readonly result?: ExecutionResult;
}

export function verifyExecutionResult(
  proposalInput: unknown,
  lease: CapabilityLease,
  resultInput: unknown,
  verifiedAt: string,
): ExecutionVerification {
  if (lease.revokedAt !== undefined && Date.parse(lease.revokedAt) <= Date.parse(verifiedAt)) {
    return deepFreeze({ valid: false, reasonCode: "lease-revoked" });
  }
  if (Date.parse(lease.expiresAt) <= Date.parse(verifiedAt)) {
    return deepFreeze({ valid: false, reasonCode: "lease-expired" });
  }

  let proposal: ActionProposal;
  let result: ExecutionResult;
  try {
    proposal = parseActionProposal(proposalInput);
    result = parseExecutionResult(resultInput);
  } catch {
    return deepFreeze({ valid: false, reasonCode: "result-contract-mismatch" });
  }

  if (result.leaseId !== lease.leaseId || result.resultSchemaId !== proposal.expectedResult.schemaId) {
    return deepFreeze({ valid: false, reasonCode: "result-contract-mismatch" });
  }

  const maximumOutput = Math.min(lease.bounds.maxOutputBytes, proposal.expectedResult.maxBytes);
  if (result.outputBytes > maximumOutput || result.operations > lease.bounds.maxOperations || result.elapsedMs > lease.bounds.timeoutMs) {
    return deepFreeze({ valid: false, reasonCode: "budget-exceeded" });
  }

  return deepFreeze({ valid: true, reasonCode: "verified", result });
}
