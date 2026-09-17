import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson as wire, canonicalSha256Digest as hash } from "../../src/compatibility/canonical-json.js";
import { SyntheticPairWorld as World, SyntheticPairCoordinator as Coordinator, ModelDenied, MODEL_LIMITS,
  parseModelBootstrapRequest, parseModelRequest } from "../helpers/candidate-v3-coordinator-model.js";
import type { Cut } from "../helpers/candidate-v3-coordinator-model.js";
import { make, transcript, historyWire, genesis, envelope, recordsOf } from "../helpers/candidate-v3-history-fixture.js";
import { uuid } from "../helpers/candidate-v3-record-fixture.js";
const signal = () => new AbortController().signal;
const frames = (family = 0) => { const parent = family >= 5 ? make(0, 0) : undefined, f = make(family, 1, parent), fs = parent ? [parent, f] : [f];
  return transcript(fs, fs.flatMap((r, i) => Array(r.record.events.length + 1).fill(i) as number[])); };
const first = () => frames()[0]!;
const setup = () => { const w = new World(); return { w, c: new Coordinator(w), f: first() }; };
const reject = (fn: () => Promise<unknown>) => assert.rejects(fn, e => e instanceof ModelDenied);
const deferred = () => { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; };
const throwAt = (cut: Cut) => (at: Cut) => { if (at === cut) throw Error("synthetic crash: must not escape"); };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test("model positive control: all eight families promote each exact local/anchor pair", async t => {
  let appends = 0;
  for (let family = 0; family < 8; family++) {
    const w = new World(), c = new Coordinator(w);
    for (const f of frames(family)) {
      await c.append(f.input, wire(f.checkpoint), signal()); appends++;
      assert.equal(c.phase, "ready"); assert.equal(c.confirmed.inventory, f.input);
      assert.equal(w.local.history, historyWire(f.history)); assert.equal(w.anchor, w.local.history);
    }
    assert.equal(w.counts.worker, w.counts.commits); assert.equal(w.counts.commits, w.counts.promotions);
    assert.equal(w.activity, 0); assert.equal(w.clockListeners.size, 0);
  }
  t.diagnostic(JSON.stringify({ syntheticPairedAppends: appends, physicalComposition: "NOT RUN", taskPort: "absent" }));
});

test("C01 model: advanced transcript plus pre-write rejection permanently closes the owner", async () => {
  const { w, c, f } = setup(); w.cut = at => { if (at === "worker-settled") w.schemaValid = false; };
  await reject(() => c.append(f.input, wire(f.checkpoint), signal()));
  assert.equal(w.counts.worker, 1); assert.equal(w.counts.transactions, 1); assert.equal(w.counts.commits, 0);
  w.schemaValid = true; w.cut = () => {}; await reject(() => c.append(f.input, wire(f.checkpoint), signal()));
  assert.equal(w.counts.worker, 1); assert.equal(c.phase, "closed"); assert.throws(() => new Coordinator(w), ModelDenied);
});

test("C02 model: metadata/history/row/context changes deny before write with count unchanged", async () => {
  for (const mutation of ["metadata", "history", "row", "context"] as const) {
    const w = new World(), fs = frames(), before = fs[4]!, next = fs[5]!;
    w.local = { metadata: w.local.metadata, inventory: before.input, history: historyWire(before.history) }; w.anchor = w.local.history;
    const c = new Coordinator(w), original = c.confirmed;
    w.cut = at => {
      if (at !== "worker-settled") return;
      const rows = recordsOf(w.local.inventory);
      if (mutation === "metadata") w.local = { ...w.local, metadata: wire({ ...JSON.parse(w.local.metadata), storeId: uuid(99) }) };
      if (mutation === "history") { const h = JSON.parse(w.local.history); h.checkpoints[0] = "{}"; w.local = { ...w.local, history: wire(h) }; }
      if (mutation === "row") { const r = JSON.parse(rows[0]!.recordWire); r.intent.workflowId = uuid(88); rows[0]!.recordWire = wire(r); w.local = { ...w.local, inventory: envelope(rows) }; }
      if (mutation === "context") { rows[0]!.checkpointAWire = wire(before.checkpoint); w.local = { ...w.local, inventory: envelope(rows) }; }
    };
    await reject(() => c.append(next.input, wire(next.checkpoint), signal()));
    assert.equal(w.counts.transactions, 1, mutation); assert.equal(w.counts.commits, 0, mutation);
    assert.deepEqual(c.confirmed, original); assert.equal(w.counts.anchorAttempts, 0);
  }
});

