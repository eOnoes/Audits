import { canonicalJson as wire, canonicalSha256Digest as hash } from "../../src/compatibility/canonical-json.js";
import { fixture, metadata, uuid, digest, time, event, rebind, rehashCheckpoint } from "./candidate-v3-record-fixture.js";

// Independent synthetic claim construction. No production validator or effect.
export type ClaimFixture = ReturnType<typeof fixture>;
export type ClaimRecord = ClaimFixture["record"];
export type ClaimCheckpoint = ClaimFixture["checkpointA"];
export type TransportRow = { recordWire: string; settlementWire: string | null; checkpointAWire: string | null };
export type Attachment = "outcome" | "release" | "later-unrelated";
export const families = [["execute", "completed"], ["execute", "failed"], ["execute", "cancelled"],
  ["execute", "stopped-without-result"], ["execute", "stopped-without-result", true],
  ["publish", "completed"], ["publish", "restored"], ["publish", "cancelled"]] as const;
const outcomes = new Set(["completed", "failed", "cancelled", "stopped-without-result", "restored"]);
export const pins = wire(metadata);
export const envelope = (records: TransportRow[]) => wire({ domain: "agent-candidate-inventory-transport/v1", records });
export const historyWire = (cps: ClaimCheckpoint[]) => wire({ domain: "agent-candidate-checkpoint-history/v1", checkpoints: cps.map(wire) });
export const recordsOf = (input: string): TransportRow[] => (JSON.parse(input) as { records: TransportRow[] }).records;
export const sorted = (rows: ClaimRecord[]) => [...rows].sort((a, b) => a.intent.operationId < b.intent.operationId ? -1 : 1);
export function root(records: ClaimRecord[]) {
  return hash({ domain: "agent-candidate-inventory-root/v1", installationId: metadata.installationId,
    namespaceId: metadata.namespaceId, storeId: metadata.storeId, operationCount: records.length,
    entries: sorted(records).map(r => ({ operationId: r.intent.operationId, eventIndex: r.events.length,
      recordDigest: hash(r), approvalIdentityDigest: r.approvalIdentityDigest, state: r.events.at(-1)?.state ?? "reserved" })) });
}
export function checkpoint(records: ClaimRecord[], subjectId: string | null, previous: ClaimCheckpoint | null): ClaimCheckpoint {
  const subject = records.find(r => r.intent.operationId === subjectId);
  const cp = { ...fixture().checkpointA, sequence: records.reduce((sum, r) => sum + r.events.length + 1, 0),
    previousCheckpointDigest: previous?.checkpointDigest ?? null, operationId: subject?.intent.operationId ?? null,
    eventIndex: subject?.events.length ?? null, recordDigest: subject ? hash(subject) : null,
    approvalIdentityDigest: subject?.approvalIdentityDigest ?? null, producerGeneration: subject?.intent.ownerGeneration ?? uuid(99999),
    operationCount: records.length, inventoryRootDigest: root(records) };
  rehashCheckpoint(cp); return cp;
}
export const genesis = checkpoint([], null, null);
export function make(family: number, number: number, parent?: ClaimFixture, cut?: number, quarantine = false): ClaimFixture {
  const spec = families[family]!;
  const f = fixture(spec[0], spec[1], spec.length === 3 && spec[2]), n = 100 + number * 100;
  f.record.intent = { ...f.record.intent, operationId: uuid(n), workflowId: uuid(n + 1), approvalId: uuid(n + 2),
    ownerGeneration: uuid(n + 3), workspaceDigest: digest(n + 4), expiresAt: time(1000) };
  if (spec[0] === "publish") {
    if (!parent) throw Error("fixture needs parent");
    f.record.intent = { ...parent.record.intent, kind: "publish", operationId: uuid(n), approvalId: uuid(n + 2),
      ownerGeneration: uuid(n + 3), executionOperationId: parent.record.intent.operationId, resultDigest: digest(10) };
  }
  f.record.reservedAt = time(0); f.record.events.forEach(e => { e.recordedAt = time(0); });
  f.record.intentDigest = hash(f.record.intent);
  f.record.approvalIdentityDigest = hash({ domain: "agent-candidate-effect-ledger/v1", namespaceId: metadata.namespaceId, approvalId: f.record.intent.approvalId });
  for (const key of ["operationId", "workflowId", "workspaceDigest", "ownerGeneration"] as const) f.core[key] = f.record.intent[key];
  f.core.intentDigest = f.record.intentDigest; f.core.observedAt = time(0); f.core.validUntil = time(1000);
  f.core.priorOutcomeRecordDigest = hash({ ...f.record, events: f.record.events.slice(0, f.outcomeIndex) });
  f.checkpointA.operationId = f.record.intent.operationId; f.checkpointA.approvalIdentityDigest = f.record.approvalIdentityDigest;
  f.checkpointA.producerGeneration = f.record.intent.ownerGeneration; rebind(f);
  if (cut !== undefined) {
    f.record.events = f.record.events.slice(0, cut);
    if (quarantine) f.record.events.push(event("quarantined", 0));
  }
  return f;
}

