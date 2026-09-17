import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson as wire, canonicalSha256Digest as hash } from "../../src/compatibility/canonical-json.js";
import { CandidateV3DataError, CANDIDATE_V3_INVENTORY_ROOT_DOMAIN, CANDIDATE_V3_INVENTORY_TRANSPORT_DOMAIN,
  CANDIDATE_V3_CHECKPOINT_HISTORY_DOMAIN } from "../../src/build-only/windows-candidate-v3-data.js";
import { parseCandidateV3Inventory, parseCandidateV3CheckpointSnapshot, parseCandidateV3ReleasePair,
  parseCandidateV3CheckpointHistory } from "../../src/build-only/windows-candidate-v3-inventory.js";
import { fixture, metadata, uuid, digest, time, rebind, rehashCheckpoint, event } from "../helpers/candidate-v3-record-fixture.js";

const pins = wire(metadata), denied = (f: () => unknown) => assert.throws(f, e => e instanceof CandidateV3DataError);
type F = ReturnType<typeof fixture>;
test("v3 centralized domains retain independently pinned historical wire literals", () => {
  assert.equal(CANDIDATE_V3_INVENTORY_ROOT_DOMAIN, "agent-candidate-inventory-root/v1");
  assert.equal(CANDIDATE_V3_INVENTORY_TRANSPORT_DOMAIN, "agent-candidate-inventory-transport/v1");
  assert.equal(CANDIDATE_V3_CHECKPOINT_HISTORY_DOMAIN, "agent-candidate-checkpoint-history/v1");
  // The root/envelope/history builders below deliberately keep literal domains,
  // so importing a changed production constant cannot silently update the oracle.
});
const item = (f: F, count = f.record.events.length) => ({ recordWire: wire({ ...f.record, events: f.record.events.slice(0, count) }),
  settlementWire: count > f.outcomeIndex ? wire(f.core) : null, checkpointAWire: count > f.outcomeIndex ? wire(f.checkpointA) : null });
const envelope = (records: ReturnType<typeof item>[]) => wire({ domain: "agent-candidate-inventory-transport/v1", records });
function reserved(n: number) {
  const f = fixture(); f.record.events = [];
  f.record.intent.operationId = uuid(n); f.record.intent.approvalId = uuid(n + 2000);
  f.record.intent.workflowId = uuid(n + 4000); f.record.intent.workspaceDigest = digest(n + 6000);
  f.record.intentDigest = hash(f.record.intent);
  f.record.approvalIdentityDigest = hash({ domain: "agent-candidate-effect-ledger/v1", namespaceId: metadata.namespaceId, approvalId: f.record.intent.approvalId });
  return f;
}
function root(records: F["record"][]) {
  return hash({ domain: "agent-candidate-inventory-root/v1", installationId: metadata.installationId,
    namespaceId: metadata.namespaceId, storeId: metadata.storeId, operationCount: records.length,
    entries: records.map(r => ({ operationId: r.intent.operationId, eventIndex: r.events.length, recordDigest: hash(r),
      approvalIdentityDigest: r.approvalIdentityDigest, state: r.events.at(-1)?.state ?? "reserved" })) });
}
function checkpoint(records: F["record"][], index = records.length - 1) {
  const cp = fixture().checkpointA, record = records[index];
  cp.sequence = records.reduce((n, r) => n + r.events.length + 1, 0); cp.operationCount = records.length;
  cp.operationId = record?.intent.operationId ?? null; cp.eventIndex = record?.events.length ?? null;
  cp.recordDigest = record ? hash(record) : null; cp.approvalIdentityDigest = record?.approvalIdentityDigest ?? null;
  cp.producerGeneration = record?.intent.ownerGeneration ?? uuid(7);
  cp.previousCheckpointDigest = record ? digest(500) : null; cp.inventoryRootDigest = root(records); rehashCheckpoint(cp); return cp;
}

