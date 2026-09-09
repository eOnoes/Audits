import { canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { containsSecretLikeContent, sha256BuilderDigest } from "./content-policy.js";
import { computeBuilderInspectionScopeDigest, parseBuilderTaskScope } from "./schemas.js";
import {
  parseAgentChangeProposal,
  parseAgentCompiledTaskContext,
  parseAgentFrozenCommand,
  parseAgentHandoffArtifact,
  parseAgentRulesDriftReport,
  parseAgentRulesInventory,
  parseAgentTaskContextEntry,
  parseAgentWorkEvidence,
  parseAgentWorkResult,
  parseAgentWorkTask,
} from "./agent-workflow-schemas.js";
import {
  AGENT_BUILDER_RECEIPT_SCHEMA_VERSION,
  AGENT_HANDOFF_ARTIFACT_SCHEMA_VERSION,
  AGENT_REVIEWER_RECEIPT_SCHEMA_VERSION,
  AGENT_REVIEW_SNAPSHOT_SCHEMA_VERSION,
  AGENT_RULES_DRIFT_REPORT_SCHEMA_VERSION,
  AGENT_TASK_CONTEXT_SCHEMA_VERSION,
  AGENT_VERIFIER_RECEIPT_SCHEMA_VERSION,
  AGENT_WORK_RESULT_SCHEMA_VERSION,
} from "./agent-workflow-types.js";
import type {
  AgentChangeProposal,
  AgentCompiledTaskContext,
  AgentDriftReasonCode,
  AgentDriftReferenceKind,
  AgentHandoffArtifact,
  AgentRulesDriftFinding,
  AgentRulesDriftReport,
  AgentRulesInventory,
  AgentTaskContextEntry,
  AgentWorkEvidence,
  AgentWorkResult,
  AgentWorkTask,
} from "./agent-workflow-types.js";
import type { BuilderTaskScope } from "./types.js";

export interface AgentRulesDriftCheckOptions {
  readonly now?: () => string;
}

export interface AgentTaskContextCompileOptions {
  readonly now?: () => string;
}

export interface AgentHandoffBuildOptions {
  readonly now?: () => string;
}

export function computeAgentWorkTaskDigest(taskInput: unknown): string {
  return canonicalSha256Digest(parseAgentWorkTask(taskInput));
}

export function computeAgentChangeProposalDigest(proposalInput: unknown): string {
  return canonicalSha256Digest(parseAgentChangeProposal(proposalInput));
}

/** Shared description cohesion only; neither parsing nor matching grants
 * approval or verifies the live workspace, commands, or review evidence. */
export function bindAgentChangeProposalToWorkTask(taskInput: unknown, proposalInput: unknown): AgentChangeProposal {
  const task = parseAgentWorkTask(taskInput), proposal = parseAgentChangeProposal(proposalInput);
  bindProposalToTask(task, proposal);
  return proposal;
}

export function computeAgentFrozenCommandDigest(commandInput: unknown): string {
  return canonicalSha256Digest(parseAgentFrozenCommand(commandInput));
}

export function computeAgentReviewSnapshotDigest(
  taskDigest: string,
  proposalDigest: string,
  changedArtifacts: AgentWorkEvidence["changedArtifacts"],
): string {
  return canonicalSha256Digest({
    schemaVersion: AGENT_REVIEW_SNAPSHOT_SCHEMA_VERSION,
    taskDigest,
    proposalDigest,
    changedArtifacts: normalizedChangedArtifacts(changedArtifacts),
  });
}

export function computeAgentBuilderReceiptDigest(evidence: Pick<AgentWorkEvidence,
  "taskDigest" | "proposalDigest" | "contextDigest" | "driftReportDigest" | "iteration" | "changedArtifacts">): string {
  return canonicalSha256Digest({
    schemaVersion: AGENT_BUILDER_RECEIPT_SCHEMA_VERSION,
    taskDigest: evidence.taskDigest,
    proposalDigest: evidence.proposalDigest,
    contextDigest: evidence.contextDigest,
    driftReportDigest: evidence.driftReportDigest,
    iteration: evidence.iteration,
    changedArtifacts: normalizedChangedArtifacts(evidence.changedArtifacts),
  });
}

export function computeAgentReviewerReceiptDigest(review: AgentWorkEvidence["review"]): string {
  return canonicalSha256Digest({ schemaVersion: AGENT_REVIEWER_RECEIPT_SCHEMA_VERSION, review });
}

export function computeAgentVerifierReceiptDigest(verification: AgentWorkEvidence["verification"]): string {
  return canonicalSha256Digest({ schemaVersion: AGENT_VERIFIER_RECEIPT_SCHEMA_VERSION, verification });
}

export function bindAgentWorkTaskToBuilderScope(taskInput: unknown, scopeInput: unknown): AgentWorkTask {
  const task = parseAgentWorkTask(taskInput);
  const scope: BuilderTaskScope = parseBuilderTaskScope(scopeInput);
  if (task.taskId !== scope.taskId
    || task.sessionId !== scope.sessionId
    || task.profileId !== scope.profileId
    || task.builderScopeDigest !== computeBuilderInspectionScopeDigest(scope)) {
    throw new Error("agent-work-task-builder-scope-mismatch");
  }
  if (!equalJson([...task.allowedReadFiles].sort(compareCodeUnits), [...scope.allowedReadFiles].sort(compareCodeUnits))
    || !equalJson([...task.allowedWriteFiles].sort(compareCodeUnits), [...scope.allowedWriteFiles].sort(compareCodeUnits))) {
    throw new Error("agent-work-task-builder-path-scope-mismatch");
  }
  const verificationIds = new Set(scope.allowedVerificationIds);
  if (task.commands.some((command) => !verificationIds.has(command.verificationId))) {
    throw new Error("agent-work-task-builder-verification-scope-mismatch");
  }
  if (Date.parse(task.createdAt) < Date.parse(scope.issuedAt)
    || Date.parse(task.expiresAt) > Date.parse(scope.expiresAt)) {
    throw new Error("agent-work-task-builder-lifetime-mismatch");
  }
  return task;
}

export function checkAgentRulesDrift(
  taskInput: unknown,
  inventoryInput: unknown,
  options: AgentRulesDriftCheckOptions = {},
): AgentRulesDriftReport {
  const task = parseAgentWorkTask(taskInput);
  const inventory = parseAgentRulesInventory(inventoryInput);
  const taskDigest = canonicalSha256Digest(task);
  const inventoryDigest = canonicalSha256Digest(inventory);
  const findings: AgentRulesDriftFinding[] = [];
  const pathIdentities = new Map(inventory.paths.map((entry) => [pathKey(entry.relativePath), entry]));
  const referencedPaths = uniqueSorted([
    ...task.allowedReadFiles,
    ...task.allowedWriteFiles,
    ...task.expectedArtifactPaths,
    task.handoffPath,
  ], pathKey);
  for (const path of referencedPaths) {
    if (!pathIdentities.has(pathKey(path))) findings.push(finding("path", path, "path-missing"));
  }

  const liveCommands = new Map(inventory.commands.map((command) => [command.commandId, command]));
  for (const command of task.commands) {
    const live = liveCommands.get(command.commandId);
    if (live === undefined) findings.push(finding("command", command.commandId, "command-missing"));
    else if (canonicalSha256Digest(live) !== canonicalSha256Digest(command)) {
      findings.push(finding("command", command.commandId, "command-definition-mismatch"));
    }
  }

  const liveScripts = new Set(inventory.scripts.map((script) => script.scriptId));
  for (const script of task.ruleReferences.scripts) {
    if (!liveScripts.has(script)) findings.push(finding("script", script, "script-missing"));
  }
  collectMissing(findings, "model-id", task.ruleReferences.modelIds, new Set(inventory.modelIds), "model-id-missing");
  collectMissing(findings, "service-name", task.ruleReferences.serviceNames, new Set(inventory.serviceNames), "service-name-missing");
  collectMissing(findings, "authority-claim", task.ruleReferences.authorityClaims, new Set(inventory.authorityClaims), "authority-claim-mismatch");
  findings.sort(compareFinding);

  const checkedAt = safeTime((options.now ?? (() => new Date().toISOString()))());
  return parseAgentRulesDriftReport({
    schemaVersion: AGENT_RULES_DRIFT_REPORT_SCHEMA_VERSION,
    taskId: task.taskId,
    taskDigest,
    inventoryDigest,
    status: findings.length === 0 ? "PASS" : "STALE",
    findings,
    checkedReferences: referencedPaths.length
      + task.commands.length
      + task.ruleReferences.scripts.length
      + task.ruleReferences.modelIds.length
      + task.ruleReferences.serviceNames.length
      + task.ruleReferences.authorityClaims.length,
    repairSuggested: false,
    checkedAt,
    authority: "none",
  });
}

export function compileAgentTaskContext(
  taskInput: unknown,
  proposalInput: unknown,
  driftReportInput: unknown,
  entriesInput: readonly unknown[],
  options: AgentTaskContextCompileOptions = {},
): AgentCompiledTaskContext {
  const task = parseAgentWorkTask(taskInput);
  const proposal = parseAgentChangeProposal(proposalInput);
  const driftReport = parseAgentRulesDriftReport(driftReportInput);
  bindProposalToTask(task, proposal);
  const taskDigest = canonicalSha256Digest(task);
  if (driftReport.taskId !== task.taskId
    || driftReport.taskDigest !== taskDigest
    || driftReport.status !== "PASS"
    || driftReport.findings.length !== 0) {
    throw new Error("agent-task-context-rules-drift-blocked");
  }
  if (entriesInput.length < 1 || entriesInput.length > 48) throw new RangeError("agent-task-context-entry-budget-exceeded");
  const entries = entriesInput.map(parseAgentTaskContextEntry);
  if (new Set(entries.map((entry) => entry.contextId)).size !== entries.length) {
    throw new Error("agent-task-context-entry-id-duplicate");
  }
  const allowedTags = new Set(task.contextTags);
  const allowedPaths = new Set(task.allowedReadFiles.map(pathKey));
  let totalBytes = 0;
  for (const entry of entries) {
    const bytes = new TextEncoder().encode(entry.content);
    if (bytes.byteLength !== entry.bytes || sha256BuilderDigest(bytes) !== entry.contentDigest) {
      throw new Error("agent-task-context-content-mismatch");
    }
    if (containsSecretLikeContent(entry.content)) throw new Error("agent-task-context-secret-rejected");
    if (entry.relevanceTags.some((tag) => !allowedTags.has(tag))) throw new Error("agent-task-context-not-relevant");
    if (entry.classification === "historical-evidence"
      && (entry.sourcePath === null || !allowedPaths.has(pathKey(entry.sourcePath)))) {
      throw new Error("agent-task-context-path-not-allowed");
    }
    totalBytes += entry.bytes;
  }
  if (totalBytes > task.maxContextBytes) throw new RangeError("agent-task-context-byte-budget-exceeded");
  const currentInstructions = entries
    .filter((entry) => entry.classification === "current-instruction")
    .sort(compareContextEntry);
  if (currentInstructions.length === 0) throw new Error("agent-task-context-current-instructions-missing");
  const historicalEvidence = entries
    .filter((entry) => entry.classification === "historical-evidence")
    .sort(compareContextEntry);
  const compiledAt = safeTime((options.now ?? (() => new Date().toISOString()))());
  const proposalDigest = canonicalSha256Digest(proposal);
  const driftReportDigest = canonicalSha256Digest(driftReport);
  const payload = deepFreeze({
    schemaVersion: AGENT_TASK_CONTEXT_SCHEMA_VERSION,
    taskId: task.taskId,
    taskDigest,
    proposalDigest,
    driftReportDigest,
    currentInstructions,
    historicalEvidence,
    totalBytes,
    compiledAt,
    persisted: false,
    durableMemoryWrites: false,
    privateChainOfThoughtIncluded: false,
    authority: "none",
  } satisfies Omit<AgentCompiledTaskContext, "contextDigest">);
  return parseAgentCompiledTaskContext({
    ...payload,
    contextDigest: canonicalSha256Digest(payload),
  });
}

export function createAgentWorkResult(
  taskInput: unknown,
  proposalInput: unknown,
  driftReportInput: unknown,
  contextInput: unknown,
  evidenceInput: unknown,
): AgentWorkResult {
  const task = parseAgentWorkTask(taskInput);
  const proposal = parseAgentChangeProposal(proposalInput);
  const driftReport = parseAgentRulesDriftReport(driftReportInput);
  const context = parseAgentCompiledTaskContext(contextInput);
  const evidence = parseAgentWorkEvidence(evidenceInput);
  bindProposalToTask(task, proposal);
  bindWorkflowEvidence(task, proposal, driftReport, context, evidence);

  const taskDigest = canonicalSha256Digest(task);
  const proposalDigest = canonicalSha256Digest(proposal);
  const driftReportDigest = canonicalSha256Digest(driftReport);
  const observedRisks = [...evidence.openRiskCodes].sort(compareCodeUnits);
  const plannedRisks = [...proposal.knownRiskCodes].sort(compareCodeUnits);
  const knownRisksPreserved = equalJson(observedRisks, plannedRisks);
  // A blocked handoff must not erase a planned risk just because evidence omitted
  // it. Preserve both sets; never truncate them to fit the existing result wire.
  const openRisks = [...new Set([...plannedRisks, ...observedRisks])].sort(compareCodeUnits);
  if (openRisks.length > 128) throw new RangeError("agent-workflow-risk-budget-exceeded");
  const rulesDriftPassed = driftReport.status === "PASS" && driftReport.findings.length === 0;
  const iterationBudgetPassed = proposal.iteration.implementationPass <= task.stopConditions.maxImplementationPasses
    && proposal.iteration.targetedFixPass <= task.stopConditions.maxTargetedFixPasses
    && equalJson(proposal.iteration, evidence.iteration);
  const reviewSnapshotDigest = computeAgentReviewSnapshotDigest(taskDigest, proposalDigest, evidence.changedArtifacts);
  const reviewTime = Date.parse(evidence.review.reviewedAt);
  const verificationTime = Date.parse(evidence.verification.verifiedAt);
  const taskCreatedTime = Date.parse(task.createdAt);
  const taskExpiresTime = Date.parse(task.expiresAt);
  const contextTime = Date.parse(context.compiledAt);
  const driftTime = Date.parse(driftReport.checkedAt);
  const independentReviewPassed = evidence.review.decision === "pass"
    && evidence.review.builderActorId === proposal.builderActorId
    && evidence.review.reviewerActorId !== proposal.builderActorId
    && evidence.review.reviewerActorId !== evidence.verification.verifierActorId
    && evidence.review.proposalDigest === proposalDigest
    && evidence.review.reviewSnapshotDigest === reviewSnapshotDigest
    && evidence.receiptDigests.reviewer === computeAgentReviewerReceiptDigest(evidence.review)
    && reviewTime >= contextTime
    && reviewTime >= taskCreatedTime
    && reviewTime <= taskExpiresTime;
  const verifierPassed = verifyCommandResults(task, proposal, evidence)
    && evidence.verification.verifierActorId !== proposal.builderActorId
    && evidence.verification.builderActorId === proposal.builderActorId
    && evidence.verification.proposalDigest === proposalDigest
    && evidence.verification.reviewSnapshotDigest === reviewSnapshotDigest
    && evidence.receiptDigests.verifier === computeAgentVerifierReceiptDigest(evidence.verification)
    && verificationTime >= reviewTime
    && verificationTime <= taskExpiresTime;
  const acceptanceCriteriaPassed = verifyCriteria(task, evidence);
  const evidenceReadBackPassed = verifyRequiredEvidence(task, evidence)
    && verifyChangedArtifacts(task, proposal, evidence)
    && verifyCompiledContext(task, proposal, driftReport, context)
    && knownRisksPreserved
    && evidence.receiptDigests.builder === computeAgentBuilderReceiptDigest(evidence)
    && contextTime >= driftTime
    && contextTime >= taskCreatedTime
    && contextTime <= taskExpiresTime;
  const gatesPassed = rulesDriftPassed
    && iterationBudgetPassed
    && independentReviewPassed
    && verifierPassed
    && acceptanceCriteriaPassed
    && evidenceReadBackPassed;
  const status = !gatesPassed ? "blocked" : openRisks.length > 0 ? "conditional" : "verified";
  const summary = status === "verified"
    ? "All scoped artifacts, independent review, verification commands, and read-back evidence passed."
    : status === "conditional"
      ? "Scoped work passed available checks with explicitly recorded open risks."
      : "Closure is blocked because one or more deterministic workflow gates did not pass.";
  return parseAgentWorkResult({
    schemaVersion: AGENT_WORK_RESULT_SCHEMA_VERSION,
    status,
    summary,
    changed_artifacts: [...evidence.changedArtifacts]
      .sort((left, right) => compareCodeUnits(pathKey(left.relativePath), pathKey(right.relativePath)))
      .map((artifact) => ({ path: artifact.relativePath, digest: artifact.contentDigest })),
    evidence: [...evidence.observedEvidence]
      .sort((left, right) => compareCodeUnits(left.evidenceId, right.evidenceId))
      .map((item) => ({ evidence_id: item.evidenceId, status: item.status, digest: item.artifactDigest })),
    open_risks: openRisks,
    next_action: status === "verified" ? "handoff-to-operator"
      : status === "conditional" ? "resolve-open-risks"
        : "repair-blocked-gates",
    taskDigest,
    proposalDigest,
    contextDigest: context.contextDigest,
    driftReportDigest,
    receiptDigests: evidence.receiptDigests,
    rulesDriftPassed,
    iterationBudgetPassed,
    acceptanceCriteriaPassed,
    independentReviewPassed,
    verifierPassed,
    evidenceReadBackPassed,
    privateChainOfThoughtIncluded: false,
    authority: "none",
  });
}

export function buildAgentHandoffArtifact(
  taskInput: unknown,
  resultInput: unknown,
  options: AgentHandoffBuildOptions = {},
): AgentHandoffArtifact {
  const task = parseAgentWorkTask(taskInput);
  const result = parseAgentWorkResult(resultInput);
  if (result.taskDigest !== canonicalSha256Digest(task)) throw new Error("agent-handoff-task-digest-mismatch");
  const generatedAt = safeTime((options.now ?? (() => new Date().toISOString()))());
  const content = renderAgentHandoffMarkdown(task, result, generatedAt);
  const bytes = new TextEncoder().encode(content);
  return parseAgentHandoffArtifact({
    schemaVersion: AGENT_HANDOFF_ARTIFACT_SCHEMA_VERSION,
    taskId: task.taskId,
    relativePath: task.handoffPath,
    content,
    contentDigest: sha256BuilderDigest(bytes),
    bytes: bytes.byteLength,
    resultDigest: canonicalSha256Digest(result),
    generatedAt,
    privateChainOfThoughtIncluded: false,
    authority: "none",
  });
}

export function renderAgentHandoffMarkdown(task: AgentWorkTask, result: AgentWorkResult, generatedAt: string): string {
  const changed = result.changed_artifacts.length === 0
    ? "- None."
    : result.changed_artifacts.map((artifact) => `- \`${artifact.path}\` — \`${artifact.digest}\``).join("\n");
  const evidence = result.evidence.length === 0
    ? "- None."
    : result.evidence.map((item) => `- \`${item.evidence_id}\` — ${item.status}${item.digest === null ? "" : ` — \`${item.digest}\``}`).join("\n");
  const risks = result.open_risks.length === 0
    ? "- None."
    : result.open_risks.map((risk) => `- \`${risk}\``).join("\n");
  return `# Onoes-Agent Work Handoff — ${task.taskId}\n\n`
    + `Generated: \`${generatedAt}\`\n\n`
    + `Status: \`${result.status}\`\n\n`
    + `${result.summary}\n\n`
    + `## Objective\n\n${task.objective}\n\n`
    + `## Changed artifacts\n\n${changed}\n\n`
    + `## Evidence\n\n${evidence}\n\n`
    + `## Open risks\n\n${risks}\n\n`
    + `## Next action\n\n\`${result.next_action}\`\n\n`
    + `## Closure gates\n\n`
    + `- Rules drift passed: \`${result.rulesDriftPassed}\`.\n`
    + `- Iteration budget passed: \`${result.iterationBudgetPassed}\`.\n`
    + `- Acceptance criteria passed: \`${result.acceptanceCriteriaPassed}\`.\n`
    + `- Independent review passed: \`${result.independentReviewPassed}\`.\n`
    + `- Verifier passed: \`${result.verifierPassed}\`.\n`
    + `- Evidence read-back passed: \`${result.evidenceReadBackPassed}\`.\n\n`
    + `## Bindings\n\n`
    + `- Task: \`${result.taskDigest}\`.\n`
    + `- Proposal: \`${result.proposalDigest}\`.\n`
    + `- Context: \`${result.contextDigest}\`.\n`
    + `- Rules drift: \`${result.driftReportDigest}\`.\n\n`
    + `No private chain-of-thought is included. This handoff grants no execution, deployment, credential, Mind, Control, or approval authority.\n`;
}

