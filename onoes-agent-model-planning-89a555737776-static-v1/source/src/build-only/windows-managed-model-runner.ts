import { performance } from "node:perf_hooks";
import { types } from "node:util";
import { z } from "zod";
import type { ChatModel, ChatRequest } from "../contracts/index.js";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { MODEL_ID_PATTERN, MAX_MODEL_ID_LENGTH, MAX_CHAT_RESPONSE_TEXT_LENGTH, MAX_TOKEN_USAGE_COUNT } from "../validation/schemas.js";
import { WindowsManagedDraftPlanningSession } from "./windows-managed-draft-planning.js";
import { parseManagedModelSuggestionResponse, type ManagedModelSuggestionRequest } from "./windows-managed-model-suggestion.js";
import { MANAGED_MODEL_BUDGET_LIMITS, type SqliteManagedModelBudget } from "./windows-managed-model-budget.js";

// Dormant trusted-host adapter. No default provider, credentials, HTTP route,
// live consumer or transfer authorization. A future paired host must obtain the
// actual operator consent and enforce spending policy BEFORE calling run().
export const MANAGED_MODEL_RUNNER_LIMITS = Object.freeze({ requestBytes: 131_072,
  responseBytes: 32_768, responseCharacters: MAX_CHAT_RESPONSE_TEXT_LENGTH,
  timeoutMs: 30_000, cancellationGraceMs: 1_000, confirmationBytes: 1024, providerAttempts: 1 });
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const recipientSchema = z.object({ providerId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  modelId: z.string().min(1).max(MAX_MODEL_ID_LENGTH).regex(MODEL_ID_PATTERN), deploymentDigest: digest }).strict();
const allocationSchema = z.object({ budgetDigest: digest, priceAssumptionDigest: digest, currency: z.string().regex(/^[A-Z]{3}$/),
  perAttemptAllocationMicrounits: z.number().int().min(1).max(MANAGED_MODEL_BUDGET_LIMITS.microunits) }).strict();
const confirmationSchema = z.object({ schemaVersion: z.literal("agent-managed-model-transfer-confirmation/v2"),
  requestDigest: digest, profileDigest: digest, confirmSourceTransfer: z.literal(true), confirmAllocation: z.literal(true) }).strict();
const used = new WeakSet<ManagedModelSuggestionRequest>();
type Reason = "configuration-invalid" | "confirmation-invalid" | "request-unavailable" | "request-used"
  | "budget-exceeded" | "busy" | "closed" | "cancelled" | "timeout" | "unsettled-model"
  | "model-failed" | "response-invalid" | "allocation-unavailable" | "allocation-existing";
