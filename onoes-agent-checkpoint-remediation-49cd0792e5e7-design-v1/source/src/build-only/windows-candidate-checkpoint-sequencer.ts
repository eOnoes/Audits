import { performance } from "node:perf_hooks";
import { types } from "node:util";
import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { advanceCandidateEffectRecord, candidateEffectBlocked, candidateEffectState,
  CANDIDATE_EFFECT_MAX_OPERATIONS, effectAdvanceSchema, effectIntentSchema, effectParse,
  effectRecordSchema, effectUuid, validateCandidateEffectRecord } from "./windows-candidate-effect-state.js";
import type { CandidateEffectRecord } from "./windows-candidate-effect-state.js";
import type { SqliteCandidateEffectLedger } from "./windows-candidate-effect-ledger.js";

// INJECTED SYNTHETIC MODEL ONLY. No effect port, real enrollment, issuer, owner
// acquisition, backend, v3 record, repair, reconciliation write or runtime consumer.
// Host ports must supply authentic current ownership and a COMPLETE ATOMIC ledger
// snapshot. V2 listBlocked/read-by-remembered-IDs are NOT that snapshot API.
// An in-memory lock, these hashes and a fulfilled Promise prove no physical custody.
export const SYNTHETIC_CHECKPOINT_DOMAIN = "agent-candidate-synthetic-checkpoint/v1" as const;
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const pinsSchema = z.object({ installationId: effectUuid, namespaceId: effectUuid, storeId: effectUuid }).strict();
export type SyntheticCheckpointPins = Readonly<z.infer<typeof pinsSchema>>;
const coreSchema = pinsSchema.extend({
  schemaVersion: z.literal(SYNTHETIC_CHECKPOINT_DOMAIN), authority: z.literal("none"),
  producerGeneration: effectUuid, sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  previousCheckpointDigest: digest.nullable(), operationId: effectUuid.nullable(),
  eventIndex: z.number().int().min(0).max(6).nullable(), recordDigest: digest.nullable(),
  approvalIdentityDigest: digest.nullable(), inventoryRootDigest: digest,
  operationCount: z.number().int().min(0).max(CANDIDATE_EFFECT_MAX_OPERATIONS),
}).strict();
const checkpointSchema = coreSchema.extend({ checkpointDigest: digest }).strict();
export type SyntheticCheckpoint = Readonly<z.infer<typeof checkpointSchema>>;
const viewSchema = z.object({ currentOwnerGeneration: effectUuid, checkpoint: checkpointSchema }).strict();
const receiptSchema = z.object({ kind: z.literal("recorded-state-not-effect-permission"),
  disposition: z.enum(["recorded", "replayed"]), storeId: effectUuid, record: effectRecordSchema }).strict();

type Reason = "input-invalid" | "busy" | "closed" | "cancelled" | "deadline" | "clock-invalid"
  | "owner-invalid" | "history-mismatch" | "port-failed" | "mutation-unconfirmed";
export class SyntheticCheckpointError extends Error {
  constructor(readonly reason: Reason) { super(`candidate-checkpoint-${reason}`); this.name = "SyntheticCheckpointError"; }
}
function fail(reason: Reason): never { throw new SyntheticCheckpointError(reason); }
function parse<T>(schema: z.ZodType<T>, value: unknown, reason: Reason = "history-mismatch"): T {
  try { return effectParse(schema, value); } catch { return fail(reason); }
}

/** Snapshot one supplied array, rejecting proxy/accessor/extra-key vectors before
 * indexing. The trusted port, NOT this function, establishes complete atomic reads. */
