import type { ProfileId } from "../profiles/types.js";

export const AGENT_WORK_TASK_SCHEMA_VERSION = "onoes-agent-work-task/v1" as const;
export const AGENT_CHANGE_PROPOSAL_SCHEMA_VERSION = "onoes-agent-change-proposal/v1" as const;
export const AGENT_RULES_INVENTORY_SCHEMA_VERSION = "onoes-agent-rules-inventory/v1" as const;
export const AGENT_RULES_DRIFT_REPORT_SCHEMA_VERSION = "onoes-agent-rules-drift-report/v1" as const;
export const AGENT_TASK_CONTEXT_SCHEMA_VERSION = "onoes-agent-task-context/v1" as const;
export const AGENT_WORK_EVIDENCE_SCHEMA_VERSION = "onoes-agent-work-evidence/v1" as const;
export const AGENT_WORK_RESULT_SCHEMA_VERSION = "onoes-agent-work-result/v1" as const;
export const AGENT_HANDOFF_ARTIFACT_SCHEMA_VERSION = "onoes-agent-handoff-artifact/v1" as const;
export const AGENT_REVIEW_SNAPSHOT_SCHEMA_VERSION = "onoes-agent-review-snapshot/v1" as const;
export const AGENT_BUILDER_RECEIPT_SCHEMA_VERSION = "onoes-agent-builder-receipt/v1" as const;
export const AGENT_REVIEWER_RECEIPT_SCHEMA_VERSION = "onoes-agent-reviewer-receipt/v1" as const;
export const AGENT_VERIFIER_RECEIPT_SCHEMA_VERSION = "onoes-agent-verifier-receipt/v1" as const;

export const AGENT_MANDATORY_FORBIDDEN_ACTIONS = [
  "self-approval-only",
  "arbitrary-shell",
  "ssh",
  "remote-control",
  "credential-invention",
  "credential-storage",
  "automatic-deployment",
  "silent-mind-promotion",
  "control-command-unfreeze",
  "model-claim-as-execution-evidence",
] as const;

export const AGENT_OPTIONAL_FORBIDDEN_ACTIONS = [
  "unscoped-read",
  "unscoped-write",
  "file-delete",
  "git-commit",
  "git-push",
  "git-tag",
  "release",
  "live-integration",
  "durable-memory-write",
] as const;

export const AGENT_FORBIDDEN_ACTIONS = [
  ...AGENT_MANDATORY_FORBIDDEN_ACTIONS,
  ...AGENT_OPTIONAL_FORBIDDEN_ACTIONS,
] as const;

export const AGENT_EVIDENCE_KINDS = [
  "test-receipt",
  "review-receipt",
  "verification-receipt",
  "artifact",
  "artifact-readback",
  "checksum",
  "audit-report",
] as const;

export const AGENT_DRIFT_REFERENCE_KINDS = [
  "path",
  "command",
  "script",
  "model-id",
  "service-name",
  "authority-claim",
] as const;

export const AGENT_DRIFT_REASON_CODES = [
  "path-missing",
  "command-missing",
  "command-definition-mismatch",
  "script-missing",
  "model-id-missing",
  "service-name-missing",
  "authority-claim-mismatch",
] as const;

export type AgentForbiddenAction = (typeof AGENT_FORBIDDEN_ACTIONS)[number];
export type AgentEvidenceKind = (typeof AGENT_EVIDENCE_KINDS)[number];
export type AgentDriftReferenceKind = (typeof AGENT_DRIFT_REFERENCE_KINDS)[number];
export type AgentDriftReasonCode = (typeof AGENT_DRIFT_REASON_CODES)[number];

export interface AgentFrozenCommand {
  readonly commandId: string;
  readonly verificationId: string;
  readonly executable: "npm" | "node" | "cargo" | "git";
  readonly arguments: readonly string[];
  readonly workingDirectory: string;
  readonly shell: false;
  readonly effect: "read" | "verification";
}

export interface AgentAcceptanceCriterion {
  readonly criterionId: string;
  readonly description: string;
  readonly verificationIds: readonly string[];
  readonly requiredEvidenceIds: readonly string[];
}

export interface AgentEvidenceRequirement {
  readonly evidenceId: string;
  readonly kind: AgentEvidenceKind;
  readonly artifactPath: string | null;
  readonly readBackRequired: boolean;
}