export type Frame = { input: string; checkpoint: ClaimCheckpoint; history: ClaimCheckpoint[] };
export function transcript(fixtures: ClaimFixture[], order: number[], attachment: Attachment = "release"): Frame[] {
  const indexes = fixtures.map(() => -1), current = new Map<string, { record: ClaimRecord; f: ClaimFixture }>();
  const knownA = new Map<string, ClaimCheckpoint>(), delivered = new Set<string>(), cps = [genesis], result: Frame[] = [];
  for (const n of order) {
    const f = fixtures[n]!, index = ++indexes[n]!;
    if (index > f.record.events.length) throw Error("fixture order overflow");
    const record = structuredClone({ ...f.record, events: f.record.events.slice(0, index) }), id = record.intent.operationId;
    if (record.events.at(-1)?.state === "released") record.events.at(-1)!.outcomeCheckpointDigest = knownA.get(id)!.checkpointDigest;
    current.set(id, { record, f });
    const cp = checkpoint([...current.values()].map(v => v.record), id, cps.at(-1)!); cps.push(cp);
    if (outcomes.has(record.events.at(-1)?.state ?? "")) knownA.set(id, cp);
    const entries = [...current.values()].sort((a, b) => a.record.intent.operationId < b.record.intent.operationId ? -1 : 1);
    const input = envelope(entries.map(({ record: r, f: original }) => {
      const key = r.intent.operationId, a = knownA.get(key);
      if (a && (attachment === "outcome" || r.events.at(-1)?.state === "released"
        || (attachment === "later-unrelated" && id !== key && cp.sequence > a.sequence))) delivered.add(key);
      return { recordWire: wire(r), settlementWire: a ? wire(original.core) : null,
        checkpointAWire: delivered.has(key) ? wire(a) : null };
    }));
    result.push({ input, checkpoint: cp, history: [...cps] });
  }
  return result;
}

/** Exhaustive schedules for the supplied bounded row paths, with publication
 * reservation after parent release. Not exhaustive over all possible rows. */
export function* schedules(fixtures: ClaimFixture[], counts = fixtures.map(() => 0), prefix: number[] = []): Generator<number[]> {
  if (counts.every((c, n) => c === fixtures[n]!.record.events.length + 1)) { yield prefix; return; }
  for (let n = 0; n < fixtures.length; n++) {
    const f = fixtures[n]!, count = counts[n]!;
    if (count === f.record.events.length + 1) continue;
    if (count === 0 && f.record.intent.kind === "publish") {
      const parent = fixtures.findIndex(p => p.record.intent.operationId === f.record.intent.executionOperationId);
      if (parent < 0 || counts[parent] !== fixtures[parent]!.record.events.length + 1
        || fixtures[parent]!.record.events.at(-1)?.state !== "released") continue;
    }
    const next = [...counts]; next[n] = count + 1;
    yield* schedules(fixtures, next, [...prefix, n]);
  }
}
