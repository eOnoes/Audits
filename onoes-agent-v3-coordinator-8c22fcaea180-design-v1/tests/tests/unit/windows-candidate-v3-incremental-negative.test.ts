import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson as wire, canonicalSha256Digest as hash } from "../../src/compatibility/canonical-json.js";
import { CandidateV3DataError } from "../../src/build-only/windows-candidate-v3-data.js";
import { createCandidateV3IncrementalClaims } from "../../src/build-only/windows-candidate-v3-incremental.js";
import { parseCandidateV3CheckpointHistory, parseCandidateV3CheckpointSnapshot } from "../../src/build-only/windows-candidate-v3-inventory.js";
import { make, transcript, pins, envelope, historyWire, genesis, checkpoint, recordsOf,
  type Frame, type TransportRow, type ClaimRecord } from "../helpers/candidate-v3-history-fixture.js";
import { digest, uuid, time, rehashCheckpoint, metadata, event } from "../helpers/candidate-v3-record-fixture.js";

const denied = (fn: () => unknown) => assert.throws(fn, e => e instanceof CandidateV3DataError);
const boot = (frame?: Frame) => createCandidateV3IncrementalClaims(pins, frame?.input ?? envelope([]), historyWire(frame?.history ?? [genesis]));
const ref = (frame: Frame) => parseCandidateV3CheckpointHistory(frame.input, pins, historyWire(frame.history));
const read = (row: TransportRow): ClaimRecord => JSON.parse(row.recordWire) as ClaimRecord;
function edited(frame: Frame, change: (rows: TransportRow[]) => void, subject = frame.checkpoint.operationId): Frame {
  const rows = recordsOf(frame.input); change(rows);
  const cp = checkpoint(rows.map(read), subject, frame.history.at(-2)!);
  return { input: envelope(rows), checkpoint: cp, history: [...frame.history.slice(0, -1), cp] };
}
function assertDenial(before: Frame | undefined, good: Frame, bad: Frame, snapshotAccepts = false, referenceAccepts = false) {
  ref(good);
  if (snapshotAccepts) parseCandidateV3CheckpointSnapshot(bad.input, pins, wire(bad.checkpoint));
  if (referenceAccepts) ref(bad); else denied(() => ref(bad));
  const model = boot(before); denied(() => model.append(bad.input, wire(bad.checkpoint)));
  denied(() => model.snapshot()); denied(() => model.append(good.input, wire(good.checkpoint)));
  // The valid successor is still independently reference-valid after latch.
  ref(good);
}
const basic = () => transcript([make(0, 0), make(2, 1)], [0, 1, 0, 0, 0, 0, 0, 1, 1]);

test("v3 incremental exact-prefix guard rejects snapshot-valid subject history rewrites", () => {
  const fs = basic(), before = fs[2]!, good = fs[3]!;
  for (const field of ["evidenceDigest", "authorizationDigest", "candidateDigest", "reviewMaterialDigest", "guestImageDigest", "reservedAt"]) {
    const bad = edited(good, rows => {
      const r = read(rows[0]!);
      if (field === "evidenceDigest") r.events[0]!.evidenceDigest = digest(9999);
      else if (field === "reservedAt") r.reservedAt = time(-1);
      else {
        // Each field is independent of the current event's grammar. Rehashing
        // intent and the complete snapshot must not rewrite the retained past.
        const key = field as "authorizationDigest" | "candidateDigest" | "reviewMaterialDigest" | "guestImageDigest";
        r.intent[key] = digest(9999); r.intentDigest = hash(r.intent);
      }
      rows[0]!.recordWire = wire(r);
    });
    const oldRows = recordsOf(before.input), newRows = recordsOf(bad.input);
    assert.equal(read(newRows[0]!).events.length, read(oldRows[0]!).events.length + 1);
    assert.equal(newRows[1]!.recordWire, oldRows[1]!.recordWire);
    assert.equal(bad.checkpoint.sequence, before.checkpoint.sequence + 1);
    assert.equal(bad.checkpoint.previousCheckpointDigest, before.checkpoint.checkpointDigest);
    assertDenial(before, good, bad, true);
  }
});

