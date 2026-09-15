import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson as wire, canonicalSha256Digest as hash } from "../../src/compatibility/canonical-json.js";
import { CandidateV3DataError } from "../../src/build-only/windows-candidate-v3-data.js";
import { parseCandidateV3Record, parseCandidateV3Checkpoint } from "../../src/build-only/windows-candidate-v3-record.js";
import { fixture, rebind, rehashCheckpoint, metadata, uuid, digest, time, event } from "../helpers/candidate-v3-record-fixture.js";

const denied = (fn: () => unknown) => assert.throws(fn, e => e instanceof CandidateV3DataError);
const parse = (f: ReturnType<typeof fixture>, count = f.record.events.length) => parseCandidateV3Record(
  wire({ ...f.record, events: f.record.events.slice(0, count) }), wire(metadata),
  count > f.outcomeIndex ? wire(f.core) : null, count > f.outcomeIndex ? wire(f.checkpointA) : null);

for (const [kind, outcome, early] of [["execute", "completed", false], ["execute", "failed", false],
  ["execute", "cancelled", false], ["execute", "stopped-without-result", false], ["execute", "stopped-without-result", true],
  ["publish", "completed", false], ["publish", "restored", false], ["publish", "cancelled", false]] as const) {
  test(`v3 every history cut parses as data only: ${kind}/${outcome}/${early}`, () => {
    const f = fixture(kind, outcome, early);
    assert.ok(f.record.events.length <= 5);
    for (let n = 0; n <= f.record.events.length; n++) {
      const value = parse(f, n); assert.equal(value.kind, "parsed-v3-record-not-admission");
      assert.deepEqual(value.record.events, f.record.events.slice(0, n));
      assert.ok(Object.isFrozen(value.record.events) && Object.isFrozen(value.record.intent));
      assert.equal("canReserve" in value, false); assert.equal("available" in value, false);
    }
    const repeated = structuredClone(f); repeated.record.events.push(event("quarantined", 19)); denied(() => parse(repeated));
  });
}

test("v3 rejects release before an outcome, changed predecessor, evidence or checkpoint-A digest", () => {
  const f = fixture();
  for (let n = 0; n <= f.outcomeIndex; n++) {
    const wrong = structuredClone(f);
    wrong.record.events = [...wrong.record.events.slice(0, n), { ...wrong.record.events.at(-1)!, recordedAt: time(19),
      predecessorRecordDigest: hash({ ...wrong.record, events: wrong.record.events.slice(0, n) }) }];
    denied(() => parseCandidateV3Record(wire(wrong.record), wire(metadata), wire(wrong.core), wire(wrong.checkpointA)));
  }
  for (const field of ["predecessorRecordDigest", "outcomeCheckpointDigest", "evidenceDigest", "outcome"] as const) {
    const wrong = structuredClone(f); wrong.record.events.at(-1)![field] = field === "outcome" ? "failed" : digest(999);
    denied(() => parse(wrong));
  }
  denied(() => parseCandidateV3Record(wire(f.record), wire(metadata), wire(f.core)));
  const cut = { ...f.record, events: f.record.events.slice(0, -1) };
  assert.equal(parseCandidateV3Record(wire(cut), wire(metadata), wire(f.core)).outcomeCheckpoint, null,
    "outcome before A is parseable history but not an admission or release");
  denied(() => parseCandidateV3Record(wire(cut), wire(metadata)));
});

test("v3 quarantine is absorbing at every prefix and has no release path", () => {
  const f = fixture();
  for (let n = 0; n < f.record.events.length; n++) {
    const record = { ...f.record, events: [...f.record.events.slice(0, n), event("quarantined", 19)] };
    const core = n > f.outcomeIndex ? wire(f.core) : null;
    const a = n > f.outcomeIndex ? wire(f.checkpointA) : null;
    assert.equal(parseCandidateV3Record(wire(record), wire(metadata), core, a).record.events.at(-1)?.state, "quarantined");
    for (const state of ["released", "stopped-without-result", "quarantined", "completed"]) {
      denied(() => parseCandidateV3Record(wire({ ...record, events: [...record.events, event(state, 20)] }), wire(metadata), core, a));
    }
  }
});

