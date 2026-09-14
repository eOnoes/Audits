import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { canonicalJson, canonicalSha256Digest, sha256Digest } from "../../src/compatibility/canonical-json.js";
import { CANDIDATE_EFFECT_DOMAIN, candidateEffectState } from "../../src/build-only/windows-candidate-effect-state.js";
import type { CandidateEffectIntent } from "../../src/build-only/windows-candidate-effect-state.js";
import { initializeCandidateEffectLedger, SqliteCandidateEffectLedger } from "../../src/build-only/windows-candidate-effect-ledger.js";
import { createSyntheticCheckpointGenesis, SyntheticCandidateCheckpointSequencer } from "../../src/build-only/windows-candidate-checkpoint-sequencer.js";
import type { SyntheticCheckpoint } from "../../src/build-only/windows-candidate-checkpoint-sequencer.js";
import { createManagedVerificationRequest } from "../../src/build-only/windows-managed-verification-evidence.js";
import { createCandidateSourceManifest } from "../../src/build-only/windows-candidate-source-manifest.js";
import { CandidateSourceTransferReceiver, encodeCandidateSourceFileFrame, copyReceivedCandidateSourceFile,
  discardReceivedCandidateSource } from "../../src/build-only/windows-candidate-source-transfer.js";
import { SyntheticCandidateExecution, SyntheticExecutionError } from "../../src/build-only/windows-candidate-synthetic-execution.js";
import type { SyntheticCandidateExecutionPorts, SyntheticExecutionBinding } from "../../src/build-only/windows-candidate-synthetic-execution.js";
import { verificationResolution, verificationResult, d } from "../helpers/managed-executor-fixture.js";

