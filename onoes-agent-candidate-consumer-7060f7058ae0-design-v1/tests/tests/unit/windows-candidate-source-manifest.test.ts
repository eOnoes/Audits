import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, canonicalSha256Digest, sha256Digest } from "../../src/compatibility/canonical-json.js";
import { MANAGED_VERIFICATION_CATALOG_VERSION, parseManagedVerificationCatalog,
  resolveManagedVerificationDefinition } from "../../src/build-only/windows-managed-verification-catalog.js";
import { createManagedVerificationRequest } from "../../src/build-only/windows-managed-verification-evidence.js";
import { CANDIDATE_SOURCE_MANIFEST_LIMITS as limits, CANDIDATE_SOURCE_MANIFEST_VERSION as version,
  createCandidateSourceManifest, parseCandidateSourceManifest, copyCandidateSourceFile,
  type CandidateSourceManifest } from "../../src/build-only/windows-candidate-source-manifest.js";
import { MANAGED_CANDIDATE_VERIFICATION_MAX_REQUEST_BYTES } from "../../src/build-only/windows-managed-candidate-verification.js";

const d = (n: number) => "sha256:" + n.toString(16).padStart(64, "0");
function request(paths: string[], bytes: Uint8Array[], operationId = "20000000-0000-4000-8000-000000000002") {
  const entries = [{ schemaVersion: "onoes-managed-verification-definition/v1", verificationId: "compile",
    displayName: "Compile", runnerArtifactDigest: d(1), commandContractDigest: d(2), networkAccess: "denied",
    workspaceAccess: "read-only", scratchAccess: "private-bounded", timeoutMs: 30_000,
    maximumOutputBytes: 1024, maximumScratchBytes: 2048, maximumProcessCount: 3 }];
  const catalogDigest = canonicalSha256Digest({ domain: MANAGED_VERIFICATION_CATALOG_VERSION, entries });
  const catalog = parseManagedVerificationCatalog(canonicalJson({ schemaVersion: MANAGED_VERIFICATION_CATALOG_VERSION,
    kind: "trusted-static-definitions-not-task-commands", entries, catalogDigest }));
  return createManagedVerificationRequest(resolveManagedVerificationDefinition(catalog, "compile", catalogDigest), {
    requestId: "10000000-0000-4000-8000-000000000001", operationId,
    subject: { workspaceDigest: d(3), policyBindingDigest: d(4),
      files: paths.map((relativePath, i) => ({ relativePath, contentDigest: sha256Digest(bytes[i]!) })) },
  });
}
function fixture() {
  const bytes = [Buffer.from("unchanged\n"), Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0a])];
  const r = request(["Docs/A.md", "src/z.ts"], bytes), manifest = createCandidateSourceManifest(r, bytes);
  return { bytes, r, manifest, wire: canonicalJson(manifest) };
}
function denied(fn: () => unknown) { assert.throws(fn, /^Error: candidate-source-manifest-invalid$/); }
function repin(coreInput: Record<string, unknown>): { wire: string; pin: string } {
  const { manifestDigest: ignored, ...core } = coreInput; void ignored;
  const pin = canonicalSha256Digest({ domain: version, manifest: core });
  return { wire: canonicalJson({ ...core, manifestDigest: pin }), pin };
}

test("manifest binds all exact file bytes including unchanged source and BOM, without retaining source", () => {
  const { bytes, r, manifest, wire } = fixture();
  const parsed = parseCandidateSourceManifest(Buffer.from(wire), r, manifest.manifestDigest);
  assert.deepEqual(parsed, manifest);
  assert.equal(parsed.fileCount, 2); assert.equal(parsed.byteLength, 15);
  assert.equal(parsed.authority, "none"); assert.equal(parsed.fullReadScopeIncluded, true);
  assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.files) && Object.isFrozen(parsed.files[0]));
  assert.equal(wire.includes("unchanged"), false);
  const copy = copyCandidateSourceFile(parsed, 1, bytes[1]);
  assert.deepEqual(copy, bytes[1]); bytes[1]!.fill(0);
  assert.equal(copy.toString("hex"), "efbbbf610a");
  denied(() => copyCandidateSourceFile(parsed, 1, bytes[1]));
  copy.fill(0);
});

