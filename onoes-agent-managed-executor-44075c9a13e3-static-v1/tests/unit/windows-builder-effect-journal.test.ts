import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import Database from "better-sqlite3";
import { canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import { BuilderEffectJournalError, WindowsBuilderEffectJournal } from "../../src/build-only/windows-builder-effect-journal.js";
import { initializeWindowsBuilderRecoveryStore, SqliteWindowsBuilderRecoveryStore } from "../../src/build-only/windows-builder-recovery-store.js";
import { initializeWindowsWorkspacePolicyStore, SqliteWindowsWorkspacePolicyStore, WorkspacePolicyStoreError } from "../../src/build-only/windows-workspace-policy-store.js";

const NOW = "2026-09-06T12:00:00.000Z";
const d = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`;
const files = () => [{ relativePath: "fixed.txt", bytes: Buffer.from("before") }];
function fixture() {
  const parent = resolve(tmpdir()), directory = mkdtempSync(join(parent, "onoes-effect-journal-"));
  const policyPath = join(directory, "policy.sqlite"), recoveryPath = join(directory, "recovery.sqlite");
  const handles: Database.Database[] = [];
  const open = (path: string, existing = true) => {
    const db = new Database(path, { fileMustExist: existing }); handles.push(db); return db;
  };
  const policyDb = open(policyPath, false), recoveryDb = open(recoveryPath, false);
  initializeWindowsWorkspacePolicyStore(policyDb);
  const recoveryId = initializeWindowsBuilderRecoveryStore(recoveryDb);
  const policy = new SqliteWindowsWorkspacePolicyStore(policyDb, () => NOW);
  const recovery = new SqliteWindowsBuilderRecoveryStore(recoveryDb, recoveryId, () => NOW);
  const request = { operationId: randomUUID(), taskDigest: d(1), proposalDigest: d(2), authorizationDigest: d(3),
    workspaceDigest: d(4), scopeDigest: d(5), policyBinding: policy.snapshot().binding };
  return { directory, policyPath, recoveryPath, policyDb, recoveryDb, policy, recovery, recoveryId, request, open,
    journal: new WindowsBuilderEffectJournal(recovery, policy),
    reopen() {
      const policyDb = open(policyPath), recoveryDb = open(recoveryPath);
      const policy = new SqliteWindowsWorkspacePolicyStore(policyDb, () => NOW);
      const recovery = new SqliteWindowsBuilderRecoveryStore(recoveryDb, recoveryId, () => NOW);
      return { policyDb, recoveryDb, policy, recovery, journal: new WindowsBuilderEffectJournal(recovery, policy) };
    }, dispose() {
      for (const h of handles) if (h.open) h.close();
      const target = resolve(directory); assert.equal(dirname(target), parent);
      assert.ok(basename(target).startsWith("onoes-effect-journal-")); rmSync(target, { recursive: true, force: true });
    } };
}
const update = (policy: SqliteWindowsWorkspacePolicyStore) => ({ requestId: randomUUID(), expectedBinding: policy.snapshot().binding,
  rules: { allowedRoots: [], deniedRoots: [] } });
type Fixture = ReturnType<typeof fixture>;
type SeedState = "prepared-only" | "intent-recorded" | "effects-possible" | "recovery-settled" | "settled" | "quarantined";
function seed(f: Fixture, state: SeedState) {
  const prepared = f.recovery.prepare(f.request, files());
  if (state === "prepared-only") return;
  f.policy.beginEffectIntent({ operationId: f.request.operationId, authorizationDigest: f.request.authorizationDigest,
    requestDigest: prepared.requestDigest, binding: f.request.policyBinding });
  if (state === "intent-recorded") return;
  f.recovery.markEffectsPossible(f.request.operationId, prepared.requestDigest);
  if (state === "effects-possible") return;
  const terminal = { operationId: f.request.operationId, requestDigest: prepared.requestDigest,
    outcome: state === "quarantined" ? "quarantined" as const : "completed" as const, evidenceDigest: d(8) };
  if (state === "recovery-settled") f.recovery.recordTerminal(terminal);
  else f.journal.recordSettlement(terminal);
}
function blocked(policy: SqliteWindowsWorkspacePolicyStore) {
  assert.throws(() => policy.update(update(policy)), (e: unknown) => e instanceof WorkspacePolicyStoreError && e.reason === "effect-pending");
}
function denied(fn: () => unknown, reason?: string) {
  assert.throws(fn, (e: unknown) => e instanceof BuilderEffectJournalError && (reason === undefined || e.reason === reason));
}

for (const state of ["empty", "prepared-only", "intent-recorded", "effects-possible", "recovery-settled", "settled", "quarantined"] as const) {
  test(`restart inventory discovers ${state} without caller-supplied operation IDs or writes`, () => {
    const f = fixture();
    try {
      if (state !== "empty") seed(f, state);
      f.policyDb.close(); f.recoveryDb.close();
      const reopened = f.reopen();
      const before = [reopened.policyDb.serialize(), reopened.recoveryDb.serialize()];
      const result = reopened.journal.inspectRecordedOperations();
      assert.equal(result.kind, "recorded-state-not-authorization");
      assert.equal(result.operations.length, state === "empty" ? 0 : 1);
      if (state !== "empty") assert.deepEqual(result.operations, [reopened.journal.inspect(f.request.operationId)]);
      assert.equal(result.operations[0]?.state ?? "empty", state);
      assert.equal(result.unresolvedOperationCount, state === "empty" || state === "settled" ? 0 : 1);
      assert.equal(result.inventoryDigest, canonicalSha256Digest({ domain: "agent-builder-effect-inventory/v1",
        policyBinding: result.policyBinding, recoveryStoreId: f.recoveryId, operations: result.operations }));
      assert.equal(result.recoveryStoreId, f.recoveryId);
      assert.deepEqual(reopened.journal.inspectRecordedOperations(), result);
      assert.deepEqual([reopened.policyDb.serialize(), reopened.recoveryDb.serialize()], before);
      assert.ok(Object.isFrozen(result) && Object.isFrozen(result.operations) && Object.isFrozen(result.policyBinding));
      if (result.operations[0]) assert.ok(Object.isFrozen(result.operations[0]));
      for (const privateText of ["fixed.txt", "before", f.directory, "authorizationDigest", "approved", "allow"])
        assert.equal(JSON.stringify(result).includes(privateText), false);
      assert.equal(reopened.policyDb.inTransaction || reopened.recoveryDb.inTransaction, false);
    } finally { f.dispose(); }
  });
}

test("restart inventory finds a recovery terminal omitted by listUnfinished while policy remains blocked", () => {
  const f = fixture();
  try {
    seed(f, "recovery-settled");
    assert.deepEqual(f.recovery.listUnfinished(), []); // Existing discovery hole.
    blocked(f.policy);
    const reopened = f.reopen(), result = reopened.journal.inspectRecordedOperations();
    assert.equal(result.unresolvedOperationCount, 1); assert.equal(result.operations[0]?.state, "recovery-settled");
    assert.equal(reopened.policy.readEffectIntent(f.request.operationId).settlement, null);
    blocked(reopened.policy); // Inspection does not settle or release the blocker.
    const recoveryBefore = reopened.recovery.read(f.request.operationId);
    const done = reopened.journal.recordSettlement({ operationId: f.request.operationId,
      requestDigest: recoveryBefore.prepared.requestDigest, outcome: "completed", evidenceDigest: d(8) });
    assert.equal(done.state, "settled"); assert.equal(reopened.journal.inspectRecordedOperations().unresolvedOperationCount, 0);
    assert.deepEqual(reopened.recovery.read(f.request.operationId), recoveryBefore);
  } finally { f.dispose(); }
});

for (const fault of ["policy-only", "missing-policy", "wrong-policy-store"] as const) {
  test(`restart inventory rejects ${fault} rather than omitting unmatched records`, () => {
    const f = fixture();
    try {
      if (fault === "policy-only") f.policy.beginEffectIntent({ operationId: f.request.operationId,
        authorizationDigest: d(3), requestDigest: d(4), binding: f.request.policyBinding });
      else seed(f, "effects-possible");
      if (fault === "missing-policy") f.policyDb.prepare("DELETE FROM workspace_policy_effects").run();
      if (fault === "wrong-policy-store") {
        const db = new Database(":memory:");
        try {
          initializeWindowsWorkspacePolicyStore(db);
          const other = new SqliteWindowsWorkspacePolicyStore(db, () => NOW);
          denied(() => new WindowsBuilderEffectJournal(f.recovery, other).inspectRecordedOperations(), "pair-conflict");
        } finally { db.close(); }
      } else denied(() => f.journal.inspectRecordedOperations(), "pair-conflict");
    } finally { f.dispose(); }
  });
}

for (const changed of ["membership", "settlement", "policy"] as const) {
  test(`restart inventory denies observed ${changed} drift and permits a new read-only inspection`, () => {
    const f = fixture(); let calls = 0, injected = false;
    try {
      if (changed !== "policy") seed(f, "effects-possible");
      const list = f.policy.listEffectIntents.bind(f.policy);
      f.policy.listEffectIntents = () => {
        if (++calls === 2) {
          injected = true;
          if (changed === "membership") f.recovery.prepare({ ...f.request, operationId: randomUUID(),
            authorizationDigest: d(99), workspaceDigest: d(98) }, files());
          if (changed === "settlement") f.journal.recordSettlement({ operationId: f.request.operationId,
            requestDigest: f.recovery.read(f.request.operationId).prepared.requestDigest, outcome: "completed", evidenceDigest: d(8) });
          if (changed === "policy") f.policy.update(update(f.policy));
        }
        return list();
      };
      denied(() => f.journal.inspectRecordedOperations(), "snapshot-changed"); assert.equal(injected, true);
      f.policy.listEffectIntents = list;
      const stable = f.journal.inspectRecordedOperations();
      assert.equal(stable.operations.length, changed === "membership" ? 2 : changed === "settlement" ? 1 : 0);
    } finally { f.dispose(); }
  });
}

for (const fault of ["recovery-digest", "policy-digest", "closed-store"] as const) {
  test(`restart inventory rejects ${fault} without returning a partial assessment`, () => {
    const f = fixture();
    try {
      seed(f, "effects-possible");
      if (fault === "recovery-digest") f.recoveryDb.prepare("UPDATE builder_recovery_operations SET record_digest=?").run(d(99));
      if (fault === "policy-digest") f.policyDb.prepare("UPDATE workspace_policy_effects SET record_digest=?").run(d(99));
      if (fault === "closed-store") f.recoveryDb.close();
      denied(() => f.journal.inspectRecordedOperations(), "storage-unavailable");
    } finally { f.dispose(); }
  });
}

test("restart inventory preserves historical receipts after policy rotation and never samples a clock", () => {
  const f = fixture();
  try {
    seed(f, "settled"); const before = f.journal.inspectRecordedOperations();
    f.policy.update(update(f.policy));
    f.policyDb.close(); f.recoveryDb.close();
    const pd = f.open(f.policyPath), rd = f.open(f.recoveryPath), noClock = () => { throw new Error("clock-must-not-run"); };
    const journal = new WindowsBuilderEffectJournal(new SqliteWindowsBuilderRecoveryStore(rd, f.recoveryId, noClock),
      new SqliteWindowsWorkspacePolicyStore(pd, noClock));
    const after = journal.inspectRecordedOperations();
    assert.deepEqual(after.operations, before.operations); assert.notEqual(after.inventoryDigest, before.inventoryDigest);
    assert.equal(after.policyBinding.revision, before.policyBinding.revision + 1);
  } finally { f.dispose(); }
});

test("empty inventory binds the pinned recovery store rather than collapsing recreated stores", () => {
  const f = fixture(), rd = new Database(":memory:");
  try {
    const otherId = initializeWindowsBuilderRecoveryStore(rd);
    const first = f.journal.inspectRecordedOperations();
    const second = new WindowsBuilderEffectJournal(new SqliteWindowsBuilderRecoveryStore(rd, otherId), f.policy)
      .inspectRecordedOperations();
    assert.deepEqual(first.operations, []); assert.deepEqual(second.operations, []);
    assert.notEqual(first.recoveryStoreId, second.recoveryStoreId); assert.notEqual(first.inventoryDigest, second.inventoryDigest);
  } finally { rd.close(); f.dispose(); }
});

test("restart inventory retains sorted completed history alongside a newly prepared operation", () => {
  const f = fixture();
  try {
    seed(f, "settled"); const saved = f.journal.inspect(f.request.operationId);
    f.policy.update(update(f.policy));
    const next = { ...f.request, operationId: randomUUID(), authorizationDigest: d(20),
      policyBinding: f.policy.snapshot().binding };
    f.recovery.prepare(next, files());
    const inventory = f.journal.inspectRecordedOperations();
    assert.deepEqual(inventory.operations.map(operation => operation.operationId), [f.request.operationId, next.operationId].sort());
    assert.deepEqual(inventory.operations.find(operation => operation.operationId === f.request.operationId), saved);
    assert.equal(inventory.unresolvedOperationCount, 1);
    assert.equal(inventory.operations.find(operation => operation.operationId === next.operationId)?.state, "prepared-only");
  } finally { f.dispose(); }
});

test("operation discovery bounds and validates IDs before metadata loading; IDs are not verified records", () => {
  const f = fixture();
  try {
    const ids = Array.from({ length: 1001 }, () => randomUUID());
    const insert = f.recoveryDb.prepare("INSERT INTO builder_recovery_operations VALUES (?,?,?,1,?,?)");
    f.recoveryDb.transaction(() => { for (let i = 0; i < 1000; i++) insert.run(ids[i], d(i), d(i), "{}", d(1)); }).immediate();
    const discovered = f.recovery.listOperationIds();
    assert.deepEqual(discovered, ids.slice(0, 1000).sort()); assert.ok(Object.isFrozen(discovered));
    denied(() => f.journal.inspectRecordedOperations(), "storage-unavailable");
    insert.run(ids[1000], d(1000), d(1000), "{}", d(1));
    assert.throws(() => f.recovery.listOperationIds());
    f.recoveryDb.prepare("DELETE FROM builder_recovery_operations").run();
    insert.run("a".repeat(100), d(1), d(1), "{}", d(1));
    assert.throws(() => f.recovery.listOperationIds());
  } finally { f.dispose(); }
});

test("journal joins exact preimages and policy intent without holding either transaction", () => {
  const f = fixture(); try {
    const result = f.journal.recordStart(f.request, files());
    assert.equal(result.kind, "recorded-state-not-authorization"); assert.equal(result.state, "effects-possible");
    assert.equal(result.recoveryRecordDigest, canonicalSha256Digest(f.recovery.read(f.request.operationId)));
    assert.equal(result.policyEffectRecordDigest, canonicalSha256Digest(f.policy.readEffectIntent(f.request.operationId)));
    assert.ok(Object.isFrozen(result)); blocked(f.policy);
    const other = f.reopen();
    for (const db of [other.policyDb, other.recoveryDb]) { db.exec("BEGIN IMMEDIATE"); db.exec("ROLLBACK"); }
    assert.deepEqual(other.journal.inspect(f.request.operationId), result);
    denied(() => other.journal.recordStart(f.request, files()), "start-already-recorded");
    const receipt = JSON.stringify(result);
    for (const secret of ["fixed.txt", "before", f.directory, "authorizationDigest", "approved", "allow"]) assert.equal(receipt.includes(secret), false);
    assert.equal(f.policyDb.inTransaction, false); assert.equal(f.recoveryDb.inTransaction, false);
  } finally { f.dispose(); }
});

for (const outcome of ["completed", "restored", "quarantined"] as const) {
  test(`journal ${outcome} settlement retains both historical records and exact retries`, () => {
    const f = fixture(); try {
      const start = f.journal.recordStart(f.request, files());
      const request = { operationId: f.request.operationId, requestDigest: start.requestDigest, outcome, evidenceDigest: d(8) };
      const result = f.journal.recordSettlement(request);
      assert.equal(result.state, outcome === "quarantined" ? "quarantined" : "settled");
      const policyRecord = f.policy.readEffectIntent(f.request.operationId);
      assert.equal(policyRecord.settlement?.outcome, outcome === "restored" ? "unchanged" : outcome);
      assert.equal(f.recovery.read(f.request.operationId).terminal?.evidenceDigest, policyRecord.settlement?.evidenceDigest);
      if (outcome === "quarantined") blocked(f.policy); else f.policy.update(update(f.policy));
      f.policyDb.close(); f.recoveryDb.close();
      const policyDb = f.open(f.policyPath), recoveryDb = f.open(f.recoveryPath);
      const noClock = () => { throw new Error("retry must preserve time"); };
      const retry = new WindowsBuilderEffectJournal(new SqliteWindowsBuilderRecoveryStore(recoveryDb, f.recoveryId, noClock),
        new SqliteWindowsWorkspacePolicyStore(policyDb, noClock));
      assert.deepEqual(retry.recordSettlement(request), result);
      denied(() => retry.recordSettlement({ ...request, evidenceDigest: d(9) }));
      denied(() => retry.recordStart(f.request, files()), "start-already-recorded");
      denied(() => retry.recordStart({ ...f.request, operationId: randomUUID(), workspaceDigest: d(20) }, files()));
    } finally { f.dispose(); }
  });
}

test("journal denies mismatched stores, reordered settlement, and missing intent after an effect marker", () => {
  for (const fault of ["request", "authorization", "binding", "settled-first", "missing-intent"] as const) {
    const f = fixture(); try {
      const identity = fault === "binding" ? { ...f.request, policyBinding: { ...f.request.policyBinding, policyDigest: d(94) } } : f.request;
      const prepared = f.recovery.prepare(identity, files());
      assert.equal(f.journal.inspect(f.request.operationId).state, "prepared-only");
      if (fault !== "missing-intent") {
        f.policy.beginEffectIntent({ operationId: f.request.operationId,
          requestDigest: fault === "request" ? d(91) : prepared.requestDigest,
          authorizationDigest: fault === "authorization" ? d(92) : f.request.authorizationDigest,
          binding: f.request.policyBinding });
      }
      f.recovery.markEffectsPossible(f.request.operationId, f.recovery.read(f.request.operationId).prepared.requestDigest);
      if (fault === "settled-first") f.policy.settleEffectIntent({ operationId: f.request.operationId,
        requestDigest: prepared.requestDigest, outcome: "completed", evidenceDigest: d(8) });
      denied(() => f.journal.inspect(f.request.operationId), "pair-conflict");
      denied(() => f.journal.recordSettlement({ operationId: f.request.operationId,
        requestDigest: prepared.requestDigest, outcome: "completed", evidenceDigest: d(8) }), "pair-conflict");
      assert.equal(f.recovery.read(f.request.operationId).terminal, null);
    } finally { f.dispose(); }
  }
});

test("journal catches committed-response loss without undoing blockers or performing effects", () => {
  const f = fixture(); try {
    const original = f.policy.beginEffectIntent.bind(f.policy);
    f.policy.beginEffectIntent = input => { original(input); throw new Error("private source diagnostic"); };
    denied(() => f.journal.recordStart(f.request, files()), "storage-unavailable");
    const other = f.reopen();
    assert.equal(other.journal.inspect(f.request.operationId).state, "intent-recorded"); blocked(other.policy);
    denied(() => other.journal.recordStart(f.request, files()), "start-already-recorded");
    denied(() => other.journal.recordSettlement({ operationId: f.request.operationId,
      requestDigest: other.recovery.read(f.request.operationId).prepared.requestDigest,
      outcome: "completed", evidenceDigest: d(8) }), "settlement-not-ready");
    assert.equal(other.recovery.read(f.request.operationId).effectsPossibleAt, null);
  } finally { f.dispose(); }
});

test("journal validates terminal input before storage and denies changed request, time inversion, or stale policy", () => {
  const f = fixture(); try {
    for (const bad of [null, {}, { operationId: "private-path" }]) denied(() => f.journal.recordSettlement(bad), "request-invalid");
    denied(() => f.journal.inspect("private-path"), "request-invalid");
    f.policy.update(update(f.policy));
    denied(() => f.journal.recordStart(f.request, files()));
    assert.equal(f.journal.inspect(f.request.operationId).state, "prepared-only");
    const fresh = { ...f.request, policyBinding: f.policy.snapshot().binding, operationId: randomUUID(), authorizationDigest: d(100), workspaceDigest: d(101) };
    const start = f.journal.recordStart(fresh, files());
    denied(() => f.journal.recordSettlement({ operationId: fresh.operationId, requestDigest: d(99), outcome: "completed", evidenceDigest: d(8) }), "pair-conflict");
    assert.equal(f.recovery.read(fresh.operationId).terminal, null);
    assert.equal(start.state, "effects-possible");
  } finally { f.dispose(); }
  const g = fixture(); try {
    const laterRecovery = new SqliteWindowsBuilderRecoveryStore(g.recoveryDb, g.recoveryId, () => "2026-09-06T13:00:00.000Z");
    const journal = new WindowsBuilderEffectJournal(laterRecovery, g.policy);
    denied(() => journal.recordStart(g.request, files()), "storage-unavailable");
    assert.equal(journal.inspect(g.request.operationId).state, "prepared-only");
  } finally { g.dispose(); }
});

test("journal rejects a different policy store even when it has no matching intent", () => {
  const f = fixture(), g = fixture(); try {
    f.recovery.prepare(f.request, files());
    const wrongStore = new WindowsBuilderEffectJournal(f.recovery, g.policy);
    denied(() => wrongStore.inspect(f.request.operationId), "pair-conflict");
    denied(() => wrongStore.recordStart(f.request, files()), "pair-conflict");
  } finally { f.dispose(); g.dispose(); }
});

test("cross-store clock regression cannot release policy before the recovery terminal time", () => {
  const f = fixture(); try {
    const start = f.journal.recordStart(f.request, files());
    const later = "2026-09-06T13:00:00.000Z";
    const recovery = new SqliteWindowsBuilderRecoveryStore(f.recoveryDb, f.recoveryId, () => later);
    const journal = new WindowsBuilderEffectJournal(recovery, f.policy);
    const request = { operationId: f.request.operationId, requestDigest: start.requestDigest, outcome: "completed", evidenceDigest: d(8) };
    denied(() => journal.recordSettlement(request), "storage-unavailable");
    assert.equal(journal.inspect(f.request.operationId).state, "recovery-settled"); blocked(f.policy);
    assert.equal(f.policy.readEffectIntent(f.request.operationId).settlement, null);
    const policy = new SqliteWindowsWorkspacePolicyStore(f.policyDb, () => later);
    const repairedClock = new WindowsBuilderEffectJournal(recovery, policy);
    assert.equal(repairedClock.recordSettlement(request).state, "settled");
    assert.throws(() => policy.settleEffectIntent({ ...request, outcome: "completed" }, "2026-09-07T00:00:00.000Z"),
      (e: unknown) => e instanceof WorkspacePolicyStoreError && e.reason === "clock-regression");
    assert.throws(() => policy.settleEffectIntent({ ...request, outcome: "completed" }, "invalid"),
      (e: unknown) => e instanceof WorkspacePolicyStoreError && e.reason === "request-invalid");
  } finally { f.dispose(); }
});

const phases = ["preimages-committed", "policy-intent-committed", "effects-marker-committed", "file-written",
  "recovery-terminal-committed", "policy-settlement-committed", "journal-returned"] as const;
for (const phase of phases) {
  test(`two-store journal survives actual process death: ${phase}`, { timeout: 20_000 }, async () => {
    const f = fixture(); let child: ChildProcess | undefined; let closed: Promise<void> | undefined;
    try {
      const target = join(f.directory, "fixed-effect.txt"); writeFileSync(target, "before");
      f.policyDb.close(); f.recoveryDb.close();
      const module = (name: string) => JSON.stringify(pathToFileURL(resolve(`.test-dist/src/build-only/${name}.js`)).href);
      const library = JSON.stringify(pathToFileURL(resolve("node_modules/better-sqlite3/lib/index.js")).href);
      const script = `import Database from ${library};
        import {writeSync,readFileSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
        import {SqliteWindowsWorkspacePolicyStore} from ${module("windows-workspace-policy-store")};
        import {SqliteWindowsBuilderRecoveryStore} from ${module("windows-builder-recovery-store")};
        import {WindowsBuilderEffectJournal} from ${module("windows-builder-effect-journal")};
        const [pp,rp,rid,target,phase,json]=process.argv.slice(1),request=JSON.parse(json);
        const pd=new Database(pp,{fileMustExist:true}),rd=new Database(rp,{fileMustExist:true});
        const policy=new SqliteWindowsWorkspacePolicyStore(pd,()=>${JSON.stringify(NOW)});
        const recovery=new SqliteWindowsBuilderRecoveryStore(rd,rid,()=>${JSON.stringify(NOW)});
        const journal=new WindowsBuilderEffectJournal(recovery,policy);
        function cut(point){if(point!==phase)return;writeSync(1,JSON.stringify({phase:point,policyTransaction:pd.inTransaction,recoveryTransaction:rd.inTransaction})+'\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);throw new Error('resumed');}
        function wrap(object,method,point){const original=object[method].bind(object);object[method]=(...args)=>{const result=original(...args);cut(point);return result;};}
        wrap(recovery,'prepare','preimages-committed');wrap(policy,'beginEffectIntent','policy-intent-committed');
        wrap(recovery,'markEffectsPossible','effects-marker-committed');wrap(recovery,'recordTerminal','recovery-terminal-committed');
        wrap(policy,'settleEffectIntent','policy-settlement-committed');
        const start=journal.recordStart(request,[{relativePath:'fixed.txt',bytes:Buffer.from('before')}]);
        const fd=openSync(target,'r+');writeFileSync(fd,'after!');fsyncSync(fd);closeSync(fd);cut('file-written');
        if(readFileSync(target,'utf8')!=='after!')throw new Error('readback-failed');
        journal.recordSettlement({operationId:request.operationId,requestDigest:start.requestDigest,outcome:'completed',evidenceDigest:${JSON.stringify(d(8))}});
        cut('journal-returned');throw new Error('cut-missed');`;
      child = spawn(process.execPath, ["--input-type=module", "-e", script, f.policyPath, f.recoveryPath, f.recoveryId, target, phase, JSON.stringify(f.request)],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 12_000, env: { SystemRoot: process.env["SystemRoot"] ?? "C:\\Windows" } });
      closed = new Promise<void>(done => child!.once("close", () => done()));
      const marker = await new Promise<{ phase: string; policyTransaction: boolean; recoveryTransaction: boolean }>((accept, reject) => {
        let output = ""; child!.once("error", reject); child!.once("close", () => reject(new Error("child-ended-before-cut")));
        child!.stderr!.on("data", () => reject(new Error("child-fixture-diagnostic")));
        child!.stdout!.on("data", (chunk: Buffer) => { output += chunk.toString(); if (output.length > 4096) return reject(new Error("marker-limit"));
          if (output.endsWith("\n")) { try { accept(JSON.parse(output)); } catch { reject(new Error("marker-invalid")); } } });
      });
      assert.equal(marker.phase, phase); assert.equal(marker.policyTransaction, false); assert.equal(marker.recoveryTransaction, false);
      assert.equal(child.exitCode, null); assert.equal(child.kill("SIGKILL"), true); await closed;
      const reopened = f.reopen(), result = reopened.journal.inspect(f.request.operationId);
      const inventory = reopened.journal.inspectRecordedOperations();
      assert.deepEqual(inventory.operations, [result], "restart discovery must not depend on the parent's remembered ID");
      assert.equal(inventory.unresolvedOperationCount, result.state === "settled" ? 0 : 1);
      for (const db of [reopened.policyDb, reopened.recoveryDb]) assert.equal(db.pragma("quick_check", { simple: true }), "ok");
      const index = phases.indexOf(phase), written = index >= 3;
      assert.equal(readFileSync(target, "utf8"), written ? "after!" : "before");
      assert.equal(result.state, ["prepared-only", "intent-recorded", "effects-possible", "effects-possible", "recovery-settled", "settled", "settled"][index]);
      if (index > 0 && index < 5) blocked(reopened.policy);
      if (index >= 4) {
        // The old child is confirmed dead; only the missing receipt commit is replayed.
        const finished = reopened.journal.recordSettlement({ operationId: f.request.operationId, requestDigest: result.requestDigest,
          outcome: "completed", evidenceDigest: d(8) });
        assert.equal(finished.state, "settled"); reopened.policy.update(update(reopened.policy));
      }
      if (index > 0) denied(() => reopened.journal.recordStart(f.request, files()), "start-already-recorded");
      assert.equal(readFileSync(target, "utf8"), written ? "after!" : "before", "inspection/settlement did not repeat or restore the effect");
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      if (closed) await closed; f.dispose();
    }
  });
}