test("C02 model: a different completed row changes while another subject is staged", async () => {
  const done = make(0, 10), active = make(0, 11), order = [...Array(done.record.events.length + 1).fill(0), 1, 1] as number[];
  const fs = transcript([done, active], order), before = fs.at(-2)!, next = fs.at(-1)!;
  const w = new World(); w.local = { ...w.local, inventory: before.input, history: historyWire(before.history) }; w.anchor = w.local.history;
  const c = new Coordinator(w); assert.notEqual(next.checkpoint.operationId, done.record.intent.operationId);
  w.cut = at => {
    if (at !== "worker-settled") return;
    const rows = recordsOf(w.local.inventory), r = JSON.parse(rows[0]!.recordWire);
    assert.equal(r.intent.operationId, done.record.intent.operationId);
    r.events[0].evidenceDigest = "sha256:" + "f".repeat(64);
    rows[0]!.recordWire = wire(r); w.local = { ...w.local, inventory: envelope(rows) };
  };
  await reject(() => c.append(next.input, wire(next.checkpoint), signal()));
  assert.equal(recordsOf(w.local.inventory).length, 2); assert.equal(w.counts.transactions, 1); assert.equal(w.counts.commits, 0);
  assert.equal(w.counts.anchorAttempts, 0); assert.equal(c.confirmed.inventory, before.input);
});

test("C03/D3 model: rehashed wrong reply identities deny before transaction", async () => {
  for (const field of ["nonce", "epoch", "lifetimeId", "requestNumber", "operation", "requestDigest", "inputDigest", "checkpointDigest", "pre", "post", "deadline", "domain", "extra"] as const) {
    const { w, c, f } = setup();
    w.reply = text => { const { resultDigest: _ignored, ...core } = JSON.parse(text);
      if (field === "nonce" || field === "epoch" || field === "lifetimeId") core[field] = uuid(999);
      else if (field === "pre" || field === "post") core[field][3] = "sha256:" + "f".repeat(64);
      else if (field === "deadline" || field === "requestNumber") core[field]++;
      else if (field === "operation") core[field] = "bootstrap";
      else if (field === "domain") core[field] = "synthetic-v3-append-response/v2";
      else if (field === "extra") core[field] = true;
      else core[field] = "sha256:" + "f".repeat(64);
      return wire({ ...core, resultDigest: hash(core) }); };
    await reject(() => c.append(f.input, wire(f.checkpoint), signal()));
    assert.equal(w.counts.transactions, 0, field); assert.equal(w.counts.anchorAttempts, 0); assert.equal(c.phase, "closed");
  }
});

test("D3 bootstrap model: every echoed identity, operation and reconstructed post-state is bound", () => {
  for (const field of ["nonce", "epoch", "lifetimeId", "requestNumber", "operation", "requestDigest", "metadataDigest",
    "inventoryDigest", "historyDigest", "anchorHistoryDigest", "deadline", "post", "extra"] as const) {
    const w = new World(); w.bootstrapReply = text => {
      const { resultDigest: _ignored, ...core } = JSON.parse(text);
      if (field === "nonce" || field === "epoch" || field === "lifetimeId") core[field] = uuid(999);
      else if (field === "requestNumber" || field === "deadline") core[field]++;
      else if (field === "operation") core[field] = "append";
      else if (field === "post") core[field][3] = "sha256:" + "f".repeat(64);
      else if (field === "extra") core[field] = true;
      else core[field] = "sha256:" + "f".repeat(64);
      return wire({ ...core, resultDigest: hash(core) });
    };
    assert.throws(() => new Coordinator(w), ModelDenied, field);
    assert.equal(w.ownerHeld, false); assert.equal(w.counts.bootstraps, 0); assert.equal(w.counts.transactions, 0);
  }
});

