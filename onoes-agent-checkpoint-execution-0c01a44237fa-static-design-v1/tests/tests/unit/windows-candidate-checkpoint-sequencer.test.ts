import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { canonicalJson, canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import { initializeCandidateEffectLedger, SqliteCandidateEffectLedger } from "../../src/build-only/windows-candidate-effect-ledger.js";
import { CANDIDATE_EFFECT_DOMAIN, effectApprovalIdentity, candidateEffectState } from "../../src/build-only/windows-candidate-effect-state.js";
import type { CandidateEffectAdvance, CandidateEffectIntent, CandidateEffectRecord } from "../../src/build-only/windows-candidate-effect-state.js";
import { createSyntheticCheckpointGenesis, syntheticCheckpointInventory, SyntheticCandidateCheckpointSequencer,
  SyntheticCheckpointError } from "../../src/build-only/windows-candidate-checkpoint-sequencer.js";
import type { SyntheticCheckpoint, SyntheticCheckpointAnchorPort } from "../../src/build-only/windows-candidate-checkpoint-sequencer.js";

const AT = "2026-09-14T06:00:00.000Z", d = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`;
const signal = () => new AbortController().signal;
const denies = async (action: Promise<unknown>, reason: string) => assert.rejects(action,
  (error: unknown) => error instanceof SyntheticCheckpointError && error.reason === reason);
function event(r: CandidateEffectRecord, state: CandidateEffectAdvance["state"]): CandidateEffectAdvance {
  return { operationId: r.intent.operationId, intentDigest: r.intentDigest, state, evidenceDigest: d(10),
    resultDigest: state === "result-and-stop-observed" ? d(11) : null,
    verificationPassed: state === "result-and-stop-observed" ? true : null };
}
function fixture() {
  const parent = resolve(tmpdir()), dir = mkdtempSync(join(parent, "onoes-checkpoint-pair-")), path = join(dir, "ledger.sqlite");
  let db = new Database(path);
  const namespaceId = randomUUID(), storeId = initializeCandidateEffectLedger(db, namespaceId);
  const pins = { installationId: randomUUID(), namespaceId, storeId }, generation = randomUUID();
  let ledger = new SqliteCandidateEffectLedger(db, storeId, namespaceId, () => AT);
  let currentOwner: string = generation;
  let ownerLive = true, head = createSyntheticCheckpointGenesis(pins, generation);
  const calls = { discovery: 0, append: 0, mutation: 0, inventory: 0, owner: 0 };
  const hooks: {
    discover?: () => unknown | Promise<unknown>;
    append?: (proposed: SyntheticCheckpoint, signal: AbortSignal) => unknown | Promise<unknown>;
    afterMutation?: () => void;
    inventory?: () => unknown;
    owner?: () => void;
  } = {};
  const makeIntent = (workspaceDigest = d(1)): CandidateEffectIntent => ({
    schemaVersion: CANDIDATE_EFFECT_DOMAIN, namespaceId, storeId, operationId: randomUUID(), workflowId: randomUUID(),
    approvalId: randomUUID(), kind: "execute", workspaceDigest, policyBindingDigest: d(2), candidateDigest: d(3),
    reviewMaterialDigest: d(4), sourceManifestDigest: d(5), requestDigest: d(6), guestImageDigest: d(7),
    guestGeneration: randomUUID(), controllerIdentityDigest: d(8), resourcePolicyDigest: d(9), expiresAt: "2026-09-14T06:05:00.000Z",
  });
  const outside = () => assert.equal(db.inTransaction, false, "every injected port outside SQLite transaction");
  const records = () => {
    outside();
    return ledger.snapshot();
  };
  // Real complete SQLite snapshot; the anchor and ownership ports remain synthetic.
  const ledgerPort = {
    reserve(input: unknown) { calls.mutation++; const r = ledger.reserve(input); hooks.afterMutation?.(); return r; },
    advance(input: unknown) { calls.mutation++; const r = ledger.advance(input); hooks.afterMutation?.(); return r; },
  };
  const view = () => ({ currentOwnerGeneration: currentOwner, checkpoint: head });
  const anchor: SyntheticCheckpointAnchorPort = {
    async discover(owner) {
      outside(); calls.discovery++; if (owner !== currentOwner) throw new Error("fixture owner revoked");
      return hooks.discover ? hooks.discover() : view();
    },
    async compareAndAppend(owner, expected, proposed, stopSignal) {
      outside(); calls.append++;
      if (owner !== currentOwner || head.checkpointDigest !== expected) throw new Error("fixture compare-and-append conflict");
      if (hooks.append) return hooks.append(proposed, stopSignal);
      head = proposed; return view();
    },
  };
  const options = { mode: "synthetic-only" as const, pins, ownerGeneration: generation, ledger: ledgerPort,
    snapshot: () => { outside(); calls.inventory++; return hooks.inventory ? hooks.inventory() : records(); },
    assertCurrent: () => { outside(); calls.owner++; hooks.owner?.(); if (!ownerLive || currentOwner !== generation) throw new Error("fixture owner invalid"); },
    anchor, appendMs: 1000, discoveryMs: 1000, pairMs: 3000 };
  return {
    pins, generation, makeIntent, calls, hooks, options, records, view,
    get ledger() { return ledger; }, get db() { return db; }, get head() { return head; }, set head(value) { head = value; },
    set ownerLive(value: boolean) { ownerLive = value; }, set owner(value: string) { currentOwner = value; },
    sequencer() { return new SyntheticCandidateCheckpointSequencer(options); },
    reopen() { db.close(); db = new Database(path, { fileMustExist: true }); ledger = new SqliteCandidateEffectLedger(db, storeId, namespaceId, () => AT); },
    dispose() {
      if (db.open) db.close(); const target = resolve(dir);
      assert.equal(dirname(target), parent); assert.match(basename(target), /^onoes-checkpoint-pair-[a-zA-Z0-9]+$/);
      rmSync(target, { recursive: true, force: true });
    },
  };
}

test("synthetic paired v2 execution and separately approved publication checkpoint every exact mutation", async () => {
  const f = fixture(); try {
    const sequencer = f.sequencer(), input = f.makeIntent();
    let receipt = await sequencer.reserve(input, signal());
    assert.equal(receipt.authority, "none"); assert.equal(receipt.sequence, 1);
    for (const state of ["source-delivery-possible", "launch-possible", "result-and-stop-observed", "completed"] as const)
      receipt = await sequencer.advance(event(f.ledger.read(input.operationId)!, state), signal());
    assert.equal(receipt.sequence, 5); assert.equal(f.head.operationCount, 1, "global sequence is not row count");
    const publication: CandidateEffectIntent = { ...input, kind: "publish", operationId: randomUUID(), approvalId: randomUUID(),
      executionOperationId: input.operationId, resultDigest: d(11) };
    await sequencer.reserve(publication, signal());
    for (const state of ["publication-possible", "completed"] as const)
      receipt = await sequencer.advance(event(f.ledger.read(publication.operationId)!, state), signal());
    assert.equal(receipt.sequence, 8); assert.equal(f.head.operationCount, 2);
    assert.equal(f.calls.append, 8); assert.equal(f.calls.mutation, 8); assert.equal(f.calls.discovery, 8);
    assert.equal(f.head.inventoryRootDigest, syntheticCheckpointInventory(f.records(), f.pins).inventoryRootDigest);
    assert.ok(Object.isFrozen(receipt)); assert.equal(sequencer.closed, false);
    f.reopen(); assert.equal(candidateEffectState(f.ledger.read(publication.operationId)!), "completed");
  } finally { f.dispose(); }
});

test("exact terminal replay performs bounded reads but zero ledger mutations or anchor appends", async () => {
  const f = fixture(); try {
    const s = f.sequencer(), input = f.makeIntent(); await s.reserve(input, signal());
    const cancellation = event(f.ledger.read(input.operationId)!, "cancelled");
    await s.advance(cancellation, signal());
    const saved = f.head.checkpointDigest, writes = f.calls.mutation, appends = f.calls.append;
    assert.equal((await s.reserve(input, signal())).disposition, "replayed");
    assert.equal((await s.advance(cancellation, signal())).disposition, "replayed");
    assert.equal(f.calls.mutation, writes); assert.equal(f.calls.append, appends); assert.equal(f.head.checkpointDigest, saved);
  } finally { f.dispose(); }
});

test("input snapshot precedes await and rejects proxies/getters without contact", async () => {
  const f = fixture(); try {
    const s = f.sequencer(); let traps = 0;
    await denies(s.reserve(new Proxy({}, { getPrototypeOf() { traps++; throw new Error("trap"); } }), signal()), "input-invalid");
    await denies(s.reserve(Object.defineProperty({}, "kind", { get() { traps++; return "execute"; } }), signal()), "input-invalid");
    assert.equal(traps, 0); assert.equal(f.calls.discovery, 0); assert.equal(s.closed, false);
    const input = f.makeIntent(), original = structuredClone(input);
    f.hooks.discover = () => { input.candidateDigest = d(99); return f.view(); };
    await s.reserve(input, signal());
    assert.deepEqual(f.ledger.read(original.operationId)!.intent, original);
  } finally { f.dispose(); }
});

test("absent anchor does not initialize even an empty ledger", async () => {
  const f = fixture(); try {
    f.hooks.discover = () => null; const s = f.sequencer();
    await denies(s.reserve(f.makeIntent(), signal()), "history-mismatch");
    assert.equal(f.calls.mutation, 0); assert.equal(f.calls.append, 0); assert.equal(s.closed, true);
  } finally { f.dispose(); }
});

for (const loss of ["not-persisted", "persisted-lost-reply"] as const) {
  test(`uncertain append ${loss} retains v2 row, poisons owner and never compensates`, async () => {
    const f = fixture(); try {
      f.hooks.append = proposed => { if (loss === "persisted-lost-reply") f.head = proposed; throw new Error("private fixture error"); };
      const s = f.sequencer(), input = f.makeIntent();
      await denies(s.reserve(input, signal()), "port-failed");
      assert.equal(f.calls.mutation, 1); assert.equal(f.calls.append, 1); assert.equal(s.closed, true);
      f.reopen(); assert.equal(candidateEffectState(f.ledger.read(input.operationId)!), "reserved");
      assert.equal(f.head.sequence, loss === "persisted-lost-reply" ? 1 : 0);
      await denies(s.reserve(f.makeIntent(d(20)), signal()), "closed");
      await denies(f.sequencer().reserve(input, signal()), "closed");
      assert.equal(f.calls.mutation, 1); assert.equal(f.calls.append, 1);
    } finally { f.dispose(); }
  });
}

test("terminal append loss blocks sequencer even where raw v2 terminal is releasing", async () => {
  const f = fixture(); try {
    const s = f.sequencer(), input = f.makeIntent(); await s.reserve(input, signal());
    f.hooks.append = () => { throw new Error("terminal acknowledgment lost"); };
    await denies(s.advance(event(f.ledger.read(input.operationId)!, "cancelled"), signal()), "port-failed");
    f.reopen(); assert.deepEqual(f.ledger.listBlocked(), []);
    assert.equal(candidateEffectState(f.ledger.read(input.operationId)!), "cancelled");
    await denies(s.reserve(f.makeIntent(), signal()), "closed");
    assert.equal(f.calls.mutation, 2); assert.equal(f.calls.append, 2);
  } finally { f.dispose(); }
});

test("mutation response loss never appends a guessed checkpoint or compensating terminal", async () => {
  const f = fixture(); try {
    f.hooks.afterMutation = () => { throw new Error("COMMIT response loss"); };
    const s = f.sequencer(), input = f.makeIntent();
    await denies(s.reserve(input, signal()), "mutation-unconfirmed");
    assert.equal(f.calls.append, 0); assert.equal(f.calls.mutation, 1);
    f.reopen(); assert.equal(candidateEffectState(f.ledger.read(input.operationId)!), "reserved");
    assert.equal(s.closed, true);
  } finally { f.dispose(); }
});

test("concurrent work and reentrant callbacks reject without poisoning the active pair", async () => {
  const f = fixture(); try {
    let release!: (value: unknown) => void;
    f.hooks.discover = () => new Promise(resolve => { release = resolve; });
    const a = f.sequencer(), b = f.sequencer(), input = f.makeIntent();
    const first = a.reserve(input, signal());
    await denies(b.reserve(f.makeIntent(d(20)), signal()), "busy");
    release(f.view()); await first;
    assert.equal(f.calls.mutation, 1); assert.equal(f.calls.append, 1); assert.equal(a.closed, false);
    delete f.hooks.discover;
    let reentry: Promise<void> | undefined;
    f.hooks.append = proposed => { reentry = denies(a.reserve(f.makeIntent(d(30)), signal()), "busy"); f.head = proposed; return f.view(); };
    await a.advance(event(f.ledger.read(input.operationId)!, "cancelled"), signal());
    await reentry; assert.equal(f.calls.mutation, 2); assert.equal(a.closed, false);
  } finally { f.dispose(); }
});

test("already aborted request makes zero port contacts", async () => {
  const f = fixture(); try {
    const controller = new AbortController(); controller.abort();
    await denies(f.sequencer().reserve(f.makeIntent(), controller.signal), "cancelled");
    assert.deepEqual(f.calls, { discovery: 0, append: 0, mutation: 0, inventory: 0, owner: 0 });
  } finally { f.dispose(); }
});

test("abort after durable mutation never starts anchor append", async () => {
  const f = fixture(); try {
    const controller = new AbortController(); f.hooks.afterMutation = () => controller.abort();
    const s = f.sequencer(), input = f.makeIntent();
    await denies(s.reserve(input, controller.signal), "cancelled");
    assert.equal(f.calls.mutation, 1); assert.equal(f.calls.append, 0); assert.equal(s.closed, true);
    assert.equal(candidateEffectState(f.ledger.read(input.operationId)!), "reserved");
  } finally { f.dispose(); }
});

test("timeout of unsettled append stays closed after late success and aborts only its injected signal", async () => {
  const f = fixture(); try {
    let settle!: (value: unknown) => void, proposal!: SyntheticCheckpoint, portSignal!: AbortSignal;
    f.hooks.append = (p, s) => { proposal = p; portSignal = s; return new Promise(resolve => { settle = resolve; }); };
    const s = new SyntheticCandidateCheckpointSequencer({ ...f.options, appendMs: 15 });
    const input = f.makeIntent(); await denies(s.reserve(input, signal()), "deadline");
    assert.equal(portSignal.aborted, true); assert.equal(s.closed, true);
    f.head = proposal; settle(f.view()); await new Promise(resolve => setImmediate(resolve));
    await denies(s.reserve(input, signal()), "closed");
    assert.equal(f.calls.mutation, 1); assert.equal(f.calls.append, 1);
  } finally { f.dispose(); }
});

test("a fulfilled late port result cannot evade its own deadline when timer loses the race", async () => {
  const f = fixture(); try {
    let now = 0; f.hooks.discover = () => { now = 10; return f.view(); };
    const s = new SyntheticCandidateCheckpointSequencer({ ...f.options, discoveryMs: 10, monotonicNow: () => now });
    await denies(s.reserve(f.makeIntent(), signal()), "deadline");
    assert.equal(f.calls.mutation, 0); assert.equal(s.closed, true);
  } finally { f.dispose(); }
});

test("abort plus synchronous injected throw leaves no unhandled rejection", async () => {
  const f = fixture(); try {
    const controller = new AbortController();
    const s = new SyntheticCandidateCheckpointSequencer({ ...f.options, anchor: {
      discover() { controller.abort(); throw new Error("private sync failure"); },
      async compareAndAppend() { assert.fail("no append"); },
    } });
    await denies(s.reserve(f.makeIntent(), controller.signal), "port-failed");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(s.closed, true); assert.equal(f.calls.mutation, 0);
  } finally { f.dispose(); }
});

for (const seam of ["discovery", "append"] as const) {
  test(`revocation after ${seam} refuses disclosure and further writes`, async () => {
    const f = fixture(); try {
      if (seam === "discovery") f.hooks.discover = () => { f.ownerLive = false; return f.view(); };
      else f.hooks.append = proposed => { f.head = proposed; f.ownerLive = false; return f.view(); };
      const s = f.sequencer(); await denies(s.reserve(f.makeIntent(), signal()), "owner-invalid");
      assert.equal(f.calls.mutation, seam === "discovery" ? 0 : 1); assert.equal(s.closed, true);
    } finally { f.dispose(); }
  });
}

test("wrong owner and clock regression fail closed before new mutation", async () => {
  const f = fixture(); try {
    let now = 5; const s = new SyntheticCandidateCheckpointSequencer({ ...f.options, monotonicNow: () => now });
    const input = f.makeIntent(); await s.reserve(input, signal()); now = 4;
    await denies(s.reserve(input, signal()), "clock-invalid"); assert.equal(s.closed, true); assert.equal(f.calls.mutation, 1);
  } finally { f.dispose(); }
  const g = fixture(); try {
    g.owner = randomUUID(); await denies(g.sequencer().reserve(g.makeIntent(), signal()), "owner-invalid");
    assert.equal(g.calls.discovery, 0); assert.equal(g.calls.mutation, 0);
  } finally { g.dispose(); }
});

test("unexpected inventory mutation during discover denies before requested write", async () => {
  const f = fixture(); try {
    f.hooks.discover = () => { f.ledger.reserve(f.makeIntent(d(50))); return f.view(); };
    await denies(f.sequencer().reserve(f.makeIntent(), signal()), "history-mismatch");
    assert.equal(f.calls.mutation, 0); assert.equal(f.calls.append, 0);
  } finally { f.dispose(); }
});

test("unexpected inventory mutation after append withholds result and closes owner", async () => {
  const f = fixture(); try {
    f.hooks.append = proposed => { f.head = proposed; f.ledger.reserve(f.makeIntent(d(50))); return f.view(); };
    const s = f.sequencer(); await denies(s.reserve(f.makeIntent(), signal()), "history-mismatch");
    assert.equal(s.closed, true); assert.equal(f.calls.mutation, 1); assert.equal(f.calls.append, 1);
  } finally { f.dispose(); }
});

test("mismatched and accessor-bearing append replies never count as confirmation", async () => {
  for (const accessor of [false, true]) {
    const f = fixture(); try {
      let getters = 0;
      f.hooks.append = proposed => accessor
        ? Object.defineProperty({}, "checkpoint", { get() { getters++; return proposed; } })
        : f.view(); // old head, not the proposed checkpoint
      const s = f.sequencer(); await denies(s.reserve(f.makeIntent(), signal()), "history-mismatch");
      assert.equal(getters, 0); assert.equal(s.closed, true); assert.equal(f.calls.mutation, 1);
    } finally { f.dispose(); }
  }
});

test("complete inventory includes spent terminals and independently rejects duplicates and hostile arrays", () => {
  const f = fixture(); try {
    let r = f.ledger.reserve(f.makeIntent()).record; r = f.ledger.advance(event(r, "cancelled")).record;
    const inventory = syntheticCheckpointInventory([r], f.pins);
    assert.equal(inventory.operationCount, 1); assert.equal(inventory.entries[0]!.state, "cancelled");
    assert.notEqual(inventory.inventoryRootDigest, syntheticCheckpointInventory([], f.pins).inventoryRootDigest);
    let traps = 0;
    const vectors = [[r, r], Object.defineProperty([], "0", { get() { traps++; return r; } }),
      new Proxy([], { getPrototypeOf() { traps++; throw new Error("trap"); } }), new Array(1001), Object.assign([r], { extra: true })];
    for (const value of vectors) assert.throws(() => syntheticCheckpointInventory(value, f.pins), /history-mismatch/);
    assert.equal(traps, 0);
  } finally { f.dispose(); }
});

test("maximum 1000-record synthetic inventory canonicalizes as bounded tuples, independent of input order", () => {
  const f = fixture(); try {
    const records = Array.from({ length: 1000 }, (_, i) => {
      const intent = f.makeIntent(d(i + 100));
      return { intent, intentDigest: canonicalSha256Digest(intent), approvalIdentityDigest: effectApprovalIdentity(intent), reservedAt: AT, events: [] };
    });
    const a = syntheticCheckpointInventory(records, f.pins), b = syntheticCheckpointInventory([...records].reverse(), f.pins);
    assert.equal(a.operationCount, 1000); assert.equal(a.inventoryRootDigest, b.inventoryRootDigest);
    assert.throws(() => syntheticCheckpointInventory([...records, records[0]], f.pins), /history-mismatch/);
    assert.ok(Object.isFrozen(a.entries));
  } finally { f.dispose(); }
});

test("explicit fixture budgets and mode cannot silently widen to production or infinity", () => {
  const f = fixture(); try {
    for (const appendMs of [0, -1, Infinity, NaN, 1.5, 30_001])
      assert.throws(() => new SyntheticCandidateCheckpointSequencer({ ...f.options, appendMs }), /input-invalid/);
    assert.throws(() => new SyntheticCandidateCheckpointSequencer({ ...f.options, appendMs: 2000, discoveryMs: 2000, pairMs: 3000 }), /input-invalid/);
    assert.throws(() => new SyntheticCandidateCheckpointSequencer({ ...f.options, mode: "production" as "synthetic-only" }), /input-invalid/);
    assert.equal(f.calls.mutation, 0);
  } finally { f.dispose(); }
});

test("wrong intent store pin denies before inventory or anchor contact", async () => {
  const f = fixture(); try {
    const s = f.sequencer();
    await denies(s.reserve({ ...f.makeIntent(), storeId: randomUUID() }, signal()), "input-invalid");
    assert.equal(f.calls.inventory, 0); assert.equal(f.calls.discovery, 0); assert.equal(f.calls.mutation, 0);
    assert.equal(s.closed, false);
  } finally { f.dispose(); }
});

test("checkpoint latest-record binding is checked even when its inventory root matches", async () => {
  const f = fixture(); try {
    const s = f.sequencer(); await s.reserve(f.makeIntent(), signal());
    const { checkpointDigest: _ignored, ...core } = f.head;
    const forged = { ...core, operationId: randomUUID() };
    f.head = { ...forged, checkpointDigest: canonicalSha256Digest(forged) };
    await denies(s.reserve(f.makeIntent(d(40)), signal()), "history-mismatch");
    assert.equal(f.calls.mutation, 1); assert.equal(f.calls.append, 1);
  } finally { f.dispose(); }
});

test("independently retained fixture root detects deleted terminal, coherent rewrite and ledger rollback", async () => {
  for (const corrupt of ["delete", "rollback", "coherent-rewrite"] as const) {
    const f = fixture(); try {
      const s = f.sequencer(), input = f.makeIntent(); await s.reserve(input, signal());
      const beforeTerminal = f.db.prepare("SELECT * FROM candidate_effect_operations").get() as Record<string, unknown>;
      await s.advance(event(f.ledger.read(input.operationId)!, "cancelled"), signal());
      if (corrupt === "delete") f.db.prepare("DELETE FROM candidate_effect_operations WHERE operation_id=?").run(input.operationId);
      else if (corrupt === "rollback") f.db.prepare("UPDATE candidate_effect_operations SET blocked=?,record_json=?,record_digest=? WHERE operation_id=?")
        .run(beforeTerminal["blocked"], beforeTerminal["record_json"], beforeTerminal["record_digest"], input.operationId);
      else {
        const record = structuredClone(f.ledger.read(input.operationId)!);
        record.intent.candidateDigest = d(99); record.intentDigest = canonicalSha256Digest(record.intent);
        f.db.prepare("UPDATE candidate_effect_operations SET record_json=?,record_digest=? WHERE operation_id=?")
          .run(canonicalJson(record), canonicalSha256Digest(record), input.operationId);
      }
      f.reopen();
      await denies(s.reserve(f.makeIntent(d(41)), signal()), "history-mismatch");
      assert.equal(f.calls.mutation, 2); assert.equal(f.calls.append, 2);
    } finally { f.dispose(); }
  }
});

test("wrong mutation receipt cannot anchor an extra unrequested transition", async () => {
  const f = fixture(); try {
    const port = { ...f.options.ledger, reserve(value: unknown) {
      const receipt = f.options.ledger.reserve(value);
      return f.ledger.advance(event(receipt.record, "cancelled"));
    } };
    const s = new SyntheticCandidateCheckpointSequencer({ ...f.options, ledger: port });
    const input = f.makeIntent(); await denies(s.reserve(input, signal()), "history-mismatch");
    assert.equal(f.calls.append, 0); assert.equal(s.closed, true);
    assert.equal(candidateEffectState(f.ledger.read(input.operationId)!), "cancelled");
  } finally { f.dispose(); }
});

test("insufficient append reserve denies before SQLite mutation after a slow synchronous owner check", async () => {
  const f = fixture(); try {
    let now = 0;
    f.hooks.owner = () => { if (f.calls.discovery > 0) now += 1; };
    const s = new SyntheticCandidateCheckpointSequencer({ ...f.options, discoveryMs: 10, appendMs: 100, pairMs: 110, monotonicNow: () => now });
    // Discovery remains inside its own ten-ms deadline; the later fresh checks
    // consume more than the ten-ms slack before the reserved append interval.
    f.hooks.inventory = () => { if (f.calls.discovery > 0) now += 8; return f.records(); };
    await denies(s.reserve(f.makeIntent(), signal()), "deadline");
    assert.equal(f.calls.mutation, 0); assert.equal(f.calls.append, 0);
  } finally { f.dispose(); }
});

test("inventory re-derives approval, workflow, blocker and parent invariants rather than trusting a port", () => {
  const f = fixture(); try {
    const reserved = (intent: CandidateEffectIntent): CandidateEffectRecord => ({ intent, intentDigest: canonicalSha256Digest(intent),
      approvalIdentityDigest: effectApprovalIdentity(intent), reservedAt: AT, events: [] });
    const a = f.makeIntent(), b = f.makeIntent(d(42));
    for (const input of [{ ...b, approvalId: a.approvalId }, { ...b, workflowId: a.workflowId }, { ...b, workspaceDigest: a.workspaceDigest }])
      assert.throws(() => syntheticCheckpointInventory([reserved(a), reserved(input)], f.pins), /history-mismatch/);
    const missingParent: CandidateEffectIntent = { ...b, kind: "publish", executionOperationId: randomUUID(), resultDigest: d(11) };
    assert.throws(() => syntheticCheckpointInventory([reserved(missingParent)], f.pins), /history-mismatch/);
  } finally { f.dispose(); }
});
