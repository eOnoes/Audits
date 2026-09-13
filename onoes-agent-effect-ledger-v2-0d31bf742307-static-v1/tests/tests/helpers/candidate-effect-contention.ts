import { parentPort, workerData } from "node:worker_threads";
import Database from "better-sqlite3";
import { SqliteCandidateEffectLedger } from "../../src/build-only/windows-candidate-effect-ledger.js";
import { CandidateEffectError } from "../../src/build-only/windows-candidate-effect-state.js";

// Synthetic test DB only. Parent retains BEGIN IMMEDIATE until BOTH failed
// acquisitions are reported. A second phase tests recovery after explicit release.
const data = workerData as { path: string; storeId: string; namespaceId: string; intent: unknown; barrier: SharedArrayBuffer };
const db = new Database(data.path, { fileMustExist: true });
const gate = new Int32Array(data.barrier);
function awaitPhase(phase: number): void {
  const deadline = performance.now() + 10_000;
  while (Atomics.load(gate, 0) < phase) {
    const remaining = deadline - performance.now(); if (remaining <= 0) throw new Error("contention-barrier-expired");
    Atomics.wait(gate, 0, phase - 1, remaining);
  }
}
try {
  const store = new SqliteCandidateEffectLedger(db, data.storeId, data.namespaceId, () => "2026-09-13T12:00:00.000Z");
  parentPort!.postMessage({ ready: true }); awaitPhase(1);
  let sqliteCode = "unexpected-acquisition";
  try { db.exec("BEGIN IMMEDIATE"); db.exec("ROLLBACK"); }
  catch (error) { sqliteCode = error instanceof Error && "code" in error ? String(error.code) : "unexpected-error"; }
  let ledgerReason = "unexpected-reservation";
  try { store.reserve(data.intent); }
  catch (error) { ledgerReason = error instanceof CandidateEffectError ? error.reason : "unexpected-error"; }
  parentPort!.postMessage({ sqliteCode, ledgerReason }); awaitPhase(2);
  parentPort!.postMessage({ afterRelease: store.reserve(data.intent).disposition });
} finally { if (db.inTransaction) db.exec("ROLLBACK"); db.close(); }
