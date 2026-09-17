import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { canonicalJson as wire, canonicalSha256Digest as hash } from "../../src/compatibility/canonical-json.js";
import { createCandidateV3Coordinator, CandidateV3CoordinatorError } from "../../src/build-only/windows-candidate-v3-coordinator.js";
import { encodeCandidateV3LocalSnapshot, parseCandidateV3LocalSnapshot, stageCandidateV3LocalSnapshot } from "../../src/build-only/windows-candidate-v3-coordinator-data.js";
import { inspectSyntheticPairClaims } from "../helpers/candidate-v3-pair-claims.js";
import { make, transcript, pins, envelope, historyWire, genesis } from "../helpers/candidate-v3-history-fixture.js";
import { coordinatorFixture, coordinatorBinding, deferredGate } from "../helpers/candidate-v3-coordinator-ports.js";
import { uuid } from "../helpers/candidate-v3-record-fixture.js";
const signal = () => new AbortController().signal;
const frames = (family = 0) => {
  const parent = family >= 5 ? make(0, 0) : undefined, f = make(family, 1, parent), fs = parent ? [parent, f] : [f];
  return transcript(fs, fs.flatMap((r, i) => Array(r.record.events.length + 1).fill(i) as number[]));
};
const first = frames()[0]!;
const started = async () => { const f = coordinatorFixture(); await f.coordinator.bootstrap(signal()); f.trace.length = 0; return f; };
const append = (f: ReturnType<typeof coordinatorFixture>) => f.coordinator.append(first.input, wire(first.checkpoint), signal());
const closed = (f: ReturnType<typeof coordinatorFixture>) => {
  assert.equal(f.coordinator.status().phase, "closed"); assert.equal(f.state.invalidations, 1);
  assert.equal(f.session.status().phase, "closed");
  assert.throws(() => createCandidateV3Coordinator(coordinatorBinding, f.ports, f.clock), CandidateV3CoordinatorError);
};

test("coordinator: 53 paired prefixes use the real session and match full-reference identities", async t => {
  let count = 0;
  for (let family = 0; family < 8; family++) {
    const f = await started(); let n = 0;
    for (const frame of frames(family)) {
      const result = await f.coordinator.append(frame.input, wire(frame.checkpoint), signal());
      const h = historyWire(frame.history), expected = inspectSyntheticPairClaims(pins, frame.input, h, h);
      assert.deepEqual(result.identity, expected.identity); assert.equal(result.kind, "dormant-v3-coordination-not-admission");
      assert.equal(result.disposition, "pair-confirmed-claims"); assert.equal(f.state.anchor, h);
      assert.deepEqual(parseCandidateV3LocalSnapshot(f.state.ledger).identity, expected.identity);
      n++; count++; assert.equal(f.state.writes, n); assert.equal(f.state.anchorWrites, n);
      assert.equal(f.coordinator.status().promotions, n); assert.equal(f.coordinator.status().pendingPorts, 0);
      assert.equal(f.coordinator.status().phase, "ready");
    }
    assert.equal(f.coordinator.status().bootstrapAttempts, 1); f.coordinator.close();
  }
  assert.equal(count, 53); t.diagnostic("53 synthetic paired appends; no real ledger, anchor, worker, task or admission");
});

test("nonempty bootstrap fully replays, then accepts exactly the next prefix without importing a summary", async () => {
  const fs = frames(), initial = fs[3]!, f = coordinatorFixture(initial);
  const b = await f.coordinator.bootstrap(signal());
  assert.deepEqual(b.identity, inspectSyntheticPairClaims(pins, initial.input, historyWire(initial.history), historyWire(initial.history)).identity);
  assert.equal(f.coordinator.status().requestNumber, 0);
  await f.coordinator.append(fs[4]!.input, wire(fs[4]!.checkpoint), signal());
  assert.equal(f.coordinator.status().requestNumber, 1);
  assert.deepEqual(Object.keys(f.coordinator).sort(), ["append", "bootstrap", "close", "status"]);
});

