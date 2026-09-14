import { types } from "node:util";
import { z } from "zod";
import { canonicalJson, canonicalSha256Digest, sha256Digest } from "../compatibility/canonical-json.js";
import { isSafeBuilderRelativePath } from "../builder/schemas.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { isManagedVerificationRequest, type ManagedVerificationRequest } from "./windows-managed-verification-evidence.js";

// New, dormant data format. NOT the historical import/request/channel format.
// No filesystem, stream, VM, approval, signature, freshness or effect permission.
export const CANDIDATE_SOURCE_MANIFEST_VERSION = "agent-candidate-source-manifest/v1" as const;
export const CANDIDATE_SOURCE_MANIFEST_LIMITS = Object.freeze({
  files: 128, pathBytes: 512, componentBytes: 255, fileBytes: 1_048_576,
  totalBytes: 16_777_216, manifestBytes: 131_072,
});
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const fileSchema = z.object({ relativePath: z.string().max(512).refine(isSafeBuilderRelativePath),
  byteLength: z.number().int().min(0).max(CANDIDATE_SOURCE_MANIFEST_LIMITS.fileBytes), contentDigest: digest }).strict();
const coreSchema = z.object({
  schemaVersion: z.literal(CANDIDATE_SOURCE_MANIFEST_VERSION),
  kind: z.literal("complete-source-identities-not-transfer-approval"),
  requestDigest: digest, workspaceSubjectDigest: digest,
  fileCount: z.number().int().min(1).max(CANDIDATE_SOURCE_MANIFEST_LIMITS.files),
  byteLength: z.number().int().min(0).max(CANDIDATE_SOURCE_MANIFEST_LIMITS.totalBytes),
  files: z.array(fileSchema).min(1).max(CANDIDATE_SOURCE_MANIFEST_LIMITS.files),
  fullReadScopeIncluded: z.literal(true), authority: z.literal("none"),
}).strict();
const manifestSchema = coreSchema.extend({ manifestDigest: digest }).strict();
export type CandidateSourceManifest = Readonly<z.infer<typeof manifestSchema>>;
const manifests = new WeakSet<object>();
const fail = (): never => { throw new Error("candidate-source-manifest-invalid"); };

// Use intrinsic getters on genuine typed arrays, not caller overrides, iterators
// or array-like coercion. Shared buffers cannot be snapshotted consistently.
const typedArrayPrototype: object = Object.getPrototypeOf(Uint8Array.prototype) as object;
const bufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const offsetGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")!.get!;
const lengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
function copyBytes(input: unknown, maximum: number): Buffer {
  if (types.isProxy(input) || !types.isUint8Array(input)) return fail();
  const buffer: unknown = bufferGetter.call(input);
  const offset: number = offsetGetter.call(input) as number;
  const length: number = lengthGetter.call(input) as number;
  if (!types.isArrayBuffer(buffer) || types.isSharedArrayBuffer(buffer)
    || length > maximum || !Number.isSafeInteger(length)) return fail();
  return Buffer.from(Buffer.from(buffer, offset, length));
}

function validate(core: z.infer<typeof coreSchema>, request: ManagedVerificationRequest): void {
  if (core.requestDigest !== request.requestDigest || core.workspaceSubjectDigest !== request.workspaceSubjectDigest
    || core.fileCount !== core.files.length || core.files.length !== request.files.length) return fail();
  const prefixes = new Map<string, { exact: string; file: boolean }>();
  let total = 0, prior = "";
  for (let index = 0; index < core.files.length; index++) {
    const file = core.files[index]!, expected = request.files[index]!;
    if (file.relativePath <= prior || file.relativePath !== expected.relativePath || file.contentDigest !== expected.contentDigest) return fail();
    prior = file.relativePath;
    total += file.byteLength;
    if (total > CANDIDATE_SOURCE_MANIFEST_LIMITS.totalBytes) return fail();
    const parts = file.relativePath.split("/");
    let prefix = "";
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const part = parts[partIndex]!;
      if (part.length > CANDIDATE_SOURCE_MANIFEST_LIMITS.componentBytes || part.toLowerCase().startsWith(".onoes-")) return fail();
      prefix = prefix ? prefix + "/" + part : part;
      const key = prefix.toLowerCase(), old = prefixes.get(key), isFile = partIndex === parts.length - 1;
      // Folding detects aliases; it NEVER changes signed spelling or ordering.
      if (old && (old.exact !== prefix || old.file || isFile)) return fail();
      prefixes.set(key, { exact: prefix, file: isFile });
    }
  }
  if (total !== core.byteLength) return fail();
}

