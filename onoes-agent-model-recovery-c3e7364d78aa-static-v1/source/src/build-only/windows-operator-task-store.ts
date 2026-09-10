import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { createWindowsOperatorTaskIntake, parseWindowsOperatorTaskIntakeRequest, OPERATOR_TASK_INTAKE_MAX_BYTES } from "./windows-operator-task-intake.js";
import { isManagedEditCandidate, type ManagedEditCandidate } from "./windows-managed-planning-context.js";
import type { ManagedTaskInspectionOptions } from "./windows-managed-task-inspection.js";

// Separate operator draft history, NOT the approval or effect/recovery ledger.
// No saved object can reconstitute an inspection/candidate brand after restart.
export const OPERATOR_TASK_STORE_LIMITS = Object.freeze({ tasks: 32, eventsPerTask: 64, eventBytes: 4096 });
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const epoch = z.number().int().min(1).max(1_000_000_000);
const time = z.string().refine(v => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v);
const candidateSchema = z.object({ candidateDigest: digest, contextDigest: digest, inspectionDigest: digest,
  workspaceDigest: digest, policyBinding: z.object({ storeId: uuid, revision: z.number().int().min(1).max(10001), policyDigest: digest }).strict(),
  changedFileCount: z.number().int().min(1).max(128), sourceBytes: z.number().int().min(0).max(1_048_576),
  postimageBytes: z.number().int().min(0).max(1_048_576) }).strict();
const eventSchema = z.object({ schemaVersion: z.literal("agent-operator-task-event/v1"),
  kind: z.literal("draft-history-not-approval"), storeId: uuid, taskId: uuid, requestId: uuid,
  requestDigest: digest, intakeDigest: digest, creationEpoch: epoch, revision: z.number().int().min(1).max(64),
  operation: z.enum(["create", "record-candidate", "close"]), recordedAt: time,
  candidate: candidateSchema.nullable() }).strict();
export type OperatorTaskEvent = Readonly<z.infer<typeof eventSchema>>;
type Reason = "request-invalid" | "schema-invalid" | "state-invalid" | "store-identity-mismatch" | "durability-invalid"
  | "transaction-active" | "storage-unavailable" | "request-conflict" | "missing" | "revision-conflict"
  | "task-closed" | "task-limit" | "revision-limit" | "clock-invalid" | "candidate-untrusted" | "binding-mismatch"
  | "policy-denied" | "forget-denied" | "creation-epoch-stale" | "task-epoch-mismatch" | "epoch-limit";
export class OperatorTaskStoreError extends Error {
  constructor(readonly reason: Reason) { super(`operator-task-store-${reason}`); this.name = "OperatorTaskStoreError"; }
}
const fail = (r: Reason): never => { throw new OperatorTaskStoreError(r); };
function guard<T>(fn: () => T): T { try { return fn(); } catch (e) { if (e instanceof OperatorTaskStoreError) throw e; return fail("storage-unavailable"); } }
function parse<T>(schema: z.ZodType<T>, input: unknown, reason: Reason): T { const out = schema.safeParse(input); if (!out.success) return fail(reason); return out.data; }
const META = "CREATE TABLE operator_task_meta (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL CHECK(version=1), store_id TEXT NOT NULL, creation_epoch INTEGER NOT NULL CHECK(creation_epoch BETWEEN 1 AND 1000000000))";
const TASKS = `CREATE TABLE operator_tasks (task_id TEXT PRIMARY KEY NOT NULL, brief_digest TEXT NOT NULL,
  intake_digest TEXT NOT NULL, creation_epoch INTEGER NOT NULL CHECK(creation_epoch BETWEEN 1 AND 1000000000),
  brief_json TEXT NOT NULL CHECK(typeof(brief_json)='text' AND length(CAST(brief_json AS BLOB)) BETWEEN 2 AND 196608))`;
const EVENTS = `CREATE TABLE operator_task_events (task_id TEXT NOT NULL, revision INTEGER NOT NULL,
  request_id TEXT UNIQUE NOT NULL, event_digest TEXT NOT NULL,
  event_json TEXT NOT NULL CHECK(typeof(event_json)='text' AND length(CAST(event_json AS BLOB)) BETWEEN 2 AND 4096), PRIMARY KEY(task_id,revision))`;
