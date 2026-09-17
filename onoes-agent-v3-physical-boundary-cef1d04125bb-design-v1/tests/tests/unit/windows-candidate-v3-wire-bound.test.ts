import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import ts from "typescript";
import { canonicalJson as wire } from "../../src/compatibility/canonical-json.js";
import { parseCandidateV3Metadata, parseCandidateSettlementCore, CANDIDATE_V3_META_MAX_BYTES, CANDIDATE_SETTLEMENT_MAX_BYTES } from "../../src/build-only/windows-candidate-v3-data.js";
import { parseCandidateV3Record, parseCandidateV3Checkpoint, CANDIDATE_V3_MAX_RECORD_BYTES, CANDIDATE_V3_MAX_CHECKPOINT_BYTES } from "../../src/build-only/windows-candidate-v3-record.js";
import { CANDIDATE_V3_MAX_OPERATIONS, CANDIDATE_V3_MAX_INVENTORY_BYTES } from "../../src/build-only/windows-candidate-v3-inventory.js";
import { V3_MESSAGE_LIMITS } from "../../src/build-only/windows-candidate-v3-messages.js";
import { encodeCandidateV3LocalSnapshot } from "../../src/build-only/windows-candidate-v3-coordinator-data.js";
import { maximumStructuralShapes, structuralWireBounds, BOUND_SOURCE_PINS, profile, embed, arrayBound, objectBound } from "../helpers/candidate-v3-wire-bound.js";
import { fixture, metadata } from "../helpers/candidate-v3-record-fixture.js";
import { families, make, transcript, pins, recordsOf } from "../helpers/candidate-v3-history-fixture.js";

const read = (p: string) => readFileSync(resolve(p));
function sourceObjects(path: string) {
  const sf = ts.createSourceFile(path, read(path).toString(), ts.ScriptTarget.Latest, true);
  const declarations = new Map<string, ts.Expression>();
  for (const statement of sf.statements) if (ts.isVariableStatement(statement)) {
    for (const d of statement.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) declarations.set(d.name.text, d.initializer);
  }
  const keys = (expression: ts.Expression): string[] => {
    if (ts.isIdentifier(expression)) { const value = declarations.get(expression.text); assert(value); return keys(value); }
    if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
      const access = expression.expression;
      if (access.name.text === "strict") return keys(access.expression);
      if (access.name.text === "object") { assert(expression.arguments[0]); return keys(expression.arguments[0]); }
    }
    assert(ts.isObjectLiteralExpression(expression));
    return expression.properties.flatMap(p => {
      if (ts.isSpreadAssignment(p)) return keys(p.expression);
      assert(ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))); return [p.name.text];
    });
  };
  return { sf, declarations, keys, named: (name: string) => { const n = declarations.get(name); assert(n); return keys(n).sort(); } };
}
test("wire-bound research is pinned to unchanged inspected schema/canonical source", () => {
  for (const [p, expected] of Object.entries(BOUND_SOURCE_PINS)) assert.equal(createHash("sha256").update(read(p).toString().replaceAll("\r\n", "\n")).digest("hex"), expected,
    "Re-derive/review the structural bound after schema or parser changes: " + p);
});

test("structural supersets cover every strict schema field, including both intent variants", () => {
  const shapes = maximumStructuralShapes(), data = sourceObjects("src/build-only/windows-candidate-v3-data.ts"), record = sourceObjects("src/build-only/windows-candidate-v3-record.ts");
  for (const [name, sample] of [["metaSchema", shapes.metadata], ["settlementSchema", shapes.settlement]] as const) assert.deepEqual(data.named(name), Object.keys(sample).sort());
  for (const [name, sample] of [["eventSchema", shapes.event], ["recordSchema", shapes.record], ["checkpointSchema", shapes.checkpoint]] as const) assert.deepEqual(record.named(name), Object.keys(sample).sort());
  const intent = record.declarations.get("intentSchema"); assert(intent && ts.isCallExpression(intent));
  const variants = intent.arguments[1]; assert(variants && ts.isArrayLiteralExpression(variants));
  assert.equal(variants.elements.length, 2);
  const maximum = Object.keys(shapes.intent).sort();
  assert.deepEqual(record.keys(variants.elements[1]!).sort(), maximum);
  assert.deepEqual(record.keys(variants.elements[0]!).sort(), maximum.filter(k => k !== "executionOperationId" && k !== "resultDigest"));
  assert.match(record.declarations.get("recordSchema")!.getText(record.sf), /events: z\.array\(eventSchema\)\.max\(6\)/);
});

test("JSON string nesting arithmetic matches independent serialization including repeat escaping", () => {
  for (const sample of ["{}", '"value"', wire({ text: 'a"b\\c' }), wire(maximumStructuralShapes().record)]) {
    let value = sample, bound = profile(value);
    for (let n = 0; n < 4; n++) { value = JSON.stringify(value); bound = embed(bound); assert.deepEqual(profile(value), bound); }
  }
  const value = { key: "abc" };
  for (const n of [0, 1, 2, 1000]) assert.deepEqual(profile(JSON.stringify(Array.from({ length: n }, () => value))), arrayBound(profile(JSON.stringify(value)), n));
  assert.deepEqual(profile(JSON.stringify({ a: value, b: null })), objectBound({ a: profile(JSON.stringify(value)), b: profile("null") }));
});

