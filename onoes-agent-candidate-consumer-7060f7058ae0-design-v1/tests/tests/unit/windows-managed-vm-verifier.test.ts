import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setImmediate as tick } from "node:timers/promises";
import test from "node:test";
import { createManagedVerificationRequest, parseManagedVerificationResult,
  type ManagedVerificationRequest } from "../../src/build-only/windows-managed-verification-evidence.js";
import { WindowsManagedVmVerifier, type ManagedVmVerificationSession } from "../../src/build-only/windows-managed-vm-verifier.js";
import { d, managedExecutorFixture, verificationResolution, verificationResult } from "../helpers/managed-executor-fixture.js";
import { WindowsManagedBuilderExecutor } from "../../src/build-only/windows-managed-builder-executor.js";
import { diskWorkflowFixture, original, changed } from "../helpers/managed-disk-workflow-fixture.js";

function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function request() { return createManagedVerificationRequest(verificationResolution(), {
  requestId: randomUUID(), operationId: randomUUID(), subject: { workspaceDigest: d(2), policyBindingDigest: d(3),
    files: [{ relativePath: "src/a.ts", contentDigest: d(4) }] } }); }
function session() {
  const vmId = randomUUID(), sessionId = randomUUID(), calls: string[] = [];
  const hooks: { run?: ManagedVmVerificationSession["run"]; stop?: ManagedVmVerificationSession["stopAndConfirm"] } = {};
  const off = { vmId, sessionId, state: "Off" as const, dispatchClosed: true as const };
  const port: ManagedVmVerificationSession = { vmId, sessionId,
    async run(r, signal) { calls.push("run"); return hooks.run ? hooks.run(r, signal) : verificationResult(r); },
    async stopAndConfirm() { calls.push("stop"); return hooks.stop ? hooks.stop() : off; } };
  return { port, hooks, off, calls };
}
async function until(check: () => boolean) {
  const deadline = performance.now() + 2000;
  while (!check()) { assert.ok(performance.now() < deadline, "condition did not arrive"); await tick(); }
}
const signal = () => new AbortController().signal;

