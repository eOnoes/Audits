import type { IncomingMessage, ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import { canonicalJson } from "../compatibility/canonical-json.js";
import { OperatorSessionDenied } from "./windows-operator-session.js";
import type { OperatorSettingsSession } from "./windows-operator-session.js";
import { WorkspacePolicyStoreError } from "./windows-workspace-policy-store.js";
import type { SqliteWindowsWorkspacePolicyStore } from "./windows-workspace-policy-store.js";
import { BuilderEffectJournalError, WindowsBuilderEffectJournal } from "./windows-builder-effect-journal.js";
import type { SqliteWindowsBuilderRecoveryStore } from "./windows-builder-recovery-store.js";
import { createWindowsOperatorTaskPreview, OperatorTaskPreviewError, OPERATOR_TASK_PREVIEW_LIMITS } from "./windows-operator-task-preview.js";
import { createWindowsOperatorTaskIntake, OperatorTaskIntakeError, OPERATOR_TASK_INTAKE_MAX_BYTES } from "./windows-operator-task-intake.js";
import { OperatorTaskStoreError, type SqliteWindowsOperatorTaskStore } from "./windows-operator-task-store.js";
import { accessOperatorTaskHistory, parseOperatorTaskHistoryRequest, OPERATOR_TASK_HISTORY_MAX_BODY_BYTES,
  OPERATOR_TASK_HISTORY_RATE_LIMIT } from "./windows-operator-task-history.js";
import { WindowsManagedDraftPlanningSession, ManagedDraftPlanningError, type ManagedDraftPlanningOptions } from "./windows-managed-draft-planning.js";
import { accessOperatorTaskPlanning, parseOperatorTaskPlanningRequest, OPERATOR_TASK_PLANNING_LIMITS } from "./windows-operator-task-planning.js";
import { ManagedWorkPlanError } from "./windows-managed-work-plan.js";
import { WindowsOperatorModelRecovery, OperatorModelRecoveryError, OPERATOR_MODEL_RECOVERY_LIMITS } from "./windows-operator-model-recovery.js";
import type { SqliteManagedModelBudget } from "./windows-managed-model-budget.js";

// Dormant handler, not a server/bootstrap. Optional paired inspection reads
// through a host-supplied custody adapter; no filesystem WRITE/execution route.
export const OPERATOR_SETTINGS_BODY_TIMEOUT_MS = 2_000;
export const OPERATOR_SETTINGS_MAX_BODY_BYTES = 600_000;
export const OPERATOR_SETTINGS_MAX_IN_FLIGHT = 4;
export const OPERATOR_SETTINGS_RATE_LIMIT = 30;
export const OPERATOR_RECOVERY_READ_RATE_LIMIT = 2;
export const OPERATOR_RECOVERY_MAX_RESPONSE_BYTES = 1_048_576;
export const OPERATOR_TASK_PREVIEW_RATE_LIMIT = 2;
export const OPERATOR_TASK_PREVIEW_MAX_CHUNKS = 4_096;
const RATE_WINDOW_MS = 60_000;
const PREFIX = "/operator/settings/";
const COOKIE_NAME = "onoes_operator_session";
const RECOVERY_ROUTE = PREFIX + "recovery";
const CAPACITY_ROUTE = PREFIX + "capacity";
const TASK_PREVIEW_ROUTE = PREFIX + "task-preview";
const TASK_INTAKE_ROUTE = PREFIX + "task-intake";
const TASK_HISTORY_ROUTE = PREFIX + "task-history";
const TASK_PLANNING_ROUTE = PREFIX + "task-planning";
const MODEL_RECOVERY_ROUTE = PREFIX + "model-recovery";
const ROUTES = new Set(["pair", "read", "update", "logout", "recovery", "capacity", "task-preview", "task-intake", "task-history", "task-planning", "model-recovery"].map((path) => PREFIX + path));

class RequestDenied extends Error {
  constructor(readonly status: number, readonly reason: string) { super(reason); }
}
const deny = (status: number, reason: string): never => { throw new RequestDenied(status, reason); };

function send(response: ServerResponse, status: number, value: unknown, cookie?: string): void {
  if (response.destroyed || response.writableEnded) return;
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("cross-origin-resource-policy", "same-origin");
  response.setHeader("connection", "close");
  if (cookie !== undefined) response.setHeader("set-cookie", cookie);
  response.end(canonicalJson(value));
}

function cookie(token: string, maxAge: number): string {
  // This handler is loopback HTTP only. Network/TLS deployment is not supported.
  // Cookies have no port scope; the independent CSRF secret is still mandatory.
  return `${COOKIE_NAME}=${token}; Path=${PREFIX}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

function sessionToken(request: IncomingMessage): string | undefined {
  const value = request.headers.cookie;
  if (typeof value !== "string" || value.length > 8_192) return undefined;
  const pairs = value.split(";").map((part) => part.trim()).filter((part) => part.startsWith(COOKIE_NAME + "="));
  return pairs.length === 1 ? pairs[0]?.slice(COOKIE_NAME.length + 1) : undefined;
}

function exactObject(value: unknown, keys: readonly string[]): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function readBody(request: IncomingMessage, maxBytes: number, maxChunks = Infinity): Promise<unknown> {
  const declared = request.headers["content-length"];
  if (declared !== undefined && (typeof declared !== "string" || !/^(?:0|[1-9][0-9]{0,6})$/.test(declared))) {
    return Promise.reject(new RequestDenied(400, "operator-body-invalid"));
  }
  if (declared !== undefined && Number(declared) > maxBytes) return Promise.reject(new RequestDenied(413, "operator-body-too-large"));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const timer = setTimeout(() => fail(new RequestDenied(408, "operator-body-timeout")), OPERATOR_SETTINGS_BODY_TIMEOUT_MS);
    timer.unref();
    const cleanup = (): void => {
      clearTimeout(timer);
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("aborted", onAborted);
      request.off("error", onAborted);
    };
    const fail = (error: RequestDenied): void => {
      if (settled) return;
      settled = true;
      cleanup();
      request.pause();
      reject(error);
    };
    const onAborted = (): void => fail(new RequestDenied(400, "operator-body-aborted"));
    const onData = (chunk: Buffer | string): void => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.length;
      if (total > maxBytes || chunks.length >= maxChunks) return fail(new RequestDenied(413, "operator-body-too-large"));
      chunks.push(bytes);
    };
    const onEnd = (): void => {
      if (settled) return;
      try {
        const bytes = Buffer.concat(chunks, total);
        const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        const value: unknown = JSON.parse(text);
        // Exact canonical spelling denies duplicate keys, BOMs, malformed UTF-16,
        // excessive structure and parser/serializer ambiguity on this NEW API.
        if (canonicalJson(value) !== text) throw new Error("noncanonical");
        settled = true;
        cleanup();
        resolve(value);
      } catch { fail(new RequestDenied(400, "operator-body-invalid")); }
    };
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("aborted", onAborted);
    request.once("error", onAborted);
  });
}

export interface WindowsOperatorSettingsOptions {
  readonly origin: string;
  readonly session: OperatorSettingsSession;
  readonly store: SqliteWindowsWorkspacePolicyStore;
  /** Optional trusted bootstrap dependency, never supplied by an HTTP caller.
   * Opt in before pairing a fresh operator session; the pairing response names
   * the added recovery-read scope. No settlement/resume/clear operation exists. */
  readonly recovery?: SqliteWindowsBuilderRecoveryStore;
  /** Trusted host read port, selected before fresh pairing; no HTTP book selection. */
  readonly modelRecovery?: Readonly<{ book: Pick<SqliteManagedModelBudget, "recoverySnapshot">; expectedBudgetDigest: string }>;
  /** Trusted opt-in before pairing. Supplied-text calculation only; no live
   * inspection, command execution, approval or durable task state. */
  readonly taskPreview?: true;
  /** Optional operator-brief construction. Requires preview/recovery bootstrap
   * and newly acknowledged pairing scope; never a task/approval store writer. */
  readonly taskIntake?: true;
  /** Separate trusted-host draft DB. Requires fresh pairing with the exact new
   * scope; never accepts a caller-supplied DB, candidate or approval. */
  readonly taskHistory?: SqliteWindowsOperatorTaskStore;
  /** New handler-owned inspection lifetime and explicit fresh pairing scope.
   * No default adapter. Uses this handler's draft/policy stores, never HTTP ones. */
  readonly taskPlanning?: Readonly<{ inspection: Omit<ManagedDraftPlanningOptions["inspection"], "policy">;
    verification: ManagedDraftPlanningOptions["verification"]; proposal?: ManagedDraftPlanningOptions["proposal"];
    workPlan?: ManagedDraftPlanningOptions["workPlan"] }>;
  readonly monotonicNow?: () => number;
}

export function createWindowsOperatorSettingsHandler(options: WindowsOperatorSettingsOptions):
  (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const origin = options.origin;
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(origin);
  if (match === null || Number(match[1]) > 65535) throw new Error("operator-origin-invalid");
  const host = origin.slice("http://".length);
  const session = options.session;
  const store = options.store;
  const recoveryStore = options.recovery;
  const recovery = recoveryStore === undefined ? undefined : new WindowsBuilderEffectJournal(recoveryStore, store);
  const taskPreview = options.taskPreview === true;
  const taskIntake = options.taskIntake === true;
  if(taskIntake&&(!taskPreview||recovery===undefined))throw new Error("operator-task-intake-bootstrap-invalid");
  const taskHistory = options.taskHistory;
  if(taskHistory!==undefined&&!taskIntake)throw new Error("operator-task-history-bootstrap-invalid");
  const clock = options.monotonicNow ?? (() => performance.now());
  const modelRecovery = options.modelRecovery === undefined ? undefined : new WindowsOperatorModelRecovery({
    session, book: options.modelRecovery.book, expectedBudgetDigest: options.modelRecovery.expectedBudgetDigest, now: clock });
  let modelRecoveryPaired = false;
  // Outer quota counts authenticated transport failures before body allocation.
  // Controller quota independently bounds completed body/read attempts. Neither
  // counter resets at pairing/logout or fixed global-window boundaries.
  let modelRecoveryAttempts: number[] = [];
  if (options.taskPlanning !== undefined && taskHistory === undefined) throw new Error("operator-task-planning-bootstrap-invalid");
  const taskPlanning = options.taskPlanning === undefined ? undefined : new WindowsManagedDraftPlanningSession({
    drafts: taskHistory!, inspection: { ...options.taskPlanning.inspection, policy: store },
    verification: options.taskPlanning.verification, ...(options.taskPlanning.proposal === undefined ? {} : { proposal: options.taskPlanning.proposal }),
    ...(options.taskPlanning.workPlan === undefined ? {} : { workPlan: options.taskPlanning.workPlan }), monotonicNow: clock });
  const guidedPlanning = options.taskPlanning?.workPlan !== undefined;
  let windowStart = 0;
  let lastTime = 0;
  let rateCount = 0;
  let recoveryReadCount = 0;
  let recoveryScopePaired = false;
  let taskPreviewCount = 0;
  let taskPreviewScopePaired = false;
  let taskHistoryScopePaired = false;
  let taskHistoryCount = 0;
  let taskPlanningScopePaired = false;
  let taskPlanningCount = 0;
  let taskInspectionCount = 0;
  let inFlight = 0;
  let clockFailed = false;

  return async (request, response) => {
    // Ignore transport error text; a request may abort after an early denial.
    request.on("error", () => undefined);
    let counted = false;
    let updateStarted = false;
    let recoveryReadStarted = false;
    let taskHistoryWriteStarted = false;
    let planningStarted = false;
    let planningDisconnect: (() => void) | undefined;
    const recoveryRoute = request.url === RECOVERY_ROUTE || request.url === CAPACITY_ROUTE;
    const modelRecoveryRoute = request.url === MODEL_RECOVERY_ROUTE;
    const taskPreviewRoute = request.url === TASK_PREVIEW_ROUTE;
    const taskIntakeRoute = request.url === TASK_INTAKE_ROUTE;
    const taskHistoryRoute = request.url === TASK_HISTORY_ROUTE;
    const taskPlanningRoute = request.url === TASK_PLANNING_ROUTE;
    const taskDescriptionRoute = taskPreviewRoute || taskIntakeRoute;
    try {
      if (request.socket.localAddress !== "127.0.0.1" || request.socket.remoteAddress !== "127.0.0.1"
        || request.socket.localPort !== Number(match[1]) || request.headers.host !== host
        || request.headers.origin !== origin
        || (request.headers["sec-fetch-site"] !== undefined && request.headers["sec-fetch-site"] !== "same-origin")) {
        deny(403, "operator-origin-denied");
      }
      if (!ROUTES.has(request.url ?? "") || (recoveryRoute && recovery === undefined)
        || (modelRecoveryRoute && modelRecovery === undefined)
        || (taskPreviewRoute && !taskPreview) || (taskIntakeRoute && !taskIntake)
        || (taskHistoryRoute && taskHistory === undefined) || (taskPlanningRoute && taskPlanning === undefined)) deny(404, "operator-route-not-found");
      if (request.method !== "POST") deny(405, "operator-method-denied");
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(String(request.headers["content-type"] ?? ""))
        || (request.headers["content-encoding"] !== undefined && request.headers["content-encoding"] !== "identity")) {
        deny(415, "operator-content-type-invalid");
      }
      let now = NaN;
      try { now = clock(); } catch { clockFailed = true; deny(503, "operator-settings-unavailable"); }
      if (clockFailed || !Number.isFinite(now) || now < lastTime || now > Number.MAX_SAFE_INTEGER) {
        clockFailed = true;
        deny(503, "operator-settings-unavailable");
      }
      lastTime = now;
      if (now - windowStart >= RATE_WINDOW_MS) { windowStart = now; rateCount = 0; recoveryReadCount = 0; taskPreviewCount = 0; taskHistoryCount = 0; taskPlanningCount = 0; taskInspectionCount = 0; }
      if (++rateCount > OPERATOR_SETTINGS_RATE_LIMIT || inFlight >= OPERATOR_SETTINGS_MAX_IN_FLIGHT) {
        deny(429, "operator-rate-limited");
      }
      const pairing = request.url === PREFIX + "pair";
      const token = sessionToken(request);
      const csrf = request.headers["x-onoes-csrf"];
      if (!pairing) session.assertSession(token, csrf);
      if (recoveryRoute && !recoveryScopePaired) throw new OperatorSessionDenied();
      if (modelRecoveryRoute && !modelRecoveryPaired) throw new OperatorSessionDenied();
      if (modelRecoveryRoute) {
        modelRecoveryAttempts = modelRecoveryAttempts.filter(time => now - time < OPERATOR_MODEL_RECOVERY_LIMITS.windowMs);
        if (modelRecoveryAttempts.length >= OPERATOR_MODEL_RECOVERY_LIMITS.readsPerMinute) deny(429, "operator-model-recovery-rate-limited");
        modelRecoveryAttempts.push(now);
      }
      if (taskDescriptionRoute && !taskPreviewScopePaired) throw new OperatorSessionDenied();
      if (taskHistoryRoute && !taskHistoryScopePaired) throw new OperatorSessionDenied();
      if (taskPlanningRoute && !taskPlanningScopePaired) throw new OperatorSessionDenied();
      // Count authenticated attempts before body allocation/calculation, including
      // malformed inputs. Independent of the recovery-read budget.
      if (taskDescriptionRoute && ++taskPreviewCount > OPERATOR_TASK_PREVIEW_RATE_LIMIT) deny(429, "operator-task-preview-rate-limited");
      if (taskHistoryRoute && ++taskHistoryCount > OPERATOR_TASK_HISTORY_RATE_LIMIT) deny(429, "operator-task-history-rate-limited");
      if (taskPlanningRoute && ++taskPlanningCount > OPERATOR_TASK_PLANNING_LIMITS.attemptsPerMinute) deny(429, "operator-task-planning-rate-limited");
      inFlight++;
      counted = true;
      const body = await readBody(request, modelRecoveryRoute ? OPERATOR_MODEL_RECOVERY_LIMITS.requestBytes : taskPlanningRoute ? OPERATOR_TASK_PLANNING_LIMITS.bodyBytes : taskHistoryRoute ? OPERATOR_TASK_HISTORY_MAX_BODY_BYTES : taskIntakeRoute ? OPERATOR_TASK_INTAKE_MAX_BYTES : taskPreviewRoute ? OPERATOR_TASK_PREVIEW_LIMITS.inputBytes
        : request.url === PREFIX + "update" ? OPERATOR_SETTINGS_MAX_BODY_BYTES : 1_024,
        modelRecoveryRoute ? OPERATOR_MODEL_RECOVERY_LIMITS.requestBytes : taskDescriptionRoute || taskHistoryRoute || taskPlanningRoute ? OPERATOR_TASK_PREVIEW_MAX_CHUNKS : Infinity);
      if (response.destroyed || request.socket.destroyed) return;
      if (pairing) {
        if (!exactObject(body, ["bootstrapSecret"])) deny(400, "operator-body-invalid");
        const credentials = session.pair((body as { bootstrapSecret: unknown }).bootstrapSecret);
        recoveryScopePaired = recovery !== undefined;
        modelRecoveryPaired = modelRecovery !== undefined;
        taskPreviewScopePaired = taskPreview;
        taskHistoryScopePaired = taskHistory !== undefined;
        taskPlanningScopePaired = taskPlanning !== undefined;
        send(response, 200, { csrfToken: credentials.csrfToken, expiresAfterMs: credentials.expiresAfterMs,
          ...(modelRecovery === undefined ? {} : { additionalScopes: ["model-allocation-metadata-read"] }),
          scope: guidedPlanning ? "operator-settings-draft-history-and-guided-source-planning"
            : taskPlanning !== undefined ? "operator-settings-draft-history-and-managed-source-planning"
            : taskHistory !== undefined ? "operator-settings-recovery-read-task-intake-preview-and-draft-history"
            : taskIntake ? "operator-settings-recovery-read-task-intake-and-preview"
            : taskPreview ? (recovery === undefined ? "operator-settings-and-task-preview" : "operator-settings-recovery-read-and-task-preview")
            : recovery === undefined ? "operator-settings-only" : "operator-settings-and-recovery-read",
          executionEnabled: false }, cookie(credentials.sessionToken, credentials.expiresAfterMs / 1_000));
        return;
      }
      session.assertSession(token, csrf); // Expiry/revocation may occur during body receipt.
      if (modelRecoveryRoute && modelRecovery !== undefined) {
        // readBody already required exact canonical bytes; reserialization does
        // not admit an alternate wire spelling. No second database read here.
        const wire = modelRecovery.read(canonicalJson(body), token, csrf);
        session.assertSession(token, csrf);
        if (response.destroyed || request.socket.destroyed) return;
        send(response, 200, JSON.parse(wire));
        return;
      }
      if (taskPlanningRoute && taskPlanning !== undefined) {
        const planningRequest = parseOperatorTaskPlanningRequest(body);
        // A previously paired source-only surface never grows guided scope.
        if (["plan-description", "prepare-plan", "discard-plan", "guided-proposal"].includes(planningRequest.action) && !guidedPlanning)
          deny(403, "operator-guided-planning-not-enabled");
        if (planningRequest.action === "inspect" && ++taskInspectionCount > OPERATOR_TASK_PLANNING_LIMITS.inspectionsPerMinute)
          deny(429, "operator-task-inspection-rate-limited");
        const controller = new AbortController();
        planningDisconnect = () => { if (!response.writableEnded) { controller.abort(); taskPlanning.discardWorkPlan(); } };
        response.once("close", planningDisconnect);
        planningStarted = true;
        const result = await accessOperatorTaskPlanning(planningRequest, taskPlanning, controller.signal);
        if (controller.signal.aborted || response.destroyed || request.socket.destroyed) { taskPlanning.discardWorkPlan(); return; }
        session.assertSession(token, csrf); // Inspection may outlive pairing validity.
        send(response, 200, result);
        return;
      }
      if (taskHistoryRoute && taskHistory !== undefined) {
        const historyRequest = parseOperatorTaskHistoryRequest(body);
        taskHistoryWriteStarted = historyRequest.action === "create" || historyRequest.action === "close";
        const result = accessOperatorTaskHistory(historyRequest, taskHistory);
        session.assertSession(token, csrf); // Do not disclose history after session expiry.
        send(response, 200, result);
        return;
      }
      if (taskIntakeRoute) {
        const draft = createWindowsOperatorTaskIntake(canonicalJson(body),store.snapshot());
        store.assertCurrentBinding(draft.request.expectedBinding);
        session.assertSession(token, csrf);
        send(response,200,draft);
        return;
      }
      if (taskPreviewRoute) {
        const preview = createWindowsOperatorTaskPreview(canonicalJson(body));
        session.assertSession(token, csrf); // Calculation may outlive the session.
        send(response, 200, preview);
        return;
      }
      if (request.url === PREFIX + "update") {
        updateStarted = true;
        const receipt = store.update(body);
        const current = store.snapshot();
        send(response, 200, { receipt, current, executionEnabled: false });
        return;
      }
      if (!exactObject(body, [])) deny(400, "operator-body-invalid");
      if (recoveryRoute && recovery !== undefined && recoveryStore !== undefined) {
        if (++recoveryReadCount > OPERATOR_RECOVERY_READ_RATE_LIMIT) deny(429, "operator-recovery-rate-limited");
        recoveryReadStarted = true;
        // Separate route preserves the exact recovery inventory wire contract.
        // The two quota reads are NOT an atomic cross-store availability check.
        const value = request.url === CAPACITY_ROUTE
          ? { capacity: { schemaVersion: "agent-operator-capacity/v1",
              kind: "separate-store-quota-observations-not-admission",
              recovery: recoveryStore.readCapacity(), policy: store.readCapacity(),
              retentionAvailable: false, diskSpaceMeasured: false },
              executionEnabled: false, recoveryActionsEnabled: false }
          : { inventory: recovery.inspectRecordedOperations(), executionEnabled: false, recoveryActionsEnabled: false };
        if (Buffer.byteLength(canonicalJson(value)) > OPERATOR_RECOVERY_MAX_RESPONSE_BYTES) deny(503, "operator-recovery-unavailable");
        session.assertSession(token, csrf); // Metadata work is synchronous but may outlive the session.
        send(response, 200, value);
        return;
      }
      if (request.url === PREFIX + "logout") {
        session.revoke();
        modelRecovery?.close();
        modelRecoveryPaired = false;
        recoveryScopePaired = false;
        taskPreviewScopePaired = false;
        taskHistoryScopePaired = false;
        taskPlanningScopePaired = false;
        taskPlanning?.close();
        send(response, 200, { sessionRevoked: true }, cookie("", 0));
        return;
      }
      send(response, 200, { current: store.snapshot(), executionEnabled: false });
    } catch (error) {
      if (modelRecoveryRoute) {
        const status = error instanceof OperatorSessionDenied ? 401 : error instanceof RequestDenied ? error.status
          : error instanceof OperatorModelRecoveryError ? error.reason === "session-denied" ? 401
            : error.reason === "request-invalid" ? 400 : error.reason === "rate-limited" ? 429 : 503 : 503;
        const reason = error instanceof RequestDenied ? error.reason : status === 401 ? "operator-session-denied"
          : status === 400 ? "operator-model-recovery-request-invalid" : status === 429 ? "operator-model-recovery-rate-limited"
          : "operator-model-recovery-unavailable";
        send(response, status, { reason, executionEnabled: false, authority: "none" });
        return;
      }
      if (taskPlanningRoute) {
        if (planningStarted && error instanceof OperatorSessionDenied) taskPlanning?.discardWorkPlan();
        const status = error instanceof OperatorSessionDenied ? 401 : error instanceof RequestDenied ? error.status
          : error instanceof ManagedWorkPlanError ? error.reason === "input-invalid" ? 400
            : ["draft-unavailable", "draft-changed", "policy-denied", "recovery-pending", "plan-untrusted", "plan-expired", "subject-mismatch", "budget-exceeded"].includes(error.reason) ? 409 : 503
          : error instanceof ManagedDraftPlanningError ? error.reason === "input-invalid" ? 400
            : ["draft-unavailable", "draft-changed", "draft-closed", "inspection-missing", "inspection-expired", "busy", "cancelled"].includes(error.reason) ? 409 : 503 : 503;
        const reason = error instanceof OperatorSessionDenied ? "operator-session-denied" : error instanceof RequestDenied ? error.reason
          : error instanceof ManagedWorkPlanError && status !== 503 ? `operator-work-plan-${error.reason}`
          : error instanceof ManagedDraftPlanningError && status !== 503 ? `operator-task-planning-${error.reason}` : "operator-task-planning-unavailable";
        send(response, status, { reason, executionEnabled: false, persisted: false });
        return;
      }
      if (taskHistoryRoute) {
        const status = error instanceof OperatorSessionDenied ? 401 : error instanceof RequestDenied ? error.status
          : error instanceof OperatorTaskStoreError ? error.reason === "request-invalid" ? 400 : error.reason === "missing" ? 404
            : ["store-identity-mismatch", "request-conflict", "revision-conflict", "task-closed", "task-limit", "revision-limit",
                "binding-mismatch", "policy-denied", "creation-epoch-stale", "task-epoch-mismatch"].includes(error.reason) ? 409 : 503 : 503;
        const reason = error instanceof OperatorSessionDenied ? "operator-session-denied" : error instanceof RequestDenied ? error.reason
          : error instanceof OperatorTaskStoreError && status !== 503 ? `operator-task-store-${error.reason}` : "operator-task-history-unavailable";
        // Once a mutation was attempted, an error/expired session is never proof
        // of non-commit. A client retains the original outbox until exact receipt
        // read-back, or explicit operator reconciliation; it never invents an ID.
        send(response, status, { reason, taskHistoryOutcome: taskHistoryWriteStarted ? "unknown" : "not-started" });
        return;
      }
      if (error instanceof OperatorSessionDenied) send(response, 401, { reason: "operator-session-denied" });
      else if (error instanceof RequestDenied) send(response, error.status, { reason: error.reason });
      else if (error instanceof OperatorTaskPreviewError) send(response, error.reason === "budget-exceeded" ? 413 : 400,
        { reason: `operator-task-preview-${error.reason}` });
      else if (error instanceof OperatorTaskIntakeError) send(response,error.reason === "stale-policy" ? 409 : error.reason === "budget-exceeded" ? 413 : 400,
        {reason:`operator-task-intake-${error.reason}`});
      else if (recoveryReadStarted) send(response, error instanceof BuilderEffectJournalError && error.reason === "snapshot-changed" ? 409 : 503,
        { reason: error instanceof BuilderEffectJournalError && error.reason === "snapshot-changed" ? "operator-recovery-changed" : "operator-recovery-unavailable" });
      else if (error instanceof WorkspacePolicyStoreError && error.reason === "request-invalid") send(response, 400, { reason: "operator-update-invalid" });
      else if (error instanceof WorkspacePolicyStoreError && ["stale-policy", "request-id-conflict", "update-limit"].includes(error.reason)) {
        send(response, 409, { reason: `operator-${error.reason}` });
      } else send(response, 503, { reason: "operator-settings-unavailable", updateOutcome: updateStarted ? "unknown" : "not-started" });
    } finally { if (planningDisconnect !== undefined) response.off("close", planningDisconnect); if (counted) inFlight--; }
  };
}