test("v3 incremental rejects a self-consistent wrong A arriving with its outcome", () => {
  const fs = basic(), good = fs[5]!;
  assert.equal(read(recordsOf(good.input)[0]!).events.at(-1)!.state, "completed");
  assert.equal(recordsOf(good.input)[0]!.checkpointAWire, null);
  const bad = edited(good, rows => {
    const wrongA = structuredClone(good.checkpoint);
    wrongA.previousCheckpointDigest = digest(9999); rehashCheckpoint(wrongA);
    rows[0]!.checkpointAWire = wire(wrongA);
  });
  assertDenial(fs[4], good, bad, true);
});

test("v3 incremental sequence gap duplicate and previous-head faults permanently latch", () => {
  const fs = basic(), good = fs[2]!;
  for (const kind of ["gap", "duplicate", "previous"]) {
    const bad = structuredClone(good);
    if (kind === "previous") bad.checkpoint.previousCheckpointDigest = digest(9999);
    else bad.checkpoint.sequence += kind === "gap" ? 1 : -1;
    rehashCheckpoint(bad.checkpoint); bad.history[bad.history.length - 1] = bad.checkpoint;
    assertDenial(fs[1], good, bad, kind === "previous");
  }
});

test("v3 incremental rejects row deletion replacement two-row change and changed-subject mismatch", () => {
  const fs = basic(), good = fs[2]!;
  const dropped = edited(good, rows => { rows.pop(); });
  assertDenial(fs[1], good, dropped); // also fails aggregate sequence continuity
  const replaced = edited(good, rows => {
    const other = read(rows[1]!); other.intent.operationId = uuid(900); other.intentDigest = hash(other.intent);
    rows[1]!.recordWire = wire(other);
  });
  assertDenial(fs[1], good, replaced, true);
  const twoChanged = edited(good, rows => {
    const other = read(rows[1]!); other.intent.authorizationDigest = digest(999); other.intentDigest = hash(other.intent);
    rows[1]!.recordWire = wire(other);
  });
  assertDenial(fs[1], good, twoChanged, true);
  const wrongSubject = edited(good, () => {}, make(2, 1).record.intent.operationId);
  assertDenial(fs[1], good, wrongSubject, true);
});

test("v3 incremental rejects zero-change two-event new-with-event and inserted-event updates", () => {
  const fs = basic(), before = fs[1]!, good = fs[2]!;
  const zero = edited(before, () => {});
  zero.checkpoint.previousCheckpointDigest = before.checkpoint.checkpointDigest; rehashCheckpoint(zero.checkpoint);
  zero.history = [...before.history, zero.checkpoint];
  assertDenial(before, good, zero);
  const two = structuredClone(fs[3]!); two.checkpoint.previousCheckpointDigest = before.checkpoint.checkpointDigest;
  rehashCheckpoint(two.checkpoint); two.history = [...before.history, two.checkpoint];
  assertDenial(before, good, two, true); // aggregate sequence catches skip before one-event guard
  const solo = transcript([make(0, 0)], [0, 0]);
  const newWithEvent = structuredClone(solo[1]!); newWithEvent.checkpoint.previousCheckpointDigest = genesis.checkpointDigest;
  rehashCheckpoint(newWithEvent.checkpoint); newWithEvent.history = [genesis, newWithEvent.checkpoint];
  assertDenial(undefined, solo[0]!, newWithEvent, true);
  const inserted = edited(fs[3]!, rows => {
    const r = read(rows[0]!); r.events.splice(1, 0, event("source-delivery-possible", 0)); rows[0]!.recordWire = wire(r);
  });
  assertDenial(fs[2], fs[3]!, inserted); // row grammar independently rejects illegal insertion
});

