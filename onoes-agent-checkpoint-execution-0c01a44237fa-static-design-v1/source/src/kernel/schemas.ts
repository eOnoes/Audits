import { deepFreeze } from "../validation/deep-freeze.js";
import { canonicalizeJsonValue } from "../validation/json-value.js";
import { z } from "zod";
import { PROFILE_IDS } from "../profiles/types.js";
import {
  ACTION_EFFECT_CLASSES,
  APPROVAL_LEVELS,
  KERNEL_CONTRACT_VERSION,
  POLICY_OUTCOMES,
  POLICY_REASON_CODES,
} from "./types.js";
import type {
  ActionProposal,
  ApprovalEvidence,
  ApprovalRequest,
  CapabilityDescriptor,
  CapabilityLease,
  EffectiveCapabilitySnapshot,
  ExecutionReceipt,
  ExecutionResult,
  PolicyDecision,
} from "./types.js";

const stableId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const safeCode = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
const semver = z.string().regex(/^\d+\.\d+\.\d+$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const dateTime = z.string().datetime({ offset: true });
const capabilityId = z.string().regex(/^[a-z][a-z0-9.-]{0,127}$/);

export const executionBoundsSchema = z.object({
  timeoutMs: z.number().int().positive().max(86_400_000),
  maxOperations: z.number().int().positive().max(1_000_000),
  maxInputBytes: z.number().int().nonnegative().max(1_073_741_824),
  maxOutputBytes: z.number().int().nonnegative().max(1_073_741_824),
}).strict();

export const pluginIdentitySchema = z.object({
  pluginId: stableId,
  version: semver,
  artifactDigest: digest,
}).strict();

export const actionProposalSchema = z.object({
  schemaVersion: z.literal(KERNEL_CONTRACT_VERSION),
  proposalId: stableId,
  sessionId: stableId,
  actorId: stableId,
  profileId: z.enum(PROFILE_IDS),
  capability: capabilityId,
  plugin: pluginIdentitySchema,
  effect: z.enum(ACTION_EFFECT_CLASSES),
  target: z.object({
    resourceType: safeCode,
    normalizedRef: z.string().min(1).max(2_048).refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), "target reference contains control characters"),
  }).strict(),
  input: z.unknown(),
  requiredApproval: z.enum(APPROVAL_LEVELS),
  requestedBounds: executionBoundsSchema,
  expectedResult: z.object({
    schemaId: stableId,
    maxBytes: z.number().int().nonnegative().max(1_073_741_824),
  }).strict(),
  rollback: z.object({
    strategy: z.enum(["none", "restore-preimage", "compensate", "control-managed"]),
    verificationRef: stableId.optional(),
  }).strict(),
}).strict().superRefine((proposal, context) => {
  if (proposal.expectedResult.maxBytes > proposal.requestedBounds.maxOutputBytes) {
    context.addIssue({ code: "custom", message: "expected result exceeds requested output budget" });
  }
  if (!["pure", "read"].includes(proposal.effect) && proposal.rollback.strategy === "none") {
    context.addIssue({ code: "custom", message: "side-effecting actions require rollback or compensation metadata" });
  }
  if (proposal.rollback.strategy !== "none" && proposal.rollback.verificationRef === undefined) {
    context.addIssue({ code: "custom", message: "rollback strategy requires a verification reference" });
  }
});

export const policyDecisionSchema = z.object({
  schemaVersion: z.literal(KERNEL_CONTRACT_VERSION),
  decisionId: stableId,
  proposalId: stableId,
  outcome: z.enum(POLICY_OUTCOMES),
  reasonCode: z.enum(POLICY_REASON_CODES),
  effectiveBounds: executionBoundsSchema,
  requiredApproval: z.enum(APPROVAL_LEVELS),
  policyVersion: semver,
  evaluatedAt: dateTime,
}).strict().superRefine((decision, context) => {
  if (decision.outcome === "allow" && decision.reasonCode !== "allowed") {
    context.addIssue({ code: "custom", message: "allowed decisions require the allowed reason code" });
  }
  if (decision.outcome === "approval-required" && decision.reasonCode !== "approval-required") {
    context.addIssue({ code: "custom", message: "approval-required decisions require the matching reason code" });
  }
});

export const approvalRequestSchema = z.object({
  schemaVersion: z.literal(KERNEL_CONTRACT_VERSION),
  requestId: stableId,
  proposalId: stableId,
  decisionId: stableId,
  requiredLevel: z.enum(["standard", "elevated", "critical"]),
  summaryCode: safeCode,
  requestedAt: dateTime,
  expiresAt: dateTime,
}).strict().refine((request) => Date.parse(request.expiresAt) > Date.parse(request.requestedAt), "approval request must expire after creation");

export const approvalEvidenceSchema = z.object({
  schemaVersion: z.literal(KERNEL_CONTRACT_VERSION),
  approvalId: stableId,
  proposalId: stableId,
  decisionId: stableId,
  level: z.enum(["standard", "elevated", "critical"]),
  approvedByHash: digest,
  approvedAt: dateTime,
  expiresAt: dateTime,
}).strict().refine((approval) => Date.parse(approval.expiresAt) > Date.parse(approval.approvedAt), "approval must expire after issuance");

