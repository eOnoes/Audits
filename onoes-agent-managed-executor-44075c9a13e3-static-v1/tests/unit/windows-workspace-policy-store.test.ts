import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import test from "node:test";
import { canonicalJson } from "../../src/compatibility/canonical-json.js";
import { DEFAULT_WINDOWS_WORKSPACE_POLICY } from "../../src/build-only/windows-workspace-policy.js";
import {
  initializeWindowsWorkspacePolicyStore,
  SqliteWindowsWorkspacePolicyStore,
  WorkspacePolicyStoreError,
} from "../../src/build-only/windows-workspace-policy-store.js";
import type { WorkspacePolicyBinding } from "../../src/build-only/windows-workspace-policy-store.js";

const NOW = "2026-09-05T17:00:00.000Z";
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "onoes-workspace-policy-"));
  const path = join(directory, "policy.sqlite");
  const handles: Database.Database[] = [];
  const open = () => { const database = new Database(path); handles.push(database); return database; };
  const database = open();
  initializeWindowsWorkspacePolicyStore(database);
  const store = new SqliteWindowsWorkspacePolicyStore(database, () => NOW);
  return {
    directory, path, database, store, open,
    dispose() {
      for (const handle of handles) if (handle.open) handle.close();
      const target = resolve(directory);
      if (!target.startsWith(resolve(tmpdir()) + "\\onoes-workspace-policy-")
        && !target.startsWith(resolve(tmpdir()) + "/onoes-workspace-policy-")) throw new Error("unsafe-test-cleanup");
      rmSync(target, { recursive: true, force: true });
    },
  };
}
function request(binding: WorkspacePolicyBinding) {
  return {
    requestId: randomUUID(), expectedBinding: binding,
    rules: { allowedRoots: [{ path: "D:\\Projects", access: "read-write" }], deniedRoots: ["C:\\", "D:\\Projects\\private"] },
  };
}
function denies(operation: () => unknown, reason: string) {
  assert.throws(operation, (error: unknown) => error instanceof WorkspacePolicyStoreError && error.reason === reason);
}

test("workspace store initializes denied, uses WAL+FULL and keeps immutable snapshots", () => {
  const f = fixture();
  try {
    const current = f.store.snapshot();
    assert.deepEqual(current.policy, DEFAULT_WINDOWS_WORKSPACE_POLICY);
    assert.equal(f.database.pragma("journal_mode", { simple: true }), "wal");
    assert.equal(f.database.pragma("synchronous", { simple: true }), 2);
    assert.equal(f.database.pragma("busy_timeout", { simple: true }), 250);
    assert.ok(Object.isFrozen(current.binding));
    assert.ok(Object.isFrozen(current.policy.allowedRoots));
    f.store.assertCurrentBinding(current.binding);
    denies(() => initializeWindowsWorkspacePolicyStore(f.database), "schema-invalid");
  } finally { f.dispose(); }
});

test("policy update and receipt survive close/reopen; retry returns the exact committed receipt", () => {
  const f = fixture();
  try {
    const before = f.store.snapshot();
    const update = request(before.binding);
    const receipt = f.store.update(update);
    assert.equal(receipt.binding.revision, 2);
    assert.equal(receipt.previousBinding.storeId, receipt.binding.storeId);
    assert.equal(f.store.snapshot().policy.allowedRoots[0]?.path, "D:\\Projects");
    f.database.close();
    const reopened = new SqliteWindowsWorkspacePolicyStore(f.open(), () => { throw new Error("retry must not sample clock"); });
    assert.deepEqual(reopened.update(update), receipt);
    denies(() => reopened.assertCurrentBinding(before.binding), "stale-policy");
    reopened.assertCurrentBinding(receipt.binding);
    assert.equal(reopened.snapshot().binding.revision, 2);
  } finally { f.dispose(); }
});

test("two open connections cannot overwrite each other's stale policy", () => {
  const f = fixture();
  try {
    const other = new SqliteWindowsWorkspacePolicyStore(f.open(), () => NOW);
    const before = other.snapshot();
    f.store.update(request(before.binding));
    denies(() => other.update(request(before.binding)), "stale-policy");
    denies(() => other.assertCurrentBinding(before.binding), "stale-policy");
    assert.equal(other.snapshot().binding.revision, 2);
  } finally { f.dispose(); }
});

