import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canonicalJson as wire, sha256Digest } from "../compatibility/canonical-json.js";
import { effectUuid } from "./windows-candidate-effect-state.js";
import { CANDIDATE_V3_MAX_INVENTORY_BYTES } from "./windows-candidate-v3-inventory.js";
import { CANDIDATE_V3_MAX_CHECKPOINT_BYTES } from "./windows-candidate-v3-record.js";
import { V3_MESSAGE_LIMITS, boundedV3Text, encodeCandidateV3BootstrapRequest, encodeCandidateV3AppendRequest, parseCandidateV3Response } from "./windows-candidate-v3-messages.js";
import { parseCandidateV3LocalSnapshot, stageCandidateV3LocalSnapshot } from "./windows-candidate-v3-coordinator-data.js";

// DORMANT composition. Trusted embedding ports, tested ONLY synthetically.
// No physical adapter, task/effect API, runtime consumer or admission exists.
// Promise settlement and the counters below do NOT prove OS quiescence.
export interface CandidateV3CoordinatorPorts {
  readonly kind: "synthetic-v3-coordinator-ports-not-physical";
  assertCurrent(contextWire: string, signal: AbortSignal): Promise<void>;
  readLedger(signal: AbortSignal): Promise<unknown>;
  readAnchor(signal: AbortSignal): Promise<unknown>;
  validate(requestWire: string, signal: AbortSignal): Promise<unknown>;
  // Must own a single short transaction: check schema/durability/store identity
  // and complete pre-identity, write exact candidate, validate post, commit.
  // Receives data only, never a callback to execute inside its transaction.
  commit(preIdentityWire: string, candidateSnapshotWire: string, contextWire: string, signal: AbortSignal): Promise<unknown>;
  appendAnchor(previousHistoryWire: string, checkpointWire: string, contextWire: string, signal: AbortSignal): Promise<unknown>;
  invalidateValidation(): void; // Request invalidation, NOT a termination witness.
}
const usedPorts = new WeakSet<object>();
const bindingSchema = z.object({ lifetimeId: effectUuid, epoch: effectUuid }).strict();
const budgetsSchema = z.object({ bootstrapMs: z.number().int().min(1).max(V3_MESSAGE_LIMITS.bootstrapMs),
  appendMs: z.number().int().min(1).max(V3_MESSAGE_LIMITS.appendMs) }).strict();
export class CandidateV3CoordinatorError extends Error {
  constructor() { super("candidate-v3-coordinator-closed"); this.name = "CandidateV3CoordinatorError"; }
}
const fail = (): never => { throw new CandidateV3CoordinatorError(); };
type Snapshot = ReturnType<typeof parseCandidateV3LocalSnapshot>;
const same = (a: readonly string[], b: readonly string[]) => wire(a) === wire(b);

