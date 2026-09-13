import Database from "better-sqlite3";
import { SqliteCandidateEffectLedger } from "../../src/build-only/windows-candidate-effect-ledger.js";
import type { CandidateEffectAdvance } from "../../src/build-only/windows-candidate-effect-state.js";

// Parent supplies only a new synthetic temp DB and metadata. Exit deliberately
// without closing SQLite after a committed possible-effect marker; no effect.
const input = JSON.parse(process.argv[2]!) as { path: string; storeId: string; namespaceId: string; event: CandidateEffectAdvance };
const db = new Database(input.path, { fileMustExist: true });
const store = new SqliteCandidateEffectLedger(db, input.storeId, input.namespaceId, () => "2026-09-13T12:00:00.000Z");
store.advance(input.event);
process.exit(23);
