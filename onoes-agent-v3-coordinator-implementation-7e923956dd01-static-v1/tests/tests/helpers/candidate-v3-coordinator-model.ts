import { z } from "zod";
import { createHash } from "node:crypto";
import { canonicalJson as wire, canonicalSha256Digest as hash } from "../../src/compatibility/canonical-json.js";
import { createCandidateV3IncrementalClaims } from "../../src/build-only/windows-candidate-v3-incremental.js";
import { inspectSyntheticPairClaims, requireEqualSyntheticPair } from "./candidate-v3-pair-claims.js";
import { pins, envelope, historyWire, genesis } from "./candidate-v3-history-fixture.js";
import { uuid } from "./candidate-v3-record-fixture.js";

// TEST-ONLY executable design model. All storage, ownership, time, settlement
// and anchor facts below are mutable synthetic claims controlled by tests.
// No filesystem, database, process, provider, task or production consumer port.
export const MODEL_LIMITS = Object.freeze({ wireBytes: 256 * 1024, responseBytes: 16 * 1024, appendMs: 1_000, queuedRequests: 0 });
export const rawDigest = (s: string) => "sha256:" + createHash("sha256").update(s, "utf8").digest("hex");
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/), id = z.string().uuid();
const identity = z.tuple([digest, digest, digest, digest]);
const lifetime = { lifetimeId: id, requestNumber: z.number().int().positive().safe(), nonce: id, epoch: id };
const requestSchema = z.object({ domain: z.literal("synthetic-v3-append-request/v1"), operation: z.literal("append"), ...lifetime,
  pre: identity, inputDigest: digest, checkpointDigest: digest, deadline: z.number().int().nonnegative().safe(),
  inventoryWire: z.string(), checkpointWire: z.string() }).strict();
const responseSchema = z.object({ domain: z.literal("synthetic-v3-append-response/v1"), operation: z.literal("append"), ...lifetime,
  requestDigest: digest, pre: identity, inputDigest: digest, checkpointDigest: digest,
  deadline: z.number().int().nonnegative().safe(), post: identity, resultDigest: digest }).strict();
type Request = z.infer<typeof requestSchema>;
type Response = z.infer<typeof responseSchema>;
type Identity = z.infer<typeof identity>;
export class ModelDenied extends Error { constructor() { super("synthetic-pair-closed"); } }
const deny = (): never => { throw new ModelDenied(); };
function bounded(s: unknown, cap: number = MODEL_LIMITS.wireBytes): string {
  if (typeof s !== "string" || s.length > cap || Buffer.byteLength(s) > cap) return deny();
  return s;
}
// Count canonical JSON string bytes without allocating an escaped copy. Headers
// and payload keys are small, passive, internally constructed model values.
function escapedBytes(s: string, remaining: number): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const n = s.charCodeAt(i);
    if (n >= 0xd800 && n <= 0xdbff) {
      const next = s.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return deny();
      bytes += 4;
    } else if (n >= 0xdc00 && n <= 0xdfff) return deny();
    else if (n === 34 || n === 92 || n === 8 || n === 9 || n === 10 || n === 12 || n === 13) bytes += 2;
    else if (n < 32) bytes += 6;
    else bytes += n < 128 ? 1 : n < 2048 ? 2 : 3;
    if (bytes > remaining) return deny();
  }
  return bytes;
}
function encodeEnvelope(header: Record<string, unknown>, payload: Record<string, string>, counts: { requestEncodings: number }): string {
  const skeleton = { ...header, ...Object.fromEntries(Object.keys(payload).map(k => [k, ""])) };
  let bytes = Buffer.byteLength(wire(skeleton));
  if (bytes > MODEL_LIMITS.wireBytes) return deny();
  for (const s of Object.values(payload)) bytes += escapedBytes(bounded(s), MODEL_LIMITS.wireBytes - bytes);
  counts.requestEncodings++;
  const result = wire({ ...header, ...payload });
  if (Buffer.byteLength(result) !== bytes) return deny();
  return bounded(result);
}
function parse<T>(schema: z.ZodType<T>, s: unknown, cap: number = MODEL_LIMITS.wireBytes): T {
  try { const text = bounded(s, cap), value = schema.parse(JSON.parse(text)); if (wire(value) !== text) return deny(); return value; }
  catch { return deny(); }
}
export function parseModelRequest(s: unknown) {
  const r = parse(requestSchema, s);
  if (r.inputDigest !== rawDigest(r.inventoryWire) || r.checkpointDigest !== rawDigest(r.checkpointWire)) return deny();
  return r;
}
export function parseModelResponse(s: unknown, requestWire: string): Response {
  const r = parse(responseSchema, s, MODEL_LIMITS.responseBytes), q = parseModelRequest(requestWire);
  const { resultDigest, ...core } = r;
  if (hash(core) !== resultDigest || r.requestDigest !== rawDigest(requestWire)
    || r.nonce !== q.nonce || r.epoch !== q.epoch || r.deadline !== q.deadline
    || r.lifetimeId !== q.lifetimeId || r.requestNumber !== q.requestNumber
    || wire(r.pre) !== wire(q.pre) || r.inputDigest !== q.inputDigest || r.checkpointDigest !== q.checkpointDigest) return deny();
  return r;
}
const bootstrapCommon = { lifetimeId: id, requestNumber: z.literal(0), nonce: id, epoch: id,
  deadline: z.number().int().nonnegative().safe(), metadataDigest: digest, inventoryDigest: digest, historyDigest: digest, anchorHistoryDigest: digest };
