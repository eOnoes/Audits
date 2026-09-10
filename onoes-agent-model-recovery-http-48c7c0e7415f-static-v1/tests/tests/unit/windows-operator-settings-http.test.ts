import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse, ClientRequest } from "node:http";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Database from "better-sqlite3";
import { SqliteManagedModelBudget, initializeManagedModelBudget } from "../../src/build-only/windows-managed-model-budget.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { canonicalJson, canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import { initializeWindowsOperatorTaskStore, SqliteWindowsOperatorTaskStore } from "../../src/build-only/windows-operator-task-store.js";
import { computeOperatorTaskHistoryOperationDigest, OPERATOR_TASK_HISTORY_MAX_BODY_BYTES, OPERATOR_TASK_HISTORY_RATE_LIMIT } from "../../src/build-only/windows-operator-task-history.js";
import { createOperatorTaskPreviewFixture } from "../helpers/operator-task-preview-fixture.js";
import { createWindowsOperatorTaskPreview } from "../../src/build-only/windows-operator-task-preview.js";
import { createWindowsOperatorTaskIntake } from "../../src/build-only/windows-operator-task-intake.js";
import { parseManagedVerificationCatalog, resolveManagedVerificationDefinition } from "../../src/build-only/windows-managed-verification-catalog.js";
import { OPERATOR_TASK_PLANNING_LIMITS } from "../../src/build-only/windows-operator-task-planning.js";
import { computeAgentFrozenCommandDigest } from "../../src/builder/agent-workflow.js";
import { computeBuilderInspectionScopeDigest } from "../../src/builder/schemas.js";
import { AGENT_FORBIDDEN_ACTIONS, AGENT_WORK_TASK_SCHEMA_VERSION } from "../../src/builder/agent-workflow-types.js";
import { BUILDER_CONTRACT_VERSION } from "../../src/builder/types.js";
import { createWindowsOperatorSession, OPERATOR_SESSION_TTL_MS } from "../../src/build-only/windows-operator-session.js";
import { initializeWindowsWorkspacePolicyStore, SqliteWindowsWorkspacePolicyStore } from "../../src/build-only/windows-workspace-policy-store.js";
import { initializeWindowsBuilderRecoveryStore, SqliteWindowsBuilderRecoveryStore } from "../../src/build-only/windows-builder-recovery-store.js";
import { BuilderEffectJournalError, WindowsBuilderEffectJournal } from "../../src/build-only/windows-builder-effect-journal.js";
import { createWindowsOperatorSettingsHandler, OPERATOR_SETTINGS_MAX_BODY_BYTES,
  OPERATOR_SETTINGS_MAX_IN_FLIGHT, OPERATOR_SETTINGS_RATE_LIMIT, OPERATOR_RECOVERY_READ_RATE_LIMIT,
  OPERATOR_RECOVERY_MAX_RESPONSE_BYTES } from "../../src/build-only/windows-operator-settings-http.js";

interface Reply { status: number; headers: IncomingHttpHeaders; text: string; json: Record<string, unknown> }
interface RequestOptions { method?: string; body?: string | Buffer; headers?: Record<string, string | undefined>; path?: string; hold?: boolean }

async function fixture(mode: { realModelBook?: true; modelRecovery?: true; recovery?: boolean; prepaired?: boolean; taskPreview?: true; taskIntake?: true; taskHistory?: true; taskPlanning?: true; taskProposal?: true; workPlan?: true; expireOnThirdCheck?: boolean } = {}) {
  let time = 0;
  let planTime = "2026-09-09T00:00:00.000Z";
  const database = new Database(":memory:");
  initializeWindowsWorkspacePolicyStore(database);
  const store = new SqliteWindowsWorkspacePolicyStore(database, () => "2026-09-05T00:00:00.000Z");
  const taskDb = mode.taskHistory ? new Database(":memory:") : undefined;
  const tasks = taskDb ? new SqliteWindowsOperatorTaskStore(taskDb, initializeWindowsOperatorTaskStore(taskDb), store,
    () => "2026-09-09T00:00:00.000Z") : undefined;
  const recoveryDb = mode.recovery ? new Database(":memory:") : undefined;
  const recovery = recoveryDb === undefined ? undefined : new SqliteWindowsBuilderRecoveryStore(recoveryDb,
    initializeWindowsBuilderRecoveryStore(recoveryDb), () => "2026-09-05T00:00:00.000Z");
  const pairing = createWindowsOperatorSession(() => time);
  let sessionChecks=0;
  const httpSession=mode.expireOnThirdCheck ? {
    pair:pairing.session.pair.bind(pairing.session),revoke:pairing.session.revoke.bind(pairing.session),
    assertSession(token:unknown,csrf:unknown){if(++sessionChecks===3)time=OPERATOR_SESSION_TTL_MS;pairing.session.assertSession(token,csrf);},
  } : pairing.session;
  const prepaired = mode.prepaired ? pairing.session.pair(pairing.bootstrapSecret) : undefined;
  const digest = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`;
  let modelReads = 0, modelReadHook = () => {};
  const modelParent = resolve(tmpdir());
  const modelDirectory = mode.realModelBook ? mkdtempSync(join(modelParent, "onoes-http-model-")) : undefined;
  const modelDb = modelDirectory ? new Database(join(modelDirectory, "book.db")) : undefined;
  const modelPin = modelDb ? initializeManagedModelBudget(modelDb,
    canonicalJson({ currency: "USD", totalAllocationMicrounits: 100, maximumAttempts: 10 })).budgetDigest : digest(77);
  const realModelBook = modelDb ? new SqliteManagedModelBudget(modelDb, modelPin, () => "2026-09-09T00:00:00.000Z") : undefined;
  // Trusted port fixture tests HTTP composition, not SQLite row validation.
  const modelBook = { recoverySnapshot() { modelReads++; const real = realModelBook?.recoverySnapshot(); modelReadHook(); return real ?? {
    summary: { budgetDigest: digest(77) }, authority: "none",
  } as ReturnType<SqliteManagedModelBudget["recoverySnapshot"]>; } };
  const source = "const label = 'private-source-sentinel';\n";
  let planningReads = 0, planningOpens = 0, planningCloses = 0, readHook = async () => {}, closeHook = () => {};
  const entries = [{ schemaVersion: "onoes-managed-verification-definition/v1", verificationId: "fixture-check", displayName: "Fixture check",
    runnerArtifactDigest: digest(3), commandContractDigest: digest(4), networkAccess: "denied", workspaceAccess: "read-only", scratchAccess: "private-bounded",
    timeoutMs: 5000, maximumOutputBytes: 4096, maximumScratchBytes: 4096, maximumProcessCount: 2 }];
  const catalogDigest = canonicalSha256Digest({ domain: "onoes-managed-verification-catalog/v1", entries });
  const verification = resolveManagedVerificationDefinition(parseManagedVerificationCatalog(canonicalJson({ schemaVersion: "onoes-managed-verification-catalog/v1",
    kind: "trusted-static-definitions-not-task-commands", entries, catalogDigest })), "fixture-check", catalogDigest);
  const command = { commandId: "fixture-command", verificationId: "fixture-check", executable: "node" as const, arguments: ["fixture-runner.mjs"],
    workingDirectory: ".", shell: false as const, effect: "verification" as const };
  const proposalOptions = { commandBinding: { command, commandDigest: computeAgentFrozenCommandDigest(command),
    catalogDigest, definitionDigest: verification.definitionDigest, commandContractDigest: digest(4) }, now: () => planTime };
  const planningOptions = { ...(mode.taskProposal ? { proposal: proposalOptions } : {}),
    ...(mode.workPlan ? { workPlan: { builderActorId: "fixture-host-builder" } } : {}), inspection: {
    workspace: { workspaceDigest: digest(1), repositoryRoot: "D:\\Work", worktreeRoot: "D:\\Managed", worktreeAttestationDigest: digest(2) },
    cancellationGraceMs: 100, io: { workspaceDigest: digest(1), async openCustody() { planningOpens++;
      return { async assertCustody() {}, async read(_path: string, cap: number) {
        assert.equal(database.inTransaction, false); assert.equal(taskDb?.inTransaction, false);
        planningReads++; await readHook(); assert.ok(Buffer.byteLength(source) <= cap); return Buffer.from(source);
      }, async close() { planningCloses++; closeHook(); } };
    } } }, verification };
  let latestResponse: ServerResponse | undefined;
  let handler: ReturnType<typeof createWindowsOperatorSettingsHandler> | undefined;
  const server = createServer((request, response) => {
    latestResponse = response;
    if (handler === undefined) { response.statusCode = 503; response.end(); return; }
    void handler(request, response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  handler = createWindowsOperatorSettingsHandler({ origin, session: httpSession, store, ...(recovery ? { recovery } : {}),
    ...(mode.modelRecovery ? { modelRecovery: { book: modelBook, expectedBudgetDigest: modelPin } } : {}),
    ...(mode.taskPreview ? {taskPreview:true} : {}), ...(mode.taskIntake ? {taskIntake:true} : {}),
    ...(tasks ? {taskHistory:tasks} : {}), ...(mode.taskPlanning ? {taskPlanning:planningOptions} : {}), monotonicNow: () => time });
  let cookie = prepaired ? `onoes_operator_session=${prepaired.sessionToken}` : "";
  let csrf = prepaired?.csrfToken ?? "";
  function start(route: string, options: RequestOptions = {}): { request: ClientRequest; result: Promise<Reply> } {
    const headers: Record<string, string | undefined> = { origin, "content-type": "application/json", cookie,
      "x-onoes-csrf": csrf, ...options.headers };
    const filtered = Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined));
    const request = httpRequest(origin + (options.path ?? `/operator/settings/${route}`), {
      method: options.method ?? "POST", headers: filtered, agent: false,
    });
    const result = new Promise<Reply>((resolve, reject) => {
      request.on("error", reject);
      request.on("response", (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          try {
            const text = Buffer.concat(chunks).toString("utf8");
            resolve({ status: response.statusCode ?? 0, headers: response.headers, text, json: JSON.parse(text) as Record<string, unknown> });
          } catch (error) { reject(error); }
        });
      });
    });
    if (options.hold === true) { request.flushHeaders(); if (options.body !== undefined) request.write(options.body); }
    else request.end(options.body ?? "{}");
    return { request, result };
  }
  const call = (route: string, options?: RequestOptions): Promise<Reply> => start(route, options).result;
  async function pair(): Promise<Reply> {
    const response = await call("pair", { body: canonicalJson({ bootstrapSecret: pairing.bootstrapSecret }) });
    assert.equal(response.status, 200);
    cookie = response.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    csrf = String(response.json["csrfToken"]);
    return response;
  }
  return { database, store, recovery, recoveryDb, taskDb, tasks, server, origin, pairing, call, start, pair,
    modelReads: () => modelReads, onModelRead(fn: () => void) { modelReadHook = fn; },
    modelDb, realModelBook,
    modelWire: canonicalJson({ schemaVersion: "agent-operator-model-recovery-request/v1", action: "read", budgetDigest: modelPin, readAllocationMetadata: true }),
    verification, command, source, planningStats: () => ({ opens: planningOpens, reads: planningReads, closes: planningCloses }),
    onPlanningRead(fn: () => Promise<void>) { readHook = fn; },
    onPlanningClose(fn: () => void) { closeHook = fn; },
    get cookie() { return cookie; }, get csrf() { return csrf; },
    get sessionChecks(){return sessionChecks;},
    setTime(value: number) { time = value; },
    setPlanTime(value: string) { planTime = value; },
    dropResponse() { latestResponse?.destroy(); },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      database.close();
      recoveryDb?.close();
      taskDb?.close();
      modelDb?.close();
      if (modelDirectory) {
        assert.equal(dirname(resolve(modelDirectory)), modelParent);
        assert.ok(basename(modelDirectory).startsWith("onoes-http-model-"));
        rmSync(modelDirectory, { recursive: true, force: true });
      }
    },
  };
}

test("model recovery requires opt-in and fresh scoped pairing with separated credentials", async () => {
  for (const mode of [{}, { modelRecovery: true as const, prepaired: true }, { modelRecovery: true as const }]) {
    const f = await fixture(mode); try {
      assert.equal((await f.call("model-recovery", { body: f.modelWire })).status, mode.modelRecovery ? 401 : 404);
      assert.equal(f.modelReads(), 0);
      if (!mode.prepaired) {
        const paired = await f.pair();
        assert.deepEqual(paired.json["additionalScopes"], mode.modelRecovery ? ["model-allocation-metadata-read"] : undefined);
        assert.equal(paired.json["sessionToken"], undefined);
        assert.match(paired.headers["set-cookie"]![0]!, /HttpOnly; SameSite=Strict/);
        const result = await f.call("model-recovery", { body: f.modelWire });
        assert.equal(result.status, mode.modelRecovery ? 200 : 404);
        if (mode.modelRecovery) { assert.equal(result.json["authority"], "none"); assert.equal(result.headers["cache-control"], "no-store"); }
      }
    } finally { await f.close(); }
  }
});

test("model recovery transport counts malformed authenticated attempts in a sliding quota", async () => {
  const f = await fixture({ modelRecovery: true }); try {
    await f.pair();
    assert.equal((await f.call("model-recovery", { body: " " + f.modelWire })).status, 400);
    f.setTime(1000);
    assert.equal((await f.call("model-recovery", { body: f.modelWire })).status, 200);
    f.setTime(59999);
    assert.equal((await f.call("model-recovery", { body: f.modelWire })).status, 429);
    assert.equal(f.modelReads(), 1);
    f.setTime(60000);
    assert.equal((await f.call("model-recovery", { body: f.modelWire })).status, 200);
    assert.equal((await f.call("model-recovery", { body: f.modelWire })).status, 429);
  } finally { await f.close(); }
});

test("model recovery rejects oversize bodies and wrong credentials before snapshots", async () => {
  const f = await fixture({ modelRecovery: true }); try {
    await f.pair();
    assert.equal((await f.call("model-recovery", { body: f.modelWire, headers: { "x-onoes-csrf": "wrong" } })).status, 401);
    assert.equal((await f.call("model-recovery", { body: "x".repeat(513) })).status, 413);
    assert.equal((await f.call("model-recovery", { body: f.modelWire })).status, 200);
    assert.equal(f.modelReads(), 1);
    assert.equal((await f.call("model-recovery", { body: f.modelWire })).status, 429);
  } finally { await f.close(); }
});

test("model recovery withholds inventory on snapshot revocation and redacts failures", async () => {
  for (const revoke of [false, true]) {
    const f = await fixture({ modelRecovery: true }); try {
      await f.pair();
      f.onModelRead(() => { if (revoke) f.pairing.session.revoke(); else throw new Error("private-database-detail"); });
      const result = await f.call("model-recovery", { body: f.modelWire });
      assert.equal(result.status, revoke ? 401 : 503);
      assert.equal(result.json["inventory"], undefined);
      assert.equal(result.text.includes("private-database-detail"), false);
    } finally { await f.close(); }
  }
});

test("model recovery HTTP preserves a real query-only allocation book and all outcome classes", async () => {
  const f = await fixture({ modelRecovery: true, realModelBook: true }); try {
    const d = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`;
    for (const [id, outcome] of [[1, null], [2, "outcome-unknown"], [3, "response-observed"]] as const) {
      const reserved = f.realModelBook!.reserve(canonicalJson({ requestDigest: d(id), profileDigest: d(9), allocationMicrounits: 4 }));
      if (outcome !== null) f.realModelBook!.recordOutcome(canonicalJson({ requestDigest: d(id),
        reservationDigest: reserved.receipt.reservation.reservationDigest, outcome }));
    }
    const expected = f.realModelBook!.recoverySnapshot();
    const changes = f.modelDb!.prepare("SELECT total_changes() AS n").get();
    f.modelDb!.pragma("query_only=ON");
    await f.pair();
    const result = await f.call("model-recovery", { body: f.modelWire });
    assert.equal(result.status, 200); assert.deepEqual(result.json["inventory"], expected);
    assert.equal(result.text, canonicalJson(result.json));
    assert.deepEqual(expected.entries.map(entry => entry.classification),
      ["reservation-without-outcome", "outcome-unknown", "response-observed"]);
    assert.equal(expected.summary.allocatedMicrounits, 12);
    assert.deepEqual(f.modelDb!.prepare("SELECT total_changes() AS n").get(), changes);
    assert.deepEqual(f.realModelBook!.recoverySnapshot(), expected);
  } finally { await f.close(); }
});