test("v3 canonical complete inventory and checkpoint claims have no admission surface", () => {
  for (const records of [[], [reserved(100)], [reserved(100), reserved(101)]]) {
    const input = envelope(records.map(f => item(f, 0))), cp = checkpoint(records.map(f => f.record));
    const result = parseCandidateV3CheckpointSnapshot(input, pins, wire(cp));
    assert.equal(result.inventory.inventoryRootDigest, root(records.map(f => f.record)));
    assert.equal(result.kind, "matched-v3-checkpoint-claim-not-admission");
    assert.ok(Object.isFrozen(result.inventory.rows)); assert.equal("available" in result, false);
  }
});

test("v3 re-derives cross-row invariants independently from indexes and rehashed records", () => {
  for (const field of ["operationId", "approvalId", "workflowId", "workspaceDigest"] as const) {
    const a = reserved(100), b = reserved(101); b.record.intent[field] = a.record.intent[field];
    b.record.intentDigest = hash(b.record.intent);
    b.record.approvalIdentityDigest = hash({ domain: "agent-candidate-effect-ledger/v1", namespaceId: metadata.namespaceId, approvalId: b.record.intent.approvalId });
    denied(() => parseCandidateV3Inventory(envelope([item(a, 0), item(b, 0)]), pins));
  }
  denied(() => parseCandidateV3Inventory(envelope([item(reserved(101), 0), item(reserved(100), 0)]), pins));
});

test("v3 supplied snapshot omission, replacement, stale sequence and wrong checkpoint subject deny", () => {
  const a = reserved(100), b = reserved(101), input = envelope([item(a, 0), item(b, 0)]), cp = checkpoint([a.record, b.record]);
  denied(() => parseCandidateV3CheckpointSnapshot(envelope([item(a, 0)]), pins, wire(cp)));
  denied(() => parseCandidateV3CheckpointSnapshot(envelope([item(a, 0), item(reserved(102), 0)]), pins, wire(cp)));
  for (const key of ["sequence", "operationCount", "eventIndex", "operationId", "recordDigest", "approvalIdentityDigest", "producerGeneration", "inventoryRootDigest"] as const) {
    const changed = structuredClone(cp);
    if (key === "sequence" || key === "operationCount" || key === "eventIndex") changed[key] = 9;
    else changed[key] = key.endsWith("Digest") ? digest(999) : uuid(999);
    rehashCheckpoint(changed); denied(() => parseCandidateV3CheckpointSnapshot(input, pins, wire(changed)));
  }
  b.record.reservedAt = time(1);
  denied(() => parseCandidateV3CheckpointSnapshot(envelope([item(a, 0), item(b, 0)]), pins, wire(checkpoint([a.record, b.record], 0))));
});

test("v3 release A and B join exact complete before/after inventories with only one release append", () => {
  const f = fixture(), before = { ...f.record, events: f.record.events.slice(0, -1) };
  const a = f.checkpointA, b = checkpoint([f.record]); b.previousCheckpointDigest = a.checkpointDigest; rehashCheckpoint(b);
  const beforeWire = envelope([item(f, f.record.events.length - 1)]), afterWire = envelope([item(f)]);
  assert.equal(a.inventoryRootDigest, root([before]));
  assert.equal(parseCandidateV3ReleasePair(beforeWire, afterWire, pins, wire(a), wire(b)).kind, "matched-v3-release-pair-not-admission");
  const missingA = JSON.parse(beforeWire) as { domain: string; records: ReturnType<typeof item>[] };
  missingA.records[0]!.checkpointAWire = null;
  assert.ok(parseCandidateV3ReleasePair(wire(missingA), afterWire, pins, wire(a), wire(b)));
  denied(() => parseCandidateV3ReleasePair(afterWire, beforeWire, pins, wire(b), wire(a)));
  const wrong = structuredClone(b); wrong.previousCheckpointDigest = digest(999); rehashCheckpoint(wrong);
  denied(() => parseCandidateV3ReleasePair(beforeWire, afterWire, pins, wire(a), wire(wrong)));
  denied(() => parseCandidateV3ReleasePair(beforeWire, beforeWire, pins, wire(a), wire(a)));
  const added = reserved(100), addedB = checkpoint([f.record, added.record], 0);
  addedB.previousCheckpointDigest = a.checkpointDigest; rehashCheckpoint(addedB);
  denied(() => parseCandidateV3ReleasePair(beforeWire, envelope([item(f), item(added, 0)]), pins, wire(a), wire(addedB)));
});

