import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { canonicalJson, canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import { initializeCandidateEffectLedger, SqliteCandidateEffectLedger } from "../../src/build-only/windows-candidate-effect-ledger.js";
import { CANDIDATE_EFFECT_DOMAIN, CANDIDATE_EFFECT_MAX_OPERATIONS, CANDIDATE_EFFECT_MAX_RECORD_BYTES,
  CandidateEffectError, advanceCandidateEffectRecord, candidateEffectBlocked, candidateEffectState,
  effectApprovalIdentity, validateCandidateEffectRecord } from "../../src/build-only/windows-candidate-effect-state.js";
import type { CandidateEffectIntent, CandidateEffectRecord, CandidateEffectAdvance } from "../../src/build-only/windows-candidate-effect-state.js";
import { syntheticCheckpointInventory } from "../../src/build-only/windows-candidate-checkpoint-sequencer.js";

const AT = "2026-09-14T08:00:00.000Z", EXPIRES = "2026-09-14T08:05:00.000Z";
const d = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`;
function fixture() {
  const parent = resolve(tmpdir()), dir = mkdtempSync(join(parent, "onoes-effect-snapshot-")), path = join(dir, "ledger.sqlite");
  const db = new Database(path), namespaceId = randomUUID(), storeId = initializeCandidateEffectLedger(db, namespaceId);
  let clockCalls = 0;
  const ledger = new SqliteCandidateEffectLedger(db, storeId, namespaceId, () => { clockCalls++; return AT; });
  const other = new Database(path, { fileMustExist: true });
  const writer = new SqliteCandidateEffectLedger(other, storeId, namespaceId, () => AT);
  const input = (n = 1): CandidateEffectIntent => ({ schemaVersion: CANDIDATE_EFFECT_DOMAIN, namespaceId, storeId,
    kind: "execute", operationId: randomUUID(), workflowId: randomUUID(), approvalId: randomUUID(),
    workspaceDigest: d(n), policyBindingDigest: d(2), candidateDigest: d(3), reviewMaterialDigest: d(4),
    sourceManifestDigest: d(5), requestDigest: d(6), guestImageDigest: d(7), guestGeneration: randomUUID(),
    controllerIdentityDigest: d(8), resourcePolicyDigest: d(9), expiresAt: EXPIRES });
  return { db, other, ledger, writer, input, namespaceId, storeId, get clockCalls() { return clockCalls; },
    dispose() { for (const handle of [db, other]) if (handle.open) handle.close();
      const target = resolve(dir); assert.equal(dirname(target), parent); assert.match(basename(target), /^onoes-effect-snapshot-[a-zA-Z0-9]+$/);
      rmSync(target, { recursive: true, force: true }); } };
}
function event(r: CandidateEffectRecord, state: CandidateEffectAdvance["state"]): CandidateEffectAdvance {
  return { operationId: r.intent.operationId, intentDigest: r.intentDigest, state, evidenceDigest: d(10),
    resultDigest: state === "result-and-stop-observed" ? d(11) : null,
    verificationPassed: state === "result-and-stop-observed" ? true : null };
}
function record(intent: CandidateEffectIntent, finish = false) {
  let r = validateCandidateEffectRecord({ intent, intentDigest: canonicalSha256Digest(intent),
    approvalIdentityDigest: effectApprovalIdentity(intent), reservedAt: AT, events: [] });
  if (finish) for (const state of ["source-delivery-possible", "launch-possible", "result-and-stop-observed", "completed"] as const)
    r = advanceCandidateEffectRecord(r, event(r, state), AT);
  return r;
}
function insert(db: Database.Database, r: CandidateEffectRecord) {
  db.prepare("INSERT INTO candidate_effect_operations VALUES (?,?,?,?,?,?,?,?)").run(r.intent.operationId,
    r.approvalIdentityDigest, r.intent.workflowId, r.intent.kind, r.intent.workspaceDigest,
    Number(candidateEffectBlocked(r)), canonicalJson(r), canonicalSha256Digest(r));
}
function denies(fn: () => unknown, reason: string) {
  assert.throws(fn, (e: unknown) => e instanceof CandidateEffectError && e.reason === reason);
}

test("snapshot includes complete terminal and blocked history in stable order; immutable and no clock/write/public-read calls", () => {
  const f = fixture(); try {
    assert.deepEqual(f.ledger.snapshot(), []);
    const a = record(f.input(1), true), b = record(f.input(2));
    const q = advanceCandidateEffectRecord(b, event(b, "quarantined"), AT);
    insert(f.db, q); insert(f.db, a);
    const p = record({ ...a.intent, kind: "publish", operationId: randomUUID(), approvalId: randomUUID(),
      executionOperationId: a.intent.operationId, resultDigest: d(11) }); insert(f.db, p);
    f.ledger.read = () => { throw new Error("public read must not supply snapshot"); };
    f.ledger.listBlocked = () => { throw new Error("blocker filter must not supply snapshot"); };
    const changes = f.db.prepare("SELECT total_changes()").pluck().get(), snapshot = f.ledger.snapshot();
    assert.deepEqual(snapshot, [a, p, q].sort((x, y) => x.intent.operationId < y.intent.operationId ? -1 : 1));
    assert.equal(f.clockCalls, 0); assert.equal(f.db.inTransaction, false);
    assert.equal(f.db.prepare("SELECT total_changes()").pluck().get(), changes);
    assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot[0]!.intent)); assert.ok(Object.isFrozen(snapshot[0]!.events));
    assert.throws(() => (snapshot as CandidateEffectRecord[]).pop(), TypeError);
    assert.throws(() => { snapshot[0]!.intent.workspaceDigest = d(999); }, TypeError);
    assert.deepEqual(f.ledger.snapshot(), snapshot); assert.notEqual(f.ledger.snapshot(), snapshot);
  } finally { f.dispose(); }
});

test("WAL snapshot keeps old rows while a second connection commits between pinned identity and row scan", () => {
  const f = fixture(); try {
    const a = f.ledger.reserve(f.input(1)).record, next = f.input(2);
    const prepare = f.db.prepare.bind(f.db); let fired = 0;
    f.db.prepare = ((sql: string) => {
      if (!fired && sql.includes("FROM candidate_effect_operations ORDER BY operation_id LIMIT 1001")) {
        assert.equal(f.db.inTransaction, true, "reader snapshot must still be held"); fired++;
        f.writer.advance(event(a, "cancelled")); f.writer.reserve(next);
        assert.equal(f.other.inTransaction, false, "both writer commits finished BEFORE reader selects operation rows");
        assert.equal(f.other.prepare("SELECT count(*) FROM candidate_effect_operations").pluck().get(), 2);
      }
      return prepare(sql);
    }) as typeof f.db.prepare;
    let snapshot: readonly CandidateEffectRecord[];
    try { snapshot = f.ledger.snapshot(); } finally { f.db.prepare = prepare; }
    assert.equal(fired, 1); assert.deepEqual(snapshot, [a], "one old state, never old identity plus new rows");
    const after = f.ledger.snapshot(); assert.equal(after.length, 2);
    assert.equal(candidateEffectState(after.find(r => r.intent.operationId === a.intent.operationId)!), "cancelled");
    assert.equal(candidateEffectState(snapshot[0]!), "reserved", "returned snapshot does not mutate after commit");
  } finally { f.dispose(); }
});

test("identity replaced after preflight but before snapshot is rejected, including empty stores", () => {
  const f = fixture(); try {
    const prepare = f.db.prepare.bind(f.db); let fired = 0;
    f.db.prepare = ((sql: string) => {
      const stmt = prepare(sql);
      if (sql.includes("FROM candidate_effect_meta LIMIT 2") && !f.db.inTransaction && !fired) {
        const all = stmt.all.bind(stmt);
        stmt.all = (...args: unknown[]) => {
          const rows = all(...args); fired++;
          f.other.prepare("UPDATE candidate_effect_meta SET store_id=?").run(randomUUID()); return rows;
        };
      }
      return stmt;
    }) as typeof f.db.prepare;
    try { denies(() => f.ledger.snapshot(), "identity-mismatch"); } finally { f.db.prepare = prepare; }
    assert.equal(fired, 1); assert.equal(f.db.inTransaction, false);
  } finally { f.dispose(); }
});

for (const action of ["reserve", "advance", "replay"] as const)
test(`write rechecks empty-store identity under IMMEDIATE before ${action}, with no durable mutation`, () => {
  const f = fixture(); try {
    const input = f.input(), before = action === "reserve" ? undefined : f.ledger.reserve(input).record;
    const prepare = f.db.prepare.bind(f.db); let fired = 0, writes = 0;
    f.db.prepare = ((sql: string) => {
      if (/^(INSERT INTO|UPDATE) candidate_effect_operations/.test(sql)) writes++;
      const stmt = prepare(sql);
      if (sql.includes("FROM candidate_effect_meta LIMIT 2") && !f.db.inTransaction && !fired) {
        const all = stmt.all.bind(stmt);
        stmt.all = (...args: unknown[]) => {
          const rows = all(...args); fired++;
          // A second connection commits after preflight, before the writer's
          // BEGIN IMMEDIATE. Empty rows must not vacuously authenticate identity.
          f.other.transaction(() => {
            f.other.exec("DELETE FROM candidate_effect_operations");
            f.other.prepare("UPDATE candidate_effect_meta SET store_id=?").run(randomUUID());
          }).immediate();
          assert.equal(f.other.inTransaction, false); return rows;
        };
      }
      return stmt;
    }) as typeof f.db.prepare;
    try {
      denies(() => action === "advance" ? f.ledger.advance(event(before!, "cancelled")) : f.ledger.reserve(input), "identity-mismatch");
    } finally { f.db.prepare = prepare; }
    assert.equal(fired, 1); assert.equal(writes, 0);
    assert.equal(f.db.inTransaction, false);
    assert.equal(f.other.prepare("SELECT count(*) FROM candidate_effect_operations").pluck().get(), 0);
  } finally { f.dispose(); }
});

test("write holds IMMEDIATE lock while rechecking identity before scanning or saving", () => {
  const f = fixture(); try {
    const prepare = f.db.prepare.bind(f.db); let fired = 0;
    f.other.pragma("busy_timeout=0");
    f.db.prepare = ((sql: string) => {
      if (sql.includes("FROM candidate_effect_meta LIMIT 2") && f.db.inTransaction && !fired) {
        fired++;
        assert.throws(() => f.other.prepare("UPDATE candidate_effect_meta SET store_id=?").run(randomUUID()),
          (e: unknown) => e instanceof Error && "code" in e && e.code === "SQLITE_BUSY");
      }
      return prepare(sql);
    }) as typeof f.db.prepare;
    let saved: CandidateEffectRecord;
    try { saved = f.ledger.reserve(f.input()).record; } finally { f.db.prepare = prepare; }
    assert.equal(fired, 1); assert.equal(f.db.inTransaction, false);
    assert.deepEqual(f.ledger.snapshot(), [saved]);
  } finally { f.dispose(); }
});

test("metadata and rows stay in one snapshot even if another connection deletes rows and changes pins mid-read", () => {
  const f = fixture(); try {
    const a = f.ledger.reserve(f.input()).record, prepare = f.db.prepare.bind(f.db); let fired = 0;
    f.db.prepare = ((sql: string) => {
      const stmt = prepare(sql);
      if (sql.includes("FROM candidate_effect_meta LIMIT 2") && f.db.inTransaction && !fired) {
        const all = stmt.all.bind(stmt);
        stmt.all = (...args: unknown[]) => {
          const rows = all(...args); fired++;
          f.other.transaction(() => { f.other.exec("DELETE FROM candidate_effect_operations");
            f.other.prepare("UPDATE candidate_effect_meta SET store_id=?").run(randomUUID()); }).immediate();
          return rows;
        };
      }
      return stmt;
    }) as typeof f.db.prepare;
    try { assert.deepEqual(f.ledger.snapshot(), [a]); } finally { f.db.prepare = prepare; }
    assert.equal(fired, 1); denies(() => f.ledger.snapshot(), "identity-mismatch");
  } finally { f.dispose(); }
});

test("complete maximum 1000-row completed inventory composes with checkpoint digest; 1001 denies without truncation", () => {
  const f = fixture(); try {
    // Direct insertion is synthetic fixture setup, not forged provenance evidence.
    f.db.transaction(() => { for (let i = 0; i < CANDIDATE_EFFECT_MAX_OPERATIONS; i++) insert(f.db, record(f.input(i + 100), true)); }).immediate();
    const snapshot = f.ledger.snapshot(); assert.equal(snapshot.length, CANDIDATE_EFFECT_MAX_OPERATIONS);
    assert.equal(f.ledger.listBlocked().length, 0, "spent history cannot be recovered from blockers");
    assert.ok(snapshot.every(r => Buffer.byteLength(canonicalJson(r)) <= CANDIDATE_EFFECT_MAX_RECORD_BYTES));
    const pins = { installationId: randomUUID(), namespaceId: f.namespaceId, storeId: f.storeId };
    const inventory = syntheticCheckpointInventory(snapshot, pins);
    assert.equal(inventory.operationCount, 1000); assert.equal(inventory.entries.length, 1000);
    assert.equal(syntheticCheckpointInventory(f.ledger.snapshot(), pins).inventoryRootDigest, inventory.inventoryRootDigest);
    insert(f.db, record(f.input(2000))); denies(() => f.ledger.snapshot(), "limit-exceeded");
    assert.equal(f.db.inTransaction, false);
  } finally { f.dispose(); }
});

for (const corruption of ["json", "oversize", "blob", "digest", "blocked", "store", "missing-parent"] as const)
test(`snapshot rejects whole inventory on ${corruption} corruption, never returning partial rows`, () => {
  const f = fixture(); try {
    const a = record(f.input(1), true), b = record(f.input(2)); insert(f.db, a); insert(f.db, b);
    if (corruption === "missing-parent") {
      insert(f.db, record({ ...a.intent, kind: "publish", operationId: randomUUID(), approvalId: randomUUID(),
        executionOperationId: a.intent.operationId, resultDigest: d(11) }));
      f.db.prepare("DELETE FROM candidate_effect_operations WHERE operation_id=?").run(a.intent.operationId);
    } else if (corruption === "store") {
      const changed = record({ ...b.intent, storeId: randomUUID() });
      f.db.prepare("UPDATE candidate_effect_operations SET record_json=?,record_digest=? WHERE operation_id=?")
        .run(canonicalJson(changed), canonicalSha256Digest(changed), b.intent.operationId);
    } else {
      if (corruption === "oversize") f.db.pragma("ignore_check_constraints=ON");
      const column = corruption === "digest" ? "record_digest" : corruption === "blocked" ? "blocked" : "record_json";
      const value = corruption === "digest" ? d(99) : corruption === "blocked" ? 0
        : corruption === "oversize" ? "x".repeat(CANDIDATE_EFFECT_MAX_RECORD_BYTES + 1)
        : corruption === "blob" ? Buffer.from(canonicalJson(b)) : "{}";
      f.db.prepare(`UPDATE candidate_effect_operations SET ${column}=? WHERE operation_id=?`).run(value, b.intent.operationId);
      if (corruption === "oversize") f.db.pragma("ignore_check_constraints=OFF");
    }
    denies(() => f.ledger.snapshot(), corruption === "store" ? "identity-mismatch" : "state-invalid");
    assert.equal(f.db.inTransaction, false);
  } finally { f.dispose(); }
});

test("snapshot denies nested transactions, attached/temp schema and durability drift without normalizing them", () => {
  const f = fixture(); try {
    f.db.exec("BEGIN"); denies(() => f.ledger.snapshot(), "transaction-active"); assert.equal(f.db.inTransaction, true); f.db.exec("ROLLBACK");
    f.db.pragma("synchronous=NORMAL"); denies(() => f.ledger.snapshot(), "durability-invalid");
    assert.equal(f.db.pragma("synchronous", { simple: true }), 1); f.db.pragma("synchronous=FULL");
    f.db.exec("ATTACH ':memory:' AS extra"); denies(() => f.ledger.snapshot(), "schema-invalid"); f.db.exec("DETACH extra");
    f.db.exec("CREATE TEMP TABLE unrelated(x)"); denies(() => f.ledger.snapshot(), "schema-invalid"); f.db.exec("DROP TABLE temp.unrelated");
    assert.deepEqual(f.ledger.snapshot(), []);
    f.db.close(); denies(() => f.ledger.snapshot(), "storage-unavailable");
  } finally { f.dispose(); }
});

test("snapshot read failure releases the read transaction and allows later safe discovery, without a write or clock", () => {
  const f = fixture(); try {
    const a = f.ledger.reserve(f.input()).record, calls = f.clockCalls, prepare = f.db.prepare.bind(f.db); let fired = 0;
    f.db.prepare = ((sql: string) => {
      if (sql.includes("FROM candidate_effect_operations ORDER BY operation_id LIMIT 1001")) {
        assert.equal(f.db.inTransaction, true); fired++; throw new Error("synthetic-private-read-fault");
      } return prepare(sql);
    }) as typeof f.db.prepare;
    try { denies(() => f.ledger.snapshot(), "storage-unavailable"); } finally { f.db.prepare = prepare; }
    assert.equal(fired, 1); assert.equal(f.db.inTransaction, false); assert.equal(f.clockCalls, calls);
    assert.deepEqual(f.ledger.snapshot(), [a]);
  } finally { f.dispose(); }
});

test("coherent terminal deletion is visible only as a changed complete inventory, not authenticated by snapshot alone", () => {
  const f = fixture(); try {
    const a = record(f.input(), true); insert(f.db, a);
    const pins = { installationId: randomUUID(), namespaceId: f.namespaceId, storeId: f.storeId };
    const before = syntheticCheckpointInventory(f.ledger.snapshot(), pins);
    f.other.exec("DELETE FROM candidate_effect_operations");
    const after = syntheticCheckpointInventory(f.ledger.snapshot(), pins);
    assert.equal(before.operationCount, 1); assert.equal(after.operationCount, 0);
    assert.notEqual(before.inventoryRootDigest, after.inventoryRootDigest);
    assert.deepEqual(f.ledger.snapshot(), [], "SQLite cannot know deleted history without independently retained anchor");
  } finally { f.dispose(); }
});
