import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson as wire } from "../../src/compatibility/canonical-json.js";
import { CandidateV3DataError } from "../../src/build-only/windows-candidate-v3-data.js";
import { inspectSyntheticPairClaims } from "../helpers/candidate-v3-pair-claims.js";
import { make, transcript, historyWire, envelope, genesis, type Frame } from "../helpers/candidate-v3-history-fixture.js";
import { SyntheticReconciliationWorld as World, SyntheticRecoveryError } from "../helpers/candidate-v3-reconciliation-model.js";

const frames = (family = 0): Frame[] => {
  const parent = family >= 5 ? make(0, 0) : undefined, f = make(family, 1, parent), fs = parent ? [parent, f] : [f];
  return transcript(fs, fs.flatMap((r, n) => Array(r.record.events.length + 1).fill(n) as number[]));
};
const denied = (fn: () => unknown) => assert.throws(fn, e => e instanceof SyntheticRecoveryError || e instanceof CandidateV3DataError);
const fixture = () => { const world = new World(frames().at(-1)!); return { world, owner: world.open() }; };

test("maintenance model: every family/prefix witnesses only its exact existing tail and has no admission", t => {
  let prefixes = 0;
  for (let family = 0; family < 8; family++) for (const frame of frames(family)) {
    const w = new World(frame), h = w.open(), before = wire(w.local), offer = h.offer(100);
    assert.equal(h.prepare(offer).journal?.phase, "prepared"); h.markPossible();
    const ack = h.commitExactTail();
    assert.equal(ack.journal?.phase, "witnessed"); assert.equal(ack.authority, "none");
    assert.equal(ack.anchor, w.local.history); assert.equal(wire(w.local), before);
    assert.equal(inspectSyntheticPairClaims(w.local.metadata, w.local.inventory, w.local.history, ack.anchor).relation, "equal-claims");
    assert.equal(h.discover().kind, "synthetic-discovery-not-owner-admission");
    denied(() => h.commitExactTail()); denied(() => h.prepare(offer));
    assert.equal(w.anchorWrites, 1); assert.equal(w.possibleMarkers, 1); assert.equal(w.preparations, 1);
    prefixes++;
  }
  assert.equal(prefixes, 53);
  t.diagnostic("53 real-validator prefixes; synthetic JS state only; no physical recovery or effect API");
});

test("maintenance model: crash cuts preserve preparation, consumption and exact witnessed discovery", t => {
  const cuts = ["before-prepare", "prepare-response-loss", "marker-response-loss", "append-response-loss"] as const;
  let observed = 0;
  for (let family = 0; family < 8; family++) for (const frame of frames(family)) for (const cut of cuts) {
    const w = new World(frame), h = w.open(), consent = h.offer(100);
    if (cut !== "before-prepare") h.prepare(consent);
    if (cut === "marker-response-loss" || cut === "append-response-loss") h.markPossible();
    if (cut === "append-response-loss") h.commitExactTail(); // response deliberately not consumed
    const durableBeforeCrash = wire(w.snapshot()); h.crash();
    const reopened = w.open(), discovery = reopened.discover();
    assert.equal(wire(w.snapshot()), durableBeforeCrash, "discovery/reopen must not mutate history");
    assert.equal(discovery.authority, "none");
    if (cut === "before-prepare") assert.equal(discovery.journalPhase, null);
    else if (cut === "prepare-response-loss") assert.equal(discovery.journalPhase, "prepared");
    else if (cut === "append-response-loss") {
      assert.equal(discovery.disposition, "equal-claims-only"); assert.equal(discovery.journalPhase, "witnessed");
    } else assert.equal(discovery.disposition, "unknown-consumed-no-retry");
    denied(() => reopened.commitExactTail());
    if (cut !== "before-prepare") denied(() => reopened.prepare(consent));
    assert.equal(w.anchorWrites, cut === "append-response-loss" ? 1 : 0); observed++;
  }
  assert.equal(observed, 212);
  t.diagnostic("212 prefix x four distinct durable-model-state cuts; not actual crash/persistence/atomicity evidence");
});

test("maintenance model: two simultaneous lifetimes and append without durable marker deny", () => {
  const { world: w, owner: h } = fixture(); denied(() => w.open());
  denied(() => h.commitExactTail()); denied(() => h.markPossible());
  h.prepare(h.offer(100)); denied(() => h.commitExactTail());
  assert.equal(w.possibleMarkers, 0); assert.equal(w.anchorWrites, 0);
});

test("maintenance model: another epoch/expiration cannot reset the existing logical attempt", () => {
  const { world: w, owner: h } = fixture(); h.prepare(h.offer(100)); h.markPossible();
  const identity = w.snapshot().journal!.key;
  w.rotateAfterSimulatedRetirement("synthetic-owner-2"); const h2 = w.open();
  denied(() => h.commitExactTail()); denied(() => h2.prepare(h2.offer(200))); denied(() => h2.markPossible());
  denied(() => h2.commitExactTail()); assert.equal(w.snapshot().journal?.key, identity);
  assert.equal(h2.discover().disposition, "unknown-consumed-no-retry"); assert.equal(w.anchorWrites, 0);
});

test("maintenance model: unknown members, false consent, changed digest, owner, and noncanonical bytes deny before preparation", () => {
  const { world: w, owner: h } = fixture(), consent = h.offer(100), c = JSON.parse(consent) as Record<string, unknown>;
  for (const bad of [consent + "\n", "{}", "null", wire({ ...c, extra: true }), wire({ ...c, acknowledgeWitnessOnly: false }),
    wire({ ...c, epoch: "old" }), wire({ ...c, anchorDigest: "sha256:" + "0".repeat(64) }),
    wire({ ...c, identity: ["wrong"] }), wire({ ...c, expiresAt: 30_001 })]) denied(() => h.prepare(bad));
  let touched = false;
  denied(() => h.prepare(new Proxy({}, { get() { touched = true; throw Error("not inspected"); } })));
  assert.equal(touched, false); assert.equal(w.preparations, 0); assert.equal(w.anchorWrites, 0);
});