test("all policy edits revoke old bindings, including semantically identical updates", () => {
  const f = fixture();
  try {
    const initial = f.store.snapshot();
    const first = f.store.update(request(initial.binding));
    const secondRequest = request(first.binding);
    const second = f.store.update(secondRequest);
    assert.equal(second.binding.revision, 3);
    assert.notEqual(second.binding.policyDigest, first.binding.policyDigest);
    for (const binding of [initial.binding, first.binding, { ...second.binding, policyDigest: first.binding.policyDigest }]) {
      denies(() => f.store.assertCurrentBinding(binding), "stale-policy");
    }
    f.store.assertCurrentBinding(second.binding);
  } finally { f.dispose(); }
});

test("old idempotent retries after later updates never restore an older policy", () => {
  const f = fixture();
  try {
    const firstRequest = request(f.store.snapshot().binding);
    const first = f.store.update(firstRequest);
    const secondRequest = request(first.binding);
    secondRequest.rules.allowedRoots = [];
    const second = f.store.update(secondRequest);
    assert.deepEqual(f.store.update(firstRequest), first);
    assert.deepEqual(f.store.snapshot().binding, second.binding);
    assert.deepEqual(f.store.snapshot().policy.allowedRoots, []);
    denies(() => f.store.assertCurrentBinding(first.binding), "stale-policy");
    const altered = { ...firstRequest, rules: { ...firstRequest.rules, deniedRoots: [] } };
    denies(() => f.store.update(altered), "request-id-conflict");
  } finally { f.dispose(); }
});

test("recreated stores have different identities, even at the same revision and policy", () => {
  const first = fixture();
  const second = fixture();
  try {
    const a = first.store.snapshot();
    const b = second.store.snapshot();
    assert.equal(a.binding.policyDigest, b.binding.policyDigest);
    assert.notEqual(a.binding.storeId, b.binding.storeId);
    denies(() => second.store.assertCurrentBinding(a.binding), "stale-policy");
    denies(() => second.store.update(request(a.binding)), "stale-policy");
  } finally { first.dispose(); second.dispose(); }
});

test("missing, foreign, altered or emptied schemas are never silently initialized", () => {
  const empty = new Database(":memory:");
  try {
    denies(() => new SqliteWindowsWorkspacePolicyStore(empty), "schema-invalid");
    empty.exec("CREATE TABLE unrelated (value TEXT)");
    denies(() => initializeWindowsWorkspacePolicyStore(empty), "schema-invalid");
  } finally { empty.close(); }
  for (const sql of [
    "DELETE FROM workspace_policy_state",
    "DROP TABLE workspace_policy_updates",
    "ALTER TABLE workspace_policy_state ADD COLUMN drift TEXT",
    "CREATE TRIGGER unexpected AFTER UPDATE ON workspace_policy_state BEGIN SELECT 1; END",
    "CREATE TEMP TABLE workspace_policy_state (value TEXT)",
  ]) {
    const f = fixture();
    try {
      f.database.exec(sql);
      assert.throws(() => f.store.snapshot(), WorkspacePolicyStoreError);
      assert.throws(() => new SqliteWindowsWorkspacePolicyStore(f.database), WorkspacePolicyStoreError);
    } finally { f.dispose(); }
  }
});

test("state, receipt and history damage fail closed without resetting permissions", () => {
  for (const sql of [
    "UPDATE workspace_policy_state SET policy_json = '{}'",
    "UPDATE workspace_policy_state SET policy_digest = 'sha256:' || printf('%064d', 0)",
    "UPDATE workspace_policy_state SET revision = 3",
    "UPDATE workspace_policy_state SET store_id = 'invalid'",
    "UPDATE workspace_policy_updates SET receipt_json = '{}'",
    "UPDATE workspace_policy_updates SET receipt_digest = 'invalid'",
    "DELETE FROM workspace_policy_updates",
  ]) {
    const f = fixture();
    try {
      f.store.update(request(f.store.snapshot().binding));
      f.database.exec(sql);
      denies(() => f.store.snapshot(), "state-invalid");
      denies(() => new SqliteWindowsWorkspacePolicyStore(f.database), "state-invalid");
    } finally { f.dispose(); }
  }
});