test("v3 publication requires the released passed execution with separate approval and exact subject", () => {
  const parent = fixture(), pub = reserved(100);
  pub.record.intent = { ...parent.record.intent, kind: "publish", operationId: uuid(100), approvalId: uuid(101),
    executionOperationId: parent.record.intent.operationId, resultDigest: digest(10) };
  pub.record.reservedAt = time(6); pub.record.intentDigest = hash(pub.record.intent);
  pub.record.approvalIdentityDigest = hash({ domain: "agent-candidate-effect-ledger/v1", namespaceId: metadata.namespaceId, approvalId: pub.record.intent.approvalId });
  assert.ok(parseCandidateV3Inventory(envelope([item(parent), item(pub, 0)]), pins));
  denied(() => parseCandidateV3Inventory(envelope([item(pub, 0)]), pins));
  denied(() => parseCandidateV3Inventory(envelope([item(parent, parent.record.events.length - 1), item(pub, 0)]), pins));
  for (const outcome of ["failed", "cancelled", "stopped-without-result"]) {
    denied(() => parseCandidateV3Inventory(envelope([item(fixture("execute", outcome)), item(pub, 0)]), pins));
  }
  for (const field of ["resultDigest", "sourceManifestDigest", "policyBindingDigest", "controllerIdentityDigest"] as const) {
    const changed = structuredClone(pub); changed.record.intent[field] = digest(999); changed.record.intentDigest = hash(changed.record.intent);
    denied(() => parseCandidateV3Inventory(envelope([item(parent), item(changed, 0)]), pins));
  }
  pub.record.reservedAt = time(4); denied(() => parseCandidateV3Inventory(envelope([item(parent), item(pub, 0)]), pins));
});

test("v3 inventory limits include all 1000 rows, rejecting 1001, hostile inputs and noncanonical envelopes", () => {
  const records = Array.from({ length: 1000 }, (_, n) => reserved(n + 100));
  const input = envelope(records.map(f => item(f, 0))), cp = checkpoint(records.map(f => f.record));
  assert.equal(parseCandidateV3CheckpointSnapshot(input, pins, wire(cp)).inventory.rows.length, 1000);
  denied(() => parseCandidateV3Inventory(envelope([...records.map(f => item(f, 0)), item(reserved(1200), 0)]), pins));
  for (const bad of [input + "\n", "\ufeff" + input, wire({ domain: "agent-candidate-inventory-transport/v1", records: [], available: true }),
    '{"domain":"agent-candidate-inventory-transport/v1","records":[],"records":[]}']) denied(() => parseCandidateV3Inventory(bad, pins));
  let traps = 0; const proxy = new Proxy({}, { get() { traps++; throw Error("get"); }, ownKeys() { traps++; throw Error("keys"); } });
  denied(() => parseCandidateV3Inventory(proxy, pins)); denied(() => parseCandidateV3Inventory(input, proxy)); assert.equal(traps, 0);
});

test("v3 coherent omitted history plus a recomputed checkpoint remains a claim, never authenticated completeness", () => {
  const remaining = reserved(100), cp = checkpoint([remaining.record]);
  assert.equal(parseCandidateV3CheckpointSnapshot(envelope([item(remaining, 0)]), pins, wire(cp)).kind,
    "matched-v3-checkpoint-claim-not-admission");
});