function bindProposalToTask(task: AgentWorkTask, proposal: AgentChangeProposal): void {
  if (proposal.taskId !== task.taskId || proposal.taskDigest !== canonicalSha256Digest(task)) {
    throw new Error("agent-change-proposal-task-mismatch");
  }
  const commandIds = [...task.commands.map((command) => command.commandId)].sort(compareCodeUnits);
  if (!equalJson([...proposal.verificationCommandIds].sort(compareCodeUnits), commandIds)) {
    throw new Error("agent-change-proposal-command-set-mismatch");
  }
  const criterionIds = [...task.acceptanceCriteria.map((criterion) => criterion.criterionId)].sort(compareCodeUnits);
  if (!equalJson([...proposal.acceptanceCriterionIds].sort(compareCodeUnits), criterionIds)) {
    throw new Error("agent-change-proposal-criteria-set-mismatch");
  }
  const writes = new Set(task.allowedWriteFiles.map(pathKey));
  if (proposal.changedArtifacts.some((artifact) => !writes.has(pathKey(artifact.relativePath)))) {
    throw new Error("agent-change-proposal-path-not-allowed");
  }
  const planned = new Set(proposal.changedArtifacts.map((artifact) => pathKey(artifact.relativePath)));
  if (task.expectedArtifactPaths.some((path) => !planned.has(pathKey(path)))) {
    throw new Error("agent-change-proposal-artifact-missing");
  }
  if (proposal.iteration.implementationPass > task.stopConditions.maxImplementationPasses
    || proposal.iteration.targetedFixPass > task.stopConditions.maxTargetedFixPasses) {
    throw new Error("agent-change-proposal-iteration-budget-exceeded");
  }
}