test("v3 evidence joins every subject even after downstream evidence and checkpoint hashes are recomputed", () => {
  for (const key of ["installationId", "namespaceId", "storeId", "operationId", "workflowId", "ownerGeneration", "guestGeneration",
    "requestDigest", "sourceManifestDigest", "workspaceDigest", "policyBindingDigest", "controllerIdentityDigest",
    "resourcePolicyDigest", "intentDigest", "priorOutcomeRecordDigest", "resultDigest"] as const) {
    const f = fixture(); f.core[key] = key.endsWith("Digest") ? digest(999) : uuid(999); rebind(f); denied(() => parse(f));
  }
  const kind = fixture(); kind.core.kind = "publish"; kind.core.resultDigest = null; kind.core.verificationPassed = null;
  rebind(kind); denied(() => parse(kind));
  const outcome = fixture(); outcome.core.outcome = "failed"; outcome.core.verificationPassed = false;
  rebind(outcome); denied(() => parse(outcome));
  const role = fixture(); role.core.processSettlementEvidenceDigest = digest(999);
  denied(() => parse(role)); // The historical event binds the exact role core.
  rebind(role); assert.equal(parse(role).settlementEvidence?.processSettlementEvidenceDigest, digest(999),
    "coherent unkeyed claims remain parseable; this parser authenticates no physical evidence");
});

test("v3 checkpoint A must name the exact historical subject and outcome prefix", () => {
  for (const key of ["operationId", "producerGeneration", "recordDigest", "approvalIdentityDigest", "eventIndex"] as const) {
    const f = fixture();
    if (key === "eventIndex") f.checkpointA.eventIndex = 0;
    else if (key.endsWith("Digest")) f.checkpointA[key] = digest(999);
    else f.checkpointA[key] = uuid(999);
    rehashCheckpoint(f.checkpointA); f.record.events.at(-1)!.outcomeCheckpointDigest = f.checkpointA.checkpointDigest;
    denied(() => parse(f));
  }
  const f = fixture(); f.checkpointA.recordDigest = hash(f.record); rehashCheckpoint(f.checkpointA);
  f.record.events.at(-1)!.outcomeCheckpointDigest = f.checkpointA.checkpointDigest;
  denied(() => parse(f)); // A cannot witness its released successor or B.
});

test("v3 transition replay rejects skipped/reordered/wrong-kind/result-bearing paths and seventh events", () => {
  const f = fixture();
  for (const order of [[1, 0, 2, 3, 4], [0, 2, 3, 4], [0, 1, 1, 2, 3, 4]]) {
    const wrong = structuredClone(f); wrong.record.events = order.map(n => structuredClone(f.record.events[n]!)); denied(() => parse(wrong));
  }
  for (const [index, state] of [[0, "launch-possible"], [1, "publication-possible"], [2, "completed"], [3, "failed"], [3, "stopped-without-result"], [0, "reserved"]] as const) {
    const wrong = structuredClone(f); wrong.record.events[index]!.state = state; denied(() => parse(wrong));
  }
  for (const key of ["resultDigest", "verificationPassed", "predecessorRecordDigest", "outcomeCheckpointDigest", "outcome"] as const) {
    const wrong = structuredClone(f);
    if (key === "verificationPassed") wrong.record.events[0]![key] = true;
    else wrong.record.events[0]![key] = key === "outcome" ? "completed" : digest(999);
    denied(() => parse(wrong));
  }
  const limit = structuredClone(f); limit.record.events.push(event("quarantined", 18), event("quarantined", 19)); denied(() => parse(limit));
});