test("v3 release pair rejects an unrelated rehashed row change despite individually matching snapshots", () => {
  const f = fixture(), other = reserved(100), predecessor = { ...f.record, events: f.record.events.slice(0, -1) };
  const a = checkpoint([predecessor, other.record], 0);
  f.checkpointA = a; f.record.events.at(-1)!.outcomeCheckpointDigest = a.checkpointDigest;
  const b = checkpoint([f.record, other.record], 0); b.previousCheckpointDigest = a.checkpointDigest; rehashCheckpoint(b);
  const beforeWire = envelope([item(f, f.record.events.length - 1), item(other, 0)]);
  assert.ok(parseCandidateV3ReleasePair(beforeWire, envelope([item(f), item(other, 0)]), pins, wire(a), wire(b)));
  other.record.intent.authorizationDigest = digest(999); other.record.intentDigest = hash(other.record.intent);
  const substituted = checkpoint([f.record, other.record], 0); substituted.previousCheckpointDigest = a.checkpointDigest; rehashCheckpoint(substituted);
  const afterWire = envelope([item(f), item(other, 0)]);
  assert.ok(parseCandidateV3CheckpointSnapshot(afterWire, pins, wire(substituted)));
  denied(() => parseCandidateV3ReleasePair(beforeWire, afterWire, pins, wire(a), wire(substituted)));
});

test("v3 full released-history inventory at 1000 rows uses bounded tuple hashing", () => {
  const records = Array.from({ length: 1000 }, (_, n) => {
    const f = fixture(); const i = n + 100;
    f.record.intent.operationId = uuid(i); f.record.intent.approvalId = uuid(i + 2000); f.record.intent.workflowId = uuid(i + 4000);
    f.record.intentDigest = hash(f.record.intent);
    f.record.approvalIdentityDigest = hash({ domain: "agent-candidate-effect-ledger/v1", namespaceId: metadata.namespaceId, approvalId: f.record.intent.approvalId });
    f.core.operationId = f.record.intent.operationId; f.core.workflowId = f.record.intent.workflowId; f.core.intentDigest = f.record.intentDigest;
    f.core.priorOutcomeRecordDigest = hash({ ...f.record, events: f.record.events.slice(0, f.outcomeIndex) });
    f.checkpointA.operationId = f.record.intent.operationId; f.checkpointA.approvalIdentityDigest = f.record.approvalIdentityDigest;
    rebind(f); return f;
  });
  const input = envelope(records.map(f => item(f))), cp = checkpoint(records.map(f => f.record));
  const result = parseCandidateV3CheckpointSnapshot(input, pins, wire(cp));
  assert.equal(result.inventory.rows.length, 1000); assert.equal(result.checkpoint.sequence, 6000);
  assert.equal(result.inventory.inventoryRootDigest, root(records.map(f => f.record)));
  assert.ok(Buffer.byteLength(input) < 16 * 1024 * 1024, "synthetic representative corpus, not a worst-case record-size proof");
});

function history(order: [F, number][], genesisGeneration = uuid(7)) {
  const checkpoints = [checkpoint([])], current = new Map<string, F["record"]>();
  checkpoints[0]!.producerGeneration = genesisGeneration; rehashCheckpoint(checkpoints[0]!);
  for (const [f, index] of order) {
    const prefix = { ...f.record, events: f.record.events.slice(0, index) }; current.set(f.record.intent.operationId, prefix);
    const records = [...current.values()].sort((a, b) => a.intent.operationId < b.intent.operationId ? -1 : 1);
    const cp = checkpoint(records, records.findIndex(r => r.intent.operationId === f.record.intent.operationId));
    cp.previousCheckpointDigest = checkpoints.at(-1)!.checkpointDigest; rehashCheckpoint(cp); checkpoints.push(cp);
    if (index === f.outcomeIndex + 1 && prefix.events.at(-1)?.state !== "quarantined") {
      f.checkpointA = structuredClone(cp);
      const release = f.record.events.find(e => e.state === "released");
      if (release) release.outcomeCheckpointDigest = cp.checkpointDigest;
    }
  }
  return checkpoints;
}
const historyWire = (checkpoints: ReturnType<typeof checkpoint>[]) => wire({ domain: "agent-candidate-checkpoint-history/v1", checkpoints: checkpoints.map(wire) });