function bindWorkflowEvidence(
  task: AgentWorkTask,
  proposal: AgentChangeProposal,
  driftReport: AgentRulesDriftReport,
  context: AgentCompiledTaskContext,
  evidence: AgentWorkEvidence,
): void {
  const taskDigest = canonicalSha256Digest(task);
  const proposalDigest = canonicalSha256Digest(proposal);
  const driftReportDigest = canonicalSha256Digest(driftReport);
  if (driftReport.taskId !== task.taskId || driftReport.taskDigest !== taskDigest) throw new Error("agent-workflow-drift-task-mismatch");
  if (context.taskId !== task.taskId
    || context.taskDigest !== taskDigest
    || context.proposalDigest !== proposalDigest
    || context.driftReportDigest !== driftReportDigest) {
    throw new Error("agent-workflow-context-mismatch");
  }
  if (evidence.taskId !== task.taskId
    || evidence.taskDigest !== taskDigest
    || evidence.proposalDigest !== proposalDigest
    || evidence.contextDigest !== context.contextDigest
    || evidence.driftReportDigest !== driftReportDigest) {
    throw new Error("agent-workflow-evidence-mismatch");
  }
}

function verifyCommandResults(task: AgentWorkTask, proposal: AgentChangeProposal, evidence: AgentWorkEvidence): boolean {
  const expected = new Map(task.commands.map((command) => [command.commandId, command]));
  const results = new Map(evidence.verification.commandResults.map((result) => [result.commandId, result]));
  if (results.size !== proposal.verificationCommandIds.length) return false;
  return proposal.verificationCommandIds.every((commandId) => {
    const command = expected.get(commandId);
    const result = results.get(commandId);
    return command !== undefined
      && result !== undefined
      && result.status === "passed"
      && result.commandDigest === canonicalSha256Digest(command);
  });
}

