import assert from "node:assert/strict";
import { canonicalJson as wire, sha256Digest } from "../../src/compatibility/canonical-json.js";
import { createCandidateV3Coordinator, type CandidateV3CoordinatorPorts } from "../../src/build-only/windows-candidate-v3-coordinator.js";
import { encodeCandidateV3LocalSnapshot, parseCandidateV3LocalSnapshot } from "../../src/build-only/windows-candidate-v3-coordinator-data.js";
import { createCandidateV3ValidationSession } from "../../src/build-only/windows-candidate-v3-validation-session.js";
import { pins, envelope, historyWire, genesis, type Frame } from "./candidate-v3-history-fixture.js";
import { uuid } from "./candidate-v3-record-fixture.js";

// TEST ONLY: strings and synchronous assignments, not SQLite/IPC/physical custody.
// Every async seam can be suspended or faulted by the test driver. No hook is
// handed into the product's commit API. A real adapter remains unimplemented.
export const coordinatorBinding = wire({ lifetimeId: uuid(8000), epoch: uuid(8001) });
export type PortName = "current" | "ledger" | "anchor" | "validate" | "commit" | "append-anchor";
export function coordinatorFixture(initial?: Frame, budgets?: { bootstrapMs: number; appendMs: number }) {
  const local = initial ? encodeCandidateV3LocalSnapshot(pins, initial.input, historyWire(initial.history))
    : encodeCandidateV3LocalSnapshot(pins, envelope([]), historyWire([genesis]));
  const state = { ledger: local, anchor: parseCandidateV3LocalSnapshot(local).historyWire,
    now: 0, epoch: uuid(8001), forward: true, settlement: true, schema: true, transaction: false,
    writes: 0, anchorWrites: 0, invalidations: 0 };
  const trace: string[] = [];
  const hooks: {
    before?: (name: PortName, signal: AbortSignal) => void | Promise<void>;
    after?: (name: PortName, signal: AbortSignal) => void | Promise<void>;
    reply?: (name: PortName, value: unknown) => unknown;
    transactionCut?: () => void;
  } = {};
  const clock = () => state.now;
  const session = createCandidateV3ValidationSession(coordinatorBinding, clock);
  const context = (text: string, signal: AbortSignal, kind?: string) => {
    const c = JSON.parse(text) as { lifetimeId: string; epoch: string; deadline: number; authorization: string; operation: string };
    assert.equal(signal.aborted, false); assert.equal(c.lifetimeId, uuid(8000)); assert.equal(c.epoch, state.epoch);
    assert(state.now < c.deadline); if (kind) assert.equal(c.authorization, kind);
    assert(c.authorization === "forward" ? state.forward : c.authorization === "settlement" && state.settlement);
    return c;
  };
  const call = async <T>(name: PortName, signal: AbortSignal, work: () => T): Promise<T> => {
    assert.equal(state.transaction, false); trace.push("before:" + name);
    await hooks.before?.(name, signal); assert.equal(signal.aborted, false);
    const value = work(); trace.push("after:" + name);
    await hooks.after?.(name, signal);
    return (hooks.reply ? hooks.reply(name, value) : value) as T;
  };
  const ack = (domain: string, ctx: string) => wire({ domain, contextDigest: sha256Digest(ctx),
    post: parseCandidateV3LocalSnapshot(state.ledger).identity });
  const ports: CandidateV3CoordinatorPorts = {
    kind: "synthetic-v3-coordinator-ports-not-physical",
    assertCurrent: (ctx, s) => call("current", s, () => { context(ctx, s); }),
    readLedger: s => call("ledger", s, () => state.ledger),
    readAnchor: s => call("anchor", s, () => state.anchor),
    validate: (q, s) => call("validate", s, () => session.request(q, s)),
    commit: (pre, candidate, ctx, s) => call("commit", s, () => {
      state.transaction = true;
      try {
        hooks.transactionCut?.(); // Test driver only; deliberately synchronous.
        context(ctx, s, "forward"); assert(state.schema);
        assert.equal(wire(parseCandidateV3LocalSnapshot(state.ledger).identity), pre);
        const next = parseCandidateV3LocalSnapshot(candidate);
        state.ledger = next.snapshotWire; state.writes++;
        assert.equal(state.ledger, candidate);
        return ack("agent-candidate-v3-local-commit-ack/v1", ctx);
      } finally { state.transaction = false; }
    }),
    appendAnchor: (prior, cp, ctx, s) => call("append-anchor", s, () => {
      context(ctx, s, "settlement"); assert.equal(state.anchor, prior);
      const h = JSON.parse(prior) as { domain: string; checkpoints: string[] };
      const next = wire({ domain: h.domain, checkpoints: [...h.checkpoints, cp] });
      assert.equal(next, parseCandidateV3LocalSnapshot(state.ledger).historyWire);
      state.anchor = next; state.anchorWrites++;
      return ack("agent-candidate-v3-anchor-append-ack/v1", ctx);
    }),
    invalidateValidation: () => { state.invalidations++; session.close(); },
  };
  const coordinator = createCandidateV3Coordinator(coordinatorBinding, ports, clock, budgets ? wire(budgets) : undefined);
  return { state, trace, hooks, ports, coordinator, session, clock };
}

export function deferredGate() {
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  return { waiting, release, hold: async () => { entered(); await pending; } };
}
