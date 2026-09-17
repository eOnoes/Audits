import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson as wire } from "../../src/compatibility/canonical-json.js";
import { createCandidateV3IncrementalClaims } from "../../src/build-only/windows-candidate-v3-incremental.js";
import { parseCandidateV3CheckpointHistory } from "../../src/build-only/windows-candidate-v3-inventory.js";
import { CandidateV3DataError } from "../../src/build-only/windows-candidate-v3-data.js";
import { families, make, transcript, schedules, pins, envelope, historyWire, genesis,
  type Frame, type Attachment } from "../helpers/candidate-v3-history-fixture.js";

const bootstrap = (frame?: Frame) => createCandidateV3IncrementalClaims(pins, frame?.input ?? envelope([]), historyWire(frame?.history ?? [genesis]));
const reference = (frame: Frame) => parseCandidateV3CheckpointHistory(frame.input, pins, historyWire(frame.history));
function check(view: ReturnType<ReturnType<typeof bootstrap>["snapshot"]>, expected: ReturnType<typeof reference>) {
  assert.equal(view.kind, "validated-v3-incremental-claim-not-admission");
  assert.deepEqual(view.head, expected.head);
  assert.equal(view.inventoryRootDigest, expected.inventory.inventoryRootDigest);
  assert.equal(view.operationCount, expected.inventory.rows.length);
  assert.equal(view.lastAt, expected.lastAt);
  assert.deepEqual(view.outcomeCheckpointByOperation, expected.outcomeCheckpointByOperation);
  assert.ok(Object.isFrozen(view)); assert.ok(Object.isFrozen(view.head)); assert.ok(Object.isFrozen(view.outcomeCheckpointByOperation));
}
function exercise(frames: Frame[]) {
  const refs = frames.map(reference), fresh = bootstrap(); let continued = 0;
  for (let n = 0; n < frames.length; n++) check(fresh.append(frames[n]!.input, wire(frames[n]!.checkpoint)), refs[n]!);
  for (let cut = 0; cut < frames.length; cut++) {
    const resumed = bootstrap(frames[cut]); check(resumed.snapshot(), refs[cut]!);
    for (let n = cut + 1; n < frames.length; n++) {
      check(resumed.append(frames[n]!.input, wire(frames[n]!.checkpoint)), refs[n]!); continued++;
    }
    assert.deepEqual(resumed.snapshot(), fresh.snapshot());
  }
  return continued;
}

for (let family = 0; family < families.length; family++) {
  test(`v3 incremental exhaustive bounded three-row schedules: family ${family} ${families[family]!.join("/")}`, t => {
    let cases = 0, prefixes = 0, continued = 0;
    const parent = family >= 5 ? make(0, 0) : undefined;
    const full = make(family, 1, parent);
    for (let cut = 0; cut <= full.record.events.length; cut++) for (const quarantine of [false, true]) {
      if (quarantine && cut === full.record.events.length) continue;
      const subject = make(family, 1, parent, cut, quarantine);
      // Exhaust every legal interleaving of these bounded paths. Other execution
      // rows are reservation-only; publication includes its completed parent.
      // This is NOT all permutations of three arbitrary fully executing rows.
      const fs = parent ? [parent, subject, make(2, 2, undefined, 0)]
        : [subject, make(2, 2, undefined, 0), make(2, 3, undefined, 0)];
      for (const order of schedules(fs)) for (const mode of ["outcome", "release", "later-unrelated"] as Attachment[]) {
        const frames = transcript(fs, order, mode); continued += exercise(frames); prefixes += frames.length; cases++;
      }
    }
    assert.ok(cases > 0);
    t.diagnostic(JSON.stringify({ family, schedulesAndContextModes: cases, prefixes, continued }));
  });
}

test("v3 incremental also compares multiple fully progressing rows and nonempty A bootstrap", t => {
  let cases = 0, prefixes = 0, continued = 0;
  for (let family = 0; family < 5; family++) for (const mode of ["outcome", "release", "later-unrelated"] as Attachment[]) {
    const fs = [make(family, 1), make((family + 1) % 5, 2), make((family + 2) % 5, 3)];
    const max = Math.max(...fs.map(f => f.record.events.length));
    const roundRobin = Array.from({ length: max + 1 }, (_, index) => fs.flatMap((f, n) => index <= f.record.events.length ? [n] : [])).flat();
    for (const order of [roundRobin, fs.flatMap((f, n) => Array(f.record.events.length + 1).fill(n) as number[])]) {
      const frames = transcript(fs, order, mode); continued += exercise(frames); prefixes += frames.length; cases++;
    }
  }
  t.diagnostic(JSON.stringify({ deterministicFullRowCases: cases, prefixes, continued }));
});

test("v3 incremental claims remain forgeable data, cannot import state objects and explicitly invalidate", () => {
  const frame = transcript([make(2, 1)], [0, 0, 0]).at(-1)!;
  const model = bootstrap(frame);
  assert.ok(Object.isFrozen(model)); assert.equal("commit" in model, false); assert.equal("available" in model.snapshot(), false);
  assert.throws(() => createCandidateV3IncrementalClaims(pins, model.snapshot(), historyWire(frame.history)), CandidateV3DataError);
  model.invalidate(); model.invalidate();
  assert.throws(() => model.snapshot(), CandidateV3DataError);
  assert.throws(() => model.append(frame.input, wire(frame.checkpoint)), CandidateV3DataError);
  // A new instance can validate coherent caller claims. That is why this module
  // is neither durable poison nor protection against a malicious host/rollback.
  assert.equal(bootstrap(frame).snapshot().head.checkpointDigest, frame.checkpoint.checkpointDigest);
});