function publication(parent: F, id = 100, outcome = "completed") {
  const pub = fixture("publish", outcome);
  pub.record.intent = { ...parent.record.intent, kind: "publish", operationId: uuid(id), approvalId: uuid(101),
    executionOperationId: parent.record.intent.operationId, resultDigest: digest(10) };
  pub.record.intentDigest = hash(pub.record.intent);
  pub.record.approvalIdentityDigest = hash({ domain: "agent-candidate-effect-ledger/v1", namespaceId: metadata.namespaceId, approvalId: pub.record.intent.approvalId });
  pub.record.reservedAt = time(5);
  pub.record.events.forEach((e, i) => { e.recordedAt = time(6 + i); });
  pub.core.operationId = pub.record.intent.operationId; pub.core.workflowId = pub.record.intent.workflowId;
  pub.core.intentDigest = pub.record.intentDigest; pub.core.observedAt = time(6 + pub.outcomeIndex);
  pub.core.priorOutcomeRecordDigest = hash({ ...pub.record, events: pub.record.events.slice(0, pub.outcomeIndex) });
  pub.checkpointA.operationId = pub.record.intent.operationId; pub.checkpointA.approvalIdentityDigest = pub.record.approvalIdentityDigest;
  rebind(pub); return pub;
}
const allCuts = (f: F): [F, number][] => Array.from({ length: f.record.events.length + 1 }, (_, i) => [f, i]);

test("v3 bootstrap returns frozen historical A and lastAt at every prefix without requiring supplied A", () => {
  const f = fixture(), other = reserved(100); other.record.reservedAt = time(4);
  const order: [F, number][] = [...allCuts(f).slice(0, -1), [other, 0], [f, f.record.events.length]];
  const cps = history(order, uuid(999));
  for (let length = 0; length <= order.length; length++) {
    const current = new Map<string, ReturnType<typeof item>>();
    for (const [row, index] of order.slice(0, length)) {
      const entry = item(row, index);
      if (row.record.events[index - 1]?.state !== "released") entry.checkpointAWire = null;
      current.set(row.record.intent.operationId, entry);
    }
    const input = envelope([...current.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([, row]) => row));
    const parsed = parseCandidateV3CheckpointHistory(input, pins, historyWire(cps.slice(0, length + 1)));
    const last = order[length - 1];
    assert.equal(parsed.lastAt, last ? (last[0].record.events[last[1] - 1]?.recordedAt ?? last[0].record.reservedAt) : "");
    assert.equal(parsed.head.checkpointDigest, cps[length]!.checkpointDigest);
    assert.deepEqual(parsed.outcomeCheckpointByOperation, length >= f.outcomeIndex + 2
      ? { [f.record.intent.operationId]: cps[f.outcomeIndex + 2]!.checkpointDigest } : {});
    assert.ok(Object.isFrozen(parsed.outcomeCheckpointByOperation));
    assert.throws(() => { parsed.outcomeCheckpointByOperation[uuid(888)] = digest(888); }, TypeError);
  }
});

test("v3 historical row generation differs from genesis epoch and cannot be relabeled to a new coordinator epoch", () => {
  const f = fixture(), cps = history(allCuts(f), uuid(999)), input = envelope([item(f)]);
  assert.notEqual(cps[0]!.producerGeneration, f.record.intent.ownerGeneration);
  const result = parseCandidateV3CheckpointHistory(input, pins, historyWire(cps));
  assert.equal(result.head.producerGeneration, f.record.intent.ownerGeneration);
  assert.equal(result.outcomeCheckpointByOperation[f.record.intent.operationId], f.checkpointA.checkpointDigest);
  // Change only the final historical producer identity and recompute its digest.
  // No stale hash/previous-head/root failure can mask the generation check.
  const changed = structuredClone(cps); changed.at(-1)!.producerGeneration = uuid(1000); rehashCheckpoint(changed.at(-1)!);
  denied(() => parseCandidateV3CheckpointSnapshot(input, pins, wire(changed.at(-1)!)));
  denied(() => parseCandidateV3CheckpointHistory(input, pins, historyWire(changed)));
});