export const capabilityLeaseSchema = z.object({
  schemaVersion: z.literal(KERNEL_CONTRACT_VERSION),
  leaseId: stableId,
  proposalId: stableId,
  decisionId: stableId,
  sessionId: stableId,
  actorId: stableId,
  profileId: z.enum(PROFILE_IDS),
  capability: capabilityId,
  plugin: pluginIdentitySchema,
  targetDigest: digest,
  bounds: executionBoundsSchema,
  issuedAt: dateTime,
  expiresAt: dateTime,
  approvalId: stableId.optional(),
  revokedAt: dateTime.optional(),
}).strict().refine((lease) => Date.parse(lease.expiresAt) > Date.parse(lease.issuedAt), "lease must expire after issuance");

export const executionResultSchema = z.object({
  schemaVersion: z.literal(KERNEL_CONTRACT_VERSION),
  leaseId: stableId,
  outcome: z.enum(["succeeded", "failed", "cancelled", "timed-out"]),
  resultSchemaId: stableId,
  resultDigest: digest,
  outputBytes: z.number().int().nonnegative().max(1_073_741_824),
  operations: z.number().int().nonnegative().max(1_000_000),
  elapsedMs: z.number().int().nonnegative().max(86_400_000),
  rollbackApplied: z.boolean(),
  reasonCode: safeCode.optional(),
}).strict();

export const executionReceiptSchema = z.object({
  schemaVersion: z.literal(KERNEL_CONTRACT_VERSION),
  receiptId: stableId,
  proposalId: stableId,
  decisionId: stableId,
  leaseId: stableId,
  capability: capabilityId,
  pluginId: stableId,
  pluginVersion: semver,
  targetDigest: digest,
  policyOutcome: z.enum(POLICY_OUTCOMES),
  executionOutcome: z.enum(["succeeded", "failed", "cancelled", "timed-out"]),
  resultDigest: digest,
  rollbackApplied: z.boolean(),
  reasonCode: safeCode,
  completedAt: dateTime,
}).strict();

export const capabilityDescriptorSchema = z.object({
  schemaVersion: z.literal(KERNEL_CONTRACT_VERSION),
  capability: capabilityId,
  plugin: pluginIdentitySchema,
  effects: z.array(z.enum(ACTION_EFFECT_CLASSES)).nonempty().refine((values) => new Set(values).size === values.length, "effects must be unique"),
  profiles: z.array(z.enum(PROFILE_IDS)).nonempty().refine((values) => new Set(values).size === values.length, "profiles must be unique"),
  maximumBounds: executionBoundsSchema,
  requiresRollback: z.boolean(),
}).strict();

export const effectiveCapabilitySnapshotSchema = z.object({
  schemaVersion: z.literal(KERNEL_CONTRACT_VERSION),
  snapshotId: stableId,
  profileId: z.enum(PROFILE_IDS),
  policyVersion: semver,
  capabilities: z.array(capabilityDescriptorSchema).refine((values) => new Set(values.map((value) => value.capability)).size === values.length, "capabilities must be unique"),
  deniedCapabilities: z.array(capabilityId).refine((values) => new Set(values).size === values.length, "denied capabilities must be unique"),
  createdAt: dateTime,
  expiresAt: dateTime,
}).strict().superRefine((snapshot, context) => {
  if (Date.parse(snapshot.expiresAt) <= Date.parse(snapshot.createdAt)) {
    context.addIssue({ code: "custom", message: "snapshot must expire after creation" });
  }
  const overlap = snapshot.capabilities.map((item) => item.capability).filter((item) => snapshot.deniedCapabilities.includes(item));
  if (overlap.length > 0) context.addIssue({ code: "custom", message: `capability is both effective and denied: ${overlap.join(",")}` });
});

export function parseActionProposal(input: unknown): ActionProposal {
  const parsed = actionProposalSchema.parse(input);
  const canonicalInput = canonicalizeJsonValue(parsed.input, parsed.requestedBounds.maxInputBytes);
  return deepFreeze({ ...parsed, input: canonicalInput }) as ActionProposal;
}

export function parsePolicyDecision(input: unknown): PolicyDecision {
  return deepFreeze(policyDecisionSchema.parse(input)) as PolicyDecision;
}

export function parseApprovalRequest(input: unknown): ApprovalRequest {
  return deepFreeze(approvalRequestSchema.parse(input)) as ApprovalRequest;
}

export function parseApprovalEvidence(input: unknown): ApprovalEvidence {
  return deepFreeze(approvalEvidenceSchema.parse(input)) as ApprovalEvidence;
}

export function parseCapabilityLease(input: unknown): CapabilityLease {
  return deepFreeze(capabilityLeaseSchema.parse(input)) as CapabilityLease;
}

export function parseExecutionResult(input: unknown): ExecutionResult {
  return deepFreeze(executionResultSchema.parse(input)) as ExecutionResult;
}

export function parseExecutionReceipt(input: unknown): ExecutionReceipt {
  return deepFreeze(executionReceiptSchema.parse(input)) as ExecutionReceipt;
}

export function parseCapabilityDescriptor(input: unknown): CapabilityDescriptor {
  return deepFreeze(capabilityDescriptorSchema.parse(input)) as CapabilityDescriptor;
}

export function parseEffectiveCapabilitySnapshot(input: unknown): EffectiveCapabilitySnapshot {
  return deepFreeze(effectiveCapabilitySnapshotSchema.parse(input)) as EffectiveCapabilitySnapshot;
}