const AT = "2026-09-14T07:00:00.000Z", EXPIRES = "2026-09-14T07:05:00.000Z";
const signal = () => new AbortController().signal;
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture(bytes = [Buffer.from("unchanged\n"), Buffer.from([0xef, 0xbb, 0xbf, 0x61])],
  paths = bytes.map((_, i) => `src/${String(i).padStart(3, "0")}.txt`)) {
  const parent = resolve(tmpdir()), dir = mkdtempSync(join(parent, "onoes-synthetic-execution-")), path = join(dir, "ledger.sqlite");
  let db = new Database(path), wall = AT, live = true;
  const namespaceId = randomUUID(), storeId = initializeCandidateEffectLedger(db, namespaceId), ownerGeneration = randomUUID();
  let ledger = new SqliteCandidateEffectLedger(db, storeId, namespaceId, () => wall);
  const pins = { installationId: randomUUID(), namespaceId, storeId };
  let head = createSyntheticCheckpointGenesis(pins, ownerGeneration);
  const request = createManagedVerificationRequest(verificationResolution(), { requestId: randomUUID(), operationId: randomUUID(),
    subject: { workspaceDigest: d(1), policyBindingDigest: d(2), files: paths.map((relativePath, i) => ({ relativePath, contentDigest: sha256Digest(bytes[i]!) })) } });
  const manifest = createCandidateSourceManifest(request, bytes);
  const input: CandidateEffectIntent = { schemaVersion: CANDIDATE_EFFECT_DOMAIN, namespaceId, storeId,
    operationId: request.operationId, workflowId: randomUUID(), approvalId: randomUUID(), kind: "execute",
    workspaceDigest: request.workspaceDigest, policyBindingDigest: request.policyBindingDigest,
    candidateDigest: d(3), reviewMaterialDigest: d(4), sourceManifestDigest: manifest.manifestDigest,
    requestDigest: request.requestDigest, guestImageDigest: d(7), guestGeneration: randomUUID(),
    controllerIdentityDigest: d(8), resourcePolicyDigest: d(9), expiresAt: EXPIRES };
  const calls: string[] = [], appended: number[] = [], destination = new Map<string, Buffer>();
  const hooks: Partial<SyntheticCandidateExecutionPorts> & { append?: (proposed: SyntheticCheckpoint) => unknown | Promise<unknown> } = {};
  const outside = () => assert.equal(db.inTransaction, false, "all lifecycle and checkpoint ports outside SQLite transaction");
  const assertCurrent = () => { outside(); if (!live) throw new Error("fixture policy revoked"); };
  const read = () => ledger.read(input.operationId)!;
  const checkpoint = new SyntheticCandidateCheckpointSequencer({ mode: "synthetic-only", pins, ownerGeneration, ledger,
    snapshot: () => {
      outside(); return ledger.snapshot();
    }, assertCurrent, appendMs: 100, discoveryMs: 100, pairMs: 500,
    anchor: {
      async discover() { outside(); return { currentOwnerGeneration: ownerGeneration, checkpoint: head }; },
      async compareAndAppend(owner, expected, proposed) {
        outside(); assert.equal(owner, ownerGeneration); assert.equal(expected, head.checkpointDigest); appended.push(proposed.sequence);
        if (hooks.append) return hooks.append(proposed);
        head = proposed; return { currentOwnerGeneration: ownerGeneration, checkpoint: head };
      },
    } });
  const ready = (binding: SyntheticExecutionBinding) => ({ kind: "synthetic-ready", authority: "none", binding });
  const stopped = (binding: SyntheticExecutionBinding) => {
    for (const bytes of destination.values()) bytes.fill(0); destination.clear();
    return { kind: "synthetic-stopped", authority: "none", binding,
      hostOff: true, dispatchClosed: true, allRelatedWorkSettled: true, generationRetired: true,
      sourceCustodyReleased: true, originalPublicationExcluded: true };
  };
  const deliver = (binding: SyntheticExecutionBinding) => {
    const receiver = new CandidateSourceTransferReceiver(canonicalJson(manifest), request, manifest.manifestDigest);
    try {
      for (let i = 0; i < bytes.length; i++) {
        const frame = encodeCandidateSourceFileFrame(manifest, i, bytes[i]);
        try { for (let start = 0; start < frame.length; start += 65_536) receiver.write(frame.subarray(start, start + 65_536)); }
        finally { frame.fill(0); }
      }
      const received = receiver.finish();
      try {
        // Independently hash reread destination copies, not echoed source digests.
        const files = manifest.files.map((file, i) => {
          const copy = copyReceivedCandidateSourceFile(received, i);
          try {
            assert.deepEqual(copy, bytes[i]); destination.set(file.relativePath, Buffer.from(copy));
            return { relativePath: file.relativePath, byteLength: copy.length, contentDigest: sha256Digest(copy) };
          }
          finally { copy.fill(0); }
        });
        return { kind: "synthetic-stored", authority: "none", binding, fileCount: files.length,
          byteLength: files.reduce((sum, file) => sum + file.byteLength, 0), wireByteLength: received.wireByteLength,
          destinationInventoryDigest: canonicalSha256Digest({ domain: "synthetic-destination-inventory/v1", manifestDigest: manifest.manifestDigest, files }),
          endOfInputObserved: true, destinationReadBack: true, protectedDestination: true };
      } finally { discardReceivedCandidateSource(received); }
    } finally { receiver.abort(); }
  };
  const ports: SyntheticCandidateExecutionPorts = {
    async ready(binding, stop) { outside(); calls.push("ready"); assert.equal(candidateEffectState(read()), "reserved");
      return hooks.ready ? hooks.ready(binding, stop) : ready(binding); },
    async deliver(binding, actualManifest, stop) { outside(); calls.push("deliver");
      assert.equal(candidateEffectState(read()), "source-delivery-possible"); assert.equal(head.recordDigest, canonicalSha256Digest(read()));
      assert.equal(actualManifest.manifestDigest, manifest.manifestDigest);
      return hooks.deliver ? hooks.deliver(binding, actualManifest, stop) : deliver(binding); },
    async run(binding, actualRequest, stop) { outside(); calls.push("run");
      assert.equal(candidateEffectState(read()), "launch-possible"); assert.equal(head.recordDigest, canonicalSha256Digest(read()));
      assert.equal(actualRequest.requestDigest, request.requestDigest);
      if (hooks.run) return hooks.run(binding, actualRequest, stop);
      assert.equal(destination.size, actualRequest.files.length);
      for (const file of actualRequest.files) {
        const stored = destination.get(file.relativePath); assert.ok(stored);
        assert.equal(sha256Digest(stored), file.contentDigest, "fixture runner checks retained destination, not just an earlier ack");
      }
      return verificationResult(actualRequest); },
    async stop(binding, stop) { outside(); calls.push("stop"); return hooks.stop ? hooks.stop(binding, stop) : stopped(binding); },
  };
  const options = { mode: "synthetic-only" as const, ownerGeneration, checkpoint, readRecord: () => read(), assertCurrent, ports,
    readyMs: 200, deliveryMs: 1000, runMs: 500, stopMs: 200, checkpointMs: 1000, overallMs: 10_000, wallNow: () => wall };
  input.resourcePolicyDigest = new SyntheticCandidateExecution(options).resourcePolicyDigest;
  return { input, request, manifest, bytes, calls, appended, hooks, options, read, ready, stopped, deliver, destination,
    get ledger() { return ledger; }, get head() { return head; }, set head(value) { head = value; },
    set wall(value: string) { wall = value; }, set live(value: boolean) { live = value; },
    execution: () => new SyntheticCandidateExecution(options),
    reopen() { db.close(); db = new Database(path, { fileMustExist: true }); ledger = new SqliteCandidateEffectLedger(db, storeId, namespaceId, () => wall); },
    dispose() { for (const bytes of destination.values()) bytes.fill(0); destination.clear();
      if (db.open) db.close(); const target = resolve(dir); assert.equal(dirname(target), parent);
      assert.match(basename(target), /^onoes-synthetic-execution-[a-zA-Z0-9]+$/); rmSync(target, { recursive: true, force: true }); },
  };
}
// Each bounded synthetic configuration gets its own exact intent pin before any
// reservation. This helper is not an approval issuer or a production policy update.
const run = (f: ReturnType<typeof fixture>, execution = f.execution(), stop = signal()) => execution.execute(
  { ...f.input, resourcePolicyDigest: execution.resourcePolicyDigest }, f.request, canonicalJson(f.manifest), stop);