test("all 128 paths at 512 bytes fit the new manifest while the old 65536 request limit stays unchanged", () => {
  const paths = Array.from({ length: 128 }, (_, i) => `${String(i).padStart(3, "0")}/${"a".repeat(200)}/${"b".repeat(200)}/${"c".repeat(106)}`);
  assert.ok(paths.every(p => p.length === limits.pathBytes));
  const bytes = paths.map(() => Buffer.from("x")), r = request(paths, bytes);
  assert.equal(MANAGED_CANDIDATE_VERIFICATION_MAX_REQUEST_BYTES, 65_536);
  assert.ok(Buffer.byteLength(canonicalJson(r)) > MANAGED_CANDIDATE_VERIFICATION_MAX_REQUEST_BYTES);
  const manifest = createCandidateSourceManifest(r, bytes), wire = canonicalJson(manifest);
  assert.equal(manifest.fileCount, 128); assert.equal(manifest.files[127]!.relativePath, paths[127]);
  assert.ok(Buffer.byteLength(wire) < limits.manifestBytes * 0.75);
  assert.deepEqual(parseCandidateSourceManifest(wire, r, manifest.manifestDigest), manifest);
  assert.equal(copyCandidateSourceFile(manifest, 127, bytes[127]).toString(), "x");
});

test("per-file and aggregate exact ceilings, empty files, and complete maximum metadata are coupled", () => {
  const full = Buffer.alloc(limits.fileBytes, 0x7f), empty = Buffer.alloc(0);
  const bytes = Array.from({ length: 128 }, (_, i) => i < 16 ? full : empty);
  const paths = bytes.map((_, i) => `src/${String(i).padStart(3, "0")}.txt`);
  const r = request(paths, bytes), manifest = createCandidateSourceManifest(r, bytes);
  assert.equal(manifest.byteLength, limits.totalBytes); assert.equal(manifest.fileCount, limits.files);
  assert.equal(copyCandidateSourceFile(manifest, 127, empty).length, 0);
  assert.equal(full[0], 0x7f, "producer must not erase caller-owned buffers");
  const excessive = [...bytes]; excessive[16] = Buffer.from("x");
  denied(() => createCandidateSourceManifest(request(paths, excessive), excessive));
  const large = Buffer.alloc(limits.fileBytes + 1);
  denied(() => createCandidateSourceManifest(request(["a.txt"], [large]), [large]));
  const changed = repin({ ...manifest, byteLength: limits.totalBytes - 1 });
  denied(() => parseCandidateSourceManifest(changed.wire, r, changed.pin));
});

test("pin, operation, workspace subject and genuine request provenance cannot be substituted", () => {
  const { r, manifest, wire, bytes } = fixture();
  denied(() => parseCandidateSourceManifest(wire, r, d(99)));
  denied(() => parseCandidateSourceManifest(wire, structuredClone(r), manifest.manifestDigest));
  const other = request(["Docs/A.md", "src/z.ts"], bytes, "20000000-0000-4000-8000-000000000003");
  denied(() => parseCandidateSourceManifest(wire, other, manifest.manifestDigest));
  for (const field of ["requestDigest", "workspaceSubjectDigest"] as const) {
    const changed = repin({ ...manifest, [field]: d(90) });
    denied(() => parseCandidateSourceManifest(changed.wire, r, changed.pin));
  }
  denied(() => createCandidateSourceManifest(structuredClone(r), bytes));
  denied(() => copyCandidateSourceFile(structuredClone(manifest), 0, bytes[0]));
});

test("missing extra reordered and case-changed members deny even with recomputed self digest", () => {
  const { r, manifest } = fixture();
  const changes = [[], manifest.files.slice(0, 1), [...manifest.files].reverse(),
    [...manifest.files, { ...manifest.files[0] }],
    [{ ...manifest.files[0], relativePath: "docs/A.md" }, manifest.files[1]],
    [{ ...manifest.files[0], contentDigest: d(44) }, manifest.files[1]]];
  for (const files of changes) {
    const changed = repin({ ...manifest, files, fileCount: files.length });
    denied(() => parseCandidateSourceManifest(changed.wire, r, changed.pin));
  }
});

test("new physical-name preconditions deny directory aliases, file-directory collisions and reserved control names", () => {
  for (const paths of [["Docs/a.txt", "docs/b.txt"], ["a", "a/b"], ["a/b", "a/B/c"],
    [".onoes-control/a.txt"], ["src/.ONOES-x"], ["a".repeat(256)]]) {
    const bytes = paths.map(() => Buffer.from("x")), r = request(paths, bytes);
    denied(() => createCandidateSourceManifest(r, bytes));
  }
  const bytes = [Buffer.from("a"), Buffer.from("b")];
  assert.equal(createCandidateSourceManifest(request(["Docs/a.txt", "Docs/b.txt"], bytes), bytes).fileCount, 2);
});