export function createCandidateV3Coordinator(bindingWire: unknown, ports: CandidateV3CoordinatorPorts, clock: () => number,
  budgetsWire: unknown = wire({ bootstrapMs: V3_MESSAGE_LIMITS.bootstrapMs, appendMs: V3_MESSAGE_LIMITS.appendMs })) {
  // This prevents same-port-object re-instantiation, not two malicious physical
  // adapters for one store. Real store-wide ownership/fencing remains a gate.
  if (!ports || ports.kind !== "synthetic-v3-coordinator-ports-not-physical" || usedPorts.has(ports)) return fail();
  usedPorts.add(ports);
  let binding: z.infer<typeof bindingSchema>, budgets: z.infer<typeof budgetsSchema>;
  try {
    const b = boundedV3Text(bindingWire, V3_MESSAGE_LIMITS.headerBytes), t = boundedV3Text(budgetsWire, V3_MESSAGE_LIMITS.headerBytes);
    binding = bindingSchema.parse(JSON.parse(b)); budgets = budgetsSchema.parse(JSON.parse(t));
    if (wire(binding) !== b || wire(budgets) !== t) return fail();
  } catch { return fail(); }
  let phase: "uninitialized" | "bootstrapping" | "ready" | "appending" | "closed" = "uninitialized";
  let confirmed: Snapshot | null = null, lastTime = -1, requestNumber = 0, pendingPorts = 0, bootstrapAttempts = 0;
  let commitAttempts = 0, anchorAttempts = 0, promotions = 0, invalidated = false, active: AbortController | null = null;
  const close = () => {
    phase = "closed"; active?.abort();
    if (!invalidated) { invalidated = true; try { ports.invalidateValidation(); } catch { /* Keep closed; never expose diagnostics. */ } }
  };
  const time = () => { const n = clock(); if (!Number.isSafeInteger(n) || n < 0 || n < lastTime) return fail(); lastTime = n; return n; };
  const begin = (signal: AbortSignal, ms: number) => {
    const controller = new AbortController(); active = controller;
    const deadline = time() + ms; if (!Number.isSafeInteger(deadline)) return fail();
    const abort = () => controller.abort();
    let rejectStop!: (e: Error) => void;
    const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
    void stopped.catch(() => {});
    const stop = () => rejectStop(new CandidateV3CoordinatorError());
    controller.signal.addEventListener("abort", stop, { once: true });
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, ms);
    if (signal.aborted) abort();
    const check = () => { if (phase === "closed" || controller.signal.aborted || time() >= deadline) return fail(); };
    const step = async <T>(call: (s: AbortSignal) => Promise<T>): Promise<T> => {
      check(); pendingPorts++;
      const work = Promise.resolve().then(() => { check(); return call(controller.signal); }).finally(() => { pendingPorts--; });
      const result = await Promise.race([work, stopped]); check(); return result;
    };
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", stop); active = null; };
    return { deadline, check, step, finish, nonce: randomUUID() };
  };
  const context = (operation: "bootstrap" | "append", deadline: number, nonce: string, authorization: "forward" | "settlement") =>
    wire({ domain: "agent-candidate-v3-coordinator-context/v1", operation, ...binding, requestNumber, nonce, deadline, authorization });
  const ack = (domain: string, contextWire: string, identity: readonly string[]) => wire({ domain, contextDigest: sha256Digest(contextWire), post: identity });
  const readSnapshot = async (run: ReturnType<typeof begin>) => parseCandidateV3LocalSnapshot(await run.step(s => ports.readLedger(s)));
  const readAnchor = async (run: ReturnType<typeof begin>) => boundedV3Text(await run.step(s => ports.readAnchor(s)), CANDIDATE_V3_MAX_INVENTORY_BYTES);
  const result = (disposition: "bootstrapped-claims" | "pair-confirmed-claims") => Object.freeze({
    kind: "dormant-v3-coordination-not-admission" as const, disposition, identity: confirmed!.identity });
  return Object.freeze({
    status: () => Object.freeze({ kind: "dormant-v3-coordinator-status-not-custody" as const,
      phase, bootstrapAttempts, requestNumber, pendingPorts, commitAttempts, anchorAttempts, promotions,
      confirmedIdentity: confirmed?.identity ?? null }),
    close,
    bootstrap: async (signal: AbortSignal) => {
      if (phase !== "uninitialized") return fail();
      phase = "bootstrapping"; bootstrapAttempts++;
      let run: ReturnType<typeof begin> | undefined;
      try {
        run = begin(signal, budgets.bootstrapMs);
        const ctx = context("bootstrap", run.deadline, run.nonce, "forward");
        await run.step(s => ports.assertCurrent(ctx, s));
        const snapshot = await readSnapshot(run), anchor = await readAnchor(run);
        if (anchor !== snapshot.historyWire) return fail();
        const request = encodeCandidateV3BootstrapRequest(wire({ domain: "agent-candidate-v3-bootstrap-request/v1", operation: "bootstrap",
          ...binding, nonce: run.nonce, requestNumber: 0, deadline: run.deadline, anchorHistoryDigest: sha256Digest(anchor) }),
        snapshot.metadataWire, snapshot.inventoryWire, snapshot.historyWire);
        await run.step(s => ports.assertCurrent(ctx, s));
        const response = parseCandidateV3Response("bootstrap", await run.step(s => ports.validate(request, s)), request);
        if (!same(response.post, snapshot.identity)) return fail();
        await run.step(s => ports.assertCurrent(ctx, s));
        if (!same((await readSnapshot(run)).identity, snapshot.identity) || await readAnchor(run) !== snapshot.historyWire) return fail();
        await run.step(s => ports.assertCurrent(ctx, s)); run.check();
        confirmed = snapshot; phase = "ready";
        return result("bootstrapped-claims");
      } catch { close(); return fail(); } finally { run?.finish(); }
    },
    append: async (inventory: unknown, checkpoint: unknown, signal: AbortSignal) => {
      // Busy losers cannot allocate candidates or reset/poison the winner.
      if (phase !== "ready" || confirmed === null) return fail();
      phase = "appending";
      let run: ReturnType<typeof begin> | undefined;
      try {
        run = begin(signal, budgets.appendMs);
        const inventoryWire = boundedV3Text(inventory, CANDIDATE_V3_MAX_INVENTORY_BYTES);
        const checkpointWire = boundedV3Text(checkpoint, CANDIDATE_V3_MAX_CHECKPOINT_BYTES), before = confirmed;
        if (requestNumber >= Number.MAX_SAFE_INTEGER) return fail(); requestNumber++;
        const forward = context("append", run.deadline, run.nonce, "forward"), settlement = context("append", run.deadline, run.nonce, "settlement");
        await run.step(s => ports.assertCurrent(forward, s));
        if (!same((await readSnapshot(run)).identity, before.identity) || await readAnchor(run) !== before.historyWire) return fail();
        const request = encodeCandidateV3AppendRequest(wire({ domain: "agent-candidate-v3-append-request/v1", operation: "append", ...binding,
          nonce: run.nonce, requestNumber, pre: before.identity, deadline: run.deadline }), inventoryWire, checkpointWire);
        const candidate = stageCandidateV3LocalSnapshot(before.snapshotWire, inventoryWire, checkpointWire);
        await run.step(s => ports.assertCurrent(forward, s));
        const response = parseCandidateV3Response("append", await run.step(s => ports.validate(request, s)), request);
        if (!same(response.post, candidate.identity)) return fail();
        await run.step(s => ports.assertCurrent(forward, s));
        if (await readAnchor(run) !== before.historyWire) return fail();
        const commitAck = ack("agent-candidate-v3-local-commit-ack/v1", forward, candidate.identity);
        const committed = await run.step(s => { commitAttempts++; return ports.commit(wire(before.identity), candidate.snapshotWire, forward, s); });
        if (boundedV3Text(committed, V3_MESSAGE_LIMITS.responseBytes) !== commitAck) return fail();
        await run.step(s => ports.assertCurrent(settlement, s));
        if (!same((await readSnapshot(run)).identity, candidate.identity) || await readAnchor(run) !== before.historyWire) return fail();
        // No anchor contact occurs inside a ledger transaction. Drift during
        // commit may leave a local unconfirmed tail; it closes, never retries.
        const anchorAck = ack("agent-candidate-v3-anchor-append-ack/v1", settlement, candidate.identity);
        const anchored = await run.step(s => { anchorAttempts++; return ports.appendAnchor(before.historyWire, checkpointWire, settlement, s); });
        if (boundedV3Text(anchored, V3_MESSAGE_LIMITS.responseBytes) !== anchorAck) return fail();
        await run.step(s => ports.assertCurrent(settlement, s));
        if (await readAnchor(run) !== candidate.historyWire || !same((await readSnapshot(run)).identity, candidate.identity)) return fail();
        // A revoked forward grant can witness the old pair under settlement
        // authority, but cannot promote a new Ready owner. Deny conservatively.
        await run.step(s => ports.assertCurrent(forward, s)); run.check();
        confirmed = candidate; promotions++; phase = "ready";
        return result("pair-confirmed-claims");
      } catch { close(); return fail(); } finally { run?.finish(); }
    },
  });
}