test("synthetic full source -> stored -> run -> confirmed stop -> bound v2 outcome checkpoints in exact order", async () => {
  const f = fixture(); try {
    const result = await run(f);
    assert.equal(result.disposition, "completed"); assert.equal(result.authority, "none"); assert.equal(result.physicalCustodyEstablished, false);
    assert.deepEqual(f.calls, ["ready", "deliver", "run", "stop"]); assert.deepEqual(f.appended, [1, 2, 3, 4, 5]);
    assert.deepEqual(f.read().events.map(e => e.state), ["source-delivery-possible", "launch-possible", "result-and-stop-observed", "completed"]);
    assert.equal(f.read().events[2]!.resultDigest, result.resultDigest);
    assert.equal(f.bytes[1]!.toString("hex"), "efbbbf61", "original synthetic BOM bytes retained");
    assert.equal(f.destination.size, 0, "stop clears fixture-owned destination copies, not original source");
    f.reopen(); assert.equal(candidateEffectState(f.read()), "completed");
  } finally { f.dispose(); }
});

test("authentic failed verification stays failed after stop rather than becoming success or missing-result quarantine", async () => {
  const f = fixture(); try {
    f.hooks.run = async (_b, request) => verificationResult(request, false);
    const result = await run(f); assert.equal(result.disposition, "verification-failed");
    assert.equal(candidateEffectState(f.read()), "failed"); assert.ok(result.resultDigest);
    assert.deepEqual(f.calls, ["ready", "deliver", "run", "stop"]);
  } finally { f.dispose(); }
});

test("full 128-file 16-MiB source scope and maximum paths use the codec without narrowing the request", async () => {
  const bytes = Array.from({ length: 128 }, (_, i) => i < 16 ? Buffer.alloc(1_048_576, i) : Buffer.alloc(0));
  const paths = bytes.map((_, i) => `${String(i).padStart(3, "0")}/${"a".repeat(200)}/${"b".repeat(200)}/${"c".repeat(106)}`);
  const f = fixture(bytes, paths); try {
    assert.ok(Buffer.byteLength(canonicalJson(f.request)) > 65_536);
    const result = await run(f); assert.equal(result.disposition, "completed");
    assert.equal(f.manifest.fileCount, 128); assert.equal(f.manifest.byteLength, 16_777_216);
    assert.equal(f.calls.filter(c => c === "deliver").length, 1);
  } finally { f.dispose(); for (const bytes of f.bytes) bytes.fill(0); }
});