test("VM verifier binds existing request/result and waits for matching host Off before releasing bytes", async () => {
  const x = session(), stop = deferred<typeof x.off>(); x.hooks.stop = () => stop.promise;
  const verifier = new WindowsManagedVmVerifier(x.port), r = request(); let released = false;
  const pending = verifier.verify(r, signal()).then(v => { released = true; return v; });
  await until(() => x.calls.includes("stop")); assert.equal(released, false); assert.equal(verifier.state, "stopping");
  stop.resolve(x.off); const wire = await pending;
  assert.equal(parseManagedVerificationResult(wire, r).disposition, "passed");
  assert.deepEqual(x.calls, ["run", "stop"]); assert.equal(verifier.state, "settled");
  await assert.rejects(verifier.verify(request(), signal()), /session-used/); assert.equal(x.calls.length, 2);
});
test("forged request and pre-abort deny without port contact", async () => {
  const x = session(), verifier = new WindowsManagedVmVerifier(x.port), r = request();
  for (const fake of [structuredClone(r), Object.create(r), null, new Proxy(r, {})])
    await assert.rejects(verifier.verify(fake as ManagedVerificationRequest, signal()), /request-untrusted/);
  const stop = new AbortController(); stop.abort(); await assert.rejects(verifier.verify(r, stop.signal), /cancelled/);
  assert.deepEqual(x.calls, []); assert.equal(verifier.state, "idle");
});
test("result mismatch, oversized transport and malformed results stop before settled denial", async () => {
  for (const bad of [verificationResult(request()), " ".repeat(65_537), "{}", "\ufeff{}", new Uint8Array(1)]) {
    const x = session(); x.hooks.run = async () => bad as string;
    const verifier = new WindowsManagedVmVerifier(x.port);
    await assert.rejects(verifier.verify(request(), signal()), /result-invalid/);
    assert.deepEqual(x.calls, ["run", "stop"]); assert.equal(verifier.state, "settled");
  }
});
test("a legitimate failed verification is preserved only after stop, never rewritten as pass", async () => {
  const x = session(); x.hooks.run = async r => verificationResult(r, false);
  const verifier = new WindowsManagedVmVerifier(x.port), r = request();
  assert.equal(parseManagedVerificationResult(await verifier.verify(r, signal()), r).disposition, "failed");
  assert.deepEqual(x.calls, ["run", "stop"]);
});
test("runner synchronous throw and asynchronous reject both require host stop", async () => {
  for (const synchronous of [true, false]) {
    const x = session();
    x.port.run = () => { x.calls.push("run"); if (synchronous) throw new Error("private-detail"); return Promise.reject(new Error("private-detail")); };
    const verifier = new WindowsManagedVmVerifier(x.port);
    await assert.rejects(verifier.verify(request(), signal()), e => e instanceof Error
      && e.message === "managed-vm-verification-runner-failed");
    assert.deepEqual(x.calls, ["run", "stop"]);
  }
});
test("abort stops once and waits for run settlement even after host Off", async () => {
  const x = session(), work = deferred<string>(), abort = new AbortController(), r = request();
  let workerSignal: AbortSignal | undefined; x.hooks.run = async (_r, s) => { workerSignal = s; return work.promise; };
  const verifier = new WindowsManagedVmVerifier(x.port); let settled = false;
  const pending = verifier.verify(r, abort.signal); const rejection = assert.rejects(pending, /cancelled/).then(() => { settled = true; });
  abort.abort(); await until(() => x.calls.includes("stop")); await tick();
  assert.equal(workerSignal?.aborted, true); assert.equal(settled, false);
  work.resolve(verificationResult(r)); await rejection;
  assert.deepEqual(x.calls, ["run", "stop"]); assert.equal(verifier.state, "settled");
});
test("abort while waiting for stop discards an already valid result", async () => {
  const x = session(), off = deferred<typeof x.off>(), abort = new AbortController(); x.hooks.stop = () => off.promise;
  const verifier = new WindowsManagedVmVerifier(x.port), pending = verifier.verify(request(), abort.signal);
  const rejected = assert.rejects(pending, /cancelled/);
  await until(() => x.calls.includes("stop")); abort.abort(); off.resolve(x.off); await rejected;
  assert.deepEqual(x.calls, ["run", "stop"]);
});
test("deadline abort is enforced without caller cancellation and does not release a late success", async () => {
  const x = session(); x.hooks.run = (r, s) => new Promise(resolve => s.addEventListener("abort", () => resolve(verificationResult(r)), { once: true }));
  const verifier = new WindowsManagedVmVerifier(x.port, { runTimeoutMs: 5 });
  await assert.rejects(verifier.verify(request(), signal()), /timeout/);
  assert.deepEqual(x.calls, ["run", "stop"]);
});
test("monotonic read-back denies exact deadline even when timer has not fired", async () => {
  const x = session(); let now = 0; x.hooks.stop = async () => { now = 100; return x.off; };
  const verifier = new WindowsManagedVmVerifier(x.port, { runTimeoutMs: 100, now: () => now });
  await assert.rejects(verifier.verify(request(), signal()), /timeout/); assert.equal(verifier.state, "settled");
});
test("invalid/wrong-session/failed stop cannot settle verification even with valid guest output", async () => {
  for (const change of [{ state: "Saved" }, { state: "Stopping" }, { vmId: randomUUID() },
    { sessionId: randomUUID() }, { dispatchClosed: false }, { extra: true }, null]) {
    const x = session(); x.hooks.stop = async () => { if (change === null) throw new Error("private-stop-detail");
      return { ...x.off, ...change } as typeof x.off; };
    const verifier = new WindowsManagedVmVerifier(x.port); let settled = false;
    void verifier.verify(request(), signal()).then(() => { settled = true; }, () => { settled = true; });
    await until(() => verifier.state === "unconfirmed"); assert.equal(settled, false);
    let reusedSettled = false;
    void verifier.verify(request(), signal()).then(() => { reusedSettled = true; }, () => { reusedSettled = true; });
    await tick(); assert.equal(reusedSettled, false);
  }
});
test("stop timeout latches uncertainty; late Off does not release a result or reset session", async () => {
  const x = session(), off = deferred<typeof x.off>(); x.hooks.stop = () => off.promise;
  const verifier = new WindowsManagedVmVerifier(x.port, { stopTimeoutMs: 5 }); let settled = false;
  void verifier.verify(request(), signal()).then(() => { settled = true; }, () => { settled = true; });
  await until(() => verifier.state === "unconfirmed"); off.resolve(x.off); await tick();
  assert.equal(settled, false); assert.equal(verifier.state, "unconfirmed"); assert.deepEqual(x.calls, ["run", "stop"]);
});
test("pending launch cannot settle on Off alone; late run settlement does not clear uncertainty", async () => {
  const x = session(), work = deferred<string>(), abort = new AbortController(), r = request(); x.hooks.run = () => work.promise;
  const verifier = new WindowsManagedVmVerifier(x.port, { stopTimeoutMs: 5 }); let settled = false;
  void verifier.verify(r, abort.signal).then(() => { settled = true; }, () => { settled = true; }); abort.abort();
  await until(() => verifier.state === "unconfirmed"); work.resolve(verificationResult(r)); await tick();
  assert.equal(settled, false); assert.equal(verifier.state, "unconfirmed");
});
test("clock regression or stop read-back at exact stop deadline cannot claim quiescence", async () => {
  for (const after of [-1, 10, NaN]) {
    const x = session(); let now = 0; x.hooks.stop = async () => { now = after; return x.off; };
    const verifier = new WindowsManagedVmVerifier(x.port, { now: () => now, stopTimeoutMs: 10 }); let settled = false;
    void verifier.verify(request(), signal()).then(() => { settled = true; }, () => { settled = true; });
    await until(() => verifier.state === "unconfirmed"); assert.equal(settled, false);
  }
});
test("invalid clock before dispatch denies without contact and permanently closes the instance", async () => {
  const x = session(), verifier = new WindowsManagedVmVerifier(x.port, { now: () => NaN });
  await assert.rejects(verifier.verify(request(), signal()), /clock-invalid/);
  assert.deepEqual(x.calls, []); assert.equal(verifier.state, "unconfirmed");
});
test("a transient invalid clock during result receipt cannot recover into a bounded stop claim", async () => {
  const x = session(); let reads = 0;
  const verifier = new WindowsManagedVmVerifier(x.port, { now: () => ++reads === 2 ? NaN : 0 }); let settled = false;
  void verifier.verify(request(), signal()).then(() => { settled = true; }, () => { settled = true; });
  await until(() => verifier.state === "unconfirmed"); assert.equal(settled, false); assert.deepEqual(x.calls, ["run", "stop"]);
});
test("concurrent requests cannot get a second run or stop through one verifier", async () => {
  const x = session(), off = deferred<typeof x.off>(); x.hooks.stop = () => off.promise;
  const verifier = new WindowsManagedVmVerifier(x.port), pending = verifier.verify(request(), signal());
  const second = assert.rejects(verifier.verify(request(), signal()), /session-used/);
  await until(() => x.calls.includes("stop")); off.resolve(x.off); await pending;
  await second;
  assert.deepEqual(x.calls, ["run", "stop"]);
});
test("host budgets narrow only, and later method substitution cannot redirect the captured session", async () => {
  for (const bad of [0, -1, 0.5, NaN, Infinity, 60_001])
    assert.throws(() => new WindowsManagedVmVerifier(session().port, { runTimeoutMs: bad }), /budget-invalid/);
  assert.throws(() => new WindowsManagedVmVerifier(session().port, { stopTimeoutMs: 10_001 }), /budget-invalid/);
  const x = session(), verifier = new WindowsManagedVmVerifier(x.port);
  x.port.run = async () => { throw new Error("substitution"); }; x.port.stopAndConfirm = async () => { throw new Error("substitution"); };
  await verifier.verify(request(), signal()); assert.deepEqual(x.calls, ["run", "stop"]);
});
test("reuse cannot assert settlement before the original host stop is confirmed", async () => {
  const x = session(), off = deferred<typeof x.off>(); x.hooks.stop = () => off.promise;
  const verifier = new WindowsManagedVmVerifier(x.port);
  const first = verifier.verify(request(), signal()); let secondSettled = false;
  const second = verifier.verify(request(), signal()).then(() => { secondSettled = true; }, () => { secondSettled = true; });
  try {
    await until(() => x.calls.includes("stop")); await tick();
    assert.equal(secondSettled, false, "no settled rejection beside an active first session");
  } finally { off.resolve(x.off); await first; await second; }
});
test("reuse after an unconfirmed stop remains unsettled instead of inviting recovery", async () => {
  const x = session(); x.hooks.stop = async () => { throw new Error("stop-unconfirmed"); };
  const verifier = new WindowsManagedVmVerifier(x.port); let firstSettled = false, secondSettled = false;
  void verifier.verify(request(), signal()).then(() => { firstSettled = true; }, () => { firstSettled = true; });
  await until(() => verifier.state === "unconfirmed");
  void verifier.verify(request(), signal()).then(() => { secondSettled = true; }, () => { secondSettled = true; });
  await tick(); assert.equal(firstSettled, false); assert.equal(secondSettled, false);
  assert.deepEqual(x.calls, ["run", "stop"]);
});
test("the same host port object cannot acquire a fresh one-shot latch by constructing another wrapper", () => {
  const x = session(); new WindowsManagedVmVerifier(x.port);
  assert.throws(() => new WindowsManagedVmVerifier(x.port), /session-already-bound/);
  assert.deepEqual(x.calls, []);
});

