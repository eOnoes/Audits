import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { containsSecretLikeContent, decodeBuilderText, sha256BuilderDigest } from "../builder/content-policy.js";
import { isSafeBuilderRelativePath } from "../builder/schemas.js";
import { deepFreeze } from "../validation/deep-freeze.js";

// Build-only, trusted host storage. No approval, lease, filesystem writer or
// automatic resume. Preimages are PRIVATE app data, never audit/export content.
export const RECOVERY_MAX_FILE_BYTES = 16_777_216;
export const RECOVERY_MAX_OPERATION_BYTES = 67_108_864;
export const RECOVERY_MAX_STORE_BYTES = 268_435_456;
export const RECOVERY_MAX_OPERATIONS = 1_000;
const MAX_JSON = 700_000;
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const time = z.string().refine(v => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v);
const identitySchema = z.object({
  operationId: uuid, taskDigest: digest, proposalDigest: digest, authorizationDigest: digest,
  workspaceDigest: digest, scopeDigest: digest,
  policyBinding: z.object({storeId:uuid,revision:z.number().int().min(1).max(10_001),policyDigest:digest}).strict(),
}).strict();
const fileSchema = z.object({relativePath:z.string().refine(isSafeBuilderRelativePath),
  contentDigest:digest,byteLength:z.number().int().min(0).max(RECOVERY_MAX_FILE_BYTES)}).strict();
const requestSchema = z.object({identity:identitySchema,files:z.array(fileSchema).min(1).max(1_000)}).strict()
  .refine(v => v.files.reduce((n,f)=>n+f.byteLength,0)<=RECOVERY_MAX_OPERATION_BYTES
    && new Set(v.files.map(f=>f.relativePath.toLowerCase())).size===v.files.length
    && v.files.every((f,i)=>i===0 || v.files[i-1]!.relativePath<f.relativePath));
const preparedSchema = z.object({schemaVersion:z.literal("agent-builder-recovery-prepared/v1"),
  storeId:uuid,operationId:uuid,requestDigest:digest,preparedAt:time,fileCount:z.number().int().min(1).max(1_000),
  totalBytes:z.number().int().min(0).max(RECOVERY_MAX_OPERATION_BYTES)}).strict();
const terminalInputSchema = z.object({operationId:uuid,requestDigest:digest,
  outcome:z.enum(["completed","restored","quarantined"]),evidenceDigest:digest}).strict();
const terminalSchema = terminalInputSchema.extend({schemaVersion:z.literal("agent-builder-recovery-terminal/v1"),
  storeId:uuid,recordedAt:time}).strict();
const recordSchema = z.object({request:requestSchema,prepared:preparedSchema,effectsPossibleAt:time.nullable(),
  terminal:terminalSchema.nullable()}).strict();
export type RecoveryIdentity = Readonly<z.infer<typeof identitySchema>>;
export type RecoveryPrepared = Readonly<z.infer<typeof preparedSchema>>;
export type RecoveryRecord = Readonly<z.infer<typeof recordSchema>>;
export interface RecoveryPreimage { readonly relativePath:string; readonly bytes:Uint8Array; }
export type RecoveryStoreReason = "request-invalid"|"schema-invalid"|"store-identity-mismatch"|"state-invalid"
  |"durability-invalid"|"transaction-active"|"storage-unavailable"|"operation-missing"|"request-conflict"
  |"authorization-reused"|"workspace-unfinished"|"limit-exceeded"|"transition-denied"|"clock-invalid";
