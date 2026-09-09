import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, basename } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import Database from "better-sqlite3";
import { canonicalJson } from "../../src/compatibility/canonical-json.js";
import { initializeWindowsWorkspacePolicyStore, SqliteWindowsWorkspacePolicyStore, WorkspacePolicyStoreError } from "../../src/build-only/windows-workspace-policy-store.js";

const NOW = "2026-09-05T19:45:00.000Z";
const phases = ["receipt-inserted", "policy-written", "committed-before-readback", "receipt-returned"] as const;

for (const phase of phases) {
  test(`policy process termination at ${phase} recovers an atomic revision and exact retry`, { timeout: 20_000 }, async () => {
    const parent = resolve(tmpdir());
    const directory = mkdtempSync(join(parent, "onoes-policy-crash-"));
    const path = join(directory, "policy.sqlite");
    let database: Database.Database | undefined;
    let child: ReturnType<typeof spawn> | undefined;
    let closed: Promise<void> | undefined;
    try {
      database = new Database(path);
      initializeWindowsWorkspacePolicyStore(database);
      const before = new SqliteWindowsWorkspacePolicyStore(database).snapshot();
      const update = {
        requestId: randomUUID(), expectedBinding: before.binding,
        rules: { allowedRoots: [{ path: "D:\\DisposableFixture", access: "read-only" }], deniedRoots: ["C:\\"] },
      };
      // Parent holds NO SQLite connection while the child runs or is terminated.
      database.close(); database = undefined;
      const library = pathToFileURL(resolve("node_modules/better-sqlite3/lib/index.js")).href;
      const module = pathToFileURL(resolve(".test-dist/src/build-only/windows-workspace-policy-store.js")).href;
      const script = `import Database from ${JSON.stringify(library)};
        import {writeSync} from 'node:fs';
        import {SqliteWindowsWorkspacePolicyStore} from ${JSON.stringify(module)};
        const db = new Database(process.argv[1]);
        const phase = process.argv[2], update = JSON.parse(process.argv[3]);
        const store = new SqliteWindowsWorkspacePolicyStore(db, () => ${JSON.stringify(NOW)});
        function cut(point, receipt) {
          if (phase !== point) return;
          if (db.inTransaction !== ['receipt-inserted','policy-written'].includes(point)) throw new Error('wrong-transaction-state');
          // Synchronous bounded marker leaves the pipe before the child blocks.
          // Parent terminates this actual process; no graceful db.close/rollback runs.
          writeSync(1, JSON.stringify({phase:point,inTransaction:db.inTransaction,receipt:receipt ?? null})+'\\n');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
          throw new Error('cut-unexpectedly-resumed');
        }
        const prepare = db.prepare.bind(db);
        db.prepare = sql => {
          const statement = prepare(sql);
          let point;
          if (sql.startsWith('INSERT INTO workspace_policy_updates VALUES')) point='receipt-inserted';
          if (sql.startsWith('UPDATE workspace_policy_state SET')) point='policy-written';
          if (!point) return statement;
          const run = statement.run.bind(statement);
          statement.run = (...args) => { const result=run(...args); if(result.changes!==1) throw new Error('fault-not-reached'); cut(point); return result; };
          return statement;
        };
        const transaction = db.transaction.bind(db);
        db.transaction = fn => {
          const original = transaction(fn);
          function wrapper(...args) { return original(...args); }
          wrapper.deferred = original.deferred;
          wrapper.exclusive = original.exclusive;
          wrapper.immediate = (...args) => { const result=original.immediate(...args); cut('committed-before-readback'); return result; };
          return wrapper;
        };
        const receipt = store.update(update);
        cut('receipt-returned',receipt);
        throw new Error('fault-point-missed');`;
      child = spawn(process.execPath, ["--input-type=module", "-e", script, path, phase, JSON.stringify(update)], {
        stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 12_000,
        env: { SystemRoot: process.env["SystemRoot"] ?? "C:\\Windows" },
      });
      closed = new Promise<void>(done => child!.once("close", () => done()));
      let output = "", diagnostic = "";
      const marker = await new Promise<{ phase: string; inTransaction: boolean; receipt: unknown }>((accept, reject) => {
        child!.once("error", reject);
        child!.once("close", () => reject(new Error("child-exited-before-cut:" + diagnostic)));
        child!.stderr!.on("data", (chunk: Buffer) => {
          diagnostic += chunk.toString("utf8").slice(0, 2_048 - diagnostic.length);
          reject(new Error("child-diagnostic:" + diagnostic));
        });
        child!.stdout!.on("data", (chunk: Buffer) => {
          output += chunk.toString("utf8");
          if (Buffer.byteLength(output) > 4_096) { reject(new Error("child-output-limit")); return; }
          if (!output.endsWith("\n")) return;
          try { accept(JSON.parse(output) as { phase: string; inTransaction: boolean; receipt: unknown }); }
          catch { reject(new Error("child-marker-invalid")); }
        });
      });
      assert.equal(marker.phase, phase);
      const committed = phase === "committed-before-readback" || phase === "receipt-returned";
      assert.equal(marker.inTransaction, !committed);
      assert.equal(child.exitCode, null); assert.equal(child.signalCode, null);
      assert.equal(child.kill("SIGKILL"), true);
      await closed;
      assert.ok(child.exitCode !== 0 || child.signalCode !== null);
      assert.equal(diagnostic, "");

      database = new Database(path, { fileMustExist: true });
      assert.equal(database.pragma("quick_check", { simple: true }), "ok");
      const recovered = new SqliteWindowsWorkspacePolicyStore(database, () => {
        assert.equal(committed, false, "committed retry must not sample a new clock");
        return NOW;
      });
      assert.equal(database.pragma("journal_mode", { simple: true }), "wal");
      assert.equal(database.pragma("synchronous", { simple: true }), 2);
      const count = () => (database!.prepare("SELECT count(*) AS n FROM workspace_policy_updates").get() as { n: number }).n;
      assert.equal(count(), committed ? 1 : 0);
      if (!committed) assert.deepEqual(recovered.snapshot(), before);
      else assert.equal(recovered.snapshot().binding.revision, 2);
      const storedBeforeRetry = committed
        ? (database.prepare("SELECT receipt_json FROM workspace_policy_updates").get() as { receipt_json: string }).receipt_json : undefined;
      const receipt = recovered.update(update);
      assert.equal(receipt.changedAt, NOW);
      assert.equal(receipt.binding.revision, 2);
      assert.equal(receipt.binding.storeId, before.binding.storeId);
      if (committed) assert.equal(canonicalJson(receipt), storedBeforeRetry);
      if (phase === "receipt-returned") assert.deepEqual(receipt, marker.receipt);
      else assert.equal(marker.receipt, null);
      assert.deepEqual(recovered.update(update), receipt);
      assert.equal(count(), 1);
      assert.throws(() => recovered.assertCurrentBinding(before.binding),
        (error: unknown) => error instanceof WorkspacePolicyStoreError && error.reason === "stale-policy");
      assert.throws(() => recovered.update({ ...update, requestId: randomUUID() }),
        (error: unknown) => error instanceof WorkspacePolicyStoreError && error.reason === "stale-policy");
      assert.equal(count(), 1);
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      if (closed) await closed;
      if (database?.open) database.close();
      const target = resolve(directory);
      if (dirname(target) !== parent || !basename(target).startsWith("onoes-policy-crash-")) throw new Error("unsafe-test-cleanup");
      rmSync(target, { recursive: true, force: true });
    }
  });
}