test("bootstrap rejects mismatched streams, missing genesis and invalid inventory once with no retry", async () => {
  const fs = frames();
  for (const fault of ["one-ahead", "two-ahead", "shorter", "divergent", "missing-genesis", "inventory", "malformed"] as const) {
    const f = coordinatorFixture(fs[1]!);
    if (fault === "one-ahead") f.state.anchor = historyWire(fs[0]!.history);
    if (fault === "two-ahead") f.state.anchor = historyWire([genesis]);
    if (fault === "shorter") f.state.anchor = historyWire(fs[2]!.history);
    if (fault === "divergent") f.state.anchor = "{}";
    if (fault === "missing-genesis") {
      const h = historyWire(fs[1]!.history.slice(1)); f.state.anchor = h;
      f.state.ledger = encodeCandidateV3LocalSnapshot(pins, fs[1]!.input, h);
    }
    if (fault === "inventory") f.state.ledger = encodeCandidateV3LocalSnapshot(pins, "{}", f.state.anchor);
    if (fault === "malformed") f.state.ledger = "{}";
    await assert.rejects(f.coordinator.bootstrap(signal()), CandidateV3CoordinatorError); closed(f);
    const contacts = f.trace.length;
    await assert.rejects(f.coordinator.bootstrap(signal()), CandidateV3CoordinatorError);
    assert.equal(f.trace.length, contacts); assert.equal(f.coordinator.status().bootstrapAttempts, 1);
    assert.equal(f.state.writes, 0); assert.equal(f.state.anchorWrites, 0);
  }
});

test("bootstrap refresh rejects drift after a correct worker reply", async () => {
  for (const target of ["ledger", "anchor", "epoch"] as const) {
    const f = coordinatorFixture(); f.hooks.after = name => {
      if (name === "validate") {
        if (target === "ledger") f.state.ledger = encodeCandidateV3LocalSnapshot(pins, first.input, historyWire(first.history));
        if (target === "anchor") f.state.anchor = historyWire(first.history);
        if (target === "epoch") f.state.epoch = uuid(9999);
      }
    };
    await assert.rejects(f.coordinator.bootstrap(signal()), CandidateV3CoordinatorError); closed(f);
    assert.equal(f.coordinator.status().confirmedIdentity, null); assert.equal(f.state.writes, 0);
  }
});

test("primitive candidate boundary rejects active objects and oversized checkpoints before port contact", async () => {
  let touches = 0; const p = new Proxy({}, { get() { touches++; throw Error("secret"); }, ownKeys() { touches++; return []; } });
  for (const [inventory, cp] of [[p, wire(first.checkpoint)], [first.input, p], [first.input, "x".repeat(4097)],
    [Buffer.from(first.input), wire(first.checkpoint)], [new String(first.input), wire(first.checkpoint)]]) {
    const f = await started(); await assert.rejects(f.coordinator.append(inventory, cp, signal()), CandidateV3CoordinatorError);
    closed(f); assert.equal(f.trace.length, 0); assert.equal(f.state.writes, 0);
  }
  assert.equal(touches, 0);
});

test("snapshot parsing is exact and staging binds the predecessor without claiming full history validity", () => {
  const base = encodeCandidateV3LocalSnapshot(pins, envelope([]), historyWire([genesis]));
  for (const bad of [base + "\n", "\uFEFF" + base, "{}", new String(base), Buffer.from(base)]) assert.throws(() => parseCandidateV3LocalSnapshot(bad));
  const staged = stageCandidateV3LocalSnapshot(base, first.input, wire(first.checkpoint));
  assert.equal(staged.historyWire, historyWire(first.history)); assert(Object.isFrozen(staged.identity));
  assert.throws(() => stageCandidateV3LocalSnapshot(base, frames()[1]!.input, wire(frames()[1]!.checkpoint)));
  // Byte-claim parser deliberately does NOT substitute for the session validator.
  assert.equal(parseCandidateV3LocalSnapshot(encodeCandidateV3LocalSnapshot(pins, "{}", historyWire([genesis]))).inventoryWire, "{}");
});

test("rehashed wrong worker post, nonce and request identity never contact commit", async () => {
  for (const operation of ["bootstrap", "append"] as const) for (const field of ["post-history", "post-head", "nonce", "requestDigest"]) {
    const f = operation === "append" ? await started() : coordinatorFixture();
    f.hooks.reply = (name, value) => {
      if (name !== "validate") return value;
      const { resultDigest: _ignored, ...core } = JSON.parse(value as string);
      if (field.startsWith("post")) core.post[field === "post-history" ? 2 : 3] = "sha256:" + "f".repeat(64);
      else core[field] = field === "nonce" ? uuid(999) : "sha256:" + "f".repeat(64);
      return wire({ ...core, resultDigest: hash(core) });
    };
    await assert.rejects(operation === "append" ? append(f) : f.coordinator.bootstrap(signal()), CandidateV3CoordinatorError);
    closed(f); assert.equal(f.state.writes, 0); assert.equal(f.coordinator.status().commitAttempts, 0);
  }
});