test("maintenance model: expiry at each forward stage denies with no renewed deadline", () => {
  for (const stage of ["prepare", "mark", "commit"] as const) {
    const { world: w, owner: h } = fixture(), consent = h.offer(100);
    if (stage !== "prepare") h.prepare(consent);
    if (stage === "commit") h.markPossible();
    w.now = 100;
    denied(() => stage === "prepare" ? h.prepare(consent) : stage === "mark" ? h.markPossible() : h.commitExactTail());
    assert.equal(w.anchorWrites, 0); assert.equal(w.possibleMarkers, stage === "commit" ? 1 : 0);
    if (stage === "commit") assert.equal(h.discover().disposition, "unknown-consumed-no-retry");
  }
});

test("maintenance model: logical clock regression closes the lifetime rather than reviving consumption", () => {
  const { world: w, owner: h } = fixture(); w.now = 10; h.prepare(h.offer(100)); h.markPossible();
  w.now = 9; denied(() => h.commitExactTail()); w.now = 11; denied(() => h.discover());
  const resumed = w.open(); assert.equal(resumed.discover().disposition, "unknown-consumed-no-retry");
  denied(() => resumed.markPossible()); assert.equal(w.anchorWrites, 0);
});

test("maintenance model: local drift after offer and after intent cannot witness another payload", () => {
  for (const prepared of [false, true]) {
    const { world: w, owner: h } = fixture(), consent = h.offer(100);
    if (prepared) h.prepare(consent);
    const other = frames(1).at(-1)!;
    w.local.inventory = other.input; w.local.history = historyWire(other.history);
    denied(() => prepared ? h.markPossible() : h.prepare(consent));
    assert.equal(w.anchorWrites, 0); assert.equal(w.possibleMarkers, 0);
  }
});

test("maintenance model: anchor drift after marker consumes handling but cannot produce an acknowledgment", () => {
  const { world: w, owner: h } = fixture(); h.prepare(h.offer(100)); h.markPossible();
  const previous = w.snapshot().anchor; w.corruptAnchorForTest(w.local.history);
  denied(() => h.commitExactTail()); assert.equal(w.snapshot().journal?.phase, "contact-possible");
  w.corruptAnchorForTest(previous); denied(() => h.commitExactTail()); assert.equal(w.anchorWrites, 0);
});

test("maintenance model: all forbidden stream relations deny through the real full-history validator", () => {
  const fs = frames(), frame = fs.at(-1)!, good = historyWire(frame.history.slice(0, -1));
  const changed = structuredClone(frame.history.slice(0, -1)); changed[1]!.recordDigest = "sha256:" + "f".repeat(64);
  for (const anchor of [historyWire([]), historyWire(frame.history.slice(0, -2)), historyWire(changed), good + " ", "{}"] ) {
    const w = new World(frame, anchor), h = w.open(); denied(() => h.offer(100)); denied(() => h.discover());
    assert.equal(w.anchorWrites, 0); assert.equal(w.preparations, 0);
  }
  const w = new World(fs[0]!, historyWire(frame.history)); denied(() => w.open().offer(100));
});

test("maintenance model: equality is discovery only; neither genesis nor equal pair offers a repair", () => {
  const frame = frames().at(-1)!, w = new World(frame, historyWire(frame.history)), h = w.open();
  assert.equal(h.discover().disposition, "equal-claims-only"); denied(() => h.offer(100));
  assert.equal(w.anchorWrites, 0); assert.equal(w.preparations, 0);
  const g = new World({ input: envelope([]), checkpoint: genesis, history: [genesis] }, historyWire([genesis])), gh = g.open();
  assert.equal(gh.discover().disposition, "equal-claims-only"); denied(() => gh.offer(100));
  assert.equal(g.preparations, 0); assert.equal(g.anchorWrites, 0);
});

test("maintenance model: preparation-only reply loss can continue the same unspent consent after discovery", () => {
  const { world: w, owner: h } = fixture(); h.prepare(h.offer(100)); h.crash();
  const reopened = w.open(); assert.equal(reopened.discover().journalPhase, "prepared");
  reopened.markPossible(); reopened.commitExactTail();
  assert.equal(w.preparations, 1); assert.equal(w.possibleMarkers, 1); assert.equal(w.anchorWrites, 1);
  assert.equal(reopened.discover().authority, "none");
});

test("maintenance model: reopening cannot reset the simulated authority clock or renew prepared consent", () => {
  const { world: w, owner: h } = fixture(); w.now = 50; h.prepare(h.offer(100)); h.crash();
  w.now = 49; const regressed = w.open(); denied(() => regressed.markPossible());
  w.now = 100; const expired = w.open(); denied(() => expired.markPossible());
  denied(() => expired.prepare(expired.offer(200))); assert.equal(w.possibleMarkers, 0); assert.equal(w.anchorWrites, 0);
});

test("maintenance model: forged or missing inventory fails even with a matching history prefix", () => {
  const { world: w, owner: h } = fixture(); w.local.inventory = "{}";
  denied(() => h.offer(100)); denied(() => h.discover());
  assert.equal(w.preparations, 0); assert.equal(w.possibleMarkers, 0); assert.equal(w.anchorWrites, 0);
  assert.equal(new SyntheticRecoveryError().message, "synthetic-reconciliation-denied");
});