const expected = [{ name: "operator_task_events", sql: EVENTS }, { name: "operator_task_meta", sql: META }, { name: "operator_tasks", sql: TASKS }];
const objects = (db: Database.Database) => db.prepare("SELECT name,sql FROM main.sqlite_schema WHERE sql IS NOT NULL ORDER BY name LIMIT 4").all();
function namespace(db: Database.Database) {
  if (db.prepare("SELECT 1 FROM temp.sqlite_schema LIMIT 1").get() !== undefined
    || (db.pragma("database_list") as { name: string }[]).some(d => !["main", "temp"].includes(d.name))) fail("schema-invalid");
}
function schema(db: Database.Database) { namespace(db); if (canonicalJson(objects(db)) !== canonicalJson(expected)) fail("schema-invalid"); }
function durability(db: Database.Database) {
  if (db.pragma("journal_mode", { simple: true }) !== (db.name === ":memory:" ? "memory" : "wal")
    || db.pragma("synchronous", { simple: true }) !== 2 || db.pragma("trusted_schema", { simple: true }) !== 0
    || db.pragma("busy_timeout", { simple: true }) !== 250 || db.pragma("ignore_check_constraints", { simple: true }) !== 0) fail("durability-invalid");
}
function configure(db: Database.Database) {
  if (db.inTransaction) fail("transaction-active");
  db.pragma("journal_mode=WAL"); db.pragma("synchronous=FULL"); db.pragma("trusted_schema=OFF"); db.pragma("busy_timeout=250"); durability(db);
}
export function initializeWindowsOperatorTaskStore(db: Database.Database): string {
  return guard(() => {
    namespace(db); if (objects(db).length) fail("schema-invalid"); configure(db); const id = randomUUID();
    db.transaction(() => {
      if (objects(db).length) fail("schema-invalid"); db.exec(META); db.exec(TASKS); db.exec(EVENTS);
      db.prepare("INSERT INTO operator_task_meta VALUES (1,1,?,1)").run(id); schema(db);
    }).immediate(); return id;
  });
}
type StoredTask = { taskId: string; briefDigest: string; intakeDigest: string; creationEpoch: number; brief: ReturnType<typeof parseWindowsOperatorTaskIntakeRequest> };
function requestDigest(operation: OperatorTaskEvent["operation"], requestId: string, task: Pick<StoredTask, "taskId" | "briefDigest" | "creationEpoch">,
  expectedRevision: number, candidate: OperatorTaskEvent["candidate"]) {
  return canonicalSha256Digest({ domain: "agent-operator-task-operation/v1", operation, requestId, taskId: task.taskId,
    briefDigest: task.briefDigest, creationEpoch: task.creationEpoch, expectedRevision, candidate });
}
function text(bytes: unknown, cap: number): string {
  if (!Buffer.isBuffer(bytes) || bytes.length > cap) return fail("state-invalid");
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return fail("state-invalid"); }
}
export class SqliteWindowsOperatorTaskStore {
  constructor(private readonly db: Database.Database, private readonly expectedStoreId: string,
    private readonly policy: ManagedTaskInspectionOptions["policy"], private readonly now: () => string = () => new Date().toISOString()) {
    guard(() => { parse(uuid, expectedStoreId, "request-invalid"); schema(db); configure(db); this.readState(); });
  }
  private validate() {
    schema(this.db); durability(this.db);
    const rows = this.db.prepare("SELECT singleton,version,substr(store_id,1,37) AS id,creation_epoch AS epoch FROM operator_task_meta LIMIT 2").all() as {singleton:number;version:number;id:string;epoch:number}[];
    if (rows.length !== 1 || rows[0]!.singleton !== 1 || rows[0]!.version !== 1) fail("state-invalid");
    if (rows[0]!.id !== this.expectedStoreId) fail("store-identity-mismatch");
    return parse(epoch, rows[0]!.epoch, "state-invalid");
  }
  private tx<T>(fn: () => T, write = false): T {
    return guard(() => {
      if (this.db.inTransaction) return fail("transaction-active"); this.validate();
      const tx = this.db.transaction(() => { this.validate(); return fn(); }); return write ? tx.immediate() : tx.deferred();
    });
  }
  private scan() {
    const creationEpoch = this.validate();
    const rows = this.db.prepare(`SELECT substr(task_id,1,37) AS id,substr(brief_digest,1,72) AS hash,substr(intake_digest,1,72) AS intake,creation_epoch AS epoch,
      CASE WHEN typeof(brief_json)='text' AND length(CAST(brief_json AS BLOB))<=196608 THEN CAST(brief_json AS BLOB) ELSE NULL END AS bytes
      FROM operator_tasks ORDER BY task_id LIMIT 33`).all() as {id:string;hash:string;intake:string;epoch:number;bytes:unknown}[];
    if (rows.length > OPERATOR_TASK_STORE_LIMITS.tasks) fail("state-invalid");
    const tasks = new Map<string, StoredTask>();
    for (const row of rows) {
      const wire = text(row.bytes, OPERATOR_TASK_INTAKE_MAX_BYTES);
      let brief: StoredTask["brief"];
      try { brief = parseWindowsOperatorTaskIntakeRequest(wire); } catch { return fail("state-invalid"); }
      if (!uuid.safeParse(row.id).success || !digest.safeParse(row.intake).success || row.hash !== canonicalSha256Digest(brief)
        || !epoch.safeParse(row.epoch).success || row.epoch > creationEpoch) fail("state-invalid");
      tasks.set(row.id, { taskId: row.id, briefDigest: row.hash, intakeDigest: row.intake, creationEpoch: row.epoch, brief });
    }
    const eventRows = this.db.prepare(`SELECT substr(task_id,1,37) AS task,revision,substr(request_id,1,37) AS id,substr(event_digest,1,72) AS hash,
      CASE WHEN typeof(event_json)='text' AND length(CAST(event_json AS BLOB))<=4096 THEN CAST(event_json AS BLOB) ELSE NULL END AS bytes
      FROM operator_task_events ORDER BY task_id,revision LIMIT 2049`).all() as {task:string;revision:number;id:string;hash:string;bytes:unknown}[];
    if (eventRows.length > 2048) fail("state-invalid");
    const events: OperatorTaskEvent[] = [], latest = new Map<string, OperatorTaskEvent>();
    for (const row of eventRows) {
      const wire = text(row.bytes, OPERATOR_TASK_STORE_LIMITS.eventBytes); let e: OperatorTaskEvent;
      try { e = parse(eventSchema, JSON.parse(wire), "state-invalid"); } catch { return fail("state-invalid"); }
      const task = tasks.get(e.taskId), prior = latest.get(e.taskId);
      if (!task || e.storeId !== this.expectedStoreId || e.taskId !== row.task || e.revision !== row.revision || e.requestId !== row.id
        || e.intakeDigest !== task.intakeDigest || e.creationEpoch !== task.creationEpoch || canonicalJson(e) !== wire || canonicalSha256Digest(e) !== row.hash
        || e.revision !== (prior?.revision ?? 0) + 1 || (prior && (prior.operation === "close" || e.recordedAt < prior.recordedAt))
        || (e.operation === "create") !== (e.revision === 1) || (e.operation === "create" && e.requestId !== e.taskId)
        || (e.candidate !== null) !== (e.operation === "record-candidate")
        || (e.operation === "record-candidate" && e.revision === 64)
        || (e.candidate && canonicalJson(e.candidate.policyBinding) !== canonicalJson(task.brief.expectedBinding))
        || e.requestDigest !== requestDigest(e.operation, e.requestId, task, e.revision - 1, e.candidate)) fail("state-invalid");
      const frozen = deepFreeze(e); events.push(frozen); latest.set(e.taskId, frozen);
    }
    if (latest.size !== tasks.size) fail("state-invalid");
    return { tasks, events, latest, creationEpoch };
  }
  private readState() { return this.tx(() => this.scan()); }
  private replay(id: string, hash: string) {
    const event = this.readState().events.find(event => event.requestId === id);
    if (event && event.requestDigest !== hash) fail("request-conflict"); return event;
  }
  private append(task: StoredTask, operation: OperatorTaskEvent["operation"], id: string, revision: number, candidate: OperatorTaskEvent["candidate"]) {
    const hash = requestDigest(operation, id, task, revision, candidate), replay = this.replay(id, hash); if (replay) return replay;
    // Clock callback and all policy/candidate work occur outside transactions.
    const now = parse(time, this.now(), "clock-invalid");
    const event = this.tx(() => {
      const state = this.scan(), winner = state.events.find(e => e.requestId === id);
      if (winner) { if (winner.requestDigest !== hash) return fail("request-conflict"); return winner; }
      const stored = state.tasks.get(task.taskId), prior = state.latest.get(task.taskId);
      if (operation === "create") {
        if (task.creationEpoch !== state.creationEpoch) return fail("creation-epoch-stale");
        if (stored) return fail("request-conflict"); if (state.tasks.size >= OPERATOR_TASK_STORE_LIMITS.tasks) return fail("task-limit");
      } else {
        if (!stored) return fail("missing"); if (stored.creationEpoch !== task.creationEpoch) return fail("task-epoch-mismatch");
        if (stored.briefDigest !== task.briefDigest) return fail("binding-mismatch");
        if (prior!.operation === "close") return fail("task-closed");
        if (prior!.revision !== revision) return fail("revision-conflict");
      }
      // Reserve the last slot for closing, so a capped draft can be forgotten.
      if (revision >= 64 || (operation === "record-candidate" && revision >= 63)) return fail("revision-limit");
      if (state.events.some(e => e.recordedAt > now)) return fail("clock-invalid");
      const next = parse(eventSchema, { schemaVersion: "agent-operator-task-event/v1", kind: "draft-history-not-approval",
        storeId: this.expectedStoreId, taskId: task.taskId, requestId: id, requestDigest: hash, intakeDigest: task.intakeDigest,
        creationEpoch: task.creationEpoch, revision: revision + 1, operation, recordedAt: now, candidate }, "request-invalid");
      const wire = canonicalJson(next); if (Buffer.byteLength(wire) > OPERATOR_TASK_STORE_LIMITS.eventBytes) return fail("request-invalid");
      if (operation === "create") this.db.prepare("INSERT INTO operator_tasks VALUES (?,?,?,?,?)").run(task.taskId, task.briefDigest, task.intakeDigest, task.creationEpoch, canonicalJson(task.brief));
      this.db.prepare("INSERT INTO operator_task_events VALUES (?,?,?,?,?)").run(task.taskId, next.revision, id, canonicalSha256Digest(next), wire);
      this.scan(); return deepFreeze(next);
    }, true);
    const readBack = this.replay(id, hash); if (!readBack || canonicalJson(readBack) !== canonicalJson(event)) return fail("state-invalid"); return readBack;
  }