test("transaction rechecks complete pre-state and schema/epoch before any write", async () => {
  for (const field of ["metadataWire", "inventoryWire", "historyWire", "schema", "epoch"] as const) {
    const f = await started(); f.hooks.transactionCut = () => {
      if (field === "schema") f.state.schema = false;
      else if (field === "epoch") f.state.epoch = uuid(999);
      else {
        const s = parseCandidateV3LocalSnapshot(f.state.ledger);
        const meta = { ...JSON.parse(s.metadataWire), storeId: uuid(999) };
        f.state.ledger = encodeCandidateV3LocalSnapshot(field === "metadataWire" ? wire(meta) : s.metadataWire,
          field === "inventoryWire" ? first.input : s.inventoryWire,
          field === "historyWire" ? historyWire(first.history) : s.historyWire);
      }
    };
    await assert.rejects(append(f), CandidateV3CoordinatorError); closed(f);
    assert.equal(f.state.writes, 0); assert.equal(f.state.anchorWrites, 0); assert.equal(f.coordinator.status().commitAttempts, 1);
    await assert.rejects(append(f), CandidateV3CoordinatorError); assert.equal(f.coordinator.status().commitAttempts, 1);
  }
});

test("optional context disappearing on an unrelated row is pre-state drift even with identical record bytes", async () => {
  const a = make(0, 1), b = make(0, 2), fs = transcript([a, b], [0, 0, 0, 0, 0, 0, 1]);
  const prior = fs[5]!, next = fs[6]!, f = coordinatorFixture(prior); await f.coordinator.bootstrap(signal());
  f.hooks.transactionCut = () => {
    const s = parseCandidateV3LocalSnapshot(f.state.ledger), inventory = JSON.parse(s.inventoryWire);
    assert.notEqual(inventory.records[0].checkpointAWire, null); inventory.records[0].checkpointAWire = null;
    f.state.ledger = encodeCandidateV3LocalSnapshot(s.metadataWire, wire(inventory), s.historyWire);
  };
  await assert.rejects(f.coordinator.append(next.input, wire(next.checkpoint), signal()), CandidateV3CoordinatorError);
  closed(f); assert.equal(f.state.writes, 0); assert.equal(f.state.anchorWrites, 0);
});

test("anchor drift inside commit leaves only a local unconfirmed tail, never promotion or compensation", async () => {
  const f = await started(), before = f.coordinator.status().confirmedIdentity;
  f.hooks.transactionCut = () => { f.state.anchor = "{}"; };
  await assert.rejects(append(f), CandidateV3CoordinatorError); closed(f);
  assert.equal(f.state.writes, 1); assert.equal(f.state.anchorWrites, 0);
  assert.equal(f.coordinator.status().anchorAttempts, 0); assert.equal(f.coordinator.status().promotions, 0);
  assert.deepEqual(f.coordinator.status().confirmedIdentity, before);
});

test("lost commit and anchor replies retain observed writes and never repeat either attempt", async () => {
  for (const port of ["commit", "append-anchor"] as const) {
    const f = await started(), before = f.coordinator.status().confirmedIdentity;
    f.hooks.after = name => { if (name === port) throw Error("private adapter diagnostic"); };
    await assert.rejects(append(f), e => e instanceof CandidateV3CoordinatorError && !e.message.includes("private")); closed(f);
    assert.equal(f.state.writes, 1); assert.equal(f.state.anchorWrites, port === "commit" ? 0 : 1);
    assert.equal(f.coordinator.status().promotions, 0); assert.deepEqual(f.coordinator.status().confirmedIdentity, before);
    const n = f.trace.length; await assert.rejects(append(f), CandidateV3CoordinatorError); assert.equal(f.trace.length, n);
  }
});