test("model recovery HTTP withholds a real snapshot after expiry or disconnect", async () => {
  for (const mode of ["expiry", "disconnect"] as const) {
    const f = await fixture({ modelRecovery: true, realModelBook: true }); try {
      await f.pair();
      f.onModelRead(() => { if (mode === "expiry") f.setTime(OPERATOR_SESSION_TTL_MS); else f.dropResponse(); });
      if (mode === "disconnect") await assert.rejects(f.call("model-recovery", { body: f.modelWire }));
      else { const result = await f.call("model-recovery", { body: f.modelWire });
        assert.equal(result.status, 401); assert.equal(result.json["inventory"], undefined); }
      assert.equal(f.modelReads(), 1);
      assert.equal(f.realModelBook!.snapshot().allocatedMicrounits, 0);
    } finally { await f.close(); }
  }
});

test("model recovery HTTP denies ambiguous wire and book substitution before a real read", async () => {
  for (const decorate of [
    (wire: string): string | Buffer => Buffer.from([0xff]),
    (wire: string): string | Buffer => "\ufeff" + wire,
    (wire: string): string | Buffer => wire.replace('"action":"read"', '"action":"read","action":"read"'),
    (wire: string): string | Buffer => canonicalJson({ ...JSON.parse(wire), budgetDigest: "sha256:" + "f".repeat(64) }),
    (wire: string): string | Buffer => canonicalJson({ ...JSON.parse(wire), action: "retry" }),
  ]) {
    const f = await fixture({ modelRecovery: true, realModelBook: true }); try {
      await f.pair();
      assert.equal((await f.call("model-recovery", { body: decorate(f.modelWire) })).status, 400);
      assert.equal(f.modelReads(), 0);
    } finally { await f.close(); }
  }
});

test("model recovery logout revokes reads without refreshing quota or repeating pairing", async () => {
  const f = await fixture({ modelRecovery: true, realModelBook: true }); try {
    await f.pair();
    assert.equal((await f.call("model-recovery", { body: f.modelWire })).status, 200);
    assert.equal((await f.call("logout")).status, 200);
    assert.equal((await f.call("model-recovery", { body: f.modelWire })).status, 401);
    assert.equal((await f.call("pair", { body: canonicalJson({ bootstrapSecret: f.pairing.bootstrapSecret }) })).status, 401);
    assert.equal(f.modelReads(), 1);
  } finally { await f.close(); }
});

test("model recovery upload expiry revocation and cancellation deny before book access", async () => {
  for (const mode of ["expire", "revoke", "abort"] as const) {
    const f = await fixture({ modelRecovery: true, realModelBook: true }); try {
      await f.pair();
      const arrived = once(f.server, "request");
      const pending = f.start("model-recovery", { body: f.modelWire.slice(0, 1), hold: true,
        headers: { "content-length": String(Buffer.byteLength(f.modelWire)) } });
      const [incoming] = await arrived as [IncomingMessage, ServerResponse];
      if (mode === "abort") {
        const rejected = assert.rejects(pending.result), aborted = once(incoming, "aborted");
        pending.request.destroy(); await aborted; await rejected;
        // Cancellation consumed the transport slot but did not read the book.
        assert.equal((await f.call("model-recovery", { body: f.modelWire })).status, 200);
        assert.equal((await f.call("model-recovery", { body: f.modelWire })).status, 429);
        assert.equal(f.modelReads(), 1);
      } else {
        if (mode === "expire") f.setTime(OPERATOR_SESSION_TTL_MS); else f.pairing.session.revoke();
        pending.request.end(f.modelWire.slice(1));
        const reply = await pending.result;
        assert.equal(reply.status, 401); assert.equal(reply.json["inventory"], undefined);
        assert.equal(f.modelReads(), 0);
      }
      assert.equal(f.realModelBook!.snapshot().allocatedMicrounits, 0);
    } finally { await f.close(); }
  }
});

test("model recovery incomplete uploads time out and cannot bypass the sliding read quota", { timeout: 10_000 }, async () => {
  const f = await fixture({ modelRecovery: true, realModelBook: true });
  const pending: ReturnType<typeof f.start>[] = [];
  try {
    await f.pair();
    for (let index = 0; index < 2; index++) {
      const arrived = once(f.server, "request");
      pending.push(f.start("model-recovery", { body: "{", hold: true, headers: { "content-length": "2" } }));
      await arrived;
    }
    assert.equal((await f.call("model-recovery", { body: f.modelWire })).status, 429);
    assert.deepEqual((await Promise.all(pending.map(item => item.result))).map(reply => reply.status), [408, 408]);
    assert.equal(f.modelReads(), 0);
    f.setTime(60_000);
    assert.equal((await f.call("model-recovery", { body: f.modelWire })).status, 200);
    assert.equal(f.modelReads(), 1);
  } finally { for (const item of pending) item.request.destroy(); await f.close(); }
});

test("task preview requires explicit bootstrap and newly acknowledged pairing scope",async()=>{
  for(const mode of [{},{taskPreview:true as const,prepaired:true},{taskPreview:true as const}]){
    const f=await fixture(mode);try{
      const reply=await f.call("task-preview");assert.equal(reply.status,mode.taskPreview?401:404);
      if(!mode.prepaired){const paired=await f.pair();assert.equal(paired.json["scope"],mode.taskPreview?"operator-settings-and-task-preview":"operator-settings-only");}
      assert.equal((await f.call("task-preview")).status,!mode.taskPreview?404:mode.prepaired?401:400);
    }finally{await f.close();}
  }
});