test("canonical wire rejects BOM, invalid UTF8, duplicate keys, whitespace, unknown fields and oversize", () => {
  const { r, manifest, wire } = fixture();
  for (const input of ["\ufeff" + wire, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(wire)]),
    " " + wire, wire + "\n", new Uint8Array([0xc3, 0x28]),
    wire.replace('"authority":"none"', '"authority":"none","authority":"none"'),
    wire.replace('"authority":"none"', '"unknown":true,"authority":"none"'),
    Buffer.alloc(limits.manifestBytes + 1), " ".repeat(limits.manifestBytes + 1)])
    denied(() => parseCandidateSourceManifest(input, r, manifest.manifestDigest));
  const changed = repin({ ...manifest, fileCount: 1.5 });
  denied(() => parseCandidateSourceManifest(changed.wire, r, changed.pin));
});

test("caller arrays reject traps, accessors, holes, exotic prototypes and additional keys without invoking them", () => {
  const { r, bytes } = fixture(); let calls = 0;
  const proxy = new Proxy(bytes, { getPrototypeOf() { calls++; throw new Error(); }, get() { calls++; throw new Error(); } });
  denied(() => createCandidateSourceManifest(r, proxy));
  const accessor = [bytes[0], bytes[1]];
  Object.defineProperty(accessor, "0", { enumerable: true, get() { calls++; throw new Error(); } });
  denied(() => createCandidateSourceManifest(r, accessor));
  denied(() => createCandidateSourceManifest(r, new Array(2)));
  denied(() => createCandidateSourceManifest(r, Object.assign([...bytes], { extra: true })));
  const exotic = [...bytes]; Object.setPrototypeOf(exotic, null);
  denied(() => createCandidateSourceManifest(r, exotic));
  assert.equal(calls, 0);
});

test("byte snapshots ignore caller getters and iterators, and reject proxies shared detached and wrong-kind buffers", () => {
  const { r, bytes, manifest, wire } = fixture(); let calls = 0;
  const special = Uint8Array.from(bytes[0]!);
  for (const key of ["byteLength", "byteOffset", "buffer", Symbol.iterator])
    Object.defineProperty(special, key, { get() { calls++; throw new Error(); } });
  assert.equal(createCandidateSourceManifest(r, [special, bytes[1]]).manifestDigest, manifest.manifestDigest);
  assert.deepEqual(copyCandidateSourceFile(manifest, 0, special), bytes[0]); assert.equal(calls, 0);
  const detached = new Uint8Array(10); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  for (const bad of [new Proxy(bytes[0]!, { get() { calls++; throw new Error(); } }),
    new Uint8Array(new SharedArrayBuffer(10)), detached, new DataView(new ArrayBuffer(10)), [1, 2, 3]]) {
    denied(() => createCandidateSourceManifest(r, [bad, bytes[1]]));
    denied(() => copyCandidateSourceFile(manifest, 0, bad));
  }
  const sharedWire = new Uint8Array(new SharedArrayBuffer(Buffer.byteLength(wire))); sharedWire.set(Buffer.from(wire));
  denied(() => parseCandidateSourceManifest(sharedWire, r, manifest.manifestDigest));
  assert.equal(calls, 0);
});

test("file verification denies truncation, suffix, wrong member, changed byte and invalid index", () => {
  const { manifest, bytes } = fixture();
  for (const input of [bytes[0]!.subarray(1), Buffer.concat([bytes[0]!, Buffer.from("x")]), bytes[1], Buffer.alloc(10)])
    denied(() => copyCandidateSourceFile(manifest, 0, input));
  for (const index of [-1, 2, 0.5, NaN, Infinity]) denied(() => copyCandidateSourceFile(manifest, index, bytes[0]));
  denied(() => copyCandidateSourceFile({} as CandidateSourceManifest, 0, bytes[0]));
  const padded = Buffer.concat([Buffer.from("padding"), bytes[0]!, Buffer.from("padding")]);
  assert.deepEqual(copyCandidateSourceFile(manifest, 0, padded.subarray(7, 17)), bytes[0]);
});