test("ack substitution and corrupt post-commit readback deny anchor or promotion", async () => {
  for (const fault of ["commit-ack", "anchor-ack", "ledger-readback", "anchor-readback"] as const) {
    const f = await started(); f.hooks.reply = (name, value) => {
      if ((fault === "commit-ack" && name === "commit") || (fault === "anchor-ack" && name === "append-anchor")) {
        const ack = JSON.parse(value as string); ack.contextDigest = "sha256:" + "f".repeat(64); return wire(ack);
      }
      if (fault === "ledger-readback" && name === "ledger" && f.state.writes) return "{}";
      if (fault === "anchor-readback" && name === "anchor" && f.state.anchorWrites) return "{}";
      return value;
    };
    await assert.rejects(append(f), CandidateV3CoordinatorError); closed(f);
    assert.equal(f.state.writes, 1); assert.equal(f.state.anchorWrites, fault.startsWith("anchor") ? 1 : 0);
    assert.equal(f.coordinator.status().promotions, 0);
  }
});

test("revocation after commit may witness old pair under settlement only, never promote new readiness", async () => {
  for (const settlement of [true, false]) {
    const f = await started(); f.hooks.after = name => {
      if (name === "commit") { f.state.forward = false; f.state.settlement = settlement; }
    };
    await assert.rejects(append(f), CandidateV3CoordinatorError); closed(f);
    assert.equal(f.state.writes, 1); assert.equal(f.state.anchorWrites, settlement ? 1 : 0);
    assert.equal(f.coordinator.status().promotions, 0);
  }
});

test("busy loser rejects without queue or poisoning winner; same ports cannot construct a second owner", async () => {
  const f = await started(), gate = deferredGate();
  f.hooks.before = name => name === "validate" ? gate.hold() : undefined;
  const winner = append(f); await gate.waiting;
  await assert.rejects(append(f), CandidateV3CoordinatorError);
  assert.throws(() => createCandidateV3Coordinator(coordinatorBinding, f.ports, f.clock), CandidateV3CoordinatorError);
  assert.equal(f.coordinator.status().phase, "appending"); assert.equal(f.state.invalidations, 0);
  gate.release(); await winner; assert.equal(f.state.writes, 1); assert.equal(f.state.anchorWrites, 1);
  assert.equal(f.coordinator.status().requestNumber, 1);
});

test("abort every before/after await seam closes with no additional contacts, including late success", async t => {
  const reference = await started(); await append(reference); const names = [...reference.trace];
  for (let cut = 0; cut < names.length; cut++) {
    const f = await started(), controller = new AbortController(); let n = 0;
    const hook = () => { if (n++ === cut) controller.abort(); };
    f.hooks.before = hook; f.hooks.after = hook;
    await assert.rejects(f.coordinator.append(first.input, wire(first.checkpoint), controller.signal), CandidateV3CoordinatorError);
    await nextTurn(); closed(f); assert.equal(f.trace.length, cut + 1, names[cut]);
    assert.equal(f.coordinator.status().promotions, 0); assert.equal(f.coordinator.status().pendingPorts, 0);
    assert.equal(f.coordinator.status().commitAttempts, f.trace.filter(x => x === "before:commit").length);
    assert.equal(f.coordinator.status().anchorAttempts, f.trace.filter(x => x === "before:append-anchor").length);
  }
  t.diagnostic(`${names.length} before/after append seam abort cuts`);
});

test("absolute deadline at every settled seam denies further work, including final promotion", async t => {
  const reference = await started(); await append(reference);
  const count = reference.trace.filter(x => x.startsWith("after:")).length;
  for (let cut = 0; cut < count; cut++) {
    const f = await started(); let n = 0;
    f.hooks.after = () => { if (n++ === cut) f.state.now = 10_000; };
    await assert.rejects(append(f), CandidateV3CoordinatorError); closed(f);
    assert.equal(n, cut + 1); assert.equal(f.coordinator.status().promotions, 0);
  }
  t.diagnostic(`${count} settled append seam deadline cuts; one overall budget, not reset per port`);
});

test("pending work stays counted after abort/close; late response cannot promote or reuse the ports", async () => {
  for (const port of ["validate", "commit", "append-anchor"] as const) for (const mode of ["abort", "close"] as const) {
    const f = await started(), gate = deferredGate(), controller = new AbortController();
    f.hooks.after = name => name === port ? gate.hold() : undefined;
    const p = f.coordinator.append(first.input, wire(first.checkpoint), controller.signal); await gate.waiting;
    if (mode === "abort") controller.abort(); else f.coordinator.close();
    await assert.rejects(p, CandidateV3CoordinatorError); closed(f);
    assert.equal(f.coordinator.status().pendingPorts, 1); const contacts = f.trace.length;
    gate.release(); await nextTurn(); assert.equal(f.coordinator.status().pendingPorts, 0);
    assert.equal(f.trace.length, contacts); assert.equal(f.coordinator.status().promotions, 0);
    assert.equal(f.state.writes, port === "validate" ? 0 : 1); assert.equal(f.state.anchorWrites, port === "append-anchor" ? 1 : 0);
  }
});