test("forged inputs, mismatched subject, proxies and pre-abort make zero ledger or lifecycle contacts", async () => {
  const f = fixture(); try {
    const e = f.execution(); let traps = 0;
    for (const input of [new Proxy({}, { get() { traps++; throw new Error("trap"); } }), { ...f.input, requestDigest: d(99) }])
      await assert.rejects(e.execute(input, f.request, canonicalJson(f.manifest), signal()), /input-invalid/);
    await assert.rejects(e.execute(f.input, structuredClone(f.request), canonicalJson(f.manifest), signal()), /input-invalid/);
    const stop = new AbortController(); stop.abort(); await assert.rejects(run(f, e, stop.signal), /cancelled/);
    assert.equal(traps, 0); assert.deepEqual(f.calls, []); assert.deepEqual(f.appended, []); assert.equal(f.read(), undefined);
  } finally { f.dispose(); }
});

test("replayed v2 record invokes no lifecycle port and never resumes a partial operation", async () => {
  const f = fixture(); try {
    await f.options.checkpoint.reserve(f.input, signal());
    const result = await run(f); assert.equal(result.disposition, "replayed");
    assert.deepEqual(f.calls, []); assert.deepEqual(f.appended, [1]);
    assert.equal(candidateEffectState(f.read()), "reserved");
  } finally { f.dispose(); }
});

for (const sequence of [1, 2, 3, 4, 5]) {
  test(`checkpoint acknowledgment loss at sequence ${sequence} never advances the next effect or compensates`, async () => {
    const f = fixture(); try {
      f.hooks.append = proposed => { f.head = proposed; if (proposed.sequence === sequence) throw new Error("synthetic ack lost");
        return { currentOwnerGeneration: f.options.ownerGeneration, checkpoint: proposed }; };
      const result = await run(f); assert.equal(result.disposition, "needs-reconciliation"); assert.equal(result.resultDigest, null);
      assert.deepEqual(f.appended, Array.from({ length: sequence }, (_, i) => i + 1));
      assert.deepEqual(f.calls, sequence === 1 ? [] : sequence === 2 ? ["ready", "stop"]
        : sequence === 3 ? ["ready", "deliver", "stop"] : ["ready", "deliver", "run", "stop"]);
      const state = candidateEffectState(f.read()); f.reopen(); assert.equal(candidateEffectState(f.read()), state);
    } finally { f.dispose(); }
  });
}

for (const bad of ["digest", "eof", "count", "generation", "getter"] as const) {
  test(`invalid stored ${bad} denies launch and leaves v2 quarantine after confirmed stop`, async () => {
    const f = fixture(); try {
      let getters = 0;
      f.hooks.deliver = async binding => {
        const ack = f.deliver(binding);
        if (bad === "getter") return Object.defineProperty({}, "kind", { get() { getters++; return "synthetic-stored"; } });
        return bad === "digest" ? { ...ack, destinationInventoryDigest: d(99) }
          : bad === "eof" ? { ...ack, endOfInputObserved: false }
          : bad === "count" ? { ...ack, fileCount: ack.fileCount + 1 }
          : { ...ack, binding: { ...binding, guestGeneration: randomUUID() } };
      };
      const result = await run(f); assert.equal(result.disposition, "quarantined"); assert.equal(getters, 0);
      assert.deepEqual(f.calls, ["ready", "deliver", "stop"]); assert.equal(candidateEffectState(f.read()), "quarantined");
      assert.equal(f.read().events.some(e => e.state === "result-and-stop-observed"), false);
    } finally { f.dispose(); }
  });
}

test("wrong readiness identity stops once and cancels before any possible-delivery marker", async () => {
  const f = fixture(); try {
    f.hooks.ready = async binding => ({ ...f.ready(binding), binding: { ...binding, ownerGeneration: randomUUID() } });
    const result = await run(f); assert.equal(result.disposition, "cancelled");
    assert.deepEqual(f.calls, ["ready", "stop"]); assert.deepEqual(f.read().events.map(e => e.state), ["cancelled"]);
  } finally { f.dispose(); }
});

test("altered source bytes fail the actual codec before launch and never become a valid stored acknowledgment", async () => {
  const f = fixture(); try {
    f.bytes[0]![0] = f.bytes[0]![0]! ^ 1;
    const result = await run(f); assert.equal(result.disposition, "quarantined");
    assert.deepEqual(f.calls, ["ready", "deliver", "stop"]);
  } finally { f.dispose(); }
});

