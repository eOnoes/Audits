import { performance } from "node:perf_hooks";
import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { effectIntentSchema, effectParse, effectTime, effectUuid, validateCandidateEffectRecord } from "./windows-candidate-effect-state.js";
import type { CandidateEffectIntent, CandidateEffectRecord, CandidateEffectAdvance } from "./windows-candidate-effect-state.js";
import { parseCandidateSourceManifest } from "./windows-candidate-source-manifest.js";
import type { CandidateSourceManifest } from "./windows-candidate-source-manifest.js";
import { isManagedVerificationRequest, parseManagedVerificationResult, MANAGED_VERIFICATION_MAX_RESULT_BYTES } from "./windows-managed-verification-evidence.js";
import type { ManagedVerificationRequest, ManagedVerificationResult } from "./windows-managed-verification-evidence.js";
import type { SyntheticCandidateCheckpointSequencer } from "./windows-candidate-checkpoint-sequencer.js";

// Synthetic DATA/PORT composition only. No source reader, transport backend,
// VM acquisition, issuer, original-file writer, publication or v3 record schema.
// Supplied ports are trusted test seams, not authentication or physical fencing.
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const bindingSchema = z.object({ namespaceId: effectUuid, storeId: effectUuid, operationId: effectUuid,
  requestDigest: digest, manifestDigest: digest, ownerGeneration: effectUuid,
  guestGeneration: effectUuid, controllerIdentityDigest: digest }).strict();
export type SyntheticExecutionBinding = Readonly<z.infer<typeof bindingSchema>>;
const readySchema = z.object({ kind: z.literal("synthetic-ready"), authority: z.literal("none"), binding: bindingSchema }).strict();
const storedSchema = z.object({ kind: z.literal("synthetic-stored"), authority: z.literal("none"), binding: bindingSchema,
  fileCount: z.number().int().min(1).max(128), byteLength: z.number().int().min(0).max(16_777_216),
  wireByteLength: z.number().int().min(44).max(16_782_848), destinationInventoryDigest: digest,
  endOfInputObserved: z.literal(true), destinationReadBack: z.literal(true), protectedDestination: z.literal(true) }).strict();
const stoppedSchema = z.object({ kind: z.literal("synthetic-stopped"), authority: z.literal("none"), binding: bindingSchema,
  hostOff: z.literal(true), dispatchClosed: z.literal(true), allRelatedWorkSettled: z.literal(true),
  generationRetired: z.literal(true), sourceCustodyReleased: z.literal(true), originalPublicationExcluded: z.literal(true) }).strict();
const checkpointReceiptSchema = z.object({ kind: z.literal("synthetic-recorded-checkpoint-not-effect-permission"),
  authority: z.literal("none"), disposition: z.enum(["recorded", "replayed"]), operationId: effectUuid,
  recordDigest: digest, checkpointDigest: digest, sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }).strict();
type Reason = "input-invalid" | "session-used" | "cancelled" | "deadline" | "clock-invalid" | "owner-invalid"
  | "port-invalid" | "checkpoint-unconfirmed" | "work-unsettled";
export class SyntheticExecutionError extends Error {
  constructor(readonly reason: Reason) { super(`candidate-synthetic-execution-${reason}`); this.name = "SyntheticExecutionError"; }
}
function fail(reason: Reason): never { throw new SyntheticExecutionError(reason); }
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  try { return effectParse(schema, input); } catch { return fail("port-invalid"); }
}
export interface SyntheticCandidateExecutionPorts {
  /** Observe an ALREADY acquired fixture session; this method must not acquire a VM. */
  ready(binding: SyntheticExecutionBinding, signal: AbortSignal): Promise<unknown>;
  /** Fixture owns its synthetic bytes; this coordinator sends manifest metadata only. */
  deliver(binding: SyntheticExecutionBinding, manifest: CandidateSourceManifest, signal: AbortSignal): Promise<unknown>;
  run(binding: SyntheticExecutionBinding, request: ManagedVerificationRequest, signal: AbortSignal): Promise<unknown>;
  stop(binding: SyntheticExecutionBinding, signal: AbortSignal): Promise<unknown>;
}
interface Options {
  mode: "synthetic-only";
  ownerGeneration: string;
  checkpoint: SyntheticCandidateCheckpointSequencer;
  readRecord: (operationId: string) => unknown;
  /** Same owner/policy assertion used by checkpoint construction. Throw to deny. */
  assertCurrent: () => void;
  ports: SyntheticCandidateExecutionPorts;
  readyMs: number; deliveryMs: number; runMs: number; stopMs: number; checkpointMs: number; overallMs: number;
  monotonicNow?: () => number;
  wallNow?: () => string;
}
type Disposition = "completed" | "verification-failed" | "cancelled" | "quarantined" | "needs-reconciliation" | "replayed";
const usedPorts = new WeakSet<object>();
const positive = (value: number, cap: number) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > cap) fail("input-invalid"); return value;
};

