import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson as wire, canonicalSha256Digest as hash } from "../../src/compatibility/canonical-json.js";
import { CandidateV3DataError } from "../../src/build-only/windows-candidate-v3-data.js";
import { createCandidateV3IncrementalClaims } from "../../src/build-only/windows-candidate-v3-incremental.js";
import { parseCandidateV3CheckpointHistory } from "../../src/build-only/windows-candidate-v3-inventory.js";
import { families, make, transcript, pins, envelope, historyWire, genesis,
  type Frame, type ClaimFixture } from "../helpers/candidate-v3-history-fixture.js";
import { time, rebind } from "../helpers/candidate-v3-record-fixture.js";

const boot = (f?: Frame) => createCandidateV3IncrementalClaims(pins, f?.input ?? envelope([]), historyWire(f?.history ?? [genesis]));
const ref = (f: Frame) => parseCandidateV3CheckpointHistory(f.input, pins, historyWire(f.history));
const denied = (fn: () => unknown) => assert.throws(fn, e => e instanceof CandidateV3DataError);
const complete = (f: ClaimFixture, n: number) => Array(f.record.events.length + 1).fill(n) as number[];

function compare(view: ReturnType<ReturnType<typeof boot>["snapshot"]>, expected: ReturnType<typeof ref>) {
  assert.deepEqual(view.head, expected.head);
  assert.equal(view.inventoryRootDigest, expected.inventory.inventoryRootDigest);
  assert.equal(view.operationCount, expected.inventory.rows.length);
  assert.equal(view.lastAt, expected.lastAt);
  assert.deepEqual(view.outcomeCheckpointByOperation, expected.outcomeCheckpointByOperation);
  assert.ok(Object.isFrozen(view));
}

function* weave(left: number, right: number, prefix: number[] = []): Generator<number[]> {
  if (!left && !right) { yield prefix; return; }
  if (left) yield* weave(left - 1, right, [...prefix, 0]);
  if (right) yield* weave(left, right - 1, [...prefix, 1]);
}
function choose(n: number, k: number) {
  let result = 1;
  for (let i = 1; i <= k; i++) result = result * (n - k + i) / i;
  return Math.round(result);
}

// All complete two-subject interleavings for the fixed eight family shapes.
// Publications have distinct already-released parents in a serialized prelude;
// parent progression is not part of the pairwise permutation claim. One A mode
// (release) and equal timestamps here; other timing/context modes have own tests.
for (let left = 0; left < families.length; left++) for (let right = left; right < families.length; right++) {
  test(`v3 pairwise complete schedules ${left}/${right}`, t => {
    const parents: ClaimFixture[] = [];
    const leftParent = left >= 5 ? make(0, 0) : undefined;
    const rightParent = right >= 5 ? make(0, 1) : undefined;
    if (leftParent) parents.push(leftParent);
    if (rightParent) parents.push(rightParent);
    const a = make(left, 3, leftParent), b = make(right, 4, rightParent), offset = parents.length;
    const fixtures = [...parents, a, b], prelude = parents.flatMap(complete);
    const expectedCases = choose(a.record.events.length + b.record.events.length + 2, a.record.events.length + 1);
    const seen = new Set<string>(); let prefixes = 0, resumedAppends = 0;
    for (const order of weave(a.record.events.length + 1, b.record.events.length + 1)) {
      const key = order.join(""); assert.equal(seen.has(key), false); seen.add(key);
      const frames = transcript(fixtures, [...prelude, ...order.map(n => n + offset)]);
      const fresh = boot(), refs = frames.map(ref);
      for (let n = 0; n < frames.length; n++) compare(fresh.append(frames[n]!.input, wire(frames[n]!.checkpoint)), refs[n]!);
      // A rotating nonempty cut on each schedule, not every cut of every pair.
      // The separate bounded three-row matrix still checks all of its cuts.
      const cut = (seen.size - 1) % frames.length, resumed = boot(frames[cut]);
      compare(resumed.snapshot(), refs[cut]!);
      for (let n = cut + 1; n < frames.length; n++) {
        compare(resumed.append(frames[n]!.input, wire(frames[n]!.checkpoint)), refs[n]!); resumedAppends++;
      }
      assert.deepEqual(resumed.snapshot(), fresh.snapshot()); prefixes += frames.length;
    }
    assert.equal(seen.size, expectedCases);
    t.diagnostic(JSON.stringify({ pair: [left, right], cases: seen.size, prefixes, resumedAppends, serializedParents: parents.length }));
  });
}

function refresh(f: ClaimFixture) {
  f.record.intentDigest = hash(f.record.intent);
  f.core.intentDigest = f.record.intentDigest; f.core.workspaceDigest = f.record.intent.workspaceDigest;
  f.core.observedAt = f.record.events[f.outcomeIndex]!.recordedAt;
  f.core.priorOutcomeRecordDigest = hash({ ...f.record, events: f.record.events.slice(0, f.outcomeIndex) });
  rebind(f);
}
function everyCut(frames: Frame[]) {
  const refs = frames.map(ref);
  for (let cut = -1; cut < frames.length; cut++) {
    const model = boot(cut < 0 ? undefined : frames[cut]);
    for (let n = cut + 1; n < frames.length; n++) compare(model.append(frames[n]!.input, wire(frames[n]!.checkpoint)), refs[n]!);
  }
}
function denyAfter(before: Frame, bad: Frame, good: Frame) {
  ref(before); ref(good); denied(() => ref(bad));
  const model = boot(before); denied(() => model.append(bad.input, wire(bad.checkpoint)));
  denied(() => model.snapshot()); denied(() => model.append(good.input, wire(good.checkpoint)));
}

test("v3 pairwise workspace reuse requires the previous execute release", () => {
  const a = make(0, 0), b = make(0, 1);
  b.record.intent.workspaceDigest = a.record.intent.workspaceDigest; refresh(b);
  const good = transcript([a, b], [...complete(a, 0), ...complete(b, 1)]);
  everyCut(good);
  const releaseIndex = a.record.events.length;
  const bad = transcript([a, b], [...complete(a, 0).slice(0, -1), 1]).at(-1)!;
  denyAfter(good[releaseIndex - 1]!, bad, good[releaseIndex]!);
});

test("v3 pairwise increasing global timestamps survive all nonempty bootstrap cuts", () => {
  const fs = [make(0, 0), make(1, 1)];
  const order = Array.from({ length: 6 }, () => [0, 1]).flat(), indexes = [-1, -1];
  order.forEach((n, position) => {
    const index = ++indexes[n]!;
    if (!index) fs[n]!.record.reservedAt = time(position + 1);
    else fs[n]!.record.events[index - 1]!.recordedAt = time(position + 1);
  });
  fs.forEach(refresh);
  const frames = transcript(fs, order, "outcome");
  for (let n = 0; n < frames.length; n++) assert.equal(ref(frames[n]!).lastAt, time(n + 1));
  everyCut(frames);
});

test("v3 pairwise a second publication cannot reuse a released parent workflow", () => {
  const p = make(0, 0), first = make(5, 1, p), second = make(5, 2, p), unrelated = make(0, 3);
  const prefix = [...complete(p, 0), ...complete(first, 1)];
  const good = transcript([p, first, unrelated], [...prefix, 2]);
  const bad = transcript([p, first, second], [...prefix, 2]).at(-1)!;
  assert.notEqual(first.record.intent.approvalId, second.record.intent.approvalId);
  assert.equal(first.record.intent.workflowId, second.record.intent.workflowId);
  denyAfter(good.at(-2)!, bad, good.at(-1)!);
});
