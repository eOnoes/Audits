import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { CANDIDATE_EFFECT_MAX_OPERATIONS, CANDIDATE_EFFECT_MAX_RECORD_BYTES, CandidateEffectError,
  advanceCandidateEffectRecord, candidateEffectBlocked, candidateEffectState, effectAdvanceSchema,
  effectApprovalIdentity, effectFail, effectIntentSchema, effectParse, effectTime, effectUuid,
  validateCandidateEffectRecord } from "./windows-candidate-effect-state.js";
import type { CandidateEffectIntent, CandidateEffectRecord } from "./windows-candidate-effect-state.js";

// No signer, consumer, port, filesystem effect, or migration. The trusted host
// owns this connection and must protect the file/WAL/SHM and enrollment pins.
const META = `CREATE TABLE candidate_effect_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL CHECK (version = 2),
  store_id TEXT NOT NULL, namespace_id TEXT NOT NULL
)`;
const OPS = `CREATE TABLE candidate_effect_operations (
  operation_id TEXT PRIMARY KEY NOT NULL, approval_identity_digest TEXT UNIQUE NOT NULL,
  workflow_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('execute','publish')),
  workspace_digest TEXT NOT NULL, blocked INTEGER NOT NULL CHECK (blocked IN (0,1)),
  record_json TEXT NOT NULL CHECK (length(CAST(record_json AS BLOB)) BETWEEN 2 AND 32768),
  record_digest TEXT NOT NULL, UNIQUE(workflow_id,kind)
)`;
const LOCK = `CREATE UNIQUE INDEX candidate_effect_workspace_lock
  ON candidate_effect_operations(workspace_digest) WHERE blocked = 1`;
const EXPECTED = [{ name: "candidate_effect_meta", sql: META }, { name: "candidate_effect_operations", sql: OPS },
  { name: "candidate_effect_workspace_lock", sql: LOCK }];
const schemaRows = (db: Database.Database) => db.prepare("SELECT name,sql FROM main.sqlite_schema WHERE sql IS NOT NULL ORDER BY name").all();
function schema(db: Database.Database): void {
  if (canonicalJson(schemaRows(db)) !== canonicalJson(EXPECTED)
    || db.prepare("SELECT 1 FROM temp.sqlite_schema LIMIT 1").get() !== undefined
    || (db.pragma("database_list") as { name: string }[]).some(x => !["main", "temp"].includes(x.name))) effectFail("schema-invalid");
}
function durability(db: Database.Database): void {
  if (db.pragma("journal_mode", { simple: true }) !== (db.name === ":memory:" ? "memory" : "wal")
    || db.pragma("synchronous", { simple: true }) !== 2 || db.pragma("foreign_keys", { simple: true }) !== 1
    || db.pragma("trusted_schema", { simple: true }) !== 0 || db.pragma("busy_timeout", { simple: true }) !== 250
    || db.pragma("ignore_check_constraints", { simple: true }) !== 0) effectFail("durability-invalid");
}
function configure(db: Database.Database): void {
  if (db.inTransaction) effectFail("transaction-active");
  db.pragma("journal_mode=WAL"); db.pragma("synchronous=FULL"); db.pragma("foreign_keys=ON");
  db.pragma("trusted_schema=OFF"); db.pragma("busy_timeout=250"); durability(db);
}
function guard<T>(fn: () => T): T {
  try { return fn(); } catch (e) { if (e instanceof CandidateEffectError) throw e; return effectFail("storage-unavailable"); }
}
/** Explicit fresh-store initialization only. Namespace enrollment is NOT done here. */
export function initializeCandidateEffectLedger(db: Database.Database, namespaceId: string): string {
  return guard(() => {
    effectParse(effectUuid, namespaceId); if (schemaRows(db).length !== 0) effectFail("schema-invalid");
    configure(db); const storeId = randomUUID();
    db.transaction(() => {
      if (schemaRows(db).length !== 0) effectFail("schema-invalid");
      for (const item of EXPECTED) db.exec(item.sql);
      db.prepare("INSERT INTO candidate_effect_meta VALUES (1,2,?,?)").run(storeId, namespaceId); schema(db);
    }).immediate();
    return storeId;
  });
}
type Row = { operation_id: string; approval_identity_digest: string; workflow_id: string; kind: string;
  workspace_digest: string; blocked: number; record_json: unknown; record_digest: string };
const subjectFields = ["namespaceId", "storeId", "workflowId", "workspaceDigest", "policyBindingDigest", "candidateDigest", "reviewMaterialDigest",
  "sourceManifestDigest", "requestDigest", "guestImageDigest", "guestGeneration", "controllerIdentityDigest", "resourcePolicyDigest"] as const;
