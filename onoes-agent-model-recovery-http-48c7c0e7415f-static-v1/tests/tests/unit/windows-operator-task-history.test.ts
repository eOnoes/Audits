import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Database from "better-sqlite3";
import { canonicalJson, canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import { initializeWindowsWorkspacePolicyStore, SqliteWindowsWorkspacePolicyStore } from "../../src/build-only/windows-workspace-policy-store.js";
import { initializeWindowsOperatorTaskStore, SqliteWindowsOperatorTaskStore, OperatorTaskStoreError } from "../../src/build-only/windows-operator-task-store.js";
import { accessOperatorTaskHistory, parseOperatorTaskHistoryRequest, computeOperatorTaskHistoryOperationDigest,
  OPERATOR_TASK_HISTORY_MAX_BODY_BYTES, OPERATOR_TASK_HISTORY_MAX_RESPONSE_BYTES } from "../../src/build-only/windows-operator-task-history.js";

function fixture() {
  const policyDb = new Database(":memory:"), taskDb = new Database(":memory:"); initializeWindowsWorkspacePolicyStore(policyDb);
  const policy = new SqliteWindowsWorkspacePolicyStore(policyDb, () => "2026-09-09T00:00:00.000Z");
  policy.update({ requestId: randomUUID(), expectedBinding: policy.snapshot().binding,
    rules: { allowedRoots: [{ path: "D:\\Work", access: "read-write" }], deniedRoots: ["C:\\"] } });
  const storeId = initializeWindowsOperatorTaskStore(taskDb), store = new SqliteWindowsOperatorTaskStore(taskDb, storeId, policy);
  const brief = { schemaVersion: "agent-operator-task-intake-input/v1", expectedBinding: policy.snapshot().binding,
    objective: "Correct a label.", workspaceRoot: "D:\\Work", requestedReadFiles: ["src/a.ts"], requestedWriteFiles: ["src/a.ts"],
    acceptanceCriteria: ["Label is correct."] };
  const create = { action: "create", storeId, creationEpoch: 1, requestId: randomUUID(), brief };
  return { store, storeId, policy, policyDb, taskDb, brief, create: hashed(create),
    dispose() { policyDb.close(); taskDb.close(); } };
}
// This is a hash, NOT a signature or authority token.
function hashed<T>(core: T) { return { ...core, expectedOperationDigest: computeOperatorTaskHistoryOperationDigest(core) }; }
function denies(fn: () => unknown, reason: string) { assert.throws(fn, e => e instanceof OperatorTaskStoreError && e.reason === reason); }

test("history contract binds response and original operation without mutating policy or granting authority", () => {
  const f = fixture(); try {
    const before = f.policyDb.serialize(), index = accessOperatorTaskHistory({ action: "index" }, f.store);
    assert.deepEqual(index.value, { storeId: f.storeId, creationEpoch: 1, tasks: [] });
    const created = accessOperatorTaskHistory(f.create, f.store);
    assert.equal(created.requestDigest, canonicalSha256Digest(f.create));
    assert.deepEqual(created.value, f.store.readOperation(f.create.requestId, f.create.expectedOperationDigest));
    assert.equal(created.authority, "none"); assert.equal(created.executionEnabled, false); assert.equal(created.approvalAvailable, false);
    assert.equal(created.resumeRequirement, "fresh-policy-inspection-and-planning"); assert.ok(Object.isFrozen(created));
    assert.deepEqual(accessOperatorTaskHistory(f.create, f.store), created);
    const selector = { storeId: f.storeId, taskId: f.create.requestId, creationEpoch: 1 };
    assert.deepEqual(accessOperatorTaskHistory({ action: "read", ...selector }, f.store).value, f.store.read(selector.taskId, 1));
    assert.deepEqual(f.policyDb.serialize(), before);
  } finally { f.dispose(); }
});

test("history mutation digest is checked before writing and exact receipts remain readable after revocation and close", () => {
  const f = fixture(); try {
    denies(() => accessOperatorTaskHistory({ ...f.create, expectedOperationDigest: `sha256:${"0".repeat(64)}` }, f.store), "request-invalid");
    assert.equal(f.store.list().length, 0);
    const created = accessOperatorTaskHistory(f.create, f.store);
    f.policy.update({ requestId: randomUUID(), expectedBinding: f.policy.snapshot().binding,
      rules: { allowedRoots: [], deniedRoots: ["C:\\"] } });
    assert.deepEqual(accessOperatorTaskHistory(f.create, f.store), created);
    const close = hashed({ action: "close", storeId: f.storeId, taskId: f.create.requestId, creationEpoch: 1,
      requestId: randomUUID(), expectedRevision: 1, briefDigest: canonicalSha256Digest(f.brief) });
    const closed = accessOperatorTaskHistory(close, f.store);
    assert.deepEqual(accessOperatorTaskHistory(close, f.store), closed);
    assert.deepEqual(accessOperatorTaskHistory({ action: "receipt", storeId: f.storeId, requestId: f.create.requestId,
      expectedOperationDigest: f.create.expectedOperationDigest }, f.store).value, created.value);
    assert.equal(f.store.read(f.create.requestId, 1).closed, true);
    const changed = hashed({ ...f.create, brief: { ...f.brief, objective: "Different." } });
    denies(() => accessOperatorTaskHistory(changed, f.store), "request-conflict");
    denies(() => accessOperatorTaskHistory(hashed({ ...f.create, requestId: randomUUID() }), f.store), "policy-denied");
  } finally { f.dispose(); }
});

test("history never routes old requests to a new store or silently refreshes a forgotten epoch", () => {
  const f = fixture(); try {
    for (const action of [f.create, { action: "read", taskId: f.create.requestId, creationEpoch: 1 },
      { action: "receipt", requestId: f.create.requestId, expectedOperationDigest: f.create.expectedOperationDigest }]) {
      denies(() => accessOperatorTaskHistory({ ...action, storeId: randomUUID() }, f.store), "store-identity-mismatch");
    }
    accessOperatorTaskHistory(f.create, f.store);
    f.store.close(randomUUID(), f.create.requestId, 1, 1);
    f.store.forgetClosed(f.create.requestId, 1, canonicalSha256Digest(f.brief));
    assert.deepEqual(f.store.listSnapshot(), { storeId: f.storeId, creationEpoch: 2, tasks: [] });
    denies(() => accessOperatorTaskHistory(f.create, f.store), "creation-epoch-stale");
    const newer = hashed({ ...f.create, creationEpoch: 2 }); accessOperatorTaskHistory(newer, f.store);
    denies(() => accessOperatorTaskHistory({ action: "read", storeId: f.storeId, taskId: f.create.requestId, creationEpoch: 1 }, f.store), "task-epoch-mismatch");
    denies(() => accessOperatorTaskHistory({ action: "receipt", storeId: f.storeId, requestId: f.create.requestId,
      expectedOperationDigest: f.create.expectedOperationDigest }, f.store), "request-conflict");
  } finally { f.dispose(); }
});

test("history denies extra authority, unsupported actions, cloned wire ambiguity and mutable inputs", () => {
  const f = fixture(); try {
    const before = f.taskDb.serialize();
    for (const input of [null, [], { action: "index", executionEnabled: true }, { action: "forget" }, { action: "record-candidate" },
      { ...f.create, brief: { ...f.brief, approval: true } }, { ...f.create, brief: undefined },
      { ...f.create, brief: { ...f.brief, objective: "api_key=" + "x".repeat(24) } },
      { ...f.create, brief: "x".repeat(OPERATOR_TASK_HISTORY_MAX_BODY_BYTES) },
      Object.defineProperty({}, "action", { enumerable: true, get() { assert.fail("getter invoked"); } })]) {
      denies(() => accessOperatorTaskHistory(input, f.store), "request-invalid");
    }
    assert.deepEqual(f.taskDb.serialize(), before);
    const copy = structuredClone(f.create), parsed = parseOperatorTaskHistoryRequest(copy);
    copy.brief.objective = "changed"; assert.equal(canonicalJson(parsed), canonicalJson(f.create));
    assert.ok(Object.isFrozen(parsed));
  } finally { f.dispose(); }
});

test("full task index and 128-file briefs fit the response ceiling", () => {
  const f = fixture(); try {
    const names = Array.from({ length: 128 }, (_, i) => `src/${i.toString().padStart(3, "0")}-${"a".repeat(170)}.ts`);
    const brief = { ...f.brief, objective: "x".repeat(2048), requestedReadFiles: names, requestedWriteFiles: [...names],
      acceptanceCriteria: Array.from({ length: 32 }, (_, i) => `${i}-${"y".repeat(508)}`) };
    for (let i = 0; i < 32; i++) {
      const req = hashed({ ...f.create, requestId: randomUUID(), brief });
      accessOperatorTaskHistory(req, f.store);
      const read = accessOperatorTaskHistory({ action: "read", storeId: f.storeId, taskId: req.requestId, creationEpoch: 1 }, f.store);
      assert.ok(Buffer.byteLength(canonicalJson(read)) < OPERATOR_TASK_HISTORY_MAX_RESPONSE_BYTES);
    }
    const index = accessOperatorTaskHistory({ action: "index" }, f.store);
    assert.ok(Buffer.byteLength(canonicalJson(index)) < OPERATOR_TASK_HISTORY_MAX_RESPONSE_BYTES);
    assert.equal(f.store.list().length, 32);
  } finally { f.dispose(); }
});
