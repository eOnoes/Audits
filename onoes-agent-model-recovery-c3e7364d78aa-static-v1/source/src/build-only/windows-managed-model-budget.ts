import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";

// Dormant local allocation journal, not a provider billing oracle or approval.
// The host must pin this book and authorize its funding/price assumptions.
// No reset, automatic refund, provider callback or cross-book budget claim.
export const MANAGED_MODEL_BUDGET_LIMITS = Object.freeze({ attempts: 1000, microunits: 1_000_000_000_000, recordBytes: 4096 });
export const MANAGED_MODEL_RECOVERY_MAX_BYTES = 2_097_152;
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const amount = z.number().int().min(1).max(MANAGED_MODEL_BUDGET_LIMITS.microunits);
const time = z.string().refine(v => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v);
const funding = z.object({ currency: z.string().regex(/^[A-Z]{3}$/), totalAllocationMicrounits: amount,
  maximumAttempts: z.number().int().min(1).max(MANAGED_MODEL_BUDGET_LIMITS.attempts) }).strict();
const policySchema = funding.extend({ schemaVersion: z.literal("agent-model-allocation-book/v1"), storeId: uuid }).strict();
const requestSchema = z.object({ requestDigest: digest, profileDigest: digest, allocationMicrounits: amount }).strict();
const reservationSchema = requestSchema.extend({ budgetDigest: digest, reservedAt: time, reservationDigest: digest }).strict();
const outcome = z.enum(["response-observed", "outcome-unknown"]);
const terminalInputSchema = z.object({ requestDigest: digest, reservationDigest: digest, outcome }).strict();
const terminalSchema = terminalInputSchema.extend({ recordedAt: time, terminalDigest: digest }).strict();
type Reservation = z.infer<typeof reservationSchema>;
type Terminal = z.infer<typeof terminalSchema>;
type Reason = "input-invalid" | "schema-invalid" | "durability-invalid" | "state-invalid" | "budget-mismatch"
  | "transaction-active" | "storage-unavailable" | "request-conflict" | "allocation-exhausted" | "attempts-exhausted"
  | "missing" | "terminal-conflict" | "clock-invalid";