test("v3 incremental cannot introduce conflicting workspace reservations at any blocking state", () => {
  for (const cut of [0, 1, 4]) for (const quarantine of [false, true]) {
    const a = make(0, 0, undefined, cut, quarantine), b = make(2, 1, undefined, 0);
    const fs = transcript([a, b], [...Array(a.record.events.length + 1).fill(0) as number[], 1]);
    const before = fs.at(-2)!, good = fs.at(-1)!;
    const bad = edited(good, rows => {
      const r = read(rows[1]!); r.intent.workspaceDigest = a.record.intent.workspaceDigest; r.intentDigest = hash(r.intent);
      rows[1]!.recordWire = wire(r);
    });
    // Post-inventory exclusion shadows the old-state guard for these same-state
    // inputs. A release-only-in-post multi-change attack is tested separately.
    assertDenial(before, good, bad);
  }
});

test("v3 incremental cannot make publication parent available by skipping its release", () => {
  const p = make(0, 0), pub = make(5, 1, p);
  const fs = transcript([p, pub], [0, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
  for (const cut of [-1, 2, 4]) {
    const before = cut < 0 ? undefined : fs[cut], good = fs[cut + 1]!;
    const skipped = structuredClone(fs[6]!);
    skipped.checkpoint.previousCheckpointDigest = before?.checkpoint.checkpointDigest ?? genesis.checkpointDigest;
    rehashCheckpoint(skipped.checkpoint); skipped.history = [...(before?.history ?? [genesis]), skipped.checkpoint];
    // Final inventory passes, but adding/releasing parent and reserving child
    // in one step violates sequence/one-change, before old-parent defense.
    assertDenial(before, good, skipped, true);
  }
  const historical = transcript([p, pub], [1, 0, 0, 0, 0, 0, 0, 1, 1, 1]).at(-1)!;
  parseCandidateV3CheckpointSnapshot(historical.input, pins, wire(historical.checkpoint));
  denied(() => ref(historical)); // absent-parent at first reservation, no prior workspace
  denied(() => boot(historical));
});

test("v3 incremental lastAt regression rejects new and existing rows", () => {
  const a = make(0, 0, undefined, 0), b = make(0, 1);
  a.record.reservedAt = time(1);
  b.record.reservedAt = time(1); b.record.events.forEach(e => { e.recordedAt = time(1); });
  // Only reservation and first delivery are used; no settlement reconstruction.
  const fs = transcript([a, b], [0, 1, 1]);
  const newRow = edited(fs[1]!, rows => { const r = read(rows[1]!); r.reservedAt = time(0); rows[1]!.recordWire = wire(r); });
  assertDenial(fs[0], fs[1]!, newRow); // snapshot latest-subject check also sees a
  const existing = edited(fs[2]!, rows => { const r = read(rows[1]!); r.events[0]!.recordedAt = time(0); rows[1]!.recordWire = wire(r); });
  assertDenial(fs[1], fs[2]!, existing); // per-row chronology shadows global lastAt
});

test("v3 incremental substitutes no late A and never forgets already supplied A", () => {
  const fs = [make(0, 0), make(2, 1)], order = [0, 1, 0, 0, 0, 0, 1, 0, 1];
  const delayed = transcript(fs, order, "release"), good = delayed[6]!;
  const late = edited(good, rows => {
    const a = structuredClone(delayed[5]!.checkpoint); a.previousCheckpointDigest = digest(9999); rehashCheckpoint(a);
    rows[0]!.checkpointAWire = wire(a);
  });
  assertDenial(delayed[5], good, late, true);
  const immediate = transcript(fs, order, "outcome");
  const disappeared = edited(immediate[6]!, rows => { rows[0]!.checkpointAWire = null; });
  assertDenial(immediate[5], immediate[6]!, disappeared, true, true); // intentional stricter-than-reference rule
  const replacement = edited(immediate[6]!, rows => {
    const a = JSON.parse(rows[0]!.checkpointAWire!) as typeof genesis;
    a.previousCheckpointDigest = digest(9999); rehashCheckpoint(a); rows[0]!.checkpointAWire = wire(a);
  });
  assertDenial(immediate[5], immediate[6]!, replacement, true);
});

test("v3 incremental rejects released A replacement core rewrite absent core and duplicate outcome", () => {
  const fs = basic(), good = fs[7]!;
  const changedA = edited(good, rows => {
    const a = JSON.parse(rows[0]!.checkpointAWire!) as typeof genesis;
    a.previousCheckpointDigest = digest(999); rehashCheckpoint(a); rows[0]!.checkpointAWire = wire(a);
    const r = read(rows[0]!); r.events.at(-1)!.outcomeCheckpointDigest = a.checkpointDigest; rows[0]!.recordWire = wire(r);
  });
  assertDenial(fs[6], good, changedA, true);
  const interleaved = transcript([make(0, 0), make(2, 1)], [0, 1, 0, 0, 0, 0, 1, 0, 1]);
  const rewritten = edited(interleaved[6]!, rows => {
    const core = JSON.parse(rows[0]!.settlementWire!) as { contactAccountingDigest: string };
    core.contactAccountingDigest = digest(999); rows[0]!.settlementWire = wire(core);
    const r = read(rows[0]!); r.events.at(-1)!.evidenceDigest = hash(core); rows[0]!.recordWire = wire(r);
  });
  assertDenial(interleaved[5], interleaved[6]!, rewritten, true);
  const absentCore = edited(interleaved[6]!, rows => { rows[0]!.settlementWire = null; });
  assertDenial(interleaved[5], interleaved[6]!, absentCore);
  const duplicate = edited(fs[6]!, rows => { const r = read(rows[0]!); r.events.splice(4, 0, structuredClone(r.events[3]!)); rows[0]!.recordWire = wire(r); });
  assertDenial(fs[5], fs[6]!, duplicate);
  const invalidA = edited(fs[2]!, rows => { rows[0]!.checkpointAWire = wire(fs[5]!.checkpoint); });
  assertDenial(fs[1], fs[2]!, invalidA);
});

test("v3 incremental historical generation cannot be relabeled to a current coordinator epoch", () => {
  const fs = basic(), good = fs[2]!, bad = structuredClone(good);
  bad.checkpoint.producerGeneration = uuid(99998); rehashCheckpoint(bad.checkpoint); bad.history[bad.history.length - 1] = bad.checkpoint;
  assertDenial(fs[1], good, bad);
  // No envelope-authentication API exists; coherent historical G1 is accepted
  // regardless of a caller's alleged G2. Physical rotation is deliberately absent.
  assert.equal(boot(fs[1]).append(good.input, wire(good.checkpoint)).head.producerGeneration, make(0, 0).record.intent.ownerGeneration);
});

test("v3 incremental primitive boundaries never invoke caller getters proxies or coercion", () => {
  const good = transcript([make(0, 0)], [0])[0]!; let traps = 0;
  const exotic = { get value() { traps++; throw Error("get"); }, toString() { traps++; throw Error("coerce"); } };
  const proxy = new Proxy({}, { ownKeys() { traps++; throw Error("keys"); }, get() { traps++; throw Error("get"); } });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const bad of [exotic, proxy, revoked.proxy, null, 7, Buffer.from(good.input)]) {
    denied(() => createCandidateV3IncrementalClaims(bad, envelope([]), historyWire([genesis])));
    denied(() => createCandidateV3IncrementalClaims(pins, bad, historyWire([genesis])));
    denied(() => createCandidateV3IncrementalClaims(pins, envelope([]), bad));
    for (const position of [0, 1]) {
      const model = boot(); denied(() => model.append(position === 0 ? bad : good.input, position === 1 ? bad : wire(good.checkpoint)));
      denied(() => model.append(good.input, wire(good.checkpoint)));
    }
  }
  assert.equal(traps, 0);
  denied(() => createCandidateV3IncrementalClaims(wire({ ...metadata, storeId: uuid(888) }), envelope([]), historyWire([genesis])));
  for (const bad of [good.input + "\n", "\ufeff" + good.input, "{"]) {
    const model = boot(); denied(() => model.append(bad, wire(good.checkpoint))); denied(() => model.append(good.input, wire(good.checkpoint)));
  }
});