function verifyCriteria(task: AgentWorkTask, evidence: AgentWorkEvidence): boolean {
  const results = new Map(evidence.verification.criterionResults.map((result) => [result.criterionId, result]));
  if (results.size !== task.acceptanceCriteria.length) return false;
  return task.acceptanceCriteria.every((criterion) => {
    const result = results.get(criterion.criterionId);
    if (result?.status !== "passed") return false;
    return equalJson(
      [...result.evidenceIds].sort(compareCodeUnits),
      [...criterion.requiredEvidenceIds].sort(compareCodeUnits),
    );
  });
}

function verifyRequiredEvidence(task: AgentWorkTask, evidence: AgentWorkEvidence): boolean {
  const observed = new Map(evidence.observedEvidence.map((item) => [item.evidenceId, item]));
  const changed = new Map(evidence.changedArtifacts.map((item) => [pathKey(item.relativePath), item]));
  if (observed.size !== task.evidenceRequirements.length) return false;
  const commandIds = new Set(task.commands.map((command) => command.commandId));
  const criterionIds = new Set(task.acceptanceCriteria.map((criterion) => criterion.criterionId));
  return task.evidenceRequirements.every((requirement) => {
    const actual = observed.get(requirement.evidenceId);
    if (actual === undefined
      || actual.kind !== requirement.kind
      || actual.status !== "passed"
      || actual.artifactDigest === null
      || actual.artifactPath !== requirement.artifactPath
      || actual.criterionIds.some((criterionId) => !criterionIds.has(criterionId))
      || (requirement.readBackRequired && actual.readBack !== "matched")) return false;
    // The reader and the reviewed snapshot cannot attest different bytes for
    // the same changed file. Evidence for a separate, unchanged artifact still
    // has its existing requirement/source checks; it need not be a planned edit.
    const reviewedArtifact = actual.artifactPath === null ? undefined : changed.get(pathKey(actual.artifactPath));
    if (reviewedArtifact !== undefined && actual.artifactDigest !== reviewedArtifact.contentDigest) return false;
    const sourceBound = requirement.kind === "test-receipt"
      ? actual.source === "test-runner" && actual.commandId !== null && commandIds.has(actual.commandId)
      : requirement.kind === "review-receipt"
        ? actual.source === "reviewer" && actual.commandId === null && actual.artifactDigest === evidence.receiptDigests.reviewer
        : requirement.kind === "verification-receipt"
          ? actual.source === "verifier" && actual.commandId === null && actual.artifactDigest === evidence.receiptDigests.verifier
          : actual.source === "artifact-reader" && actual.commandId === null;
    const builderReceiptBound = requirement.kind !== "test-receipt"
      || actual.artifactDigest === evidence.receiptDigests.builder;
    return sourceBound && builderReceiptBound;
  });
}

