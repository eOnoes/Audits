import { z } from "zod";
import { deepFreeze } from "../validation/deep-freeze.js";
import { isSafeBuilderRelativePath } from "./schemas.js";
import {
  AGENT_CHANGE_PROPOSAL_SCHEMA_VERSION,
  AGENT_DRIFT_REASON_CODES,
  AGENT_DRIFT_REFERENCE_KINDS,
  AGENT_EVIDENCE_KINDS,
  AGENT_FORBIDDEN_ACTIONS,
  AGENT_HANDOFF_ARTIFACT_SCHEMA_VERSION,
  AGENT_MANDATORY_FORBIDDEN_ACTIONS,
  AGENT_RULES_DRIFT_REPORT_SCHEMA_VERSION,
  AGENT_RULES_INVENTORY_SCHEMA_VERSION,
  AGENT_TASK_CONTEXT_SCHEMA_VERSION,
  AGENT_WORK_EVIDENCE_SCHEMA_VERSION,
  AGENT_WORK_RESULT_SCHEMA_VERSION,
  AGENT_WORK_TASK_SCHEMA_VERSION,
} from "./agent-workflow-types.js";
import type {
  AgentChangeProposal,
  AgentCompiledTaskContext,
  AgentFrozenCommand,
  AgentHandoffArtifact,
  AgentRulesDriftReport,
  AgentRulesInventory,
  AgentTaskContextEntry,
  AgentWorkEvidence,
  AgentWorkResult,
  AgentWorkTask,
} from "./agent-workflow-types.js";

const stableId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const safeCode = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const gitRevision = z.string().regex(/^[a-f0-9]{40}$/);
const dateTime = z.string().datetime({ offset: true });
const relativePath = z.string().refine(isSafeBuilderRelativePath, "unsafe relative path");
const oneLine = z.string().min(1).max(2_048).refine((value) => !/[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value), "text must be one safe line");
const unique = <T>(values: readonly T[]): boolean => new Set(values).size === values.length;
const pathKey = (value: string): string => process.platform === "win32" ? value.toLowerCase() : value;
const uniquePaths = (values: readonly string[]): boolean => unique(values.map(pathKey));

const commandArgument = z.string().max(512).refine(
  (value) => !/[\r\n\u0000]/u.test(value),
  "command arguments cannot contain line breaks or nulls",
);

export const agentFrozenCommandSchema = z.object({
  commandId: stableId,
  verificationId: stableId,
  executable: z.enum(["npm", "node", "cargo", "git"]),
  arguments: z.array(commandArgument).max(32),
  workingDirectory: z.union([z.literal("."), relativePath]),
  shell: z.literal(false),
  effect: z.enum(["read", "verification"]),
}).strict();

const evidenceRequirementSchema = z.object({
  evidenceId: stableId,
  kind: z.enum(AGENT_EVIDENCE_KINDS),
  artifactPath: relativePath.nullable(),
  readBackRequired: z.boolean(),
}).strict().superRefine((requirement, context) => {
  const pathKind = ["artifact", "artifact-readback", "checksum", "audit-report"].includes(requirement.kind);
  if (pathKind !== (requirement.artifactPath !== null)) {
    context.addIssue({ code: "custom", message: "artifact evidence requires exactly one scoped artifact path" });
  }
  if (requirement.readBackRequired && requirement.artifactPath === null) {
    context.addIssue({ code: "custom", message: "read-back requires an artifact path" });
  }
});

const acceptanceCriterionSchema = z.object({
  criterionId: stableId,
  description: oneLine.refine((value) => value.length <= 512, "criterion description too long"),
  verificationIds: z.array(stableId).nonempty().refine(unique, "verification IDs must be unique"),
  requiredEvidenceIds: z.array(stableId).nonempty().refine(unique, "evidence IDs must be unique"),
}).strict();

