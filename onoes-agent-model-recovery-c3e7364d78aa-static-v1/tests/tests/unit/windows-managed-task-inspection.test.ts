import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import Database from "better-sqlite3";
import { canonicalJson, canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import { sha256BuilderDigest } from "../../src/builder/content-policy.js";
import { parseWindowsWorkspacePolicy } from "../../src/build-only/windows-workspace-policy.js";
import { initializeWindowsWorkspacePolicyStore, SqliteWindowsWorkspacePolicyStore } from "../../src/build-only/windows-workspace-policy-store.js";
import { WindowsManagedTaskInspector, isManagedTaskInspection, MANAGED_TASK_INSPECTION_LIMITS,
  type ManagedTaskInspectionOptions } from "../../src/build-only/windows-managed-task-inspection.js";

const d = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`;
const windowsTest = (name: string, fn: () => Promise<void>) => test(name, { skip: process.platform !== "win32" }, fn);
function fixture() {
  const policy = parseWindowsWorkspacePolicy({ schemaVersion: "agent-windows-workspace-policy/v1", revision: 2,
    allowedRoots: [{ path: "D:\\Source", access: "read-write" }, { path: "D:\\Managed", access: "read-write" }], deniedRoots: ["C:\\"] });
  let current = { policy, binding: { storeId: "11111111-1111-4111-8111-111111111111", revision: 2, policyDigest: canonicalSha256Digest(policy) } };
  let blocked = false;
  const request = { schemaVersion: "agent-operator-task-intake-input/v1", expectedBinding: current.binding,
    objective: "Correct the label.", workspaceRoot: "D:\\Source", requestedReadFiles: ["src/status.ts", "tests/status.ts"],
    requestedWriteFiles: ["src/status.ts"], acceptanceCriteria: ["Label matches the requirement."] };
  const workspace = { workspaceDigest: d(1), repositoryRoot: "D:\\Source", worktreeRoot: "D:\\Managed", worktreeAttestationDigest: d(2) };
  const files = new Map<string, Buffer>([["src/status.ts", Buffer.from("\ufeffexport const status = 'old';\n")], ["tests/status.ts", Buffer.from("assert(status);\n")]]);
  const trace: string[] = [];
  const session = {
    async assertCustody() { trace.push("custody"); },
    async read(path: string, cap: number, _signal: AbortSignal): Promise<Uint8Array> {
      trace.push(`read:${path}:${cap}`); const bytes = files.get(path)!;
      if (bytes.length > cap) throw new Error("native-overflow"); return Buffer.from(bytes);
    },
    async close() { trace.push("close"); },
    async replace() { throw new Error("inspection-must-never-write"); },
  };
  const options: ManagedTaskInspectionOptions = { workspace, io: { workspaceDigest: workspace.workspaceDigest,
    async openCustody() { trace.push("open"); return session; } },
    policy: { snapshot: () => current,
      assertCurrentBinding(binding) { assert.equal(canonicalJson(binding), canonicalJson(current.binding)); },
      listEffectIntents: () => blocked ? [{ schemaVersion: "agent-workspace-effect-intent/v1", settlement: null,
        operationId: "33333333-3333-4333-8333-333333333333", authorizationDigest: d(3), requestDigest: d(4),
        binding: current.binding, startedAt: "2026-09-08T00:00:00.000Z" }] : [],
    } };
  return { options, request, files, trace, session, wire: () => canonicalJson(request),
    block: () => { blocked = true; },
    revoke: () => {
      const next = parseWindowsWorkspacePolicy({ ...current.policy, revision: current.policy.revision + 1, allowedRoots: [] });
      current = { policy: next, binding: { ...current.binding, revision: next.revision, policyDigest: canonicalSha256Digest(next) } };
    } };
}

windowsTest("managed inspection binds exact brief, copied host identity and BOM-preserving complete files under one session", async () => {
  const f = fixture(), inspector = new WindowsManagedTaskInspector(f.options);
  const result = await inspector.inspect(f.wire());
  assert.equal(result.requestDigest, canonicalSha256Digest(f.request));
  const { inspectionDigest, ...core } = result; assert.equal(inspectionDigest, canonicalSha256Digest(core));
  assert.equal(result.files.length, 2); assert.equal(result.files[0]!.text.charCodeAt(0), 0xfeff);
  for (const file of result.files) { assert.equal(file.contentDigest, sha256BuilderDigest(f.files.get(file.relativePath)!));
    assert.equal(file.byteLength, Buffer.byteLength(file.text)); }
  assert.equal(result.readPayloadBytes, result.totalBytes * 2);
  assert.equal(result.executionEnabled, false); assert.equal(result.workTaskCreated, false); assert.equal(result.persisted, false);
  assert.equal(result.authority, "none"); assert.equal(isManagedTaskInspection(result), true);
  assert.equal(isManagedTaskInspection(structuredClone(result)), false); assert.equal(isManagedTaskInspection(new Proxy(result, {})), false);
  assert.equal(Object.isFrozen(result.files[0]), true);
  assert.deepEqual(f.trace.map(x => x.split(":")[0]), ["open", "custody", "read", "read", "read", "read", "custody", "close"]);
  assert.equal(f.files.get("src/status.ts")!.at(0), 0xef);
  Object.assign(f.options.workspace, { repositoryRoot: "D:\\Changed" });
  assert.equal((await inspector.inspect(f.wire())).workspace.repositoryRoot, "D:\\Source");
});

windowsTest("managed inspection denies invalid wire, stale brief, source substitution, missing managed permission and pending recovery before custody", async () => {
  for (const kind of ["wire", "stale", "source", "managed", "blocked"] as const) {
    const f = fixture(); let options = f.options;
    if (kind === "stale") f.revoke();
    if (kind === "source") options = { ...options, workspace: { ...options.workspace, repositoryRoot: "D:\\Other" } };
    if (kind === "managed") options = { ...options, workspace: { ...options.workspace, worktreeRoot: "C:\\Managed" } };
    if (kind === "blocked") f.block();
    await assert.rejects(new WindowsManagedTaskInspector(options).inspect(kind === "wire" ? f.wire() + "\n" : f.wire()), /managed-task-inspection-/);
    assert.deepEqual(f.trace, []);
  }
  const f = fixture();
  assert.throws(() => new WindowsManagedTaskInspector({ ...f.options, io: { ...f.options.io, workspaceDigest: d(90) } }), /workspace-mismatch/);
  for (const totalTimeoutMs of [0, 30_001, Infinity, NaN])
    assert.throws(() => new WindowsManagedTaskInspector({ ...f.options, totalTimeoutMs }), /invalid-request/);
});

windowsTest("managed inspection rechecks revocation after acquisition, each read, final custody and close", async () => {
  for (const seam of ["open", "first-read", "last-read", "last-custody", "close"] as const) {
    const f = fixture(); let reads = 0, custody = 0;
    const read = f.session.read.bind(f.session), hold = f.session.assertCustody.bind(f.session), close = f.session.close.bind(f.session);
    f.session.read = async (...args) => { const out = await read(...args); if (++reads === (seam === "first-read" ? 1 : seam === "last-read" ? 4 : -1)) f.revoke(); return out; };
    f.session.assertCustody = async () => { await hold(); if (++custody === 2 && seam === "last-custody") f.revoke(); };
    f.session.close = async () => { await close(); if (seam === "close") f.revoke(); };
    const io = { ...f.options.io, async openCustody() { f.trace.push("open"); if (seam === "open") f.revoke(); return f.session; } };
    await assert.rejects(new WindowsManagedTaskInspector({ ...f.options, io }).inspect(f.wire()), /policy-denied/);
    assert.equal(f.trace.at(-1), "close"); if (seam === "open") assert.equal(reads, 0);
  }
});

windowsTest("managed inspection denies changed bytes on exact second-pass reads and never publishes partial contents", async () => {
  const f = fixture(), read = f.session.read.bind(f.session); let n = 0;
  f.session.read = async (...args) => { if (++n === 3) f.files.set("src/status.ts", Buffer.from("changed")); return read(...args); };
  await assert.rejects(new WindowsManagedTaskInspector(f.options).inspect(f.wire()), { message: "managed-task-inspection-changed-during-inspection" });
  assert.equal(f.trace.at(-1), "close");
});

windowsTest("managed inspection rejects malformed text and secret-like content without echoing it", async () => {
  for (const bytes of [Buffer.from([0xff]), Buffer.from("a\0b"), Buffer.from("api_key=" + "x".repeat(24))]) {
    const f = fixture(); f.files.set("src/status.ts", bytes);
    await assert.rejects(new WindowsManagedTaskInspector(f.options).inspect(f.wire()), { message: "managed-task-inspection-content-rejected" });
    assert.equal(f.trace.at(-1), "close");
  }
});

windowsTest("managed inspection snapshots adapter bytes without getters and rejects proxy, shared, detached and over-budget views", async () => {
  for (const kind of ["getter", "proxy", "shared", "detached", "oversize"] as const) {
    const f = fixture(); f.request.requestedReadFiles = ["src/status.ts"]; let touched = 0;
    let bytes: Uint8Array = Buffer.from("ok");
    if (kind === "getter") for (const key of ["buffer", "byteLength", "byteOffset"]) Object.defineProperty(bytes, key, { get() { touched++; throw new Error("getter"); } });
    // Promise resolution itself looks up `then` before the inspector receives
    // the value. Permit that language-level lookup; forbid all byte reflection.
    if (kind === "proxy") bytes = new Proxy(bytes, { get(_target, key) { if (key === "then") return undefined; touched++; throw new Error("proxy"); } });
    if (kind === "shared") bytes = new Uint8Array(new SharedArrayBuffer(2));
    if (kind === "detached") { bytes = new Uint8Array(2); structuredClone(bytes.buffer, { transfer: [bytes.buffer as ArrayBuffer] }); }
    if (kind === "oversize") bytes = new Uint8Array(MANAGED_TASK_INSPECTION_LIMITS.fileBytes + 1);
    f.session.read = async () => bytes;
    const inspection = new WindowsManagedTaskInspector(f.options).inspect(f.wire());
    if (kind === "getter") assert.equal((await inspection).files[0]!.text, "ok");
    else await assert.rejects(inspection, /managed-task-inspection-(io-failed|budget-exceeded)/);
    assert.equal(touched, 0, kind); assert.equal(f.trace.at(-1), "close");
  }
});

windowsTest("managed inspection enforces exact aggregate and file ceilings without accepting a prefix", async () => {
  const f = fixture(); f.request.requestedReadFiles = Array.from({ length: 8 }, (_, i) => `src/${i}.ts`); f.request.requestedWriteFiles = [];
  for (const path of f.request.requestedReadFiles) f.files.set(path, Buffer.alloc(MANAGED_TASK_INSPECTION_LIMITS.fileBytes, 65));
  const out = await new WindowsManagedTaskInspector(f.options).inspect(f.wire());
  assert.equal(out.totalBytes, MANAGED_TASK_INSPECTION_LIMITS.totalBytes);
  assert.equal(out.readPayloadBytes, MANAGED_TASK_INSPECTION_LIMITS.readPayloadBytes);
  f.request.requestedReadFiles.push("src/9.ts"); f.files.set("src/9.ts", Buffer.from("x"));
  await assert.rejects(new WindowsManagedTaskInspector(f.options).inspect(f.wire()), /io-failed/);
  assert.equal(f.trace.at(-1), "close");
});

windowsTest("managed inspection handles maximum path count and complete empty files", async () => {
  const f = fixture(); f.request.requestedReadFiles = Array.from({ length: 128 }, (_, i) => `src/${i}.ts`); f.request.requestedWriteFiles = [];
  for (const path of f.request.requestedReadFiles) f.files.set(path, Buffer.alloc(0));
  const out = await new WindowsManagedTaskInspector(f.options).inspect(f.wire());
  assert.equal(out.files.length, 128); assert.equal(out.totalBytes, 0);
  assert.equal(f.trace.filter(s => s.startsWith("read:")).length, 256);
});

windowsTest("managed inspection handles pre-abort and abort at settled-read/close seams without a result", async () => {
  for (const seam of ["before", "read", "close"] as const) {
    const f = fixture(), controller = new AbortController(), read = f.session.read.bind(f.session), close = f.session.close.bind(f.session);
    if (seam === "before") controller.abort();
    f.session.read = async (...args) => { const bytes = await read(...args); if (seam === "read") controller.abort(); return bytes; };
    f.session.close = async () => { await close(); if (seam === "close") controller.abort(); };
    await assert.rejects(new WindowsManagedTaskInspector(f.options).inspect(f.wire(), controller.signal), /cancelled/);
    if (seam === "before") assert.deepEqual(f.trace, []); else assert.equal(f.trace.at(-1), "close");
  }
});

windowsTest("managed inspection is single-flight and a late custody acquisition is closed after timeout", async () => {
  const f = fixture(); let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const inspector = new WindowsManagedTaskInspector({ ...f.options, stepTimeoutMs: 20, cancellationGraceMs: 10,
    io: { ...f.options.io, async openCustody() { await pending; return f.session; } } });
  const first = inspector.inspect(f.wire());
  await assert.rejects(inspector.inspect(f.wire()), /busy/);
  await assert.rejects(first, /timeout/);
  await assert.rejects(inspector.inspect(f.wire()), /poisoned/);
  release(); await delay(10); assert.deepEqual(f.trace, ["close"]);
});

windowsTest("managed inspection poisons on unsettled read, failed close or unconfirmed close and never attempts another read", async () => {
  for (const kind of ["read", "close-reject", "close-pending"] as const) {
    const f = fixture(); let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    if (kind === "read") f.session.read = async () => { f.trace.push("pending-read"); await pending; return Buffer.from("late"); };
    if (kind === "close-reject") f.session.close = async () => { f.trace.push("close"); throw new Error("do not leak this"); };
    if (kind === "close-pending") f.session.close = async () => { f.trace.push("close"); await pending; };
    const inspector = new WindowsManagedTaskInspector({ ...f.options, stepTimeoutMs: 30, cancellationGraceMs: 5 });
    await assert.rejects(inspector.inspect(f.wire()), /managed-task-inspection-(timeout|unsettled-work)/);
    const length = f.trace.length; await assert.rejects(inspector.inspect(f.wire()), /poisoned/); assert.equal(f.trace.length, length);
    release(); await delay(5);
  }
});

windowsTest("managed inspection does not reset the total deadline for each file", async () => {
  const f = fixture(), read = f.session.read.bind(f.session);
  f.session.read = async (...args) => { await delay(20); return read(...args); };
  const inspector = new WindowsManagedTaskInspector({ ...f.options, totalTimeoutMs: 45, stepTimeoutMs: 100, cancellationGraceMs: 100 });
  await assert.rejects(inspector.inspect(f.wire()), /timeout/); assert.equal(f.trace.at(-1), "close");
  assert.ok(f.trace.filter(x => x.startsWith("read:")).length < 4);
});

windowsTest("managed inspection performs read-only policy checks against real SQLite with unchanged bytes and no transaction over I/O", async () => {
  const f = fixture(), db = new Database(":memory:");
  try {
    initializeWindowsWorkspacePolicyStore(db); const store = new SqliteWindowsWorkspacePolicyStore(db);
    store.update({ requestId: "22222222-2222-4222-8222-222222222222", expectedBinding: store.snapshot().binding,
      rules: { allowedRoots: f.options.policy.snapshot().policy.allowedRoots, deniedRoots: ["C:\\"] } });
    f.request.expectedBinding = store.snapshot().binding;
    const before = db.serialize(), read = f.session.read.bind(f.session);
    f.session.read = async (...args) => { assert.equal(db.inTransaction, false); return read(...args); };
    const result = await new WindowsManagedTaskInspector({ ...f.options, policy: store }).inspect(f.wire());
    assert.equal(result.liveFilesRead, true); assert.deepEqual(db.serialize(), before); assert.deepEqual(store.listEffectIntents(), []);
  } finally { db.close(); }
});

test("managed inspector refuses unsupported hosts rather than claiming Windows evidence", { skip: process.platform === "win32" }, async () => {
  const f = fixture(); await assert.rejects(new WindowsManagedTaskInspector(f.options).inspect(f.wire()), /unsupported-platform/);
  assert.deepEqual(f.trace, []);
});
