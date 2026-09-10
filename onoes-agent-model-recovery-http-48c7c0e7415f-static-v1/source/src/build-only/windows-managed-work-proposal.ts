import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { containsSecretLikeContent } from "../builder/content-policy.js";
import { agentWorkTaskSchema, agentFrozenCommandSchema } from "../builder/agent-workflow-schemas.js";
import { bindAgentWorkTaskToBuilderScope, bindAgentChangeProposalToWorkTask, computeAgentWorkTaskDigest,
  computeAgentChangeProposalDigest, computeAgentFrozenCommandDigest } from "../builder/agent-workflow.js";
import { AGENT_CHANGE_PROPOSAL_SCHEMA_VERSION, AGENT_FORBIDDEN_ACTIONS } from "../builder/agent-workflow-types.js";
import { builderTaskScopeSchema, parseBuilderPatchPlan } from "../builder/schemas.js";
import { BUILDER_CONTRACT_VERSION } from "../builder/types.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { isManagedPlanningContext, isManagedEditCandidate } from "./windows-managed-planning-context.js";
import { isManagedTaskInspection } from "./windows-managed-task-inspection.js";

// Description composition only. A host pin is not executable custody, a rules
// inventory, fresh review, operator consent or a lease. No launch/recording API.
export const MANAGED_WORK_PROPOSAL_LIMITS = Object.freeze({ inputBytes: 262_144, outputBytes: 4_194_304 });
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const exactTime = (v: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const bindingSchema = z.object({ command: agentFrozenCommandSchema, commandDigest: digest,
  catalogDigest: digest, definitionDigest: digest, commandContractDigest: digest }).strict();
const requestSchema = z.object({ schemaVersion: z.literal("agent-managed-work-proposal-input/v1"),
  contextDigest: digest, candidateDigest: digest, task: agentWorkTaskSchema, scope: builderTaskScopeSchema,
  proposalId: id, planId: id, builderActorId: id,
  iteration: z.object({ implementationPass: z.literal(1), targetedFixPass: z.number().int().min(0).max(2) }).strict(),
  knownRiskCodes: z.array(z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/)).max(64)
    .refine(values => new Set(values).size === values.length),
}).strict();
type Reason = "input-invalid" | "budget-exceeded" | "producer-untrusted" | "binding-mismatch" | "command-mismatch"
  | "scope-mismatch" | "evidence-incomplete" | "clock-invalid" | "task-expired";
export class ManagedWorkProposalError extends Error {
  constructor(readonly reason: Reason) { super(`managed-work-proposal-${reason}`); this.name = "ManagedWorkProposalError"; }
}
const fail = (reason: Reason): never => { throw new ManagedWorkProposalError(reason); };
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const samePaths = (a: readonly string[], b: readonly string[]) => same([...a].sort(), [...b].sort());
export interface ManagedWorkProposalOptions {
  /** Explicit host-owned description, never extracted from a caller task. */
  readonly commandBinding: z.infer<typeof bindingSchema>;
  readonly now?: () => string;
}