test("D3 bootstrap model: stale lifetime reply and drift during bootstrap cannot create a ready owner", () => {
  const w = new World(); let oldReply = ""; w.bootstrapReply = text => { oldReply = text; return text; };
  const old = new Coordinator(w); w.retire(); w.bootstrapReply = () => oldReply;
  assert.throws(() => new Coordinator(w), ModelDenied); assert.equal(w.counts.bootstraps, 1);
  assert.equal(old.confirmed.inventory, w.local.inventory);
  for (const drift of ["epoch", "anchor", "deadline", "metadata"] as const) {
    const changed = new World(); changed.bootstrapReply = text => {
      if (drift === "epoch") changed.epoch = uuid(99);
      if (drift === "anchor") changed.anchor = "{}";
      if (drift === "deadline") changed.now = MODEL_LIMITS.appendMs;
      if (drift === "metadata") changed.local = { ...changed.local, metadata: "{}" };
      return text;
    };
    assert.throws(() => new Coordinator(changed), ModelDenied); assert.equal(changed.ownerHeld, false);
  }
});

test("D3 model request parsing: no object coercion, alternate JSON, missing bootstrap or cross-operation fallback", () => {
  const w = new World(); let reply = ""; w.bootstrapReply = text => { reply = text; return text; }; new Coordinator(w);
  let reflected = false;
  const active = new Proxy({}, { get() { reflected = true; throw Error("must not reflect"); }, ownKeys() { reflected = true; return []; } });
  for (const parse of [parseModelBootstrapRequest, parseModelRequest]) {
    for (const input of [active, "{}", reply, reply + "\n", "\uFEFF" + reply, "x".repeat(MODEL_LIMITS.wireBytes + 1)]) assert.throws(() => parse(input), ModelDenied);
  }
  assert.equal(reflected, false);
});

test("D3 model: request numbers increase only within one lifetime and bootstrap is zero", async () => {
  const w = new World(), observed: Array<{ operation: string; lifetimeId: string; requestNumber: number }> = [];
  w.bootstrapReply = text => { observed.push(JSON.parse(text)); return text; }; w.reply = text => { observed.push(JSON.parse(text)); return text; };
  const c = new Coordinator(w);
  for (const f of frames().slice(0, 2)) await c.append(f.input, wire(f.checkpoint), signal());
  assert.deepEqual(observed.map(r => r.requestNumber), [0, 1, 2]); assert.equal(new Set(observed.map(r => r.lifetimeId)).size, 1);
  assert.deepEqual(observed.map(r => r.operation), ["bootstrap", "append", "append"]);
});

test("C03/D4 model: live epoch/head change after worker settlement denies before transaction", async () => {
  for (const field of ["epoch", "anchor"] as const) {
    const { w, c, f } = setup(); w.cut = at => { if (at === "worker-settled") w[field] = field === "epoch" ? uuid(99) : historyWire(f.history); };
    await reject(() => c.append(f.input, wire(f.checkpoint), signal())); assert.equal(w.counts.transactions, 0); assert.equal(w.counts.commits, 0);
  }
});

test("C04 model: caller container mutation cannot alter staged primitive bytes", async () => {
  const { w, c, f } = setup(), gate = deferred(), caller = { input: f.input, cp: wire(f.checkpoint) };
  w.workerGate = () => gate.promise;
  const pending = c.append(caller.input, caller.cp, signal()); caller.input = "{}"; caller.cp = "{}";
  gate.release(); await pending; assert.equal(w.local.inventory, f.input); assert.equal(w.anchor, historyWire(f.history));
});

test("C05 model: each commit/readback/anchor response-loss cut closes without compensation or repeat", async () => {
  for (const [cut, commits, anchors] of [["transaction-post", 0, 0], ["committed", 1, 0], ["read-back", 1, 0],
    ["before-anchor", 1, 0], ["anchor-committed", 1, 1], ["before-promote", 1, 1]] as const) {
    const { w, c, f } = setup(), before = c.confirmed; w.cut = throwAt(cut);
    await reject(() => c.append(f.input, wire(f.checkpoint), signal()));
    assert.equal(w.counts.commits, commits, cut); assert.equal(w.counts.anchorAppends, anchors, cut); assert.equal(w.counts.promotions, 0);
    assert.equal(c.confirmed, before); assert.equal(c.phase, "closed"); assert.equal(w.inTransaction, false);
    assert.equal(w.local.inventory, commits ? f.input : before.inventory);
    const counts = { ...w.counts }; w.cut = () => {}; await reject(() => c.append(f.input, wire(f.checkpoint), signal())); assert.deepEqual(w.counts, counts);
  }
});