test("every missing stop fact withholds verification outcome and leaves a durable possible-effect blocker", async () => {
  for (const key of ["hostOff", "dispatchClosed", "allRelatedWorkSettled", "generationRetired", "sourceCustodyReleased", "originalPublicationExcluded"]) {
    const f = fixture(); try {
      f.hooks.stop = async binding => { const ack = { ...f.stopped(binding) } as Record<string, unknown>; delete ack[key]; return ack; };
      const result = await run(f); assert.equal(result.disposition, "needs-reconciliation"); assert.equal(result.resultDigest, null);
      assert.equal(candidateEffectState(f.read()), "launch-possible"); assert.equal(f.calls.filter(c => c === "stop").length, 1);
    } finally { f.dispose(); }
  }
});

test("unsettled delivery cannot be called stopped merely because a stop object says so; late completion cannot resume", async () => {
  const f = fixture(); try {
    const work = deferred<unknown>(); let binding!: SyntheticExecutionBinding;
    f.hooks.deliver = async b => { binding = b; return work.promise; };
    const e = new SyntheticCandidateExecution({ ...f.options, deliveryMs: 15 });
    const result = await run(f, e); assert.equal(result.disposition, "needs-reconciliation");
    assert.deepEqual(f.calls, ["ready", "deliver", "stop"]); assert.equal(candidateEffectState(f.read()), "source-delivery-possible");
    work.resolve(f.deliver(binding)); await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(run(f, e), /session-used/); assert.equal(f.calls.length, 3);
  } finally { f.dispose(); }
});

test("unsettled stop has one finite cleanup attempt and never publishes a valid earlier result", async () => {
  const f = fixture(); try {
    const work = deferred<unknown>(); let binding!: SyntheticExecutionBinding;
    f.hooks.stop = async b => { binding = b; return work.promise; };
    const result = await run(f, new SyntheticCandidateExecution({ ...f.options, stopMs: 15 }));
    assert.equal(result.disposition, "needs-reconciliation"); assert.equal(result.resultDigest, null);
    assert.equal(candidateEffectState(f.read()), "launch-possible");
    work.resolve(f.stopped(binding)); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.filter(c => c === "stop").length, 1);
  } finally { f.dispose(); }
});

for (const seam of ["ready", "deliver", "run", "stop"] as const) {
  test(`caller abort at ${seam} performs at most one cleanup and no later forward phase`, async () => {
    const f = fixture(); try {
      const controller = new AbortController();
      if (seam === "ready") f.hooks.ready = async b => { controller.abort(); return f.ready(b); };
      if (seam === "deliver") f.hooks.deliver = async b => { controller.abort(); return f.deliver(b); };
      if (seam === "run") f.hooks.run = async (_b, r) => { controller.abort(); return verificationResult(r); };
      if (seam === "stop") f.hooks.stop = async b => { controller.abort(); return f.stopped(b); };
      const result = await run(f, f.execution(), controller.signal);
      assert.equal(result.disposition, seam === "ready" ? "cancelled" : "quarantined"); assert.equal(result.resultDigest, null);
      assert.equal(f.calls.filter(c => c === "stop").length, 1);
      assert.equal(f.calls.includes("run"), seam === "run" || seam === "stop");
    } finally { f.dispose(); }
  });
}

test("reentrant calls and two wrappers sharing lifecycle ports cannot duplicate delivery", async () => {
  const f = fixture(); try {
    const a = f.execution(), b = f.execution(); let nested!: Promise<void>;
    f.hooks.ready = async binding => {
      nested = assert.rejects(run(f, b), /session-used/); return f.ready(binding);
    };
    assert.equal((await run(f, a)).disposition, "completed"); await nested;
    assert.deepEqual(f.calls, ["ready", "deliver", "run", "stop"]);
  } finally { f.dispose(); }
});

test("malformed and mismatched verifier results are not converted into passed observations", async () => {
  const otherRequest = createManagedVerificationRequest(verificationResolution(), { requestId: randomUUID(), operationId: randomUUID(),
    subject: { workspaceDigest: d(91), policyBindingDigest: d(92), files: [{ relativePath: "src/other.txt", contentDigest: d(93) }] } });
  for (const bad of ["{}", "x".repeat(65_537), new Uint8Array(1), verificationResult(otherRequest)]) {
    const f = fixture(); try {
      f.hooks.run = async () => bad;
      assert.equal((await run(f)).disposition, "quarantined");
      assert.equal(f.read().events.some(e => e.state === "result-and-stop-observed"), false);
    } finally { f.dispose(); }
  }
});