export function syntheticCheckpointInventory(value: unknown, pinValue: SyntheticCheckpointPins) {
  const pins = parse(pinsSchema, pinValue, "input-invalid");
  if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("history-mismatch");
  const size = Object.getOwnPropertyDescriptor(value, "length")?.value as unknown;
  if (typeof size !== "number" || !Number.isInteger(size) || size < 0 || size > CANDIDATE_EFFECT_MAX_OPERATIONS) fail("history-mismatch");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== size + 1) fail("history-mismatch");
  const records: CandidateEffectRecord[] = [];
  const ids = new Set<string>(), approvals = new Set<string>(), workflows = new Set<string>(), blockers = new Set<string>();
  for (let i = 0; i < size; ++i) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail("history-mismatch");
    let record: CandidateEffectRecord;
    try { record = validateCandidateEffectRecord(descriptor.value); } catch { return fail("history-mismatch"); }
    const { operationId, namespaceId, storeId, workflowId, kind, workspaceDigest } = record.intent;
    const workflow = `${workflowId}:${kind}`, blocked = candidateEffectBlocked(record);
    if (namespaceId !== pins.namespaceId || storeId !== pins.storeId || ids.has(operationId)
      || approvals.has(record.approvalIdentityDigest) || workflows.has(workflow)
      || (blocked && blockers.has(workspaceDigest))) fail("history-mismatch");
    ids.add(operationId); approvals.add(record.approvalIdentityDigest); workflows.add(workflow);
    if (blocked) blockers.add(workspaceDigest);
    records.push(record);
  }
  records.sort((a, b) => a.intent.operationId < b.intent.operationId ? -1 : a.intent.operationId > b.intent.operationId ? 1 : 0);
  // Re-derive publication parentage, not merely individual record shape. Equal
  // common intent fields are checked by removing only phase-specific identities.
  for (const record of records) {
    if (record.intent.kind !== "publish") continue;
    const publication = record.intent;
    const parent = records.find(r => r.intent.operationId === publication.executionOperationId);
    const observation = parent?.events.find(e => e.state === "result-and-stop-observed");
    if (!parent || parent.intent.kind !== "execute" || candidateEffectState(parent) !== "completed"
      || observation?.verificationPassed !== true || observation.resultDigest !== publication.resultDigest
      || record.reservedAt < parent.events.at(-1)!.recordedAt) fail("history-mismatch");
    // expiresAt and approval/operation identities are independently new per phase.
    const common = (intent: CandidateEffectRecord["intent"]) => {
      const copy = { ...intent } as Record<string, unknown>;
      for (const key of ["kind", "operationId", "approvalId", "expiresAt", "executionOperationId", "resultDigest"]) delete copy[key];
      return canonicalJson(copy);
    };
    if (common(parent.intent) !== common(publication)) fail("history-mismatch");
  }
  const entries = records.map(r => ({ operationId: r.intent.operationId, eventIndex: r.events.length,
    recordDigest: canonicalSha256Digest(r), approvalIdentityDigest: r.approvalIdentityDigest, state: candidateEffectState(r) }));
  const inventoryRootDigest = canonicalSha256Digest({ domain: "agent-candidate-synthetic-inventory/v1", ...pins,
    operationCount: records.length, entries });
  return deepFreeze({ records, entries, inventoryRootDigest, operationCount: records.length });
}

function checkpoint(value: unknown, pins: SyntheticCheckpointPins): SyntheticCheckpoint {
  const parsed = parse(checkpointSchema, value), { checkpointDigest, ...core } = parsed;
  if (Object.keys(pins).some(key => parsed[key as keyof SyntheticCheckpointPins] !== pins[key as keyof SyntheticCheckpointPins])
    || canonicalSha256Digest(core) !== checkpointDigest) fail("history-mismatch");
  if (parsed.sequence === 0
    ? parsed.previousCheckpointDigest !== null || parsed.operationId !== null || parsed.eventIndex !== null
      || parsed.recordDigest !== null || parsed.approvalIdentityDigest !== null || parsed.operationCount !== 0
    : parsed.previousCheckpointDigest === null || parsed.operationId === null || parsed.eventIndex === null
      || parsed.recordDigest === null || parsed.approvalIdentityDigest === null || parsed.operationCount === 0) fail("history-mismatch");
  return deepFreeze(parsed);
}

