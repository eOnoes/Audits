import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { canonicalJson, canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import { parseWindowsWorkspacePolicy } from "../../src/build-only/windows-workspace-policy.js";
import { createWindowsOperatorTaskIntake } from "../../src/build-only/windows-operator-task-intake.js";
import { WindowsManagedTaskInspector, type ManagedTaskInspectionOptions } from "../../src/build-only/windows-managed-task-inspection.js";
import { WindowsManagedPlanningContextCompiler, isManagedEditCandidate } from "../../src/build-only/windows-managed-planning-context.js";
import { parseManagedVerificationCatalog, resolveManagedVerificationDefinition } from "../../src/build-only/windows-managed-verification-catalog.js";
import { initializeWindowsOperatorTaskStore, SqliteWindowsOperatorTaskStore, OPERATOR_TASK_STORE_LIMITS, OperatorTaskStoreError } from "../../src/build-only/windows-operator-task-store.js";

const NOW = "2026-09-09T00:00:00.000Z", d = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`;
const denied = (fn: () => unknown, reason: string) => assert.throws(fn, e => e instanceof OperatorTaskStoreError && e.reason === reason);
function fixture() {
  const parent = resolve(tmpdir()), directory = mkdtempSync(join(parent, "onoes-task-history-")), path = join(directory, "drafts.sqlite");
  const db = new Database(path), handles = [db], id = initializeWindowsOperatorTaskStore(db);
  const policy = parseWindowsWorkspacePolicy({ schemaVersion: "agent-windows-workspace-policy/v1", revision: 1,
    allowedRoots: [{ path: "D:\\Source", access: "read-write" }, { path: "D:\\Managed", access: "read-write" }], deniedRoots: ["C:\\"] });
  let current = { policy, binding: { storeId: randomUUID(), revision: 1, policyDigest: canonicalSha256Digest(policy) } };
  let now = NOW, clockReads = 0;
  const policyStore: ManagedTaskInspectionOptions["policy"] = {
    snapshot() { assert.equal(db.inTransaction, false); return current; },
    assertCurrentBinding(binding) { assert.equal(db.inTransaction, false); assert.equal(canonicalJson(binding), canonicalJson(current.binding)); },
    listEffectIntents() { assert.equal(db.inTransaction, false); return []; },
  };
  const clock = () => { assert.equal(db.inTransaction, false); clockReads++; return now; };
  const store = new SqliteWindowsOperatorTaskStore(db, id, policyStore, clock);
  const request = { schemaVersion: "agent-operator-task-intake-input/v1", expectedBinding: current.binding,
    objective: "Correct the label.", workspaceRoot: "D:\\Source", requestedReadFiles: ["src/a.ts"], requestedWriteFiles: ["src/a.ts"],
    acceptanceCriteria: ["Label is correct."] };
  const wire = canonicalJson(request);
  return { db, id, store, wire, request, policyStore, current: () => current, path, clock,
    setTime: (value: string) => { now = value; }, clockReads: () => clockReads,
    revoke() { const next = parseWindowsWorkspacePolicy({ ...policy, revision: 2, allowedRoots: [] });
      current = { policy: next, binding: { ...current.binding, revision: 2, policyDigest: canonicalSha256Digest(next) } }; },
    open() { const next = new Database(path, { fileMustExist: true }); handles.push(next); return next; },
    dispose() { for (const handle of handles) if (handle.open) handle.close();
      assert.equal(dirname(resolve(directory)), parent); assert.ok(basename(directory).startsWith("onoes-task-history-")); rmSync(directory, { recursive: true, force: true }); } };
}
async function candidate(f: ReturnType<typeof fixture>) {
  const workspace = { workspaceDigest: d(1), repositoryRoot: "D:\\Source", worktreeRoot: "D:\\Managed", worktreeAttestationDigest: d(2) };
  const bytes = Buffer.from("const label = 'old'; // PRIVATE_SOURCE_SENTINEL\n");
  const inspection = await new WindowsManagedTaskInspector({ workspace, policy: f.policyStore,
    io: { workspaceDigest: workspace.workspaceDigest, async openCustody() { return { async assertCustody() {}, async close() {},
      async read(_path: string, cap: number) { assert.ok(bytes.length <= cap); return Buffer.from(bytes); } }; } } }).inspect(f.wire);
  const entries = [{ schemaVersion: "onoes-managed-verification-definition/v1", verificationId: "fixture-check", displayName: "Fixture check",
    runnerArtifactDigest: d(3), commandContractDigest: d(4), networkAccess: "denied", workspaceAccess: "read-only", scratchAccess: "private-bounded",
    timeoutMs: 5000, maximumOutputBytes: 4096, maximumScratchBytes: 4096, maximumProcessCount: 2 }];
  const catalogDigest = canonicalSha256Digest({ domain: "onoes-managed-verification-catalog/v1", entries });
  const verification = resolveManagedVerificationDefinition(parseManagedVerificationCatalog(canonicalJson({ schemaVersion: "onoes-managed-verification-catalog/v1",
    kind: "trusted-static-definitions-not-task-commands", entries, catalogDigest })), "fixture-check", catalogDigest);
  const compiler = new WindowsManagedPlanningContextCompiler({ workspace, policy: f.policyStore, verification });
  const selection = canonicalJson({ schemaVersion: "agent-managed-planning-context-input/v1", briefDigest: inspection.briefDigest,
    inspectionDigest: inspection.inspectionDigest, verificationId: verification.definition.verificationId, catalogDigest, definitionDigest: verification.definitionDigest,
    files: [{ relativePath: "src/a.ts", contentDigest: inspection.files[0]!.contentDigest, startByte: 0, endByte: bytes.length }], ruleFilePins: [] });
  const context = compiler.compile(f.wire, selection, inspection); if (context.status !== "ready-for-planning") assert.fail("context");
  const result = compiler.prepareEdits(f.wire, selection, inspection, canonicalJson({ schemaVersion: "agent-managed-edit-candidate-input/v1",
    contextDigest: context.contextDigest, inspectionDigest: inspection.inspectionDigest, summary: "Correct label.",
    patches: [{ relativePath: "src/a.ts", expectedPreimageDigest: inspection.files[0]!.contentDigest,
      operations: [{ operation: "replace-exact", before: "old", after: "new", expectedOccurrences: 1 }] }] }));
  if (result.status !== "requires-task-and-review") assert.fail("candidate"); return result;
}

test("task history persists an immutable exact brief, original retry receipts and closed state across reopen", () => {
  const f = fixture(); try {
    const id = randomUUID(), created = f.store.create(id, 1, f.wire), closed = f.store.close(randomUUID(), id, 1, 1);
    assert.equal(created.taskId, id); assert.equal(created.intakeDigest, createWindowsOperatorTaskIntake(f.wire, f.current()).draftDigest);
    assert.equal(created.revision, 1); assert.equal(closed.revision, 2); assert.ok(Object.isFrozen(created));
    f.db.close(); const reopened = f.open(), cold = new SqliteWindowsOperatorTaskStore(reopened, f.id, f.policyStore, () => { throw new Error("retry clock"); });
    assert.equal(reopened.pragma("journal_mode", { simple: true }), "wal"); assert.equal(reopened.pragma("synchronous", { simple: true }), 2);
    assert.deepEqual(cold.create(id, 1, f.wire), created); assert.deepEqual(cold.readOperation(closed.requestId, closed.requestDigest), closed);
    const history = cold.read(id, 1); assert.deepEqual(history.brief, f.request); assert.equal(history.closed, true);
    assert.equal(history.resumeRequirement, "fresh-policy-inspection-and-planning"); assert.equal(history.executionEnabled, false); assert.equal(history.authority, "none");
    assert.equal(cold.list().length, 1);
  } finally { f.dispose(); }
});

test("task creation rejects invalid bytes, secrets, C denial and mismatched request reuse without changing history", () => {
  const f = fixture(); try {
    const id = randomUUID(); f.store.create(id, 1, f.wire); const before = f.db.serialize();
    for (const wire of [f.wire + "\n", "\ufeff" + f.wire, "[]", canonicalJson({ ...f.request, approval: true }),
      canonicalJson({ ...f.request, objective: "api_key=" + "x".repeat(24) })]) denied(() => f.store.create(randomUUID(), 1, wire), "request-invalid");
    denied(() => f.store.create(randomUUID(), 1, canonicalJson({ ...f.request, workspaceRoot: "C:\\Source" })), "policy-denied");
    denied(() => f.store.create(id, 1, canonicalJson({ ...f.request, objective: "Different" })), "request-conflict");
    assert.deepEqual(f.db.serialize(), before);
  } finally { f.dispose(); }
});

test("task history remains readable after policy revocation and does not revalidate old receipts as new grants", () => {
  const f = fixture(); try {
    const id = randomUUID(), event = f.store.create(id, 1, f.wire), clock = f.clockReads(); f.revoke();
    assert.deepEqual(f.store.create(id, 1, f.wire), event); assert.equal(f.clockReads(), clock);
    assert.deepEqual(f.store.readOperation(id, event.requestDigest), event);
    denied(() => f.store.create(randomUUID(), 1, f.wire), "policy-denied");
    assert.equal(f.store.close(randomUUID(), id, 1, 1).operation, "close");
  } finally { f.dispose(); }
});

test("task history detects identity, schema and durability drift without repairing absent or foreign databases", () => {
  const f = fixture(); try {
    denied(() => new SqliteWindowsOperatorTaskStore(f.db, randomUUID(), f.policyStore), "store-identity-mismatch");
    denied(() => initializeWindowsOperatorTaskStore(f.db), "schema-invalid");
    f.db.pragma("synchronous=NORMAL"); denied(() => f.store.list(), "durability-invalid"); f.db.pragma("synchronous=FULL");
    f.db.exec("CREATE TEMP TABLE unexpected (x)"); denied(() => f.store.list(), "schema-invalid"); f.db.exec("DROP TABLE temp.unexpected");
    f.db.exec("BEGIN IMMEDIATE"); denied(() => f.store.list(), "transaction-active"); f.db.exec("ROLLBACK");
    const empty = new Database(":memory:"); try { denied(() => new SqliteWindowsOperatorTaskStore(empty, f.id, f.policyStore), "schema-invalid");
      assert.deepEqual(empty.prepare("SELECT name FROM sqlite_schema").all(), []); } finally { empty.close(); }
  } finally { f.dispose(); }
});

test("task history rolls back a partial create if its event insert fails", () => {
  const f = fixture(); try {
    const original = f.db.prepare.bind(f.db), before = f.db.serialize();
    Object.defineProperty(f.db, "prepare", { configurable: true, value: (sql: string) => {
      if (sql.startsWith("INSERT INTO operator_task_events")) throw new Error("injected write failure"); return original(sql); } });
    denied(() => f.store.create(randomUUID(), 1, f.wire), "storage-unavailable");
    Object.defineProperty(f.db, "prepare", { configurable: true, value: original });
    assert.deepEqual(f.store.list(), []); assert.deepEqual(f.db.serialize(), before);
  } finally { f.dispose(); }
});

test("task creation recovers the committed receipt after post-commit response loss without a duplicate event", () => {
  const f = fixture(); try {
    const original = f.db.transaction.bind(f.db); let failOnce = true;
    Object.defineProperty(f.db, "transaction", { configurable: true, value: (fn: () => unknown) => {
      const tx = original(fn); return { deferred: () => tx.deferred(), immediate: () => {
        const result = tx.immediate(); if (failOnce) { failOnce = false; throw new Error("response lost after commit"); } return result; } }; } });
    const id = randomUUID(); denied(() => f.store.create(id, 1, f.wire), "storage-unavailable");
    const clock = f.clockReads(), recovered = f.store.create(id, 1, f.wire); assert.equal(recovered.revision, 1); assert.equal(f.clockReads(), clock);
    assert.deepEqual(f.db.prepare("SELECT count(*) AS n FROM operator_task_events").get(), { n: 1 });
  } finally { f.dispose(); }
});

test("task history rejects corrupt JSON, raw invalid UTF-8, mismatched digests and missing creation events", () => {
  for (const kind of ["json", "utf8", "digest", "creation"] as const) {
    const f = fixture(); try {
      const id = randomUUID(); f.store.create(id, 1, f.wire);
      if (kind === "json") f.db.prepare("UPDATE operator_tasks SET brief_json=?").run("{}");
      if (kind === "utf8") f.db.exec("UPDATE operator_tasks SET brief_json=CAST(X'7bff7d' AS TEXT)");
      if (kind === "digest") f.db.prepare("UPDATE operator_task_events SET event_digest=?").run(d(99));
      if (kind === "creation") f.db.exec("DELETE FROM operator_task_events");
      denied(() => f.store.read(id, 1), "state-invalid");
    } finally { f.dispose(); }
  }
});

test("task quotas have an explicit closed-history cleanup path that preserves active drafts", () => {
  const f = fixture(); try {
    const ids = Array.from({ length: OPERATOR_TASK_STORE_LIMITS.tasks }, () => randomUUID());
    for (const id of ids) f.store.create(id, 1, f.wire);
    const next = randomUUID(); denied(() => f.store.create(next, 1, f.wire), "task-limit");
    const old = f.store.read(ids[0]!, 1); denied(() => f.store.forgetClosed(old.taskId, 1, old.briefDigest), "forget-denied");
    f.store.close(randomUUID(), old.taskId, 1, 1); denied(() => f.store.forgetClosed(old.taskId, 1, d(99)), "forget-denied");
    assert.equal(f.store.forgetClosed(old.taskId, 1, old.briefDigest), "forgotten");
    assert.equal(f.store.forgetClosed(old.taskId, 1, old.briefDigest), "absent");
    assert.equal(f.store.readCreationEpoch().creationEpoch, 2);
    denied(() => f.store.create(old.taskId, 1, f.wire), "creation-epoch-stale");
    denied(() => f.store.create(next, 1, f.wire), "creation-epoch-stale");
    assert.equal(f.store.create(next, 2, f.wire).revision, 1); assert.equal(f.store.list().length, 32);
    denied(() => f.store.read(old.taskId, 1), "missing");
  } finally { f.dispose(); }
});

test("task writes reject regressing or invalid clocks while exact retries remain clock-independent", () => {
  const f = fixture(); try {
    const id = randomUUID(), created = f.store.create(id, 1, f.wire);
    f.setTime("2026-09-08T23:59:59.999Z"); denied(() => f.store.close(randomUUID(), id, 1, 1), "clock-invalid");
    f.setTime("2026-09-09T00:00:01Z"); denied(() => f.store.close(randomUUID(), id, 1, 1), "clock-invalid");
    assert.deepEqual(f.store.create(id, 1, f.wire), created); assert.equal(f.store.read(id, 1).revision, 1);
  } finally { f.dispose(); }
});

test("cleanup advances its epoch atomically, preserves other receipts and never permits silent recreation by an old outbox", () => {
  const f = fixture(); try {
    const removed = randomUUID(), retained = randomUUID();
    f.store.create(removed, 1, f.wire); const original = f.store.create(retained, 1, f.wire);
    f.store.close(randomUUID(), removed, 1, 1); const hash = f.store.read(removed, 1).briefDigest;
    const prepare = f.db.prepare.bind(f.db);
    Object.defineProperty(f.db, "prepare", { configurable: true, value: (sql: string) => {
      if (sql.startsWith("UPDATE operator_task_meta SET creation_epoch")) throw new Error("epoch write failure"); return prepare(sql); } });
    denied(() => f.store.forgetClosed(removed, 1, hash), "storage-unavailable");
    Object.defineProperty(f.db, "prepare", { configurable: true, value: prepare });
    assert.equal(f.store.read(removed, 1).closed, true); assert.equal(f.store.readCreationEpoch().creationEpoch, 1);
    assert.equal(f.store.forgetClosed(removed, 1, hash), "forgotten");
    assert.deepEqual(f.store.create(retained, 1, f.wire), original); // known receipts survive epoch rotation
    denied(() => f.store.create(removed, 1, f.wire), "creation-epoch-stale");
    const oldClock = f.clockReads(); assert.equal(f.store.forgetClosed(removed, 1, hash), "absent"); assert.equal(f.clockReads(), oldClock);
    assert.equal(f.store.readCreationEpoch().creationEpoch, 2);
    denied(() => f.store.readOperation(retained, d(99)), "request-conflict");
  } finally { f.dispose(); }
});

test("task history rejects oversized stored rows and future epochs before materializing their full text", () => {
  for (const kind of ["brief", "event", "epoch"] as const) {
    const f = fixture(); try {
      const id = randomUUID(); f.store.create(id, 1, f.wire);
      if (kind === "epoch") f.db.exec("UPDATE operator_tasks SET creation_epoch=2");
      else {
        f.db.pragma("ignore_check_constraints=ON");
        if (kind === "brief") f.db.prepare("UPDATE operator_tasks SET brief_json=?").run("x".repeat(196609));
        else f.db.prepare("UPDATE operator_task_events SET event_json=?").run("x".repeat(4097));
        f.db.pragma("ignore_check_constraints=OFF");
      }
      denied(() => f.store.list(), "state-invalid");
    } finally { f.dispose(); }
  }
});

test("all task selectors bind the epoch and reject delayed operations against a deliberately recreated UUID", { skip: process.platform !== "win32" }, async () => {
  const f = fixture(); try {
    const id = randomUUID(), c = await candidate(f), created = f.store.create(id, 1, f.wire);
    const closed = f.store.close(randomUUID(), id, 1, 1), hash = f.store.read(id, 1).briefDigest;
    f.store.forgetClosed(id, 1, hash);
    const replacement = f.store.create(id, 2, f.wire);
    assert.equal(replacement.creationEpoch, 2); assert.notEqual(replacement.requestDigest, created.requestDigest);
    denied(() => f.store.read(id, 1), "task-epoch-mismatch");
    denied(() => f.store.close(closed.requestId, id, 1, 1), "task-epoch-mismatch");
    denied(() => f.store.recordCandidate(randomUUID(), id, 1, 1, c), "task-epoch-mismatch");
    denied(() => f.store.forgetClosed(id, 1, hash), "task-epoch-mismatch");
    denied(() => f.store.readOperation(id, created.requestDigest), "request-conflict");
    assert.equal(f.store.read(id, 2).closed, false); assert.equal(f.store.list()[0]!.creationEpoch, 2);
    assert.equal(f.store.list()[0]!.storeId, f.id);
  } finally { f.dispose(); }
});

test("candidate fingerprints persist without source bytes or renewed producer provenance and old operations survive later revisions", { skip: process.platform !== "win32" }, async () => {
  const f = fixture(); try {
    const c = await candidate(f), id = randomUUID(); f.store.create(id, 1, f.wire);
    denied(() => f.store.recordCandidate(randomUUID(), id, 1, 1, structuredClone(c)), "candidate-untrusted");
    const recorded = f.store.recordCandidate(randomUUID(), id, 1, 1, c);
    assert.equal(recorded.candidate?.candidateDigest, c.candidateDigest); assert.equal(isManagedEditCandidate(recorded.candidate), false);
    const otherDb = f.open(), other = new SqliteWindowsOperatorTaskStore(otherDb, f.id, f.policyStore, f.clock);
    denied(() => other.close(randomUUID(), id, 1, 1), "revision-conflict");
    const closed = other.close(randomUUID(), id, 1, 2); assert.equal(closed.revision, 3);
    assert.deepEqual(f.store.recordCandidate(recorded.requestId, id, 1, 1, c), recorded);
    assert.ok(!f.db.serialize().includes(Buffer.from("PRIVATE_SOURCE_SENTINEL")));
    const read = other.read(id, 1); assert.equal(read.closed, true); assert.equal(read.latestCandidate?.candidateDigest, c.candidateDigest);
    assert.equal(read.approvalAvailable, false);
  } finally { f.dispose(); }
});

test("candidate history reserves its final revision for close and cleanup instead of permanently filling a draft", { skip: process.platform !== "win32" }, async () => {
  const f = fixture(); try {
    const c = await candidate(f), id = randomUUID(); f.store.create(id, 1, f.wire);
    for (let revision = 1; revision < 63; revision++) assert.equal(f.store.recordCandidate(randomUUID(), id, 1, revision, c).revision, revision + 1);
    denied(() => f.store.recordCandidate(randomUUID(), id, 1, 63, c), "revision-limit");
    assert.equal(f.store.close(randomUUID(), id, 1, 63).revision, 64);
    assert.equal(f.store.forgetClosed(id, 1, f.store.read(id, 1).briefDigest), "forgotten");
  } finally { f.dispose(); }
});
