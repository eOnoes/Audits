import { randomUUID } from "node:crypto";
import { win32 } from "node:path";
import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { containsSecretLikeContent } from "../builder/content-policy.js";
import { computeBuilderInspectionScopeDigest, isSafeBuilderRelativePath } from "../builder/schemas.js";
import { AGENT_FORBIDDEN_ACTIONS, AGENT_WORK_TASK_SCHEMA_VERSION } from "../builder/agent-workflow-types.js";
import { BUILDER_CONTRACT_VERSION } from "../builder/types.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { createWindowsOperatorTaskIntake } from "./windows-operator-task-intake.js";
import type { SqliteWindowsOperatorTaskStore } from "./windows-operator-task-store.js";
import { parseWindowsWorkspacePolicy, previewWindowsWorkspaceAccess } from "./windows-workspace-policy.js";
import { isManagedTaskInspection, type ManagedTaskInspectionOptions } from "./windows-managed-task-inspection.js";
import { isManagedPlanningContext, isManagedEditCandidate } from "./windows-managed-planning-context.js";
import { isResolvedManagedVerificationDefinition, type ResolvedManagedVerificationDefinition } from "./windows-managed-verification-catalog.js";
import { WindowsManagedWorkProposalComposer, type ManagedWorkProposalOptions } from "./windows-managed-work-proposal.js";

// Plan descriptions only. No filesystem adapter, provider, command launcher,
// persistence, lease or approval. A later session must independently enforce
// current inspection lifetime before passing materialized input to the composer.
export const MANAGED_WORK_PLAN_LIMITS = Object.freeze({ inputBytes: 4096, descriptionBytes: 262_144,
  lifetimeMs: 900_000, fileBytes: 1_048_576, totalBytes: 8_388_608,
  patchOperations: 10_000, contextBytes: 262_144, targetedFixPasses: 2 });
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const selectorSchema = z.object({ storeId: uuid, taskId: uuid, creationEpoch: z.number().int().min(1).max(1_000_000_000),
  expectedRevision: z.number().int().min(1).max(63) }).strict();
const choicesSchema = z.object({ handoffPath: z.string().refine(isSafeBuilderRelativePath),
  maxFileBytes: z.number().int().min(1).max(MANAGED_WORK_PLAN_LIMITS.fileBytes),
  maxTotalBytes: z.number().int().min(1).max(MANAGED_WORK_PLAN_LIMITS.totalBytes),
  maxPatchOperations: z.number().int().min(1).max(MANAGED_WORK_PLAN_LIMITS.patchOperations),
  maxContextBytes: z.number().int().min(1).max(MANAGED_WORK_PLAN_LIMITS.contextBytes),
  lifetimeMs: z.number().int().min(1000).max(MANAGED_WORK_PLAN_LIMITS.lifetimeMs),
  maxTargetedFixPasses: z.number().int().min(0).max(MANAGED_WORK_PLAN_LIMITS.targetedFixPasses),
  knownRiskCodes: z.array(z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/)).max(64)
    .refine(v => new Set(v).size === v.length),
}).strict().refine(v => v.maxFileBytes <= v.maxTotalBytes);
const requestSchema = z.object({ schemaVersion: z.literal("agent-managed-work-plan-input/v1"), selector: selectorSchema,
  expectedDescriptionDigest: digest, choices: choicesSchema, confirmDescriptionOnly: z.literal(true) }).strict();
const workspaceSchema = z.object({ workspaceDigest: digest, repositoryRoot: z.string().min(1).max(2048),
  worktreeRoot: z.string().min(1).max(2048), worktreeAttestationDigest: digest }).strict();
type Selector = z.infer<typeof selectorSchema>;
type Draft = ReturnType<SqliteWindowsOperatorTaskStore["read"]>;
type Choices = z.infer<typeof choicesSchema>;
export interface ManagedWorkPlanOptions {
  readonly drafts: Pick<SqliteWindowsOperatorTaskStore, "read" | "readCreationEpoch">;
  readonly policy: ManagedTaskInspectionOptions["policy"];
  readonly workspace: ManagedTaskInspectionOptions["workspace"];
  readonly verification: ResolvedManagedVerificationDefinition;
  readonly commandBinding: ManagedWorkProposalOptions["commandBinding"];
  /** Host label only, not a verified reviewer identity or approval. */
  readonly builderActorId: string;
  readonly now?: () => string;
}
type Reason = "input-invalid" | "host-binding-invalid" | "draft-unavailable" | "draft-changed" | "policy-denied"
  | "recovery-pending" | "plan-untrusted" | "plan-expired" | "clock-invalid" | "subject-mismatch" | "budget-exceeded";