const bootstrapRequestSchema = z.object({ domain: z.literal("synthetic-v3-bootstrap-request/v1"), operation: z.literal("bootstrap"),
  ...bootstrapCommon, metadataWire: z.string(), inventoryWire: z.string(), historyWire: z.string() }).strict();
const bootstrapResponseSchema = z.object({ domain: z.literal("synthetic-v3-bootstrap-response/v1"), operation: z.literal("bootstrap"),
  ...bootstrapCommon, requestDigest: digest, post: identity, resultDigest: digest }).strict();
export function parseModelBootstrapRequest(s: unknown) {
  const q = parse(bootstrapRequestSchema, s);
  if (q.metadataDigest !== rawDigest(q.metadataWire) || q.inventoryDigest !== rawDigest(q.inventoryWire)
    || q.historyDigest !== rawDigest(q.historyWire)) return deny();
  return q;
}
export function parseModelBootstrapResponse(s: unknown, requestWire: string) {
  const r = parse(bootstrapResponseSchema, s, MODEL_LIMITS.responseBytes), q = parseModelBootstrapRequest(requestWire), { resultDigest, ...core } = r;
  if (resultDigest !== hash(core) || r.requestDigest !== rawDigest(requestWire)
    || Object.keys(bootstrapCommon).some(k => r[k as keyof typeof bootstrapCommon] !== q[k as keyof typeof bootstrapCommon])) return deny();
  return r;
}
export type Snapshot = Readonly<{ metadata: string; inventory: string; history: string }>;
export type Cut = "captured" | "worker-settled" | "transaction-post" | "committed" | "read-back"
  | "before-anchor" | "anchor-committed" | "before-promote";