test("malformed update envelopes cannot choose revisions, bypass C policy or leak paths in errors", () => {
  const f = fixture();
  try {
    const base = request(f.store.snapshot().binding);
    for (const input of [null, {}, { ...base, revision: 42 }, { ...base, approved: true },
      { ...base, requestId: "predictable" }, { ...base, rules: { ...base.rules, revision: 99 } },
      { ...base, rules: { ...base.rules, allowedRoots: [{ path: "D:/../private", access: "read-write" }] } }]) {
      denies(() => f.store.update(input), "request-invalid");
    }
    assert.equal(f.store.snapshot().binding.revision, 1);
    const receipt = f.store.update(base);
    for (const forbidden of ["D:", "C:", "Projects", "private", "allowedRoots", "deniedRoots"]) {
      assert.ok(!canonicalJson(receipt).includes(forbidden), forbidden);
    }
  } finally { f.dispose(); }
});

test("invalid and regressed clocks deny new edits while exact retries remain recoverable", () => {
  const f = fixture();
  try {
    const firstRequest = request(f.store.snapshot().binding);
    const first = f.store.update(firstRequest);
    for (const now of ["not-a-date", "2026-09-05T17:00:00+00:00", "2026-02-30T12:00:00.000Z"]) {
      const store = new SqliteWindowsWorkspacePolicyStore(f.database, () => now);
      denies(() => store.update(request(first.binding)), "clock-invalid");
      assert.deepEqual(store.update(firstRequest), first);
    }
    const regressed = new SqliteWindowsWorkspacePolicyStore(f.database, () => "2026-09-04T17:00:00.000Z");
    denies(() => regressed.update(request(first.binding)), "clock-regression");
  } finally { f.dispose(); }
});

test("runtime durability downgrades, active outer transactions and busy locks deny", () => {
  const f = fixture();
  try {
    const update = request(f.store.snapshot().binding);
    f.database.pragma("synchronous = NORMAL");
    denies(() => f.store.update(update), "durability-invalid");
    f.database.pragma("synchronous = FULL");
    const other = f.open();
    new SqliteWindowsWorkspacePolicyStore(other);
    other.exec("BEGIN IMMEDIATE");
    try { denies(() => f.store.update(update), "storage-unavailable"); } finally { other.exec("ROLLBACK"); }
    f.database.exec("BEGIN IMMEDIATE");
    try { denies(() => f.store.update(update), "transaction-active"); } finally { f.database.exec("ROLLBACK"); }
    assert.equal(f.store.snapshot().binding.revision, 1);
    assert.equal(f.store.update(update).binding.revision, 2);
  } finally { f.dispose(); }
});

test("failure after receipt insertion rolls back both permission and receipt atomically", () => {
  const f = fixture();
  try {
    const before = f.store.snapshot();
    const update = request(before.binding);
    const original = f.database.prepare.bind(f.database);
    f.database.prepare = ((sql: string) => {
      if (sql.startsWith("UPDATE workspace_policy_state SET")) throw new Error("injected C:/private storage fault");
      return original(sql);
    }) as Database.Database["prepare"];
    denies(() => f.store.update(update), "storage-unavailable");
    f.database.prepare = original;
    assert.deepEqual(f.store.snapshot(), before);
    assert.equal((f.database.prepare("SELECT count(*) AS n FROM workspace_policy_updates").get() as { n: number }).n, 0);
    assert.equal(f.store.update(update).binding.revision, 2);
  } finally { f.dispose(); }
});

test("post-commit read-back failure is recoverable with the same request id", () => {
  const f = fixture();
  try {
    const update = request(f.store.snapshot().binding);
    const original = f.database.prepare.bind(f.database);
    let lookupCount = 0;
    f.database.prepare = ((sql: string) => {
      if (sql === "SELECT * FROM workspace_policy_updates WHERE request_id = ?" && ++lookupCount === 2) {
        throw new Error("injected private read-back failure");
      }
      return original(sql);
    }) as Database.Database["prepare"];
    denies(() => f.store.update(update), "storage-unavailable");
    f.database.prepare = original;
    assert.equal(f.store.snapshot().binding.revision, 2);
    const receipt = f.store.update(update);
    assert.equal(receipt.binding.revision, 2);
    assert.equal(receipt.changedAt, NOW);
    assert.equal(f.store.snapshot().binding.revision, 2);
  } finally { f.dispose(); }
});

