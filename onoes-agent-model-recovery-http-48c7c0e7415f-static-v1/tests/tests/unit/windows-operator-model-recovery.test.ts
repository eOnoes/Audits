import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { canonicalJson, canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import { createWindowsOperatorSession, OPERATOR_SESSION_TTL_MS } from "../../src/build-only/windows-operator-session.js";
import { initializeManagedModelBudget, SqliteManagedModelBudget } from "../../src/build-only/windows-managed-model-budget.js";
import { WindowsOperatorModelRecovery, OperatorModelRecoveryError, OPERATOR_MODEL_RECOVERY_LIMITS } from "../../src/build-only/windows-operator-model-recovery.js";

const d = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`;
const reason = (value: string) => (error: unknown) => error instanceof OperatorModelRecoveryError && error.reason === value;
function fixture() {
  const parent = resolve(tmpdir()), directory = mkdtempSync(join(parent, "onoes-operator-allocation-"));
  const db = new Database(join(directory, "book.db"));
  const initialized = initializeManagedModelBudget(db, canonicalJson({ currency: "USD", totalAllocationMicrounits: 10, maximumAttempts: 10 }));
  const book = new SqliteManagedModelBudget(db, initialized.budgetDigest, () => "2026-09-09T00:00:00.000Z");
  let now = 0, reads = 0, onRead = () => {}, clock = () => now;
  const paired = createWindowsOperatorSession(() => now), credentials = paired.session.pair(paired.bootstrapSecret);
  const port = { recoverySnapshot() { reads++; const value = book.recoverySnapshot(); onRead(); return value; } };
  const controller = new WindowsOperatorModelRecovery({ session: paired.session, book: port,
    expectedBudgetDigest: initialized.budgetDigest, now: () => clock() });
  const request = { schemaVersion: "agent-operator-model-recovery-request/v1", action: "read",
    budgetDigest: initialized.budgetDigest, readAllocationMetadata: true };
  const wire = canonicalJson(request);
  return { db, book, controller, paired, credentials, request, wire, reads: () => reads,
    setTime(value: number) { now = value; }, onRead(fn: () => void) { onRead = fn; }, setClock(fn: () => number) { clock = fn; },
    read(body: unknown = wire) { return controller.read(body, credentials.sessionToken, credentials.csrfToken); },
    close() { controller.close(); paired.session.revoke(); db.close();
      assert.equal(dirname(resolve(directory)), parent); assert.ok(basename(directory).startsWith("onoes-operator-allocation-"));
      rmSync(directory, { recursive: true, force: true }); },
  };
}

test("operator model recovery authenticates before parsing, quota or database reads", () => {
  const f = fixture(); try {
    for (const [session, csrf] of [["", ""], [f.credentials.sessionToken, ""], ["0".repeat(64), f.credentials.csrfToken]]) {
      assert.throws(() => f.controller.read("not-json", session, csrf), reason("session-denied"));
    }
    assert.equal(f.reads(), 0); f.read(); f.read(); assert.equal(f.reads(), 2);
    assert.throws(() => f.read(), reason("rate-limited"));
  } finally { f.close(); }
});

test("operator model recovery requires exact explicit consent and a pinned book without accepting actions or paths", () => {
  const invalid = ["{}", "null", "[]", " ", "x".repeat(513)];
  for (const body of invalid) {
    const f = fixture(); try { assert.throws(() => f.read(body), reason("request-invalid")); assert.equal(f.reads(), 0); } finally { f.close(); }
  }
  for (const patch of [{ readAllocationMetadata: false }, { budgetDigest: d(99) }, { action: "retry" },
    { databasePath: "C:\\PRIVATE.db" }, { refund: true }]) {
    const f = fixture(); try { assert.throws(() => f.read(canonicalJson({ ...f.request, ...patch })), reason("request-invalid")); assert.equal(f.reads(), 0); } finally { f.close(); }
  }
  for (const decorate of [(wire: string) => ` ${wire}`, (wire: string) => `\ufeff${wire}`,
    (wire: string) => wire.replace('"action":"read"', '"action":"read","action":"read"')]) {
    const f = fixture(); try { assert.throws(() => f.read(decorate(f.wire)), reason("request-invalid")); assert.equal(f.reads(), 0); } finally { f.close(); }
  }
});

test("operator model recovery counts malformed reads and uses a sliding two-read window", () => {
  const f = fixture(); try {
    assert.throws(() => f.read("{}"), reason("request-invalid")); f.setTime(1000); f.read();
    f.setTime(59_999); assert.throws(() => f.read(), reason("rate-limited")); assert.equal(f.reads(), 1);
    f.setTime(60_000); f.read(); assert.throws(() => f.read(), reason("rate-limited"));
    f.setTime(61_000); f.read(); assert.equal(f.reads(), 3);
  } finally { f.close(); }
});

test("operator model recovery returns canonical bounded metadata with no mutations or retry authority", () => {
  const f = fixture(); try {
    f.book.reserve(canonicalJson({ requestDigest: d(1), profileDigest: d(2), allocationMicrounits: 4 }));
    const before = f.db.prepare("SELECT total_changes() AS n").get(); f.db.pragma("query_only=ON");
    const wire = f.read(), result = JSON.parse(wire);
    assert.equal(wire, canonicalJson(result)); assert.ok(Buffer.byteLength(wire) <= OPERATOR_MODEL_RECOVERY_LIMITS.responseBytes);
    assert.equal(result.requestDigest, canonicalSha256Digest(f.request)); assert.equal(result.budgetDigest, f.request.budgetDigest);
    assert.equal(result.inventory.entries[0].classification, "reservation-without-outcome");
    assert.equal(result.inventory.summary.allocatedMicrounits, 4); assert.equal(result.automaticRetryAvailable, false);
    assert.equal(result.approvalAvailable, false); assert.equal(result.executionEnabled, false); assert.equal(result.authority, "none");
    assert.deepEqual(f.db.prepare("SELECT total_changes() AS n").get(), before);
    for (const privateValue of [f.credentials.sessionToken, f.credentials.csrfToken, f.paired.bootstrapSecret, "PRIVATE"])
      assert.equal(wire.includes(privateValue), false);
  } finally { f.close(); }
});

test("operator model recovery withholds disclosure when session expires, revokes or controller closes during read", () => {
  for (const mode of ["expire", "revoke", "close"] as const) {
    const f = fixture(); try {
      f.onRead(() => { if (mode === "expire") f.setTime(OPERATOR_SESSION_TTL_MS);
        else if (mode === "revoke") f.paired.session.revoke(); else f.controller.close(); });
      assert.throws(() => f.read(), reason(mode === "close" ? "closed" : "session-denied")); assert.equal(f.reads(), 1);
    } finally { f.close(); }
  }
});

test("operator model recovery latches closed on a faulty or regressing observation clock", () => {
  for (const mode of ["throw", "negative", "nan", "regress"] as const) {
    const f = fixture(); try {
      if (mode === "regress") { f.setTime(10); f.read(); }
      f.setClock(() => { if (mode === "throw") throw new Error("PRIVATE_CLOCK"); return mode === "nan" ? NaN : mode === "negative" ? -1 : 9; });
      assert.throws(() => f.read(), reason("clock-invalid"));
      f.setClock(() => 100); assert.throws(() => f.read(), reason("closed"));
      assert.equal(f.reads(), mode === "regress" ? 1 : 0);
    } finally { f.close(); }
  }
});

test("operator model recovery redacts storage failures and charges the read attempt without a retry", () => {
  const f = fixture(); try {
    f.db.pragma("synchronous=NORMAL");
    assert.throws(() => f.read(), reason("inventory-unavailable")); assert.equal(f.reads(), 1);
    assert.throws(() => f.read(), reason("inventory-unavailable")); assert.equal(f.reads(), 2);
    f.db.pragma("synchronous=FULL"); assert.throws(() => f.read(), reason("rate-limited"));
    f.setTime(60_000); f.read(); assert.equal(f.reads(), 3);
  } finally { f.close(); }
});

test("operator model recovery cannot disclose a different validated book under the requested pin", () => {
  const a = fixture(), b = fixture(); try {
    const controller = new WindowsOperatorModelRecovery({ session: a.paired.session, book: b.book,
      expectedBudgetDigest: a.request.budgetDigest, now: () => 0 });
    assert.throws(() => controller.read(a.wire, a.credentials.sessionToken, a.credentials.csrfToken), reason("inventory-unavailable"));
    controller.close(); assert.equal(a.book.snapshot().attempts, 0); assert.equal(b.book.snapshot().attempts, 0);
  } finally { a.close(); b.close(); }
});

test("operator model recovery rejects an oversized trusted-store fault without returning metadata", () => {
  const f = fixture(); let reads = 0;
  try {
    const controller = new WindowsOperatorModelRecovery({ session: f.paired.session, expectedBudgetDigest: f.request.budgetDigest,
      book: { recoverySnapshot() { reads++; return { ...f.book.recoverySnapshot(),
        unexpectedPadding: "x".repeat(OPERATOR_MODEL_RECOVERY_LIMITS.responseBytes) }; } }, now: () => 0 });
    assert.throws(() => controller.read(f.wire, f.credentials.sessionToken, f.credentials.csrfToken), reason("inventory-unavailable"));
    assert.equal(reads, 1); controller.close();
  } finally { f.close(); }
});

test("operator model recovery does not reflect on non-wire inputs or disclose data after a post-read clock fault", () => {
  const f = fixture(); let getters = 0;
  try {
    const input = { get action() { getters++; throw new Error("PRIVATE_ACCESSOR"); } };
    assert.throws(() => f.read(input), reason("request-invalid")); assert.equal(getters, 0); assert.equal(f.reads(), 0);
    f.onRead(() => f.setClock(() => { throw new Error("PRIVATE_CLOCK"); }));
    assert.throws(() => f.read(), reason("clock-invalid")); assert.equal(f.reads(), 1);
    f.setClock(() => 100); assert.throws(() => f.read(), reason("closed"));
  } finally { f.close(); }
});