export interface AgentWorkTask {
  readonly schemaVersion: typeof AGENT_WORK_TASK_SCHEMA_VERSION;
  readonly taskId: string;
  readonly sessionId: string;
  readonly profileId: Extract<ProfileId, "builder" | "kitchen-sink">;
  readonly objective: string;
  readonly builderScopeDigest: string;
  readonly allowedReadFiles: readonly string[];
  readonly allowedWriteFiles: readonly string[];
  readonly expectedArtifactPaths: readonly string[];
  readonly handoffPath: string;
  readonly commands: readonly AgentFrozenCommand[];
  readonly acceptanceCriteria: readonly AgentAcceptanceCriterion[];
  readonly forbiddenActions: readonly AgentForbiddenAction[];
  readonly evidenceRequirements: readonly AgentEvidenceRequirement[];
  readonly stopConditions: {
    readonly maxImplementationPasses: number;
    readonly maxTargetedFixPasses: number;
    readonly stopOnAcceptancePassed: true;
    readonly stopOnBlocked: true;
    readonly stopOnBudgetExhausted: true;
  };
  readonly ruleReferences: {
    readonly scripts: readonly string[];
    readonly modelIds: readonly string[];
    readonly serviceNames: readonly string[];
    readonly authorityClaims: readonly string[];
  };
  readonly contextTags: readonly string[];
  readonly maxContextBytes: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly authority: "none";
}

export interface AgentChangedArtifactPlan {
  readonly relativePath: string;
  readonly action: "create" | "update";
}

export interface AgentChangeProposal {
  readonly schemaVersion: typeof AGENT_CHANGE_PROPOSAL_SCHEMA_VERSION;
  readonly proposalId: string;
  readonly taskId: string;
  readonly taskDigest: string;
  readonly builderActorId: string;
  readonly summary: string;
  readonly changedArtifacts: readonly AgentChangedArtifactPlan[];
  readonly verificationCommandIds: readonly string[];
  readonly acceptanceCriterionIds: readonly string[];
  readonly iteration: {
    readonly implementationPass: number;
    readonly targetedFixPass: number;
  };
  readonly reviewerRequired: true;
  readonly verifierRequired: true;
  readonly knownRiskCodes: readonly string[];
  readonly authority: "none";
}

export interface AgentRulesPathIdentity {
  readonly relativePath: string;
  readonly contentDigest: string;
}

export interface AgentRulesScriptIdentity extends AgentRulesPathIdentity {
  readonly scriptId: string;
}

export interface AgentRulesInventory {
  readonly schemaVersion: typeof AGENT_RULES_INVENTORY_SCHEMA_VERSION;
  readonly sourceRevision: string;
  readonly runtimeIdentityDigest: string;
  readonly generatedAt: string;
  readonly paths: readonly AgentRulesPathIdentity[];
  readonly commands: readonly AgentFrozenCommand[];
  readonly scripts: readonly AgentRulesScriptIdentity[];
  readonly modelIds: readonly string[];
  readonly serviceNames: readonly string[];
  readonly authorityClaims: readonly string[];
  readonly authority: "none";
}

export interface AgentRulesDriftFinding {
  readonly kind: AgentDriftReferenceKind;
  readonly reference: string;
  readonly reasonCode: AgentDriftReasonCode;
}

export interface AgentRulesDriftReport {
  readonly schemaVersion: typeof AGENT_RULES_DRIFT_REPORT_SCHEMA_VERSION;
  readonly taskId: string;
  readonly taskDigest: string;
  readonly inventoryDigest: string;
  readonly status: "PASS" | "STALE";
  readonly findings: readonly AgentRulesDriftFinding[];
  readonly checkedReferences: number;
  readonly repairSuggested: false;
  readonly checkedAt: string;
  readonly authority: "none";
}

export interface AgentTaskContextEntry {
  readonly contextId: string;
  readonly classification: "current-instruction" | "historical-evidence";
  readonly sourcePath: string | null;
  readonly relevanceTags: readonly string[];
  readonly content: string;
  readonly contentDigest: string;
  readonly bytes: number;
}

export interface AgentCompiledTaskContext {
  readonly schemaVersion: typeof AGENT_TASK_CONTEXT_SCHEMA_VERSION;
  readonly taskId: string;
  readonly taskDigest: string;
  readonly proposalDigest: string;
  readonly driftReportDigest: string;
  readonly contextDigest: string;
  readonly currentInstructions: readonly AgentTaskContextEntry[];
  readonly historicalEvidence: readonly AgentTaskContextEntry[];
  readonly totalBytes: number;
  readonly compiledAt: string;
  readonly persisted: false;
  readonly durableMemoryWrites: false;
  readonly privateChainOfThoughtIncluded: false;
  readonly authority: "none";
}

