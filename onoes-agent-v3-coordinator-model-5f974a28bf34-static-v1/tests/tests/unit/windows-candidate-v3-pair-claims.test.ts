import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalJson as wire } from "../../src/compatibility/canonical-json.js";
import { CandidateV3DataError } from "../../src/build-only/windows-candidate-v3-data.js";
import { parseCandidateV3CheckpointHistory } from "../../src/build-only/windows-candidate-v3-inventory.js";
import { inspectSyntheticPairClaims as inspect, requireEqualSyntheticPair as ready } from "../helpers/candidate-v3-pair-claims.js";
import { make, transcript, pins, envelope, historyWire, genesis } from "../helpers/candidate-v3-history-fixture.js";
const denied = (fn: () => unknown) => assert.throws(fn, e => e instanceof CandidateV3DataError);
const bytesDigest = (s: string) => "sha256:" + createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const frames = () => { const f = make(0, 0); return transcript([f], Array(f.record.events.length + 1).fill(0) as number[]); };

test("C13 claim groundwork: equal full histories and exactly one local tail for all eight families", t => {
  let prefixes = 0;
  for (let family = 0; family < 8; family++) {
    const parent = family >= 5 ? make(0, 0) : undefined, f = make(family, 1, parent);
    const fs = parent ? [parent, f] : [f];
    const order = fs.flatMap((row, index) => Array(row.record.events.length + 1).fill(index) as number[]);
    for (const frame of transcript(fs, order)) {
      const local = historyWire(frame.history), previous = historyWire(frame.history.slice(0, -1));
      const equal = ready(pins, frame.input, local, local);
      assert.equal(equal.relation, "equal-claims"); assert.equal(equal.localCheckpointCount, frame.history.length);
      const ahead = inspect(pins, frame.input, local, previous);
      assert.equal(ahead.relation, "one-ahead-claims"); assert.equal(ahead.claimedAnchorCheckpointCount, frame.history.length - 1);
      assert.deepEqual(ahead.identity, equal.identity); denied(() => ready(pins, frame.input, local, previous)); prefixes++;
    }
  }
  t.diagnostic(JSON.stringify({ syntheticPrefixes: prefixes, physicalC13: "NOT RUN", effectPorts: "none" }));
});

test("C13 claim groundwork: genesis is required and never a one-ahead permission", () => {
  const empty = envelope([]), g = historyWire([genesis]);
  assert.equal(ready(pins, empty, g, g).relation, "equal-claims");
  denied(() => inspect(pins, empty, g, historyWire([])));
  denied(() => inspect(pins, empty, historyWire([]), g));
});

test("C13 claim groundwork: shorter local and two-ahead local close", () => {
  const f = frames(), first = f[0]!, later = f[2]!;
  denied(() => inspect(pins, first.input, historyWire(first.history), historyWire(later.history)));
  denied(() => inspect(pins, later.input, historyWire(later.history), historyWire(first.history)));
});

test("C13 claim groundwork: independently valid but divergent anchor history closes", () => {
  const a = frames()[0]!, b = transcript([make(0, 9)], [0])[0]!;
  parseCandidateV3CheckpointHistory(b.input, pins, historyWire(b.history));
  assert.equal(a.history.length, b.history.length);
  denied(() => inspect(pins, a.input, historyWire(a.history), historyWire(b.history)));
});

test("C13 claim groundwork: matching head cannot conceal a changed earlier anchor checkpoint", () => {
  const f = frames().at(-1)!, changed = structuredClone(f.history);
  changed[1]!.recordDigest = "sha256:" + "f".repeat(64);
  assert.deepEqual(changed.at(-1), f.history.at(-1));
  denied(() => inspect(pins, f.input, historyWire(f.history), historyWire(changed)));
});

test("D2 claim groundwork: identity hashes exact canonical wires, including optional A context", () => {
  const f = make(0, 0), order = Array(f.record.events.length + 1).fill(0) as number[];
  const before = transcript([f], order, "release")[4]!, withA = transcript([f], order, "outcome")[4]!;
  const local = historyWire(before.history), a = ready(pins, before.input, local, local), b = ready(pins, withA.input, local, local);
  assert.deepEqual(a.identity, [bytesDigest(pins), bytesDigest(before.input), bytesDigest(local), before.checkpoint.checkpointDigest]);
  assert.equal(before.checkpoint.inventoryRootDigest, withA.checkpoint.inventoryRootDigest);
  assert.equal(a.identity[0], b.identity[0]); assert.equal(a.identity[2], b.identity[2]); assert.equal(a.identity[3], b.identity[3]);
  assert.notEqual(a.identity[1], b.identity[1]); assert(Object.isFrozen(a)); assert(Object.isFrozen(a.identity));
});

test("D2 claim groundwork: history identity includes the unconfirmed tail", () => {
  const f = frames(), first = f[0]!, second = f[1]!;
  const a = inspect(pins, first.input, historyWire(first.history), historyWire([genesis]));
  const b = inspect(pins, second.input, historyWire(second.history), historyWire(first.history));
  assert.notEqual(a.identity[2], b.identity[2]); assert.notEqual(a.identity[3], b.identity[3]);
});

test("C13 claim groundwork: noncanonical, malformed and active inputs deny without coercion", () => {
  const f = frames()[0]!, local = historyWire(f.history);
  for (const bad of [local + "\n", "{}", "", null]) denied(() => inspect(pins, f.input, local, bad));
  let called = false;
  const active = { toString() { called = true; throw Error("must not coerce"); } };
  denied(() => inspect(pins, f.input, local, active)); assert.equal(called, false);
  denied(() => inspect(pins, f.input + " ", local, local));
  denied(() => inspect(wire({ ...JSON.parse(pins), unexpected: true }), f.input, local, local));
});