test("v3 bootstrap extracts each execution outcome across cuts and retains A after quarantine", () => {
  for (const [outcome, stopAfterDelivery] of [["completed", false], ["failed", false], ["cancelled", false],
    ["stopped-without-result", false], ["stopped-without-result", true]] as const) {
    const full = fixture("execute", outcome, stopAfterDelivery);
    for (let cut = 0; cut <= full.record.events.length; cut++) {
      for (const quarantine of [false, true]) {
        if (quarantine && cut === full.record.events.length) continue;
        const f = structuredClone(full);
        f.record.events = f.record.events.slice(0, cut);
        if (quarantine) f.record.events.push(event("quarantined", 9));
        const cps = history(allCuts(f), uuid(999)), hasOutcome = cut > f.outcomeIndex;
        const input = envelope([{ recordWire: wire(f.record), settlementWire: hasOutcome ? wire(f.core) : null,
          checkpointAWire: !quarantine && cut === full.record.events.length ? wire(f.checkpointA) : null }]);
        const result = parseCandidateV3CheckpointHistory(input, pins, historyWire(cps));
        assert.deepEqual(result.outcomeCheckpointByOperation, hasOutcome
          ? { [f.record.intent.operationId]: cps[f.outcomeIndex + 2]!.checkpointDigest } : {}, `${outcome}/${cut}/${quarantine}`);
        assert.equal(result.lastAt, f.record.events.at(-1)?.recordedAt ?? f.record.reservedAt);
      }
    }
  }
});

test("v3 history denies a publication reserved before its parent exists even when final inventory is valid", () => {
  const parent = fixture();
  parent.record.reservedAt = time(5);
  parent.record.events.forEach(e => { e.recordedAt = time(5); });
  parent.core.observedAt = time(5);
  parent.core.priorOutcomeRecordDigest = hash({ ...parent.record, events: parent.record.events.slice(0, parent.outcomeIndex) });
  rebind(parent);
  const pub = publication(parent);
  const valid = history([...allCuts(parent), ...allCuts(pub)]);
  assert.ok(parseCandidateV3CheckpointHistory(envelope([item(parent), item(pub)]), pins, historyWire(valid)));
  const invalid = history([[pub, 0], ...allCuts(parent), ...allCuts(pub).slice(1)]);
  const input = envelope([item(parent), item(pub)]);
  assert.ok(parseCandidateV3Inventory(input, pins));
  assert.ok(parseCandidateV3CheckpointSnapshot(input, pins, wire(invalid.at(-1)!)));
  // First reservation has no previously blocked workspace or earlier timestamp;
  // it must fail specifically because the parent has not been introduced yet.
  denied(() => parseCandidateV3CheckpointHistory(input, pins, historyWire(invalid)));
});

test("v3 bootstrap extracts publication completed restored and cancelled A across cuts and quarantine", () => {
  for (const outcome of ["completed", "restored", "cancelled"]) {
    const parent = fixture(), full = publication(parent, 100, outcome);
    for (let cut = 0; cut <= full.record.events.length; cut++) {
      for (const quarantine of [false, true]) {
        if (quarantine && cut === full.record.events.length) continue;
        const pub = structuredClone(full); pub.record.events = pub.record.events.slice(0, cut);
        if (quarantine) pub.record.events.push(event("quarantined", 9));
        const cps = history([...allCuts(parent), ...allCuts(pub)], uuid(999)), hasOutcome = cut > pub.outcomeIndex;
        const input = envelope([item(parent), { recordWire: wire(pub.record), settlementWire: hasOutcome ? wire(pub.core) : null,
          checkpointAWire: !quarantine && cut === full.record.events.length ? wire(pub.checkpointA) : null }]);
        const result = parseCandidateV3CheckpointHistory(input, pins, historyWire(cps));
        assert.deepEqual(result.outcomeCheckpointByOperation, {
          [parent.record.intent.operationId]: parent.checkpointA.checkpointDigest,
          ...(hasOutcome ? { [pub.record.intent.operationId]: cps[parent.record.events.length + pub.outcomeIndex + 3]!.checkpointDigest } : {}),
        }, `${outcome}/${cut}/${quarantine}`);
        assert.equal(result.lastAt, pub.record.events.at(-1)?.recordedAt ?? pub.record.reservedAt);
      }
    }
  }
});