test("v3 rejects identity/domain/hash drift, unknown/omitted fields and invalid wire without caller invocation", () => {
  const f = fixture(), valid = wire(f.record);
  for (const key of ["installationId", "namespaceId", "storeId"] as const) denied(() => parseCandidateV3Record(valid, wire({ ...metadata, [key]: uuid(999) }), wire(f.core), wire(f.checkpointA)));
  for (const key of Object.keys(f.record)) { const bad = { ...f.record } as Record<string, unknown>; delete bad[key]; denied(() => parseCandidateV3Record(wire(bad), wire(metadata))); }
  for (const key of Object.keys(f.record.events[0]!)) { const bad = structuredClone(f.record); delete (bad.events[0] as Record<string, unknown>)[key]; denied(() => parseCandidateV3Record(wire(bad), wire(metadata))); }
  for (const key of ["intentDigest", "approvalIdentityDigest"] as const) { const wrong = structuredClone(f); wrong.record[key] = digest(999); denied(() => parse(wrong)); }
  for (const input of ["\ufeff" + valid, valid + "\n", "x".repeat(32769), "é".repeat(16385),
    valid.replace('"reservedAt":', '"reservedAt":"2026-09-15T00:00:00.000Z","reservedAt":'),
    wire({ ...f.record, permission: true })]) denied(() => parseCandidateV3Record(input, wire(metadata)));
  let traps = 0; const proxy = new Proxy({}, { get() { traps++; throw Error("getter"); }, ownKeys() { traps++; throw Error("keys"); } });
  denied(() => parseCandidateV3Record(proxy, wire(metadata))); denied(() => parseCandidateV3Checkpoint(proxy, wire(metadata)));
  denied(() => parseCandidateV3Record(valid, proxy)); denied(() => parseCandidateV3Record(valid, wire(metadata), proxy));
  denied(() => parseCandidateV3Record(valid, wire(metadata), wire(f.core), proxy)); assert.equal(traps, 0);
});

test("v3 timing permits bounded post-expiry outcome bookkeeping, never late forward effects or release", () => {
  for (const index of [0, 1]) { const f = fixture(); f.record.events[index]!.recordedAt = time(10); denied(() => parse(f)); }
  const f = fixture(); f.record.events[2]!.recordedAt = time(0); denied(() => parse(f));
  for (const at of [time(20), time(21)]) { const expired = fixture(); expired.record.events.at(-1)!.recordedAt = at; denied(() => parse(expired)); }
  const old = fixture(); old.core.observedAt = time(-1); rebind(old); denied(() => parse(old));
  const beforeResult = fixture(); beforeResult.core.observedAt = time(2); rebind(beforeResult); denied(() => parse(beforeResult));
  const equalResult = fixture(); equalResult.core.observedAt = time(3); rebind(equalResult); assert.ok(parse(equalResult));
  const future = fixture(); future.record.events[3]!.recordedAt = time(15); future.record.events[4]!.recordedAt = time(19);
  rebind(future); assert.equal(parse(future).record.events.at(-1)?.recordedAt, time(19));
});

test("checkpoint genesis is canonical empty data, not initialization or a missing-anchor fallback", () => {
  const f = fixture(), a = f.checkpointA;
  a.sequence = 0; a.previousCheckpointDigest = null; a.operationId = null; a.eventIndex = null;
  a.recordDigest = null; a.approvalIdentityDigest = null; a.operationCount = 0;
  a.inventoryRootDigest = hash({ domain: "agent-candidate-inventory-root/v1", installationId: metadata.installationId,
    namespaceId: metadata.namespaceId, storeId: metadata.storeId, operationCount: 0, entries: [] }); rehashCheckpoint(a);
  assert.equal(parseCandidateV3Checkpoint(wire(a), wire(metadata)).sequence, 0);
  a.inventoryRootDigest = digest(0); rehashCheckpoint(a); denied(() => parseCandidateV3Checkpoint(wire(a), wire(metadata)));
  for (const sequence of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const wrong = fixture().checkpointA; wrong.sequence = sequence; rehashCheckpoint(wrong); denied(() => parseCandidateV3Checkpoint(wire(wrong), wire(metadata)));
  }
  denied(() => parseCandidateV3Checkpoint(wire(fixture().checkpointA) + "\n", wire(metadata)));
});

test("checkpoint sequence cannot precede its retained operations and subject events", () => {
  const f = fixture(); f.checkpointA.sequence = f.checkpointA.eventIndex!;
  rehashCheckpoint(f.checkpointA); denied(() => parseCandidateV3Checkpoint(wire(f.checkpointA), wire(metadata)));
  f.checkpointA.sequence = f.checkpointA.eventIndex! + 1;
  rehashCheckpoint(f.checkpointA); assert.ok(parseCandidateV3Checkpoint(wire(f.checkpointA), wire(metadata)));
  f.checkpointA.operationCount = 2;
  rehashCheckpoint(f.checkpointA); denied(() => parseCandidateV3Checkpoint(wire(f.checkpointA), wire(metadata)));
});