export const agentWorkTaskSchema = z.object({
  schemaVersion: z.literal(AGENT_WORK_TASK_SCHEMA_VERSION),
  taskId: stableId,
  sessionId: stableId,
  profileId: z.enum(["builder", "kitchen-sink"]),
  objective: oneLine,
  builderScopeDigest: digest,
  allowedReadFiles: z.array(relativePath).nonempty().max(256).refine(uniquePaths, "read files must be unique"),
  allowedWriteFiles: z.array(relativePath).max(128).refine(uniquePaths, "write files must be unique"),
  expectedArtifactPaths: z.array(relativePath).max(128).refine(uniquePaths, "artifact paths must be unique"),
  handoffPath: relativePath,
  commands: z.array(agentFrozenCommandSchema).nonempty().max(32),
  acceptanceCriteria: z.array(acceptanceCriterionSchema).nonempty().max(64),
  forbiddenActions: z.array(z.enum(AGENT_FORBIDDEN_ACTIONS)).nonempty().refine(unique, "forbidden actions must be unique"),
  evidenceRequirements: z.array(evidenceRequirementSchema).min(2).max(128),
  stopConditions: z.object({
    maxImplementationPasses: z.number().int().min(1).max(3),
    maxTargetedFixPasses: z.number().int().min(0).max(2),
    stopOnAcceptancePassed: z.literal(true),
    stopOnBlocked: z.literal(true),
    stopOnBudgetExhausted: z.literal(true),
  }).strict(),
  ruleReferences: z.object({
    scripts: z.array(stableId).max(64).refine(unique, "script references must be unique"),
    modelIds: z.array(safeCode).max(32).refine(unique, "model references must be unique"),
    serviceNames: z.array(safeCode).max(32).refine(unique, "service references must be unique"),
    authorityClaims: z.array(safeCode).nonempty().max(32).refine(unique, "authority claims must be unique"),
  }).strict(),
  contextTags: z.array(safeCode).nonempty().max(32).refine(unique, "context tags must be unique"),
  maxContextBytes: z.number().int().positive().max(262_144),
  createdAt: dateTime,
  expiresAt: dateTime,
  authority: z.literal("none"),
}).strict().superRefine((task, context) => {
  if (Date.parse(task.expiresAt) <= Date.parse(task.createdAt)) {
    context.addIssue({ code: "custom", message: "task must expire after creation" });
  }
  const reads = new Set(task.allowedReadFiles.map(pathKey));
  const writes = new Set(task.allowedWriteFiles.map(pathKey));
  if (task.allowedWriteFiles.some((path) => !reads.has(pathKey(path)))) {
    context.addIssue({ code: "custom", message: "write files require read scope" });
  }
  if (task.expectedArtifactPaths.some((path) => !writes.has(pathKey(path)))) {
    context.addIssue({ code: "custom", message: "expected artifacts require write scope" });
  }
  if (!writes.has(pathKey(task.handoffPath))) {
    context.addIssue({ code: "custom", message: "handoff path requires write scope" });
  }
  if (!unique(task.commands.map((command) => command.commandId))) {
    context.addIssue({ code: "custom", message: "command IDs must be unique" });
  }
  if (!unique(task.commands.map((command) => command.verificationId))) {
    context.addIssue({ code: "custom", message: "verification IDs must be unique" });
  }
  if (!unique(task.acceptanceCriteria.map((criterion) => criterion.criterionId))) {
    context.addIssue({ code: "custom", message: "acceptance criterion IDs must be unique" });
  }
  if (!unique(task.evidenceRequirements.map((requirement) => requirement.evidenceId))) {
    context.addIssue({ code: "custom", message: "evidence requirement IDs must be unique" });
  }
  const verificationIds = new Set(task.commands.map((command) => command.verificationId));
  const evidenceIds = new Set(task.evidenceRequirements.map((requirement) => requirement.evidenceId));
  for (const criterion of task.acceptanceCriteria) {
    if (criterion.verificationIds.some((id) => !verificationIds.has(id))) {
      context.addIssue({ code: "custom", message: "criterion references an unknown verification ID" });
    }
    if (criterion.requiredEvidenceIds.some((id) => !evidenceIds.has(id))) {
      context.addIssue({ code: "custom", message: "criterion references an unknown evidence ID" });
    }
  }
  for (const action of AGENT_MANDATORY_FORBIDDEN_ACTIONS) {
    if (!task.forbiddenActions.includes(action)) {
      context.addIssue({ code: "custom", message: `mandatory forbidden action missing: ${action}` });
    }
  }
  if (!task.evidenceRequirements.some((requirement) => requirement.kind === "review-receipt")
    || !task.evidenceRequirements.some((requirement) => requirement.kind === "verification-receipt")) {
    context.addIssue({ code: "custom", message: "fresh review and verification receipts are mandatory" });
  }
  if (!task.evidenceRequirements.some((requirement) => requirement.kind === "test-receipt")
    || !task.commands.some((command) => command.effect === "verification")) {
    context.addIssue({ code: "custom", message: "test evidence and a frozen verification command are mandatory" });
  }
  if (task.allowedWriteFiles.length > 0
    && !task.evidenceRequirements.some((requirement) => requirement.kind === "artifact-readback" && requirement.readBackRequired)) {
    context.addIssue({ code: "custom", message: "writes require artifact read-back evidence" });
  }
  const artifactEvidencePaths = new Set(task.evidenceRequirements
    .filter((requirement) => requirement.artifactPath !== null)
    .map((requirement) => pathKey(requirement.artifactPath!)));
  if (task.expectedArtifactPaths.some((path) => !artifactEvidencePaths.has(pathKey(path)))) {
    context.addIssue({ code: "custom", message: "every expected artifact requires evidence" });
  }
  for (const command of task.commands) {
    const operation = command.arguments[0];
    const forbidden = command.executable === "git" && operation === "commit" ? "git-commit"
      : command.executable === "git" && operation === "push" ? "git-push"
        : command.executable === "git" && operation === "tag" ? "git-tag"
          : null;
    if (forbidden !== null && task.forbiddenActions.includes(forbidden)) {
      context.addIssue({ code: "custom", message: `frozen command conflicts with forbidden action: ${forbidden}` });
    }
  }
});