export class RecoveryStoreError extends Error {
  constructor(public readonly reason:RecoveryStoreReason){super(`builder-recovery-${reason}`);this.name="RecoveryStoreError";}
}
const fail=(reason:RecoveryStoreReason):never=>{throw new RecoveryStoreError(reason);};
function guard<T>(fn:()=>T):T {try{return fn();}catch(e){if(e instanceof RecoveryStoreError)throw e;return fail("storage-unavailable");}}
function parse<T>(schema:z.ZodType<T>,value:unknown,reason:RecoveryStoreReason):T {
  const result=schema.safeParse(value);if(!result.success)return fail(reason);return result.data;
}
function parsedJson<T>(schema:z.ZodType<T>,value:unknown):T {
  try {
    if(typeof value!=="string"||Buffer.byteLength(value)>MAX_JSON)return fail("state-invalid");
    const parsed=parse(schema,JSON.parse(value),"state-invalid");
    if(canonicalJson(parsed)!==value)return fail("state-invalid");return parsed;
  }catch{return fail("state-invalid");}
}
const META_SQL=`CREATE TABLE builder_recovery_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL CHECK (version = 1),
  store_id TEXT NOT NULL
)`;
const OPS_SQL=`CREATE TABLE builder_recovery_operations (
  operation_id TEXT PRIMARY KEY NOT NULL, authorization_digest TEXT UNIQUE NOT NULL,
  workspace_digest TEXT NOT NULL, finished INTEGER NOT NULL CHECK (finished IN (0,1)),
  record_json TEXT NOT NULL CHECK (length(CAST(record_json AS BLOB)) BETWEEN 2 AND 700000),
  record_digest TEXT NOT NULL
)`;
const FILES_SQL=`CREATE TABLE builder_recovery_preimages (
  operation_id TEXT NOT NULL REFERENCES builder_recovery_operations(operation_id),
  relative_path TEXT NOT NULL CHECK (typeof(relative_path) = 'text' AND length(relative_path) BETWEEN 1 AND 512),
  content BLOB NOT NULL CHECK (typeof(content) = 'blob' AND length(content) <= 16777216),
  PRIMARY KEY (operation_id, relative_path)
)`;
const LOCK_SQL=`CREATE UNIQUE INDEX builder_recovery_workspace_lock
  ON builder_recovery_operations(workspace_digest) WHERE finished = 0`;
const EXPECTED=[{name:"builder_recovery_meta",sql:META_SQL},{name:"builder_recovery_operations",sql:OPS_SQL},
  {name:"builder_recovery_preimages",sql:FILES_SQL},{name:"builder_recovery_workspace_lock",sql:LOCK_SQL}];
function schemaRows(db:Database.Database):{name:string;sql:string}[]{
  return db.prepare("SELECT name,sql FROM main.sqlite_schema WHERE sql IS NOT NULL ORDER BY name").all() as {name:string;sql:string}[];
}
function assertSchema(db:Database.Database):void {
  if(canonicalJson(schemaRows(db))!==canonicalJson(EXPECTED)
    ||db.prepare("SELECT 1 FROM temp.sqlite_schema LIMIT 1").get()!==undefined
    ||(db.pragma("database_list") as {name:string}[]).some(x=>!["main","temp"].includes(x.name)))fail("schema-invalid");
}
function assertDurability(db:Database.Database):void {
  if(db.pragma("journal_mode",{simple:true})!==(db.name===":memory:"?"memory":"wal")
    ||db.pragma("synchronous",{simple:true})!==2||db.pragma("foreign_keys",{simple:true})!==1
    ||db.pragma("trusted_schema",{simple:true})!==0||db.pragma("busy_timeout",{simple:true})!==250
    ||db.pragma("ignore_check_constraints",{simple:true})!==0)fail("durability-invalid");
}
function configure(db:Database.Database):void {
  if(db.inTransaction)fail("transaction-active");
  db.pragma("journal_mode=WAL");db.pragma("synchronous=FULL");db.pragma("foreign_keys=ON");
  db.pragma("trusted_schema=OFF");db.pragma("busy_timeout=250");assertDurability(db);
}
/** Explicit disposable/first-install initialization only; NEVER invoked on open.
 * A production host must persist the returned identity separately and protect
 * the app-owned DB, directory, WAL and SHM from task access. Not implemented here.
 */
export function initializeWindowsBuilderRecoveryStore(db:Database.Database):string {
  return guard(()=>{
    if(schemaRows(db).length!==0)fail("schema-invalid");configure(db);
    const id=randomUUID();
    db.transaction(()=>{
      if(schemaRows(db).length!==0)fail("schema-invalid");
      for(const object of EXPECTED)db.exec(object.sql);
      db.prepare("INSERT INTO builder_recovery_meta VALUES (1,1,?)").run(id);assertSchema(db);
    }).immediate();
    return id;
  });
}
type Row={operation_id:string;authorization_digest:string;workspace_digest:string;finished:number;record_json:string;record_digest:string};