export class ManagedModelRunnerError extends Error {
  constructor(readonly reason: Reason) { super(`managed-model-runner-${reason}`); this.name = "ManagedModelRunnerError"; }
}
const fail = (reason: Reason): never => { throw new ManagedModelRunnerError(reason); };
/** Trusted synchronous store seam; injectable only for fault testing/host composition. */
export type ManagedModelBudgetPort = Pick<SqliteManagedModelBudget, "snapshot" | "reserve" | "read" | "recordOutcome">;
type AllocationReceipt = NonNullable<ReturnType<ManagedModelBudgetPort["read"]>>;
export interface ManagedModelRunnerOptions {
  readonly planning: WindowsManagedDraftPlanningSession;
  readonly model: ChatModel;
  /** Host-selected adapter/deployment identity, not task-chosen routing. These
   * pins describe configuration; neither they nor modelId prove endpoint custody. */
  readonly recipient: Readonly<z.infer<typeof recipientSchema>>;
  readonly allocation: Readonly<z.infer<typeof allocationSchema>>;
  readonly budget: ManagedModelBudgetPort;
  readonly timeoutMs?: number;
  readonly cancellationGraceMs?: number;
}
const budget = (value: number | undefined, limit: number) => {
  const result = value ?? limit;
  if (!Number.isSafeInteger(result) || result < 1 || result > limit) return fail("configuration-invalid");
  return result;
};
function dataRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof value !== "object" || value === null || types.isProxy(value)) return fail("response-invalid");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail("response-invalid");
  const keys = Reflect.ownKeys(value);
  if (keys.length < required.length || keys.length > required.length + optional.length
    || keys.some(key => typeof key !== "string" || ![...required, ...optional].includes(key))) return fail("response-invalid");
  const result: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor) || !descriptor.enumerable) return fail("response-invalid");
    result[key] = descriptor.value;
  }
  if (required.some(key => !Object.hasOwn(result, key))) return fail("response-invalid");
  return result;
}
function snapshotResponse(value: unknown, expectedModel: string) {
  const response = dataRecord(value, ["text", "modelId", "usage"], ["providerRetryCount"]);
  const text = response["text"];
  if (typeof text !== "string" || text.length > MANAGED_MODEL_RUNNER_LIMITS.responseCharacters
    || Buffer.byteLength(text) > MANAGED_MODEL_RUNNER_LIMITS.responseBytes) return fail("response-invalid");
  if (response["modelId"] !== expectedModel || (response["providerRetryCount"] !== undefined && response["providerRetryCount"] !== 0)) return fail("response-invalid");
  const usage = dataRecord(response["usage"], ["input", "cached", "reasoning", "output"]);
  for (const value of Object.values(usage)) if (typeof value !== "number" || !Number.isSafeInteger(value)
    || value < 0 || value > MAX_TOKEN_USAGE_COUNT) return fail("response-invalid");
  return { wire: text, modelId: expectedModel, reportedUsage: usage };
}

/** One exclusive runner per trusted host planning flow. No queue, retry,
 * credential lookup or inferred consent. Poison survives late settlement. */