/** Independently pinned manifest + genuine request are both required. Parsing
 * validates declarations, not possession of bytes or delivery of any file. */
export function parseCandidateSourceManifest(input: unknown, request: ManagedVerificationRequest,
  expectedManifestDigest: string): CandidateSourceManifest {
  if (!isManagedVerificationRequest(request) || typeof expectedManifestDigest !== "string"
    || !digest.safeParse(expectedManifestDigest).success) return fail();
  let owned: Buffer | undefined;
  try {
    let text: string;
    if (typeof input === "string") {
      if (Buffer.byteLength(input) > CANDIDATE_SOURCE_MANIFEST_LIMITS.manifestBytes) return fail();
      text = input;
    } else {
      owned = copyBytes(input, CANDIDATE_SOURCE_MANIFEST_LIMITS.manifestBytes);
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(owned);
    }
    const manifest = manifestSchema.parse(JSON.parse(text));
    if (canonicalJson(manifest) !== text) return fail();
    const { manifestDigest, ...core } = manifest;
    if (manifestDigest !== expectedManifestDigest
      || manifestDigest !== canonicalSha256Digest({ domain: CANDIDATE_SOURCE_MANIFEST_VERSION, manifest: core })) return fail();
    validate(core, request);
    const result = deepFreeze(manifest); manifests.add(result); return result;
  } catch { return fail(); }
  finally { owned?.fill(0); }
}

/** Producer helper: ALL files in exact request order, including unchanged files.
 * The caller already holds these bytes; no read consent is acquired here. Input
 * is snapshotted before hashing, one bounded file at a time; no source retained.
 * This does not bind mutable caller buffers to a later transfer. */
export function createCandidateSourceManifest(request: ManagedVerificationRequest, input: unknown): CandidateSourceManifest {
  if (!isManagedVerificationRequest(request)) return fail();
  try {
    if (typeof input !== "object" || input === null || types.isProxy(input) || !Array.isArray(input)
      || Object.getPrototypeOf(input) !== Array.prototype) return fail();
    const count = Object.getOwnPropertyDescriptor(input, "length")?.value as unknown;
    if (count !== request.files.length || typeof count !== "number" || count < 1
      || count > CANDIDATE_SOURCE_MANIFEST_LIMITS.files || Reflect.ownKeys(input).length !== count + 1) return fail();
    const files: z.infer<typeof fileSchema>[] = [];
    let total = 0;
    for (let index = 0; index < count; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return fail();
      const bytes = copyBytes(descriptor.value as unknown, Math.min(CANDIDATE_SOURCE_MANIFEST_LIMITS.fileBytes,
        CANDIDATE_SOURCE_MANIFEST_LIMITS.totalBytes - total));
      try {
        const expected = request.files[index]!;
        if (sha256Digest(bytes) !== expected.contentDigest) return fail();
        total += bytes.length;
        files.push({ relativePath: expected.relativePath, contentDigest: expected.contentDigest, byteLength: bytes.length });
      } finally { bytes.fill(0); }
    }
    const core = { schemaVersion: CANDIDATE_SOURCE_MANIFEST_VERSION,
      kind: "complete-source-identities-not-transfer-approval" as const,
      requestDigest: request.requestDigest, workspaceSubjectDigest: request.workspaceSubjectDigest,
      fileCount: files.length, byteLength: total, files, fullReadScopeIncluded: true as const, authority: "none" as const };
    const manifestDigest = canonicalSha256Digest({ domain: CANDIDATE_SOURCE_MANIFEST_VERSION, manifest: core });
    return parseCandidateSourceManifest(canonicalJson({ ...core, manifestDigest }), request, manifestDigest);
  } catch { return fail(); }
}

/** Verify a fresh complete byte copy against one exact manifest member. No file
 * is opened/written. This proves only this returned copy; not destination custody,
 * transfer completeness, exactly-once delivery, or authorization. Caller owns it. */
export function copyCandidateSourceFile(manifest: CandidateSourceManifest, index: number, input: unknown): Buffer {
  if (typeof manifest !== "object" || manifest === null || !manifests.has(manifest)
    || typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || index >= manifest.files.length) return fail();
  let bytes: Buffer | undefined;
  try {
    const file = manifest.files[index]!;
    bytes = copyBytes(input, file.byteLength);
    if (bytes.length !== file.byteLength || sha256Digest(bytes) !== file.contentDigest) return fail();
    return bytes;
  } catch { bytes?.fill(0); return fail(); }
}
