import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { canonicalJson, canonicalSha256Digest, sha256Digest } from "../../src/compatibility/canonical-json.js";
import { MANAGED_VERIFICATION_CATALOG_VERSION, parseManagedVerificationCatalog,
  resolveManagedVerificationDefinition } from "../../src/build-only/windows-managed-verification-catalog.js";
import { createManagedVerificationRequest } from "../../src/build-only/windows-managed-verification-evidence.js";
import { createCandidateSourceManifest } from "../../src/build-only/windows-candidate-source-manifest.js";
import { CandidateSourceTransferReceiver, CANDIDATE_SOURCE_TRANSFER_LIMITS as limits,
  encodeCandidateSourceFileFrame, copyReceivedCandidateSourceFile, discardReceivedCandidateSource,
  type ReceivedCandidateSource } from "../../src/build-only/windows-candidate-source-transfer.js";

const d = (n: number) => "sha256:" + n.toString(16).padStart(64, "0");
function fixture(bytes = [Buffer.from("unchanged\n"), Buffer.from([0xef, 0xbb, 0xbf, 0x61])],
  paths = bytes.map((_, i) => `src/${String(i).padStart(3, "0")}.txt`)) {
  const entries = [{ schemaVersion: "onoes-managed-verification-definition/v1", verificationId: "compile",
    displayName: "Compile", runnerArtifactDigest: d(1), commandContractDigest: d(2), networkAccess: "denied",
    workspaceAccess: "read-only", scratchAccess: "private-bounded", timeoutMs: 30_000,
    maximumOutputBytes: 1024, maximumScratchBytes: 2048, maximumProcessCount: 3 }];
  const catalogDigest = canonicalSha256Digest({ domain: MANAGED_VERIFICATION_CATALOG_VERSION, entries });
  const catalog = parseManagedVerificationCatalog(canonicalJson({ schemaVersion: MANAGED_VERIFICATION_CATALOG_VERSION,
    kind: "trusted-static-definitions-not-task-commands", entries, catalogDigest }));
  const request = createManagedVerificationRequest(resolveManagedVerificationDefinition(catalog, "compile", catalogDigest), {
    requestId: "10000000-0000-4000-8000-000000000001", operationId: "20000000-0000-4000-8000-000000000002",
    subject: { workspaceDigest: d(3), policyBindingDigest: d(4),
      files: paths.map((relativePath, i) => ({ relativePath, contentDigest: sha256Digest(bytes[i]!) })) },
  });
  const manifest = createCandidateSourceManifest(request, bytes);
  const frames = bytes.map((b, i) => encodeCandidateSourceFileFrame(manifest, i, b));
  return { request, manifest, frames, bytes,
    receiver: () => new CandidateSourceTransferReceiver(canonicalJson(manifest), request, manifest.manifestDigest) };
}
function denied(fn: () => unknown) { assert.throws(fn, /^Error: candidate-source-transfer-invalid$/); }
function feed(receiver: CandidateSourceTransferReceiver, bytes: Buffer, chunkSize: number = limits.chunkBytes) {
  for (let i = 0; i < bytes.length; i += chunkSize) receiver.write(bytes.subarray(i, i + chunkSize));
}

test("framing has a fixed independent byte layout, exact source, and no source before declared EOF", () => {
  const f = fixture(), first = f.frames[0]!;
  const expectedHeader = "4f435331" + f.manifest.manifestDigest.slice(7) + "000000000a000000";
  assert.equal(first.subarray(0, 44).toString("hex"), expectedHeader);
  assert.deepEqual(first.subarray(44), f.bytes[0]);
  const r = f.receiver(); feed(r, Buffer.concat(f.frames), 1);
  assert.deepEqual(Object.keys(r), [], "partial bytes are private");
  denied(() => copyReceivedCandidateSourceFile({} as ReceivedCandidateSource, 0));
  const result = r.finish();
  assert.equal(result.fileCount, 2); assert.equal(result.byteLength, 14);
  assert.equal(result.wireByteLength, 102); assert.equal(result.destinationStored, false);
  assert.equal(result.authority, "none"); assert.ok(Object.isFrozen(result));
  assert.equal(JSON.stringify(result).includes("unchanged"), false);
  for (let i = 0; i < 2; i++) assert.deepEqual(copyReceivedCandidateSourceFile(result, i), f.bytes[i]);
  const copy = copyReceivedCandidateSourceFile(result, 1); copy.fill(0);
  assert.equal(copyReceivedCandidateSourceFile(result, 1).toString("hex"), "efbbbf61");
  denied(() => copyReceivedCandidateSourceFile(structuredClone(result), 0));
  for (const index of [-1, NaN, 0.5, 2]) denied(() => copyReceivedCandidateSourceFile(result, index));
  discardReceivedCandidateSource(result); discardReceivedCandidateSource(result);
  denied(() => copyReceivedCandidateSourceFile(result, 0)); r.abort();
});