export class WindowsManagedModelRunner {
  readonly #planning: WindowsManagedDraftPlanningSession;
  readonly #complete: ChatModel["complete"];
  readonly #budget: ManagedModelBudgetPort;
  readonly #profile;
  #busy = false;
  #closed = false;
  #poisoned = false;
  #cancel: (() => void) | undefined;
  constructor(options: ManagedModelRunnerOptions) {
    const parsed = recipientSchema.safeParse(options.recipient), allocation = allocationSchema.safeParse(options.allocation);
    if (!parsed.success || !allocation.success) throw new ManagedModelRunnerError("configuration-invalid");
    try {
      const snapshot = options.budget.snapshot();
      if (snapshot.budgetDigest !== allocation.data.budgetDigest || snapshot.currency !== allocation.data.currency
        || allocation.data.perAttemptAllocationMicrounits > snapshot.totalAllocationMicrounits) throw new ManagedModelRunnerError("configuration-invalid");
      this.#budget = { snapshot: options.budget.snapshot.bind(options.budget), reserve: options.budget.reserve.bind(options.budget),
        read: options.budget.read.bind(options.budget), recordOutcome: options.budget.recordOutcome.bind(options.budget) };
    } catch { throw new ManagedModelRunnerError("configuration-invalid"); }
    this.#planning = options.planning; this.#complete = options.model.complete.bind(options.model);
    const core = { schemaVersion: "agent-managed-model-runner-profile/v2" as const,
      kind: "host-declared-recipient-not-endpoint-attestation" as const, recipient: parsed.data,
      allocation: allocation.data, allocationReservationRequired: true as const,
      limits: { ...MANAGED_MODEL_RUNNER_LIMITS, timeoutMs: budget(options.timeoutMs, MANAGED_MODEL_RUNNER_LIMITS.timeoutMs),
        cancellationGraceMs: budget(options.cancellationGraceMs, MANAGED_MODEL_RUNNER_LIMITS.cancellationGraceMs) },
      monetaryLimitEnforced: false as const, remoteCancellationProven: false as const,
      approvalAvailable: false as const, executionEnabled: false as const, authority: "none" as const };
    this.#profile = deepFreeze({ ...core, profileDigest: canonicalSha256Digest(core) });
  }
  describe() { return this.#profile; }
  close(): void { this.#closed = true; this.#cancel?.(); }
  #current(handle: unknown, requestDigest: unknown) {
    try { return this.#planning.currentModelSuggestion(handle, requestDigest); }
    catch { return fail("request-unavailable"); }
  }
  async run(handle: unknown, requestDigest: unknown, confirmationWire: unknown,
    signal: AbortSignal = new AbortController().signal) {
    if (this.#closed) return fail("closed");
    if (this.#busy || this.#poisoned) return fail("busy");
    if (!(signal instanceof AbortSignal)) return fail("confirmation-invalid");
    if (signal.aborted) return fail("cancelled");
    const request = this.#current(handle, requestDigest);
    if (used.has(request)) return fail("request-used");
    try {
      if (typeof confirmationWire !== "string" || confirmationWire.length > MANAGED_MODEL_RUNNER_LIMITS.confirmationBytes
        || Buffer.byteLength(confirmationWire) > MANAGED_MODEL_RUNNER_LIMITS.confirmationBytes) return fail("confirmation-invalid");
      const raw: unknown = JSON.parse(confirmationWire), confirmation = confirmationSchema.parse(raw);
      if (canonicalJson(confirmation) !== confirmationWire || confirmation.requestDigest !== request.requestDigest
        || confirmation.profileDigest !== this.#profile.profileDigest) return fail("confirmation-invalid");
    } catch { return fail("confirmation-invalid"); }
    const payload = canonicalJson(request);
    if (Buffer.byteLength(payload) + Buffer.byteLength(request.instructions) > MANAGED_MODEL_RUNNER_LIMITS.requestBytes) return fail("budget-exceeded");
    this.#busy = true;
    const deadline = performance.now() + this.#profile.limits.timeoutMs, controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined, grace: ReturnType<typeof setTimeout> | undefined;
    let stop!: (reason: "cancelled" | "timeout") => void, success = false;
    let reservation: AllocationReceipt | null = null, settlementAttempted = false, providerStarted = false;
    const recordOutcome = (outcome: "response-observed" | "outcome-unknown") => {
      settlementAttempted = true; // Never issue a compensating write after an uncertain commit.
      try {
        if (!reservation) return fail("allocation-unavailable");
        const recorded = this.#budget.recordOutcome(canonicalJson({ requestDigest: request.requestDigest,
          reservationDigest: reservation.reservation.reservationDigest, outcome }));
        const readBack = this.#budget.read(request.requestDigest);
        if (canonicalJson(recorded) !== canonicalJson(readBack) || recorded.terminal?.outcome !== outcome
          || recorded.reservation.reservationDigest !== reservation.reservation.reservationDigest) return fail("allocation-unavailable");
        return recorded;
      } catch { this.#poisoned = true; return fail("allocation-unavailable"); }
    };
    const stopped = new Promise<{ type: "stop"; reason: "cancelled" | "timeout" }>(resolve => {
      stop = reason => { controller.abort(); resolve({ type: "stop", reason }); };
      timer = setTimeout(() => stop("timeout"), this.#profile.limits.timeoutMs);
    });
    const onAbort = () => stop("cancelled"); this.#cancel = onAbort;
    signal.addEventListener("abort", onAbort, { once: true });
    type Done = { type: "value"; value: unknown } | { type: "failure"; reason: Reason };
    const done: Promise<Done> = Promise.resolve().then(() => {
      if (signal.aborted || controller.signal.aborted || this.#closed) return fail("cancelled");
      if (performance.now() >= deadline) return fail("timeout");
      if (this.#current(handle, requestDigest) !== request) return fail("request-unavailable");
      if (used.has(request)) return fail("request-used");
      used.add(request); // process-local, before callback; not durable provider exactly-once
      try {
        const allocated = this.#budget.reserve(canonicalJson({ requestDigest: request.requestDigest, profileDigest: this.#profile.profileDigest,
          allocationMicrounits: this.#profile.allocation.perAttemptAllocationMicrounits }));
        if (allocated.disposition !== "reserved") return fail("allocation-existing");
        reservation = allocated.receipt;
        if (canonicalJson(this.#budget.read(request.requestDigest)) !== canonicalJson(reservation) || reservation.terminal !== null
          || reservation.reservation.requestDigest !== request.requestDigest || reservation.reservation.profileDigest !== this.#profile.profileDigest
          || reservation.reservation.budgetDigest !== this.#profile.allocation.budgetDigest
          || reservation.allocatedMicrounits !== this.#profile.allocation.perAttemptAllocationMicrounits) return fail("allocation-unavailable");
      } catch (error) {
        if (error instanceof ManagedModelRunnerError && error.reason === "allocation-existing") throw error;
        settlementAttempted = true; // Reservation outcome/read-back is uncertain: no follow-up write.
        this.#poisoned = true; return fail("allocation-unavailable");
      }
      // Synchronous reservation/read-back can consume time or invoke a trusted
      // fault seam. Recheck everything before the first provider effect.
      if (signal.aborted || controller.signal.aborted || this.#closed) return fail("cancelled");
      if (performance.now() >= deadline) return fail("timeout");
      if (this.#current(handle, requestDigest) !== request) return fail("request-unavailable");
      const call: ChatRequest = { traceId: request.requestId, threadId: request.requestId,
        instructions: request.instructions, messages: [{ role: "user", content: payload }],
        signal: controller.signal, purpose: "extraction", providerAttemptLimit: 1 };
      providerStarted = true; return this.#complete(call);
    }).then(value => ({ type: "value", value }), (error: unknown) => ({ type: "failure",
      reason: !providerStarted && error instanceof ManagedModelRunnerError ? error.reason : "model-failed" }));
    try {
      const first = await Promise.race([done, stopped]);
      if (first.type === "stop") {
        const settled = await Promise.race([done, new Promise<null>(resolve => { grace = setTimeout(() => resolve(null), this.#profile.limits.cancellationGraceMs); })]);
        if (settled === null) { this.#poisoned = true; return fail("unsettled-model"); }
        return fail(first.reason);
      }
      if (performance.now() >= deadline) return fail("timeout");
      if (signal.aborted || controller.signal.aborted || this.#closed) return fail("cancelled");
      if (first.type === "failure") return fail(first.reason);
      const response = snapshotResponse(first.value, this.#profile.recipient.modelId);
      const parsed = parseManagedModelSuggestionResponse(request, response.wire);
      if (this.#current(handle, requestDigest) !== request) return fail("request-unavailable");
      const allocationReceipt = recordOutcome("response-observed");
      const core = { schemaVersion: "agent-managed-model-runner-result/v2" as const,
        kind: "source-bearing-untrusted-model-response-not-candidate" as const,
        requestDigest: request.requestDigest, profileDigest: this.#profile.profileDigest,
        responseDigest: parsed.responseDigest, ...response, providerCallAttempted: true as const,
        modelIdentityVerified: false as const, usageVerified: false as const, responsePersisted: false as const,
        allocationReceipt, allocationPersisted: true as const,
        approvalAvailable: false as const, executionEnabled: false as const, authority: "none" as const };
      const result = deepFreeze({ ...core, resultDigest: canonicalSha256Digest(core) });
      if (this.#current(handle, requestDigest) !== request) return fail("request-unavailable");
      if (performance.now() >= deadline) return fail("timeout");
      if (signal.aborted || controller.signal.aborted || this.#closed) return fail("cancelled");
      success = true; return result;
    } catch (error) {
      if (error instanceof ManagedModelRunnerError) throw error;
      return fail("response-invalid");
    } finally {
      clearTimeout(timer); clearTimeout(grace); signal.removeEventListener("abort", onAbort);
      try { if (reservation && !settlementAttempted) recordOutcome("outcome-unknown"); }
      finally {
        this.#cancel = undefined; this.#busy = false;
        if (!success) this.#planning.discardModelSuggestion(request.requestDigest);
      }
    }
  }
}