export class SyntheticCandidateExecution {
  readonly #options: Options;
  readonly #ports: SyntheticCandidateExecutionPorts;
  readonly #owner: string;
  readonly #storeId: string;
  readonly #namespaceId: string;
  readonly #resourcePolicyDigest: string;
  readonly #now: () => number;
  readonly #wall: () => string;
  #used = false;
  #lastTime = 0;
  #lastWall = "";
  #pending = 0;
  #recordingUnconfirmed = false;
  #lastRecord: CandidateEffectRecord | undefined;
  constructor(options: Options) {
    if (options.mode !== "synthetic-only") fail("input-invalid");
    this.#owner = parse(effectUuid, options.ownerGeneration);
    const identity = options.checkpoint.identity;
    if (identity.ownerGeneration !== this.#owner || identity.authority !== "none") fail("input-invalid");
    this.#storeId = parse(effectUuid, identity.storeId); this.#namespaceId = parse(effectUuid, identity.namespaceId);
    const limits = { readyMs: positive(options.readyMs, 30_000), deliveryMs: positive(options.deliveryMs, 60_000),
      runMs: positive(options.runMs, 60_000), stopMs: positive(options.stopMs, 10_000),
      checkpointMs: positive(options.checkpointMs, 30_000), overallMs: positive(options.overallMs, 300_000) };
    if (5 * limits.checkpointMs + limits.readyMs + limits.deliveryMs + limits.runMs + limits.stopMs > limits.overallMs) fail("input-invalid");
    this.#resourcePolicyDigest = canonicalSha256Digest({ domain: "agent-candidate-synthetic-execution-resources/v1", ...limits });
    this.#options = { ...options, ...limits };
    this.#ports = { ready: options.ports.ready.bind(options.ports), deliver: options.ports.deliver.bind(options.ports),
      run: options.ports.run.bind(options.ports), stop: options.ports.stop.bind(options.ports) };
    this.#now = options.monotonicNow ?? (() => performance.now());
    this.#wall = options.wallNow ?? (() => new Date().toISOString());
  }
  /** Synthetic configuration identity, not enrolled policy or approval. */
  get resourcePolicyDigest(): string { return this.#resourcePolicyDigest; }
  #time() {
    let now: number; try { now = this.#now(); } catch { return fail("clock-invalid"); }
    if (!Number.isFinite(now) || now < this.#lastTime || now > Number.MAX_SAFE_INTEGER - 300_000) fail("clock-invalid");
    this.#lastTime = now; return now;
  }
  #live(input: CandidateEffectIntent, deadline: number, signal: AbortSignal, forward: boolean) {
    if (signal.aborted) fail("cancelled");
    if (this.#time() >= deadline) fail("deadline");
    try { if (this.#options.assertCurrent() !== undefined) fail("owner-invalid"); } catch { return fail("owner-invalid"); }
    let now: string; try { now = effectParse(effectTime, this.#wall()); } catch { return fail("clock-invalid"); }
    if (now < this.#lastWall) fail("clock-invalid"); this.#lastWall = now;
    if (forward && now >= input.expiresAt) fail("deadline");
    if (signal.aborted) fail("cancelled");
    if (this.#time() >= deadline) fail("deadline");
  }
  async #wait(run: (signal: AbortSignal) => Promise<unknown>, budget: number, absolute: number,
    outer: AbortSignal, task: boolean, emergencyCleanup = false): Promise<unknown> {
    const clock = emergencyCleanup ? () => performance.now() : () => this.#time();
    const started = clock(), deadline = Math.min(absolute, started + budget);
    if (outer.aborted) fail("cancelled"); if (started >= deadline) fail("deadline");
    const controller = new AbortController();
    let rejectStop!: (reason: Reason) => void;
    const interrupted = new Promise<never>((_, reject) => { rejectStop = reason => {
      controller.abort(); reject(new SyntheticExecutionError(reason));
    }; });
    void interrupted.catch(() => {});
    const abort = () => rejectStop("cancelled"), timer = setTimeout(() => rejectStop("deadline"), deadline - started);
    outer.addEventListener("abort", abort, { once: true });
    try {
      if (outer.aborted) fail("cancelled");
      if (task) this.#pending++;
      let work: Promise<unknown>;
      try { work = Promise.resolve(run(controller.signal)); } catch (error) { work = Promise.reject(error); }
      if (task) work = work.then(value => { this.#pending--; return value; }, error => { this.#pending--; throw error; });
      const result = await Promise.race([work, interrupted]);
      if (outer.aborted) fail("cancelled"); if (clock() >= deadline) fail("deadline");
      return result;
    } catch (error) { controller.abort(); throw error; }
    finally { clearTimeout(timer); outer.removeEventListener("abort", abort); }
  }
  #same(binding: SyntheticExecutionBinding, observed: SyntheticExecutionBinding) {
    if (canonicalJson(binding) !== canonicalJson(observed)) fail("port-invalid");
  }
  #result(disposition: Disposition, reason: string, resultDigest: string | null = null) {
    return deepFreeze({ kind: "synthetic-execution-not-production-evidence" as const, authority: "none" as const,
      disposition, reason, operationId: this.#lastRecord?.intent.operationId ?? null, resultDigest,
      physicalCustodyEstablished: false as const });
  }
  async execute(value: unknown, request: ManagedVerificationRequest, manifestWire: unknown, external: AbortSignal) {
    if (this.#used || usedPorts.has(this.#options.ports)) fail("session-used");
    let input: CandidateEffectIntent, manifest: CandidateSourceManifest;
    try {
      input = deepFreeze(effectParse(effectIntentSchema, value));
      if (input.kind !== "execute" || !isManagedVerificationRequest(request) || input.operationId !== request.operationId
        || input.requestDigest !== request.requestDigest || input.workspaceDigest !== request.workspaceDigest
        || input.policyBindingDigest !== request.policyBindingDigest || input.storeId !== this.#storeId
        || input.namespaceId !== this.#namespaceId || input.resourcePolicyDigest !== this.#resourcePolicyDigest) fail("input-invalid");
      manifest = parseCandidateSourceManifest(manifestWire, request, input.sourceManifestDigest);
    } catch { return fail("input-invalid"); }
    if (external.aborted) fail("cancelled");
    // Before ANY injected clock/policy callback, not only before the first await.
    this.#used = true; usedPorts.add(this.#options.ports);
    const deadline = this.#time() + this.#options.overallMs;
    this.#live(input, deadline, external, true);
    const binding = deepFreeze(parse(bindingSchema, { namespaceId: input.namespaceId, storeId: input.storeId,
      operationId: input.operationId, requestDigest: input.requestDigest, manifestDigest: input.sourceManifestDigest,
      ownerGeneration: this.#owner, guestGeneration: input.guestGeneration, controllerIdentityDigest: input.controllerIdentityDigest }));
    const forward = new AbortController(), cleanup = new AbortController();
    const abort = () => forward.abort(); external.addEventListener("abort", abort, { once: true });
    if (external.aborted) forward.abort();
    let contact = false, stopping: Promise<unknown> | undefined, settled = false, settlementStarted = false;
    let parsedResult: ManagedVerificationResult | undefined;
    let runDeadline = Infinity;
    const stop = () => {
      if (stopping) return stopping;
      // Latch before abort callbacks and port contact; cleanup ignores caller abort.
      let resolve!: (value: unknown) => void, reject!: (error: unknown) => void;
      stopping = new Promise((yes, no) => { resolve = yes; reject = no; });
      forward.abort();
      // A cleanup attempt is still needed after a synchronous host stall has used
      // the overall budget; it gets one bounded stop interval, never a new run.
      void this.#wait(s => this.#ports.stop(binding, s), this.#options.stopMs,
        Infinity, cleanup.signal, false, true).then(value => {
        const observed = parse(stoppedSchema, value); this.#same(binding, observed.binding);
        if (this.#pending !== 0) fail("work-unsettled"); settled = true; return observed;
      }).then(resolve, reject);
      return stopping;
    };
    const checkpoint = async (advance?: CandidateEffectAdvance) => {
      try {
        const transport = await this.#wait(s => advance ? this.#options.checkpoint.advance(advance, s)
          : this.#options.checkpoint.reserve(input, s), this.#options.checkpointMs, deadline,
          settlementStarted ? cleanup.signal : forward.signal, false);
        const receipt = parse(checkpointReceiptSchema, transport);
        const record = validateCandidateEffectRecord(this.#options.readRecord(input.operationId));
        if (receipt.operationId !== input.operationId || canonicalSha256Digest(record) !== receipt.recordDigest
          || canonicalJson(record.intent) !== canonicalJson(input) || (advance && receipt.disposition !== "recorded")) fail("checkpoint-unconfirmed");
        this.#lastRecord = record; return receipt;
      } catch { this.#recordingUnconfirmed = true; return fail("checkpoint-unconfirmed"); }
    };
    const advance = (state: CandidateEffectAdvance["state"], evidence: unknown,
      result: ManagedVerificationResult | undefined = undefined) => {
      if (!this.#lastRecord) return fail("checkpoint-unconfirmed");
      return checkpoint({ operationId: input.operationId, intentDigest: this.#lastRecord.intentDigest, state,
        evidenceDigest: canonicalSha256Digest({ domain: "synthetic-candidate-phase-evidence/v1", binding, state, evidence }),
        resultDigest: result?.resultDigest ?? null, verificationPassed: result ? result.disposition === "passed" : null });
    };
    const phase = async (run: (signal: AbortSignal) => Promise<unknown>, budget: number) => {
      this.#live(input, deadline, forward.signal, true);
      if (deadline - this.#time() < budget + this.#options.stopMs + 2 * this.#options.checkpointMs) fail("deadline");
      const result = await this.#wait(run, budget, deadline, forward.signal, true);
      this.#live(input, deadline, forward.signal, true); return result;
    };
    try {
      const reserved = await checkpoint();
      this.#live(input, deadline, forward.signal, true);
      if (reserved.disposition === "replayed") return this.#result("replayed", "recorded-history-not-resume-permission");
      const ready = parse(readySchema, await phase(s => { contact = true; return this.#ports.ready(binding, s); }, this.#options.readyMs));
      this.#same(binding, ready.binding);
      await advance("source-delivery-possible", ready);
      const stored = parse(storedSchema, await phase(s => this.#ports.deliver(binding, manifest, s), this.#options.deliveryMs));
      this.#same(binding, stored.binding);
      const expectedStoredDigest = canonicalSha256Digest({ domain: "synthetic-destination-inventory/v1",
        manifestDigest: manifest.manifestDigest, files: manifest.files });
      if (stored.fileCount !== manifest.fileCount || stored.byteLength !== manifest.byteLength
        || stored.wireByteLength !== manifest.byteLength + 44 * manifest.fileCount
        || stored.destinationInventoryDigest !== expectedStoredDigest) fail("port-invalid");
      await advance("launch-possible", stored);
      const runBudget = Math.min(this.#options.runMs, request.timeoutMs);
      runDeadline = this.#time() + runBudget;
      const wire = await phase(s => this.#ports.run(binding, request, s), runBudget);
      if (typeof wire !== "string" || wire.length > MANAGED_VERIFICATION_MAX_RESULT_BYTES
        || Buffer.byteLength(wire) > MANAGED_VERIFICATION_MAX_RESULT_BYTES) fail("port-invalid");
      parsedResult = parseManagedVerificationResult(wire, request);
      const stopped = await stop();
      this.#live(input, deadline, external, true);
      if (this.#time() >= runDeadline) fail("deadline");
      settlementStarted = true;
      await advance("result-and-stop-observed", stopped, parsedResult);
      this.#live(input, deadline, external, true);
      await advance(parsedResult.disposition === "passed" ? "completed" : "failed", { resultDigest: parsedResult.resultDigest });
      this.#live(input, deadline, external, true);
      return this.#result(parsedResult.disposition === "passed" ? "completed" : "verification-failed",
        parsedResult.disposition, parsedResult.resultDigest);
    } catch (error) {
      parsedResult = undefined;
      const reason: Reason = error instanceof SyntheticExecutionError ? error.reason : "port-invalid";
      if (contact) { try { await stop(); } catch { return this.#result("needs-reconciliation", "work-unsettled"); } }
      if (this.#recordingUnconfirmed || this.#options.checkpoint.closed || settlementStarted || !this.#lastRecord
        || (contact && (!settled || this.#pending !== 0))) return this.#result("needs-reconciliation", reason);
      // V2 has no safe non-result release after possible effect: keep quarantine.
      settlementStarted = true;
      try {
        this.#live(input, deadline, cleanup.signal, false);
        const state = this.#lastRecord.events.length === 0 ? "cancelled" : "quarantined";
        await advance(state, { cause: reason, taskPortsSettled: !contact || settled });
        return this.#result(state, reason);
      } catch { return this.#result("needs-reconciliation", reason); }
    } finally {
      external.removeEventListener("abort", abort); forward.abort(); cleanup.abort();
    }
  }
}