test("C06 model: virtual deadline closes while worker/anchor are unsettled; late success cannot promote", async () => {
  for (const stage of ["worker", "anchor"] as const) {
    const { w, c, f } = setup(), gate = deferred(); w[stage === "worker" ? "workerGate" : "anchorGate"] = () => gate.promise;
    const pending = c.append(f.input, wire(f.checkpoint), signal()), denied = reject(() => pending);
    await flush(); assert.equal(w.activity, 1);
    w.advance(MODEL_LIMITS.appendMs); await denied; assert.equal(c.phase, "closed"); assert.equal(w.counts.promotions, 0);
    assert.throws(() => w.retire(), ModelDenied); assert.throws(() => new Coordinator(w), ModelDenied);
    gate.release(); await flush(); assert.equal(w.activity, 0); assert.equal(w.counts.anchorAppends, 0); assert.equal(w.counts.promotions, 0);
    assert.equal(w.clockListeners.size, 0);
  }
});

test("C06 model: abort is responsive while request is pending, without treating abort as settlement", async () => {
  const { w, c, f } = setup(), gate = deferred(), controller = new AbortController(); w.workerGate = () => gate.promise;
  const pending = c.append(f.input, wire(f.checkpoint), controller.signal), denied = reject(() => pending);
  controller.abort(); await denied; assert.equal(w.activity, 1); assert.equal(w.counts.commits, 0);
  gate.release(); await flush(); assert.equal(w.activity, 0); assert.equal(w.counts.promotions, 0);
});

test("C05/C13 model: corrupt fresh ledger read-back or anchor confirmation never promotes", async () => {
  for (const target of ["read-back", "anchor-committed"] as const) {
    const { w, c, f } = setup(), old = c.confirmed;
    w.cut = at => { if (at === target) { if (target === "read-back") w.local = { ...w.local, inventory: envelope([]) }; else w.anchor = old.history; } };
    await reject(() => c.append(f.input, wire(f.checkpoint), signal()));
    assert.equal(w.counts.commits, 1); assert.equal(w.counts.promotions, 0); assert.equal(c.confirmed, old);
    assert.equal(w.counts.anchorAttempts, target === "read-back" ? 0 : 1);
  }
});

test("D3 model: old valid response cannot be replayed for the next staged request", async () => {
  const w = new World(), c = new Coordinator(w), fs = frames(); let oldReply = "";
  w.reply = text => { oldReply = text; return text; };
  await c.append(fs[0]!.input, wire(fs[0]!.checkpoint), signal());
  w.reply = () => oldReply;
  await reject(() => c.append(fs[1]!.input, wire(fs[1]!.checkpoint), signal()));
  assert.equal(w.counts.worker, 2); assert.equal(w.counts.transactions, 1); assert.equal(w.counts.promotions, 1);
});

test("C07 model: post-commit revoke may settle exact pair but cannot reopen forward work", async () => {
  for (const allowSettlement of [true, false]) {
    const { w, c, f } = setup(); w.cut = at => { if (at === "committed") { w.policy = false; w.settlement = allowSettlement; } };
    if (allowSettlement) await c.append(f.input, wire(f.checkpoint), signal()); else await reject(() => c.append(f.input, wire(f.checkpoint), signal()));
    assert.equal(w.counts.commits, 1); assert.equal(w.counts.anchorAppends, Number(allowSettlement)); assert.equal(c.phase, "closed");
    await reject(() => c.append(f.input, wire(f.checkpoint), signal())); assert.equal(w.counts.commits, 1);
  }
});

test("C08 model: restart at each cut cannot import a summary, duplicate an append or bypass discovery", async () => {
  for (const cut of ["captured", "worker-settled", "transaction-post", "committed", "read-back", "before-anchor", "anchor-committed", "before-promote"] as const) {
    const { w, c, f } = setup(); w.cut = throwAt(cut);
    await reject(() => c.append(f.input, wire(f.checkpoint), signal())); assert.throws(() => new Coordinator(w), ModelDenied);
    w.retire(); w.cut = () => {}; const counts = { ...w.counts };
    if (w.local.history !== w.anchor) assert.throws(() => new Coordinator(w));
    else { const restarted = new Coordinator(w); assert.equal(restarted.confirmed.inventory, w.local.inventory); assert.equal(restarted.phase, "ready"); }
    assert.equal(w.counts.worker, counts.worker); assert.equal(w.counts.commits, counts.commits); assert.equal(w.counts.anchorAttempts, counts.anchorAttempts);
  }
});