  readCreationEpoch() { return deepFreeze({ storeId: this.expectedStoreId, creationEpoch: this.readState().creationEpoch }); }
  create(requestId: string, expectedCreationEpoch: number, briefWire: unknown): OperatorTaskEvent {
    return guard(() => {
      parse(uuid, requestId, "request-invalid"); let brief: StoredTask["brief"];
      parse(epoch, expectedCreationEpoch, "request-invalid");
      try { brief = parseWindowsOperatorTaskIntakeRequest(briefWire); } catch { return fail("request-invalid"); }
      const raw = { taskId: requestId, briefDigest: canonicalSha256Digest(brief), creationEpoch: expectedCreationEpoch, brief };
      const replay = this.replay(requestId, requestDigest("create", requestId, raw, 0, null)); if (replay) return replay;
      let intake; try { intake = createWindowsOperatorTaskIntake(briefWire, this.policy.snapshot()); this.policy.assertCurrentBinding(brief.expectedBinding); }
      catch { return fail("policy-denied"); }
      return this.append({ ...raw, intakeDigest: intake.draftDigest }, "create", requestId, 0, null);
    });
  }
  recordCandidate(requestId: string, taskId: string, expectedCreationEpoch: number, expectedRevision: number, candidateInput: unknown): OperatorTaskEvent {
    return guard(() => {
      parse(uuid, requestId, "request-invalid"); parse(uuid, taskId, "request-invalid");
      parse(epoch, expectedCreationEpoch, "request-invalid");
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || expectedRevision > 63) return fail("request-invalid");
      if (!isManagedEditCandidate(candidateInput)) return fail("candidate-untrusted");
      const c: ManagedEditCandidate = candidateInput, task = this.readState().tasks.get(taskId); if (!task) return fail("missing");
      if (task.creationEpoch !== expectedCreationEpoch) return fail("task-epoch-mismatch");
      if (c.briefDigest !== task.intakeDigest || canonicalJson(c.policyBinding) !== canonicalJson(task.brief.expectedBinding)) return fail("binding-mismatch");
      const metadata = parse(candidateSchema, { candidateDigest: c.candidateDigest, contextDigest: c.contextDigest, inspectionDigest: c.inspectionDigest,
        workspaceDigest: c.workspace.workspaceDigest, policyBinding: { ...c.policyBinding }, changedFileCount: c.files.length,
        sourceBytes: c.sourceBytes, postimageBytes: c.postimageBytes }, "request-invalid");
      const hash = requestDigest("record-candidate", requestId, task, expectedRevision, metadata), replay = this.replay(requestId, hash); if (replay) return replay;
      try {
        createWindowsOperatorTaskIntake(canonicalJson(task.brief), this.policy.snapshot()); this.policy.assertCurrentBinding(c.policyBinding);
        if (this.policy.listEffectIntents().some(e => e.settlement === null || e.settlement.outcome === "quarantined")) return fail("policy-denied");
      } catch { return fail("policy-denied"); }
      return this.append(task, "record-candidate", requestId, expectedRevision, metadata);
    });
  }
  close(requestId: string, taskId: string, expectedCreationEpoch: number, expectedRevision: number): OperatorTaskEvent {
    return guard(() => {
      parse(uuid, requestId, "request-invalid"); parse(uuid, taskId, "request-invalid");
      parse(epoch, expectedCreationEpoch, "request-invalid");
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || expectedRevision > 63) return fail("request-invalid");
      const task = this.readState().tasks.get(taskId); if (!task) return fail("missing");
      if (task.creationEpoch !== expectedCreationEpoch) return fail("task-epoch-mismatch");
      return this.append(task, "close", requestId, expectedRevision, null);
    });
  }
  readOperation(requestId: string, expectedRequestDigest: string): OperatorTaskEvent {
    parse(uuid, requestId, "request-invalid"); parse(digest, expectedRequestDigest, "request-invalid");
    const result = this.replay(requestId, expectedRequestDigest); if (!result) return fail("missing"); return result;
  }
  read(taskId: string, expectedCreationEpoch: number) {
    parse(uuid, taskId, "request-invalid"); parse(epoch, expectedCreationEpoch, "request-invalid");
    const state = this.readState(), task = state.tasks.get(taskId); if (!task) return fail("missing");
    if (task.creationEpoch !== expectedCreationEpoch) return fail("task-epoch-mismatch");
    const latest = state.latest.get(taskId)!;
    const candidate = [...state.events].reverse().find(e => e.taskId === taskId && e.operation === "record-candidate")?.candidate ?? null;
    return deepFreeze({ schemaVersion: "agent-operator-task-history/v1" as const, kind: "saved-draft-not-live-evidence" as const,
      storeId: this.expectedStoreId, ...task, revision: latest.revision, closed: latest.operation === "close",
      latestCandidate: candidate, resumeRequirement: "fresh-policy-inspection-and-planning" as const,
      authority: "none" as const, approvalAvailable: false as const, executionEnabled: false as const });
  }
  listSnapshot() {
    const state = this.readState(); return deepFreeze({ storeId: this.expectedStoreId, creationEpoch: state.creationEpoch,
      tasks: [...state.tasks.values()].map(task => ({ storeId: this.expectedStoreId,
      taskId: task.taskId, creationEpoch: task.creationEpoch,
      briefDigest: task.briefDigest, revision: state.latest.get(task.taskId)!.revision, closed: state.latest.get(task.taskId)!.operation === "close" })) });
  }
  list() { return this.listSnapshot().tasks; }
  /** Explicit host-authorized deletion of CLOSED draft history only. Ends its
   * retry window, is not secure erasure, and never touches an effect/approval DB.
   * Advances creation epoch atomically so a delayed old create cannot recreate
   * forgotten history. Hosts must review/reissue stale new-draft requests, never
   * silently substitute the new epoch. Task identity includes store + epoch. */
  forgetClosed(taskId: string, expectedCreationEpoch: number, expectedBriefDigest: string): "forgotten" | "absent" {
    parse(uuid, taskId, "request-invalid"); parse(epoch, expectedCreationEpoch, "request-invalid"); parse(digest, expectedBriefDigest, "request-invalid");
    return this.tx(() => {
      const state = this.scan(), task = state.tasks.get(taskId); if (!task) return "absent";
      if (task.creationEpoch !== expectedCreationEpoch) return fail("task-epoch-mismatch");
      if (task.briefDigest !== expectedBriefDigest || state.latest.get(taskId)!.operation !== "close") return fail("forget-denied");
      if (state.creationEpoch >= 1_000_000_000) return fail("epoch-limit");
      this.db.prepare("DELETE FROM operator_task_events WHERE task_id=?").run(taskId);
      this.db.prepare("DELETE FROM operator_tasks WHERE task_id=?").run(taskId);
      this.db.prepare("UPDATE operator_task_meta SET creation_epoch=creation_epoch+1 WHERE singleton=1").run();
      this.scan(); return "forgotten";
    }, true);
  }
}