test("an abrupt child exit after commit but before response preserves the retry receipt", () => {
  const f = fixture();
  try {
    const update = request(f.store.snapshot().binding);
    f.database.close();
    const library = pathToFileURL(resolve("node_modules/better-sqlite3/lib/index.js")).href;
    const module = pathToFileURL(resolve(".test-dist/src/build-only/windows-workspace-policy-store.js")).href;
    const script = `import Database from ${JSON.stringify(library)};
      import { SqliteWindowsWorkspacePolicyStore } from ${JSON.stringify(module)};
      const database = new Database(process.argv[1]);
      const store = new SqliteWindowsWorkspacePolicyStore(database, () => ${JSON.stringify(NOW)});
      store.update(JSON.parse(process.argv[2]));
      process.exit(23);`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script, f.path, JSON.stringify(update)], {
      timeout: 10_000, maxBuffer: 4_096, encoding: "utf8",
      env: { SystemRoot: process.env["SystemRoot"] ?? "C:\\Windows" },
    });
    assert.equal(child.status, 23, child.stderr);
    assert.equal(child.stdout, "");
    const recovered = new SqliteWindowsWorkspacePolicyStore(f.open(), () => { throw new Error("no new timestamp"); });
    const receipt = recovered.update(update);
    assert.equal(receipt.binding.revision, 2);
    assert.equal(receipt.changedAt, NOW);
    assert.equal(recovered.snapshot().binding.revision, 2);
  } finally { f.dispose(); }
});

test("process exit inside the transaction leaves the previous policy and no receipt", () => {
  const f = fixture();
  try {
    const before = f.store.snapshot();
    const update = request(before.binding);
    f.database.close();
    const library = pathToFileURL(resolve("node_modules/better-sqlite3/lib/index.js")).href;
    const module = pathToFileURL(resolve(".test-dist/src/build-only/windows-workspace-policy-store.js")).href;
    const script = `import Database from ${JSON.stringify(library)};
      import { SqliteWindowsWorkspacePolicyStore } from ${JSON.stringify(module)};
      const database = new Database(process.argv[1]);
      const store = new SqliteWindowsWorkspacePolicyStore(database, () => ${JSON.stringify(NOW)});
      const original = database.prepare.bind(database);
      database.prepare = (sql) => {
        if (sql.startsWith('UPDATE workspace_policy_state SET')) process.exit(24);
        return original(sql);
      };
      store.update(JSON.parse(process.argv[2]));
      process.exit(99);`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script, f.path, JSON.stringify(update)], {
      timeout: 10_000, maxBuffer: 4_096, encoding: "utf8",
      env: { SystemRoot: process.env["SystemRoot"] ?? "C:\\Windows" },
    });
    assert.equal(child.status, 24, child.stderr);
    assert.equal(child.stdout, "");
    const reopened = f.open();
    const recovered = new SqliteWindowsWorkspacePolicyStore(reopened, () => NOW);
    assert.deepEqual(recovered.snapshot(), before);
    assert.equal((reopened.prepare("SELECT count(*) AS n FROM workspace_policy_updates").get() as { n: number }).n, 0);
    assert.equal(recovered.update(update).binding.revision, 2);
  } finally { f.dispose(); }
});