test("C09 model: two clients have one owner, one in-flight request, no queue", async () => {
  const { w, c, f } = setup(), gate = deferred(); w.workerGate = () => gate.promise;
  const pending = c.append(f.input, wire(f.checkpoint), signal());
  assert.throws(() => new Coordinator(w), ModelDenied);
  await reject(() => c.append(f.input, wire(f.checkpoint), signal())); assert.equal(w.counts.worker, 1);
  gate.release(); await pending; assert.equal(w.counts.promotions, 1); assert.equal(c.phase, "ready");
});

test("C10/C13 model: bootstrap equal only; one-ahead never auto-reconciles or admits", () => {
  const fs = frames();
  for (const mode of ["one-ahead", "two-ahead", "shorter", "divergent", "missing-genesis"] as const) {
    const w = new World(), f = fs[1]!; w.local = { ...w.local, inventory: f.input, history: historyWire(f.history) };
    w.anchor = mode === "one-ahead" ? historyWire(fs[0]!.history) : mode === "two-ahead" ? historyWire([genesis])
      : mode === "shorter" ? historyWire(fs[2]!.history) : mode === "divergent" ? historyWire(transcript([make(0, 9)], [0, 0])[1]!.history) : historyWire([]);
    assert.throws(() => new Coordinator(w), mode); assert.equal(w.counts.bootstraps, 0); assert.equal(w.counts.commits, 0);
  }
});

test("C11 model: loss around outcome A or release B never yields forward readiness", async () => {
  for (const index of [4, 5]) for (const cut of ["committed", "anchor-committed"] as const) {
    const w = new World(), c = new Coordinator(w), fs = frames();
    for (const f of fs.slice(0, index)) await c.append(f.input, wire(f.checkpoint), signal());
    const prior = c.confirmed, counts = { ...w.counts }, f = fs[index]!; w.cut = throwAt(cut);
    await reject(() => c.append(f.input, wire(f.checkpoint), signal())); assert.equal(c.phase, "closed"); assert.equal(c.confirmed, prior);
    assert.equal(w.counts.promotions, counts.promotions); await reject(() => c.append(f.input, wire(f.checkpoint), signal()));
    assert.equal(w.counts.commits, counts.commits + 1);
  }
});

test("model bounds: oversized/nonpassive input, regressed clock and malformed replies close without new contacts", async () => {
  for (const input of ["x".repeat(MODEL_LIMITS.wireBytes + 1), new Proxy({}, { get() { throw Error("active input"); } }), null]) {
    const { w, c, f } = setup(); await reject(() => c.append(input, wire(f.checkpoint), signal())); assert.equal(w.counts.worker, 0);
  }
  for (const reply of ["{}", " ", "x".repeat(MODEL_LIMITS.responseBytes + 1)]) {
    const { w, c, f } = setup(); w.reply = () => reply; await reject(() => c.append(f.input, wire(f.checkpoint), signal())); assert.equal(w.counts.transactions, 0);
  }
  const { w, c, f } = setup(); w.cut = at => { if (at === "worker-settled") w.now = -1; };
  await reject(() => c.append(f.input, wire(f.checkpoint), signal())); assert.equal(w.counts.transactions, 0);
});

test("D3 model: bootstrap response cap and non-finite request counters reject", () => {
  const w = new World(); w.bootstrapReply = () => "x".repeat(MODEL_LIMITS.responseBytes + 1);
  assert.throws(() => new Coordinator(w), ModelDenied);
  for (const counter of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER]) {
    const bad = new World(); bad.lifetimeCounter = counter; assert.throws(() => new Coordinator(bad), ModelDenied);
    assert.equal(bad.counts.bootstraps, 0); assert.equal(bad.ownerHeld, false);
  }
});

test("M1 model: individually bounded payloads exceeding the composite cap never reach encoding or worker", async () => {
  for (const [inventory, cp] of [["x".repeat(200 * 1024), "y".repeat(200 * 1024)],
    ['"'.repeat(90 * 1024), "\\".repeat(90 * 1024)], ["\u0000".repeat(50 * 1024), "x"]]) {
    const { w, c } = setup(), encoded = w.counts.requestEncodings;
    await reject(() => c.append(inventory, cp, signal()));
    assert.equal(w.counts.requestEncodings, encoded); assert.equal(w.counts.worker, 0);
    assert.equal(w.counts.transactions, 0); assert.equal(c.phase, "closed");
  }
  const w = new World(); w.local = { ...w.local, inventory: "x".repeat(200 * 1024), history: "y".repeat(200 * 1024) };
  w.anchor = w.local.history;
  assert.throws(() => new Coordinator(w), ModelDenied);
  assert.equal(w.counts.requestEncodings, 0); assert.equal(w.counts.bootstrapAttempts, 1);
});

