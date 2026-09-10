import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { WindowsManagedTaskInspector, type ManagedTaskInspection, type ManagedTaskInspectionOptions } from "./windows-managed-task-inspection.js";
import { WindowsManagedPlanningContextCompiler, type ManagedPlanningContextOptions } from "./windows-managed-planning-context.js";
import type { SqliteWindowsOperatorTaskStore } from "./windows-operator-task-store.js";
import { WindowsManagedWorkProposalComposer, type ManagedWorkProposalOptions } from "./windows-managed-work-proposal.js";
import { WindowsManagedWorkPlanCompiler, type ManagedWorkPlan } from "./windows-managed-work-plan.js";
import { createManagedModelSuggestionRequest, parseManagedModelSuggestionResponse, modelSuggestionEditWire,
  type ManagedModelSuggestionRequest } from "./windows-managed-model-suggestion.js";

// One host-owned, in-memory inspection/planning session for an exact saved
// draft revision. No default file adapter, HTTP endpoint, provider or approval.
export const MANAGED_DRAFT_PLANNING_LIMITS = Object.freeze({ selectorBytes: 1024, reuseMs: 60_000 });
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const selectorSchema = z.object({ storeId: uuid, taskId: uuid,
  creationEpoch: z.number().int().min(1).max(1_000_000_000), expectedRevision: z.number().int().min(1).max(63) }).strict();
type Selector = Readonly<z.infer<typeof selectorSchema>>;
const sameSelector = (a: Selector, b: Selector) => canonicalJson(a) === canonicalJson(b);
type Draft = ReturnType<SqliteWindowsOperatorTaskStore["read"]>;
type Reason = "input-invalid" | "draft-unavailable" | "draft-changed" | "draft-closed" | "busy" | "closed"
  | "inspection-unavailable" | "inspection-missing" | "inspection-expired" | "cancelled" | "clock-invalid" | "planning-unavailable";
export class ManagedDraftPlanningError extends Error {
  constructor(readonly reason: Reason) { super(`managed-draft-planning-${reason}`); this.name = "ManagedDraftPlanningError"; }
}
const fail = (reason: Reason): never => { throw new ManagedDraftPlanningError(reason); };
export interface ManagedDraftPlanningOptions {
  readonly drafts: SqliteWindowsOperatorTaskStore;
  readonly inspection: ManagedTaskInspectionOptions;
  readonly verification: ManagedPlanningContextOptions["verification"];
  readonly monotonicNow?: () => number;
  readonly proposal?: ManagedWorkProposalOptions;
  /** Explicit host opt-in to source-free guided plan preparation. */
  readonly workPlan?: Readonly<{ builderActorId: string }>;
}
interface ActiveInspection {
  readonly handle: string;
  readonly selector: Selector;
  readonly draft: Draft;
  readonly inspection: ManagedTaskInspection;
  readonly expiresAt: number;
}

export class WindowsManagedDraftPlanningSession {
  readonly #drafts: SqliteWindowsOperatorTaskStore;
  readonly #inspector: WindowsManagedTaskInspector;
  readonly #compiler: WindowsManagedPlanningContextCompiler;
  readonly #clock: () => number;
  readonly #proposal: WindowsManagedWorkProposalComposer | undefined;
  readonly #verification: ManagedDraftPlanningOptions["verification"];
  readonly #workPlan: WindowsManagedWorkPlanCompiler | undefined;
  #preparedPlan: ManagedWorkPlan | undefined;
  #lastTime = 0;
  #clockFailed = false;
  #closed = false;
  #busy = false;
  #generation = 0;
  #active: ActiveInspection | undefined;
  #pending: AbortController | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #suggestion: { readonly handle: string; readonly selection: string; readonly request: ManagedModelSuggestionRequest } | undefined;

