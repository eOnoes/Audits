import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import test from "node:test";
import Database from "better-sqlite3";
import { canonicalJson, canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import { initializeCandidateEffectLedger, SqliteCandidateEffectLedger } from "../../src/build-only/windows-candidate-effect-ledger.js";
import { CANDIDATE_EFFECT_DOMAIN, CANDIDATE_EFFECT_MAX_OPERATIONS, CandidateEffectError, advanceCandidateEffectRecord, effectApprovalIdentity,
  candidateEffectBlocked, candidateEffectState, validateCandidateEffectRecord } from "../../src/build-only/windows-candidate-effect-state.js";
import type { CandidateEffectIntent, CandidateEffectRecord, CandidateEffectAdvance } from "../../src/build-only/windows-candidate-effect-state.js";

const NOW = "2026-09-13T12:00:00.000Z", EXPIRES = "2026-09-13T12:05:00.000Z";
const d = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`;
function intent(namespaceId: string, storeId: string): CandidateEffectIntent {
  return { schemaVersion: CANDIDATE_EFFECT_DOMAIN, namespaceId, storeId, operationId: randomUUID(), workflowId: randomUUID(), approvalId: randomUUID(),
    kind: "execute", workspaceDigest: d(1), policyBindingDigest: d(2), candidateDigest: d(3), reviewMaterialDigest: d(4),
    sourceManifestDigest: d(5), requestDigest: d(6), guestImageDigest: d(7), guestGeneration: randomUUID(),
    controllerIdentityDigest: d(8), resourcePolicyDigest: d(9), expiresAt: EXPIRES };
}
function fixture(namespaceId = randomUUID()) {
  const parent = resolve(tmpdir()), dir = mkdtempSync(join(parent, "onoes-candidate-effect-")), path = join(dir, "state.sqlite");
  const handles: Database.Database[] = [], db = new Database(path); handles.push(db);
  const storeId = initializeCandidateEffectLedger(db, namespaceId);
  let time = NOW;
  const clock = () => { assert.equal(db.inTransaction, false, "injected clock outside transaction"); return time; };
  const store = new SqliteCandidateEffectLedger(db, storeId, namespaceId, clock);
  const reopen = () => { const connection = new Database(path, { fileMustExist: true }); handles.push(connection);
    return new SqliteCandidateEffectLedger(connection, storeId, namespaceId, () => time); };
  return { db, store, storeId, namespaceId, path, reopen, setTime(t: string) { time = t; }, dispose() {
    for (const h of handles) if (h.open) h.close();
    const target = resolve(dir); assert.equal(dirname(target), parent); assert.ok(/^onoes-candidate-effect-[a-zA-Z0-9]+$/.test(basename(target)));
    rmSync(target, { recursive: true, force: true });
  } };
}
function denies(fn: () => unknown, reason: string) { assert.throws(fn, (e: unknown) => e instanceof CandidateEffectError && e.reason === reason); }
function event(record: CandidateEffectRecord, state: CandidateEffectAdvance["state"], passed = true): CandidateEffectAdvance {
  return { operationId: record.intent.operationId, intentDigest: record.intentDigest, state, evidenceDigest: d(20),
    resultDigest: state === "result-and-stop-observed" ? d(30) : null,
    verificationPassed: state === "result-and-stop-observed" ? passed : null };
}
function completed(f: ReturnType<typeof fixture>, input = intent(f.namespaceId, f.storeId), passed = true) {
  let r = f.store.reserve(input).record;
  for (const state of ["source-delivery-possible", "launch-possible", "result-and-stop-observed", passed ? "completed" : "failed"] as const)
    r = f.store.advance(event(r, state, passed)).record;
  return r;
}
function publication(r: CandidateEffectRecord): CandidateEffectIntent {
  return { ...r.intent, kind: "publish", operationId: randomUUID(), approvalId: randomUUID(), executionOperationId: r.intent.operationId, resultDigest: d(30) };
}

test("execution and separately approved publication preserve exact intent and immutable observation across cold reopen", () => {
  const f = fixture(); try {
    const original = intent(f.namespaceId, f.storeId), r = completed(f, original), publish = publication(r);
    assert.equal(f.store.listBlocked().length, 0); assert.ok(Object.isFrozen(r.events));
    const p = f.store.reserve(publish); assert.equal(p.kind, "recorded-state-not-effect-permission");
    const possible = f.store.advance(event(p.record, "publication-possible"));
    const terminal = f.store.advance(event(possible.record, "completed"));
    assert.equal(candidateEffectBlocked(terminal.record), false);
    f.db.close(); const reopened = f.reopen();
    assert.deepEqual(reopened.read(r.intent.operationId), r);
    assert.deepEqual(reopened.read(publish.operationId), terminal.record);
    assert.equal(reopened.reserve(original).disposition, "replayed");
    assert.equal(reopened.advance(event(possible.record, "publication-possible")).disposition, "replayed");
    assert.equal(reopened.listBlocked().length, 0);
  } finally { f.dispose(); }
});

test("one enrolled store enforces namespace approval uniqueness across workflows and execute/publish; keys cannot be appended", () => {
  const f = fixture(); try {
    const r = completed(f), original = r.intent;
    denies(() => f.store.reserve({ ...intent(f.namespaceId, f.storeId), approvalId: original.approvalId }), "approval-reused");
    denies(() => f.store.reserve({ ...publication(r), approvalId: original.approvalId }), "approval-reused");
    denies(() => f.store.reserve({ ...original, approvalId: randomUUID() }), "intent-conflict");
    denies(() => f.store.reserve({ ...original, operationId: randomUUID(), approvalId: randomUUID() }), "workflow-reused");
    denies(() => f.store.reserve({ ...original, keyId: "rotation-alias" }), "input-invalid");
    denies(() => f.store.reserve({ ...original, namespaceId: randomUUID() }), "identity-mismatch");
  } finally { f.dispose(); }
});

test("publication requires a passed completed parent and exact complete subject, never bare result digest", () => {
  const f = fixture(); try {
    const unverified = f.store.reserve(intent(f.namespaceId, f.storeId)).record;
    denies(() => f.store.reserve(publication(unverified)), "workspace-blocked");
    denies(() => f.store.reserve({ ...publication(unverified), workspaceDigest: d(90) }), "execution-unverified");
    const r = completed(f, { ...intent(f.namespaceId, f.storeId), workspaceDigest: d(91) });
    for (const key of ["candidateDigest", "reviewMaterialDigest", "sourceManifestDigest", "requestDigest", "guestImageDigest",
      "controllerIdentityDigest", "policyBindingDigest", "resourcePolicyDigest", "resultDigest"])
      denies(() => f.store.reserve({ ...publication(r), [key]: d(99) }), "execution-unverified");
    denies(() => f.store.reserve({ ...publication(r), guestGeneration: randomUUID() }), "execution-unverified");
    const failed = completed(f, { ...intent(f.namespaceId, f.storeId), workspaceDigest: d(92) }, false);
    denies(() => f.store.reserve(publication(failed)), "execution-unverified");
  } finally { f.dispose(); }
});

test("terminal quarantine remains absorbing and blocks a fresh workflow after restart", () => {
  const f = fixture(); try {
    const r = f.store.reserve(intent(f.namespaceId, f.storeId)).record;
    const q = f.store.advance(event(r, "quarantined")).record;
    assert.equal(candidateEffectBlocked(q), true);
    f.db.close(); const reopened = f.reopen();
    assert.deepEqual(reopened.listBlocked(), [q]);
    denies(() => reopened.reserve(intent(f.namespaceId, f.storeId)), "workspace-blocked");
    denies(() => reopened.advance(event(q, "completed")), "transition-denied");
    denies(() => reopened.advance(event(q, "cancelled")), "transition-denied");
    assert.equal(reopened.advance(event(q, "quarantined")).disposition, "replayed");
  } finally { f.dispose(); }
});

test("pure state graph rejects skipped effects, contradictory results and restoration of execution", () => {
  const f = fixture(); try {
    let r = f.store.reserve(intent(f.namespaceId, f.storeId)).record;
    for (const state of ["launch-possible", "result-and-stop-observed", "completed", "failed", "restored", "publication-possible"] as const)
      denies(() => advanceCandidateEffectRecord(r, event(r, state), NOW), "transition-denied");
    r = f.store.advance(event(r, "source-delivery-possible")).record;
    denies(() => f.store.advance(event(r, "cancelled")), "transition-denied");
    r = f.store.advance(event(r, "launch-possible")).record;
    denies(() => f.store.advance({ ...event(r, "result-and-stop-observed"), resultDigest: null }), "transition-denied");
    r = f.store.advance(event(r, "result-and-stop-observed", false)).record;
    denies(() => f.store.advance(event(r, "completed")), "transition-denied");
    assert.equal(candidateEffectState(f.store.advance(event(r, "failed")).record), "failed");
  } finally { f.dispose(); }
});

test("caller mutation, getters, forged history and divergent event replay fail without extra state", () => {
  const f = fixture(); try {
    const input = intent(f.namespaceId, f.storeId), r = f.store.reserve(input).record;
    input.candidateDigest = d(99); assert.notEqual(r.intent.candidateDigest, input.candidateDigest);
    let getter = false;
    const evil = { ...intent(f.namespaceId, f.storeId), get approvalId() { getter = true; throw new Error("private-test-message"); } };
    denies(() => f.store.reserve(evil), "input-invalid"); assert.equal(getter, false);
    let traps = 0;
    const proxy = new Proxy(intent(f.namespaceId, f.storeId), { getPrototypeOf() { traps++; return Object.prototype; },
      get() { traps++; return undefined; }, ownKeys() { traps++; return []; } });
    denies(() => f.store.reserve(proxy), "input-invalid");
    denies(() => f.store.reserve({ ...intent(f.namespaceId, f.storeId), extra: proxy }), "input-invalid");
    assert.equal(traps, 0);
    denies(() => validateCandidateEffectRecord({ ...r, intentDigest: d(90) }), "state-invalid");
    denies(() => f.store.advance({ ...event(r, "cancelled"), intentDigest: d(91) }), "intent-conflict");
    const done = f.store.advance(event(r, "cancelled"));
    denies(() => f.store.advance({ ...event(r, "cancelled"), evidenceDigest: d(92) }), "intent-conflict");
    assert.deepEqual(f.store.read(r.intent.operationId), done.record);
  } finally { f.dispose(); }
});

for (const marker of ["source-delivery-possible", "launch-possible"] as const)
test(`v2 no-result stop after ${marker} cannot become failure/cancellation or release a workspace`, () => {
  // CC-B-01 regression of the EXISTING boundary, not a simulated authentic stop.
  // A future host must not invent a result merely to get a releasing terminal.
  const f = fixture(); try {
    let r = f.store.reserve(intent(f.namespaceId, f.storeId)).record;
    r = f.store.advance(event(r, "source-delivery-possible")).record;
    if (marker === "launch-possible") r = f.store.advance(event(r, marker)).record;
    const before = canonicalJson(r);
    for (const state of ["failed", "cancelled", "completed", "restored"] as const) {
      denies(() => f.store.advance(event(r, state)), "transition-denied");
      assert.equal(canonicalJson(f.store.read(r.intent.operationId)), before);
    }
    denies(() => f.store.advance({ ...event(r, "result-and-stop-observed", false), resultDigest: null }), "transition-denied");
    assert.equal(canonicalJson(f.store.read(r.intent.operationId)), before);
    const q = f.store.advance(event(r, "quarantined")).record;
    f.db.close(); const reopened = f.reopen();
    assert.deepEqual(reopened.listBlocked(), [q]);
    assert.equal(reopened.reserve(r.intent).disposition, "replayed");
    denies(() => reopened.advance(event(q, "failed")), "transition-denied");
    denies(() => reopened.advance(event(q, "cancelled")), "transition-denied");
    denies(() => reopened.reserve(intent(f.namespaceId, f.storeId)), "workspace-blocked");
    denies(() => reopened.reserve(publication(q)), "workspace-blocked");
    assert.equal(candidateEffectBlocked(q), true);
  } finally { f.dispose(); }
});

test("expiry denies new effects but does not prevent recording stop/failure; cross-operation clock regression denies", () => {
  const f = fixture(); try {
    let r = f.store.reserve(intent(f.namespaceId, f.storeId)).record;
    r = f.store.advance(event(r, "source-delivery-possible")).record;
    r = f.store.advance(event(r, "launch-possible")).record;
    f.setTime(EXPIRES);
    r = f.store.advance(event(r, "result-and-stop-observed", false)).record;
    f.store.advance(event(r, "failed"));
    denies(() => f.store.reserve(intent(f.namespaceId, f.storeId)), "expired");
    f.setTime(NOW); denies(() => f.store.reserve(intent(f.namespaceId, f.storeId)), "clock-invalid");
    f.setTime("invalid"); denies(() => f.store.reserve(intent(f.namespaceId, f.storeId)), "clock-invalid");
    assert.equal(f.store.read(r.intent.operationId)?.events.at(-1)?.state, "failed");
  } finally { f.dispose(); }
});

test("reached expiry before transfer refuses delivery marker and permits cancellation only", () => {
  const f = fixture(); try {
    const r = f.store.reserve(intent(f.namespaceId, f.storeId)).record; f.setTime(EXPIRES);
    denies(() => f.store.advance(event(r, "source-delivery-possible")), "expired");
    assert.equal(f.store.advance(event(r, "cancelled")).record.events.length, 1);
  } finally { f.dispose(); }
});

function loseCommitResponse(db: Database.Database): () => void {
  const original = db.transaction.bind(db);
  let fired = 0;
  db.transaction = ((fn: (...args: unknown[]) => unknown) => {
    const tx = original(fn), immediate = tx.immediate;
    // better-sqlite3's function properties are non-writable. Wrap rather than
    // accidentally throwing while installing a fault BEFORE the transaction.
    return Object.assign((...args: unknown[]) => tx(...args), { database: db, default: tx.default,
      deferred: tx.deferred, exclusive: tx.exclusive, immediate: (...args: unknown[]) => {
        immediate(...args); assert.equal(db.inTransaction, false); fired++;
        throw new Error("synthetic-after-commit-response-loss");
      } });
  }) as typeof db.transaction;
  return () => { db.transaction = original; assert.equal(fired, 1, "fault must fire exactly AFTER real COMMIT"); };
}
for (const seam of ["reservation", "possible-effect", "terminal"] as const) test(`${seam} COMMIT response loss persists once, poisons writes and recovers by exact read`, () => {
  const f = fixture(); try {
    const input = intent(f.namespaceId, f.storeId);
    const before = seam === "reservation" ? undefined : f.store.reserve(input).record;
    const transition = before && event(before, seam === "terminal" ? "cancelled" : "source-delivery-possible");
    const restore = loseCommitResponse(f.db);
    try { denies(() => transition ? f.store.advance(transition) : f.store.reserve(input), "storage-unavailable"); }
    finally { restore(); }
    denies(() => f.store.reserve(input), "write-poisoned");
    const stored = f.store.read(input.operationId)!; assert.ok(stored);
    f.db.close(); const reopened = f.reopen();
    assert.deepEqual(reopened.read(input.operationId), stored);
    assert.equal((transition ? reopened.advance(transition) : reopened.reserve(input)).disposition, "replayed");
    assert.equal(reopened.read(input.operationId)!.events.length, seam === "reservation" ? 0 : 1);
  } finally { f.dispose(); }
});

test("post-commit read-back fault retains record and poisons rather than compensating", () => {
  const f = fixture(); try {
    const original = f.db.prepare.bind(f.db), input = intent(f.namespaceId, f.storeId);
    let scans = 0, fired = 0;
    f.db.prepare = ((sql: string) => {
      if (sql.includes("FROM candidate_effect_operations ORDER BY operation_id LIMIT 1001") && ++scans === 2) {
        assert.equal(original("SELECT count(*) FROM candidate_effect_operations").pluck().get(), 1);
        fired++; throw new Error("synthetic-readback-loss");
      }
      return original(sql);
    }) as typeof f.db.prepare;
    try { denies(() => f.store.reserve(input), "storage-unavailable"); }
    finally { f.db.prepare = original; }
    assert.equal(fired, 1); assert.equal(scans, 2, "fault must follow write scan and COMMIT");
    assert.ok(f.store.read(input.operationId)); denies(() => f.store.reserve(input), "write-poisoned");
    assert.equal(f.reopen().reserve(input).disposition, "replayed");
  } finally { f.dispose(); }
});

test("malformed row fails whole discovery; rehashed forged transitions and blocker columns cannot clear quarantine", () => {
  const f = fixture(); try {
    const r = f.store.reserve(intent(f.namespaceId, f.storeId)).record;
    const q = f.store.advance(event(r, "quarantined")).record;
    f.db.prepare("UPDATE candidate_effect_operations SET blocked=0").run();
    denies(() => f.store.listBlocked(), "state-invalid");
    f.db.prepare("UPDATE candidate_effect_operations SET blocked=1").run();
    const forged = { ...q, events: [{ ...q.events[0]!, state: "completed" }] };
    f.db.prepare("UPDATE candidate_effect_operations SET record_json=?,record_digest=?").run(canonicalJson(forged), canonicalSha256Digest(forged));
    denies(() => f.store.read(r.intent.operationId), "state-invalid");
    f.db.exec("PRAGMA ignore_check_constraints=ON");
    f.db.prepare("UPDATE candidate_effect_operations SET record_json=?").run("x".repeat(40_000));
    f.db.exec("PRAGMA ignore_check_constraints=OFF");
    denies(() => f.store.listBlocked(), "state-invalid");
  } finally { f.dispose(); }
});

test("missing/wrong schema, namespace, store identity, nested transaction and durability drift deny", () => {
  const f = fixture(); try {
    denies(() => new SqliteCandidateEffectLedger(f.db, randomUUID(), f.namespaceId), "identity-mismatch");
    denies(() => new SqliteCandidateEffectLedger(f.db, f.storeId, randomUUID()), "identity-mismatch");
    denies(() => initializeCandidateEffectLedger(f.db, f.namespaceId), "schema-invalid");
    f.db.exec("BEGIN"); denies(() => f.store.listBlocked(), "transaction-active"); f.db.exec("ROLLBACK");
    f.db.pragma("synchronous=NORMAL"); denies(() => f.store.listBlocked(), "durability-invalid"); f.db.pragma("synchronous=FULL");
    f.db.exec("CREATE TEMP TABLE unrelated(x)"); denies(() => f.store.listBlocked(), "schema-invalid");
    f.db.exec("DROP TABLE temp.unrelated; DROP INDEX candidate_effect_workspace_lock");
    denies(() => f.store.listBlocked(), "schema-invalid");
    const empty = new Database(":memory:"); try { denies(() => new SqliteCandidateEffectLedger(empty, f.storeId, f.namespaceId), "schema-invalid"); }
    finally { empty.close(); }
  } finally { f.dispose(); }
});

test("maximum lifetime quota denies without pruning and SQL-side scan catches an over-limit store", () => {
  const f = fixture(); try {
    const insert = f.db.prepare("INSERT INTO candidate_effect_operations VALUES (?,?,?,?,?,?,?,?)");
    // Populate real valid rows efficiently; reserve() and read() must still
    // validate every row and apply their own hard ceiling, not trust the fixture.
    const seed = (n: number) => {
      const input = { ...intent(f.namespaceId, f.storeId), workspaceDigest: d(n + 100) };
      const record = validateCandidateEffectRecord({ intent: input, intentDigest: canonicalSha256Digest(input),
        approvalIdentityDigest: effectApprovalIdentity(input), reservedAt: NOW, events: [] });
      insert.run(input.operationId, record.approvalIdentityDigest, input.workflowId, input.kind,
        input.workspaceDigest, 1, canonicalJson(record), canonicalSha256Digest(record));
    };
    f.db.transaction(() => { for (let n = 0; n < CANDIDATE_EFFECT_MAX_OPERATIONS; n++) seed(n); }).immediate();
    assert.equal(f.store.listBlocked().length, CANDIDATE_EFFECT_MAX_OPERATIONS);
    denies(() => f.store.reserve(intent(f.namespaceId, f.storeId)), "limit-exceeded");
    seed(CANDIDATE_EFFECT_MAX_OPERATIONS);
    denies(() => f.store.listBlocked(), "limit-exceeded");
  } finally { f.dispose(); }
});

test("abrupt separate process exit after possible-effect COMMIT retains blocker and cannot redispatch on reopen", () => {
  const f = fixture(); try {
    const r = f.store.reserve(intent(f.namespaceId, f.storeId)).record, next = event(r, "source-delivery-possible");
    f.db.close();
    const child = spawnSync(process.execPath, [fileURLToPath(new URL("../helpers/candidate-effect-crash.js", import.meta.url)),
      JSON.stringify({ path: f.path, storeId: f.storeId, namespaceId: f.namespaceId, event: next })],
    { encoding: "utf8", timeout: 10_000, maxBuffer: 16_384, windowsHide: true });
    assert.ifError(child.error); assert.equal(child.status, 23); assert.equal(child.stderr, "");
    const reopened = f.reopen();
    assert.equal(reopened.read(r.intent.operationId)!.events.length, 1);
    assert.equal(reopened.advance(next).disposition, "replayed");
    denies(() => reopened.reserve(intent(f.namespaceId, f.storeId)), "workspace-blocked");
  } finally { f.dispose(); }
});

for (const same of [true, false]) test(`two independent worker connections start together for ${same ? "identical approval" : "same workspace"}: outcome consistency, not proof of contention`, { timeout: 15_000 }, async () => {
  const f = fixture(), workers: Worker[] = []; try {
    const first = intent(f.namespaceId, f.storeId), barrier = new SharedArrayBuffer(4);
    const inputs = [first, same ? first : intent(f.namespaceId, f.storeId)];
    let ready = 0;
    const promises = inputs.map(input => new Promise<string>((resolveResult, reject) => {
      const worker = new Worker(new URL("../helpers/candidate-effect-racer.js", import.meta.url), {
        workerData: { path: f.path, storeId: f.storeId, namespaceId: f.namespaceId, intent: input, barrier } });
      workers.push(worker); let result: string | undefined;
      worker.on("message", (message: { ready?: boolean; result?: string }) => {
        if (message.ready && ++ready === 2) { Atomics.store(new Int32Array(barrier), 0, 1); Atomics.notify(new Int32Array(barrier), 0); }
        if (message.result) result = message.result;
      });
      worker.on("error", reject); worker.on("exit", code => code === 0 && result ? resolveResult(result) : reject(new Error("race-worker-failed")));
    }));
    const results = await Promise.all(promises);
    // One positive winner is mandatory. The other connection may exhaust its
    // unchanged 250 ms lock budget; this is not permission to retry an effect.
    assert.equal(results.filter(result => result === "recorded").length, 1);
    const winner = results.indexOf("recorded"), loser = 1 - winner;
    assert.ok([same ? "replayed" : "workspace-blocked", "storage-unavailable"].includes(results[loser]!));
    const rows = f.reopen().listBlocked();
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]!.intent, inputs[winner]);
    assert.equal(rows[0]!.events.length, 0);
    assert.equal(f.db.prepare("SELECT count(*) FROM candidate_effect_operations").pluck().get(), 1);
    if (!same) assert.equal(f.store.read(inputs[loser]!.operationId), undefined);
    assert.equal(f.store.reserve(inputs[winner]).disposition, "replayed");
  } finally { await Promise.all(workers.map(w => w.terminate())); f.dispose(); }
});

test("held SQLite IMMEDIATE lock forces observed SQLITE_BUSY and denies ledger write until explicit release", { timeout: 15_000 }, async () => {
  const f = fixture(), barrier = new SharedArrayBuffer(4), gate = new Int32Array(barrier);
  const input = intent(f.namespaceId, f.storeId);
  const worker = new Worker(new URL("../helpers/candidate-effect-contention.js", import.meta.url), {
    workerData: { path: f.path, storeId: f.storeId, namespaceId: f.namespaceId, intent: input, barrier } });
  let failures = 0, afterRelease: string | undefined;
  try {
    await new Promise<void>((resolveDone, reject) => {
      worker.on("error", reject);
      worker.on("message", (message: { ready?: boolean; sqliteCode?: string; ledgerReason?: string; afterRelease?: string }) => {
        try {
          if (message.ready) {
            f.db.exec("BEGIN IMMEDIATE"); assert.equal(f.db.inTransaction, true);
            Atomics.store(gate, 0, 1); Atomics.notify(gate, 0);
          } else if (message.sqliteCode) {
            assert.equal(f.db.inTransaction, true, "parent must still own write lock");
            assert.equal(message.sqliteCode, "SQLITE_BUSY"); assert.equal(message.ledgerReason, "storage-unavailable");
            assert.equal(f.db.prepare("SELECT count(*) FROM candidate_effect_operations").pluck().get(), 0);
            failures++; f.db.exec("ROLLBACK"); Atomics.store(gate, 0, 2); Atomics.notify(gate, 0);
          } else if (message.afterRelease) { afterRelease = message.afterRelease; }
        } catch (error) { reject(error); }
      });
      // Node 24.14 guarantees Worker messages are emitted before its exit event:
      // https://nodejs.org/download/release/v24.14.0/docs/api/worker_threads.html#event-message_1
      worker.on("exit", code => code === 0 ? resolveDone() : reject(new Error("contention-worker-failed")));
    });
    assert.equal(failures, 1); assert.equal(afterRelease, "recorded");
    assert.equal(f.store.listBlocked().length, 1);
    assert.equal(f.store.reserve(input).disposition, "replayed");
  } finally {
    if (f.db.inTransaction) f.db.exec("ROLLBACK");
    Atomics.store(gate, 0, 2); Atomics.notify(gate, 0); await worker.terminate(); f.dispose();
  }
});

test("v2 binds store identity, keeps historical approval identity and rejects v1 inputs", () => {
  const f = fixture(); try {
    const input = intent(f.namespaceId, f.storeId);
    const legacy = { ...input, schemaVersion: "agent-candidate-effect-ledger/v1" };
    denies(() => f.store.reserve(legacy), "input-invalid");
    const { storeId: omitted, ...missing } = input; assert.ok(omitted);
    denies(() => f.store.reserve(missing), "input-invalid");
    const alternate = { ...input, storeId: randomUUID() };
    denies(() => f.store.reserve(alternate), "identity-mismatch");
    assert.equal(effectApprovalIdentity(input), canonicalSha256Digest({
      domain: "agent-candidate-effect-ledger/v1", namespaceId: input.namespaceId, approvalId: input.approvalId }));
    assert.equal(effectApprovalIdentity(input), effectApprovalIdentity(alternate));
    assert.notEqual(canonicalSha256Digest(input), canonicalSha256Digest(alternate));
    assert.equal(f.store.listBlocked().length, 0);
    const saved = f.store.reserve(input).record;
    assert.equal(saved.intent.storeId, f.storeId);
    assert.equal(saved.intentDigest, canonicalSha256Digest(input));
  } finally { f.dispose(); }
});

test("overriding public read cannot substitute post-COMMIT integrity read-back", () => {
  const f = fixture(); try {
    const input = intent(f.namespaceId, f.storeId); let overridden = 0;
    f.store.read = () => { overridden++; throw new Error("public-read-must-not-run"); };
    const result = f.store.reserve(input);
    assert.equal(overridden, 0); assert.equal(result.record.intent.operationId, input.operationId);
    assert.deepEqual(f.reopen().read(input.operationId), result.record);
    assert.equal(Reflect.ownKeys(f.store).includes("db"), false);
    assert.equal(Reflect.ownKeys(f.store).includes("storeId"), false);
  } finally { f.dispose(); }
});

test("legacy v1 schema is refused without migration, adoption or rewriting", () => {
  const f = fixture(), legacy = new Database(":memory:"); try {
    const definitions = f.db.prepare("SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name").all() as { sql: string }[];
    for (const definition of definitions) legacy.exec(definition.sql.replace("version = 2", "version = 1"));
    legacy.prepare("INSERT INTO candidate_effect_meta VALUES (1,1,?,?)").run(f.storeId, f.namespaceId);
    const before = legacy.prepare("SELECT name,sql FROM sqlite_schema ORDER BY name").all();
    denies(() => new SqliteCandidateEffectLedger(legacy, f.storeId, f.namespaceId), "schema-invalid");
    assert.deepEqual(legacy.prepare("SELECT name,sql FROM sqlite_schema ORDER BY name").all(), before);
    assert.equal(legacy.prepare("SELECT version FROM candidate_effect_meta").pluck().get(), 1);
  } finally { legacy.close(); f.dispose(); }
});

test("oversized passive input and event-count overflow deny without writing", () => {
  const f = fixture(); try {
    denies(() => f.store.reserve({ ...intent(f.namespaceId, f.storeId), extra: "x".repeat(32_769) }), "input-invalid");
    const r = f.store.reserve(intent(f.namespaceId, f.storeId)).record;
    const e = { ...event(r, "quarantined"), recordedAt: NOW };
    denies(() => validateCandidateEffectRecord({ ...r, events: Array.from({ length: 7 }, () => ({ ...e })) }), "state-invalid");
    assert.deepEqual(f.store.read(r.intent.operationId), r);
  } finally { f.dispose(); }
});

test("verbatim passed execution transplanted into a same-namespace store denies read, write and publication across reopen", () => {
  const a = fixture(), b = fixture(a.namespaceId); try {
    assert.notEqual(a.storeId, b.storeId);
    const parent = completed(a);
    const row = a.db.prepare("SELECT * FROM candidate_effect_operations WHERE operation_id=?").get(parent.intent.operationId) as Record<string, string | number>;
    b.db.prepare("INSERT INTO candidate_effect_operations VALUES (?,?,?,?,?,?,?,?)").run(
      row["operation_id"], row["approval_identity_digest"], row["workflow_id"], row["kind"], row["workspace_digest"], row["blocked"], row["record_json"], row["record_digest"]);
    assert.equal(b.db.prepare("SELECT record_json FROM candidate_effect_operations").pluck().get(), canonicalJson(parent));
    for (const store of [b.store, b.reopen()]) {
      denies(() => store.read(parent.intent.operationId), "identity-mismatch");
      denies(() => store.listBlocked(), "identity-mismatch");
      denies(() => store.reserve({ ...publication(parent), storeId: b.storeId }), "identity-mismatch");
      denies(() => store.advance(event(parent, "completed")), "identity-mismatch");
    }
    assert.equal(b.db.prepare("SELECT count(*) FROM candidate_effect_operations").pluck().get(), 1);
    assert.deepEqual(a.store.read(parent.intent.operationId), parent);
  } finally { a.dispose(); b.dispose(); }
});

// Driver-result corruption seam: rows are read from real SQLite, then one row
// is replaced with individually valid/rehashed duplicate data. This independently
// falsifies application scan checks without claiming physical index corruption.
for (const duplicate of ["approval", "workflow", "workspace", "operation"] as const)
test(`application scan independently rejects cross-row ${duplicate} duplication on every access path`, () => {
  const f = fixture(); try {
    const a = f.store.reserve(intent(f.namespaceId, f.storeId)).record;
    const b = f.store.reserve({ ...intent(f.namespaceId, f.storeId), workspaceDigest: d(75) }).record;
    const altered = { ...b.intent,
      ...(duplicate === "approval" ? { approvalId: a.intent.approvalId } : {}),
      ...(duplicate === "workflow" ? { workflowId: a.intent.workflowId } : {}),
      ...(duplicate === "workspace" ? { workspaceDigest: a.intent.workspaceDigest } : {}),
      ...(duplicate === "operation" ? { operationId: a.intent.operationId } : {}) };
    const forged = validateCandidateEffectRecord({ ...b, intent: altered,
      intentDigest: canonicalSha256Digest(altered), approvalIdentityDigest: effectApprovalIdentity(altered) });
    const original = f.db.prepare.bind(f.db); let corruptScans = 0;
    f.db.prepare = ((sql: string) => {
      const stmt = original(sql);
      if (sql.includes("FROM candidate_effect_operations ORDER BY operation_id LIMIT 1001")) {
        const all = stmt.all.bind(stmt);
        stmt.all = (...args: unknown[]) => {
          const rows = all(...args) as Record<string, unknown>[]; corruptScans++;
          return rows.map(row => row["operation_id"] !== b.intent.operationId ? row : {
            operation_id: altered.operationId, approval_identity_digest: forged.approvalIdentityDigest,
            workflow_id: altered.workflowId, kind: altered.kind, workspace_digest: altered.workspaceDigest,
            blocked: 1, record_json: canonicalJson(forged), record_digest: canonicalSha256Digest(forged) });
        };
      }
      return stmt;
    }) as typeof f.db.prepare;
    try {
      denies(() => f.store.read(a.intent.operationId), "state-invalid");
      denies(() => f.store.listBlocked(), "state-invalid");
      denies(() => f.store.reserve({ ...intent(f.namespaceId, f.storeId), workspaceDigest: d(76) }), "state-invalid");
      denies(() => f.store.advance(event(a, "cancelled")), "state-invalid");
      assert.equal(corruptScans, 4, "each access must reach the corrupted scan");
    } finally { f.db.prepare = original; }
    assert.deepEqual(f.store.listBlocked(), [a, b].sort((x, y) => x.intent.operationId.localeCompare(y.intent.operationId)));
  } finally { f.dispose(); }
});

test("coherent in-store forgery is accepted: negative boundary control, not authenticated evidence", () => {
  const f = fixture(); try {
    const initial = f.store.reserve(intent(f.namespaceId, f.storeId)).record;
    let forged = initial;
    for (const state of ["source-delivery-possible", "launch-possible", "result-and-stop-observed", "completed"] as const)
      forged = advanceCandidateEffectRecord(forged, event(forged, state), NOW);
    assert.equal(f.store.read(initial.intent.operationId)!.events.length, 0);
    f.db.prepare("UPDATE candidate_effect_operations SET blocked=0,record_json=?,record_digest=? WHERE operation_id=?")
      .run(canonicalJson(forged), canonicalSha256Digest(forged), initial.intent.operationId);
    assert.deepEqual(f.reopen().read(initial.intent.operationId), forged);
    assert.equal(f.store.reserve(publication(forged)).kind, "recorded-state-not-effect-permission");
    // This explicit acceptance proves that store binding + hashes do NOT provide
    // authentic observation, protected storage, anti-rollback or effect authority.
  } finally { f.dispose(); }
});

test("coherent cross-store rewrite is accepted: store binding is not authentication", () => {
  const a = fixture(), b = fixture(a.namespaceId); try {
    const original = completed(a), rewrittenIntent = { ...original.intent, storeId: b.storeId };
    const rewritten = validateCandidateEffectRecord({ ...original, intent: rewrittenIntent,
      intentDigest: canonicalSha256Digest(rewrittenIntent) });
    assert.notEqual(rewritten.intentDigest, original.intentDigest);
    assert.equal(rewritten.approvalIdentityDigest, original.approvalIdentityDigest);
    assert.deepEqual(rewritten.events, original.events);
    b.db.prepare("INSERT INTO candidate_effect_operations VALUES (?,?,?,?,?,?,?,?)").run(
      rewrittenIntent.operationId, rewritten.approvalIdentityDigest, rewrittenIntent.workflowId, rewrittenIntent.kind,
      rewrittenIntent.workspaceDigest, Number(candidateEffectBlocked(rewritten)), canonicalJson(rewritten), canonicalSha256Digest(rewritten));
    const reopened = b.reopen();
    assert.deepEqual(reopened.read(original.intent.operationId), rewritten);
    const publish = reopened.reserve(publication(rewritten));
    assert.equal(publish.disposition, "recorded");
    assert.equal(publish.kind, "recorded-state-not-effect-permission");
    assert.deepEqual(a.store.read(original.intent.operationId), original);
    // Deliberately accepted, unlike the verbatim transplant control. No effect,
    // authenticated outcome, protected enrollment or anti-rollback is established.
  } finally { a.dispose(); b.dispose(); }
});

test("two same-namespace stores each accept one approval: sole enrollment is a host obligation", () => {
  const a = fixture(), b = fixture(a.namespaceId); try {
    const input = intent(a.namespaceId, a.storeId), alternate = { ...input, storeId: b.storeId };
    const left = a.store.reserve(input), right = b.store.reserve(alternate);
    assert.notEqual(a.storeId, b.storeId);
    assert.equal(left.disposition, "recorded"); assert.equal(right.disposition, "recorded");
    assert.equal(left.record.approvalIdentityDigest, right.record.approvalIdentityDigest);
    assert.notEqual(left.record.intentDigest, right.record.intentDigest);
    for (const [f, saved] of [[a, left.record], [b, right.record]] as const) {
      const reopened = f.reopen();
      assert.deepEqual(reopened.listBlocked(), [saved]);
      assert.equal(reopened.reserve(saved.intent).disposition, "replayed");
      denies(() => reopened.reserve({ ...saved.intent, operationId: randomUUID(), workflowId: randomUUID() }), "approval-reused");
    }
  } finally { a.dispose(); b.dispose(); }
});

test("new ledger on the same connection clears only instance poison, not durable history", () => {
  const f = fixture(); try {
    const input = intent(f.namespaceId, f.storeId), restore = loseCommitResponse(f.db);
    try { denies(() => f.store.reserve(input), "storage-unavailable"); } finally { restore(); }
    const saved = f.store.read(input.operationId)!; assert.ok(saved);
    denies(() => f.store.reserve(input), "write-poisoned");
    const second = new SqliteCandidateEffectLedger(f.db, f.storeId, f.namespaceId, () => NOW);
    assert.deepEqual(second.listBlocked(), [saved]);
    assert.equal(second.reserve(input).disposition, "replayed");
    denies(() => second.reserve(intent(f.namespaceId, f.storeId)), "workspace-blocked");
    assert.equal(second.reserve({ ...intent(f.namespaceId, f.storeId), workspaceDigest: d(88) }).disposition, "recorded");
    assert.equal(f.db.prepare("SELECT count(*) FROM candidate_effect_operations").pluck().get(), 2);
    denies(() => f.store.reserve(input), "write-poisoned");
  } finally { f.dispose(); }
});

for (const pragma of ["synchronous=NORMAL", "foreign_keys=OFF", "trusted_schema=ON", "busy_timeout=0", "journal_mode=DELETE"])
test(`new ledger normalizes configured pragma on the same connection: ${pragma}`, () => {
  const f = fixture(); try {
    const saved = f.store.reserve(intent(f.namespaceId, f.storeId)).record;
    f.db.pragma(pragma); denies(() => f.store.listBlocked(), "durability-invalid");
    const second = new SqliteCandidateEffectLedger(f.db, f.storeId, f.namespaceId, () => NOW);
    assert.deepEqual(second.listBlocked(), [saved]);
    assert.deepEqual(f.store.read(saved.intent.operationId), saved);
    assert.equal(second.reserve(saved.intent).disposition, "replayed");
  } finally { f.dispose(); }
});

test("constructor does not normalize ignore_check_constraints drift", () => {
  const f = fixture(); try {
    f.db.pragma("ignore_check_constraints=ON");
    denies(() => new SqliteCandidateEffectLedger(f.db, f.storeId, f.namespaceId, () => NOW), "durability-invalid");
    assert.equal(f.db.pragma("ignore_check_constraints", { simple: true }), 1);
  } finally { f.dispose(); }
});

test("v1 record inside intact v2 schema denies all access without rewriting", () => {
  const f = fixture(); try {
    const saved = f.store.reserve(intent(f.namespaceId, f.storeId)).record;
    const { storeId: omitted, ...oldIntent } = saved.intent; assert.ok(omitted);
    const legacyIntent = { ...oldIntent, schemaVersion: "agent-candidate-effect-ledger/v1" };
    const legacy = { ...saved, intent: legacyIntent, intentDigest: canonicalSha256Digest(legacyIntent) };
    const wire = canonicalJson(legacy);
    f.db.prepare("UPDATE candidate_effect_operations SET record_json=?,record_digest=?").run(wire, canonicalSha256Digest(legacy));
    for (const store of [f.store, f.reopen()]) {
      denies(() => store.read(saved.intent.operationId), "state-invalid");
      denies(() => store.listBlocked(), "state-invalid");
      denies(() => store.reserve(intent(f.namespaceId, f.storeId)), "state-invalid");
      denies(() => store.advance(event(saved, "cancelled")), "state-invalid");
    }
    assert.equal(f.db.prepare("SELECT version FROM candidate_effect_meta").pluck().get(), 2);
    assert.equal(f.db.prepare("SELECT record_json FROM candidate_effect_operations").pluck().get(), wire);
  } finally { f.dispose(); }
});

test("publication restoration releases once-at-a-time workspace exclusion, never approval identity", () => {
  const f = fixture(); try {
    const parent = completed(f), pub = publication(parent);
    const reserved = f.store.reserve(pub).record;
    const possible = f.store.advance(event(reserved, "publication-possible")).record;
    const restored = f.store.advance(event(possible, "restored")).record;
    const reopened = f.reopen();
    assert.deepEqual(reopened.read(pub.operationId), restored);
    assert.equal(candidateEffectBlocked(restored), false);
    assert.equal(reopened.reserve(pub).disposition, "replayed");
    denies(() => reopened.advance(event(restored, "completed")), "transition-denied");
    denies(() => reopened.reserve({ ...intent(f.namespaceId, f.storeId), approvalId: pub.approvalId }), "approval-reused");
    // CC-N-04: a new approval cannot re-publish this execution after restoration.
    denies(() => reopened.reserve({ ...pub, operationId: randomUUID(), approvalId: randomUUID() }), "workflow-reused");
    denies(() => reopened.reserve({ ...pub, operationId: randomUUID(), approvalId: randomUUID(), workflowId: randomUUID() }), "execution-unverified");
    assert.equal(reopened.reserve(intent(f.namespaceId, f.storeId)).disposition, "recorded");
  } finally { f.dispose(); }
});

for (const pragma of ["synchronous=NORMAL", "foreign_keys=OFF", "trusted_schema=ON", "busy_timeout=0", "ignore_check_constraints=ON", "journal_mode=DELETE"])
test(`current connection rejects durability drift: ${pragma}`, () => {
  const f = fixture(); try {
    f.db.pragma(pragma); denies(() => f.store.listBlocked(), "durability-invalid");
    denies(() => f.store.reserve(intent(f.namespaceId, f.storeId)), "durability-invalid");
  } finally { f.dispose(); }
});

test("attached database denies discovery without inspecting its content", () => {
  const f = fixture(); try {
    f.db.prepare("ATTACH DATABASE ? AS unrelated").run(":memory:");
    denies(() => f.store.listBlocked(), "schema-invalid");
    denies(() => f.store.reserve(intent(f.namespaceId, f.storeId)), "schema-invalid");
  } finally { f.dispose(); }
});

test("forward-clock record survives reopen and blocks all earlier writes; discovery remains read-only", () => {
  const f = fixture(); try {
    f.setTime("2099-01-01T00:00:00.000Z");
    const input = { ...intent(f.namespaceId, f.storeId), expiresAt: "2099-01-01T00:05:00.000Z" };
    const future = f.store.reserve(input).record; f.setTime(NOW);
    for (const store of [f.store, f.reopen()]) {
      assert.deepEqual(store.read(input.operationId), future);
      denies(() => store.advance(event(future, "cancelled")), "clock-invalid");
      denies(() => store.reserve({ ...intent(f.namespaceId, f.storeId), workspaceDigest: d(99) }), "clock-invalid");
    }
  } finally { f.dispose(); }
});

test("expired success is historical bookkeeping and replayed quarantine never grants a fresh effect", () => {
  const f = fixture(); try {
    let r = f.store.reserve(intent(f.namespaceId, f.storeId)).record;
    r = f.store.advance(event(r, "source-delivery-possible")).record;
    r = f.store.advance(event(r, "launch-possible")).record;
    f.setTime("2027-09-13T12:00:00.000Z");
    r = f.store.advance(event(r, "result-and-stop-observed")).record;
    r = f.store.advance(event(r, "completed")).record;
    assert.equal(candidateEffectState(r), "completed", "recording time is not effect authorization time");
    const p = f.store.reserve({ ...publication(r), expiresAt: "2027-09-13T12:05:00.000Z" }).record;
    const q = f.store.advance(event(p, "quarantined")).record;
    const replay = f.reopen().reserve(p.intent);
    assert.equal(replay.disposition, "replayed"); assert.equal(replay.kind, "recorded-state-not-effect-permission");
    assert.deepEqual(replay.record, q); assert.equal(candidateEffectBlocked(replay.record), true);
  } finally { f.dispose(); }
});