export const agentChangeProposalSchema = z.object({
  schemaVersion: z.literal(AGENT_CHANGE_PROPOSAL_SCHEMA_VERSION),
  proposalId: stableId,
  taskId: stableId,
  taskDigest: digest,
  builderActorId: stableId,
  summary: oneLine.refine((value) => value.length <= 512, "proposal summary too long"),
  changedArtifacts: z.array(z.object({
    relativePath,
    action: z.enum(["create", "update"]),
  }).strict()).max(128).refine((items) => uniquePaths(items.map((item) => item.relativePath)), "changed artifacts must be unique"),
  verificationCommandIds: z.array(stableId).nonempty().max(32).refine(unique, "command IDs must be unique"),
  acceptanceCriterionIds: z.array(stableId).nonempty().max(64).refine(unique, "criterion IDs must be unique"),
  iteration: z.object({
    implementationPass: z.number().int().positive().max(3),
    targetedFixPass: z.number().int().nonnegative().max(2),
  }).strict(),
  reviewerRequired: z.literal(true),
  verifierRequired: z.literal(true),
  knownRiskCodes: z.array(safeCode).max(64).refine(unique, "risk codes must be unique"),
  authority: z.literal("none"),
}).strict();

const rulesPathIdentitySchema = z.object({
  relativePath,
  contentDigest: digest,
}).strict();

