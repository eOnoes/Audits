import { canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import {
  AGENT_CHANGE_PROPOSAL_SCHEMA_VERSION,
  AGENT_MANDATORY_FORBIDDEN_ACTIONS,
  AGENT_RULES_INVENTORY_SCHEMA_VERSION,
  AGENT_WORK_EVIDENCE_SCHEMA_VERSION,
  AGENT_WORK_TASK_SCHEMA_VERSION,
  checkAgentRulesDrift,
  compileAgentTaskContext,
  computeAgentBuilderReceiptDigest,
  computeAgentFrozenCommandDigest,
  computeAgentReviewerReceiptDigest,
  computeAgentReviewSnapshotDigest,
  computeAgentVerifierReceiptDigest,
  computeAgentWorkTaskDigest,
} from "../../src/builder/index.js";
import { sha256BuilderDigest } from "../../src/builder/content-policy.js";
import type {
  AgentChangeProposal,
  AgentCompiledTaskContext,
  AgentRulesDriftReport,
  AgentRulesInventory,
  AgentTaskContextEntry,
  AgentWorkEvidence,
  AgentWorkTask,
} from "../../src/builder/index.js";

const NOW = "2026-09-02T04:00:00.000Z";
const LATER = "2026-09-02T04:15:00.000Z";
const ZERO = `sha256:${"0".repeat(64)}`;

function contentEntry(
  contextId: string,
  classification: AgentTaskContextEntry["classification"],
  sourcePath: string | null,
  relevanceTags: readonly string[],
  content: string,
): AgentTaskContextEntry {
  const bytes = new TextEncoder().encode(content);
  return {
    contextId,
    classification,
    sourcePath,
    relevanceTags,
    content,
    contentDigest: sha256BuilderDigest(bytes),
    bytes: bytes.byteLength,
  };
}

export interface AgentWorkflowFixture {
  readonly task: AgentWorkTask;
  readonly proposal: AgentChangeProposal;
  readonly inventory: AgentRulesInventory;
  readonly drift: AgentRulesDriftReport;
  readonly contextEntries: readonly AgentTaskContextEntry[];
  readonly context: AgentCompiledTaskContext;
  readonly evidence: AgentWorkEvidence;
}

export function createAgentWorkflowFixture(openRiskCodes: readonly string[] = []): AgentWorkflowFixture {
  const task = {
    schemaVersion: AGENT_WORK_TASK_SCHEMA_VERSION,
    taskId: "agent-workflow-fixture",
    sessionId: "session-agent-workflow",
    profileId: "builder",
    objective: "Add a drift-checked Agent workflow contract with independent review and read-back evidence.",
    builderScopeDigest: ZERO,
    allowedReadFiles: [
      "src/builder/agent-workflow.ts",
      "tests/unit/agent-workflow.test.ts",
      "docs/handoff/WORK_agent-workflow-fixture.md",
    ],
    allowedWriteFiles: [
      "src/builder/agent-workflow.ts",
      "tests/unit/agent-workflow.test.ts",
      "docs/handoff/WORK_agent-workflow-fixture.md",
    ],
    expectedArtifactPaths: [
      "src/builder/agent-workflow.ts",
      "tests/unit/agent-workflow.test.ts",
    ],
    handoffPath: "docs/handoff/WORK_agent-workflow-fixture.md",
    commands: [
      {
        commandId: "compile-tests",
        verificationId: "test-compile",
        executable: "npm",
        arguments: ["run", "test:compile"],
        workingDirectory: ".",
        shell: false,
        effect: "verification",
      },
      {
        commandId: "run-workflow-tests",
        verificationId: "workflow-tests",
        executable: "node",
        arguments: ["--test", ".test-dist/tests/unit/agent-workflow.test.js"],
        workingDirectory: ".",
        shell: false,
        effect: "verification",
      },
    ],
    acceptanceCriteria: [
      {
        criterionId: "workflow-contract-verified",
        description: "The exact workflow contracts compile, pass tests, receive fresh review, and read back both changed artifacts.",
        verificationIds: ["test-compile", "workflow-tests"],
        requiredEvidenceIds: [
          "test-receipt",
          "review-receipt",
          "verification-receipt",
          "source-readback",
          "test-readback",
        ],
      },
    ],
    forbiddenActions: [
      ...AGENT_MANDATORY_FORBIDDEN_ACTIONS,
      "unscoped-read",
      "unscoped-write",
      "file-delete",
      "git-commit",
      "git-push",
      "git-tag",
      "release",
      "live-integration",
      "durable-memory-write",
    ],
    evidenceRequirements: [
      { evidenceId: "test-receipt", kind: "test-receipt", artifactPath: null, readBackRequired: false },
      { evidenceId: "review-receipt", kind: "review-receipt", artifactPath: null, readBackRequired: false },
      { evidenceId: "verification-receipt", kind: "verification-receipt", artifactPath: null, readBackRequired: false },
      { evidenceId: "source-readback", kind: "artifact-readback", artifactPath: "src/builder/agent-workflow.ts", readBackRequired: true },
      { evidenceId: "test-readback", kind: "artifact-readback", artifactPath: "tests/unit/agent-workflow.test.ts", readBackRequired: true },
    ],
    stopConditions: {
      maxImplementationPasses: 1,
      maxTargetedFixPasses: 1,
      stopOnAcceptancePassed: true,
      stopOnBlocked: true,
      stopOnBudgetExhausted: true,
    },
    ruleReferences: {
      scripts: ["test:compile"],
      modelIds: ["gpt-5.6-sol"],
      serviceNames: ["onoes-agent"],
      authorityClaims: ["agent-workflow-authority:none"],
    },
    contextTags: ["requirements", "workflow"],
    maxContextBytes: 16_384,
    createdAt: NOW,
    expiresAt: LATER,
    authority: "none",
  } satisfies AgentWorkTask;
  const taskDigest = computeAgentWorkTaskDigest(task);
  const proposal = {
    schemaVersion: AGENT_CHANGE_PROPOSAL_SCHEMA_VERSION,
    proposalId: "proposal-agent-workflow",
    taskId: task.taskId,
    taskDigest,
    builderActorId: "builder-1",
    summary: "Add the bounded Agent workflow contract and its deterministic verification coverage.",
    changedArtifacts: [
      { relativePath: "src/builder/agent-workflow.ts", action: "update" },
      { relativePath: "tests/unit/agent-workflow.test.ts", action: "create" },
    ],
    verificationCommandIds: ["compile-tests", "run-workflow-tests"],
    acceptanceCriterionIds: ["workflow-contract-verified"],
    iteration: { implementationPass: 1, targetedFixPass: 0 },
    reviewerRequired: true,
    verifierRequired: true,
    knownRiskCodes: openRiskCodes,
    authority: "none",
  } satisfies AgentChangeProposal;
  const inventory = {
    schemaVersion: AGENT_RULES_INVENTORY_SCHEMA_VERSION,
    sourceRevision: "1".repeat(40),
    runtimeIdentityDigest: `sha256:${"2".repeat(64)}`,
    generatedAt: NOW,
    paths: task.allowedReadFiles.map((relativePath, index) => ({
      relativePath,
      contentDigest: `sha256:${String(index + 3).repeat(64)}`,
    })),
    commands: task.commands,
    scripts: [{ scriptId: "test:compile", relativePath: "package.json", contentDigest: `sha256:${"6".repeat(64)}` }],
    modelIds: ["gpt-5.6-sol"],
    serviceNames: ["onoes-agent"],
    authorityClaims: ["agent-workflow-authority:none"],
    authority: "none",
  } satisfies AgentRulesInventory;
  const drift = checkAgentRulesDrift(task, inventory, { now: () => NOW });
  const contextEntries = [
    contentEntry(
      "current-requirements",
      "current-instruction",
      null,
      ["requirements"],
      "Use exact scope, frozen verification, fresh review, direct read-back, and bounded iteration.",
    ),
    contentEntry(
      "historical-workflow",
      "historical-evidence",
      "src/builder/agent-workflow.ts",
      ["workflow"],
      "The existing Builder layer already owns bounded inspection, delegation, review, and content-free receipts.",
    ),
  ];
  const context = compileAgentTaskContext(task, proposal, drift, contextEntries, { now: () => NOW });
  const proposalDigest = canonicalSha256Digest(proposal);
  const sourceDigest = `sha256:${"7".repeat(64)}`;
  const testDigest = `sha256:${"8".repeat(64)}`;
  const changedArtifacts = [
    { relativePath: "src/builder/agent-workflow.ts", contentDigest: sourceDigest, readBack: "matched" as const },
    { relativePath: "tests/unit/agent-workflow.test.ts", contentDigest: testDigest, readBack: "matched" as const },
  ];
  const reviewSnapshotDigest = computeAgentReviewSnapshotDigest(taskDigest, proposalDigest, changedArtifacts);
  const review = {
    reviewId: "review-agent-workflow",
    reviewerActorId: "reviewer-1",
    builderActorId: proposal.builderActorId,
    proposalDigest,
    reviewSnapshotDigest,
    decision: "pass" as const,
    findingCodes: [],
    reviewedAt: NOW,
  };
  const verification = {
    verificationId: "verification-agent-workflow",
    verifierActorId: "verifier-1",
    builderActorId: proposal.builderActorId,
    proposalDigest,
    reviewSnapshotDigest,
    commandResults: task.commands.map((command, index) => ({
      commandId: command.commandId,
      commandDigest: computeAgentFrozenCommandDigest(command),
      status: "passed" as const,
      resultDigest: `sha256:${String.fromCharCode(100 + index).repeat(64)}`,
    })),
    criterionResults: [{
      criterionId: "workflow-contract-verified",
      status: "passed" as const,
      evidenceIds: ["test-receipt", "review-receipt", "verification-receipt", "source-readback", "test-readback"],
    }],
    verifiedAt: NOW,
  };
  const receiptBase = {
    schemaVersion: AGENT_WORK_EVIDENCE_SCHEMA_VERSION,
    taskId: task.taskId,
    taskDigest,
    proposalDigest,
    contextDigest: context.contextDigest,
    driftReportDigest: canonicalSha256Digest(drift),
    iteration: proposal.iteration,
    changedArtifacts,
  };
  const receiptDigests = {
    builder: computeAgentBuilderReceiptDigest(receiptBase),
    reviewer: computeAgentReviewerReceiptDigest(review),
    verifier: computeAgentVerifierReceiptDigest(verification),
  };
  const observedEvidence = [
    { evidenceId: "test-receipt", kind: "test-receipt", status: "passed", artifactPath: null, artifactDigest: receiptDigests.builder, commandId: "run-workflow-tests", criterionIds: ["workflow-contract-verified"], readBack: "not-required", source: "test-runner" },
    { evidenceId: "review-receipt", kind: "review-receipt", status: "passed", artifactPath: null, artifactDigest: receiptDigests.reviewer, commandId: null, criterionIds: ["workflow-contract-verified"], readBack: "not-required", source: "reviewer" },
    { evidenceId: "verification-receipt", kind: "verification-receipt", status: "passed", artifactPath: null, artifactDigest: receiptDigests.verifier, commandId: null, criterionIds: ["workflow-contract-verified"], readBack: "not-required", source: "verifier" },
    { evidenceId: "source-readback", kind: "artifact-readback", status: "passed", artifactPath: "src/builder/agent-workflow.ts", artifactDigest: sourceDigest, commandId: null, criterionIds: ["workflow-contract-verified"], readBack: "matched", source: "artifact-reader" },
    { evidenceId: "test-readback", kind: "artifact-readback", status: "passed", artifactPath: "tests/unit/agent-workflow.test.ts", artifactDigest: testDigest, commandId: null, criterionIds: ["workflow-contract-verified"], readBack: "matched", source: "artifact-reader" },
  ] as const;
  const evidence = {
    ...receiptBase,
    observedEvidence,
    review,
    verification,
    receiptDigests,
    openRiskCodes,
    authority: "none",
  } satisfies AgentWorkEvidence;
  return { task, proposal, inventory, drift, contextEntries, context, evidence };
}