test("every split across headers, bodies and empty-file boundaries reconstructs the same subject", () => {
  const f = fixture([Buffer.alloc(0), Buffer.from("a"), Buffer.alloc(0), Buffer.from("last")]);
  const wire = Buffer.concat(f.frames);
  for (let split = 1; split < wire.length; split++) {
    const r = f.receiver(); r.write(wire.subarray(0, split)); r.write(wire.subarray(split));
    const result = r.finish();
    for (let i = 0; i < 4; i++) assert.deepEqual(copyReceivedCandidateSourceFile(result, i), f.bytes[i]);
    r.abort(); denied(() => copyReceivedCandidateSourceFile(result, 0));
  }
});

test("128 maximum-length paths and the full 16 MiB scope transfer without widening the historical channel", () => {
  const bytes = Array.from({ length: 128 }, (_, i) => i < 16 ? Buffer.alloc(1_048_576, i) : Buffer.alloc(0));
  const paths = bytes.map((_, i) => `${String(i).padStart(3, "0")}/${"a".repeat(200)}/${"b".repeat(200)}/${"c".repeat(106)}`);
  const f = fixture(bytes, paths), r = f.receiver();
  assert.ok(Buffer.byteLength(canonicalJson(f.request)) > 65_536);
  const wire = Buffer.concat(f.frames); assert.equal(wire.length, limits.wireBytes);
  feed(r, wire); const result = r.finish(); assert.equal(result.fileCount, 128);
  assert.equal(result.byteLength, 16_777_216);
  for (let i = 0; i < bytes.length; i++) assert.deepEqual(copyReceivedCandidateSourceFile(result, i), bytes[i]);
  r.abort(); wire.fill(0); for (const frame of f.frames) frame.fill(0);
});

test("every truncated prefix, omitted member, duplicate, reorder and suffix denies and cannot resume", () => {
  const f = fixture(), wire = Buffer.concat(f.frames);
  for (let cut = 0; cut < wire.length; cut++) {
    const r = f.receiver(); if (cut > 0) r.write(wire.subarray(0, cut));
    denied(() => r.finish()); denied(() => r.write(wire)); denied(() => r.finish());
  }
  for (const bad of [Buffer.concat([...f.frames, Buffer.from([0])]), Buffer.concat([...f.frames].reverse()),
    Buffer.concat([f.frames[0]!, f.frames[0]!]), f.frames[1]!]) {
    const r = f.receiver(); denied(() => { feed(r, bad); r.finish(); }); denied(() => r.write(wire));
  }
  const r = f.receiver(); feed(r, wire); const result = r.finish();
  denied(() => r.write(Buffer.from([0]))); denied(() => copyReceivedCandidateSourceFile(result, 0));
  const second = f.receiver(); feed(second, wire); const completed = second.finish();
  denied(() => second.finish()); denied(() => copyReceivedCandidateSourceFile(completed, 0));
});

test("magic, every manifest pin byte, index, reserved fields, declared length and content are checked", () => {
  const f = fixture();
  for (let offset = 0; offset < f.frames[0]!.length; offset++) {
    const bad = Buffer.from(f.frames[0]!); bad[offset] = bad[offset]! ^ 0x80;
    const r = f.receiver(); denied(() => r.write(bad)); denied(() => r.write(f.frames[0]));
  }
  const r = f.receiver(), huge = Buffer.from(f.frames[0]!.subarray(0, 44)); huge.writeUInt32LE(0xffffffff, 40);
  denied(() => r.write(huge));
  denied(() => new CandidateSourceTransferReceiver(canonicalJson(f.manifest), f.request, d(91)));
  denied(() => new CandidateSourceTransferReceiver(canonicalJson(f.manifest), structuredClone(f.request), f.manifest.manifestDigest));
  denied(() => encodeCandidateSourceFileFrame(structuredClone(f.manifest), 0, f.bytes[0]));
  denied(() => encodeCandidateSourceFileFrame(f.manifest, 0, Buffer.from("wrong")));
});