function verifiedParent(records: CandidateEffectRecord[], intent: CandidateEffectIntent, reservedAt?: string): void {
  if (intent.kind !== "publish") return;
  const parent = records.find(r => r.intent.operationId === intent.executionOperationId);
  const observation = parent?.events.find(e => e.state === "result-and-stop-observed");
  if (!parent || parent.intent.kind !== "execute" || candidateEffectState(parent) !== "completed"
    || observation?.verificationPassed !== true || observation.resultDigest !== intent.resultDigest
    || subjectFields.some(key => parent.intent[key] !== intent[key])
    || (reservedAt !== undefined && reservedAt < parent.events.at(-1)!.recordedAt)) effectFail("execution-unverified");
}
export class SqliteCandidateEffectLedger {
  #writePoisoned = false;
  readonly #db: Database.Database;
  readonly #storeId: string;
  readonly #namespaceId: string;
  readonly #now: () => string;
  constructor(db: Database.Database, storeId: string,
    namespaceId: string, now: () => string = () => new Date().toISOString()) {
    this.#db = db; this.#storeId = storeId; this.#namespaceId = namespaceId; this.#now = now;
    guard(() => { effectParse(effectUuid, storeId); effectParse(effectUuid, namespaceId); schema(db); configure(db); this.#preflight(); });
  }
  #preflight(): void {
    if (this.#db.inTransaction) effectFail("transaction-active"); schema(this.#db); durability(this.#db);
    const rows = this.#db.prepare("SELECT singleton,version,substr(store_id,1,37) AS store_id,substr(namespace_id,1,37) AS namespace_id FROM candidate_effect_meta LIMIT 2").all();
    if (canonicalJson(rows) !== canonicalJson([{ singleton: 1, version: 2, store_id: this.#storeId, namespace_id: this.#namespaceId }])) effectFail("identity-mismatch");
  }
  #scan(): CandidateEffectRecord[] {
    // Bound driver allocation even if external corruption bypassed SQL CHECKs.
    const rows = this.#db.prepare(`SELECT substr(operation_id,1,37) AS operation_id,
      substr(approval_identity_digest,1,72) AS approval_identity_digest,substr(workflow_id,1,37) AS workflow_id,
      substr(kind,1,8) AS kind,substr(workspace_digest,1,72) AS workspace_digest,blocked,
      CASE WHEN typeof(record_json)='text' AND length(CAST(record_json AS BLOB))<=32768 THEN record_json ELSE NULL END AS record_json,
      substr(record_digest,1,72) AS record_digest FROM candidate_effect_operations ORDER BY operation_id LIMIT 1001`).all() as Row[];
    if (rows.length > CANDIDATE_EFFECT_MAX_OPERATIONS) effectFail("limit-exceeded");
    const records = rows.map(row => {
      let record: CandidateEffectRecord;
      try {
        if (typeof row.record_json !== "string") return effectFail("state-invalid");
        record = validateCandidateEffectRecord(JSON.parse(row.record_json));
        if (canonicalJson(record) !== row.record_json || canonicalSha256Digest(record) !== row.record_digest) return effectFail("state-invalid");
      } catch { return effectFail("state-invalid"); }
      if (record.intent.storeId !== this.#storeId || record.intent.namespaceId !== this.#namespaceId) return effectFail("identity-mismatch");
      if (record.intent.operationId !== row.operation_id
        || record.approvalIdentityDigest !== row.approval_identity_digest || record.intent.workflowId !== row.workflow_id
        || record.intent.kind !== row.kind || record.intent.workspaceDigest !== row.workspace_digest
        || Number(candidateEffectBlocked(record)) !== row.blocked) return effectFail("state-invalid");
      return record;
    });
    // Re-derive cross-row invariants independently of SQL index integrity.
    // UUIDs and kind are strictly parsed, so the workflow separator is unambiguous.
    const operations = new Set<string>(), approvals = new Set<string>(), workflows = new Set<string>(), blocked = new Set<string>();
    for (const record of records) {
      const { operationId, workflowId, kind, workspaceDigest } = record.intent;
      const workflow = `${workflowId}:${kind}`, holdsWorkspace = candidateEffectBlocked(record);
      if (operations.has(operationId) || approvals.has(record.approvalIdentityDigest)
        || workflows.has(workflow) || (holdsWorkspace && blocked.has(workspaceDigest))) effectFail("state-invalid");
      operations.add(operationId); approvals.add(record.approvalIdentityDigest); workflows.add(workflow);
      if (holdsWorkspace) blocked.add(workspaceDigest);
    }
    try { for (const record of records) verifiedParent(records, record.intent, record.reservedAt); } catch { effectFail("state-invalid"); }
    return records;
  }
  #readAll(): CandidateEffectRecord[] {
    return guard(() => { this.#preflight(); return this.#db.transaction(() => this.#scan()).deferred(); });
  }
  #readOne(operationId: string): CandidateEffectRecord | undefined {
    return this.#readAll().find(r => r.intent.operationId === operationId);
  }
  read(operationId: string): CandidateEffectRecord | undefined {
    effectParse(effectUuid, operationId); return this.#readOne(operationId);
  }
  listBlocked(): readonly CandidateEffectRecord[] { return deepFreeze(this.#readAll().filter(candidateEffectBlocked)); }
  #save(record: CandidateEffectRecord, insert: boolean): void {
    const wire = canonicalJson(record); if (Buffer.byteLength(wire) > CANDIDATE_EFFECT_MAX_RECORD_BYTES) effectFail("limit-exceeded");
    const args = [record.intent.operationId, record.approvalIdentityDigest, record.intent.workflowId, record.intent.kind,
      record.intent.workspaceDigest, Number(candidateEffectBlocked(record)), wire, canonicalSha256Digest(record)];
    const changes = insert ? this.#db.prepare("INSERT INTO candidate_effect_operations VALUES (?,?,?,?,?,?,?,?)").run(...args).changes
      : this.#db.prepare("UPDATE candidate_effect_operations SET blocked=?,record_json=?,record_digest=? WHERE operation_id=?")
        .run(args[5], args[6], args[7], args[0]).changes;
    if (changes !== 1) effectFail("state-invalid");
  }
  #write(operation: (records: CandidateEffectRecord[], at: string) => { record: CandidateEffectRecord; replayed: boolean }) {
    if (this.#writePoisoned) effectFail("write-poisoned");
    return guard(() => {
      this.#preflight();
      // Host clock is sampled outside the transaction; no injected callbacks
      // or external effects run in the IMMEDIATE transaction below.
      let at: string; try { at = effectParse(effectTime, this.#now(), "clock-invalid"); } catch { return effectFail("clock-invalid"); }
      let touched = false;
      try {
        const saved = this.#db.transaction(() => {
          const records = this.#scan();
          if (records.some(r => at < (r.events.at(-1)?.recordedAt ?? r.reservedAt))) effectFail("clock-invalid");
          const result = operation(records, at);
          if (!result.replayed) { touched = true; this.#save(result.record, !records.some(r => r.intent.operationId === result.record.intent.operationId)); }
          return result;
        }).immediate();
        const found = this.#readOne(saved.record.intent.operationId);
        if (canonicalJson(found) !== canonicalJson(saved.record)) effectFail("state-invalid");
        return deepFreeze({ kind: "recorded-state-not-effect-permission" as const, disposition: saved.replayed ? "replayed" as const : "recorded" as const,
          storeId: this.#storeId, record: found! });
      } catch (e) { if (touched) this.#writePoisoned = true; throw e; }
    });
  }
  reserve(value: unknown) {
    const intent = effectParse(effectIntentSchema, value);
    if (intent.namespaceId !== this.#namespaceId || intent.storeId !== this.#storeId) effectFail("identity-mismatch");
    return this.#write((records, at) => {
      const existing = records.find(r => r.intent.operationId === intent.operationId);
      if (existing) {
        if (canonicalJson(existing.intent) !== canonicalJson(intent)) effectFail("intent-conflict");
        return { record: existing, replayed: true };
      }
      if (records.some(r => r.approvalIdentityDigest === effectApprovalIdentity(intent))) effectFail("approval-reused");
      if (records.some(r => r.intent.workflowId === intent.workflowId && r.intent.kind === intent.kind)) effectFail("workflow-reused");
      if (records.some(r => r.intent.workspaceDigest === intent.workspaceDigest && candidateEffectBlocked(r))) effectFail("workspace-blocked");
      if (records.length >= CANDIDATE_EFFECT_MAX_OPERATIONS) effectFail("limit-exceeded");
      if (at >= intent.expiresAt) effectFail("expired"); verifiedParent(records, intent);
      return { replayed: false, record: validateCandidateEffectRecord({ intent, intentDigest: canonicalSha256Digest(intent),
        approvalIdentityDigest: effectApprovalIdentity(intent), reservedAt: at, events: [] }) };
    });
  }
  advance(value: unknown) {
    const input = effectParse(effectAdvanceSchema, value);
    return this.#write((records, at) => {
      const record = records.find(r => r.intent.operationId === input.operationId);
      if (!record) return effectFail("operation-missing");
      if (record.intentDigest !== input.intentDigest) effectFail("intent-conflict");
      const previous = record.events.find(e => e.state === input.state);
      if (previous) {
        if (previous.evidenceDigest !== input.evidenceDigest || previous.resultDigest !== input.resultDigest
          || previous.verificationPassed !== input.verificationPassed) effectFail("intent-conflict");
        return { record, replayed: true };
      }
      return { record: advanceCandidateEffectRecord(record, input, at), replayed: false };
    });
  }
}
