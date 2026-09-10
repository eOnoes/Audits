import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { canonicalJson, canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import { initializeManagedModelBudget, SqliteManagedModelBudget, ManagedModelBudgetError, MANAGED_MODEL_RECOVERY_MAX_BYTES } from "../../src/build-only/windows-managed-model-budget.js";

const d = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`;
const reason = (name: string) => (error: unknown) => error instanceof ManagedModelBudgetError && error.reason === name;
const funding = (total = 100, attempts = 3) => canonicalJson({ currency: "USD", totalAllocationMicrounits: total, maximumAttempts: attempts });
const request = (id = 1, allocation = 40, profile = 2) => canonicalJson({ requestDigest: d(id), profileDigest: d(profile), allocationMicrounits: allocation });
function fixture(total = 100, attempts = 3) {
  const parent = resolve(tmpdir()), directory = mkdtempSync(join(parent, "onoes-model-allocation-")), path = join(directory, "budget.db");
  const db = new Database(path), handles = [db], initialized = initializeManagedModelBudget(db, funding(total, attempts));
  let timestamp = "2026-09-09T00:00:00.000Z", clockCalls = 0, callback = () => {};
  const now = () => { clockCalls++; assert.equal(db.inTransaction, false); callback(); return timestamp; };
  const store = new SqliteManagedModelBudget(db, initialized.budgetDigest, now);
  return { db, store, initialized, path, clockCalls: () => clockCalls,
    setTime(v: string) { timestamp = v; }, setClock(fn: () => void) { callback = fn; },
    open() { const other = new Database(path, { fileMustExist: true }); handles.push(other);
      return { db: other, store: new SqliteManagedModelBudget(other, initialized.budgetDigest, () => timestamp) }; },
    close() { for (const handle of handles) if (handle.open) handle.close();
      assert.equal(dirname(resolve(directory)), parent); assert.ok(basename(directory).startsWith("onoes-model-allocation-"));
      rmSync(directory, { recursive: true, force: true }); } };
}
const terminal = (reserved: ReturnType<SqliteManagedModelBudget["reserve"]>, outcome = "response-observed") => canonicalJson({
  requestDigest: reserved.receipt.reservation.requestDigest, reservationDigest: reserved.receipt.reservation.reservationDigest, outcome });

test("model budget reserves exact integer allowances and never refunds observed or unknown outcomes", () => {
  const f = fixture(); try {
    const a = f.store.reserve(request()); assert.equal(a.disposition, "reserved");
    assert.equal(a.receipt.dispatchAuthorized, false); assert.equal(a.receipt.actualChargeVerified, false);
    assert.equal(f.store.snapshot().allocatedMicrounits, 40);
    assert.equal(f.store.snapshot().unresolvedAttempts, 1);
    const before = f.clockCalls(), again = f.store.reserve(request()); assert.equal(again.disposition, "existing");
    assert.deepEqual(again.receipt, a.receipt); assert.equal(f.clockCalls(), before);
    const settled = f.store.recordOutcome(terminal(a)); assert.equal(settled.refundMicrounits, 0);
    assert.equal(f.store.snapshot().unresolvedAttempts, 0); assert.equal(f.store.snapshot().remainingMicrounits, 60);
    assert.deepEqual(f.store.recordOutcome(terminal(a)), settled);
    const b = f.store.reserve(request(3, 60)); f.store.recordOutcome(terminal(b, "outcome-unknown"));
    assert.equal(f.store.snapshot().remainingMicrounits, 0); assert.equal(f.store.snapshot().unresolvedAttempts, 1);
    assert.throws(() => f.store.reserve(request(4, 1)), reason("allocation-exhausted"));
    assert.equal(f.store.snapshot().attempts, 2);
  } finally { f.close(); }
});

test("model budget denies an unexpected terminal update count and rolls back any tentative write", () => {
  for (const [mutate, changes] of [[false, 0], [true, 0], [false, 2], [true, 2], [false, 1]] as const) {
    const f = fixture(); const original = f.db.prepare.bind(f.db);
    try {
      const reserved = f.store.reserve(request()); let updates = 0;
      f.db.prepare = ((sql: string) => {
        const statement = original(sql);
        if (!sql.startsWith("UPDATE model_allocations SET terminal_json=")) return statement;
        return { run(...values: unknown[]) {
          updates++; assert.equal(f.db.inTransaction, true);
          if (mutate) statement.run(...values);
          return { changes, lastInsertRowid: 0 };
        } };
      }) as typeof f.db.prepare;
      assert.throws(() => f.store.recordOutcome(terminal(reserved)), reason("state-invalid"));
      f.db.prepare = original;
      assert.equal(updates, 1); assert.equal(f.db.inTransaction, false);
      assert.equal(f.store.read(d(1))?.terminal, null);
      assert.equal(f.store.snapshot().allocatedMicrounits, 40);
      const reopened = f.open(); assert.equal(reopened.store.read(d(1))?.terminal, null);
    } finally { f.db.prepare = original; f.close(); }
  }
});

test("model budget exact retries survive close/reopen but never become a fresh reservation", () => {
  const f = fixture(); try {
    const first = f.store.reserve(request()); f.db.close();
    const reopened = f.open();
    assert.equal(reopened.store.snapshot().allocatedMicrounits, 40);
    assert.equal(reopened.store.snapshot().unresolvedAttempts, 1);
    const retry = reopened.store.reserve(request()); assert.equal(retry.disposition, "existing"); assert.deepEqual(retry.receipt, first.receipt);
    const recorded = reopened.store.recordOutcome(terminal(first, "outcome-unknown")); reopened.db.close();
    const last = f.open(); assert.deepEqual(last.store.read(d(1)), recorded);
    assert.equal(last.store.reserve(request()).disposition, "existing");
    assert.equal(last.store.snapshot().remainingMicrounits, 60);
  } finally { f.close(); }
});

test("model budget response loss is conservatively retained without any provider retry", () => {
  const f = fixture(); try {
    // A caller loses control immediately after reserve returns, before dispatch.
    // On restart the book cannot infer whether a provider saw the request.
    try { f.store.reserve(request()); throw new Error("synthetic-response-loss"); } catch { /* simulated lost response */ }
    const other = f.open();
    assert.equal(other.store.reserve(request()).disposition, "existing");
    assert.equal(other.store.snapshot().unresolvedAttempts, 1);
    assert.equal(other.store.snapshot().allocatedMicrounits, 40);
    assert.equal(other.store.snapshot().automaticRefundAvailable, false);
  } finally { f.close(); }
});

test("model budget allocation and terminal facts survive abrupt child exit without database close", () => {
  for (const settle of [false, true]) {
    const f = fixture(); try {
      f.db.close();
      const childCode = `import Database from 'better-sqlite3';
        const {SqliteManagedModelBudget} = await import(process.argv[1]);
        const {canonicalJson} = await import(process.argv[2]);
        const db = new Database(process.argv[3], {fileMustExist:true});
        const store = new SqliteManagedModelBudget(db,process.argv[4],()=> '2026-09-09T00:00:00.000Z');
        const reserved = store.reserve(process.argv[5]);
        if(process.argv[6]==='true') store.recordOutcome(canonicalJson({requestDigest:reserved.receipt.reservation.requestDigest,
          reservationDigest:reserved.receipt.reservation.reservationDigest,outcome:'outcome-unknown'}));
        process.exit(23);`;
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", childCode,
        new URL("../../src/build-only/windows-managed-model-budget.js", import.meta.url).href,
        new URL("../../src/compatibility/canonical-json.js", import.meta.url).href,
        f.path, f.initialized.budgetDigest, request(), String(settle)],
        { cwd: process.cwd(), encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 4096 });
      assert.equal(result.error, undefined); assert.equal(result.status, 23, result.stderr);
      const reopened = f.open(); const retry = reopened.store.reserve(request());
      assert.equal(retry.disposition, "existing"); assert.equal(retry.receipt.terminal?.outcome ?? null, settle ? "outcome-unknown" : null);
      assert.equal(reopened.store.snapshot().allocatedMicrounits, 40); assert.equal(reopened.store.snapshot().unresolvedAttempts, 1);
      const inventory = reopened.store.recoverySnapshot();
      assert.equal(inventory.entries.length, 1); assert.equal(inventory.entries[0]!.receipt.reservation.requestDigest, d(1));
      assert.equal(inventory.entries[0]!.classification, settle ? "outcome-unknown" : "reservation-without-outcome");
      assert.equal(inventory.automaticRetryAvailable, false); assert.equal(inventory.summary.remainingMicrounits, 60);
    } finally { f.close(); }
  }
});

test("model budget rechecks concurrent winners and available funds inside the immediate transaction", () => {
  for (const same of [true, false]) {
    const f = fixture(50); try {
      const other = f.open();
      f.setClock(() => { f.setClock(() => {}); other.store.reserve(request(same ? 1 : 3, 40)); });
      if (same) assert.equal(f.store.reserve(request()).disposition, "existing");
      else assert.throws(() => f.store.reserve(request()), reason("allocation-exhausted"));
      assert.equal(f.store.snapshot().attempts, 1); assert.equal(f.store.snapshot().allocatedMicrounits, 40);
    } finally { f.close(); }
  }
});

test("model budget conflicting request, profile, amount or terminal state cannot rewrite allocation", () => {
  const f = fixture(); try {
    const a = f.store.reserve(request()); const before = f.store.snapshot();
    for (const changed of [request(1, 39), request(1, 40, 3)]) assert.throws(() => f.store.reserve(changed), reason("request-conflict"));
    assert.throws(() => f.store.recordOutcome(canonicalJson({ ...JSON.parse(terminal(a)), reservationDigest: d(99) })), reason("request-conflict"));
    assert.throws(() => f.store.recordOutcome(canonicalJson({ ...JSON.parse(terminal(a)), requestDigest: d(99) })), reason("missing"));
    assert.deepEqual(f.store.snapshot(), before);
    const done = f.store.recordOutcome(terminal(a, "outcome-unknown"));
    assert.throws(() => f.store.recordOutcome(terminal(a)), reason("terminal-conflict"));
    assert.deepEqual(f.store.read(d(1)), done);
  } finally { f.close(); }
});

test("model budget rejects ambiguous, fractional and oversized inputs without allocations", () => {
  const f = fixture(); try {
    const raw = JSON.parse(request());
    for (const bad of ["\ufeff" + request(), request() + "\n", request().replace("{", '{"allocationMicrounits":1,'),
      canonicalJson({ ...raw, source: "private-content" }), canonicalJson({ ...raw, allocationMicrounits: 0 }),
      canonicalJson({ ...raw, allocationMicrounits: 0.5 }), canonicalJson({ ...raw, allocationMicrounits: 1_000_000_000_001 }),
      canonicalJson({ ...raw, allocationMicrounits: "40" }), "x".repeat(4097), {}]) {
      assert.throws(() => f.store.reserve(bad), reason("input-invalid"));
    }
    assert.equal(f.clockCalls(), 0); assert.equal(f.store.snapshot().attempts, 0);
  } finally { f.close(); }
});

test("model budget uses exact UTC milliseconds and denies clock regression without disturbing retries", () => {
  const f = fixture(); try {
    const a = f.store.reserve(request());
    for (const bad of ["2026-09-09T00:00:00Z", "2026-09-09T00:00:00.000+00:00", "2026-02-30T00:00:00.000Z", "2026-09-08T23:59:59.999Z"]) {
      f.setTime(bad); assert.throws(() => f.store.reserve(request(3)), reason("clock-invalid"));
      assert.throws(() => f.store.recordOutcome(terminal(a)), reason("clock-invalid"));
      assert.equal(f.store.reserve(request()).disposition, "existing");
    }
    assert.equal(f.store.snapshot().attempts, 1); assert.equal(f.store.read(d(1))?.terminal, null);
  } finally { f.close(); }
});

test("model budget attempt ceiling cannot be reset by terminal outcomes or initialization", () => {
  const f = fixture(100, 1); try {
    const a = f.store.reserve(request(1, 1)); f.store.recordOutcome(terminal(a));
    assert.throws(() => f.store.reserve(request(3, 1)), reason("attempts-exhausted"));
    assert.throws(() => initializeManagedModelBudget(f.db, funding(1000)), reason("schema-invalid"));
    assert.throws(() => new SqliteManagedModelBudget(f.db, d(99)), reason("budget-mismatch"));
    assert.equal(f.store.snapshot().remainingMicrounits, 99);
  } finally { f.close(); }
});

test("model budget refuses non-WAL, active transactions, schema shadowing and runtime durability downgrade", () => {
  const memory = new Database(":memory:");
  try { assert.throws(() => initializeManagedModelBudget(memory, funding()), reason("durability-invalid")); } finally { memory.close(); }
  for (const mode of ["synchronous", "transaction", "temp", "schema"] as const) {
    const f = fixture(); try {
      if (mode === "synchronous") f.db.pragma("synchronous=NORMAL");
      if (mode === "transaction") f.db.exec("BEGIN IMMEDIATE");
      if (mode === "temp") f.db.exec("CREATE TEMP TABLE model_allocations (a TEXT)");
      if (mode === "schema") f.db.exec("CREATE TABLE unexpected (a TEXT)");
      assert.throws(() => f.store.reserve(request()), reason(mode === "synchronous" ? "durability-invalid" : mode === "transaction" ? "transaction-active" : "schema-invalid"));
      if (f.db.inTransaction) f.db.exec("ROLLBACK");
      assert.equal((f.db.prepare("SELECT count(*) AS n FROM main.model_allocations").get() as { n: number }).n, 0);
    } finally { f.close(); }
  }
});

test("model budget verifies stored canonical bytes, hashes, terminal binding and funding on every read", () => {
  for (const mode of ["whitespace", "digest", "utf8", "oversize", "terminal", "funding"] as const) {
    const f = fixture(); try {
      const a = f.store.reserve(request());
      if (mode === "whitespace") f.db.prepare("UPDATE model_allocations SET reservation_json=reservation_json||' '").run();
      if (mode === "digest") f.db.prepare("UPDATE model_allocations SET reservation_json=?").run(canonicalJson({ ...a.receipt.reservation, allocationMicrounits: 1 }));
      if (mode === "utf8") f.db.exec("UPDATE model_allocations SET reservation_json=CAST(x'ffff' AS TEXT)");
      if (mode === "oversize") { f.db.pragma("ignore_check_constraints=ON"); f.db.prepare("UPDATE model_allocations SET reservation_json=?").run("x".repeat(4097)); f.db.pragma("ignore_check_constraints=OFF"); }
      if (mode === "terminal") f.db.prepare("UPDATE model_allocations SET terminal_json='{}'").run();
      if (mode === "funding") f.db.prepare("UPDATE model_allocation_meta SET policy_json=?").run(canonicalJson({ ...f.initialized.policy, totalAllocationMicrounits: 1000 }));
      assert.throws(() => f.store.snapshot(), reason(mode === "funding" ? "budget-mismatch" : "state-invalid"));
      assert.throws(() => f.store.recoverySnapshot(), reason(mode === "funding" ? "budget-mismatch" : "state-invalid"));
    } finally { f.close(); }
  }
});

test("model budget contention denies without an allocation and releases no external effect", () => {
  const f = fixture(); try {
    const other = f.open(); other.db.exec("BEGIN IMMEDIATE");
    assert.throws(() => f.store.reserve(request()), reason("storage-unavailable"));
    other.db.exec("ROLLBACK"); assert.equal(f.store.snapshot().attempts, 0);
  } finally { f.close(); }
});

test("model budget redacts clock errors while exact reservation and terminal read-back bypass the clock", () => {
  const f = fixture(); try {
    const a = f.store.reserve(request()); const settled = f.store.recordOutcome(terminal(a));
    f.setClock(() => { throw new Error("PRIVATE_CLOCK_DIAGNOSTIC"); });
    assert.throws(() => f.store.reserve(request(3)), (error: unknown) => error instanceof ManagedModelBudgetError
      && error.reason === "clock-invalid" && !error.message.includes("PRIVATE_CLOCK"));
    assert.equal(f.store.reserve(request()).disposition, "existing");
    assert.deepEqual(f.store.recordOutcome(terminal(a)), settled);
    assert.equal(f.store.snapshot().attempts, 1);
  } finally { f.close(); }
});

test("model budget retains exact microunit arithmetic at the maximum allocation boundary", () => {
  const f = fixture(1_000_000_000_000); try {
    f.store.reserve(request(1, 999_999_999_999)); assert.equal(f.store.snapshot().remainingMicrounits, 1);
    f.store.reserve(request(3, 1)); assert.equal(f.store.snapshot().allocatedMicrounits, 1_000_000_000_000);
    assert.throws(() => f.store.reserve(request(4, 1)), reason("allocation-exhausted"));
  } finally { f.close(); }
});

test("model budget exposes a recovery inventory without requiring remembered request identities", () => {
  const f = fixture(); try {
    f.store.reserve(request(9, 10)); const b = f.store.reserve(request(3, 20));
    f.store.recordOutcome(terminal(b, "outcome-unknown")); f.db.close();
    const reopened = f.open(), inventory = reopened.store.recoverySnapshot();
    assert.deepEqual(inventory.entries.map(e => e.receipt.reservation.requestDigest), [d(3), d(9)]);
    assert.deepEqual(inventory.entries.map(e => e.classification), ["outcome-unknown", "reservation-without-outcome"]);
    assert.equal(inventory.summary.allocatedMicrounits, 30); assert.equal(inventory.summary.unresolvedAttempts, 2);
    for (const entry of inventory.entries) {
      const r = entry.receipt.reservation;
      assert.equal(reopened.store.reserve(canonicalJson({ requestDigest: r.requestDigest, profileDigest: r.profileDigest,
        allocationMicrounits: r.allocationMicrounits })).disposition, "existing");
    }
    assert.deepEqual(reopened.store.recoverySnapshot(), inventory);
  } finally { f.close(); }
});

test("model recovery is query-only, clock-free, content-free and distinguishes recorded facts from provider state", () => {
  const f = fixture(); try {
    f.store.reserve(request(9, 10)); const a = f.store.reserve(request(3, 20)), b = f.store.reserve(request(5, 30));
    f.store.recordOutcome(terminal(a)); f.store.recordOutcome(terminal(b, "outcome-unknown"));
    const calls = f.clockCalls(), changes = f.db.prepare("SELECT total_changes() AS n").get();
    f.setClock(() => { throw new Error("must-not-run"); }); f.db.pragma("query_only=ON");
    const inventory = f.store.recoverySnapshot(), { recoveryDigest, ...core } = inventory;
    assert.deepEqual(inventory.counts, { withoutOutcome: 1, outcomeUnknown: 1, responseObserved: 1 });
    assert.equal(inventory.summary.unresolvedAttempts, 2); assert.deepEqual(inventory.summary, f.store.snapshot());
    assert.equal(inventory.remoteWorkStatus, "not-established"); assert.equal(inventory.automaticRetryAvailable, false);
    assert.equal(inventory.responseRecoveryAvailable, false); assert.equal(inventory.approvalAvailable, false);
    assert.equal(inventory.summary.actualChargeVerified, false); assert.equal(inventory.summary.automaticRefundAvailable, false);
    assert.deepEqual(inventory.entries.map(e => e.operatorReconciliationRequired), [false, true, true]);
    assert.equal(recoveryDigest, canonicalSha256Digest(core)); assert.equal(f.clockCalls(), calls);
    assert.deepEqual(f.db.prepare("SELECT total_changes() AS n").get(), changes);
    assert.ok(Object.isFrozen(inventory.entries)); assert.ok(Object.isFrozen(inventory.entries[0]!.receipt.reservation));
    assert.throws(() => { (inventory.summary as { attempts: number }).attempts = 0; }, TypeError);
    assert.deepEqual(Object.keys(inventory.entries[0]!).sort(), ["classification", "operatorReconciliationRequired", "receipt"]);
    assert.deepEqual(Object.keys(inventory.entries[0]!.receipt.reservation).sort(),
      ["allocationMicrounits", "budgetDigest", "profileDigest", "requestDigest", "reservationDigest", "reservedAt"]);
    assert.deepEqual(f.store.recoverySnapshot(), inventory);
  } finally { f.close(); }
});

test("model recovery summary and entries use one WAL snapshot even when another connection commits mid-read", () => {
  const f = fixture(); try {
    f.store.reserve(request(1, 10)); const other = f.open();
    const original = f.db.prepare.bind(f.db); let injected = false;
    // Test-only interception after the metadata SELECT established the read snapshot.
    // The other connection commits a real WAL write before this row SELECT starts.
    f.db.prepare = ((sql: string) => {
      if (!injected && sql.startsWith("SELECT substr(request_digest")) { injected = true; other.store.reserve(request(3, 20)); }
      return original(sql);
    }) as typeof f.db.prepare;
    const inventory = f.store.recoverySnapshot(); f.db.prepare = original;
    assert.equal(injected, true); assert.equal(other.store.snapshot().attempts, 2);
    assert.equal(inventory.summary.attempts, 1); assert.equal(inventory.entries.length, 1);
    assert.equal(inventory.summary.allocatedMicrounits, 10); assert.equal(inventory.counts.withoutOutcome, 1);
    const next = f.store.recoverySnapshot(); assert.equal(next.summary.attempts, 2); assert.equal(next.entries.length, 2);
    assert.notEqual(next.recoveryDigest, inventory.recoveryDigest);
    assert.equal(inventory.entries.length, 1); // Earlier observation cannot mutate in place.
  } finally { f.close(); }
});

test("model recovery reports empty and exhausted capacity without offering reset, refund or redispatch", () => {
  for (const [total, attempts, allocation] of [[100, 3, 100], [100, 1, 40], [100, 1, 100]]) {
    const f = fixture(total, attempts); try {
      const empty = f.store.recoverySnapshot(); assert.equal(empty.summary.attempts, 0); assert.deepEqual(empty.entries, []);
      assert.deepEqual(empty.counts, { withoutOutcome: 0, outcomeUnknown: 0, responseObserved: 0 });
      assert.equal(empty.allocationCapacityExhausted, false); assert.equal(empty.attemptCapacityExhausted, false);
      const a = f.store.reserve(request(1, allocation)); f.store.recordOutcome(terminal(a));
      const full = f.store.recoverySnapshot(); assert.equal(full.allocationCapacityExhausted, allocation === total);
      assert.equal(full.attemptCapacityExhausted, attempts === 1); assert.equal(full.automaticRetryAvailable, false);
      assert.equal(full.summary.remainingMicrounits, total! - allocation!);
      assert.equal(full.summary.allocatedMicrounits, allocation);
    } finally { f.close(); }
  }
});

test("model recovery denies inaccessible, shadowed or downgraded stores rather than reporting empty history", () => {
  for (const mode of ["closed", "transaction", "schema", "synchronous"] as const) {
    const f = fixture(); try {
      f.store.reserve(request());
      if (mode === "closed") f.db.close();
      if (mode === "transaction") f.db.exec("BEGIN IMMEDIATE");
      if (mode === "schema") f.db.exec("CREATE TEMP TABLE model_allocations (a TEXT)");
      if (mode === "synchronous") f.db.pragma("synchronous=NORMAL");
      assert.throws(() => f.store.recoverySnapshot(), reason(mode === "closed" ? "storage-unavailable" :
        mode === "transaction" ? "transaction-active" : mode === "schema" ? "schema-invalid" : "durability-invalid"));
      if (f.db.open && f.db.inTransaction) f.db.exec("ROLLBACK");
    } finally { f.close(); }
  }
});

test("model recovery includes the full 1000-attempt book within its predeclared wire cap and denies overflow", () => {
  const f = fixture(1001, 1000); try {
    // Valid synthetic rows avoid quadratic reserve setup. This tests the read ceiling,
    // not 1000 real dispatches, allocation admission, or a performance acceptance gate.
    const insert = f.db.prepare("INSERT INTO model_allocations VALUES (?,?,?)");
    const makeRow = (id: number) => {
      const core = { requestDigest: d(id), profileDigest: d(9999), allocationMicrounits: 1,
        budgetDigest: f.initialized.budgetDigest, reservedAt: "2026-09-09T00:00:00.000Z" };
      const reserved = { ...core, reservationDigest: canonicalSha256Digest(core) };
      const end = { requestDigest: d(id), reservationDigest: reserved.reservationDigest, outcome: "outcome-unknown",
        recordedAt: "2026-09-09T00:00:00.000Z" };
      insert.run(d(id), canonicalJson(reserved), canonicalJson({ ...end, terminalDigest: canonicalSha256Digest(end) }));
    };
    f.db.transaction(() => { for (let i = 1; i <= 1000; i++) makeRow(i); }).immediate();
    const inventory = f.store.recoverySnapshot(); assert.equal(inventory.entries.length, 1000);
    assert.equal(inventory.summary.attempts, 1000); assert.equal(inventory.counts.outcomeUnknown, 1000);
    assert.equal(inventory.summary.allocatedMicrounits, 1000); assert.equal(inventory.summary.remainingAttempts, 0);
    assert.ok(Buffer.byteLength(canonicalJson(inventory)) <= MANAGED_MODEL_RECOVERY_MAX_BYTES);
    assert.equal(MANAGED_MODEL_RECOVERY_MAX_BYTES, 2_097_152);
    makeRow(1001); assert.throws(() => f.store.recoverySnapshot(), reason("state-invalid"));
  } finally { f.close(); }
});