export class SqliteWindowsBuilderRecoveryStore {
  constructor(private readonly db:Database.Database,private readonly expectedStoreId:string,
    private readonly now:()=>string=()=>new Date().toISOString()){
    guard(()=>{parse(uuid,expectedStoreId,"request-invalid");assertSchema(db);configure(db);this.preflight();});
  }
  private preflight():void {
    if(this.db.inTransaction)fail("transaction-active");assertSchema(this.db);assertDurability(this.db);
    const meta=this.db.prepare("SELECT singleton,version,store_id FROM builder_recovery_meta").all() as {singleton:number;version:number;store_id:string}[];
    if(meta.length!==1||meta[0]?.singleton!==1||meta[0]?.version!==1)fail("state-invalid");
    if(meta[0]?.store_id!==this.expectedStoreId)fail("store-identity-mismatch");
  }
  private clock(previous?:string):string {
    const current=parse(time,this.now(),"clock-invalid");if(previous!==undefined&&current<previous)fail("clock-invalid");return current;
  }
  private transaction<T>(fn:()=>T,write=false):T {
    return guard(()=>{this.preflight();const tx=this.db.transaction(fn);return write?tx.immediate():tx.deferred();});
  }
  private row(id:string):RecoveryRecord|undefined {
    // SQL-side caps precede driver materialization, including after a damaged
    // database has bypassed its CHECK constraints. Truncation never validates:
    // the extra character guarantees an oversized digest/path differs or fails.
    const row=this.db.prepare(`SELECT operation_id,substr(authorization_digest,1,72) AS authorization_digest,
      substr(workspace_digest,1,72) AS workspace_digest,finished,
      CASE WHEN typeof(record_json)='text' AND length(CAST(record_json AS BLOB))<=700000 THEN record_json ELSE NULL END AS record_json,
      substr(record_digest,1,72) AS record_digest FROM builder_recovery_operations WHERE operation_id=?`).get(id) as Row|undefined;
    if(row===undefined)return undefined;
    const r=parsedJson(recordSchema,row.record_json), p=r.prepared;
    if(canonicalSha256Digest(r)!==row.record_digest||p.storeId!==this.expectedStoreId||p.operationId!==row.operation_id
      ||r.request.identity.operationId!==row.operation_id||r.request.identity.authorizationDigest!==row.authorization_digest
      ||r.request.identity.workspaceDigest!==row.workspace_digest||p.requestDigest!==canonicalSha256Digest(r.request)
      ||p.fileCount!==r.request.files.length||p.totalBytes!==r.request.files.reduce((n,f)=>n+f.byteLength,0)
      ||(r.effectsPossibleAt!==null&&r.effectsPossibleAt<p.preparedAt)
      ||row.finished!==((r.terminal!==null&&r.terminal.outcome!=="quarantined")?1:0))fail("state-invalid");
    if(r.terminal!==null&&(r.effectsPossibleAt===null||r.terminal.storeId!==p.storeId||r.terminal.operationId!==p.operationId
      ||r.terminal.requestDigest!==p.requestDigest||r.terminal.recordedAt<r.effectsPossibleAt))fail("state-invalid");
    return deepFreeze(r);
  }
  private required(id:string,requestDigest?:string):RecoveryRecord {
    const r=this.row(id);if(r===undefined)return fail("operation-missing");
    if(requestDigest!==undefined&&r.prepared.requestDigest!==requestDigest)fail("request-conflict");return r;
  }
  private blobs(r:RecoveryRecord):RecoveryPreimage[] {
    // Inspect SQL lengths/counts first; don't materialize unbounded corrupt BLOBs.
    const sizes=this.db.prepare("SELECT substr(relative_path,1,513) AS relative_path,length(content) AS bytes,typeof(content) AS kind FROM builder_recovery_preimages WHERE operation_id=? ORDER BY relative_path LIMIT 1001")
      .all(r.prepared.operationId) as {relative_path:string;bytes:number;kind:string}[];
    if(sizes.length!==r.request.files.length||sizes.some((s,i)=>s.relative_path!==r.request.files[i]!.relativePath
      ||s.kind!=="blob"||s.bytes!==r.request.files[i]!.byteLength))fail("state-invalid");
    return r.request.files.map(f=>{
      const row=this.db.prepare("SELECT content FROM builder_recovery_preimages WHERE operation_id=? AND relative_path=?")
        .get(r.prepared.operationId,f.relativePath) as {content:Buffer};
      if(!Buffer.isBuffer(row.content)||sha256BuilderDigest(row.content)!==f.contentDigest)fail("state-invalid");
      return {relativePath:f.relativePath,bytes:new Uint8Array(row.content)};
    });
  }
  /** Idempotent data preparation, NOT admission. Exact request reuse preserves
   * timestamps and state; a caller must not infer permission to execute from it.
   */
  prepare(identityInput:unknown,preimages:readonly RecoveryPreimage[]):RecoveryPrepared {
    return guard(()=>{
      const identity=parse(identitySchema,identityInput,"request-invalid");
      if(!Array.isArray(preimages)||preimages.length<1||preimages.length>1_000)fail("request-invalid");
      let total=0;
      const files=preimages.map(f=>{
        if(!f||typeof f.relativePath!=="string"||!isSafeBuilderRelativePath(f.relativePath)||!(f.bytes instanceof Uint8Array))return fail("request-invalid");
        if(f.bytes.byteLength>RECOVERY_MAX_FILE_BYTES||(total+=f.bytes.byteLength)>RECOVERY_MAX_OPERATION_BYTES)fail("limit-exceeded");
        const bytes=Buffer.from(f.bytes);
        try{if(containsSecretLikeContent(decodeBuilderText(bytes)))return fail("request-invalid");}catch{return fail("request-invalid");}
        return {relativePath:f.relativePath,bytes};
      });
      const request=parse(requestSchema,{identity,files:files.map(f=>({relativePath:f.relativePath,byteLength:f.bytes.length,contentDigest:sha256BuilderDigest(f.bytes)}))},"request-invalid");
      if(Buffer.byteLength(canonicalJson(request))>MAX_JSON-4096)fail("limit-exceeded");
      const requestDigest=canonicalSha256Digest(request);
      const saved=this.transaction(()=>{
        const existing=this.row(identity.operationId);
        if(existing!==undefined){if(existing.prepared.requestDigest!==requestDigest)fail("request-conflict");this.blobs(existing);return existing.prepared;}
        if(this.db.prepare("SELECT 1 FROM builder_recovery_operations WHERE authorization_digest=?").get(identity.authorizationDigest))fail("authorization-reused");
        if(this.db.prepare("SELECT 1 FROM builder_recovery_operations WHERE workspace_digest=? AND finished=0").get(identity.workspaceDigest))fail("workspace-unfinished");
        const count=(this.db.prepare("SELECT count(*) AS n FROM builder_recovery_operations").get() as {n:number}).n;
        const stored=(this.db.prepare("SELECT coalesce(sum(length(content)),0) AS n FROM builder_recovery_preimages").get() as {n:number}).n;
        if(count>=RECOVERY_MAX_OPERATIONS||stored+total>RECOVERY_MAX_STORE_BYTES)fail("limit-exceeded");
        const prepared:RecoveryPrepared={schemaVersion:"agent-builder-recovery-prepared/v1",storeId:this.expectedStoreId,
          operationId:identity.operationId,requestDigest,preparedAt:this.clock(),fileCount:files.length,totalBytes:total};
        const record:RecoveryRecord={request,prepared,effectsPossibleAt:null,terminal:null};
        this.db.prepare("INSERT INTO builder_recovery_operations VALUES (?,?,?,0,?,?)")
          .run(identity.operationId,identity.authorizationDigest,identity.workspaceDigest,canonicalJson(record),canonicalSha256Digest(record));
        const insert=this.db.prepare("INSERT INTO builder_recovery_preimages VALUES (?,?,?)");
        for(const f of files)insert.run(identity.operationId,f.relativePath,f.bytes);
        this.blobs(this.required(identity.operationId));return prepared;
      },true);
      // Commit happened before returned data. A lost response is read/reconcile,
      // not evidence that the operation did not persist.
      return this.transaction(()=>{const r=this.required(identity.operationId,requestDigest);this.blobs(r);
        if(canonicalJson(r.prepared)!==canonicalJson(saved))fail("state-invalid");return r.prepared;});
    });
  }
  read(operationId:string):RecoveryRecord {
    parse(uuid,operationId,"request-invalid");return this.transaction(()=>this.required(operationId));
  }
  /** Validate the pinned store even when no operation exists yet. */
  readStoreId():string {return this.transaction(()=>this.expectedStoreId);}
  readPreimages(operationId:string):readonly RecoveryPreimage[] {
    parse(uuid,operationId,"request-invalid");return this.transaction(()=>this.blobs(this.required(operationId)));
  }
  /** Bounded discovery, including terminal rows. An operation absent from
   * listUnfinished can still have an unsettled blocker in the policy store.
   * IDs alone do not validate records or authorize recovery; read each record. */
  listOperationIds():readonly string[] {
    return this.transaction(()=>{
      const rows=this.db.prepare("SELECT substr(operation_id,1,37) AS operation_id FROM builder_recovery_operations ORDER BY operation_id LIMIT 1001")
        .all() as {operation_id:unknown}[];
      if(rows.length>RECOVERY_MAX_OPERATIONS)fail("state-invalid");
      const ids=rows.map(row=>parse(uuid,row.operation_id,"state-invalid"));
      if(ids.some((id,i)=>i>0&&ids[i-1]!>=id))fail("state-invalid");
      return Object.freeze(ids);
    });
  }
  listUnfinished():readonly RecoveryRecord[] {
    return this.transaction(()=>{
      const ids=this.db.prepare("SELECT operation_id FROM builder_recovery_operations WHERE finished=0 ORDER BY operation_id LIMIT 1001").all() as {operation_id:string}[];
      if(ids.length>RECOVERY_MAX_OPERATIONS)fail("state-invalid");return Object.freeze(ids.map(x=>this.required(x.operation_id)));
    });
  }
  /** One-shot marker only. Duplicate attempts DENY, including response loss.
   * Every caller must still satisfy the separate approval/policy/physical gate.
   */
  markEffectsPossible(operationId:string,requestDigest:string):RecoveryRecord {
    parse(uuid,operationId,"request-invalid");parse(digest,requestDigest,"request-invalid");
    this.transaction(()=>{
      const r=this.required(operationId,requestDigest);if(r.effectsPossibleAt!==null||r.terminal!==null)fail("transition-denied");
      this.blobs(r);this.save({...r,effectsPossibleAt:this.clock(r.prepared.preparedAt)});
    },true);
    return this.read(operationId);
  }
  /** Records the trusted host's evidence claim; does not perform verification or
   * authorize recovery. Quarantined operations remain workspace blockers forever
   * in this version. No delete/prune/reapproval or quarantine-clear API exists.
   */
  recordTerminal(input:unknown):RecoveryRecord {
    const request=parse(terminalInputSchema,input,"request-invalid");
    this.transaction(()=>{
      const r=this.required(request.operationId,request.requestDigest);
      if(r.effectsPossibleAt===null)return fail("transition-denied");
      if(r.terminal!==null){
        if(r.terminal.outcome!==request.outcome||r.terminal.evidenceDigest!==request.evidenceDigest)fail("request-conflict");return;
      }
      this.blobs(r);
      const terminal={...request,schemaVersion:"agent-builder-recovery-terminal/v1" as const,
        storeId:this.expectedStoreId,recordedAt:this.clock(r.effectsPossibleAt)};
      this.save({...r,terminal});
    },true);
    return this.read(request.operationId);
  }
  private save(record:RecoveryRecord):void {
    const finished=record.terminal!==null&&record.terminal.outcome!=="quarantined"?1:0;
    const result=this.db.prepare("UPDATE builder_recovery_operations SET finished=?,record_json=?,record_digest=? WHERE operation_id=?")
      .run(finished,canonicalJson(record),canonicalSha256Digest(record),record.prepared.operationId);
    if(result.changes!==1)fail("state-invalid");
  }
}