export class WindowsManagedWorkProposalComposer {
  readonly #binding: z.infer<typeof bindingSchema>;
  readonly #now: () => string;
  #lastTime = "";
  #clockFailed = false;
  constructor(options: ManagedWorkProposalOptions) {
    try {
      this.#binding = deepFreeze(bindingSchema.parse(options.commandBinding));
      if (computeAgentFrozenCommandDigest(this.#binding.command) !== this.#binding.commandDigest
        || this.#binding.command.effect !== "verification" || containsSecretLikeContent(canonicalJson(this.#binding))) throw new ManagedWorkProposalError("command-mismatch");
    } catch { throw new ManagedWorkProposalError("command-mismatch"); }
    this.#now = options.now ?? (() => new Date().toISOString());
  }
  #time(): string {
    let value = ""; try { value = this.#now(); } catch { this.#clockFailed = true; }
    if (this.#clockFailed || typeof value !== "string" || !exactTime(value) || value < this.#lastTime) {
      this.#clockFailed = true; return fail("clock-invalid");
    }
    this.#lastTime = value; return value;
  }
  compose(contextInput: unknown, candidateInput: unknown, inspectionInput: unknown, wire: unknown) {
    try {
      if (!isManagedPlanningContext(contextInput) || !isManagedEditCandidate(candidateInput) || !isManagedTaskInspection(inspectionInput))
        return fail("producer-untrusted");
      const context = contextInput, candidate = candidateInput, inspection = inspectionInput;
      if (typeof wire !== "string") return fail("input-invalid");
      if (Buffer.byteLength(wire) > MANAGED_WORK_PROPOSAL_LIMITS.inputBytes) return fail("budget-exceeded");
      const raw: unknown = JSON.parse(wire), request = requestSchema.parse(raw);
      if (canonicalJson(raw) !== wire || !same(raw, request) || containsSecretLikeContent(wire)) return fail("input-invalid");
      if (request.contextDigest !== context.contextDigest || request.candidateDigest !== candidate.candidateDigest
        || candidate.contextDigest !== context.contextDigest || candidate.inspectionDigest !== inspection.inspectionDigest
        || context.inspectionDigest !== inspection.inspectionDigest || candidate.briefDigest !== context.briefDigest
        || context.briefDigest !== inspection.briefDigest || !same(context.workspace, inspection.workspace)
        || !same(candidate.workspace, inspection.workspace) || !same(context.policyBinding, inspection.policyBinding)
        || !same(candidate.policyBinding, inspection.policyBinding)) return fail("binding-mismatch");
      const { task: taskInput, scope } = request, instructions = context.currentInstructions, binding = this.#binding;
      if (binding.catalogDigest !== context.verification.catalogDigest || binding.definitionDigest !== context.verification.definitionDigest
        || binding.commandContractDigest !== context.verification.definition.commandContractDigest
        || binding.command.verificationId !== candidate.verificationId || candidate.catalogDigest !== binding.catalogDigest
        || candidate.definitionDigest !== binding.definitionDigest || taskInput.commands.length !== 1
        || !same(taskInput.commands[0], binding.command) || !same(scope.allowedVerificationIds, [binding.command.verificationId])) return fail("command-mismatch");
      const now = this.#time();
      if (![scope.issuedAt, scope.expiresAt, taskInput.createdAt, taskInput.expiresAt].every(exactTime)) return fail("input-invalid");
      if (now < scope.issuedAt || now < taskInput.createdAt || now >= scope.expiresAt || now >= taskInput.expiresAt) return fail("task-expired");
      const task = bindAgentWorkTaskToBuilderScope(taskInput, scope);
      if (scope.repositoryRoot !== inspection.workspace.repositoryRoot || scope.worktreeRoot !== inspection.workspace.worktreeRoot
        || scope.worktreeAttestationDigest !== inspection.workspace.worktreeAttestationDigest
        || !samePaths(task.allowedReadFiles, instructions.allowedReadFiles) || !samePaths(task.allowedWriteFiles, instructions.allowedWriteFiles)
        || task.objective !== instructions.objective || !same(task.acceptanceCriteria.map(c => c.description), instructions.acceptanceCriteria)
        || !samePaths(task.forbiddenActions, AGENT_FORBIDDEN_ACTIONS)
        || task.stopConditions.maxImplementationPasses !== 1 || task.stopConditions.maxTargetedFixPasses > instructions.maxTargetedFixPasses
        || !task.allowedWriteFiles.includes(task.handoffPath)) return fail("scope-mismatch");
      const changed = candidate.files.map(f => f.relativePath);
      // Legacy schema path equivalence must not broaden this new exact-spelling
      // boundary. The legacy formats themselves remain untouched.
      if (!samePaths(task.expectedArtifactPaths, changed)
        || task.evidenceRequirements.some(e => e.artifactPath !== null && !task.allowedReadFiles.includes(e.artifactPath))) return fail("evidence-incomplete");
      const mandatoryEvidence = task.evidenceRequirements.filter(e => ["test-receipt", "review-receipt", "verification-receipt"].includes(e.kind));
      const required = new Set(mandatoryEvidence.map(e => e.evidenceId));
      for (const path of changed) {
        const evidence = task.evidenceRequirements.find(e => e.kind === "artifact-readback" && e.artifactPath === path && e.readBackRequired);
        if (!evidence) return fail("evidence-incomplete"); required.add(evidence.evidenceId);
      }
      if (task.acceptanceCriteria.some(c => !same(c.verificationIds, [binding.command.verificationId])
        || [...required].some(id => !c.requiredEvidenceIds.includes(id)))) return fail("evidence-incomplete");
      const postimages = new Map(candidate.files.map(f => [f.relativePath, f.afterBytes]));
      const afterBytes = inspection.files.reduce((n, file) => n + (postimages.get(file.relativePath) ?? file.byteLength), 0);
      if (!samePaths(inspection.files.map(f => f.relativePath), scope.allowedReadFiles)
        || candidate.operationCount > scope.maxPatchOperations || inspection.totalBytes > scope.maxTotalBytes || afterBytes > scope.maxTotalBytes
        || inspection.files.some(f => Math.max(f.byteLength, postimages.get(f.relativePath) ?? 0) > scope.maxFileBytes)
        || context.contentBytes > task.maxContextBytes) return fail("budget-exceeded");
      const plan = parseBuilderPatchPlan({ contractVersion: BUILDER_CONTRACT_VERSION, planId: request.planId, taskId: task.taskId,
        verificationId: binding.command.verificationId, patches: candidate.request.patches });
      const proposal = bindAgentChangeProposalToWorkTask(task, { schemaVersion: AGENT_CHANGE_PROPOSAL_SCHEMA_VERSION,
        proposalId: request.proposalId, taskId: task.taskId, taskDigest: computeAgentWorkTaskDigest(task), builderActorId: request.builderActorId,
        summary: candidate.request.summary, changedArtifacts: changed.map(relativePath => ({ relativePath, action: "update" })),
        verificationCommandIds: [binding.command.commandId], acceptanceCriterionIds: task.acceptanceCriteria.map(c => c.criterionId),
        iteration: request.iteration, reviewerRequired: true, verifierRequired: true, knownRiskCodes: request.knownRiskCodes, authority: "none" });
      const core = { schemaVersion: "agent-managed-work-proposal/v1" as const, kind: "exact-task-and-predicted-edits-not-approval" as const,
        status: "requires-rules-review-and-approval" as const, requestDigest: canonicalSha256Digest(request),
        contextDigest: context.contextDigest, candidateDigest: candidate.candidateDigest, inspectionDigest: inspection.inspectionDigest,
        workspace: structuredClone(inspection.workspace), policyBinding: structuredClone(inspection.policyBinding),
        task, taskDigest: computeAgentWorkTaskDigest(task), scope, plan, proposal, proposalDigest: computeAgentChangeProposalDigest(proposal),
        commandBinding: structuredClone(binding),
        predictedFiles: candidate.files.map(f => ({ relativePath: f.relativePath, preimageDigest: f.preimageDigest,
          predictedPostimageDigest: f.predictedPostimageDigest, beforeBytes: f.beforeBytes, afterBytes: f.afterBytes })),
        handoff: { relativePath: task.handoffPath, written: false as const, requiresSeparateBoundedGeneration: true as const },
        runtimeRulesVerified: false as const, reviewCompleted: false as const, approvalAvailable: false as const,
        executionEnabled: false as const, persisted: false as const, authority: "none" as const };
      // Independent object trees avoid canonical alias ambiguity; no mutation of
      // historical task/scope/plan bytes or manufacturing of signed evidence.
      const snapshot = JSON.parse(JSON.stringify(core)) as typeof core;
      const result = deepFreeze({ ...snapshot, workProposalDigest: canonicalSha256Digest(snapshot) });
      if (Buffer.byteLength(canonicalJson(result)) > MANAGED_WORK_PROPOSAL_LIMITS.outputBytes) return fail("budget-exceeded");
      const end = this.#time(); if (end >= task.expiresAt || end >= scope.expiresAt) return fail("task-expired");
      return result;
    } catch (error) { if (error instanceof ManagedWorkProposalError) throw error; return fail("input-invalid"); }
  }
}
