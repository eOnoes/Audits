import { parentPort, workerData } from "node:worker_threads";
import Database from "better-sqlite3";
import { SqliteCandidateEffectLedger } from "../../src/build-only/windows-candidate-effect-ledger.js";
import { CandidateEffectError } from "../../src/build-only/windows-candidate-effect-state.js";

// Test-only, independently opened connection. No task code or effect adapter.
const data = workerData as { path: string; storeId: string; namespaceId: string; intent: unknown; barrier: SharedArrayBuffer };
const db = new Database(data.path, { fileMustExist: true });
try {
  const store = new SqliteCandidateEffectLedger(db, data.storeId, data.namespaceId, () => "2026-09-13T12:00:00.000Z");
  parentPort!.postMessage({ ready: true });
  const barrier = new Int32Array(data.barrier);
  Atomics.wait(barrier, 0, 0, 10_000);
  if (Atomics.load(barrier, 0) !== 1) throw new Error("test-barrier-expired");
  try { parentPort!.postMessage({ result: store.reserve(data.intent).disposition }); }
  catch (e) { parentPort!.postMessage({ result: e instanceof CandidateEffectError ? e.reason : "unexpected-error" }); }
} finally { db.close(); }
