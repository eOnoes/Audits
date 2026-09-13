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
function intent(namespaceId: string): CandidateEffectIntent {
  return { schemaVersion: CANDIDATE_EFFECT_DOMAIN, namespaceId, operationId: randomUUID(), workflowId: randomUUID(), approvalId: randomUUID(),
    kind: "execute", workspaceDigest: d(1), policyBindingDigest: d(2), candidateDigest: d(3), reviewMaterialDigest: d(4),
    sourceManifestDigest: d(5), requestDigest: d(6), guestImageDigest: d(7), guestGeneration: randomUUID(),
    controllerIdentityDigest: d(8), resourcePolicyDigest: d(9), expiresAt: EXPIRES };
}
function fixture() {
  const parent = resolve(tmpdir()), dir = mkdtempSync(join(parent, "onoes-candidate-effect-")), path = join(dir, "state.sqlite");
  const handles: Database.Database[] = [], db = new Database(path); handles.push(db);
  const namespaceId = randomUUID(), storeId = initializeCandidateEffectLedger(db, namespaceId);
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
function completed(f: ReturnType<typeof fixture>, input = intent(f.namespaceId), passed = true) {
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
    const original = intent(f.namespaceId), r = completed(f, original), publish = publication(r);
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

test("single namespace approval uniqueness spans workflows and execute/publish; keys cannot be appended", () => {
  const f = fixture(); try {
    const r = completed(f), original = r.intent;
    denies(() => f.store.reserve({ ...intent(f.namespaceId), approvalId: original.approvalId }), "approval-reused");
    denies(() => f.store.reserve({ ...publication(r), approvalId: original.approvalId }), "approval-reused");
    denies(() => f.store.reserve({ ...original, approvalId: randomUUID() }), "intent-conflict");
    denies(() => f.store.reserve({ ...original, operationId: randomUUID(), approvalId: randomUUID() }), "workflow-reused");
    denies(() => f.store.reserve({ ...original, keyId: "rotation-alias" }), "input-invalid");
    denies(() => f.store.reserve({ ...original, namespaceId: randomUUID() }), "identity-mismatch");
  } finally { f.dispose(); }
});

test("publication requires a passed completed parent and exact complete subject, never bare result digest", () => {
  const f = fixture(); try {
    const unverified = f.store.reserve(intent(f.namespaceId)).record;
    denies(() => f.store.reserve(publication(unverified)), "workspace-blocked");
    denies(() => f.store.reserve({ ...publication(unverified), workspaceDigest: d(90) }), "execution-unverified");
    const r = completed(f, { ...intent(f.namespaceId), workspaceDigest: d(91) });
    for (const key of ["candidateDigest", "reviewMaterialDigest", "sourceManifestDigest", "requestDigest", "guestImageDigest",
      "controllerIdentityDigest", "policyBindingDigest", "resourcePolicyDigest", "resultDigest"])
      denies(() => f.store.reserve({ ...publication(r), [key]: d(99) }), "execution-unverified");
    denies(() => f.store.reserve({ ...publication(r), guestGeneration: randomUUID() }), "execution-unverified");
    const failed = completed(f, { ...intent(f.namespaceId), workspaceDigest: d(92) }, false);
    denies(() => f.store.reserve(publication(failed)), "execution-unverified");
  } finally { f.dispose(); }
});

test("terminal quarantine remains absorbing and blocks a fresh workflow after restart", () => {
  const f = fixture(); try {
    const r = f.store.reserve(intent(f.namespaceId)).record;
    const q = f.store.advance(event(r, "quarantined")).record;
    assert.equal(candidateEffectBlocked(q), true);
    f.db.close(); const reopened = f.reopen();
    assert.deepEqual(reopened.listBlocked(), [q]);
    denies(() => reopened.reserve(intent(f.namespaceId)), "workspace-blocked");
    denies(() => reopened.advance(event(q, "completed")), "transition-denied");
    denies(() => reopened.advance(event(q, "cancelled")), "transition-denied");
    assert.equal(reopened.advance(event(q, "quarantined")).disposition, "replayed");
  } finally { f.dispose(); }
});

test("pure state graph rejects skipped effects, contradictory results and restoration of execution", () => {
  const f = fixture(); try {
    let r = f.store.reserve(intent(f.namespaceId)).record;
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
    const input = intent(f.namespaceId), r = f.store.reserve(input).record;
    input.candidateDigest = d(99); assert.notEqual(r.intent.candidateDigest, input.candidateDigest);
    let getter = false;
    const evil = { ...intent(f.namespaceId), get approvalId() { getter = true; throw new Error("private-test-message"); } };
    denies(() => f.store.reserve(evil), "input-invalid"); assert.equal(getter, false);
    let traps = 0;
    const proxy = new Proxy(intent(f.namespaceId), { getPrototypeOf() { traps++; return Object.prototype; },
      get() { traps++; return undefined; }, ownKeys() { traps++; return []; } });
    denies(() => f.store.reserve(proxy), "input-invalid");
    denies(() => f.store.reserve({ ...intent(f.namespaceId), extra: proxy }), "input-invalid");
    assert.equal(traps, 0);
    denies(() => validateCandidateEffectRecord({ ...r, intentDigest: d(90) }), "state-invalid");
    denies(() => f.store.advance({ ...event(r, "cancelled"), intentDigest: d(91) }), "intent-conflict");
    const done = f.store.advance(event(r, "cancelled"));
    denies(() => f.store.advance({ ...event(r, "cancelled"), evidenceDigest: d(92) }), "intent-conflict");
    assert.deepEqual(f.store.read(r.intent.operationId), done.record);
  } finally { f.dispose(); }
});

test("expiry denies new effects but does not prevent recording stop/failure; cross-operation clock regression denies", () => {
  const f = fixture(); try {
    let r = f.store.reserve(intent(f.namespaceId)).record;
    r = f.store.advance(event(r, "source-delivery-possible")).record;
    r = f.store.advance(event(r, "launch-possible")).record;
    f.setTime(EXPIRES);
    r = f.store.advance(event(r, "result-and-stop-observed", false)).record;
    f.store.advance(event(r, "failed"));
    denies(() => f.store.reserve(intent(f.namespaceId)), "expired");
    f.setTime(NOW); denies(() => f.store.reserve(intent(f.namespaceId)), "clock-invalid");
    f.setTime("invalid"); denies(() => f.store.reserve(intent(f.namespaceId)), "clock-invalid");
    assert.equal(f.store.read(r.intent.operationId)?.events.at(-1)?.state, "failed");
  } finally { f.dispose(); }
});

test("reached expiry before transfer refuses delivery marker and permits cancellation only", () => {
  const f = fixture(); try {
    const r = f.store.reserve(intent(f.namespaceId)).record; f.setTime(EXPIRES);
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
    const input = intent(f.namespaceId);
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
    const original = f.store.read.bind(f.store), input = intent(f.namespaceId);
    f.store.read = () => { throw new Error("synthetic-readback-loss"); };
    denies(() => f.store.reserve(input), "storage-unavailable");
    f.store.read = original;
    assert.ok(f.store.read(input.operationId)); denies(() => f.store.reserve(input), "write-poisoned");
    assert.equal(f.reopen().reserve(input).disposition, "replayed");
  } finally { f.dispose(); }
});

test("malformed row fails whole discovery; rehashed forged transitions and blocker columns cannot clear quarantine", () => {
  const f = fixture(); try {
    const r = f.store.reserve(intent(f.namespaceId)).record;
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
      const input = { ...intent(f.namespaceId), workspaceDigest: d(n + 100) };
      const record = validateCandidateEffectRecord({ intent: input, intentDigest: canonicalSha256Digest(input),
        approvalIdentityDigest: effectApprovalIdentity(input), reservedAt: NOW, events: [] });
      insert.run(input.operationId, record.approvalIdentityDigest, input.workflowId, input.kind,
        input.workspaceDigest, 1, canonicalJson(record), canonicalSha256Digest(record));
    };
    f.db.transaction(() => { for (let n = 0; n < CANDIDATE_EFFECT_MAX_OPERATIONS; n++) seed(n); }).immediate();
    assert.equal(f.store.listBlocked().length, CANDIDATE_EFFECT_MAX_OPERATIONS);
    denies(() => f.store.reserve(intent(f.namespaceId)), "limit-exceeded");
    seed(CANDIDATE_EFFECT_MAX_OPERATIONS);
    denies(() => f.store.listBlocked(), "limit-exceeded");
  } finally { f.dispose(); }
});

test("abrupt separate process exit after possible-effect COMMIT retains blocker and cannot redispatch on reopen", () => {
  const f = fixture(); try {
    const r = f.store.reserve(intent(f.namespaceId)).record, next = event(r, "source-delivery-possible");
    f.db.close();
    const child = spawnSync(process.execPath, [fileURLToPath(new URL("../helpers/candidate-effect-crash.js", import.meta.url)),
      JSON.stringify({ path: f.path, storeId: f.storeId, namespaceId: f.namespaceId, event: next })],
    { encoding: "utf8", timeout: 10_000, maxBuffer: 16_384, windowsHide: true });
    assert.ifError(child.error); assert.equal(child.status, 23); assert.equal(child.stderr, "");
    const reopened = f.reopen();
    assert.equal(reopened.read(r.intent.operationId)!.events.length, 1);
    assert.equal(reopened.advance(next).disposition, "replayed");
    denies(() => reopened.reserve(intent(f.namespaceId)), "workspace-blocked");
  } finally { f.dispose(); }
});

for (const same of [true, false]) test(`two independent worker connections race ${same ? "identical approval" : "same workspace"}: one reservation only`, async () => {
  const f = fixture(), workers: Worker[] = []; try {
    const first = intent(f.namespaceId), barrier = new SharedArrayBuffer(4);
    let ready = 0;
    const promises = [first, same ? first : intent(f.namespaceId)].map(input => new Promise<string>((resolveResult, reject) => {
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
    assert.deepEqual(results.sort(), same ? ["recorded", "replayed"] : ["recorded", "workspace-blocked"]);
    assert.equal(f.store.listBlocked().length, 1);
  } finally { await Promise.all(workers.map(w => w.terminate())); f.dispose(); }
});
