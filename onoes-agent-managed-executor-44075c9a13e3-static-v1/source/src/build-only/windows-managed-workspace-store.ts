import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";

// Trusted service bookkeeping, NOT import authorization, physical custody, or a
// mutable-workspace health assertion. Never open an absent DB by initializing it.
// The installer must protect and separately pin this DB/identity and native root
// identities. Missing/rolled-back whole installation state is not solved here.
export const MANAGED_WORKSPACE_STORE_LIMITS = Object.freeze({ workspaces: 32, bytes: 67_108_864, recordBytes: 4096 });
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const time = z.string().refine(v => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v);
const requestSchema = z.object({ requestId: uuid, workspaceDigest: digest, rootIdentityDigest: digest,
  manifestDigest: digest, workerDigest: digest, fileCount: z.number().int().min(1).max(64),
  totalBytes: z.number().int().min(0).max(4_194_304) }).strict();
const recordSchema = z.object({ schemaVersion: z.literal("agent-managed-workspace-record/v1"),
  kind: z.literal("import-history-not-authorization"), storeId: uuid, request: requestSchema,
  requestDigest: digest, preparedAt: time, importingAt: time.nullable(),
  terminal: z.object({ state: z.enum(["ready", "quarantined"]), recordedAt: time,
    evidenceDigest: digest }).strict().nullable() }).strict();
export type ManagedWorkspaceRequest = Readonly<z.infer<typeof requestSchema>>;
export type ManagedWorkspaceRecord = Readonly<z.infer<typeof recordSchema>>;
export type ManagedWorkspaceStoreReason = "request-invalid" | "schema-invalid" | "state-invalid"
  | "store-identity-mismatch" | "durability-invalid" | "transaction-active" | "storage-unavailable"
  | "request-conflict" | "workspace-reused" | "root-reused" | "limit-exceeded" | "missing"
  | "transition-denied" | "clock-invalid";
export class ManagedWorkspaceStoreError extends Error {
  constructor(public readonly reason: ManagedWorkspaceStoreReason) {
    super(`managed-workspace-store-${reason}`); this.name = "ManagedWorkspaceStoreError";
  }
}
const fail = (r: ManagedWorkspaceStoreReason): never => { throw new ManagedWorkspaceStoreError(r); };
function guard<T>(f: () => T): T {
  try { return f(); } catch (e) { if (e instanceof ManagedWorkspaceStoreError) throw e; return fail("storage-unavailable"); }
}
function parse<T>(schema: z.ZodType<T>, value: unknown, reason: ManagedWorkspaceStoreReason): T {
  const p = schema.safeParse(value); if (!p.success) return fail(reason); return p.data;
}
const META = `CREATE TABLE managed_workspace_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL CHECK (version = 1), store_id TEXT NOT NULL
)`;
const RECORDS = `CREATE TABLE managed_workspace_records (
  request_id TEXT PRIMARY KEY NOT NULL, workspace_digest TEXT UNIQUE NOT NULL, root_identity_digest TEXT UNIQUE NOT NULL,
  record_json TEXT NOT NULL CHECK (typeof(record_json) = 'text' AND length(CAST(record_json AS BLOB)) BETWEEN 2 AND 4096),
  record_digest TEXT NOT NULL
)`;
const expected = [{ name: "managed_workspace_meta", sql: META }, { name: "managed_workspace_records", sql: RECORDS }];
function objects(db: Database.Database) {
  return db.prepare("SELECT name,sql FROM main.sqlite_schema WHERE sql IS NOT NULL ORDER BY name LIMIT 3").all();
}
function schema(db: Database.Database): void {
  if (canonicalJson(objects(db)) !== canonicalJson(expected)
    || db.prepare("SELECT 1 FROM temp.sqlite_schema LIMIT 1").get() !== undefined
    || (db.pragma("database_list") as {name: string}[]).some(d => !["main", "temp"].includes(d.name))) fail("schema-invalid");
}
function durability(db: Database.Database): void {
  if (db.pragma("journal_mode", {simple: true}) !== (db.name === ":memory:" ? "memory" : "wal")
    || db.pragma("synchronous", {simple: true}) !== 2 || db.pragma("trusted_schema", {simple: true}) !== 0
    || db.pragma("busy_timeout", {simple: true}) !== 250
    || db.pragma("ignore_check_constraints", {simple: true}) !== 0) fail("durability-invalid");
}
function configure(db: Database.Database): void {
  if (db.inTransaction) fail("transaction-active");
  db.pragma("journal_mode=WAL"); db.pragma("synchronous=FULL"); db.pragma("trusted_schema=OFF");
  db.pragma("busy_timeout=250"); durability(db);
}
/** Explicit first-install/disposable setup; no filesystem/service creation.
 * Not compatible with another component's DB; no migration or second approval
 * consumption table is introduced. There are no approval identifiers here. */