export class ManagedModelBudgetError extends Error {
  constructor(readonly reason: Reason) { super(`managed-model-budget-${reason}`); this.name = "ManagedModelBudgetError"; }
}
const fail = (reason: Reason): never => { throw new ManagedModelBudgetError(reason); };
function guard<T>(fn: () => T): T { try { return fn(); } catch (e) { if (e instanceof ManagedModelBudgetError) throw e; return fail("storage-unavailable"); } }
function wire<T>(schema: z.ZodType<T>, value: unknown, reason: Reason): T {
  try {
    if (typeof value !== "string" || value.length > 4096 || Buffer.byteLength(value) > 4096) return fail(reason);
    const parsed = schema.parse(JSON.parse(value)); if (canonicalJson(parsed) !== value) return fail(reason); return parsed;
  } catch { return fail(reason); }
}
function text(value: unknown): string {
  if (!Buffer.isBuffer(value) || value.length > 4096) return fail("state-invalid");
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(value); } catch { return fail("state-invalid"); }
}
function clock(now: () => string): string {
  try { const value = now(); if (!time.safeParse(value).success) return fail("clock-invalid"); return value; }
  catch { return fail("clock-invalid"); }
}
const META = "CREATE TABLE model_allocation_meta (singleton INTEGER PRIMARY KEY CHECK(singleton=1), policy_json TEXT NOT NULL CHECK(typeof(policy_json)='text' AND length(CAST(policy_json AS BLOB)) BETWEEN 2 AND 4096))";
const ROWS = "CREATE TABLE model_allocations (request_digest TEXT PRIMARY KEY NOT NULL, reservation_json TEXT NOT NULL CHECK(typeof(reservation_json)='text' AND length(CAST(reservation_json AS BLOB)) BETWEEN 2 AND 4096), terminal_json TEXT CHECK(terminal_json IS NULL OR (typeof(terminal_json)='text' AND length(CAST(terminal_json AS BLOB)) BETWEEN 2 AND 4096)))";
const objects = (db: Database.Database) => db.prepare("SELECT name,sql FROM main.sqlite_schema WHERE sql IS NOT NULL ORDER BY name LIMIT 3").all();
function namespace(db: Database.Database) {
  if (db.prepare("SELECT 1 FROM temp.sqlite_schema LIMIT 1").get() !== undefined
    || (db.pragma("database_list") as { name: string }[]).some(v => !["main", "temp"].includes(v.name))) fail("schema-invalid");
}
function schema(db: Database.Database) {
  namespace(db);
  if (canonicalJson(objects(db)) !== canonicalJson([{ name: "model_allocation_meta", sql: META }, { name: "model_allocations", sql: ROWS }])) fail("schema-invalid");
}
function durability(db: Database.Database) {
  if (db.pragma("journal_mode", { simple: true }) !== "wal" || db.pragma("synchronous", { simple: true }) !== 2
    || db.pragma("trusted_schema", { simple: true }) !== 0 || db.pragma("busy_timeout", { simple: true }) !== 250
    || db.pragma("ignore_check_constraints", { simple: true }) !== 0) fail("durability-invalid");
}
function configure(db: Database.Database) {
  if (db.inTransaction) fail("transaction-active");
  db.pragma("journal_mode=WAL"); db.pragma("synchronous=FULL"); db.pragma("trusted_schema=OFF"); db.pragma("busy_timeout=250"); durability(db);
}
export function initializeManagedModelBudget(db: Database.Database, fundingWire: unknown) {
  return guard(() => {
    const configured = wire(funding, fundingWire, "input-invalid");
    namespace(db); if (objects(db).length) fail("schema-invalid"); configure(db);
    const policy = { ...configured, schemaVersion: "agent-model-allocation-book/v1" as const, storeId: randomUUID() };
    db.transaction(() => {
      namespace(db); if (objects(db).length) fail("schema-invalid"); db.exec(META); db.exec(ROWS);
      db.prepare("INSERT INTO model_allocation_meta VALUES (1,?)").run(canonicalJson(policy)); schema(db);
    }).immediate();
    return deepFreeze({ policy, budgetDigest: canonicalSha256Digest(policy), kind: "local-allocation-not-spending-approval" as const });
  });
}
function receipt(reservation: Reservation, terminal: Terminal | null) {
  const core = { schemaVersion: "agent-model-allocation-receipt/v1" as const, kind: "recorded-allocation-not-billing-or-authorization" as const,
    reservation, terminal, allocatedMicrounits: reservation.allocationMicrounits,
    refundMicrounits: 0 as const, dispatchAuthorized: false as const, actualChargeVerified: false as const };
  return deepFreeze({ ...core, receiptDigest: canonicalSha256Digest(core) });
}
function summarize(budgetDigest: string, state: { policy: z.infer<typeof policySchema>; records: ReturnType<typeof receipt>[]; allocated: number }) {
  return { budgetDigest, currency: state.policy.currency,
    totalAllocationMicrounits: state.policy.totalAllocationMicrounits, allocatedMicrounits: state.allocated,
    remainingMicrounits: state.policy.totalAllocationMicrounits - state.allocated,
    attempts: state.records.length, remainingAttempts: state.policy.maximumAttempts - state.records.length,
    unresolvedAttempts: state.records.filter(r => r.terminal === null || r.terminal.outcome === "outcome-unknown").length,
    actualChargeVerified: false as const, automaticRefundAvailable: false as const };
}
export class SqliteManagedModelBudget {
  constructor(private readonly db: Database.Database, private readonly expectedBudgetDigest: string,
    private readonly now: () => string = () => new Date().toISOString()) {
    guard(() => { if (!digest.safeParse(expectedBudgetDigest).success) fail("input-invalid"); schema(db); configure(db); this.snapshot(); });
  }
  private tx<T>(fn: () => T, write = false): T {
    return guard(() => {
      if (this.db.inTransaction) fail("transaction-active"); schema(this.db); durability(this.db);
      const transaction = this.db.transaction(() => { schema(this.db); durability(this.db); return fn(); });
      return write ? transaction.immediate() : transaction.deferred();
    });
  }
  private scan() {
    const meta = this.db.prepare("SELECT singleton, CASE WHEN typeof(policy_json)='text' AND length(CAST(policy_json AS BLOB))<=4096 THEN CAST(policy_json AS BLOB) ELSE NULL END AS bytes FROM model_allocation_meta LIMIT 2").all() as { singleton: number; bytes: unknown }[];
    if (meta.length !== 1 || meta[0]!.singleton !== 1) return fail("state-invalid");
    const policy = wire(policySchema, text(meta[0]!.bytes), "state-invalid");
    if (canonicalSha256Digest(policy) !== this.expectedBudgetDigest) return fail("budget-mismatch");
    const rows = this.db.prepare(`SELECT substr(request_digest,1,72) AS request,
      CASE WHEN typeof(reservation_json)='text' AND length(CAST(reservation_json AS BLOB))<=4096 THEN CAST(reservation_json AS BLOB) ELSE NULL END AS reserved,
      terminal_json IS NOT NULL AS terminal_present,
      CASE WHEN typeof(terminal_json)='text' AND length(CAST(terminal_json AS BLOB))<=4096 THEN CAST(terminal_json AS BLOB) ELSE NULL END AS terminal
      FROM model_allocations ORDER BY request_digest LIMIT 1001`).all() as {request:string;reserved:unknown;terminal_present:number;terminal:unknown}[];
    if (rows.length > policy.maximumAttempts) return fail("state-invalid");
    let allocated = 0, latestTime = "";
    const records = rows.map(row => {
      const reservation = wire(reservationSchema, text(row.reserved), "state-invalid"), { reservationDigest, ...core } = reservation;
      if (reservation.requestDigest !== row.request || reservation.budgetDigest !== this.expectedBudgetDigest
        || canonicalSha256Digest(core) !== reservationDigest) return fail("state-invalid");
      let terminal: Terminal | null = null;
      if (row.terminal_present) {
        terminal = wire(terminalSchema, text(row.terminal), "state-invalid");
        const { terminalDigest, ...terminalCore } = terminal;
        if (terminal.requestDigest !== row.request || terminal.reservationDigest !== reservationDigest
          || terminal.recordedAt < reservation.reservedAt || canonicalSha256Digest(terminalCore) !== terminalDigest) return fail("state-invalid");
      }
      allocated += reservation.allocationMicrounits;
      latestTime = [latestTime, reservation.reservedAt, terminal?.recordedAt ?? ""].sort().at(-1)!;
      return receipt(reservation, terminal);
    });
    if (!Number.isSafeInteger(allocated) || allocated > policy.totalAllocationMicrounits) return fail("state-invalid");
    return { policy, records, allocated, latestTime };
  }
  snapshot() {
    return this.tx(() => deepFreeze(summarize(this.expectedBudgetDigest, this.scan())));
  }
  /** Read-only discovery after lost responses/restart, not reconciliation itself.
   * One bounded, validated database snapshot supplies BOTH summary and entries.
   * Never dispatch, mark outcomes, recover source, refund or infer remote stop. */
  recoverySnapshot() {
    return this.tx(() => {
      const state = this.scan(), summary = summarize(this.expectedBudgetDigest, state);
      const entries = state.records.map(record => ({ receipt: record,
        classification: record.terminal?.outcome ?? ("reservation-without-outcome" as const),
        operatorReconciliationRequired: record.terminal === null || record.terminal.outcome === "outcome-unknown" }));
      const core = { schemaVersion: "agent-model-allocation-recovery/v1" as const,
        kind: "recorded-allocation-inventory-not-provider-state" as const,
        summary, entries,
        counts: { withoutOutcome: entries.filter(e => e.classification === "reservation-without-outcome").length,
          outcomeUnknown: entries.filter(e => e.classification === "outcome-unknown").length,
          responseObserved: entries.filter(e => e.classification === "response-observed").length },
        allocationCapacityExhausted: summary.remainingMicrounits === 0,
        attemptCapacityExhausted: summary.remainingAttempts === 0,
        readOnly: true as const, automaticRetryAvailable: false as const,
        responseRecoveryAvailable: false as const, remoteWorkStatus: "not-established" as const,
        approvalAvailable: false as const, authority: "none" as const };
      const result = deepFreeze({ ...core, recoveryDigest: canonicalSha256Digest(core) });
      if (Buffer.byteLength(canonicalJson(result)) > MANAGED_MODEL_RECOVERY_MAX_BYTES) return fail("state-invalid");
      return result;
    });
  }
  read(requestDigest: string) {
    if (!digest.safeParse(requestDigest).success) return fail("input-invalid");
    return this.tx(() => this.scan().records.find(r => r.reservation.requestDigest === requestDigest) ?? null);
  }
  reserve(requestWire: unknown) {
    const request = wire(requestSchema, requestWire, "input-invalid");
    const replay = (stored: ReturnType<typeof receipt>) => {
      const { requestDigest, profileDigest, allocationMicrounits } = stored.reservation;
      if (canonicalJson({ requestDigest, profileDigest, allocationMicrounits }) !== canonicalJson(request)) return fail("request-conflict");
      return deepFreeze({ disposition: "existing" as const, receipt: stored });
    };
    const existing = this.read(request.requestDigest); if (existing) return replay(existing);
    const recordedAt = clock(this.now);
    return this.tx(() => {
      const state = this.scan(), winner = state.records.find(r => r.reservation.requestDigest === request.requestDigest);
      if (winner) return replay(winner);
      if (recordedAt < state.latestTime) return fail("clock-invalid");
      if (state.records.length >= state.policy.maximumAttempts) return fail("attempts-exhausted");
      if (request.allocationMicrounits > state.policy.totalAllocationMicrounits - state.allocated) return fail("allocation-exhausted");
      const core = { ...request, budgetDigest: this.expectedBudgetDigest, reservedAt: recordedAt };
      const reservation = { ...core, reservationDigest: canonicalSha256Digest(core) };
      this.db.prepare("INSERT INTO model_allocations VALUES (?,?,NULL)").run(request.requestDigest, canonicalJson(reservation));
      const stored = this.scan().records.find(r => r.reservation.requestDigest === request.requestDigest)!;
      return deepFreeze({ disposition: "reserved" as const, receipt: stored });
    }, true);
  }
  recordOutcome(terminalWire: unknown) {
    const input = wire(terminalInputSchema, terminalWire, "input-invalid");
    const check = (stored: ReturnType<typeof receipt> | null) => {
      if (!stored) return fail("missing");
      if (stored.reservation.reservationDigest !== input.reservationDigest) return fail("request-conflict");
      if (stored.terminal && stored.terminal.outcome !== input.outcome) return fail("terminal-conflict");
      return stored;
    };
    const existing = check(this.read(input.requestDigest)); if (existing.terminal) return existing;
    const recordedAt = clock(this.now);
    return this.tx(() => {
      const state = this.scan(), stored = check(state.records.find(r => r.reservation.requestDigest === input.requestDigest) ?? null);
      if (stored.terminal) return stored;
      if (recordedAt < state.latestTime) return fail("clock-invalid");
      const core = { ...input, recordedAt }, terminal = { ...core, terminalDigest: canonicalSha256Digest(core) };
      const updated = this.db.prepare("UPDATE model_allocations SET terminal_json=? WHERE request_digest=? AND terminal_json IS NULL")
        .run(canonicalJson(terminal), input.requestDigest);
      if (updated.changes !== 1) return fail("state-invalid");
      const recorded = this.scan().records.find(r => r.reservation.requestDigest === input.requestDigest);
      if (!recorded || canonicalJson(recorded.terminal) !== canonicalJson(terminal)) return fail("state-invalid");
      return recorded;
    }, true);
  }
}