test("task preview computes complete supplied-text result with no store or recovery mutation",async()=>{
  const f=await fixture({recovery:true,taskPreview:true});try{
    const wire=canonicalJson(createOperatorTaskPreviewFixture());
    const before=[f.database.serialize(),f.recoveryDb!.serialize()];
    assert.equal((await f.pair()).json["scope"],"operator-settings-recovery-read-and-task-preview");
    const reply=await f.call("task-preview",{body:wire});assert.equal(reply.status,200);
    assert.deepEqual(reply.json,createWindowsOperatorTaskPreview(wire));
    assert.equal(reply.headers["cache-control"],"no-store");
    assert.deepEqual([f.database.serialize(),f.recoveryDb!.serialize()],before);
    assert.equal((await f.call("capacity")).status,200);
    assert.equal((await f.call("recovery")).status,200);
    assert.equal((await f.call("execute")).status,404);
  }finally{await f.close();}
});

test("task preview rejects origin and CSRF before reading a body and keeps other route limits",async()=>{
  const f=await fixture({taskPreview:true});try{
    await f.pair();
    assert.equal((await f.call("task-preview",{headers:{origin:"http://evil.invalid","content-length":"4194305"}})).status,403);
    assert.equal((await f.call("task-preview",{headers:{"x-onoes-csrf":"wrong","content-length":"4194305"}})).status,401);
    assert.equal((await f.call("task-preview",{headers:{"content-length":"4194305"}})).status,413);
    assert.equal((await f.call("read",{headers:{"content-length":"1025"}})).status,413);
    assert.equal((await f.call("update",{headers:{"content-length":"600001"}})).status,413);
  }finally{await f.close();}
});

test("task preview counts malformed attempts, redacts denials and has a separate fixed rate window",async()=>{
  const f=await fixture({taskPreview:true});try{
    await f.pair();
    const malformed=await f.call("task-preview",{body:canonicalJson({privateMarker:"not-echoed"})});
    assert.deepEqual(malformed.json,{reason:"operator-task-preview-input-invalid"});assert.equal(malformed.status,400);
    assert.equal((await f.call("task-preview",{body:" {}"})).status,400);
    assert.equal((await f.call("task-preview")).status,429);
    assert.equal((await f.call("read")).status,200);
    f.setTime(60_000);
    const wire=canonicalJson(createOperatorTaskPreviewFixture());
    assert.equal((await f.call("task-preview",{body:wire})).status,200);
    await f.call("logout");assert.equal((await f.call("task-preview",{body:wire})).status,401);
  }finally{await f.close();}
});

test("task preview rechecks session after calculation and never sends an expired result",async()=>{
  const f=await fixture({taskPreview:true,expireOnThirdCheck:true});try{
    await f.pair();
    const result=await f.call("task-preview",{body:canonicalJson(createOperatorTaskPreviewFixture())});
    assert.equal(f.sessionChecks,3);assert.equal(result.status,401);assert.deepEqual(result.json,{reason:"operator-session-denied"});
  }finally{await f.close();}
});

test("task preview bounds injected request-stream fragments independently of byte length",async()=>{
  const f=await fixture({taskPreview:true});try{
    await f.pair();
    // Fault injection into the real IncomingMessage, not a claim that TCP emits
    // empty data chunks. The handler must bound retained entries even then.
    f.server.once("request",request=>{for(let index=0;index<4097;index++)request.emit("data",Buffer.alloc(0));});
    const held=f.start("task-preview",{hold:true});
    try{const reply=await held.result;assert.equal(reply.status,413);assert.deepEqual(reply.json,{reason:"operator-body-too-large"});}
    finally{held.request.destroy();}
  }finally{await f.close();}
});

function intakeRequest(f:Awaited<ReturnType<typeof fixture>>){
  f.store.update({requestId:randomUUID(),expectedBinding:f.store.snapshot().binding,
    rules:{allowedRoots:[{path:"D:\\Work",access:"read-write"}],deniedRoots:["C:\\"]}});
  return {schemaVersion:"agent-operator-task-intake-input/v1",expectedBinding:f.store.snapshot().binding,
    objective:"Correct the status label.",workspaceRoot:"D:\\Work",requestedReadFiles:["src/status.ts"],
    requestedWriteFiles:["src/status.ts"],acceptanceCriteria:["The corrected label appears."]};
}

const historyMode = { recovery: true, taskPreview: true, taskIntake: true, taskHistory: true } as const;
const planningMode = { ...historyMode, taskPlanning: true } as const;
const guidedMode = { ...planningMode, taskProposal: true, workPlan: true } as const;
const planningTest = process.platform === "win32" ? test : test.skip;
function planningInspect(f: Awaited<ReturnType<typeof fixture>>, withHandoff = false) {
  f.store.update({ requestId: randomUUID(), expectedBinding: f.store.snapshot().binding,
    rules: { allowedRoots: [{ path: "D:\\Work", access: "read-write" }, { path: "D:\\Managed", access: "read-write" }], deniedRoots: ["C:\\"] } });
  const taskId = randomUUID(), event = f.tasks!.create(taskId, 1, canonicalJson({ schemaVersion: "agent-operator-task-intake-input/v1",
    expectedBinding: f.store.snapshot().binding, objective: "Correct label.", workspaceRoot: "D:\\Work",
    requestedReadFiles: withHandoff ? ["docs/handoff.md", "src/a.ts"] : ["src/a.ts"],
    requestedWriteFiles: withHandoff ? ["docs/handoff.md", "src/a.ts"] : ["src/a.ts"], acceptanceCriteria: ["Label correct."] }));
  return { action: "inspect", readManagedFiles: true, selector: { storeId: event.storeId, taskId, creationEpoch: 1, expectedRevision: 1 } };
}
interface PlanningIndex { inspectionHandle: string; inspectionDigest: string; briefDigest: string;
  files: { relativePath: string; contentDigest: string; byteLength: number }[] }
function contextRequest(f: Awaited<ReturnType<typeof fixture>>, reply: Reply) {
  const index = reply.json["value"] as PlanningIndex;
  return { action: "context", discloseSource: true, inspectionHandle: index.inspectionHandle,
    selection: { schemaVersion: "agent-managed-planning-context-input/v1", briefDigest: index.briefDigest, inspectionDigest: index.inspectionDigest,
      verificationId: "fixture-check", catalogDigest: f.verification.catalogDigest, definitionDigest: f.verification.definitionDigest,
      files: index.files.map(file => ({ relativePath: file.relativePath, contentDigest: file.contentDigest, startByte: 0, endByte: file.byteLength })), ruleFilePins: [] } };
}

const guidedChoices = { handoffPath: "docs/handoff.md", maxFileBytes: 1024, maxTotalBytes: 4096,
  maxPatchOperations: 1, maxContextBytes: 262144, lifetimeMs: 60000, maxTargetedFixPasses: 2, knownRiskCodes: ["fixture-only"] };
async function guidedPreparation(f: Awaited<ReturnType<typeof fixture>>, inspect = planningInspect(f, true)) {
  const described = await f.call("task-planning", { body: canonicalJson({ action: "plan-description", selector: inspect.selector, readPlanMetadata: true }) });
  assert.equal(described.status, 200, described.text);
  const description = described.json["value"] as Record<string, unknown>;
  const request = { action: "prepare-plan", plan: { schemaVersion: "agent-managed-work-plan-input/v1", selector: inspect.selector,
    expectedDescriptionDigest: description["descriptionDigest"], choices: guidedChoices, confirmDescriptionOnly: true } };
  const prepared = await f.call("task-planning", { body: canonicalJson(request) });
  assert.equal(prepared.status, 200, prepared.text);
  return { inspect, request, description, plan: prepared.json["value"] as Record<string, unknown> };
}
async function guidedProposalRequest(f: Awaited<ReturnType<typeof fixture>>, prepared: Awaited<ReturnType<typeof guidedPreparation>>) {
  const inspected = await f.call("task-planning", { body: canonicalJson(prepared.inspect) }); assert.equal(inspected.status, 200, inspected.text);
  const request = contextRequest(f, inspected), index = inspected.json["value"] as PlanningIndex;
  const context = await f.call("task-planning", { body: canonicalJson(request) }); assert.equal(context.status, 200, context.text);
  return { ...request, action: "guided-proposal", workPlanDigest: prepared.plan["workPlanDigest"],
    edit: { schemaVersion: "agent-managed-edit-candidate-input/v1", contextDigest: (context.json["value"] as Record<string, unknown>)["contextDigest"],
      inspectionDigest: index.inspectionDigest, summary: "Correct label.", patches: [{ relativePath: "src/a.ts",
        expectedPreimageDigest: index.files.find(file => file.relativePath === "src/a.ts")!.contentDigest,
        operations: [{ operation: "replace-exact", before: "private-source-sentinel", after: "new", expectedOccurrences: 1 }] }] } };
}

planningTest("guided planning requires host opt-in and a fresh distinctly named pairing", async () => {
  for (const mode of [planningMode, { ...guidedMode, prepaired: true }, guidedMode]) {
    const f = await fixture(mode); try {
      const inspect = planningInspect(f, true);
      if (!("prepaired" in mode)) assert.equal((await f.pair()).json["scope"], "workPlan" in mode
        ? "operator-settings-draft-history-and-guided-source-planning" : "operator-settings-draft-history-and-managed-source-planning");
      const reply = await f.call("task-planning", { body: canonicalJson({ action: "plan-description", selector: inspect.selector, readPlanMetadata: true }) });
      assert.equal(reply.status, !("workPlan" in mode) ? 403 : "prepaired" in mode ? 401 : 200);
      assert.deepEqual(f.planningStats(), { opens: 0, reads: 0, closes: 0 });
    } finally { await f.close(); }
  }
});