export class SyntheticPairWorld {
  #bootstrapAttempted = false;
  local: Snapshot = Object.freeze({ metadata: pins, inventory: envelope([]), history: historyWire([genesis]) });
  anchor = this.local.history;
  epoch = uuid(70);
  lifetimeCounter = 200000;
  now = 0;
  clockListeners = new Set<() => void>();
  advance(now: number) { this.now = now; for (const listener of [...this.clockListeners]) listener(); }
  policy = true;
  settlement = true;
  fence = true;
  schemaValid = true;
  ownerHeld = false;
  activity = 0;
  inTransaction = false;
  cut: (at: Cut) => void = () => {};
  workerGate: () => Promise<void> = async () => {};
  anchorGate: () => Promise<void> = async () => {};
  reply: (response: string) => string = s => s;
  bootstrapReply: (response: string) => string = s => s;
  counts = { bootstrapAttempts: 0, bootstraps: 0, requestEncodings: 0, worker: 0, transactions: 0, commits: 0, readBacks: 0, anchorAttempts: 0, anchorAppends: 0, promotions: 0 };
  beginBootstrap() {
    if (this.ownerHeld || this.activity || this.#bootstrapAttempted) return deny();
    this.#bootstrapAttempted = true; this.counts.bootstrapAttempts++;
  }
  // Only an explicit test-driver retirement after ALL modeled activity settles
  // may release this synthetic owner. This is not an OS termination witness.
  retire() { if (this.activity !== 0) return deny(); this.ownerHeld = false; this.epoch = uuid(Number.parseInt(this.epoch.slice(-12), 16) + 1); this.#bootstrapAttempted = false; }
}
const claim = (s: Snapshot) => inspectSyntheticPairClaims(s.metadata, s.inventory, s.history, s.history);
const same = (a: readonly string[], b: readonly string[]) => wire(a) === wire(b);
export class SyntheticPairCoordinator {
  #phase: "ready" | "busy" | "closed" = "closed";
  #s: Snapshot;
  #identity: Identity;
  #t: ReturnType<typeof createCandidateV3IncrementalClaims>;
  #epoch: string;
  #lifetime: string;
  #requestNumber = 0;
  #nonce = 1000;
  #lastTime: number;
  constructor(readonly world: SyntheticPairWorld) {
    // One attempt per explicitly retired synthetic epoch, including failures.
    // Reconstructing this object does not clear the world-owned latch.
    world.beginBootstrap();
    if (!world.fence || !world.schemaValid) throw new ModelDenied();
    const s = world.local;
    bounded(s.metadata); bounded(s.inventory); bounded(s.history); bounded(world.anchor);
    this.#s = Object.freeze({ ...s }); this.#epoch = world.epoch;
    this.#lastTime = world.now; this.#time();
    if (!Number.isSafeInteger(world.lifetimeCounter) || world.lifetimeCounter < 0 || world.lifetimeCounter >= Number.MAX_SAFE_INTEGER) throw new ModelDenied();
    this.#lifetime = uuid(++world.lifetimeCounter);
    const common = { lifetimeId: this.#lifetime, requestNumber: 0, nonce: uuid(this.#nonce++), epoch: this.#epoch,
      deadline: this.#time() + MODEL_LIMITS.appendMs, metadataDigest: rawDigest(s.metadata), inventoryDigest: rawDigest(s.inventory),
      historyDigest: rawDigest(s.history), anchorHistoryDigest: rawDigest(world.anchor) };
    const request = encodeEnvelope({ domain: "synthetic-v3-bootstrap-request/v1", operation: "bootstrap", ...common },
      { metadataWire: s.metadata, inventoryWire: s.inventory, historyWire: s.history }, world.counts);
    const pair = requireEqualSyntheticPair(s.metadata, s.inventory, s.history, world.anchor);
    this.#identity = [...pair.identity];
    const q = parseModelBootstrapRequest(request);
    this.#t = createCandidateV3IncrementalClaims(q.metadataWire, q.inventoryWire, q.historyWire);
    try {
      const core = { domain: "synthetic-v3-bootstrap-response/v1", operation: "bootstrap", ...common, requestDigest: rawDigest(request), post: pair.identity };
      const result = parseModelBootstrapResponse(world.bootstrapReply(wire({ ...core, resultDigest: hash(core) })), request);
      if (!same(result.post, pair.identity) || this.#time() >= common.deadline || world.epoch !== this.#epoch
        || !world.fence || !world.schemaValid || !same(claim(world.local).identity, pair.identity)
        || rawDigest(world.anchor) !== common.anchorHistoryDigest) return this.#closeBootstrap();
    } catch { this.#t.invalidate(); throw new ModelDenied(); }
    world.ownerHeld = true; world.counts.bootstraps++; this.#phase = "ready";
  }
  #closeBootstrap(): never { this.#t.invalidate(); throw new ModelDenied(); }
  get phase() { return this.#phase; }
  get confirmed() { return this.#s; }
  #time() { const n = this.world.now; if (!Number.isSafeInteger(n) || n < 0 || n < this.#lastTime) return deny(); this.#lastTime = n; return n; }
  #live(deadline: number, policy: boolean) {
    if (this.#phase === "closed" || !this.world.ownerHeld || !this.world.fence || this.world.epoch !== this.#epoch
      || this.#time() >= deadline || (policy ? !this.world.policy : !this.world.settlement)) return deny();
  }
  #close() { this.#phase = "closed"; this.#t.invalidate(); }
  async #wait<T>(work: Promise<T>, signal: AbortSignal, deadline: number): Promise<T> {
    let abort = () => {}, tick = () => {};
    const stopped = new Promise<never>((_, reject) => {
      abort = () => reject(new ModelDenied());
      tick = () => { try { if (this.#time() >= deadline) abort(); } catch { abort(); } };
      signal.addEventListener("abort", abort, { once: true }); this.world.clockListeners.add(tick);
      if (signal.aborted) abort(); tick();
    });
    try { return await Promise.race([work, stopped]); }
    finally { signal.removeEventListener("abort", abort); this.world.clockListeners.delete(tick); }
  }
  async append(inventoryWire: unknown, checkpointWire: unknown, signal: AbortSignal): Promise<void> {
    // Busy loser does not poison the winner and cannot allocate a request/queue.
    if (this.#phase !== "ready") return deny();
    this.#phase = "busy";
    const w = this.world;
    try {
      const inventory = bounded(inventoryWire), cp = bounded(checkpointWire), deadline = this.#time() + MODEL_LIMITS.appendMs;
      this.#live(deadline, true); if (signal.aborted) return deny();
      requireEqualSyntheticPair(w.local.metadata, w.local.inventory, w.local.history, w.anchor);
      if (!same(claim(w.local).identity, this.#identity)) return deny();
      const pre = [...this.#identity] as Identity, preHead = this.#t.snapshot().head.checkpointDigest;
      if (preHead !== pre[3]) return deny();
      if (this.#requestNumber >= Number.MAX_SAFE_INTEGER) return deny();
      const requestWire = encodeEnvelope({ domain: "synthetic-v3-append-request/v1", operation: "append", lifetimeId: this.#lifetime,
        requestNumber: ++this.#requestNumber, nonce: uuid(this.#nonce++), epoch: this.#epoch,
        pre, inputDigest: rawDigest(inventory), checkpointDigest: rawDigest(cp), deadline },
        { inventoryWire: inventory, checkpointWire: cp }, w.counts);
      const oldHistory = JSON.parse(this.#s.history) as { domain: string; checkpoints: string[] };
      const candidate: Snapshot = Object.freeze({ metadata: this.#s.metadata, inventory,
        history: wire({ domain: oldHistory.domain, checkpoints: [...oldHistory.checkpoints, cp] }) });
      w.cut("captured");
      this.#live(deadline, true); if (signal.aborted) return deny();
      if (w.inTransaction) return deny();
      w.counts.worker++; w.activity++;
      const work = (async () => {
        try {
          await w.workerGate();
          if (this.#phase === "closed") return deny();
          const q: Request = parseModelRequest(requestWire);
          if (q.lifetimeId !== this.#lifetime || q.requestNumber !== this.#requestNumber || q.epoch !== this.#epoch
            || !same(q.pre, pre) || this.#t.snapshot().head.checkpointDigest !== q.pre[3]) return deny();
          const result = this.#t.append(q.inventoryWire, q.checkpointWire), post = claim(candidate).identity;
          if (result.head.checkpointDigest !== post[3]) return deny();
          const core = { domain: "synthetic-v3-append-response/v1", operation: "append", lifetimeId: q.lifetimeId,
            requestNumber: q.requestNumber, nonce: q.nonce, epoch: q.epoch,
            requestDigest: rawDigest(requestWire), pre: q.pre, inputDigest: q.inputDigest, checkpointDigest: q.checkpointDigest,
            deadline: q.deadline, post };
          return w.reply(wire({ ...core, resultDigest: hash(core) }));
        } finally { w.activity--; }
      })();
      const response = parseModelResponse(await this.#wait(work, signal, deadline), requestWire);
      w.cut("worker-settled"); this.#live(deadline, true);
      if (signal.aborted || w.anchor !== this.#s.history || !same(response.post, claim(candidate).identity)) return deny();
      // The transaction's fault seam is synchronous test instrumentation only.
      // No worker/anchor/consent/task callback is a production transaction API.
      w.counts.transactions++; w.inTransaction = true;
      try {
        if (!w.schemaValid || !same(claim(w.local).identity, pre)) return deny();
        const staged = Object.freeze({ ...candidate });
        w.cut("transaction-post"); this.#live(deadline, true);
        if (signal.aborted || !same(claim(w.local).identity, pre) || !same(claim(staged).identity, response.post)) return deny();
        w.local = staged; w.counts.commits++;
      } finally { w.inTransaction = false; }
      w.cut("committed");
      this.#live(deadline, false);
      w.counts.readBacks++; w.cut("read-back");
      if (!same(claim(w.local).identity, response.post)) return deny();
      const pair = inspectSyntheticPairClaims(w.local.metadata, w.local.inventory, w.local.history, w.anchor);
      if (pair.relation !== "one-ahead-claims") return deny();
      w.cut("before-anchor"); this.#live(deadline, false);
      if (signal.aborted || w.inTransaction || w.anchor !== this.#s.history) return deny();
      w.counts.anchorAttempts++; w.activity++;
      const anchorWork = (async () => {
        try {
          await w.anchorGate();
          if (this.#phase === "closed") return deny();
          this.#live(deadline, false);
          if (w.anchor !== this.#s.history) return deny();
          w.anchor = candidate.history; w.counts.anchorAppends++; w.cut("anchor-committed");
          return candidate.history;
        } finally { w.activity--; }
      })();
      const acknowledgment = await this.#wait(anchorWork, signal, deadline);
      w.cut("before-promote"); this.#live(deadline, false);
      if (signal.aborted || acknowledgment !== candidate.history || w.anchor !== candidate.history
        || !same(claim(w.local).identity, response.post)) return deny();
      this.#s = candidate; this.#identity = [...response.post]; w.counts.promotions++;
      // Revocation may allow witnessing an old commit, never renewed readiness.
      if (!w.policy) { this.#close(); return; }
      this.#phase = "ready";
    } catch { this.#close(); return deny(); }
  }
}