test("real timer expires while a port is unresolved rather than waiting for its reply", async () => {
  const f = coordinatorFixture(undefined, { bootstrapMs: 30_000, appendMs: 500 });
  await f.coordinator.bootstrap(signal()); const gate = deferredGate();
  f.hooks.before = name => name === "validate" ? gate.hold() : undefined;
  const p = append(f); await Promise.race([gate.waiting, p.then(() => assert.fail("must remain pending"))]);
  await assert.rejects(p, CandidateV3CoordinatorError); closed(f);
  assert.equal(f.coordinator.status().pendingPorts, 1); assert.equal(f.state.writes, 0);
  gate.release(); await nextTurn(); assert.equal(f.coordinator.status().pendingPorts, 0);
});

test("pre-aborted bootstrap and invalid clocks close permanently without port contact", async () => {
  for (const time of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER]) {
    const f = coordinatorFixture(); f.state.now = time;
    await assert.rejects(f.coordinator.bootstrap(signal()), CandidateV3CoordinatorError); closed(f); assert.equal(f.trace.length, 0);
  }
  const f = coordinatorFixture(), c = new AbortController(); c.abort();
  await assert.rejects(f.coordinator.bootstrap(c.signal), CandidateV3CoordinatorError); closed(f); assert.equal(f.trace.length, 0);
});

test("bootstrap cancellation at every await seam cannot publish a confirmed snapshot or retry", async t => {
  const baseline = coordinatorFixture(); await baseline.coordinator.bootstrap(signal());
  for (let cut = 0; cut < baseline.trace.length; cut++) {
    const f = coordinatorFixture(), c = new AbortController(); let n = 0;
    const hook = () => { if (n++ === cut) c.abort(); }; f.hooks.before = hook; f.hooks.after = hook;
    await assert.rejects(f.coordinator.bootstrap(c.signal), CandidateV3CoordinatorError); await nextTurn(); closed(f);
    assert.equal(f.trace.length, cut + 1); assert.equal(f.coordinator.status().confirmedIdentity, null);
    assert.equal(f.coordinator.status().bootstrapAttempts, 1); assert.equal(f.state.writes, 0);
  }
  t.diagnostic(`${baseline.trace.length} before/after bootstrap seam abort cuts`);
});

test("regressing clock and lost epoch after worker validation close before commit", async () => {
  for (const fault of ["clock", "epoch", "authority"] as const) {
    const f = await started(); f.state.now = 10;
    f.hooks.after = name => {
      if (name === "validate") {
        if (fault === "clock") f.state.now = 9;
        if (fault === "epoch") f.state.epoch = uuid(999);
        if (fault === "authority") f.state.forward = false;
      }
    };
    await assert.rejects(append(f), CandidateV3CoordinatorError); closed(f);
    assert.equal(f.coordinator.status().commitAttempts, 0); assert.equal(f.state.writes, 0);
  }
});

test("an uncooperative late commit can still change storage, but never reopens the closed coordinator", async () => {
  const f = await started(), gate = deferredGate(), c = new AbortController();
  // Intentionally violate cancellation cooperation to model already-queued work.
  // No real effect occurs: only this fixture's in-memory string changes.
  f.ports.commit = async (_pre, candidate, ctx, _signal) => {
    await gate.hold(); f.state.ledger = candidate; f.state.writes++;
    return wire({ domain: "agent-candidate-v3-local-commit-ack/v1", contextDigest: hash(JSON.parse(ctx)),
      post: parseCandidateV3LocalSnapshot(candidate).identity });
  };
  const p = f.coordinator.append(first.input, wire(first.checkpoint), c.signal); await gate.waiting;
  c.abort(); await assert.rejects(p, CandidateV3CoordinatorError); closed(f);
  assert.equal(f.state.writes, 0); assert.equal(f.coordinator.status().pendingPorts, 1);
  gate.release(); await nextTurn(); assert.equal(f.state.writes, 1);
  assert.equal(f.coordinator.status().pendingPorts, 0); assert.equal(f.state.anchorWrites, 0);
  assert.equal(f.coordinator.status().promotions, 0); assert.equal(f.coordinator.status().phase, "closed");
});