planningTest("guided HTTP flow prepares without source then composes exact proposal without durable mutation", async () => {
  const f = await fixture(guidedMode); try {
    const inspect = planningInspect(f, true); await f.pair();
    const before = [f.database.serialize(), f.taskDb!.serialize(), f.recoveryDb!.serialize()];
    const prepared = await guidedPreparation(f, inspect);
    assert.equal(prepared.plan["liveFilesRead"], false); assert.equal(prepared.plan["persisted"], false);
    assert.deepEqual(f.planningStats(), { opens: 0, reads: 0, closes: 0 });
    assert.ok(!JSON.stringify(prepared).includes("private-source-sentinel"));
    const request = await guidedProposalRequest(f, prepared);
    const reply = await f.call("task-planning", { body: canonicalJson(request) }); assert.equal(reply.status, 200, reply.text);
    assert.equal(reply.json["requestDigest"], canonicalSha256Digest(request));
    const value = reply.json["value"] as { draftProposalDigest: string; selector: unknown;
      workProposal: { task: { taskId: string; sessionId: string; commands: unknown; expiresAt: string }; plan: { patches: unknown };
        handoff: { written: boolean }; reviewCompleted: boolean } };
    const { draftProposalDigest, ...core } = value;
    assert.equal(draftProposalDigest, canonicalSha256Digest(core)); assert.deepEqual(value.selector, inspect.selector);
    assert.equal(value.workProposal.task.taskId, inspect.selector.taskId);
    assert.equal(value.workProposal.task.sessionId, prepared.plan["sessionId"]);
    assert.equal(value.workProposal.task.expiresAt, prepared.plan["expiresAt"]);
    assert.deepEqual(value.workProposal.task.commands, [f.command]); assert.deepEqual(value.workProposal.plan.patches, request.edit.patches);
    assert.equal(value.workProposal.handoff.written, false); assert.equal(value.workProposal.reviewCompleted, false);
    for (const flag of ["persisted", "providerInvoked", "approvalAvailable", "executionEnabled"]) assert.equal(reply.json[flag], false);
    assert.ok(reply.text.includes("fixture-runner.mjs")); assert.ok(reply.text.includes("fixture-host-builder"));
    assert.deepEqual([f.database.serialize(), f.taskDb!.serialize(), f.recoveryDb!.serialize()], before);
    assert.deepEqual(f.planningStats(), { opens: 1, reads: 4, closes: 1 });
    assert.equal((await f.call("task-planning", { body: '{"action":"discard-plan"}' })).status, 200);
    assert.equal((await f.call("task-planning", { body: canonicalJson(request) })).status, 409);
    assert.equal((await f.call("execute")).status, 404);
  } finally { await f.close(); }
});

planningTest("guided description consent and plan schema reject command smuggling and oversized choices without source", async () => {
  for (const mutation of ["consent", "extra-command", "missing-choice", "oversize", "wrong-description"] as const) {
    const f = await fixture(guidedMode); try {
      await f.pair(); const prepared = await guidedPreparation(f);
      const changed = structuredClone(prepared.request) as { action: string; plan: Record<string, unknown> };
      if (mutation === "consent") changed.plan["confirmDescriptionOnly"] = false;
      if (mutation === "extra-command") changed.plan["command"] = { executable: "cmd" };
      if (mutation === "missing-choice") delete (changed.plan["choices"] as Record<string, unknown>)["lifetimeMs"];
      if (mutation === "oversize") (changed.plan["choices"] as Record<string, unknown>)["knownRiskCodes"] = Array.from({ length: 64 }, (_, i) => `${i}-${"x".repeat(120)}`);
      if (mutation === "wrong-description") changed.plan["expectedDescriptionDigest"] = `sha256:${"0".repeat(64)}`;
      const reply = await f.call("task-planning", { body: canonicalJson(changed) });
      assert.equal(reply.status, mutation === "wrong-description" ? 409 : 400, reply.text);
      assert.ok(!reply.text.includes("fixture-runner.mjs"));
      const deniedConsent = await f.call("task-planning", { body: canonicalJson({ action: "plan-description", selector: prepared.inspect.selector, readPlanMetadata: false }) });
      assert.equal(deniedConsent.status, 400);
      assert.deepEqual(f.planningStats(), { opens: 0, reads: 0, closes: 0 });
    } finally { await f.close(); }
  }
});

planningTest("guided proposals deny expiry, changed policy, closed draft and incorrect plan identity", async () => {
  for (const mutation of ["expired", "policy", "closed", "digest", "discarded", "invalid-replacement"] as const) {
    const f = await fixture(guidedMode); try {
      await f.pair(); const prepared = await guidedPreparation(f), request = await guidedProposalRequest(f, prepared);
      if (mutation === "expired") f.setPlanTime("2026-09-09T00:01:00.000Z");
      if (mutation === "policy") f.store.update({ requestId: randomUUID(), expectedBinding: f.store.snapshot().binding,
        rules: { allowedRoots: [], deniedRoots: ["C:\\"] } });
      if (mutation === "closed") f.tasks!.close(randomUUID(), prepared.inspect.selector.taskId, 1, 1);
      if (mutation === "digest") request.workPlanDigest = `sha256:${"0".repeat(64)}`;
      if (mutation === "discarded") assert.equal((await f.call("task-planning", { body: '{"action":"discard-plan"}' })).status, 200);
      if (mutation === "invalid-replacement") assert.equal((await f.call("task-planning", { body: '{"action":"prepare-plan","plan":{}}' })).status, 400);
      const before = [f.database.serialize(), f.taskDb!.serialize(), f.recoveryDb!.serialize()];
      const reply = await f.call("task-planning", { body: canonicalJson(request) });
      assert.ok(reply.status === 409 || reply.status === 503, `${mutation}: ${reply.text}`);
      assert.equal(reply.json["executionEnabled"], false); assert.ok(!reply.text.includes("private-source-sentinel"));
      assert.deepEqual([f.database.serialize(), f.taskDb!.serialize(), f.recoveryDb!.serialize()], before);
    } finally { await f.close(); }
  }
});

planningTest("guided preparation authentication precedes body and metadata cannot bypass planning rate limit", async () => {
  const f = await fixture(guidedMode); try {
    const inspect = planningInspect(f, true);
    const held = f.start("task-planning", { hold: true, headers: { "content-length": "5000000" } });
    try { assert.equal((await held.result).status, 401); } finally { held.request.destroy(); }
    await f.pair();
    const body = canonicalJson({ action: "plan-description", selector: inspect.selector, readPlanMetadata: true });
    for (let i = 0; i < OPERATOR_TASK_PLANNING_LIMITS.attemptsPerMinute; i++) assert.equal((await f.call("task-planning", { body })).status, 200);
    assert.equal((await f.call("task-planning", { body })).status, 429);
    assert.deepEqual(f.planningStats(), { opens: 0, reads: 0, closes: 0 });
  } finally { await f.close(); }
});

planningTest("a disconnected guided inspection drops its prepared plan even when fresh source can be read", async () => {
  const f = await fixture(guidedMode); let release!: () => void;
  try {
    await f.pair(); const prepared = await guidedPreparation(f);
    let entered!: () => void, closed!: () => void;
    const started = new Promise<void>(r => { entered = r; }), stopped = new Promise<void>(r => { closed = r; });
    const held = new Promise<void>(r => { release = r; }); f.onPlanningRead(async () => { entered(); await held; }); f.onPlanningClose(closed);
    const pending = f.start("task-planning", { body: canonicalJson(prepared.inspect) }); const rejected = assert.rejects(pending.result);
    await started; f.dropResponse(); await rejected; release(); await stopped; f.onPlanningRead(async () => {});
    const request = await guidedProposalRequest(f, prepared);
    const reply = await f.call("task-planning", { body: canonicalJson(request) });
    assert.equal(reply.status, 503); assert.equal(reply.json["reason"], "operator-task-planning-unavailable");
    assert.ok(!reply.text.includes("private-source-sentinel")); assert.equal(f.planningStats().closes, 2);
  } finally { release?.(); await f.close(); }
});

planningTest("prepared plan lifetime does not extend HTTP inspection reuse and forged discard cannot clear it", async () => {
  const f = await fixture(guidedMode); try {
    await f.pair(); const prepared = await guidedPreparation(f), request = await guidedProposalRequest(f, prepared);
    assert.equal((await f.call("task-planning", { body: '{"action":"discard-plan"}', headers: { "x-onoes-csrf": "invalid" } })).status, 401);
    assert.equal((await f.call("task-planning", { body: canonicalJson(request) })).status, 200);
    // Hold the independently configured wall clock unchanged: this denial must
    // come from the inspection's monotonic age, not the plan's wall expiry.
    f.setTime(60000);
    const expired = await f.call("task-planning", { body: canonicalJson(request) });
    assert.equal(expired.status, 409); assert.equal(expired.json["reason"], "operator-task-planning-inspection-expired");
    assert.equal((await f.call("logout")).status, 200);
    assert.equal((await f.call("task-planning", { body: canonicalJson(prepared.request) })).status, 401);
  } finally { await f.close(); }
});

planningTest("managed source planning is absent by default and requires newly named pairing scope", async () => {
  for (const mode of [historyMode, { ...planningMode, prepaired: true }, planningMode]) {
    const f = await fixture(mode); try {
      if (!("prepaired" in mode)) {
        const paired = await f.pair();
        assert.equal(paired.json["scope"], "taskPlanning" in mode ? "operator-settings-draft-history-and-managed-source-planning"
          : "operator-settings-recovery-read-task-intake-preview-and-draft-history");
      }
      assert.equal((await f.call("task-planning")).status, !("taskPlanning" in mode) ? 404 : "prepaired" in mode ? 401 : 400);
      assert.equal(f.planningStats().opens, 0);
    } finally { await f.close(); }
  }
});

planningTest("inspection discloses metadata only; source excerpts and edits require explicit consent", async () => {
  const f = await fixture(planningMode); try {
    const inspect = planningInspect(f); await f.pair(); const before = [f.database.serialize(), f.taskDb!.serialize(), f.recoveryDb!.serialize()];
    const reply = await f.call("task-planning", { body: canonicalJson(inspect) }); assert.equal(reply.status, 200);
    assert.ok(!reply.text.includes("private-source-sentinel")); assert.equal((reply.json["value"] as Record<string, unknown>)["sourceTextIncluded"], false);
    assert.equal(reply.json["requestDigest"], canonicalSha256Digest(inspect)); assert.equal(reply.headers["cache-control"], "no-store");
    const request = contextRequest(f, reply);
    assert.equal((await f.call("task-planning", { body: canonicalJson({ ...request, discloseSource: false }) })).status, 400);
    const context = await f.call("task-planning", { body: canonicalJson(request) }); assert.equal(context.status, 200);
    assert.ok(context.text.includes("private-source-sentinel"));
    const value = context.json["value"] as { contextDigest: string }, index = reply.json["value"] as PlanningIndex;
    const edit = { schemaVersion: "agent-managed-edit-candidate-input/v1", contextDigest: value.contextDigest,
      inspectionDigest: index.inspectionDigest, summary: "Correct label.", patches: [{ relativePath: "src/a.ts",
        expectedPreimageDigest: index.files[0]!.contentDigest, operations: [{ operation: "replace-exact", before: "private-source-sentinel", after: "new", expectedOccurrences: 1 }] }] };
    const edits = await f.call("task-planning", { body: canonicalJson({ ...request, action: "edits", edit }) });
    assert.equal(edits.status, 200); assert.equal(edits.json["executionEnabled"], false); assert.equal(edits.json["persisted"], false);
    assert.deepEqual(f.planningStats(), { opens: 1, reads: 2, closes: 1 });
    assert.deepEqual([f.database.serialize(), f.taskDb!.serialize(), f.recoveryDb!.serialize()], before);
    assert.equal((await f.call("task-planning", { body: '{"action":"execute"}' })).status, 400);
    assert.equal((await f.call("execute")).status, 404);
  } finally { await f.close(); }
});

