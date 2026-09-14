import { types } from "node:util";
import { sha256Digest } from "../compatibility/canonical-json.js";
import { type ManagedVerificationRequest } from "./windows-managed-verification-evidence.js";
import { CANDIDATE_SOURCE_MANIFEST_LIMITS, copyCandidateSourceFile, parseCandidateSourceManifest,
  type CandidateSourceManifest } from "./windows-candidate-source-manifest.js";

// Dormant byte framing only. No file/pipe/VM access, callbacks, approval, ledger
// mutation or launch. A trusted transport must enforce deadline, authentic peer
// and real EOF. Received bytes are NOT proof of protected destination storage.
export const CANDIDATE_SOURCE_TRANSFER_VERSION = "agent-candidate-source-transfer/v1" as const;
export const CANDIDATE_SOURCE_TRANSFER_LIMITS = Object.freeze({
  headerBytes: 44, chunkBytes: 65_536, chunks: 65_536,
  wireBytes: CANDIDATE_SOURCE_MANIFEST_LIMITS.totalBytes + 44 * CANDIDATE_SOURCE_MANIFEST_LIMITS.files,
});
const magic = Buffer.from("OCS1", "ascii");
const fail = (): never => { throw new Error("candidate-source-transfer-invalid"); };
const typedArrayPrototype: object = Object.getPrototypeOf(Uint8Array.prototype) as object;
const bufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const offsetGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")!.get!;
const lengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;

function copyChunk(input: unknown): Buffer {
  if (types.isProxy(input) || !types.isUint8Array(input)) return fail();
  const buffer: unknown = bufferGetter.call(input);
  const offset = offsetGetter.call(input) as number, length = lengthGetter.call(input) as number;
  if (!types.isArrayBuffer(buffer) || types.isSharedArrayBuffer(buffer)
    || length < 1 || length > CANDIDATE_SOURCE_TRANSFER_LIMITS.chunkBytes) return fail();
  return Buffer.from(Buffer.from(buffer, offset, length));
}

/** One file frame, including empty and unchanged files. Caller owns the returned
 * bytes and must clear them when done; this helper does not send anything. */
export function encodeCandidateSourceFileFrame(manifest: CandidateSourceManifest, index: number, input: unknown): Buffer {
  let bytes: Buffer | undefined;
  try {
    bytes = copyCandidateSourceFile(manifest, index, input);
    const frame = Buffer.alloc(CANDIDATE_SOURCE_TRANSFER_LIMITS.headerBytes + bytes.length);
    magic.copy(frame, 0);
    Buffer.from(manifest.manifestDigest.slice(7), "hex").copy(frame, 4);
    frame.writeUInt16LE(index, 36); // 38..39 reserved, exactly zero
    frame.writeUInt32LE(bytes.length, 40);
    bytes.copy(frame, 44);
    return frame;
  } catch { return fail(); }
  finally { bytes?.fill(0); }
}

export interface ReceivedCandidateSource {
  readonly schemaVersion: typeof CANDIDATE_SOURCE_TRANSFER_VERSION;
  readonly kind: "complete-source-bytes-not-guest-custody";
  readonly manifestDigest: string;
  readonly requestDigest: string;
  readonly workspaceSubjectDigest: string;
  readonly fileCount: number;
  readonly byteLength: number;
  readonly wireByteLength: number;
  readonly endOfInputDeclared: true;
  readonly destinationStored: false;
  readonly authority: "none";
}
const retained = new WeakMap<object, { manifest: CandidateSourceManifest; files: Buffer[] }>();

/** In-process possession only. A caller can retrieve source using this object;
 * do not hand it to untrusted code just because its JSON contains no file bytes. */
export function copyReceivedCandidateSourceFile(source: ReceivedCandidateSource, index: number): Buffer {
  const owned = retained.get(source);
  if (!owned || !Number.isSafeInteger(index) || index < 0 || index >= owned.files.length) return fail();
  return Buffer.from(owned.files[index]!);
}

export function discardReceivedCandidateSource(source: ReceivedCandidateSource): void {
  const owned = retained.get(source); if (!owned) return;
  retained.delete(source);
  for (const file of owned.files) file.fill(0);
  owned.files.length = 0;
}

/** Incremental, all-or-nothing receiver. Holds at most 16 MiB of file content,
 * one 44-byte header and one <=64 KiB chunk copy. No source is exposed before
 * finish(). All frames must appear once, in manifest order, with no suffix.
 * Any error permanently poisons this receiver and clears its owned buffers.
 * No timer here: the future transport must abort on timeout/disconnect/failure. */