export const agentRulesInventorySchema = z.object({
  schemaVersion: z.literal(AGENT_RULES_INVENTORY_SCHEMA_VERSION),
  sourceRevision: gitRevision,
  runtimeIdentityDigest: digest,
  generatedAt: dateTime,
  paths: z.array(rulesPathIdentitySchema).nonempty().max(4_096)
    .refine((items) => uniquePaths(items.map((item) => item.relativePath)), "inventory paths must be unique"),
  commands: z.array(agentFrozenCommandSchema).nonempty().max(128)
    .refine((items) => unique(items.map((item) => item.commandId)), "inventory command IDs must be unique"),
  scripts: z.array(rulesPathIdentitySchema.extend({ scriptId: stableId }).strict()).max(128)
    .refine((items) => unique(items.map((item) => item.scriptId)), "inventory script IDs must be unique"),
  modelIds: z.array(safeCode).max(64).refine(unique, "model IDs must be unique"),
  serviceNames: z.array(safeCode).max(64).refine(unique, "service names must be unique"),
  authorityClaims: z.array(safeCode).nonempty().max(64).refine(unique, "authority claims must be unique"),
  authority: z.literal("none"),
}).strict();

export const agentRulesDriftReportSchema = z.object({
  schemaVersion: z.literal(AGENT_RULES_DRIFT_REPORT_SCHEMA_VERSION),
  taskId: stableId,
  taskDigest: digest,
  inventoryDigest: digest,
  status: z.enum(["PASS", "STALE"]),
  findings: z.array(z.object({
    kind: z.enum(AGENT_DRIFT_REFERENCE_KINDS),
    reference: z.string().min(1).max(512),
    reasonCode: z.enum(AGENT_DRIFT_REASON_CODES),
  }).strict()).max(1_024),
  checkedReferences: z.number().int().nonnegative().max(8_192),
  repairSuggested: z.literal(false),
  checkedAt: dateTime,
  authority: z.literal("none"),
}).strict().superRefine((report, context) => {
  if ((report.status === "PASS") !== (report.findings.length === 0)) {
    context.addIssue({ code: "custom", message: "drift status must match findings" });
  }
});

export const agentTaskContextEntrySchema = z.object({
  contextId: stableId,
  classification: z.enum(["current-instruction", "historical-evidence"]),
  sourcePath: relativePath.nullable(),
  relevanceTags: z.array(safeCode).nonempty().max(32).refine(unique, "relevance tags must be unique"),
  content: z.string().min(1).max(131_072),
  contentDigest: digest,
  bytes: z.number().int().positive().max(131_072),
}).strict().superRefine((entry, context) => {
  if ((entry.classification === "current-instruction") !== (entry.sourcePath === null)) {
    context.addIssue({ code: "custom", message: "only historical evidence may reference a repository path" });
  }
});

export const agentCompiledTaskContextSchema = z.object({
  schemaVersion: z.literal(AGENT_TASK_CONTEXT_SCHEMA_VERSION),
  taskId: stableId,
  taskDigest: digest,
  proposalDigest: digest,
  driftReportDigest: digest,
  contextDigest: digest,
  currentInstructions: z.array(agentTaskContextEntrySchema).nonempty().max(16),
  historicalEvidence: z.array(agentTaskContextEntrySchema).max(32),
  totalBytes: z.number().int().positive().max(262_144),
  compiledAt: dateTime,
  persisted: z.literal(false),
  durableMemoryWrites: z.literal(false),
  privateChainOfThoughtIncluded: z.literal(false),
  authority: z.literal("none"),
}).strict();

const observedEvidenceSchema = z.object({
  evidenceId: stableId,
  kind: z.enum(AGENT_EVIDENCE_KINDS),
  status: z.enum(["passed", "failed", "missing"]),
  artifactPath: relativePath.nullable(),
  artifactDigest: digest.nullable(),
  commandId: stableId.nullable(),
  criterionIds: z.array(stableId).max(64).refine(unique, "criterion IDs must be unique"),
  readBack: z.enum(["matched", "mismatched", "not-required"]),
  source: z.enum(["test-runner", "reviewer", "verifier", "artifact-reader"]),
}).strict();