planningTest("source auth precedes body reads and canonical/body/consent errors never contact the adapter", async () => {
  const f = await fixture(planningMode); try {
    const inspect = planningInspect(f); await f.pair(); const tooLarge = String(OPERATOR_TASK_PLANNING_LIMITS.bodyBytes + 1);
    assert.equal((await f.call("task-planning", { headers: { origin: "http://evil.invalid", "content-length": tooLarge } })).status, 403);
    assert.equal((await f.call("task-planning", { headers: { "x-onoes-csrf": "bad", "content-length": tooLarge } })).status, 401);
    assert.equal((await f.call("task-planning", { headers: { "content-length": tooLarge } })).status, 413);
    for (const body of [canonicalJson(inspect) + "\n", canonicalJson({ ...inspect, readManagedFiles: false }),
      canonicalJson({ ...inspect, credential: "not-echoed" }), '{"action":"inspect","action":"discard"}']) {
      const reply = await f.call("task-planning", { body }); assert.equal(reply.status, 400); assert.ok(!reply.text.includes("not-echoed"));
    }
    assert.equal(f.planningStats().opens, 0);
  } finally { await f.close(); }
});

planningTest("inspection and malformed planning attempts have independent bounded rate budgets", async () => {
  const f = await fixture(planningMode); try {
    const inspect = planningInspect(f); await f.pair();
    for (let n = 0; n < 2; n++) assert.equal((await f.call("task-planning", { body: canonicalJson(inspect) })).status, 200);
    assert.equal((await f.call("task-planning", { body: canonicalJson(inspect) })).status, 429);
    for (let n = 3; n < OPERATOR_TASK_PLANNING_LIMITS.attemptsPerMinute; n++) assert.equal((await f.call("task-planning")).status, 400);
    assert.equal((await f.call("task-planning")).status, 429); assert.equal(f.planningStats().opens, 2);
    assert.equal((await f.call("read")).status, 200);
    f.setTime(60000); assert.equal((await f.call("task-planning", { body: canonicalJson(inspect) })).status, 200);
  } finally { await f.close(); }
});

planningTest("session expiry during inspection suppresses all source and metadata disclosure", async () => {
  const f = await fixture(planningMode); try {
    const inspect = planningInspect(f); await f.pair(); f.onPlanningRead(async () => { f.setTime(OPERATOR_SESSION_TTL_MS); });
    const reply = await f.call("task-planning", { body: canonicalJson(inspect) }); assert.equal(reply.status, 401);
    assert.deepEqual(reply.json, { reason: "operator-session-denied", executionEnabled: false, persisted: false });
    assert.ok(!reply.text.includes("src/a.ts")); assert.equal(f.planningStats().closes, 1);
  } finally { await f.close(); }
});

planningTest("disconnect cancels the in-flight inspection and closes simulated custody before reuse", async () => {
  const f = await fixture(planningMode); let release!: () => void;
  try {
    const inspect = planningInspect(f); await f.pair();
    let entered!: () => void, closed!: () => void;
    const started = new Promise<void>(r => { entered = r; }), stopped = new Promise<void>(r => { closed = r; });
    const held = new Promise<void>(r => { release = r; }); f.onPlanningRead(async () => { entered(); await held; }); f.onPlanningClose(closed);
    const pending = f.start("task-planning", { body: canonicalJson(inspect) }); const rejected = assert.rejects(pending.result);
    await started; f.dropResponse(); await rejected; release(); await stopped;
    f.onPlanningRead(async () => {});
    const next = await f.call("task-planning", { body: canonicalJson(inspect) }); assert.equal(next.status, 200);
    assert.equal(f.planningStats().closes, 2);
  } finally { release?.(); await f.close(); }
});

planningTest("discard invalidates retained handles without making a process-stop claim", async () => {
  const f = await fixture(planningMode); try {
    const inspect = planningInspect(f); await f.pair(); const reply = await f.call("task-planning", { body: canonicalJson(inspect) });
    const discarded = await f.call("task-planning", { body: '{"action":"discard"}' });
    assert.equal(discarded.status, 200); assert.deepEqual(discarded.json["value"], { discarded: true, processStopConfirmed: false });
    const denied = await f.call("task-planning", { body: canonicalJson(contextRequest(f, reply)) });
    assert.equal(denied.status, 409); assert.ok(!denied.text.includes("private-source-sentinel"));
    await f.call("logout"); assert.equal((await f.call("task-planning", { body: canonicalJson(inspect) })).status, 401);
  } finally { await f.close(); }
});

planningTest("saved closure and policy revocation invalidate source reuse; unauthorized requests do not", async () => {
  for (const revoke of [true, false]) {
    const f = await fixture(planningMode); try {
      const inspect = planningInspect(f); await f.pair(); const reply = await f.call("task-planning", { body: canonicalJson(inspect) });
      const context = contextRequest(f, reply);
      assert.equal((await f.call("task-planning", { body: '{"action":"discard"}', headers: { "x-onoes-csrf": "bad" } })).status, 401);
      assert.equal((await f.call("task-planning", { body: canonicalJson(context) })).status, 200);
      if (revoke) f.store.update({ requestId: randomUUID(), expectedBinding: f.store.snapshot().binding, rules: { allowedRoots: [], deniedRoots: ["C:\\"] } });
      else f.tasks!.close(randomUUID(), inspect.selector.taskId, 1, 1);
      const denied = await f.call("task-planning", { body: canonicalJson(context) });
      assert.equal(denied.status, revoke ? 503 : 409); assert.ok(!denied.text.includes("private-source-sentinel"));
    } finally { await f.close(); }
  }
});

planningTest("paired planning can return a complete draft-bound proposal only with explicit host command mapping", async () => {
  for (const configured of [true, false]) {
    const f = await fixture({ ...planningMode, ...(configured ? { taskProposal: true as const } : {}) });
    try {
      const inspect = planningInspect(f, true); await f.pair(); const before = [f.database.serialize(), f.taskDb!.serialize(), f.recoveryDb!.serialize()];
      const indexReply = await f.call("task-planning", { body: canonicalJson(inspect) }); assert.equal(indexReply.status, 200);
      const index = indexReply.json["value"] as PlanningIndex, contextInput = contextRequest(f, indexReply);
      const contextReply = await f.call("task-planning", { body: canonicalJson(contextInput) }); assert.equal(contextReply.status, 200);
      const context = contextReply.json["value"] as { contextDigest: string };
      const edit = { schemaVersion: "agent-managed-edit-candidate-input/v1", contextDigest: context.contextDigest,
        inspectionDigest: index.inspectionDigest, summary: "Correct label.", patches: [{ relativePath: "src/a.ts",
          expectedPreimageDigest: index.files.find(file => file.relativePath === "src/a.ts")!.contentDigest,
          operations: [{ operation: "replace-exact", before: "private-source-sentinel", after: "new", expectedOccurrences: 1 }] }] };
      const editsReply = await f.call("task-planning", { body: canonicalJson({ ...contextInput, action: "edits", edit }) }); assert.equal(editsReply.status, 200);
      const edits = editsReply.json["value"] as { candidateDigest: string };
      const paths = ["docs/handoff.md", "src/a.ts"], now = "2026-09-09T00:00:00.000Z", expiry = "2026-09-09T00:01:00.000Z";
      const scope = { contractVersion: BUILDER_CONTRACT_VERSION, taskId: inspect.selector.taskId, sessionId: "fixture-session", profileId: "builder",
        repositoryRoot: "D:\\Work", worktreeRoot: "D:\\Managed", worktreeAttestationDigest: `sha256:${"2".padStart(64, "0")}`,
        allowedReadFiles: [...paths], allowedWriteFiles: [...paths], allowedVerificationIds: ["fixture-check"],
        maxFiles: 2, maxFileBytes: 1024, maxTotalBytes: 4096, maxPatchOperations: 1, issuedAt: now, expiresAt: expiry };
      const task = { schemaVersion: AGENT_WORK_TASK_SCHEMA_VERSION, taskId: scope.taskId, sessionId: scope.sessionId, profileId: "builder",
        builderScopeDigest: computeBuilderInspectionScopeDigest(scope), objective: "Correct label.", allowedReadFiles: [...paths], allowedWriteFiles: [...paths],
        expectedArtifactPaths: ["src/a.ts"], handoffPath: "docs/handoff.md", commands: [{ ...f.command, arguments: [...f.command.arguments] }],
        acceptanceCriteria: [{ criterionId: "correct", description: "Label correct.", verificationIds: ["fixture-check"], requiredEvidenceIds: ["test", "review", "verify", "file"] }],
        forbiddenActions: [...AGENT_FORBIDDEN_ACTIONS], evidenceRequirements: [
          { evidenceId: "test", kind: "test-receipt", artifactPath: null, readBackRequired: false },
          { evidenceId: "review", kind: "review-receipt", artifactPath: null, readBackRequired: false },
          { evidenceId: "verify", kind: "verification-receipt", artifactPath: null, readBackRequired: false },
          { evidenceId: "file", kind: "artifact-readback", artifactPath: "src/a.ts", readBackRequired: true }],
        stopConditions: { maxImplementationPasses: 1, maxTargetedFixPasses: 2, stopOnAcceptancePassed: true, stopOnBlocked: true, stopOnBudgetExhausted: true },
        ruleReferences: { scripts: [], modelIds: [], serviceNames: [], authorityClaims: ["none"] }, contextTags: ["managed"], maxContextBytes: 262144,
        createdAt: now, expiresAt: expiry, authority: "none" };
      const proposal = { schemaVersion: "agent-managed-work-proposal-input/v1", contextDigest: context.contextDigest, candidateDigest: edits.candidateDigest,
        task, scope, proposalId: "proposal-1", planId: "plan-1", builderActorId: "builder-1",
        iteration: { implementationPass: 1, targetedFixPass: 0 }, knownRiskCodes: [] };
      const reply = await f.call("task-planning", { body: canonicalJson({ ...contextInput, action: "proposal", edit, proposal }) });
      assert.equal(reply.status, configured ? 200 : 503);
      if (configured) {
        const value = reply.json["value"] as { selector: unknown; draftProposalDigest: string; workProposal: { taskDigest: string; plan: { patches: unknown } } };
        assert.deepEqual(value.selector, inspect.selector); assert.deepEqual(value.workProposal.plan.patches, edit.patches);
        const { draftProposalDigest, ...core } = value; assert.equal(draftProposalDigest, canonicalSha256Digest(core));
        assert.equal(reply.json["executionEnabled"], false); assert.equal(reply.json["providerInvoked"], false);
      } else assert.ok(!reply.text.includes("private-source-sentinel"));
      assert.deepEqual([f.database.serialize(), f.taskDb!.serialize(), f.recoveryDb!.serialize()], before);
      assert.deepEqual(f.planningStats(), { opens: 1, reads: 4, closes: 1 });
    } finally { await f.close(); }
  }
});

