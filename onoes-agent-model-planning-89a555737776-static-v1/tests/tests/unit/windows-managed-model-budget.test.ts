import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { canonicalJson } from "../../src/compatibility/canonical-json.js";
import { initializeManagedModelBudget, SqliteManagedModelBudget, ManagedModelBudgetError } from "../../src/build-only/windows-managed-model-budget.js";

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