const reviewEvidenceSchema = z.object({
  reviewId: stableId,
  reviewerActorId: stableId,
  builderActorId: stableId,
  proposalDigest: digest,
  reviewSnapshotDigest: digest,
  decision: z.enum(["pass", "fail", "blocked"]),
  findingCodes: z.array(safeCode).max(128).refine(unique, "finding codes must be unique"),
  reviewedAt: dateTime,
}).strict().superRefine((review, context) => {
  if (review.reviewerActorId === review.builderActorId) {
    context.addIssue({ code: "custom", message: "reviewer must differ from builder" });
  }
  if (review.decision === "pass" && review.findingCodes.length > 0) {
    context.addIssue({ code: "custom", message: "passing review cannot retain findings" });
  }
});

const verificationEvidenceSchema = z.object({
  verificationId: stableId,
  verifierActorId: stableId,
  builderActorId: stableId,
  proposalDigest: digest,
  reviewSnapshotDigest: digest,
  commandResults: z.array(z.object({
    commandId: stableId,
    commandDigest: digest,
    status: z.enum(["passed", "failed", "not-run"]),
    resultDigest: digest,
  }).strict()).nonempty().max(32).refine((items) => unique(items.map((item) => item.commandId)), "command results must be unique"),
  criterionResults: z.array(z.object({
    criterionId: stableId,
    status: z.enum(["passed", "failed", "not-checked"]),
    evidenceIds: z.array(stableId).max(128).refine(unique, "evidence IDs must be unique"),
  }).strict()).nonempty().max(64).refine((items) => unique(items.map((item) => item.criterionId)), "criterion results must be unique"),
  verifiedAt: dateTime,
}).strict().superRefine((verification, context) => {
  if (verification.verifierActorId === verification.builderActorId) {
    context.addIssue({ code: "custom", message: "verifier must differ from builder" });
  }
});

export const agentWorkEvidenceSchema = z.object({
  schemaVersion: z.literal(AGENT_WORK_EVIDENCE_SCHEMA_VERSION),
  taskId: stableId,
  taskDigest: digest,
  proposalDigest: digest,
  contextDigest: digest,
  driftReportDigest: digest,
  iteration: z.object({
    implementationPass: z.number().int().positive().max(3),
    targetedFixPass: z.number().int().nonnegative().max(2),
  }).strict(),
  changedArtifacts: z.array(z.object({
    relativePath,
    contentDigest: digest,
    readBack: z.enum(["matched", "mismatched", "missing"]),
  }).strict()).max(128).refine((items) => uniquePaths(items.map((item) => item.relativePath)), "changed artifacts must be unique"),
  observedEvidence: z.array(observedEvidenceSchema).max(256)
    .refine((items) => unique(items.map((item) => item.evidenceId)), "observed evidence IDs must be unique"),
  review: reviewEvidenceSchema,
  verification: verificationEvidenceSchema,
  receiptDigests: z.object({
    builder: digest,
    reviewer: digest,
    verifier: digest,
  }).strict(),
  openRiskCodes: z.array(safeCode).max(128).refine(unique, "risk codes must be unique"),
  authority: z.literal("none"),
}).strict();