export function initializeWindowsManagedWorkspaceStore(db: Database.Database): string {
  return guard(() => {
    if (objects(db).length !== 0) fail("schema-invalid"); configure(db); const id = randomUUID();
    db.transaction(() => {
      if (objects(db).length !== 0) fail("schema-invalid");
      db.exec(META); db.exec(RECORDS); db.prepare("INSERT INTO managed_workspace_meta VALUES (1,1,?)").run(id); schema(db);
    }).immediate();
    return id;
  });
}

export class SqliteWindowsManagedWorkspaceStore {
  readonly #liveStarts = new Map<string, string>();
  constructor(private readonly db: Database.Database, private readonly expectedStoreId: string,
    private readonly now: () => string = () => new Date().toISOString()) {
    guard(() => { parse(uuid, expectedStoreId, "request-invalid"); schema(db); configure(db); this.preflight(); this.scan(); });
  }
  private preflight(): void {
    if (this.db.inTransaction) fail("transaction-active"); schema(this.db); durability(this.db);
    const rows = this.db.prepare("SELECT singleton,version,substr(store_id,1,37) AS store_id FROM managed_workspace_meta LIMIT 2").all() as
      {singleton: number; version: number; store_id: string}[];
    if (rows.length !== 1 || rows[0]?.singleton !== 1 || rows[0]?.version !== 1) fail("state-invalid");
    if (rows[0]?.store_id !== this.expectedStoreId) fail("store-identity-mismatch");
  }
  private clock(prior: string): string {
    const current = parse(time, this.now(), "clock-invalid"); if (current < prior) fail("clock-invalid"); return current;
  }
  private tx<T>(f: () => T, write = false): T {
    return guard(() => { this.preflight(); const tx = this.db.transaction(f); return write ? tx.immediate() : tx.deferred(); });
  }
  private scan(): ManagedWorkspaceRecord[] {
    // SQL caps precede materialization even if corruption bypassed CHECKs. A
    // bounded full scan (max 32 small records) revalidates lifetime quotas too.
    const rows = this.db.prepare(`SELECT substr(request_id,1,37) AS id,substr(workspace_digest,1,72) AS workspace,
      substr(root_identity_digest,1,72) AS root,substr(record_digest,1,72) AS hash,
      CASE WHEN typeof(record_json)='text' AND length(CAST(record_json AS BLOB))<=4096 THEN record_json ELSE NULL END AS text
      FROM managed_workspace_records ORDER BY request_id LIMIT 33`).all() as
      {id: string; workspace: string; root: string; hash: string; text: unknown}[];
    if (rows.length > MANAGED_WORKSPACE_STORE_LIMITS.workspaces) fail("state-invalid");
    let total = 0;
    const records = rows.map(row => {
      if (typeof row.text !== "string") return fail("state-invalid");
      let r: ManagedWorkspaceRecord;
      try { r = parse(recordSchema, JSON.parse(row.text), "state-invalid"); } catch { return fail("state-invalid"); }
      if (canonicalJson(r) !== row.text || canonicalSha256Digest(r) !== row.hash || r.storeId !== this.expectedStoreId
        || r.request.requestId !== row.id || r.request.workspaceDigest !== row.workspace || r.request.rootIdentityDigest !== row.root
        || r.requestDigest !== canonicalSha256Digest(r.request) || (r.importingAt !== null && r.importingAt < r.preparedAt)
        || (r.terminal !== null && (r.terminal.recordedAt < (r.importingAt ?? r.preparedAt)
          || (r.terminal.state === "ready" && r.importingAt === null)))) return fail("state-invalid");
      total += r.request.totalBytes; return deepFreeze(r);
    });
    if (total > MANAGED_WORKSPACE_STORE_LIMITS.bytes
      || new Set(records.map(r => r.request.workspaceDigest)).size !== records.length
      || new Set(records.map(r => r.request.rootIdentityDigest)).size !== records.length) fail("state-invalid");
    return records;
  }
  private required(id: string, expectedDigest?: string): ManagedWorkspaceRecord {
    const r = this.scan().find(r => r.request.requestId === id); if (!r) return fail("missing");
    if (expectedDigest !== undefined && r.requestDigest !== expectedDigest) fail("request-conflict"); return r;
  }
  private save(r: ManagedWorkspaceRecord): void {
    const text = canonicalJson(r); if (Buffer.byteLength(text) > 4096) fail("limit-exceeded");
    const result = this.db.prepare("UPDATE managed_workspace_records SET record_json=?,record_digest=? WHERE request_id=?")
      .run(text, canonicalSha256Digest(r), r.request.requestId);
    if (result.changes !== 1) fail("state-invalid");
  }
  /** Record selected NEW root + immutable import identity, not permission. An
   * identical retry returns recorded state; only beginImport may claim a start. */
  reserve(input: unknown): ManagedWorkspaceRecord {
    const request = parse(requestSchema, input, "request-invalid"), hash = canonicalSha256Digest(request);
    this.tx(() => {
      const all = this.scan(), old = all.find(r => r.request.requestId === request.requestId);
      if (old) { if (old.requestDigest !== hash) fail("request-conflict"); return; }
      if (all.some(r => r.request.workspaceDigest === request.workspaceDigest)) fail("workspace-reused");
      if (all.some(r => r.request.rootIdentityDigest === request.rootIdentityDigest)) fail("root-reused");
      if (all.length >= 32 || all.reduce((n,r) => n + r.request.totalBytes, 0) + request.totalBytes > MANAGED_WORKSPACE_STORE_LIMITS.bytes) fail("limit-exceeded");
      const record: ManagedWorkspaceRecord = {schemaVersion: "agent-managed-workspace-record/v1", kind: "import-history-not-authorization",
        storeId: this.expectedStoreId, request, requestDigest: hash, preparedAt: this.clock(""), importingAt: null, terminal: null};
      this.db.prepare("INSERT INTO managed_workspace_records VALUES (?,?,?,?,?)")
        .run(request.requestId, request.workspaceDigest, request.rootIdentityDigest, canonicalJson(record), canonicalSha256Digest(record));
      this.required(request.requestId, hash);
    }, true);
    return this.read(request.requestId); // COMMIT, then independent read-back.
  }
  beginImport(id: string, requestDigest: string): ManagedWorkspaceRecord {
    this.key(id, requestDigest);
    this.tx(() => { const r = this.required(id, requestDigest);
      if (r.importingAt !== null || r.terminal !== null) fail("transition-denied");
      this.save({...r, importingAt: this.clock(r.preparedAt)});
    }, true);
    const record = this.read(id);
    this.#liveStarts.set(id, requestDigest); // Never recreated from stored rows.
    return record; // A lost response NEVER permits a repeated start.
  }
  /** Trusted host reports native success only after the actual worker exits.
   * On restart an unfinished record may ONLY be quarantined, never inferred
   * ready from files/seals. This API supplies no proof of worker quiescence. */
  recordTerminal(id: string, requestDigest: string, state: "ready" | "quarantined", evidenceDigest: string): ManagedWorkspaceRecord {
    this.key(id, requestDigest); parse(digest, evidenceDigest, "request-invalid");
    if (state !== "ready" && state !== "quarantined") fail("request-invalid");
    this.tx(() => {
      const r = this.required(id, requestDigest);
      if (r.terminal !== null) {
        if (r.terminal.state !== state || r.terminal.evidenceDigest !== evidenceDigest) fail("request-conflict"); return;
      }
      if (state === "ready" && (r.importingAt === null || this.#liveStarts.get(id) !== requestDigest)) fail("transition-denied");
      // Consume the live attempt BEFORE persistence. Failure is reconcile-only,
      // not a repeat completion based on files/seal or an assumed failed COMMIT.
      this.#liveStarts.delete(id);
      this.save({...r, terminal: {state, evidenceDigest, recordedAt: this.clock(r.importingAt ?? r.preparedAt)}});
    }, true);
    return this.read(id);
  }
  read(id: string): ManagedWorkspaceRecord { parse(uuid,id,"request-invalid"); return this.tx(() => this.required(id)); }
  list(): readonly ManagedWorkspaceRecord[] { return this.tx(() => deepFreeze(this.scan())); }
  private key(id: string, requestDigest: string): void { parse(uuid,id,"request-invalid"); parse(digest,requestDigest,"request-invalid"); }
}