function verifyCompiledContext(
  task: AgentWorkTask,
  proposal: AgentChangeProposal,
  driftReport: AgentRulesDriftReport,
  context: AgentCompiledTaskContext,
): boolean {
  try {
    // Parsing a digest-shaped string is not read-back. Reuse the compiler's
    // bounded byte/hash, scope, classification, relevance and secret checks,
    // then compare the whole deterministic representation, including its digest.
    const rebuilt = compileAgentTaskContext(task, proposal, driftReport,
      [...context.currentInstructions, ...context.historicalEvidence], { now: () => context.compiledAt });
    return canonicalSha256Digest(rebuilt) === canonicalSha256Digest(context);
  } catch {
    // Do not leak context or schema diagnostics through the redacted result.
    return false;
  }
}

function verifyChangedArtifacts(task: AgentWorkTask, proposal: AgentChangeProposal, evidence: AgentWorkEvidence): boolean {
  const planned = [...proposal.changedArtifacts.map((artifact) => pathKey(artifact.relativePath))].sort(compareCodeUnits);
  const changed = [...evidence.changedArtifacts.map((artifact) => pathKey(artifact.relativePath))].sort(compareCodeUnits);
  if (!equalJson(planned, changed)) return false;
  if (evidence.changedArtifacts.some((artifact) => artifact.readBack !== "matched")) return false;
  const changedSet = new Set(changed);
  return task.expectedArtifactPaths.every((path) => changedSet.has(pathKey(path)));
}

