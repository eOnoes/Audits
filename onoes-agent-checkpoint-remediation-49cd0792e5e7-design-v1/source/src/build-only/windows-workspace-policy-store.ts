import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { DEFAULT_WINDOWS_WORKSPACE_POLICY, WINDOWS_WORKSPACE_POLICY_VERSION, parseWindowsWorkspacePolicy } from "./windows-workspace-policy.js";
import type { WindowsWorkspacePolicy } from "./windows-workspace-policy.js";

// Dedicated app-owned settings database, never the admission or conversation DB.
// The host authenticates operator updates before calling this build-only store.
// A current binding is data, not an execution grant or a filesystem sandbox.
export const WORKSPACE_POLICY_MAX_UPDATES = 10_000;
export const WORKSPACE_POLICY_MAX_EFFECTS = 1_000;
const MAX_JSON_BYTES = 600_000;
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const revision = z.number().int().min(1).max(WORKSPACE_POLICY_MAX_UPDATES + 1);
const bindingSchema = z.object({ storeId: uuid, revision, policyDigest: digest }).strict();
const timestamp = z.string().refine((value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const receiptSchema = z.object({
  schemaVersion: z.literal("agent-workspace-policy-update/v1"),
  requestId: uuid,
  requestDigest: digest,
  previousBinding: bindingSchema,
  binding: bindingSchema,
  changedAt: timestamp,
  allowedRootCount: z.number().int().min(0).max(64),
  deniedRootCount: z.number().int().min(0).max(64),
}).strict().refine((value) => value.previousBinding.storeId === value.binding.storeId
  && value.binding.revision === value.previousBinding.revision + 1);
const updateSchema = z.object({
  requestId: uuid,
  expectedBinding: bindingSchema,
  rules: z.object({ allowedRoots: z.unknown(), deniedRoots: z.unknown() }).strict(),
}).strict();
const effectInputSchema = z.object({operationId:uuid, authorizationDigest:digest,
  requestDigest:digest, binding:bindingSchema}).strict();
const effectSettlementSchema = z.object({outcome:z.enum(["completed","unchanged","quarantined"]),
  evidenceDigest:digest,recordedAt:timestamp}).strict();
const effectRecordSchema = effectInputSchema.extend({
  schemaVersion:z.literal("agent-workspace-effect-intent/v1"),startedAt:timestamp,
  settlement:effectSettlementSchema.nullable(),
}).strict().refine(r=>r.settlement===null||r.settlement.recordedAt>=r.startedAt);
const settleInputSchema = z.object({operationId:uuid,requestDigest:digest,
  outcome:z.enum(["completed","unchanged","quarantined"]),evidenceDigest:digest}).strict();
export type WorkspaceEffectRecord = Readonly<z.infer<typeof effectRecordSchema>>;

export type WorkspacePolicyBinding = Readonly<z.infer<typeof bindingSchema>>;
export type WorkspacePolicyUpdateReceipt = Readonly<z.infer<typeof receiptSchema>>;
export interface WorkspacePolicySnapshot {
  readonly binding: WorkspacePolicyBinding;
  readonly policy: WindowsWorkspacePolicy;
}
export type WorkspacePolicyStoreReason = "storage-unavailable" | "schema-invalid" | "state-invalid"
  | "durability-invalid" | "transaction-active" | "request-invalid" | "stale-policy"
  | "request-id-conflict" | "update-limit" | "clock-invalid" | "clock-regression"
  | "effect-pending" | "effect-already-started" | "effect-missing" | "effect-conflict"
  | "effect-limit" | "authorization-reused";
export class WorkspacePolicyStoreError extends Error {
  constructor(public readonly reason: WorkspacePolicyStoreReason) {
    super(`workspace-policy-${reason}`);
    this.name = "WorkspacePolicyStoreError";
  }
}
const fail = (reason: WorkspacePolicyStoreReason): never => { throw new WorkspacePolicyStoreError(reason); };
function guarded<T>(operation: () => T): T {
  try { return operation(); } catch (error) {
    if (error instanceof WorkspacePolicyStoreError) throw error;
    return fail("storage-unavailable");
  }
}

const STATE_SQL = `CREATE TABLE workspace_policy_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  store_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 10001),
  policy_json TEXT NOT NULL CHECK (length(policy_json) BETWEEN 2 AND 600000),
  policy_digest TEXT NOT NULL
)`;
const RECEIPTS_SQL = `CREATE TABLE workspace_policy_updates (
  request_id TEXT PRIMARY KEY NOT NULL,
  resulting_revision INTEGER NOT NULL UNIQUE CHECK (resulting_revision BETWEEN 2 AND 10001),
  receipt_json TEXT NOT NULL CHECK (length(receipt_json) BETWEEN 2 AND 4096),
  receipt_digest TEXT NOT NULL
)`;
const EFFECTS_SQL = `CREATE TABLE workspace_policy_effects (
  operation_id TEXT PRIMARY KEY NOT NULL,
  authorization_digest TEXT UNIQUE NOT NULL,
  active INTEGER UNIQUE CHECK (active IS NULL OR active = 1),
  record_json TEXT NOT NULL CHECK (length(CAST(record_json AS BLOB)) BETWEEN 2 AND 4096),
  record_digest TEXT NOT NULL
)`;

function schemaObjects(database: Database.Database): Array<{ name: string; type: string; sql: string }> {
  return database.prepare("SELECT name, type, sql FROM main.sqlite_schema WHERE sql IS NOT NULL ORDER BY name")
    .all() as Array<{ name: string; type: string; sql: string }>;
}
function assertSchema(database: Database.Database, legacy = false): void {
  const objects = schemaObjects(database);
  const expected=legacy?[STATE_SQL,RECEIPTS_SQL]:[EFFECTS_SQL,STATE_SQL,RECEIPTS_SQL];
  const names=legacy?["workspace_policy_state","workspace_policy_updates"]:["workspace_policy_effects","workspace_policy_state","workspace_policy_updates"];
  if (objects.length!==expected.length || objects.some((object,i)=>object.name!==names[i]||object.type!=="table"||object.sql!==expected[i])) fail("schema-invalid");
  if (database.prepare("SELECT 1 FROM temp.sqlite_schema LIMIT 1").get() !== undefined) fail("schema-invalid");
  if ((database.pragma("database_list") as {name:string}[]).some(x=>!["main","temp"].includes(x.name))) fail("schema-invalid");
}
function configure(database: Database.Database): void {
  if (database.inTransaction) fail("transaction-active");
  database.pragma("trusted_schema = OFF");
  database.pragma("busy_timeout = 250");
  database.pragma("journal_mode = WAL");
  database.pragma("synchronous = FULL");
  assertDurability(database);
}
function assertDurability(database: Database.Database): void {
  const mode = String(database.pragma("journal_mode", { simple: true })).toLowerCase();
  if ((database.name === ":memory:" ? mode !== "memory" : mode !== "wal")
    || database.pragma("synchronous", { simple: true }) !== 2
    || database.pragma("trusted_schema", { simple: true }) !== 0
    || database.pragma("busy_timeout", { simple: true }) !== 250) fail("durability-invalid");
}

/** Explicit first-install operation only. Opening an absent/corrupt store never
 * calls this automatically. No path creation or production bootstrap exists.
 */
export function initializeWindowsWorkspacePolicyStore(database: Database.Database): void {
  guarded(() => {
    if (schemaObjects(database).length !== 0) fail("schema-invalid");
    configure(database);
    database.transaction(() => {
      if (schemaObjects(database).length !== 0) fail("schema-invalid");
      database.exec(STATE_SQL);
      database.exec(RECEIPTS_SQL);
      database.exec(EFFECTS_SQL);
      database.prepare("INSERT INTO workspace_policy_state VALUES (1, 1, ?, 1, ?, ?)")
        .run(randomUUID(), canonicalJson(DEFAULT_WINDOWS_WORKSPACE_POLICY), canonicalSha256Digest(DEFAULT_WINDOWS_WORKSPACE_POLICY));
      assertSchema(database);
    }).immediate();
  });
}

/** Explicit build-only storage-layout upgrade. Old policy/receipt bytes are
 * never rewritten. Opening an old/missing effects table does NOT auto-migrate.
 * An old binary cannot open the new layout: compatible rollback must retain it.
 */
export function upgradeWindowsWorkspacePolicyEffectIntents(database:Database.Database):void {
  guarded(()=>{
    assertSchema(database,true);configure(database);
    database.transaction(()=>{
      assertSchema(database,true);
      const states=database.prepare(`SELECT schema_version,store_id,revision,policy_digest,
        CASE WHEN typeof(policy_json)='text' AND length(CAST(policy_json AS BLOB))<=600000 THEN policy_json ELSE NULL END AS policy_json
        FROM workspace_policy_state LIMIT 2`).all() as StateRow[];
      const row=states[0];
      if(states.length!==1||!row||row.schema_version!==1||typeof row.policy_json!=="string")return fail("state-invalid");
      let policy:WindowsWorkspacePolicy;
      try { policy=parseWindowsWorkspacePolicy(JSON.parse(row.policy_json)); } catch { return fail("state-invalid"); }
      const binding=bindingSchema.safeParse({storeId:row.store_id,revision:row.revision,policyDigest:row.policy_digest});
      if(!binding.success||policy.revision!==row.revision||canonicalJson(policy)!==row.policy_json
        ||canonicalSha256Digest(policy)!==row.policy_digest)fail("state-invalid");
      const receipts=database.prepare(`SELECT request_id,resulting_revision,receipt_digest,
        CASE WHEN typeof(receipt_json)='text' AND length(CAST(receipt_json AS BLOB))<=4096 THEN receipt_json ELSE NULL END AS receipt_json
        FROM workspace_policy_updates ORDER BY resulting_revision LIMIT 10001`).all() as ReceiptRow[];
      if(receipts.length!==row.revision-1||receipts.length>WORKSPACE_POLICY_MAX_UPDATES)fail("state-invalid");
      let prior:WorkspacePolicyBinding={storeId:row.store_id,revision:1,policyDigest:canonicalSha256Digest(DEFAULT_WINDOWS_WORKSPACE_POLICY)};
      let lastTime="";
      for(const value of receipts){
        const receipt=parseReceipt(value);
        if(canonicalJson(receipt.previousBinding)!==canonicalJson(prior)||receipt.changedAt<lastTime)fail("state-invalid");
        prior=receipt.binding;lastTime=receipt.changedAt;
      }
      if(canonicalJson(prior)!==canonicalJson(binding.data))fail("state-invalid");
      const latest=receipts.length?parseReceipt(receipts[receipts.length-1]!):undefined;
      if(latest&&(latest.allowedRootCount!==policy.allowedRoots.length||latest.deniedRootCount!==policy.deniedRoots.length))fail("state-invalid");
      database.exec(EFFECTS_SQL);assertSchema(database);
    }).immediate();
    // Separate reopen/read-back path, not a success claim from DDL alone.
    new SqliteWindowsWorkspacePolicyStore(database).snapshot();
  });
}

type StateRow = { schema_version: number; store_id: string; revision: number; policy_json: string; policy_digest: string };
type ReceiptRow = { request_id: string; resulting_revision: number; receipt_json: string; receipt_digest: string };
function parseReceipt(row: ReceiptRow): WorkspacePolicyUpdateReceipt {
  try {
    if (typeof row.receipt_json !== "string" || Buffer.byteLength(row.receipt_json) > 4096) return fail("state-invalid");
    const receipt = receiptSchema.parse(JSON.parse(row.receipt_json));
    if (canonicalJson(receipt) !== row.receipt_json || canonicalSha256Digest(receipt) !== row.receipt_digest
      || receipt.requestId !== row.request_id || receipt.binding.revision !== row.resulting_revision) return fail("state-invalid");
    return deepFreeze(receipt);
  } catch { return fail("state-invalid"); }
}

export class SqliteWindowsWorkspacePolicyStore {
  readonly #database: Database.Database;
  readonly #now: () => string;
  constructor(database: Database.Database, now: () => string = () => new Date().toISOString()) {
    this.#database = database;
    this.#now = now;
    guarded(() => {
      assertSchema(database); // Never "repair" an absent/foreign schema on open.
      configure(database);
      this.snapshot();
    });
  }

  snapshot(): WorkspacePolicySnapshot {
    return this.#read(() => this.#snapshot());
  }

  /** Recheck before an operation; returning is not atomic with a later effect.
   * Future consumers must also serialize revocation with their effect boundary.
   */
  assertCurrentBinding(input: unknown): void {
    const expected = bindingSchema.safeParse(input);
    if (!expected.success) fail("request-invalid");
    const current = this.snapshot().binding;
    if (canonicalJson(expected.data) !== canonicalJson(current)) fail("stale-policy");
  }

  /** One-shot durable intent, NOT approval or an execution token. The trusted
   * broker must independently verify approval, scope and physical custody FIRST.
   * Commit and read-back finish before return; no callback/await inside the tx.
   * Retry is readEffectIntent, never another effect invocation.
   */
  beginEffectIntent(input:unknown,notBefore?:string):WorkspaceEffectRecord {
    const parsed=effectInputSchema.safeParse(input);if(!parsed.success)return fail("request-invalid");
    if(notBefore!==undefined&&!timestamp.safeParse(notBefore).success)return fail("request-invalid");
    const request=parsed.data;
    return guarded(()=>{
      this.#preflight();
      const saved=this.#database.transaction(()=>{
        const snapshot=this.#snapshot(), records=this.#effects(snapshot.binding);
        if(records.some(r=>r.operationId===request.operationId))fail("effect-already-started");
        if(records.some(r=>r.authorizationDigest===request.authorizationDigest))fail("authorization-reused");
        if(canonicalJson(snapshot.binding)!==canonicalJson(request.binding))fail("stale-policy");
        if(records.some(r=>r.settlement===null||r.settlement.outcome==="quarantined"))fail("effect-pending");
        if(records.length>=WORKSPACE_POLICY_MAX_EFFECTS)fail("effect-limit");
        const startedAt=this.#now();if(!timestamp.safeParse(startedAt).success)fail("clock-invalid");
        const latest=this.#latestReceipt();
        if((notBefore!==undefined&&startedAt<notBefore)||(latest&&startedAt<latest.changedAt)
          ||records.some(r=>startedAt<(r.settlement?.recordedAt??r.startedAt)))fail("clock-regression");
        const record:WorkspaceEffectRecord={...request,schemaVersion:"agent-workspace-effect-intent/v1",startedAt,settlement:null};
        this.#database.prepare("INSERT INTO workspace_policy_effects VALUES (?,?,1,?,?)")
          .run(record.operationId,record.authorizationDigest,canonicalJson(record),canonicalSha256Digest(record));
        return record;
      }).immediate();
      const readBack=this.readEffectIntent(request.operationId);
      if(canonicalJson(readBack)!==canonicalJson(saved))fail("effect-conflict");
      return readBack;
    });
  }
  readEffectIntent(operationId:string):WorkspaceEffectRecord {
    if(!uuid.safeParse(operationId).success)fail("request-invalid");
    return this.#read(()=>this.#requiredEffect(operationId));
  }
  /** Validated bounded history for trusted startup discovery, not an execution
   * grant. Include settled rows so orphaned/cross-store records are not hidden. */
  listEffectIntents():readonly WorkspaceEffectRecord[] {
    return this.#read(()=>Object.freeze(this.#effects(this.#snapshot().binding)));
  }
  /** Lifetime effect quota; settlement does not free a slot. This is neither
   * permission to start work nor a disk-space measurement. */
  readCapacity() {
    return this.#read(()=>{
      const records=this.#effects(this.#snapshot().binding);
      return Object.freeze({kind:"logical-quota-usage-not-admission" as const,
        effectCount:records.length,effectLimit:WORKSPACE_POLICY_MAX_EFFECTS,
        remainingEffectSlots:WORKSPACE_POLICY_MAX_EFFECTS-records.length});
    });
  }
  /** Only verified stopped/settled effects may be released. This persists the
   * trusted host's evidence claim; it does not verify files or stop an executor.
   * Quarantine remains a durable blocker; no timeout/reset/delete API exists.
   * Optional notBefore binds a preceding store's committed timestamp. It only
   * adds a denial condition, before mutation; it never rewrites historical time.
   */
  settleEffectIntent(input:unknown,notBefore?:string):WorkspaceEffectRecord {
    const parsed=settleInputSchema.safeParse(input);if(!parsed.success)return fail("request-invalid");
    if(notBefore!==undefined&&!timestamp.safeParse(notBefore).success)return fail("request-invalid");
    const request=parsed.data;
    return guarded(()=>{
      this.#preflight();this.#database.transaction(()=>{
        const record=this.#requiredEffect(request.operationId);
        if(record.requestDigest!==request.requestDigest)fail("effect-conflict");
        if(record.settlement!==null){
          if(record.settlement.outcome!==request.outcome||record.settlement.evidenceDigest!==request.evidenceDigest)fail("effect-conflict");
          if(notBefore!==undefined&&record.settlement.recordedAt<notBefore)fail("clock-regression");
          return;
        }
        const recordedAt=this.#now();if(!timestamp.safeParse(recordedAt).success)fail("clock-invalid");
        if(recordedAt<record.startedAt||(notBefore!==undefined&&recordedAt<notBefore))fail("clock-regression");
        const settled={...record,settlement:{outcome:request.outcome,evidenceDigest:request.evidenceDigest,recordedAt}};
        const changed=this.#database.prepare("UPDATE workspace_policy_effects SET active=?,record_json=?,record_digest=? WHERE operation_id=?")
          .run(request.outcome==="quarantined"?1:null,canonicalJson(settled),canonicalSha256Digest(settled),record.operationId);
        if(changed.changes!==1)fail("state-invalid");
      }).immediate();return this.readEffectIntent(request.operationId);
    });
  }
  #requiredEffect(operationId:string):WorkspaceEffectRecord {
    const snapshot=this.#snapshot();
    const record=this.#effects(snapshot.binding).find(r=>r.operationId===operationId);
    if(!record)return fail("effect-missing");return record;
  }
  #effects(binding:WorkspacePolicyBinding):WorkspaceEffectRecord[] {
    const rows=this.#database.prepare(`SELECT substr(operation_id,1,37) AS operation_id,
      substr(authorization_digest,1,72) AS authorization_digest,active,substr(record_digest,1,72) AS record_digest,
      CASE WHEN typeof(record_json)='text' AND length(CAST(record_json AS BLOB))<=4096 THEN record_json ELSE NULL END AS record_json
      FROM workspace_policy_effects ORDER BY operation_id LIMIT 1001`).all() as {operation_id:string;authorization_digest:string;active:number|null;record_json:string|null;record_digest:string}[];
    if(rows.length>WORKSPACE_POLICY_MAX_EFFECTS)fail("state-invalid");
    return rows.map(row=>{
      try {
        if(typeof row.record_json!=="string")return fail("state-invalid");
        const r=effectRecordSchema.parse(JSON.parse(row.record_json));
        const active=r.settlement===null||r.settlement.outcome==="quarantined";
        if(canonicalJson(r)!==row.record_json||canonicalSha256Digest(r)!==row.record_digest||r.operationId!==row.operation_id
          ||r.authorizationDigest!==row.authorization_digest||row.active!==(active?1:null)
          ||r.binding.storeId!==binding.storeId||r.binding.revision>binding.revision
          ||(active&&canonicalJson(r.binding)!==canonicalJson(binding)))return fail("state-invalid");
        return deepFreeze(r);
      }catch{return fail("state-invalid");}
    });
  }

  update(input: unknown): WorkspacePolicyUpdateReceipt {
    const request = updateSchema.safeParse(input);
    if (!request.success) return fail("request-invalid");
    if (request.data.expectedBinding.revision >= WORKSPACE_POLICY_MAX_UPDATES + 1) return fail("update-limit");
    let nextPolicy: WindowsWorkspacePolicy;
    try {
      nextPolicy = parseWindowsWorkspacePolicy({
        schemaVersion: WINDOWS_WORKSPACE_POLICY_VERSION,
        revision: request.data.expectedBinding.revision + 1,
        allowedRoots: request.data.rules.allowedRoots,
        deniedRoots: request.data.rules.deniedRoots,
      });
    } catch { return fail("request-invalid"); }
    const requestDigest = canonicalSha256Digest({
      requestId: request.data.requestId, expectedBinding: request.data.expectedBinding, policy: nextPolicy,
    });
    const policyJson = canonicalJson(nextPolicy);
    if (Buffer.byteLength(policyJson) > MAX_JSON_BYTES) return fail("request-invalid");

    return guarded(() => {
      this.#preflight();
      const receipt = this.#database.transaction(() => {
        const current = this.#snapshot();
        const existing = this.#receipt(request.data.requestId);
        if (existing !== undefined) {
          if (existing.requestDigest !== requestDigest) return fail("request-id-conflict");
          return existing; // Lost response: retain exact timestamp and bytes.
        }
        if (canonicalJson(current.binding) !== canonicalJson(request.data.expectedBinding)) return fail("stale-policy");
        const effects=this.#effects(current.binding);
        if(effects.some(r=>r.settlement===null||r.settlement.outcome==="quarantined"))fail("effect-pending");
        const changedAt = this.#now();
        if (!timestamp.safeParse(changedAt).success) return fail("clock-invalid");
        const latest = this.#latestReceipt();
        if (latest !== undefined && changedAt < latest.changedAt) return fail("clock-regression");
        if(effects.some(r=>changedAt<(r.settlement?.recordedAt??r.startedAt)))return fail("clock-regression");
        const binding: WorkspacePolicyBinding = {
          storeId: current.binding.storeId, revision: nextPolicy.revision, policyDigest: canonicalSha256Digest(nextPolicy),
        };
        const saved = receiptSchema.parse({
          schemaVersion: "agent-workspace-policy-update/v1", requestId: request.data.requestId,
          requestDigest, previousBinding: current.binding, binding, changedAt,
          allowedRootCount: nextPolicy.allowedRoots.length, deniedRootCount: nextPolicy.deniedRoots.length,
        });
        this.#database.prepare("INSERT INTO workspace_policy_updates VALUES (?, ?, ?, ?)")
          .run(saved.requestId, saved.binding.revision, canonicalJson(saved), canonicalSha256Digest(saved));
        const update = this.#database.prepare(`UPDATE workspace_policy_state SET revision = ?, policy_json = ?, policy_digest = ?
          WHERE singleton = 1 AND store_id = ? AND revision = ? AND policy_digest = ?`)
          .run(binding.revision, policyJson, binding.policyDigest, current.binding.storeId, current.binding.revision, current.binding.policyDigest);
        if (update.changes !== 1) return fail("state-invalid");
        this.#snapshot(); // Validate both rows while rollback is still possible.
        return deepFreeze(saved);
      }).immediate();
      // Receipt escapes only after commit and a separate read-back. If read-back
      // fails, callers recover with the SAME request id, never a fresh update.
      const readBack = this.#read(() => { this.#snapshot(); return this.#receipt(receipt.requestId); });
      if (readBack === undefined || canonicalJson(readBack) !== canonicalJson(receipt)) return fail("state-invalid");
      return readBack;
    });
  }

  #preflight(): void {
    if (this.#database.inTransaction) fail("transaction-active");
    assertDurability(this.#database);
    assertSchema(this.#database);
  }
  #read<T>(operation: () => T): T {
    return guarded(() => {
      this.#preflight();
      return this.#database.transaction(operation).deferred();
    });
  }
  #receipt(requestId: string): WorkspacePolicyUpdateReceipt | undefined {
    const row = this.#database.prepare("SELECT * FROM workspace_policy_updates WHERE request_id = ?").get(requestId) as ReceiptRow | undefined;
    return row === undefined ? undefined : parseReceipt(row);
  }
  #latestReceipt(): WorkspacePolicyUpdateReceipt | undefined {
    const row = this.#database.prepare("SELECT * FROM workspace_policy_updates ORDER BY resulting_revision DESC LIMIT 1").get() as ReceiptRow | undefined;
    return row === undefined ? undefined : parseReceipt(row);
  }
  #snapshot(): WorkspacePolicySnapshot {
    try {
      const rows = this.#database.prepare("SELECT * FROM workspace_policy_state").all() as StateRow[];
      const row = rows[0];
      if (rows.length !== 1 || row === undefined || row.schema_version !== 1
        || typeof row.policy_json !== "string" || Buffer.byteLength(row.policy_json) > MAX_JSON_BYTES) return fail("state-invalid");
      const policy = parseWindowsWorkspacePolicy(JSON.parse(row.policy_json));
      const binding = bindingSchema.parse({ storeId: row.store_id, revision: row.revision, policyDigest: row.policy_digest });
      if (policy.revision !== binding.revision || canonicalJson(policy) !== row.policy_json
        || canonicalSha256Digest(policy) !== binding.policyDigest) return fail("state-invalid");
      const count = (this.#database.prepare("SELECT count(*) AS count FROM workspace_policy_updates").get() as { count: number }).count;
      const latest = this.#latestReceipt();
      if (count !== policy.revision - 1) return fail("state-invalid");
      if (latest === undefined) {
        if (canonicalJson(policy) !== canonicalJson(DEFAULT_WINDOWS_WORKSPACE_POLICY)) return fail("state-invalid");
      } else if (canonicalJson(latest.binding) !== canonicalJson(binding)
        || latest.allowedRootCount !== policy.allowedRoots.length || latest.deniedRootCount !== policy.deniedRoots.length) return fail("state-invalid");
      this.#effects(binding); // Damaged active/JSON cross-links never reopen updates.
      return deepFreeze({ binding, policy });
    } catch (error) {
      if (error instanceof WorkspacePolicyStoreError) throw error;
      return fail("state-invalid");
    }
  }
}