test("v3 history accepts released execution then publication with unrelated work between publication A and B", () => {
  const parent = fixture(), pub = publication(parent), other = reserved(200); other.record.reservedAt = time(7);
  const cps = history([...allCuts(parent), ...allCuts(pub).slice(0, -1), [other, 0], [pub, 3]]);
  const result = parseCandidateV3CheckpointHistory(envelope([item(parent), item(pub), item(other, 0)]), pins, historyWire(cps));
  assert.equal(result.checkpointCount, 12);
  assert.notEqual(cps.at(-1)!.previousCheckpointDigest, pub.checkpointA.checkpointDigest);
});

test("v3 history rejects publication reservation before equal-time parent release despite valid final inventory", () => {
  const parent = fixture(), pub = publication(parent);
  assert.equal(pub.record.reservedAt, parent.record.events.at(-1)!.recordedAt);
  const valid = history([...allCuts(parent), ...allCuts(pub)]);
  assert.ok(parseCandidateV3CheckpointHistory(envelope([item(parent), item(pub)]), pins, historyWire(valid)));
  const invalid = history([...allCuts(parent).slice(0, -1), [pub, 0], [parent, 5], ...allCuts(pub).slice(1)]);
  const input = envelope([item(parent), item(pub)]); assert.ok(parseCandidateV3Inventory(input, pins));
  denied(() => parseCandidateV3CheckpointHistory(input, pins, historyWire(invalid)));
});

test("v3 history rejects publication reservation before parent outcome with equal timestamps and rehashed roots", () => {
  const parent = fixture(); parent.record.events[parent.outcomeIndex]!.recordedAt = time(5); rebind(parent);
  const pub = publication(parent), valid = history([...allCuts(parent), ...allCuts(pub)]);
  assert.ok(parseCandidateV3CheckpointHistory(envelope([item(parent), item(pub)]), pins, historyWire(valid)));
  const invalid = history([...allCuts(parent).slice(0, 4), [pub, 0], [parent, 4], [parent, 5], ...allCuts(pub).slice(1)]);
  const input = envelope([item(parent), item(pub)]); assert.ok(parseCandidateV3Inventory(input, pins));
  denied(() => parseCandidateV3CheckpointHistory(input, pins, historyWire(invalid)));
});

test("v3 unreleased terminal and quarantined rows retain workspace exclusion", () => {
  const other = reserved(100); other.record.intent.workspaceDigest = fixture().record.intent.workspaceDigest;
  other.record.intentDigest = hash(other.record.intent);
  const terminal = fixture("execute", "cancelled");
  const quarantined = fixture(); quarantined.record.events = [event("quarantined", 1)];
  for (const blocked of [item(terminal, 1), item(quarantined, 1)]) {
    assert.ok(parseCandidateV3Inventory(envelope([blocked]), pins));
    assert.ok(parseCandidateV3Inventory(envelope([item(other, 0)]), pins));
    denied(() => parseCandidateV3Inventory(envelope([blocked, item(other, 0)]), pins));
  }
  assert.ok(parseCandidateV3Inventory(envelope([item(terminal), item(other, 0)]), pins));
});

test("v3 publication parent lookup is independent of sorted operation identity order", () => {
  const parent = fixture(), pub = publication(parent, 0);
  assert.ok(pub.record.intent.operationId < parent.record.intent.operationId);
  const cps = history([...allCuts(parent), ...allCuts(pub)]), input = envelope([item(pub), item(parent)]);
  assert.ok(parseCandidateV3Inventory(input, pins));
  assert.ok(parseCandidateV3CheckpointHistory(input, pins, historyWire(cps)));
});

test("v3 history rejects time regression with otherwise exact sequence chain subjects and roots", () => {
  const a = reserved(100), b = reserved(101); a.record.reservedAt = time(1);
  const input = envelope([item(a, 0), item(b, 0)]);
  assert.ok(parseCandidateV3Inventory(input, pins));
  assert.ok(parseCandidateV3CheckpointHistory(input, pins, historyWire(history([[b, 0], [a, 0]]))));
  denied(() => parseCandidateV3CheckpointHistory(input, pins, historyWire(history([[a, 0], [b, 0]]))));
});