for (const heldLock of [false, true]) test(heldLock
  ? "a real held lock denies both policy processes and exact caller retries preserve one winner"
  : "two synchronized OS processes produce one policy winner from one expected binding", async () => {
  const f = fixture();
  const children: ReturnType<typeof spawn>[] = [];
  try {
    const binding = f.store.snapshot().binding;
    const requests = [request(binding), request(binding)];
    const library = pathToFileURL(resolve("node_modules/better-sqlite3/lib/index.js")).href;
    const module = pathToFileURL(resolve(".test-dist/src/build-only/windows-workspace-policy-store.js")).href;
    const script = `import Database from ${JSON.stringify(library)};
      import { SqliteWindowsWorkspacePolicyStore } from ${JSON.stringify(module)};
      const database = new Database(process.argv[1]);
      const store = new SqliteWindowsWorkspacePolicyStore(database, () => ${JSON.stringify(NOW)});
      // Observe real native transaction errors before the store redacts them.
      // Every mode still delegates to the original better-sqlite3 transaction.
      let storageCode = null;
      const transaction = database.transaction.bind(database);
      database.transaction = (callback) => {
        const actual = transaction(callback);
        const observe = (invoke) => {
          try { return invoke(); }
          catch (error) { storageCode = error.code ?? null; throw error; }
        };
        const wrapped = (...args) => observe(() => actual(...args));
        for (const mode of ['default', 'deferred', 'immediate', 'exclusive']) {
          wrapped[mode] = (...args) => observe(() => actual[mode](...args));
        }
        wrapped.database = actual.database;
        return wrapped;
      };
      process.once('message', () => {
        try { store.update(JSON.parse(process.argv[2])); process.stdout.write(JSON.stringify({ status: 'committed', reason: null, storageCode })); }
        catch (error) { process.stdout.write(JSON.stringify({ status: 'denied', reason: error.reason ?? 'unexpected', storageCode })); }
        database.close(); process.disconnect();
      });
      process.send('ready');`;
    const runners = requests.map((update) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script, f.path, JSON.stringify(update)], {
        timeout: 10_000, stdio: ["ignore", "pipe", "pipe", "ipc"],
        env: { SystemRoot: process.env["SystemRoot"] ?? "C:\\Windows" },
      });
      children.push(child);
      let output = "";
      child.stdout!.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); if (output.length > 256) child.kill(); });
      child.stderr!.on("data", () => child.kill());
      const ready = new Promise<void>((resolveReady, rejectReady) => {
        child.once("message", (message) => message === "ready" ? resolveReady() : rejectReady(new Error("invalid-child-ready")));
        child.once("error", rejectReady);
        child.once("exit", () => rejectReady(new Error("child-exited-before-ready")));
      });
      const done = new Promise<string>((resolveDone, rejectDone) => {
        child.once("error", rejectDone);
        child.once("close", (code) => code === 0 ? resolveDone(output) : rejectDone(new Error("child-exit-failed")));
      });
      // Observe both rejections immediately while waiting for both ready signals.
      void ready.catch(() => undefined);
      void done.catch(() => undefined);
      return { child, ready, done };
    });
    await Promise.all(runners.map((runner) => runner.ready));
    if (heldLock) f.database.exec("BEGIN IMMEDIATE");
    for (const runner of runners) runner.child.send("go");
    const outputs = await Promise.all(runners.map((runner) => runner.done));
    const outcomes = outputs.map((output) => JSON.parse(output) as { status: string; reason: string | null; storageCode: string | null });
    if (heldLock) {
      for (const outcome of outcomes) {
        assert.deepEqual(outcome, { status: "denied", reason: "storage-unavailable", storageCode: "SQLITE_BUSY" });
      }
      assert.equal(f.database.inTransaction, true);
      assert.equal((f.database.prepare("SELECT count(*) AS n FROM workspace_policy_updates").get() as { n: number }).n, 0);
      f.database.exec("ROLLBACK");
      // Explicit caller actions only: no changed expected binding or new ID.
      const committed = f.store.update(requests[0]);
      assert.equal(committed.binding.revision, 2);
      denies(() => f.store.update(requests[1]), "stale-policy");
      assert.deepEqual(f.store.update(requests[0]), committed);
    } else {
      assert.equal(outcomes.filter((outcome) => outcome.status === "committed").length, 1, JSON.stringify(outcomes));
      for (const [index, outcome] of outcomes.entries()) {
        if (outcome.status === "committed") {
          assert.deepEqual(outcome, { status: "committed", reason: null, storageCode: null });
          continue;
        }
        if (outcome.reason === "stale-policy") {
          assert.deepEqual(outcome, { status: "denied", reason: "stale-policy", storageCode: null });
        } else {
          // A generic storage error alone is NOT accepted as proof of contention.
          assert.deepEqual(outcome, { status: "denied", reason: "storage-unavailable", storageCode: "SQLITE_BUSY" });
          denies(() => f.store.update(requests[index]), "stale-policy");
        }
      }
    }
    assert.equal(f.store.snapshot().binding.revision, 2);
    assert.equal((f.database.prepare("SELECT count(*) AS n FROM workspace_policy_updates").get() as { n: number }).n, 1);
  } finally {
    await Promise.all(children.map((child) => new Promise<void>((done) => {
      if (child.exitCode !== null || child.signalCode !== null) return done();
      child.once("close", () => done());
      child.kill();
    })));
    if (f.database.inTransaction) f.database.exec("ROLLBACK");
    f.dispose();
  }
});