planningTest("authenticated logout cancels a held inspection instead of publishing its late result", async () => {
  const f = await fixture(planningMode); let release!: () => void;
  try {
    const inspect = planningInspect(f); await f.pair(); let entered!: () => void;
    const started = new Promise<void>(r => { entered = r; }), held = new Promise<void>(r => { release = r; });
    f.onPlanningRead(async () => { entered(); await held; });
    const pending = f.call("task-planning", { body: canonicalJson(inspect) }); await started;
    assert.equal((await f.call("logout")).status, 200); release();
    const reply = await pending; assert.notEqual(reply.status, 200); assert.ok(!reply.text.includes("private-source-sentinel"));
    assert.equal(f.planningStats().closes, 1);
  } finally { release?.(); await f.close(); }
});
function historyCreate(f: Awaited<ReturnType<typeof fixture>>) {
  const core = { action: "create", ...f.tasks!.readCreationEpoch(), requestId: randomUUID(), brief: intakeRequest(f) };
  return { ...core, expectedOperationDigest: computeOperatorTaskHistoryOperationDigest(core) };
}

test("draft history is absent by default and existing paired sessions cannot inherit its new scope", async () => {
  const ordinary = await fixture({ recovery: true, taskPreview: true, taskIntake: true });
  try { await ordinary.pair(); assert.equal((await ordinary.call("task-history")).status, 404); } finally { await ordinary.close(); }
  const old = await fixture({ ...historyMode, prepaired: true });
  try { assert.equal((await old.call("task-history", { body: '{"action":"index"}' })).status, 401); assert.deepEqual(old.tasks!.list(), []); }
  finally { await old.close(); }
  const fresh = await fixture(historyMode);
  try {
    const paired = await fresh.pair();
    assert.equal(paired.json["scope"], "operator-settings-recovery-read-task-intake-preview-and-draft-history");
    assert.equal((await fresh.call("task-history", { body: '{"action":"index"}' })).status, 200);
    await fresh.call("logout"); assert.equal((await fresh.call("task-history", { body: '{"action":"index"}' })).status, 401);
  } finally { await fresh.close(); }
});

test("paired draft create read close and original receipt retrieval never mutate approval/policy/recovery state", async () => {
  const f = await fixture(historyMode); try {
    const create = historyCreate(f), before = [f.database.serialize(), f.recoveryDb!.serialize()]; await f.pair();
    const call = (body: unknown) => f.call("task-history", { body: canonicalJson(body) });
    const created = await call(create); assert.equal(created.status, 200); assert.equal(created.headers["cache-control"], "no-store");
    assert.equal(created.json["requestDigest"], canonicalSha256Digest(create));
    assert.deepEqual(created.json["value"], f.tasks!.readOperation(create.requestId, create.expectedOperationDigest));
    assert.equal(created.json["executionEnabled"], false);
    const selector = { storeId: create.storeId, taskId: create.requestId, creationEpoch: create.creationEpoch };
    const read = await call({ action: "read", ...selector }); assert.equal(read.status, 200);
    assert.deepEqual(read.json["value"], f.tasks!.read(selector.taskId, selector.creationEpoch));
    const closeCore = { action: "close", ...selector, requestId: randomUUID(), expectedRevision: 1, briefDigest: canonicalSha256Digest(create.brief) };
    const closed = await call({ ...closeCore, expectedOperationDigest: computeOperatorTaskHistoryOperationDigest(closeCore) }); assert.equal(closed.status, 200);
    const receipt = await call({ action: "receipt", storeId: create.storeId, requestId: create.requestId, expectedOperationDigest: create.expectedOperationDigest });
    assert.equal(receipt.status, 200); assert.deepEqual(receipt.json["value"], created.json["value"]);
    assert.deepEqual((await call(create)).json, created.json);
    assert.deepEqual([f.database.serialize(), f.recoveryDb!.serialize()], before);
    assert.equal((await call({ action: "forget", ...selector })).status, 400);
    assert.equal((await call({ action: "record-candidate", candidateDigest: "source-sentinel" })).status, 400);
    assert.equal((await f.call("execute")).status, 404);
  } finally { await f.close(); }
});

test("history origin CSRF body and malformed-attempt budgets deny before touching draft state", async () => {
  const f = await fixture(historyMode); try {
    await f.pair(); const before = f.taskDb!.serialize();
    assert.equal((await f.call("task-history", { headers: { origin: "http://evil.invalid" } })).status, 403);
    assert.equal((await f.call("task-history", { headers: { "x-onoes-csrf": "bad" } })).status, 401);
    assert.equal((await f.call("task-history", { headers: { "content-length": String(OPERATOR_TASK_HISTORY_MAX_BODY_BYTES + 1) } })).status, 413);
    for (let i = 1; i < OPERATOR_TASK_HISTORY_RATE_LIMIT; i++) {
      const reply = await f.call("task-history", { body: i === 1 ? '\ufeff{"action":"index"}' : '{"action":"index","private":"source-sentinel"}' });
      assert.equal(reply.status, 400); assert.equal(reply.json["taskHistoryOutcome"], "not-started"); assert.ok(!reply.text.includes("source-sentinel"));
    }
    assert.equal((await f.call("task-history", { body: '{"action":"index"}' })).status, 429);
    assert.deepEqual(f.taskDb!.serialize(), before); assert.equal((await f.call("read")).status, 200);
    f.setTime(60_000); assert.equal((await f.call("task-history", { body: '{"action":"index"}' })).status, 200);
  } finally { await f.close(); }
});

test("session expiry after a draft commit withholds disclosure without claiming the write did not happen", async () => {
  const f = await fixture({ ...historyMode, expireOnThirdCheck: true }); try {
    const create = historyCreate(f); await f.pair();
    const reply = await f.call("task-history", { body: canonicalJson(create) });
    assert.equal(reply.status, 401); assert.deepEqual(reply.json, { reason: "operator-session-denied", taskHistoryOutcome: "unknown" });
    assert.equal(f.tasks!.readOperation(create.requestId, create.expectedOperationDigest).revision, 1);
    assert.ok(!reply.text.includes(create.brief.objective));
  } finally { await f.close(); }
});

test("response loss after real draft commit is recovered with exactly the original request", async t => {
  const f = await fixture(historyMode); try {
    const create = historyCreate(f); await f.pair();
    const original = f.tasks!.create.bind(f.tasks!);
    const mock = t.mock.method(f.tasks!, "create", (...args: Parameters<typeof original>) => { const result = original(...args); f.dropResponse(); return result; });
    await assert.rejects(f.call("task-history", { body: canonicalJson(create) })); mock.mock.restore();
    assert.equal(f.tasks!.list().length, 1);
    const retry = await f.call("task-history", { body: canonicalJson(create) }); assert.equal(retry.status, 200);
    assert.deepEqual(retry.json["value"], f.tasks!.readOperation(create.requestId, create.expectedOperationDigest));
    assert.equal(f.tasks!.read(create.requestId, create.creationEpoch).revision, 1);
    const wrongStore = await f.call("task-history", { body: canonicalJson({ ...create, storeId: randomUUID() }) });
    assert.equal(wrongStore.status, 409); assert.equal(wrongStore.json["reason"], "operator-task-store-store-identity-mismatch");
    assert.equal(f.tasks!.list().length, 1);
  } finally { await f.close(); }
});

test("history post-commit exceptions are redacted and never interpreted as a safe automatic resubmit", async t => {
  const f = await fixture(historyMode); try {
    const create = historyCreate(f); await f.pair(); const original = f.tasks!.create.bind(f.tasks!);
    t.mock.method(f.tasks!, "create", (...args: Parameters<typeof original>) => { original(...args); throw new Error("private-source-sentinel"); });
    const reply = await f.call("task-history", { body: canonicalJson(create) });
    assert.equal(reply.status, 503); assert.deepEqual(reply.json, { reason: "operator-task-history-unavailable", taskHistoryOutcome: "unknown" });
    const receipt = await f.call("task-history", { body: canonicalJson({ action: "receipt", storeId: create.storeId,
      requestId: create.requestId, expectedOperationDigest: create.expectedOperationDigest }) });
    assert.equal(receipt.status, 200); assert.equal(f.tasks!.read(create.requestId, 1).revision, 1);
  } finally { await f.close(); }
});

test("task intake is absent from preview-only scope and denies an already paired session",async()=>{
  for(const mode of [{recovery:true,taskPreview:true as const},{recovery:true,taskPreview:true as const,taskIntake:true as const,prepaired:true}]){
    const f=await fixture(mode);try{
      if(!mode.prepaired)await f.pair();assert.equal((await f.call("task-intake")).status,mode.taskIntake?401:404);
    }finally{await f.close();}
  }
});

test("paired task intake checks real current policy without changing stores or creating a task",async()=>{
  const f=await fixture({recovery:true,taskPreview:true,taskIntake:true});try{
    const request=intakeRequest(f),wire=canonicalJson(request),before=[f.database.serialize(),f.recoveryDb!.serialize()];
    assert.equal((await f.call("task-intake",{body:wire})).status,401);
    assert.equal((await f.pair()).json["scope"],"operator-settings-recovery-read-task-intake-and-preview");
    const response=await f.call("task-intake",{body:wire});assert.equal(response.status,200);
    assert.deepEqual(response.json,createWindowsOperatorTaskIntake(wire,f.store.snapshot()));
    assert.deepEqual([f.database.serialize(),f.recoveryDb!.serialize()],before);assert.equal(response.headers["cache-control"],"no-store");
    assert.equal((await f.call("task-preview",{body:canonicalJson(createOperatorTaskPreviewFixture())})).status,200);
    assert.equal((await f.call("task-intake",{body:wire})).status,429);
    assert.equal((await f.call("read")).status,200);
  }finally{await f.close();}
});

test("intake rejects stale policy including drift after construction and never rebases the request",async()=>{
  for(const midRead of [false,true]){
    const f=await fixture({recovery:true,taskPreview:true,taskIntake:true});try{
      const request=intakeRequest(f);await f.pair();
      const change=()=>f.store.update({requestId:randomUUID(),expectedBinding:f.store.snapshot().binding,rules:{allowedRoots:[],deniedRoots:["C:\\","D:\\"]}});
      if(midRead){const original=f.store.assertCurrentBinding.bind(f.store);f.store.assertCurrentBinding=input=>{change();original(input);};}else change();
      const response=await f.call("task-intake",{body:canonicalJson(request)});assert.equal(response.status,409);
      assert.deepEqual(response.json,{reason:midRead?"operator-stale-policy":"operator-task-intake-stale-policy"});
      assert.equal(f.store.snapshot().binding.revision,3);
    }finally{await f.close();}
  }
});

test("intake origin, CSRF and body limits deny before private reads; post-calculation expiry denies result",async()=>{
  const f=await fixture({recovery:true,taskPreview:true,taskIntake:true,expireOnThirdCheck:true});try{
    const request=intakeRequest(f);await f.pair();
    assert.equal((await f.call("task-intake",{headers:{origin:"http://evil.invalid","content-length":"196609"}})).status,403);
    // The third successful session-check seam occurs on the actual request.
    const response=await f.call("task-intake",{body:canonicalJson(request)});assert.equal(response.status,401);
    assert.deepEqual(response.json,{reason:"operator-session-denied"});
  }finally{await f.close();}
  const bounded=await fixture({recovery:true,taskPreview:true,taskIntake:true});try{
    await bounded.pair();let reads=0;const original=bounded.store.snapshot.bind(bounded.store);bounded.store.snapshot=()=>{reads++;return original();};
    assert.equal((await bounded.call("task-intake",{headers:{"x-onoes-csrf":"wrong"}})).status,401);
    assert.equal((await bounded.call("task-intake",{headers:{"content-length":"196609"}})).status,413);assert.equal(reads,0);
  }finally{await bounded.close();}
});