function normalizedChangedArtifacts(changedArtifacts: AgentWorkEvidence["changedArtifacts"]): readonly {
  readonly relativePath: string;
  readonly contentDigest: string;
}[] {
  return changedArtifacts
    .map((artifact) => ({ relativePath: artifact.relativePath, contentDigest: artifact.contentDigest }))
    .sort((left, right) => compareCodeUnits(pathKey(left.relativePath), pathKey(right.relativePath)));
}

function collectMissing(
  findings: AgentRulesDriftFinding[],
  kind: AgentDriftReferenceKind,
  expected: readonly string[],
  actual: ReadonlySet<string>,
  reasonCode: AgentDriftReasonCode,
): void {
  for (const reference of expected) {
    if (!actual.has(reference)) findings.push(finding(kind, reference, reasonCode));
  }
}

function finding(
  kind: AgentDriftReferenceKind,
  reference: string,
  reasonCode: AgentDriftReasonCode,
): AgentRulesDriftFinding {
  return deepFreeze({ kind, reference, reasonCode });
}

function compareFinding(left: AgentRulesDriftFinding, right: AgentRulesDriftFinding): number {
  return compareCodeUnits(`${left.kind}\u0000${left.reference}\u0000${left.reasonCode}`, `${right.kind}\u0000${right.reference}\u0000${right.reasonCode}`);
}

function compareContextEntry(left: AgentTaskContextEntry, right: AgentTaskContextEntry): number {
  return compareCodeUnits(left.contextId, right.contextId);
}

function uniqueSorted(values: readonly string[], key: (value: string) => string): readonly string[] {
  const byKey = new Map<string, string>();
  for (const value of values) byKey.set(key(value), value);
  return [...byKey.values()].sort((left, right) => compareCodeUnits(key(left), key(right)));
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function pathKey(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function safeTime(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error("agent-workflow-clock-invalid");
  }
  return value;
}