test("v3 full checkpoint history checks every root and A including intervening work before B", () => {
  const f = fixture(), other = reserved(100); other.record.reservedAt = time(4);
  const order: [F, number][] = Array.from({ length: 5 }, (_, n) => [f, n]);
  order.push([other, 0], [f, 5]); const checkpoints = history(order);
  const input = envelope([item(f), item(other, 0)]);
  assert.equal(parseCandidateV3CheckpointHistory(input, pins, historyWire(checkpoints)).checkpointCount, 8);
  assert.notEqual(checkpoints.at(-1)!.previousCheckpointDigest, f.checkpointA.checkpointDigest,
    "A need not be adjacent to B when the full intervening history is supplied");
  for (const bad of [checkpoints.slice(1), checkpoints.slice(0, -1), [checkpoints[0]!, ...checkpoints],
    [checkpoints[0]!, checkpoints[2]!, checkpoints[1]!, ...checkpoints.slice(3)]]) {
    denied(() => parseCandidateV3CheckpointHistory(input, pins, historyWire(bad)));
  }
  const changed = structuredClone(checkpoints); changed[2]!.inventoryRootDigest = digest(999); rehashCheckpoint(changed[2]!);
  denied(() => parseCandidateV3CheckpointHistory(input, pins, historyWire(changed)));
  const changedA = structuredClone(f); changedA.checkpointA.previousCheckpointDigest = digest(999); rehashCheckpoint(changedA.checkpointA);
  changedA.record.events.at(-1)!.outcomeCheckpointDigest = changedA.checkpointA.checkpointDigest;
  const changedB = checkpoint([changedA.record, other.record], 0); changedB.previousCheckpointDigest = checkpoints.at(-2)!.checkpointDigest; rehashCheckpoint(changedB);
  denied(() => parseCandidateV3CheckpointHistory(envelope([item(changedA), item(other, 0)]), pins,
    historyWire([...checkpoints.slice(0, -1), changedB])));
});

test("v3 historical workspace overlap denies even when final rows are individually released", () => {
  const a = fixture(), b = fixture("execute", "cancelled");
  b.record.intent.operationId = uuid(100); b.record.intent.workflowId = uuid(101); b.record.intent.approvalId = uuid(102);
  b.record.intentDigest = hash(b.record.intent); b.core.operationId = uuid(100); b.core.workflowId = uuid(101); b.core.intentDigest = b.record.intentDigest;
  b.record.approvalIdentityDigest = hash({ domain: "agent-candidate-effect-ledger/v1", namespaceId: metadata.namespaceId, approvalId: uuid(102) });
  b.core.priorOutcomeRecordDigest = hash({ ...b.record, events: [] });
  b.checkpointA.operationId = uuid(100); b.checkpointA.approvalIdentityDigest = b.record.approvalIdentityDigest;
  b.record.events[0]!.recordedAt = time(6); b.record.events[1]!.recordedAt = time(7); b.core.observedAt = time(6); rebind(b);
  const order: [F, number][] = [[a, 0], [b, 0], ...Array.from({ length: 5 }, (_, n): [F, number] => [a, n + 1]), [b, 1], [b, 2]];
  const checkpoints = history(order), input = envelope([item(a), item(b)]);
  assert.ok(parseCandidateV3Inventory(input, pins), "final released rows alone cannot reveal historical overlap");
  denied(() => parseCandidateV3CheckpointHistory(input, pins, historyWire(checkpoints)));
});

test("v3 checkpoint history requires explicit genesis even for empty state and rejects non-text callers", () => {
  assert.equal(parseCandidateV3CheckpointHistory(envelope([]), pins, historyWire([checkpoint([])])).checkpointCount, 1);
  for (const bad of [historyWire([]), historyWire([checkpoint([])]) + "\n", wire({ domain: "agent-candidate-checkpoint-history/v1", checkpoints: [42] }),
    wire({ domain: "agent-candidate-checkpoint-history/v1", checkpoints: Array(7002).fill("") })]) denied(() => parseCandidateV3CheckpointHistory(envelope([]), pins, bad));
  let traps = 0; const proxy = new Proxy({}, { get() { traps++; throw Error("get"); } });
  denied(() => parseCandidateV3CheckpointHistory(envelope([]), pins, proxy)); assert.equal(traps, 0);
});