function seedRecovery(f: Awaited<ReturnType<typeof fixture>>) {
  assert.ok(f.recovery);
  const digest = "sha256:" + "1".repeat(64);
  const journal = new WindowsBuilderEffectJournal(f.recovery, f.store);
  const start = journal.recordStart({ operationId: randomUUID(), taskDigest: digest, proposalDigest: digest,
    authorizationDigest: digest, workspaceDigest: digest, scopeDigest: digest, policyBinding: f.store.snapshot().binding },
    [{ relativePath: "private-fixture.txt", bytes: Buffer.from("private fixture preimage") }]);
  f.recovery.recordTerminal({ operationId: start.operationId, requestDigest: start.requestDigest,
    outcome: "completed", evidenceDigest: digest });
  return journal;
}

test("capacity is opt-in recovery scope and never upgrades a settings-only paired session",async()=>{
  for(const mode of [{},{recovery:true,prepaired:true}]){
    const f=await fixture(mode);try{
      if(!mode.prepaired)await f.pair();
      assert.equal((await f.call("capacity")).status,mode.recovery?401:404);
    }finally{await f.close();}
  }
});

test("capacity returns real redacted quota observations, leaves stores unchanged and shares recovery rate cap",async()=>{
  const f=await fixture({recovery:true});try{
    seedRecovery(f);const before=[f.database.serialize(),f.recoveryDb!.serialize()];
    assert.equal((await f.call("capacity")).status,401);await f.pair();
    const reply=await f.call("capacity");assert.equal(reply.status,200);
    assert.deepEqual(reply.json,{capacity:{schemaVersion:"agent-operator-capacity/v1",
      kind:"separate-store-quota-observations-not-admission",recovery:f.recovery!.readCapacity(),policy:f.store.readCapacity(),
      retentionAvailable:false,diskSpaceMeasured:false},executionEnabled:false,recoveryActionsEnabled:false});
    assert.equal(reply.headers["cache-control"],"no-store");
    for(const value of ["private-fixture.txt","private fixture preimage","authorizationDigest",f.csrf,f.cookie.split("=")[1]!])
      assert.equal(reply.text.includes(value),false);
    assert.deepEqual([f.database.serialize(),f.recoveryDb!.serialize()],before);
    assert.equal((await f.call("recovery")).status,200);
    assert.equal((await f.call("capacity")).status,429);
    assert.equal((await f.call("read")).status,200);
    f.setTime(60_000);assert.equal((await f.call("capacity")).status,200);
  }finally{await f.close();}
});

test("capacity rejects origin, CSRF, mutation requests and expired session before reading quota",async()=>{
  const f=await fixture({recovery:true});let reads=0;try{
    await f.pair();const read=f.recovery!.readCapacity.bind(f.recovery);
    f.recovery!.readCapacity=()=>{reads++;return read();};
    assert.equal((await f.call("capacity",{headers:{origin:"http://evil.invalid"}})).status,403);
    assert.equal((await f.call("capacity",{headers:{"x-onoes-csrf":undefined}})).status,401);
    assert.equal((await f.call("capacity",{method:"GET"})).status,405);
    assert.equal((await f.call("capacity",{body:'{"prune":true}'})).status,400);
    assert.equal((await f.call("capacity",{path:"/operator/settings/capacity?clear=true"})).status,404);
    f.setTime(OPERATOR_SESSION_TTL_MS);assert.equal((await f.call("capacity")).status,401);assert.equal(reads,0);
  }finally{await f.close();}
});

for(const fault of ["storage","expiry"] as const)test(`capacity ${fault} after authentication returns no partial quota`,async()=>{
  const f=await fixture({recovery:true});try{
    await f.pair();const read=f.recovery!.readCapacity.bind(f.recovery);
    f.recovery!.readCapacity=()=>{if(fault==="storage")throw new Error("private-database-path");f.setTime(OPERATOR_SESSION_TTL_MS);return read();};
    const reply=await f.call("capacity");assert.equal(reply.status,fault==="storage"?503:401);
    assert.deepEqual(reply.json,{reason:fault==="storage"?"operator-recovery-unavailable":"operator-session-denied"});
  }finally{await f.close();}
});

test("recovery read is absent by default and cannot inherit a previously paired settings-only session", async () => {
  const legacy = await fixture(), prepaired = await fixture({ recovery: true, prepaired: true });
  try {
    assert.equal((await legacy.pair()).json["scope"], "operator-settings-only");
    assert.equal((await legacy.call("recovery")).status, 404);
    assert.equal((await prepaired.call("read")).status, 200);
    assert.equal((await prepaired.call("recovery")).status, 401);
    assert.equal((await prepaired.call("pair", { body: canonicalJson({ bootstrapSecret: prepaired.pairing.bootstrapSecret }) })).status, 401);
  } finally { await legacy.close(); await prepaired.close(); }
});

test("paired read-only recovery transport returns exact redacted inventory without settling its blocker", async () => {
  const f = await fixture({ recovery: true });
  try {
    const journal = seedRecovery(f), before = [f.database.serialize(), f.recoveryDb!.serialize()];
    assert.equal((await f.call("recovery")).status, 401);
    assert.equal((await f.pair()).json["scope"], "operator-settings-and-recovery-read");
    const reply = await f.call("recovery");
    assert.equal(reply.status, 200); assert.deepEqual(reply.json["inventory"], journal.inspectRecordedOperations());
    assert.equal(reply.json["executionEnabled"], false); assert.equal(reply.json["recoveryActionsEnabled"], false);
    assert.equal(reply.headers["cache-control"], "no-store"); assert.equal(reply.headers["cross-origin-resource-policy"], "same-origin");
    assert.equal(reply.headers["access-control-allow-origin"], undefined);
    assert.ok(Buffer.byteLength(reply.text) <= OPERATOR_RECOVERY_MAX_RESPONSE_BYTES);
    for (const text of ["private-fixture.txt", "private fixture preimage", "authorizationDigest", f.csrf, f.cookie.split("=")[1]!])
      assert.equal(reply.text.includes(text), false);
    assert.deepEqual([f.database.serialize(), f.recoveryDb!.serialize()], before);
    assert.throws(() => f.store.update({ requestId: randomUUID(), expectedBinding: f.store.snapshot().binding,
      rules: { allowedRoots: [], deniedRoots: [] } }));
    for (const route of ["recovery/resume", "recovery/clear", "recovery/settle", "execute"])
      assert.equal((await f.call(route)).status, 404);
  } finally { await f.close(); }
});

test("recovery origin, CSRF, method and exact empty-body checks precede any metadata read", async () => {
  const f = await fixture({ recovery: true }); let reads = 0;
  try {
    await f.pair(); const list = f.recovery!.listOperationIds.bind(f.recovery);
    f.recovery!.listOperationIds = () => { reads++; return list(); };
    for (const headers of [{ origin: undefined }, { origin: "http://evil.invalid" }, { host: "localhost:1" }, { "sec-fetch-site": "cross-site" }])
      assert.equal((await f.call("recovery", { headers })).status, 403);
    for (const headers of [{ cookie: undefined }, { "x-onoes-csrf": undefined }, { cookie: f.cookie + "; " + f.cookie }, { "x-onoes-csrf": "bad" }])
      assert.equal((await f.call("recovery", { headers })).status, 401);
    assert.equal((await f.call("recovery", { method: "GET" })).status, 405);
    assert.equal((await f.call("recovery", { path: "/operator/settings/recovery?operationId=x" })).status, 404);
    for (const body of ['{"operationId":"x"}', '{"action":"resume"}', ' { }', 'null', '[]', '{"a":1,"a":2}'])
      assert.equal((await f.call("recovery", { body })).status, 400);
    assert.equal((await f.call("recovery", { body: '"' + "x".repeat(1100) + '"' })).status, 413);
    assert.equal(reads, 0);
    f.recoveryDb!.exec("DROP TABLE builder_recovery_operations");
    assert.equal((await f.call("recovery", { headers: { cookie: undefined } })).status, 401);
    const unavailable = await f.call("recovery"); assert.equal(unavailable.status, 503);
    assert.deepEqual(unavailable.json, { reason: "operator-recovery-unavailable" });
  } finally { await f.close(); }
});

test("recovery reads have a separate fixed quota without blocking ordinary settings reads", async () => {
  const f = await fixture({ recovery: true }); let reads = 0;
  try {
    await f.pair(); const list = f.recovery!.listOperationIds.bind(f.recovery);
    f.recovery!.listOperationIds = () => { reads++; return list(); };
    for (let i = 0; i < OPERATOR_RECOVERY_READ_RATE_LIMIT; i++) assert.equal((await f.call("recovery")).status, 200);
    assert.equal(reads, 2 * OPERATOR_RECOVERY_READ_RATE_LIMIT);
    const denied = await f.call("recovery"); assert.equal(denied.status, 429);
    assert.equal(denied.json["reason"], "operator-recovery-rate-limited"); assert.equal(reads, 4);
    assert.equal((await f.call("read")).status, 200);
    f.setTime(60_000); assert.equal((await f.call("recovery")).status, 200); assert.equal(reads, 6);
    f.setTime(0); assert.equal((await f.call("recovery")).status, 503);
    f.setTime(120_000); assert.equal((await f.call("recovery")).status, 503); assert.equal(reads, 6);
  } finally { await f.close(); }
});

for (const at of ["body", "metadata"] as const) {
  test(`recovery session expiry during ${at} work cannot deliver private inventory`, async () => {
    const f = await fixture({ recovery: true }); let reads = 0;
    try {
      await f.pair(); const list = f.recovery!.listOperationIds.bind(f.recovery);
      f.recovery!.listOperationIds = () => { reads++; if (at === "metadata") f.setTime(OPERATOR_SESSION_TTL_MS); return list(); };
      if (at === "body") {
        const arrived = once(f.server, "request");
        const pending = f.start("recovery", { hold: true, body: "{", headers: { "content-length": "2" } });
        await arrived; f.setTime(OPERATOR_SESSION_TTL_MS); pending.request.end("}");
        assert.equal((await pending.result).status, 401); assert.equal(reads, 0);
      } else { const reply = await f.call("recovery"); assert.equal(reply.status, 401); assert.equal(reads, 2); assert.equal(reply.json["inventory"], undefined); }
    } finally { await f.close(); }
  });
}

