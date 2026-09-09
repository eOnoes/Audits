import { z } from "zod";
import { canonicalJson, canonicalSha256Digest, sha256Digest } from "../compatibility/canonical-json.js";

/** Byte preparation only: no filesystem, service, credential, approval or execution.
 * The future broker must independently authorize and physically protect import.
 * These bytes are untrusted content, never broker-executable code.
 */
export const MANAGED_IMPORT_SCHEMA = "onoes-managed-workspace-import/v1" as const;
export const MANAGED_IMPORT_LIMITS = Object.freeze({
  frameBytes: 6 * 1024 * 1024,
  fileBytes: 1024 * 1024,
  totalBytes: 4 * 1024 * 1024,
  files: 64,
  pathChars: 240,
  segments: 16,
});

const entrySchema = z.object({
  relativePath: z.string().min(1).max(MANAGED_IMPORT_LIMITS.pathChars),
  contentBase64: z.string().max(4 * Math.ceil(MANAGED_IMPORT_LIMITS.fileBytes / 3)),
  sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();
const frameSchema = z.object({
  schemaVersion: z.literal(MANAGED_IMPORT_SCHEMA),
  files: z.array(entrySchema).min(1).max(MANAGED_IMPORT_LIMITS.files),
}).strict();

type ImportManifestEntry = Readonly<{ relativePath: string; byteLength: number; sha256: string }>;
export type PreparedManagedImport = Readonly<{
  kind: "prepared-content-not-authorization";
  manifestDigest: string;
  files: readonly ImportManifestEntry[];
  summary: Readonly<{ status: "prepared"; fileCount: number; byteLength: number }>;
}>;

// Output records are descriptive, not capabilities. The private association only
// prevents accidentally substituting a serialized/lookalike record in read-back.
const snapshots = new WeakMap<PreparedManagedImport, readonly Buffer[]>();
const invalid = (): never => { throw new Error("managed-import-invalid"); };

function segmentsFor(relativePath: string): string[] {
  // A new format, not a change to historical signed Builder path ordering.
  // ASCII-only pilot: no path normalization, ADS, devices, short-name syntax,
  // traversal, absolute paths, alternate separators or metadata import.
  if (/[^A-Za-z0-9._@+(), /-]/.test(relativePath)) return invalid();
  const segments = relativePath.split("/");
  if (segments.length > MANAGED_IMPORT_LIMITS.segments || segments.some((segment) =>
    segment.length === 0 || segment.length > 64 || segment === "." || segment === ".."
    || segment.startsWith(" ") || /[ .]$/.test(segment)
    || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:[ .]|$)/i.test(segment)
    || segment.toLowerCase() === ".git"
    || segment.toLowerCase() === ".onoes-io.lock"
    || segment.toLowerCase().startsWith(".onoes-import-")
    || segment.toLowerCase().startsWith(".onoes-stage-"))) return invalid();
  return segments;
}

/** Input must be canonical UTF-8 JSON with no BOM, duplicate keys or trailing
 * bytes. Size is checked before decoding/parsing; there is no decompression.
 * The frame and each decoded file are copied into privately held memory.
 */
export function prepareManagedImport(frame: Uint8Array): PreparedManagedImport {
  if (!(frame instanceof Uint8Array) || frame.buffer instanceof SharedArrayBuffer
    || frame.byteLength === 0 || frame.byteLength > MANAGED_IMPORT_LIMITS.frameBytes) return invalid();
  let text: string;
  let input: z.infer<typeof frameSchema>;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.from(frame));
    const parsed: unknown = JSON.parse(text);
    if (canonicalJson(parsed) !== text) return invalid();
    input = frameSchema.parse(parsed);
  } catch { return invalid(); }

  const spelling = new Map<string, string>();
  const fileKeys = new Set<string>();
  const directoryKeys = new Set<string>();
  const entries: { manifest: ImportManifestEntry; bytes: Buffer }[] = [];
  let total = 0;
  for (const file of input.files) {
    const segments = segmentsFor(file.relativePath);
    for (let i = 1; i <= segments.length; i += 1) {
      const exact = segments.slice(0, i).join("/");
      const key = exact.toLowerCase();
      const prior = spelling.get(key);
      if (prior !== undefined && prior !== exact) return invalid();
      spelling.set(key, exact);
      if (i === segments.length) {
        if (fileKeys.has(key) || directoryKeys.has(key)) return invalid();
        fileKeys.add(key);
      } else {
        if (fileKeys.has(key)) return invalid();
        directoryKeys.add(key);
      }
    }
    const bytes = Buffer.from(file.contentBase64, "base64");
    // Node's decoder is permissive; round-trip rejects ignored characters,
    // missing padding, URL-safe aliases and nonzero unused padding bits.
    if (bytes.toString("base64") !== file.contentBase64
      || bytes.byteLength > MANAGED_IMPORT_LIMITS.fileBytes
      || sha256Digest(bytes) !== file.sha256) return invalid();
    total += bytes.byteLength;
    if (total > MANAGED_IMPORT_LIMITS.totalBytes) return invalid();
    entries.push({ manifest: Object.freeze({ relativePath: file.relativePath,
      byteLength: bytes.byteLength, sha256: file.sha256 }), bytes });
  }
  // Exact ASCII order, independent of platform locale or request array order.
  entries.sort((a, b) => a.manifest.relativePath < b.manifest.relativePath ? -1 : 1);
  const files = Object.freeze(entries.map((entry) => entry.manifest));
  const result: PreparedManagedImport = Object.freeze({
    kind: "prepared-content-not-authorization",
    manifestDigest: canonicalSha256Digest({ schemaVersion: MANAGED_IMPORT_SCHEMA, files }),
    files,
    summary: Object.freeze({ status: "prepared", fileCount: files.length, byteLength: total }),
  });
  snapshots.set(result, entries.map((entry) => entry.bytes));
  return result;
}

/** Exact-name read-back always returns a new byte copy, never a retained buffer.
 * Possession of a prepared record grants no filesystem rights. Do not log the
 * manifest: names and unsalted content digests can reveal/correlate user data.
 */
export function readPreparedManagedFile(prepared: PreparedManagedImport, relativePath: string): Buffer {
  const bytes = snapshots.get(prepared);
  if (bytes === undefined) return invalid();
  const index = prepared.files.findIndex((file) => file.relativePath === relativePath);
  const found = bytes[index];
  if (found === undefined) return invalid();
  return Buffer.from(found);
}

/** Cancellation releases this preparer's retained copies. It cannot erase a
 * caller's original frame, copies already returned, or runtime/OS memory copies.
 */
export function discardPreparedManagedImport(prepared: PreparedManagedImport): void {
  const bytes = snapshots.get(prepared);
  if (bytes === undefined) return;
  for (const file of bytes) file.fill(0);
  snapshots.delete(prepared);
}