export class ManagedWorkPlanError extends Error {
  constructor(readonly reason: Reason) { super(`managed-work-plan-${reason}`); this.name = "ManagedWorkPlanError"; }
}
const fail = (reason: Reason): never => { throw new ManagedWorkPlanError(reason); };
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const exactTime = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
function parseWire<T>(wire: unknown, schema: z.ZodType<T>): T {
  try {
    if (typeof wire !== "string" || Buffer.byteLength(wire) > MANAGED_WORK_PLAN_LIMITS.inputBytes || containsSecretLikeContent(wire)) return fail("input-invalid");
    const raw: unknown = JSON.parse(wire), parsed = schema.parse(raw);
    if (canonicalJson(raw) !== wire || !same(raw, parsed)) return fail("input-invalid");
    return deepFreeze(parsed);
  } catch { return fail("input-invalid"); }
}
function planRecord(description: ReturnType<WindowsManagedWorkPlanCompiler["describe"]>, choices: Choices, createdAt: string) {
  const core = { schemaVersion: "agent-managed-work-plan/v1" as const, kind: "bounded-plan-description-not-approval" as const,
    description, choices, sessionId: randomUUID(), planId: randomUUID(), proposalId: randomUUID(),
    createdAt, expiresAt: new Date(Date.parse(createdAt) + choices.lifetimeMs).toISOString(),
    fixedWorkflow: { implementationPasses: 1, mandatoryEvidence: ["test-receipt", "review-receipt", "verification-receipt", "artifact-readback"],
      sourceHandling: "data-not-instructions", handoffWritten: false, runtimeRulesVerified: false },
    liveFilesRead: false as const, persisted: false as const, approvalAvailable: false as const, executionEnabled: false as const, authority: "none" as const };
  return deepFreeze({ ...core, workPlanDigest: canonicalSha256Digest(core) });
}
export type ManagedWorkPlan = ReturnType<typeof planRecord>;