/** Explicit empty synthetic fixture only; never initialize an absent real anchor. */
export function createSyntheticCheckpointGenesis(pins: SyntheticCheckpointPins, producerGeneration: string): SyntheticCheckpoint {
  const core = parse(coreSchema, { ...parse(pinsSchema, pins, "input-invalid"), schemaVersion: SYNTHETIC_CHECKPOINT_DOMAIN,
    authority: "none", producerGeneration, sequence: 0, previousCheckpointDigest: null,
    operationId: null, eventIndex: null, recordDigest: null, approvalIdentityDigest: null,
    operationCount: 0, inventoryRootDigest: syntheticCheckpointInventory([], pins).inventoryRootDigest }, "input-invalid");
  return checkpoint({ ...core, checkpointDigest: canonicalSha256Digest(core) }, pins);
}

export interface SyntheticCheckpointAnchorPort {
  discover(ownerGeneration: string, signal: AbortSignal): Promise<unknown>;
  compareAndAppend(ownerGeneration: string, expectedCheckpointDigest: string,
    proposed: SyntheticCheckpoint, signal: AbortSignal): Promise<unknown>;
}
interface Options {
  mode: "synthetic-only";
  pins: SyntheticCheckpointPins;
  ownerGeneration: string;
  ledger: Pick<SqliteCandidateEffectLedger, "reserve" | "advance">;
  /** Trusted complete atomic snapshot; validated again here before/after awaits. */
  snapshot: () => unknown;
  /** Must throw for expired/revoked ownership or policy, never return a boolean. */
  assertCurrent: () => void;
  anchor: SyntheticCheckpointAnchorPort;
  appendMs: number;
  discoveryMs: number;
  pairMs: number;
  monotonicNow?: () => number;
}
type Shared = { busy: boolean; closed: boolean; lastTime: number };
const shared = new WeakMap<object, Shared>();
const positive = (value: number, cap: number) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > cap) fail("input-invalid"); return value;
};

/** One pair at a time; no queue, retry, compensation or effects. A terminal record
 * never creates admission permission. Shared latches cover only this ledger object;
 * sole enrollment across reopened handles/processes remains a trusted host duty. */