  constructor(options: ManagedDraftPlanningOptions) {
    this.#drafts = options.drafts;
    this.#inspector = new WindowsManagedTaskInspector(options.inspection);
    this.#compiler = new WindowsManagedPlanningContextCompiler({ workspace: options.inspection.workspace,
      policy: options.inspection.policy, verification: options.verification });
    this.#clock = options.monotonicNow ?? (() => performance.now());
    this.#verification = options.verification;
    this.#proposal = options.proposal === undefined ? undefined : new WindowsManagedWorkProposalComposer(options.proposal);
    if (options.workPlan !== undefined && options.proposal === undefined) throw new ManagedDraftPlanningError("planning-unavailable");
    this.#workPlan = options.workPlan !== undefined && options.proposal !== undefined
      ? new WindowsManagedWorkPlanCompiler({ drafts: options.drafts, policy: options.inspection.policy, workspace: options.inspection.workspace,
        verification: options.verification, ...options.proposal, builderActorId: options.workPlan.builderActorId }) : undefined;
  }
  #time(): number {
    let now = NaN; try { now = this.#clock(); } catch { this.#clockFailed = true; }
    if (this.#clockFailed || !Number.isFinite(now) || now < this.#lastTime || now > Number.MAX_SAFE_INTEGER - MANAGED_DRAFT_PLANNING_LIMITS.reuseMs) {
      this.#clockFailed = true; this.#release(); return fail("clock-invalid");
    }
    this.#lastTime = now; return now;
  }
  #release(): void { clearTimeout(this.#timer); this.#timer = undefined; this.#active = undefined; this.#suggestion = undefined; }
  #available(): void { if (this.#closed) fail("closed"); if (this.#busy) fail("busy"); }
  #read(selector: Selector): Draft {
    let draft: Draft;
    try {
      if (this.#drafts.readCreationEpoch().storeId !== selector.storeId) return fail("draft-unavailable");
      draft = this.#drafts.read(selector.taskId, selector.creationEpoch);
    } catch { return fail("draft-unavailable"); }
    if (draft.closed) return fail("draft-closed");
    if (draft.revision !== selector.expectedRevision) return fail("draft-changed");
    return draft;
  }
  #current(handle: unknown): ActiveInspection {
    this.#available(); const now = this.#time(), active = this.#active;
    if (!active || typeof handle !== "string" || handle !== active.handle) return fail("inspection-missing");
    if (now >= active.expiresAt) { this.#release(); return fail("inspection-expired"); }
    try {
      if (canonicalJson(this.#read(active.selector)) !== canonicalJson(active.draft)) return fail("draft-changed");
    } catch (error) { this.#release(); throw error; }
    return active;
  }
  /** Drops references and cancels an in-flight read. Not a claim of process stop
   * or secure erasure; inspect() settles only through the inspector's lifecycle. */
  discard(): void { this.#generation++; this.#release(); this.#pending?.abort(); }
  close(): void { this.#closed = true; this.#preparedPlan = undefined; this.discard(); }
  /** Explicit plan cancellation also drops source; not a process-stop receipt. */
  discardWorkPlan(): void { this.#preparedPlan = undefined; this.discard(); }

  /** Metadata only, before source inspection. No default command or scope. */
  describeWorkPlan(selectorWire: unknown) {
    this.#available(); if (!this.#workPlan) return fail("planning-unavailable");
    return this.#workPlan.describe(selectorWire);
  }
  prepareWorkPlan(wire: unknown) {
    this.#available(); if (!this.#workPlan) return fail("planning-unavailable");
    // A new explicit plan, even an invalid one, cannot silently retain a prior
    // plan or its source. A valid plan is source-free and survives inspect().
    this.#preparedPlan = undefined; this.discard();
    const plan = this.#workPlan.prepare(wire); this.#preparedPlan = plan; return plan;
  }
  prepareGuidedProposal(handle: unknown, selectionWire: unknown, editWire: unknown, workPlanDigest: unknown) {
    const active = this.#current(handle); this.#suggestion = undefined;
    try {
      const plan = this.#preparedPlan;
      if (!this.#workPlan || !plan || workPlanDigest !== plan.workPlanDigest || !sameSelector(plan.description.selector, active.selector))
        return fail("planning-unavailable");
      const brief = canonicalJson(active.draft.brief), context = this.#compiler.compile(brief, selectionWire, active.inspection);
      if (context.status === "blocked") return context;
      const candidate = this.#compiler.prepareEdits(brief, selectionWire, active.inspection, editWire);
      if (candidate.status === "blocked") return candidate;
      const proposalWire = this.#workPlan.materialize(plan, context, candidate, active.inspection);
      // Existing method rechecks the same live handle and canonical saved draft
      // before and after composition. Plan lifetime never extends inspection age.
      return this.prepareProposal(handle, selectionWire, editWire, proposalWire);
    } catch (error) { this.#release(); throw error; }
  }

  async inspect(selectorWire: unknown, signal?: AbortSignal) {
    this.#available();
    let selector: Selector;
    try {
      if (typeof selectorWire !== "string" || Buffer.byteLength(selectorWire) > MANAGED_DRAFT_PLANNING_LIMITS.selectorBytes) return fail("input-invalid");
      const raw: unknown = JSON.parse(selectorWire); if (canonicalJson(raw) !== selectorWire) return fail("input-invalid");
      selector = deepFreeze(selectorSchema.parse(raw));
    } catch { return fail("input-invalid"); }
    this.discard(); this.#time();
    this.#busy = true; const generation = this.#generation, controller = new AbortController(); this.#pending = controller;
    let combined = controller.signal;
    try {
      try { combined = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal]); }
      catch { return fail("input-invalid"); }
      if (combined.aborted) return fail("cancelled");
      const draft = this.#read(selector);
      const inspection = await this.#inspector.inspect(canonicalJson(draft.brief), combined);
      if (this.#closed || combined.aborted || generation !== this.#generation) return fail("cancelled");
      if (canonicalJson(this.#read(selector)) !== canonicalJson(draft)) return fail("draft-changed");
      if (inspection.briefDigest !== draft.intakeDigest) return fail("draft-changed");
      const now = this.#time(), handle = randomUUID();
      this.#active = { handle, selector, draft, inspection, expiresAt: now + MANAGED_DRAFT_PLANNING_LIMITS.reuseMs };
      // The timer drops references when scheduled; event-loop delays and GC mean
      // this is not a hard memory-erasure deadline. #current enforces reuse age.
      this.#timer = setTimeout(() => { if (this.#active?.handle === handle) this.#release(); }, MANAGED_DRAFT_PLANNING_LIMITS.reuseMs);
      this.#timer.unref();
      return deepFreeze({ schemaVersion: "agent-managed-draft-inspection/v1" as const,
        kind: "saved-draft-bound-local-inspection-not-approval" as const,
        selector, inspectionHandle: handle, inspection,
        verification: { catalogDigest: this.#verification.catalogDigest, definitionDigest: this.#verification.definitionDigest,
          definition: { ...this.#verification.definition }, evidenceClass: "host-selected-static-definition-not-execution" as const },
        reuseLimitMs: MANAGED_DRAFT_PLANNING_LIMITS.reuseMs,
        freshness: "snapshot-not-current-files-revalidate-before-execution" as const,
        executionEnabled: false as const, approvalAvailable: false as const, authority: "none" as const });
    } catch (error) {
      this.#release();
      if (error instanceof ManagedDraftPlanningError) throw error;
      return fail(combined.aborted ? "cancelled" : "inspection-unavailable");
    } finally { this.#pending = undefined; this.#busy = false; }
  }
  compile(handle: unknown, selectionWire: unknown) {
    const active = this.#current(handle); this.#suggestion = undefined;
    try {
      const result = this.#compiler.compile(canonicalJson(active.draft.brief), selectionWire, active.inspection);
      this.#current(handle); return result;
    } catch (error) { this.#release(); if (error instanceof ManagedDraftPlanningError) throw error; return fail("planning-unavailable"); }
  }
  prepareEdits(handle: unknown, selectionWire: unknown, editWire: unknown) {
    const active = this.#current(handle); this.#suggestion = undefined;
    try {
      const result = this.#compiler.prepareEdits(canonicalJson(active.draft.brief), selectionWire, active.inspection, editWire);
      this.#current(handle); return result;
    } catch (error) { this.#release(); if (error instanceof ManagedDraftPlanningError) throw error; return fail("planning-unavailable"); }
  }
  /** Source-bearing data only. No transfer or model call; the eventual recipient
   * and source scope require separate operator consent at the adapter boundary. */
  prepareModelSuggestion(handle: unknown, selectionWire: unknown, confirmSourcePayload: unknown) {
    const active = this.#current(handle); this.#suggestion = undefined;
    try {
      if (confirmSourcePayload !== true) return fail("input-invalid");
      const context = this.#compiler.compile(canonicalJson(active.draft.brief), selectionWire, active.inspection);
      if (context.status === "blocked") return context;
      const request = createManagedModelSuggestionRequest(context);
      this.#current(handle);
      this.#suggestion = { handle: active.handle, selection: canonicalJson(context.request), request };
      return request;
    } catch (error) { this.#release(); if (error instanceof ManagedDraftPlanningError) throw error; return fail("planning-unavailable"); }
  }
  /** Trusted adapter preflight/read-back. Reuses the original inspection age
   * and exact held selection; never mints a replacement or transfers source. */
  currentModelSuggestion(handle: unknown, requestDigest: unknown): ManagedModelSuggestionRequest {
    const active = this.#current(handle), held = this.#suggestion;
    // A stale caller must not erase a newer exchange created during its await.
    if (!held || held.handle !== active.handle || requestDigest !== held.request.requestDigest) return fail("planning-unavailable");
    try {
      const context = this.#compiler.compile(canonicalJson(active.draft.brief), held.selection, active.inspection);
      if (context.status !== "ready-for-planning" || context.contextDigest !== held.request.context.contextDigest) return fail("draft-changed");
      this.#current(handle); return held.request;
    } catch (error) { this.#release(); if (error instanceof ManagedDraftPlanningError) throw error; return fail("planning-unavailable"); }
  }
  /** Drop only this exchange, not a newer request created during an await. */
  discardModelSuggestion(requestDigest: string): void {
    if (this.#suggestion?.request.requestDigest === requestDigest) this.#suggestion = undefined;
  }
  /** One response attempt for the latest exchange. Malformed/blocked responses
   * never retry automatically. Freshness is the original inspection's lifetime.
   * Successful replay returns full affected files, requiring distinct consent. */
  acceptModelSuggestion(handle: unknown, requestDigest: unknown, wire: unknown, confirmFullAffectedSource: unknown) {
    const active = this.#current(handle), held = this.#suggestion; this.#suggestion = undefined;
    try {
      if (confirmFullAffectedSource !== true) return fail("input-invalid");
      if (!held || held.handle !== active.handle || requestDigest !== held.request.requestDigest) return fail("planning-unavailable");
      const brief = canonicalJson(active.draft.brief);
      const context = this.#compiler.compile(brief, held.selection, active.inspection);
      if (context.status === "blocked") return context;
      if (context.contextDigest !== held.request.context.contextDigest) return fail("draft-changed");
      const parsed = parseManagedModelSuggestionResponse(held.request, wire);
      if (parsed.response.disposition === "blocked") {
        this.#current(handle);
        return deepFreeze({ schemaVersion: "agent-managed-model-suggestion-blocked/v1" as const,
          kind: "untrusted-model-stated-blocker-not-completion" as const, status: "blocked" as const,
          requestDigest: held.request.requestDigest, responseDigest: parsed.responseDigest, reason: parsed.response.reason,
          executionEnabled: false as const, approvalAvailable: false as const, authority: "none" as const });
      }
      const candidate = this.#compiler.prepareEdits(brief, held.selection, active.inspection, modelSuggestionEditWire(context, parsed.response));
      this.#current(handle);
      if (candidate.status === "blocked") return candidate;
      const core = { schemaVersion: "agent-managed-model-suggestion-candidate/v1" as const,
        kind: "locally-replayed-supplied-model-data-not-review" as const, status: candidate.status,
        requestDigest: held.request.requestDigest, responseDigest: parsed.responseDigest, candidate,
        modelIdentityVerified: false as const, persisted: false as const,
        executionEnabled: false as const, approvalAvailable: false as const, authority: "none" as const };
      const result = deepFreeze({ ...core, suggestionDigest: canonicalSha256Digest(core) });
      this.#current(handle); return result;
    } catch (error) { this.#release(); if (error instanceof ManagedDraftPlanningError) throw error; return fail("planning-unavailable"); }
  }
  prepareProposal(handle: unknown, selectionWire: unknown, editWire: unknown, proposalWire: unknown) {
    const active = this.#current(handle); this.#suggestion = undefined;
    try {
      if (!this.#proposal) return fail("planning-unavailable");
      const brief = canonicalJson(active.draft.brief);
      const context = this.#compiler.compile(brief, selectionWire, active.inspection);
      if (context.status === "blocked") return context;
      const candidate = this.#compiler.prepareEdits(brief, selectionWire, active.inspection, editWire);
      if (candidate.status === "blocked") return candidate;
      const result = this.#proposal.compose(context, candidate, active.inspection, proposalWire);
      if (result.task.taskId !== active.selector.taskId) return fail("draft-changed");
      // The host clock/command binding is not a substitute for a current policy
      // and saved-draft check after the complete synchronous composition.
      const rechecked = this.#compiler.compile(brief, selectionWire, active.inspection);
      if (rechecked.status === "blocked") return rechecked;
      if (rechecked.contextDigest !== context.contextDigest) return fail("draft-changed");
      this.#current(handle);
      const core = { schemaVersion: "agent-managed-draft-work-proposal/v1" as const,
        kind: "saved-draft-bound-work-proposal-not-approval" as const, status: result.status,
        selector: { ...active.selector }, briefDigest: active.draft.briefDigest, intakeDigest: active.draft.intakeDigest,
        workProposal: result, approvalAvailable: false as const, executionEnabled: false as const, authority: "none" as const };
      const wrapped = deepFreeze({ ...core, draftProposalDigest: canonicalSha256Digest(core) });
      this.#current(handle); return wrapped;
    } catch (error) { this.#release(); if (error instanceof ManagedDraftPlanningError) throw error; return fail("planning-unavailable"); }
  }
}