test("M1 model: preflight agrees with canonical UTF-8 escaping at the exact composite boundary", async () => {
  const digest = "sha256:" + "a".repeat(64);
  const skeleton = { domain: "synthetic-v3-append-request/v1", operation: "append", lifetimeId: uuid(200001),
    requestNumber: 1, nonce: uuid(1001), epoch: uuid(70), pre: [digest, digest, digest, digest],
    inputDigest: digest, checkpointDigest: digest, deadline: MODEL_LIMITS.appendMs, inventoryWire: "", checkpointWire: "" };
  const room = MODEL_LIMITS.wireBytes - Buffer.byteLength(wire(skeleton));
  for (const scalar of ['x', '"', "\\", "\b\t\n\f\r", "\u0000\u001f", "é", "漢", "😀", "\u2028\u2029"]) {
    const content = scalar.repeat(100), escaped = Buffer.byteLength(wire(content)) - 2;
    for (const excess of [0, 1]) {
      const input = content + "x".repeat(room - escaped + excess), { w, c } = setup();
      const expected = Buffer.byteLength(wire({ ...skeleton, inventoryWire: input }));
      assert.equal(expected, MODEL_LIMITS.wireBytes + excess);
      await reject(() => c.append(input, "", signal())); // Invalid inner JSON, never a valid append.
      assert.equal(w.counts.requestEncodings, excess ? 1 : 2, scalar);
      assert.equal(w.counts.worker, excess ? 0 : 1, scalar);
      assert.equal(w.counts.commits, 0);
    }
  }
  for (const invalid of ["\ud800", "\udc00", "\ud800x"]) {
    const { w, c } = setup(); await reject(() => c.append(invalid, "", signal()));
    assert.equal(w.counts.requestEncodings, 1); assert.equal(w.counts.worker, 0);
  }
});

test("M2 model: failed bootstrap counts once and cannot be retried by constructor recreation", () => {
  for (const fault of ["reply", "snapshot", "clock", "fence"] as const) {
    const w = new World(), original = w.local;
    if (fault === "reply") w.bootstrapReply = () => "{}";
    if (fault === "snapshot") w.local = { ...w.local, inventory: "{}" };
    if (fault === "clock") w.now = -1;
    if (fault === "fence") w.fence = false;
    assert.throws(() => new Coordinator(w));
    assert.equal(w.counts.bootstrapAttempts, 1); assert.equal(w.counts.bootstraps, 0);
    w.bootstrapReply = s => s; w.local = original; w.now = 0; w.fence = true;
    const counts = { ...w.counts };
    for (let i = 0; i < 10; i++) assert.throws(() => new Coordinator(w), ModelDenied);
    assert.deepEqual(w.counts, counts); assert.equal(w.ownerHeld, false);
    const oldEpoch = w.epoch; w.retire(); assert.notEqual(w.epoch, oldEpoch);
    assert.equal(new Coordinator(w).phase, "ready"); assert.equal(w.counts.bootstrapAttempts, 2);
  }
});

test("M3/C13 model: anchor drift inside the local transaction may commit but never appends or promotes", async () => {
  const { w, c, f } = setup(), prior = c.confirmed;
  w.cut = at => { if (at === "transaction-post") { assert.equal(w.inTransaction, true); w.anchor = historyWire(f.history); } };
  await reject(() => c.append(f.input, wire(f.checkpoint), signal()));
  assert.equal(w.counts.transactions, 1); assert.equal(w.counts.commits, 1); assert.equal(w.counts.readBacks, 1);
  assert.equal(w.counts.anchorAttempts, 0); assert.equal(w.counts.promotions, 0);
  assert.equal(c.confirmed, prior); assert.equal(c.phase, "closed"); assert.equal(w.ownerHeld, true);
  assert.equal(w.local.inventory, f.input); assert.throws(() => new Coordinator(w), ModelDenied);
});