test("existing executor restores failed verification only after VM session has settled Off", { skip: process.platform !== "win32" }, async () => {
  const f = managedExecutorFixture(), x = session(), off = deferred<typeof x.off>();
  x.hooks.run = async r => verificationResult(r, false); x.hooks.stop = () => off.promise;
  try {
    const verifier = new WindowsManagedVmVerifier(x.port), pending = f.executor({ verifier }).execute(f.frame());
    await until(() => x.calls.includes("stop")); assert.equal(f.calls.length, 2, "only forward writes; no early rollback");
    assert.equal(f.counts().sessionActive, true); off.resolve(x.off);
    const result = await pending;
    assert.equal(result.disposition, "failed"); assert.equal(result.reason, "verification-failed");
    assert.equal(result.restoredFiles, 2); assert.equal(result.journal?.state, "settled");
    assert.equal(f.calls.length, 4); assert.equal(f.counts().sessionActive, false);
  } finally { f.close(); }
});
test("existing executor quarantines unconfirmed VM stop without compensating writes or reused session", { skip: process.platform !== "win32" }, async () => {
  const f = managedExecutorFixture(), x = session(); x.hooks.stop = async () => { throw new Error("host-stop-unconfirmed"); };
  try {
    const verifier = new WindowsManagedVmVerifier(x.port), executor = f.executor({ verifier, stepTimeoutMs: 50, cancellationGraceMs: 5 });
    const result = await executor.execute(f.frame());
    assert.equal(result.disposition, "quarantined"); assert.equal(result.reason, "unsettled-work");
    assert.equal(result.restoredFiles, 0); assert.equal(f.calls.length, 2); assert.equal(verifier.state, "unconfirmed");
    const retry = await executor.execute(f.frame()); assert.equal(retry.disposition, "denied");
    assert.deepEqual(x.calls, ["run", "stop"]);
  } finally { f.close(); }
});
test("a second executor cannot recover beside a shared unconfirmed VM session", { skip: process.platform !== "win32" }, async () => {
  const first = managedExecutorFixture(), second = managedExecutorFixture(), x = session();
  x.hooks.stop = async () => { throw new Error("stop-unconfirmed"); };
  try {
    const verifier = new WindowsManagedVmVerifier(x.port);
    const a = first.executor({ verifier, stepTimeoutMs: 100, cancellationGraceMs: 5 }).execute(first.frame());
    await until(() => verifier.state === "unconfirmed");
    const b = second.executor({ verifier, stepTimeoutMs: 100, cancellationGraceMs: 5 }).execute(second.frame());
    for (const result of await Promise.all([a, b])) {
      assert.equal(result.disposition, "quarantined"); assert.equal(result.reason, "unsettled-work");
      assert.equal(result.restoredFiles, 0);
    }
    assert.equal(first.calls.length, 2); assert.equal(second.calls.length, 2);
    assert.deepEqual(x.calls, ["run", "stop"]);
  } finally { first.close(); second.close(); }
});
for (const outcome of ["passed", "failed", "unconfirmed"] as const) {
  test(`disk workflow with VM lifecycle composition: ${outcome}`, { skip: process.platform !== "win32" }, async t => {
    const f = diskWorkflowFixture(t), x = session(); f.hooks.failVerification = outcome === "failed";
    // Existing fixture verifies complete predicted subject bytes on disk. Only
    // the VM lifecycle port is simulated; there is NO actual guest in this test.
    x.hooks.run = (r, s) => f.options.verifier.verify(r, s);
    x.hooks.stop = async () => {
      assert.deepEqual(readFileSync(f.greeting), changed);
      assert.equal(f.counts().writes, 1, "stop precedes all compensation");
      assert.equal(f.counts().active, true); f.assertCanaries();
      if (outcome === "unconfirmed") throw new Error("synthetic-stop-loss");
      return x.off;
    };
    const verifier = new WindowsManagedVmVerifier(x.port);
    const executor = new WindowsManagedBuilderExecutor({ ...f.options, verifier, stepTimeoutMs: 200, cancellationGraceMs: 5 });
    const result = await executor.execute(f.f.frame());
    assert.equal(result.disposition, outcome === "passed" ? "completed" : outcome === "failed" ? "failed" : "quarantined");
    assert.deepEqual(readFileSync(f.greeting), outcome === "failed" ? original : changed);
    assert.equal(f.counts().writes, outcome === "failed" ? 2 : 1);
    assert.equal(f.counts().active, false); assert.deepEqual(x.calls, ["run", "stop"]); f.assertCanaries();
  });
}