for (const fault of ["changed", "storage", "oversized"] as const) {
  test(`recovery ${fault} reader fault returns only a bounded fixed denial`, async () => {
    const f = await fixture({ recovery: true });
    const inspect = WindowsBuilderEffectJournal.prototype.inspectRecordedOperations;
    try {
      await f.pair();
      WindowsBuilderEffectJournal.prototype.inspectRecordedOperations = function () {
        if (fault === "changed") throw new BuilderEffectJournalError("snapshot-changed");
        if (fault === "storage") throw new Error("private-sql-or-path-diagnostic");
        return { ...inspect.call(this), inventoryDigest: "x".repeat(OPERATOR_RECOVERY_MAX_RESPONSE_BYTES) };
      };
      const reply = await f.call("recovery"); assert.equal(reply.status, fault === "changed" ? 409 : 503);
      assert.ok(reply.text.length < 100); assert.equal(reply.json["inventory"], undefined);
      assert.deepEqual(reply.json, { reason: fault === "changed" ? "operator-recovery-changed" : "operator-recovery-unavailable" });
    } finally { WindowsBuilderEffectJournal.prototype.inspectRecordedOperations = inspect; await f.close(); }
  });
}

test("real loopback settings transport denies before pairing and keeps session tokens out of JSON", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call("read")).status, 401);
    const paired = await f.pair();
    assert.match(paired.headers["set-cookie"]?.[0] ?? "", /HttpOnly; SameSite=Strict; Max-Age=900$/);
    assert.equal(paired.headers["cache-control"], "no-store");
    assert.equal(paired.json["sessionToken"], undefined);
    assert.equal(paired.json["bootstrapSecret"], undefined);
    assert.equal(paired.text.includes(f.cookie.split("=")[1] ?? "missing"), false);
    const current = await f.call("read");
    assert.equal(current.status, 200);
    assert.deepEqual(current.json["current"], f.store.snapshot());
    assert.equal(current.json["executionEnabled"], false);
    assert.equal((await f.call("logout")).status, 200);
    assert.equal((await f.call("read")).status, 401);
  } finally { await f.close(); }
});

test("origin, session, CSRF, route and method checks precede private store access", async () => {
  const f = await fixture();
  try {
    await f.pair();
    for (const headers of [{ origin: undefined }, { origin: "http://evil.invalid" }, { host: "localhost:1" },
      { "sec-fetch-site": "cross-site" }, { origin: f.origin + "/" }]) {
      assert.equal((await f.call("read", { headers })).status, 403);
    }
    for (const headers of [{ cookie: undefined }, { "x-onoes-csrf": undefined }, { cookie: f.cookie + "; " + f.cookie },
      { "x-onoes-csrf": "bad" }]) assert.equal((await f.call("read", { headers })).status, 401);
    assert.equal((await f.call("read", { method: "GET" })).status, 405);
    assert.equal((await f.call("execute")).status, 404);
    assert.equal((await f.call("read", { path: "/operator/settings/read?extra=1" })).status, 404);
    // Destroying the store cannot turn unauthorized access into an existence oracle.
    f.database.exec("DROP TABLE workspace_policy_state");
    assert.equal((await f.call("read", { headers: { cookie: undefined } })).status, 401);
    const allowed = await f.call("read");
    assert.equal(allowed.status, 503);
    assert.equal(allowed.json["reason"], "operator-settings-unavailable");
    assert.equal(allowed.text.includes("workspace_policy_state"), false);
  } finally { await f.close(); }
});

test("strict bounded canonical request bodies reject ambiguity and malformed encodings", async () => {
  const f = await fixture();
  try {
    await f.pair();
    for (const body of [" {}", '{"a":1,"a":2}', '{"extra":true}', '"text"', "[]", "null",
      Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]), Buffer.from("\ufeff{}"),
      '{"key":"\\ud800"}', "[".repeat(66) + "0" + "]".repeat(66)]) {
      assert.equal((await f.call("read", { body })).status, 400);
    }
    assert.equal((await f.call("read", { headers: { "content-type": "text/plain" } })).status, 415);
    assert.equal((await f.call("read", { headers: { "content-encoding": "gzip" } })).status, 415);
    assert.equal((await f.call("update", { headers: { "content-length": String(OPERATOR_SETTINGS_MAX_BODY_BYTES + 1) } })).status, 413);
    assert.equal((await f.call("read", { body: '"' + "x".repeat(1_100) + '"', headers: { "transfer-encoding": "chunked" } })).status, 413);
    assert.equal(f.store.snapshot().binding.revision, 1);
  } finally { await f.close(); }
});

test("real HTTP edits retain CAS, retry receipts and actual current policy after a historical retry", async () => {
  const f = await fixture();
  try {
    await f.pair();
    const initial = f.store.snapshot().binding;
    const first = { requestId: randomUUID(), expectedBinding: initial,
      rules: { allowedRoots: [{ path: "D:\\Fixture", access: "read-write" }], deniedRoots: ["C:\\"] } };
    const saved = await f.call("update", { body: canonicalJson(first) });
    assert.equal(saved.status, 200);
    const second = { requestId: randomUUID(), expectedBinding: f.store.snapshot().binding,
      rules: { allowedRoots: [], deniedRoots: ["C:\\", "D:\\"] } };
    assert.equal((await f.call("update", { body: canonicalJson(second) })).status, 200);
    const retry = await f.call("update", { body: canonicalJson(first) });
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.json["receipt"], saved.json["receipt"]);
    assert.deepEqual(retry.json["current"], f.store.snapshot());
    assert.equal(f.store.snapshot().binding.revision, 3);
    assert.equal((await f.call("update", { body: canonicalJson({ ...first, requestId: randomUUID() }) })).status, 409);
    assert.equal((await f.call("update", { body: canonicalJson({ ...first, rules: second.rules }) })).status, 409);
    assert.equal((await f.call("update", { body: canonicalJson({ ...second, execute: true }) })).status, 400);
  } finally { await f.close(); }
});

test("a dropped HTTP response after commit recovers the same update rather than duplicating it", async () => {
  const f = await fixture();
  try {
    await f.pair();
    const request = { requestId: randomUUID(), expectedBinding: f.store.snapshot().binding,
      rules: { allowedRoots: [], deniedRoots: ["C:\\", "D:\\"] } };
    const original = f.store.update.bind(f.store);
    f.store.update = (input) => { const result = original(input); f.dropResponse(); return result; };
    await assert.rejects(f.call("update", { body: canonicalJson(request) }));
    f.store.update = original;
    const retry = await f.call("update", { body: canonicalJson(request) });
    assert.equal(retry.status, 200);
    assert.equal(f.store.snapshot().binding.revision, 2);
    assert.deepEqual(retry.json["receipt"], original(request));
  } finally { await f.close(); }
});

test("session expiry during body receipt is rechecked before changing policy", async () => {
  const f = await fixture();
  try {
    await f.pair();
    const body = canonicalJson({ requestId: randomUUID(), expectedBinding: f.store.snapshot().binding,
      rules: { allowedRoots: [], deniedRoots: ["C:\\", "D:\\"] } });
    const arrived = once(f.server, "request");
    const pending = f.start("update", { body: body.slice(0, 1), hold: true, headers: { "content-length": String(Buffer.byteLength(body)) } });
    await arrived;
    f.setTime(OPERATOR_SESSION_TTL_MS);
    pending.request.end(body.slice(1));
    assert.equal((await pending.result).status, 401);
    assert.equal(f.store.snapshot().binding.revision, 1);
  } finally { await f.close(); }
});

test("revocation and client abort during upload both leave policy unchanged", async () => {
  for (const mode of ["revoke", "abort"]) {
    const f = await fixture();
    try {
      await f.pair();
      const body = canonicalJson({ requestId: randomUUID(), expectedBinding: f.store.snapshot().binding,
        rules: { allowedRoots: [], deniedRoots: ["C:\\", "D:\\"] } });
      const arrived = once(f.server, "request");
      const pending = f.start("update", { body: body.slice(0, 1), hold: true, headers: { "content-length": String(Buffer.byteLength(body)) } });
      const [incoming] = await arrived as [IncomingMessage, ServerResponse];
      if (mode === "revoke") {
        f.pairing.session.revoke();
        pending.request.end(body.slice(1));
        assert.equal((await pending.result).status, 401);
      } else {
        const rejection = assert.rejects(pending.result);
        const aborted = once(incoming, "aborted");
        pending.request.destroy();
        await aborted;
        await rejection;
        assert.equal((await f.call("read")).status, 200);
      }
      assert.equal(f.store.snapshot().binding.revision, 1);
    } finally { await f.close(); }
  }
});

test("post-commit storage failure returns a redacted unknown outcome and the same request recovers", async () => {
  const f = await fixture();
  try {
    await f.pair();
    const input = { requestId: randomUUID(), expectedBinding: f.store.snapshot().binding,
      rules: { allowedRoots: [], deniedRoots: ["C:\\", "D:\\"] } };
    const original = f.store.update.bind(f.store);
    f.store.update = (value) => { original(value); throw new Error("private-database-diagnostic-must-not-escape"); };
    const unknown = await f.call("update", { body: canonicalJson(input) });
    assert.equal(unknown.status, 503);
    assert.equal(unknown.json["updateOutcome"], "unknown");
    assert.equal(unknown.text.includes("private-database"), false);
    f.store.update = original;
    const recovered = await f.call("update", { body: canonicalJson(input) });
    assert.equal(recovered.status, 200);
    assert.deepEqual(recovered.json["receipt"], original(input));
    assert.equal(f.store.snapshot().binding.revision, 2);
  } finally { await f.close(); }
});

test("incomplete bodies time out and bounded concurrent readers cannot mutate state", { timeout: 10_000 }, async () => {
  const f = await fixture();
  const pending: Array<{ request: ClientRequest; result: Promise<Reply> }> = [];
  try {
    await f.pair();
    for (let index = 0; index < OPERATOR_SETTINGS_MAX_IN_FLIGHT; index++) {
      const arrived = once(f.server, "request");
      pending.push(f.start("read", { body: "{", hold: true, headers: { "content-length": "2" } }));
      await arrived;
    }
    assert.equal((await f.call("read")).status, 429);
    const expired = await Promise.all(pending.map((item) => item.result));
    assert.equal(expired.every((item) => item.status === 408), true);
    assert.equal((await f.call("read")).status, 200);
    assert.equal(f.store.snapshot().binding.revision, 1);
  } finally { for (const item of pending) item.request.destroy(); await f.close(); }
});

test("request rate has a fixed bound and clock failure cannot reset it", async () => {
  const f = await fixture();
  try {
    await f.pair();
    for (let index = 1; index < OPERATOR_SETTINGS_RATE_LIMIT; index++) assert.equal((await f.call("read")).status, 200);
    assert.equal((await f.call("read")).status, 429);
    f.setTime(60_000);
    assert.equal((await f.call("read")).status, 200);
    f.setTime(0);
    assert.equal((await f.call("read")).status, 503);
    f.setTime(120_000);
    assert.equal((await f.call("read")).status, 503);
  } finally { await f.close(); }
});