export class SyntheticCandidateCheckpointSequencer {
  readonly #pins: SyntheticCheckpointPins;
  readonly #owner: string;
  readonly #state: Shared;
  readonly #snapshot: () => unknown;
  readonly #assertCurrent: () => void;
  readonly #reserve: Options["ledger"]["reserve"];
  readonly #advance: Options["ledger"]["advance"];
  readonly #discover: SyntheticCheckpointAnchorPort["discover"];
  readonly #append: SyntheticCheckpointAnchorPort["compareAndAppend"];
  readonly #now: () => number;
  readonly #appendMs: number;
  readonly #discoveryMs: number;
  readonly #pairMs: number;
  constructor(options: Options) {
    if (options.mode !== "synthetic-only") fail("input-invalid");
    this.#pins = deepFreeze(parse(pinsSchema, options.pins, "input-invalid"));
    this.#owner = parse(effectUuid, options.ownerGeneration, "input-invalid");
    this.#appendMs = positive(options.appendMs, 30_000);
    this.#discoveryMs = positive(options.discoveryMs, 30_000);
    this.#pairMs = positive(options.pairMs, 120_000);
    if (this.#appendMs + this.#discoveryMs > this.#pairMs) fail("input-invalid");
    this.#snapshot = options.snapshot; this.#assertCurrent = options.assertCurrent;
    this.#reserve = options.ledger.reserve.bind(options.ledger); this.#advance = options.ledger.advance.bind(options.ledger);
    this.#discover = options.anchor.discover.bind(options.anchor); this.#append = options.anchor.compareAndAppend.bind(options.anchor);
    this.#now = options.monotonicNow ?? (() => performance.now());
    const previous = shared.get(options.ledger);
    this.#state = previous ?? { busy: false, closed: false, lastTime: 0 };
    if (!previous) shared.set(options.ledger, this.#state);
  }
  reserve(value: unknown, signal: AbortSignal) { return this.#pair("reserve", value, signal); }
  advance(value: unknown, signal: AbortSignal) { return this.#pair("advance", value, signal); }
  get closed(): boolean { return this.#state.closed; }
  /** Descriptive fixture pins only; no ownership, approval or freshness proof. */
  get identity() { return deepFreeze({ ...this.#pins, ownerGeneration: this.#owner, authority: "none" as const }); }
  #time(): number {
    let value: number; try { value = this.#now(); } catch { return fail("clock-invalid"); }
    if (!Number.isFinite(value) || value < this.#state.lastTime || value > Number.MAX_SAFE_INTEGER - 120_000) fail("clock-invalid");
    this.#state.lastTime = value; return value;
  }
  #live(signal: AbortSignal, deadline: number): void {
    if (this.#state.closed) fail("closed");
    if (signal.aborted) fail("cancelled");
    if (this.#time() >= deadline) fail("deadline");
    try { if (this.#assertCurrent() !== undefined) fail("owner-invalid"); } catch { return fail("owner-invalid"); }
    if (signal.aborted) fail("cancelled");
    if (this.#time() >= deadline) fail("deadline");
  }
  #inventory() { return syntheticCheckpointInventory(this.#snapshot(), this.#pins); }
  #view(value: unknown): SyntheticCheckpoint {
    const view = parse(viewSchema, value);
    if (view.currentOwnerGeneration !== this.#owner) fail("owner-invalid");
    return checkpoint(view.checkpoint, this.#pins);
  }
  #matches(head: SyntheticCheckpoint, inventory: ReturnType<typeof syntheticCheckpointInventory>): boolean {
    if (head.inventoryRootDigest !== inventory.inventoryRootDigest || head.operationCount !== inventory.operationCount) return false;
    if (head.sequence === 0) return inventory.operationCount === 0;
    const latest = inventory.entries.find(e => e.operationId === head.operationId);
    return latest?.eventIndex === head.eventIndex && latest.recordDigest === head.recordDigest
      && latest.approvalIdentityDigest === head.approvalIdentityDigest;
  }
  async #call(run: (signal: AbortSignal) => Promise<unknown>, budget: number, deadline: number, outer: AbortSignal) {
    this.#live(outer, deadline);
    const started = this.#time(), callDeadline = Math.min(deadline, started + budget);
    const remaining = callDeadline - started;
    if (remaining <= 0) fail("deadline");
    const controller = new AbortController();
    let stop!: (reason: Reason) => void;
    const stopped = new Promise<never>((_, reject) => { stop = reason => {
      this.#state.closed = true; controller.abort(); reject(new SyntheticCheckpointError(reason));
    }; });
    // A synchronous port can abort and then throw before Promise.race is formed.
    // Keep that stop rejection handled without converting the raced result.
    void stopped.catch(() => {});
    const abort = () => stop("cancelled"), timer = setTimeout(() => stop("deadline"), remaining);
    outer.addEventListener("abort", abort, { once: true });
    try {
      this.#live(outer, Math.min(deadline, callDeadline));
      // Direct invocation, after latches/listeners: no deferred contact after stop.
      const work = Promise.resolve(run(controller.signal));
      const result = await Promise.race([work, stopped]);
      this.#live(outer, Math.min(deadline, callDeadline));
      return result;
    } finally { clearTimeout(timer); outer.removeEventListener("abort", abort); }
  }
  async #pair(kind: "reserve" | "advance", value: unknown, signal: AbortSignal) {
    if (this.#state.closed) fail("closed");
    if (this.#state.busy) fail("busy");
    this.#state.busy = true;
    let contacted = false;
    try {
      const input = deepFreeze(kind === "reserve" ? parse(effectIntentSchema, value, "input-invalid") : parse(effectAdvanceSchema, value, "input-invalid"));
      if ("namespaceId" in input && (input.namespaceId !== this.#pins.namespaceId || input.storeId !== this.#pins.storeId)) fail("input-invalid");
      const deadline = this.#time() + this.#pairMs;
      this.#live(signal, deadline);
      contacted = true;
      const before = this.#inventory();
      const head = this.#view(await this.#call(s => this.#discover(this.#owner, s), this.#discoveryMs, deadline, signal));
      this.#live(signal, deadline);
      const current = this.#inventory();
      if (current.inventoryRootDigest !== before.inventoryRootDigest || !this.#matches(head, current)) fail("history-mismatch");
      const operationId = input.operationId;
      const original = current.records.find(r => r.intent.operationId === operationId);
      // Exact replay is observation only: no ledger write, append or effect.
      let replayed = false;
      if (kind === "reserve" && original) {
        if (canonicalJson(original.intent) !== canonicalJson(input)) fail("input-invalid");
        replayed = true;
      } else if (kind === "advance" && original) {
        const advance = parse(effectAdvanceSchema, input, "input-invalid");
        if (advance.intentDigest !== original.intentDigest) fail("input-invalid");
        const prior = original.events.find(e => e.state === advance.state);
        if (prior) {
          if (prior.evidenceDigest !== advance.evidenceDigest || prior.resultDigest !== advance.resultDigest
            || prior.verificationPassed !== advance.verificationPassed) fail("input-invalid");
          replayed = true;
        }
      }
      if (replayed) {
        this.#live(signal, deadline);
        return this.#result(original!, head, "replayed");
      }
      // Reserve a complete append interval BEFORE making a potentially durable write.
      this.#live(signal, deadline);
      if (deadline - this.#time() < this.#appendMs || head.sequence === Number.MAX_SAFE_INTEGER) fail("deadline");
      let receipt: z.infer<typeof receiptSchema>;
      try { receipt = parse(receiptSchema, kind === "reserve" ? this.#reserve(input) : this.#advance(input), "mutation-unconfirmed"); }
      catch { return fail("mutation-unconfirmed"); }
      this.#live(signal, deadline);
      const record = validateCandidateEffectRecord(receipt.record);
      if (receipt.storeId !== this.#pins.storeId || receipt.disposition !== "recorded" || record.intent.operationId !== operationId) fail("history-mismatch");
      if (kind === "reserve") {
        if (original || record.events.length !== 0 || canonicalJson(record.intent) !== canonicalJson(input)) fail("history-mismatch");
      } else {
        if (!original || !record.events.at(-1)) fail("history-mismatch");
        const expected = advanceCandidateEffectRecord(original, parse(effectAdvanceSchema, input), record.events.at(-1)!.recordedAt);
        if (canonicalJson(record) !== canonicalJson(expected)) fail("history-mismatch");
      }
      const after = this.#inventory();
      const expectedRecords = current.records.filter(r => r.intent.operationId !== operationId).concat(record);
      const expectedInventory = syntheticCheckpointInventory(expectedRecords, this.#pins);
      if (after.inventoryRootDigest !== expectedInventory.inventoryRootDigest) fail("history-mismatch");
      const core = { ...this.#pins, schemaVersion: SYNTHETIC_CHECKPOINT_DOMAIN, authority: "none" as const,
        producerGeneration: this.#owner, sequence: head.sequence + 1, previousCheckpointDigest: head.checkpointDigest,
        operationId, eventIndex: record.events.length, recordDigest: canonicalSha256Digest(record),
        approvalIdentityDigest: record.approvalIdentityDigest, inventoryRootDigest: after.inventoryRootDigest, operationCount: after.operationCount };
      const proposed = checkpoint({ ...core, checkpointDigest: canonicalSha256Digest(core) }, this.#pins);
      const observed = this.#view(await this.#call(s => this.#append(this.#owner, head.checkpointDigest, proposed, s), this.#appendMs, deadline, signal));
      if (canonicalJson(observed) !== canonicalJson(proposed)) fail("history-mismatch");
      this.#live(signal, deadline);
      if (this.#inventory().inventoryRootDigest !== proposed.inventoryRootDigest) fail("history-mismatch");
      this.#live(signal, deadline);
      return this.#result(record, observed, "recorded");
    } catch (error) {
      if (contacted || (error instanceof SyntheticCheckpointError && ["clock-invalid", "owner-invalid"].includes(error.reason))) this.#state.closed = true;
      if (error instanceof SyntheticCheckpointError) throw error;
      return fail("port-failed");
    } finally { this.#state.busy = false; }
  }
  #result(record: CandidateEffectRecord, head: SyntheticCheckpoint, disposition: "recorded" | "replayed") {
    return deepFreeze({ kind: "synthetic-recorded-checkpoint-not-effect-permission" as const, authority: "none" as const,
      disposition, operationId: record.intent.operationId, recordDigest: canonicalSha256Digest(record),
      checkpointDigest: head.checkpointDigest, sequence: head.sequence });
  }
}