test("even the relaxed structural byte ceilings fit unchanged inner and outer caps", t => {
  const b = structuralWireBounds(); assert.equal(CANDIDATE_V3_MAX_OPERATIONS, b.operations);
  assert(b.members.metadata.bytes < CANDIDATE_V3_META_MAX_BYTES); assert(b.members.record.bytes < CANDIDATE_V3_MAX_RECORD_BYTES);
  assert(b.members.settlement.bytes < CANDIDATE_SETTLEMENT_MAX_BYTES); assert(b.members.checkpoint.bytes < CANDIDATE_V3_MAX_CHECKPOINT_BYTES);
  assert(b.inventory.bytes < CANDIDATE_V3_MAX_INVENTORY_BYTES); assert(b.history.bytes < CANDIDATE_V3_MAX_INVENTORY_BYTES);
  assert(b.snapshot.bytes < V3_MESSAGE_LIMITS.bootstrapBytes);
  for (const p of Object.values(b.members)) assert.equal(p.backslashes, 0);
  t.diagnostic(JSON.stringify(b));
});

test("structural ceiling objects are NOT passed off as valid or maximum-admissible histories", () => {
  const s = maximumStructuralShapes(); parseCandidateV3Metadata(wire(s.metadata));
  assert.throws(() => parseCandidateV3Record(wire(s.record), wire(s.metadata), wire(s.settlement), wire(s.checkpoint)));
  assert.throws(() => parseCandidateSettlementCore(wire(s.settlement)));
  assert.throws(() => parseCandidateV3Checkpoint(wire(s.checkpoint), wire(s.metadata)));
  // It is a deliberate overapproximation: six longest events, all nullable
  // digests present and longest outcomes cannot coexist in a legal row.
  assert.equal(s.record.events.length, 6); assert.equal(JSON.stringify(null).length, 4);
});

test("materialized 1000-row structural superset and 7001 checkpoints exactly reproduce the arithmetic", () => {
  // Deliberately invalid rows/checkpoints: this measures serialization equality,
  // NOT accepted capacity, bootstrap speed, process memory or physical custody.
  const s = maximumStructuralShapes(), b = structuralWireBounds();
  const recordWire = wire(s.record), settlementWire = wire(s.settlement), checkpointAWire = wire(s.checkpoint);
  const inventory = wire({ domain: "agent-candidate-inventory-transport/v1",
    records: Array.from({ length: b.operations }, () => ({ recordWire, settlementWire, checkpointAWire })) });
  const history = wire({ domain: "agent-candidate-checkpoint-history/v1",
    checkpoints: Array.from({ length: b.structuralCheckpoints }, () => checkpointAWire) });
  assert.deepEqual(profile(inventory), b.inventory); assert.deepEqual(profile(history), b.history);
  const snapshot = encodeCandidateV3LocalSnapshot(wire(s.metadata), inventory, history);
  assert.deepEqual(profile(snapshot), b.snapshot);
});

test("all 53 existing family prefixes and valid settlement/checkpoint samples fit the bound", () => {
  const b = structuralWireBounds(); let count = 0;
  const below = (text: string, bound: ReturnType<typeof profile>) => {
    const actual = profile(text); for (const key of ["bytes", "quotes", "backslashes"] as const) assert(actual[key] <= bound[key]);
    assert(/^[\x20-\x7e]+$/.test(text));
  };
  for (let family = 0; family < families.length; family++) {
    const parent = family >= 5 ? make(0, 0) : undefined, f = make(family, 1, parent), fs = parent ? [parent, f] : [f];
    for (const frame of transcript(fs, fs.flatMap((r, i) => Array(r.record.events.length + 1).fill(i) as number[]))) {
      for (const row of recordsOf(frame.input)) {
        parseCandidateV3Record(row.recordWire, pins, row.settlementWire, row.checkpointAWire); below(row.recordWire, b.members.record);
        if (row.settlementWire) below(row.settlementWire, b.members.settlement);
        if (row.checkpointAWire) below(row.checkpointAWire, b.members.checkpoint);
      }
      below(wire(frame.checkpoint), b.members.checkpoint); count++;
    }
  }
  assert.equal(count, 53);
  const failed = fixture("execute", "failed"); parseCandidateSettlementCore(wire(failed.core)); below(wire(failed.core), b.members.settlement);
  const alternative = wire(failed.record).replace('"approvalId":"0', '"approvalId":"\\u0030');
  assert.throws(() => parseCandidateV3Record(alternative, wire(metadata), wire(failed.core), wire(failed.checkpointA)));
});