export interface AgentObservedEvidence {
  readonly evidenceId: string;
  readonly kind: AgentEvidenceKind;
  readonly status: "passed" | "failed" | "missing";
  readonly artifactPath: string | null;
  readonly artifactDigest: string | null;
  readonly commandId: string | null;
  readonly criterionIds: readonly string[];
  readonly readBack: "matched" | "mismatched" | "not-required";
  readonly source: "test-runner" | "reviewer" | "verifier" | "artifact-reader";
}

export interface AgentReviewEvidence {
  readonly reviewId: string;
  readonly reviewerActorId: string;
  readonly builderActorId: string;
  readonly proposalDigest: string;
  readonly reviewSnapshotDigest: string;
  readonly decision: "pass" | "fail" | "blocked";
  readonly findingCodes: readonly string[];
  readonly reviewedAt: string;
}

export interface AgentVerificationCommandResult {
  readonly commandId: string;
  readonly commandDigest: string;
  readonly status: "passed" | "failed" | "not-run";
  readonly resultDigest: string;
}

export interface AgentVerificationCriterionResult {
  readonly criterionId: string;
  readonly status: "passed" | "failed" | "not-checked";
  readonly evidenceIds: readonly string[];
}

export interface AgentVerificationEvidence {
  readonly verificationId: string;
  readonly verifierActorId: string;
  readonly builderActorId: string;
  readonly proposalDigest: string;
  readonly reviewSnapshotDigest: string;
  readonly commandResults: readonly AgentVerificationCommandResult[];
  readonly criterionResults: readonly AgentVerificationCriterionResult[];
  readonly verifiedAt: string;
}

export interface AgentWorkEvidence {
  readonly schemaVersion: typeof AGENT_WORK_EVIDENCE_SCHEMA_VERSION;
  readonly taskId: string;
  readonly taskDigest: string;
  readonly proposalDigest: string;
  readonly contextDigest: string;
  readonly driftReportDigest: string;
  readonly iteration: AgentChangeProposal["iteration"];
  readonly changedArtifacts: readonly {
    readonly relativePath: string;
    readonly contentDigest: string;
    readonly readBack: "matched" | "mismatched" | "missing";
  }[];
  readonly observedEvidence: readonly AgentObservedEvidence[];
  readonly review: AgentReviewEvidence;
  readonly verification: AgentVerificationEvidence;
  readonly receiptDigests: {
    readonly builder: string;
    readonly reviewer: string;
    readonly verifier: string;
  };
  readonly openRiskCodes: readonly string[];
  readonly authority: "none";
}

export interface AgentWorkResult {
  readonly schemaVersion: typeof AGENT_WORK_RESULT_SCHEMA_VERSION;
  readonly status: "verified" | "conditional" | "blocked";
  readonly summary: string;
  readonly changed_artifacts: readonly {
    readonly path: string;
    readonly digest: string;
  }[];
  readonly evidence: readonly {
    readonly evidence_id: string;
    readonly status: AgentObservedEvidence["status"];
    readonly digest: string | null;
  }[];
  readonly open_risks: readonly string[];
  readonly next_action: "handoff-to-operator" | "resolve-open-risks" | "repair-blocked-gates";
  readonly taskDigest: string;
  readonly proposalDigest: string;
  readonly contextDigest: string;
  readonly driftReportDigest: string;
  readonly receiptDigests: AgentWorkEvidence["receiptDigests"];
  readonly rulesDriftPassed: boolean;
  readonly iterationBudgetPassed: boolean;
  readonly acceptanceCriteriaPassed: boolean;
  readonly independentReviewPassed: boolean;
  readonly verifierPassed: boolean;
  readonly evidenceReadBackPassed: boolean;
  readonly privateChainOfThoughtIncluded: false;
  readonly authority: "none";
}

export interface AgentHandoffArtifact {
  readonly schemaVersion: typeof AGENT_HANDOFF_ARTIFACT_SCHEMA_VERSION;
  readonly taskId: string;
  readonly relativePath: string;
  readonly content: string;
  readonly contentDigest: string;
  readonly bytes: number;
  readonly resultDigest: string;
  readonly generatedAt: string;
  readonly privateChainOfThoughtIncluded: false;
  readonly authority: "none";
}