export const agentWorkResultSchema = z.object({
  schemaVersion: z.literal(AGENT_WORK_RESULT_SCHEMA_VERSION),
  status: z.enum(["verified", "conditional", "blocked"]),
  summary: oneLine,
  changed_artifacts: z.array(z.object({ path: relativePath, digest }).strict()).max(128),
  evidence: z.array(z.object({
    evidence_id: stableId,
    status: z.enum(["passed", "failed", "missing"]),
    digest: digest.nullable(),
  }).strict()).max(256),
  open_risks: z.array(safeCode).max(128),
  next_action: z.enum(["handoff-to-operator", "resolve-open-risks", "repair-blocked-gates"]),
  taskDigest: digest,
  proposalDigest: digest,
  contextDigest: digest,
  driftReportDigest: digest,
  receiptDigests: z.object({ builder: digest, reviewer: digest, verifier: digest }).strict(),
  rulesDriftPassed: z.boolean(),
  iterationBudgetPassed: z.boolean(),
  acceptanceCriteriaPassed: z.boolean(),
  independentReviewPassed: z.boolean(),
  verifierPassed: z.boolean(),
  evidenceReadBackPassed: z.boolean(),
  privateChainOfThoughtIncluded: z.literal(false),
  authority: z.literal("none"),
}).strict().superRefine((result, context) => {
  const gatesPassed = result.rulesDriftPassed
    && result.iterationBudgetPassed
    && result.acceptanceCriteriaPassed
    && result.independentReviewPassed
    && result.verifierPassed
    && result.evidenceReadBackPassed;
  if (result.status === "verified"
    && (!gatesPassed || result.open_risks.length !== 0 || result.next_action !== "handoff-to-operator")) {
    context.addIssue({ code: "custom", message: "verified result requires every closure gate and no open risks" });
  }
  if (result.status === "conditional"
    && (!gatesPassed || result.open_risks.length === 0 || result.next_action !== "resolve-open-risks")) {
    context.addIssue({ code: "custom", message: "conditional result requires passing gates and explicit open risks" });
  }
  if (result.status === "blocked"
    && (gatesPassed || result.next_action !== "repair-blocked-gates")) {
    context.addIssue({ code: "custom", message: "blocked result requires at least one failed gate" });
  }
});

export const agentHandoffArtifactSchema = z.object({
  schemaVersion: z.literal(AGENT_HANDOFF_ARTIFACT_SCHEMA_VERSION),
  taskId: stableId,
  relativePath,
  content: z.string().min(1).max(262_144),
  contentDigest: digest,
  bytes: z.number().int().positive().max(262_144),
  resultDigest: digest,
  generatedAt: dateTime,
  privateChainOfThoughtIncluded: z.literal(false),
  authority: z.literal("none"),
}).strict();

export function parseAgentWorkTask(input: unknown): AgentWorkTask {
  return deepFreeze(agentWorkTaskSchema.parse(input)) as AgentWorkTask;
}

export function parseAgentFrozenCommand(input: unknown): AgentFrozenCommand {
  return deepFreeze(agentFrozenCommandSchema.parse(input)) as AgentFrozenCommand;
}

export function parseAgentChangeProposal(input: unknown): AgentChangeProposal {
  return deepFreeze(agentChangeProposalSchema.parse(input)) as AgentChangeProposal;
}

export function parseAgentRulesInventory(input: unknown): AgentRulesInventory {
  return deepFreeze(agentRulesInventorySchema.parse(input)) as AgentRulesInventory;
}

export function parseAgentRulesDriftReport(input: unknown): AgentRulesDriftReport {
  return deepFreeze(agentRulesDriftReportSchema.parse(input)) as AgentRulesDriftReport;
}

export function parseAgentTaskContextEntry(input: unknown): AgentTaskContextEntry {
  return deepFreeze(agentTaskContextEntrySchema.parse(input)) as AgentTaskContextEntry;
}

export function parseAgentCompiledTaskContext(input: unknown): AgentCompiledTaskContext {
  return deepFreeze(agentCompiledTaskContextSchema.parse(input)) as AgentCompiledTaskContext;
}

export function parseAgentWorkEvidence(input: unknown): AgentWorkEvidence {
  return deepFreeze(agentWorkEvidenceSchema.parse(input)) as AgentWorkEvidence;
}

export function parseAgentWorkResult(input: unknown): AgentWorkResult {
  return deepFreeze(agentWorkResultSchema.parse(input)) as AgentWorkResult;
}

export function parseAgentHandoffArtifact(input: unknown): AgentHandoffArtifact {
  return deepFreeze(agentHandoffArtifactSchema.parse(input)) as AgentHandoffArtifact;
}