export class WindowsManagedWorkPlanCompiler {
  readonly #drafts: ManagedWorkPlanOptions["drafts"];
  readonly #policy: ManagedWorkPlanOptions["policy"];
  readonly #workspace: ManagedWorkPlanOptions["workspace"];
  readonly #binding: ManagedWorkPlanOptions["commandBinding"];
  readonly #verification: ResolvedManagedVerificationDefinition;
  readonly #actor: string;
  readonly #now: () => string;
  readonly #issued = new WeakSet<object>();
  #lastTime = "";
  #clockFailed = false;
  constructor(options: ManagedWorkPlanOptions) {
    try {
      if (!isResolvedManagedVerificationDefinition(options.verification)) throw new ManagedWorkPlanError("host-binding-invalid");
      const binding = structuredClone(options.commandBinding), verification = options.verification;
      new WindowsManagedWorkProposalComposer({ commandBinding: binding }); // existing strict command/secret checks
      if (binding.catalogDigest !== verification.catalogDigest || binding.definitionDigest !== verification.definitionDigest
        || binding.commandContractDigest !== verification.definition.commandContractDigest
        || binding.command.verificationId !== verification.definition.verificationId) throw new ManagedWorkPlanError("host-binding-invalid");
      this.#workspace = deepFreeze(workspaceSchema.parse(options.workspace));
      for (const path of [this.#workspace.repositoryRoot, this.#workspace.worktreeRoot])
        parseWindowsWorkspacePolicy({ schemaVersion: "agent-windows-workspace-policy/v1", revision: 1, allowedRoots: [{ path, access: "read-only" }], deniedRoots: [] });
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(options.builderActorId)) throw new ManagedWorkPlanError("host-binding-invalid");
      this.#binding = deepFreeze(binding); this.#verification = verification; this.#actor = options.builderActorId;
    } catch { throw new ManagedWorkPlanError("host-binding-invalid"); }
    this.#drafts = options.drafts; this.#policy = options.policy; this.#now = options.now ?? (() => new Date().toISOString());
  }
  #time(): string {
    let now: unknown; try { now = this.#now(); } catch { this.#clockFailed = true; }
    if (this.#clockFailed || !exactTime(now) || now < this.#lastTime || Date.parse(now) > 253402300799999 - MANAGED_WORK_PLAN_LIMITS.lifetimeMs) {
      this.#clockFailed = true; return fail("clock-invalid");
    }
    this.#lastTime = now; return now;
  }
  #current(selector: Selector): Draft {
    let draft: Draft;
    try {
      if (this.#drafts.readCreationEpoch().storeId !== selector.storeId) return fail("draft-unavailable");
      draft = this.#drafts.read(selector.taskId, selector.creationEpoch);
      if (draft.closed || draft.revision !== selector.expectedRevision) return fail("draft-changed");
    } catch (e) { if (e instanceof ManagedWorkPlanError) throw e; return fail("draft-unavailable"); }
    try {
      const snapshot = this.#policy.snapshot(), brief = createWindowsOperatorTaskIntake(canonicalJson(draft.brief), snapshot);
      if (brief.draftDigest !== draft.intakeDigest || brief.request.workspaceRoot !== this.#workspace.repositoryRoot) return fail("subject-mismatch");
      for (const operation of ["read", "write"] as const) {
        const paths = operation === "read" ? brief.request.requestedReadFiles : brief.request.requestedWriteFiles;
        for (const relative of paths) if (previewWindowsWorkspaceAccess(snapshot.policy, { path: win32.join(this.#workspace.worktreeRoot, relative), operation })
          .decision !== "requires-filesystem-validation") return fail("policy-denied");
      }
      if (this.#policy.listEffectIntents().some(r => r.settlement === null || r.settlement.outcome === "quarantined")) return fail("recovery-pending");
      this.#policy.assertCurrentBinding(brief.request.expectedBinding);
    } catch (e) { if (e instanceof ManagedWorkPlanError) throw e; return fail("policy-denied"); }
    return draft;
  }
  /** Read-only current metadata. Does not open a custody session or start the
   * inspection lifetime. Callers must explicitly review the command and limits. */
  describe(selectorWire: unknown) {
    const selector = parseWire(selectorWire, selectorSchema), draft = this.#current(selector);
    const core = { schemaVersion: "agent-managed-work-plan-description/v1" as const,
      kind: "host-command-and-saved-intent-not-execution" as const, selector, briefDigest: draft.briefDigest, intakeDigest: draft.intakeDigest,
      brief: structuredClone(draft.brief), workspace: structuredClone(this.#workspace), commandBinding: structuredClone(this.#binding),
      verification: structuredClone(this.#verification), builderActorId: this.#actor, limits: { ...MANAGED_WORK_PLAN_LIMITS },
      policyCheck: "lexical-only" as const, liveFilesRead: false as const, approvalAvailable: false as const, executionEnabled: false as const, authority: "none" as const };
    const result = deepFreeze({ ...core, descriptionDigest: canonicalSha256Digest(core) });
    if (Buffer.byteLength(canonicalJson(result)) > MANAGED_WORK_PLAN_LIMITS.descriptionBytes) return fail("budget-exceeded");
    if (!same(this.#current(selector), draft)) return fail("draft-changed");
    return result;
  }
  prepare(wire: unknown): ManagedWorkPlan {
    const input = parseWire(wire, requestSchema), description = this.describe(canonicalJson(input.selector));
    if (input.expectedDescriptionDigest !== description.descriptionDigest) return fail("subject-mismatch");
    if (!description.brief.requestedWriteFiles.includes(input.choices.handoffPath)) return fail("subject-mismatch");
    const result = planRecord(description, input.choices, this.#time());
    if (this.describe(canonicalJson(input.selector)).descriptionDigest !== description.descriptionDigest) return fail("draft-changed");
    if (this.#time() >= result.expiresAt) return fail("plan-expired");
    this.#issued.add(result); return result;
  }
  /** Fill mechanical schema fields from explicit choices and fresh, branded
   * parents. Returns canonical INPUT for the existing composer, not its result.
   * Repeated materialization never extends the prepared task's expiry. */
  materialize(planInput: unknown, contextInput: unknown, candidateInput: unknown, inspectionInput: unknown): string {
    if (typeof planInput !== "object" || planInput === null || !this.#issued.has(planInput)) return fail("plan-untrusted");
    if (!isManagedPlanningContext(contextInput) || !isManagedEditCandidate(candidateInput) || !isManagedTaskInspection(inspectionInput)) return fail("plan-untrusted");
    const plan = planInput as ManagedWorkPlan, context = contextInput, candidate = candidateInput, inspection = inspectionInput;
    if (this.#time() >= plan.expiresAt) return fail("plan-expired");
    if (this.describe(canonicalJson(plan.description.selector)).descriptionDigest !== plan.description.descriptionDigest) return fail("draft-changed");
    const { choices, description } = plan, brief = description.brief, taskId = description.selector.taskId, command = this.#binding.command;
    if (inspection.briefDigest !== description.intakeDigest || context.briefDigest !== inspection.briefDigest || candidate.briefDigest !== inspection.briefDigest
      || candidate.contextDigest !== context.contextDigest || candidate.inspectionDigest !== inspection.inspectionDigest || context.inspectionDigest !== inspection.inspectionDigest
      || !same(inspection.workspace, description.workspace) || !same(inspection.policyBinding, brief.expectedBinding)
      || !same(context.workspace, inspection.workspace) || !same(candidate.workspace, inspection.workspace)
      || !same(context.policyBinding, inspection.policyBinding) || !same(candidate.policyBinding, inspection.policyBinding)) return fail("subject-mismatch");
    const paths = [...brief.requestedReadFiles].sort(), writes = [...brief.requestedWriteFiles].sort(), changed = candidate.files.map(f => f.relativePath);
    const scope = { contractVersion: BUILDER_CONTRACT_VERSION, taskId, sessionId: plan.sessionId, profileId: "builder",
      repositoryRoot: this.#workspace.repositoryRoot, worktreeRoot: this.#workspace.worktreeRoot, worktreeAttestationDigest: this.#workspace.worktreeAttestationDigest,
      allowedReadFiles: paths, allowedWriteFiles: writes, allowedVerificationIds: [command.verificationId], maxFiles: paths.length,
      maxFileBytes: choices.maxFileBytes, maxTotalBytes: choices.maxTotalBytes, maxPatchOperations: choices.maxPatchOperations,
      issuedAt: plan.createdAt, expiresAt: plan.expiresAt };
    const evidenceRequirements = [
      ...(["test", "review", "verification"] as const).map(kind => ({ evidenceId: `required-${kind}`, kind: `${kind}-receipt`, artifactPath: null, readBackRequired: false })),
      ...changed.map((path, i) => ({ evidenceId: `required-file-${i + 1}`, kind: "artifact-readback", artifactPath: path, readBackRequired: true })),
    ];
    const task = { schemaVersion: AGENT_WORK_TASK_SCHEMA_VERSION, taskId, sessionId: plan.sessionId, profileId: "builder", objective: brief.objective,
      builderScopeDigest: computeBuilderInspectionScopeDigest(scope), allowedReadFiles: paths, allowedWriteFiles: writes,
      expectedArtifactPaths: changed, handoffPath: choices.handoffPath, commands: [command],
      acceptanceCriteria: brief.acceptanceCriteria.map((description, i) => ({ criterionId: `criterion-${i + 1}`, description,
        verificationIds: [command.verificationId], requiredEvidenceIds: evidenceRequirements.map(e => e.evidenceId) })),
      forbiddenActions: [...AGENT_FORBIDDEN_ACTIONS], evidenceRequirements,
      stopConditions: { maxImplementationPasses: 1, maxTargetedFixPasses: choices.maxTargetedFixPasses, stopOnAcceptancePassed: true, stopOnBlocked: true, stopOnBudgetExhausted: true },
      ruleReferences: { scripts: [], modelIds: [], serviceNames: [], authorityClaims: ["none"] }, contextTags: ["managed-plan-description"],
      maxContextBytes: choices.maxContextBytes, createdAt: plan.createdAt, expiresAt: plan.expiresAt, authority: "none" };
    const request = { schemaVersion: "agent-managed-work-proposal-input/v1", contextDigest: context.contextDigest, candidateDigest: candidate.candidateDigest,
      task, scope, proposalId: plan.proposalId, planId: plan.planId, builderActorId: this.#actor,
      iteration: { implementationPass: 1, targetedFixPass: 0 }, knownRiskCodes: choices.knownRiskCodes };
    const wire = canonicalJson(JSON.parse(JSON.stringify(request)));
    // Preserve every existing composer check, including actual byte budgets,
    // evidence cardinalities, selected pins and exact path spelling.
    new WindowsManagedWorkProposalComposer({ commandBinding: this.#binding, now: () => this.#time() }).compose(context, candidate, inspection, wire);
    if (this.describe(canonicalJson(plan.description.selector)).descriptionDigest !== description.descriptionDigest) return fail("draft-changed");
    if (this.#time() >= plan.expiresAt) return fail("plan-expired");
    return wire;
  }
}