test("typed-array inputs are bounded without invoking caller accessors, coercion or proxy traps", () => {
  const f = fixture(), wire = Buffer.concat(f.frames); let touched = 0;
  const traps = { get() { touched++; throw new Error("trap"); }, ownKeys() { touched++; throw new Error("trap"); } };
  for (const bad of [new Proxy(wire, traps), { get byteLength() { touched++; return 1; } },
    new Uint8Array(new SharedArrayBuffer(44)), new DataView(new ArrayBuffer(44)), "OCS1", Buffer.alloc(0),
    Buffer.alloc(limits.chunkBytes + 1)]) {
    const r = f.receiver(); denied(() => r.write(bad)); denied(() => r.finish());
  }
  const bytes = new Uint8Array(wire);
  for (const key of ["buffer", "byteOffset", "byteLength", Symbol.iterator]) {
    Object.defineProperty(bytes, key, { get() { touched++; throw new Error("getter"); } });
  }
  const r = f.receiver(); r.write(bytes); bytes.fill(0); const result = r.finish();
  assert.deepEqual(copyReceivedCandidateSourceFile(result, 0), f.bytes[0]); assert.equal(touched, 0); r.abort();
  const detached = new Uint8Array(44); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  denied(() => f.receiver().write(detached));
});

test("chunk-count ceiling stops pathological fragmentation and poison is absorbing", () => {
  const f = fixture([Buffer.alloc(limits.chunks, 0x42)]), r = f.receiver(), wire = f.frames[0]!;
  for (let i = 0; i < limits.chunks; i++) r.write(wire.subarray(i, i + 1));
  denied(() => r.write(wire.subarray(limits.chunks))); denied(() => r.finish());
  const valid = f.receiver(); feed(valid, wire); valid.finish(); valid.abort();
  const exact = fixture([Buffer.alloc(limits.chunks - 44, 0x42)]), boundary = exact.receiver();
  feed(boundary, exact.frames[0]!, 1); boundary.finish(); boundary.abort();
});

test("bad later file clears both previously accepted file buffers and the current partial body", () => {
  const f = fixture([Buffer.from("first unique!"), Buffer.from("second unique!!")]);
  const captured: Buffer[] = [], original = Buffer.alloc;
  // Synchronous test seam, restored before assertions; no concurrent test work.
  Buffer.alloc = ((size: number, ...args: unknown[]) => {
    const result = Reflect.apply(original, Buffer, [size, ...args]) as Buffer;
    captured.push(result); return result;
  }) as typeof Buffer.alloc;
  try {
    const r = f.receiver(); r.write(f.frames[0]);
    const bad = Buffer.from(f.frames[1]!); bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
    denied(() => r.write(bad)); denied(() => r.finish());
  } finally { Buffer.alloc = original; }
  for (const size of [44, f.bytes[0]!.length, f.bytes[1]!.length]) {
    const buffer = captured.find(b => b.length === size); assert.ok(buffer);
    assert.ok(buffer.every(b => b === 0), `owned ${size}-byte buffer cleared`);
  }
});

test("actual local child pipe delivers synthetic frames; only clean EOF plus zero exit permits finish", { timeout: 15_000 }, async (t) => {
  const f = fixture([Buffer.alloc(200_000, 0x5a), Buffer.alloc(0)]);
  for (const exitCode of [0, 23]) {
    const r = f.receiver();
    const child = spawn(process.execPath, ["-e",
      `process.stdin.pipe(process.stdout); process.stdin.on('end',()=>{process.exitCode=${exitCode}});`],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, signal: t.signal });
    const closed = once(child, "close"); let stderr = false;
    child.stderr.on("data", () => { stderr = true; });
    try {
      child.stdin.end(Buffer.concat(f.frames));
      for await (const value of child.stdout) feed(r, value as Buffer);
      const [code, signal] = await closed; assert.equal(code, exitCode); assert.equal(signal, null); assert.equal(stderr, false);
      if (code !== 0) { r.abort(); denied(() => r.finish()); }
      else { const result = r.finish(); assert.deepEqual(copyReceivedCandidateSourceFile(result, 0), f.bytes[0]); }
    } finally { r.abort(); if (child.exitCode === null && child.signalCode === null) child.kill(); await closed; }
  }
});