test("scope expiry or policy revocation during delivery cannot launch; cleanup does not require fresh forward permission", async () => {
  for (const revoke of [false, true]) {
    const f = fixture(); try {
      f.hooks.deliver = async b => { const ack = f.deliver(b); if (revoke) f.live = false; else f.wall = EXPIRES; return ack; };
      const result = await run(f); assert.equal(result.disposition, revoke ? "needs-reconciliation" : "quarantined");
      assert.deepEqual(f.calls, ["ready", "deliver", "stop"]);
    } finally { f.dispose(); }
  }
});

test("broken injected clock cannot prevent bounded emergency stop or create a success", async () => {
  const f = fixture(); try {
    let now = 0; f.hooks.run = async (_b, request) => { now = NaN; return verificationResult(request); };
    const result = await run(f, new SyntheticCandidateExecution({ ...f.options, monotonicNow: () => now }));
    assert.equal(result.disposition, "needs-reconciliation"); assert.equal(result.resultDigest, null);
    assert.deepEqual(f.calls, ["ready", "deliver", "run", "stop"]);
  } finally { f.dispose(); }
});

test("late stop cannot extend the successful run allowance", async () => {
  const f = fixture(); try {
    let now = 0; f.hooks.stop = async b => { now = 40; return f.stopped(b); };
    const result = await run(f, new SyntheticCandidateExecution({ ...f.options, runMs: 40, monotonicNow: () => now }));
    assert.equal(result.disposition, "quarantined"); assert.equal(result.resultDigest, null);
  } finally { f.dispose(); }
});

test("synthetic scope rejects implicit/unbounded budgets without initializing work", () => {
  const f = fixture(); try {
    for (const stopMs of [0, Infinity, NaN, -1, 10_001])
      assert.throws(() => new SyntheticCandidateExecution({ ...f.options, stopMs }), SyntheticExecutionError);
    assert.throws(() => new SyntheticCandidateExecution({ ...f.options, overallMs: 1000 }), /input-invalid/);
    assert.deepEqual(f.appended, []); assert.deepEqual(f.calls, []);
  } finally { f.dispose(); }
});

test("resource policy, checkpoint owner and store identities cannot be substituted", async () => {
  const f = fixture(); try {
    assert.throws(() => new SyntheticCandidateExecution({ ...f.options, ownerGeneration: randomUUID() }), /input-invalid/);
    const e = f.execution();
    for (const patch of [{ resourcePolicyDigest: d(99) }, { storeId: randomUUID() }, { namespaceId: randomUUID() }])
      await assert.rejects(e.execute({ ...f.input, ...patch }, f.request, canonicalJson(f.manifest), signal()), /input-invalid/);
    assert.deepEqual(f.calls, []); assert.deepEqual(f.appended, []);
    assert.ok(Object.isFrozen(f.options.checkpoint.identity));
    assert.equal(f.options.checkpoint.identity.authority, "none");
  } finally { f.dispose(); }
});

test("injected clock and policy callbacks cannot reenter before the single-use latch", async () => {
  for (const atClock of [false, true]) {
    const f = fixture(); try {
      let first = true, nested!: Promise<void>, execution!: SyntheticCandidateExecution;
      const reenter = () => { if (first) { first = false; nested = assert.rejects(run(f, execution), /session-used/); } };
      execution = new SyntheticCandidateExecution({ ...f.options,
        monotonicNow: () => { if (atClock) reenter(); return 0; },
        assertCurrent: () => { if (!atClock) reenter(); f.options.assertCurrent(); },
      });
      assert.equal((await run(f, execution)).disposition, "completed"); await nested;
      assert.deepEqual(f.calls, ["ready", "deliver", "run", "stop"]); assert.deepEqual(f.appended, [1, 2, 3, 4, 5]);
    } finally { f.dispose(); }
  }
});

test("destination drift after stored acknowledgment is rejected by the fixture verifier before any passed outcome", async () => {
  const f = fixture(); try {
    f.hooks.append = proposed => {
      f.head = proposed;
      if (proposed.sequence === 3) f.destination.get(f.manifest.files[0]!.relativePath)!.fill(0);
      return { currentOwnerGeneration: f.options.ownerGeneration, checkpoint: proposed };
    };
    const result = await run(f);
    assert.equal(result.disposition, "quarantined"); assert.equal(result.resultDigest, null);
    assert.deepEqual(f.calls, ["ready", "deliver", "run", "stop"]); assert.equal(f.destination.size, 0);
    assert.equal(f.read().events.some(e => e.state === "result-and-stop-observed"), false);
  } finally { f.dispose(); }
});