export class CandidateSourceTransferReceiver {
  readonly #manifest: CandidateSourceManifest;
  readonly #pin: Buffer;
  readonly #header = Buffer.alloc(CANDIDATE_SOURCE_TRANSFER_LIMITS.headerBytes);
  #headerUsed = 0;
  #body: Buffer | undefined;
  #bodyUsed = 0;
  #files: Buffer[] = [];
  #chunks = 0;
  #wireBytes = 0;
  #closed = false;
  #result: ReceivedCandidateSource | undefined;

  constructor(manifestWire: unknown, request: ManagedVerificationRequest, expectedManifestDigest: string) {
    try { this.#manifest = parseCandidateSourceManifest(manifestWire, request, expectedManifestDigest); }
    catch { throw new Error("candidate-source-transfer-invalid"); }
    this.#pin = Buffer.from(this.#manifest.manifestDigest.slice(7), "hex");
  }

  write(input: unknown): void {
    let chunk: Buffer | undefined;
    try {
      if (this.#closed || ++this.#chunks > CANDIDATE_SOURCE_TRANSFER_LIMITS.chunks) return fail();
      chunk = copyChunk(input);
      this.#wireBytes += chunk.length;
      const expectedWireBytes = this.#manifest.byteLength + this.#manifest.fileCount * 44;
      if (this.#wireBytes > expectedWireBytes) return fail();
      let offset = 0;
      while (offset < chunk.length) {
        if (this.#files.length >= this.#manifest.fileCount) return fail();
        const expected = this.#manifest.files[this.#files.length]!;
        if (!this.#body) {
          const count = Math.min(44 - this.#headerUsed, chunk.length - offset);
          chunk.copy(this.#header, this.#headerUsed, offset, offset + count);
          offset += count; this.#headerUsed += count;
          if (this.#headerUsed < 44) continue;
          if (!this.#header.subarray(0, 4).equals(magic) || !this.#header.subarray(4, 36).equals(this.#pin)
            || this.#header.readUInt16LE(36) !== this.#files.length || this.#header.readUInt16LE(38) !== 0
            || this.#header.readUInt32LE(40) !== expected.byteLength) return fail();
          // Length has already been bounded by the pinned, complete manifest.
          this.#body = Buffer.alloc(expected.byteLength); this.#bodyUsed = 0;
        }
        const count = Math.min(this.#body.length - this.#bodyUsed, chunk.length - offset);
        chunk.copy(this.#body, this.#bodyUsed, offset, offset + count);
        offset += count; this.#bodyUsed += count;
        if (this.#bodyUsed === this.#body.length) {
          if (sha256Digest(this.#body) !== expected.contentDigest) return fail();
          this.#files.push(this.#body); this.#body = undefined; this.#bodyUsed = 0;
          this.#header.fill(0); this.#headerUsed = 0;
        }
      }
    } catch { this.abort(); return fail(); }
    finally { chunk?.fill(0); }
  }

  /** Caller must invoke ONLY after actual clean transport EOF/settlement. This
   * method cannot authenticate that claim or observe process exit itself. */
  finish(): ReceivedCandidateSource {
    try {
      if (this.#closed || this.#body || this.#headerUsed !== 0 || this.#files.length !== this.#manifest.fileCount
        || this.#wireBytes !== this.#manifest.byteLength + this.#manifest.fileCount * 44) return fail();
      this.#closed = true;
      const result: ReceivedCandidateSource = Object.freeze({ schemaVersion: CANDIDATE_SOURCE_TRANSFER_VERSION,
        kind: "complete-source-bytes-not-guest-custody", manifestDigest: this.#manifest.manifestDigest,
        requestDigest: this.#manifest.requestDigest, workspaceSubjectDigest: this.#manifest.workspaceSubjectDigest,
        fileCount: this.#files.length, byteLength: this.#manifest.byteLength, wireByteLength: this.#wireBytes,
        endOfInputDeclared: true, destinationStored: false, authority: "none" });
      retained.set(result, { manifest: this.#manifest, files: this.#files });
      this.#files = []; this.#result = result; return result;
    } catch { this.abort(); return fail(); }
  }

  /** Idempotent. Also revokes a finished in-process snapshot. Cannot erase
   * caller copies, strings, runtime copies or OS memory; not secure erasure. */
  abort(): void {
    this.#closed = true; this.#header.fill(0); this.#headerUsed = 0;
    this.#body?.fill(0); this.#body = undefined; this.#bodyUsed = 0;
    for (const file of this.#files) file.fill(0);
    this.#files.length = 0;
    if (this.#result) discardReceivedCandidateSource(this.#result);
  }
}
