import { z } from "zod";
import { canonicalJson as wire, canonicalSha256Digest as hash, sha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { effectUuid } from "./windows-candidate-effect-state.js";
import { CANDIDATE_V3_META_MAX_BYTES } from "./windows-candidate-v3-data.js";
import { CANDIDATE_V3_MAX_INVENTORY_BYTES } from "./windows-candidate-v3-inventory.js";
import { CANDIDATE_V3_MAX_CHECKPOINT_BYTES } from "./windows-candidate-v3-record.js";

// DORMANT DATA CONTRACT. No IPC, process, clock, authentication, custody or
// task authority. These hashes bind supplied bytes, not their truthful origin.
export const V3_MESSAGE_LIMITS = Object.freeze({ headerBytes: 4_096, responseBytes: 16_384,
  bootstrapBytes: 256 * 1024 * 1024 + 65_536, appendBytes: 128 * 1024 * 1024 + 65_536,
  bootstrapMs: 30_000, appendMs: 10_000 });
export type CandidateV3Operation = "bootstrap" | "append";
export class CandidateV3MessageError extends Error {
  constructor() { super("candidate-v3-message-invalid"); this.name = "CandidateV3MessageError"; }
}
const fail = (): never => { throw new CandidateV3MessageError(); };
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identity = z.tuple([digest, digest, digest, digest]);
export type CandidateV3Identity = Readonly<z.infer<typeof identity>>;
const common = { lifetimeId: effectUuid, nonce: effectUuid, epoch: effectUuid, deadline: z.number().int().nonnegative().safe() };
const bootstrapHeader = z.object({ domain: z.literal("agent-candidate-v3-bootstrap-request/v1"), operation: z.literal("bootstrap"),
  ...common, requestNumber: z.literal(0), anchorHistoryDigest: digest }).strict();
const appendHeader = z.object({ domain: z.literal("agent-candidate-v3-append-request/v1"), operation: z.literal("append"),
  ...common, requestNumber: z.number().int().positive().safe(), pre: identity }).strict();
const bootstrapBindings = bootstrapHeader.extend({ metadataDigest: digest, inventoryDigest: digest, historyDigest: digest });
const appendBindings = appendHeader.extend({ inputDigest: digest, checkpointDigest: digest });
const bootstrapRequest = bootstrapBindings.extend({ metadataWire: z.string(), inventoryWire: z.string(), historyWire: z.string() });
const appendRequest = appendBindings.extend({ inventoryWire: z.string(), checkpointWire: z.string() });
const bootstrapResponse = bootstrapBindings.omit({ domain: true }).extend({ domain: z.literal("agent-candidate-v3-bootstrap-response/v1"),
  requestDigest: digest, post: identity, resultDigest: digest });
const appendResponse = appendBindings.omit({ domain: true }).extend({ domain: z.literal("agent-candidate-v3-append-response/v1"),
  requestDigest: digest, post: identity, resultDigest: digest });
type BootstrapRequest = z.infer<typeof bootstrapRequest>;
type AppendRequest = z.infer<typeof appendRequest>;
export type CandidateV3Request = Readonly<BootstrapRequest | AppendRequest>;

export function boundedV3Text(value: unknown, cap: number): string {
  if (!Number.isSafeInteger(cap) || cap < 0 || cap > V3_MESSAGE_LIMITS.bootstrapBytes
    || typeof value !== "string" || value.length > cap || Buffer.byteLength(value, "utf8") > cap) return fail();
  return value;
}

/** Exact JSON string-content UTF-8 size, excluding enclosing quotes. No encoded
 * copy or user-object reflection. Early denial once the remaining budget ends. */
export function candidateV3EscapedBytes(value: unknown, remaining: number): number {
  const text = boundedV3Text(value, remaining);
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const n = text.charCodeAt(i);
    if (n >= 0xd800 && n <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return fail();
      bytes += 4;
    } else if (n >= 0xdc00 && n <= 0xdfff) return fail();
    else if (n === 34 || n === 92 || n === 8 || n === 9 || n === 10 || n === 12 || n === 13) bytes += 2;
    else if (n < 32) bytes += 6;
    else bytes += n < 128 ? 1 : n < 2048 ? 2 : 3;
    if (bytes > remaining) return fail();
  }
  return bytes;
}

// Only parsed headers and internally constructed primitive payload fields reach
// this helper. Complete envelope serialization happens AFTER exact preflight.
function encode(header: Record<string, unknown>, fields: Record<string, string>, cap: number): string {
  const empty = { ...header, ...Object.fromEntries(Object.keys(fields).map(k => [k, ""])) };
  let bytes = Buffer.byteLength(wire(empty));
  if (bytes > cap) return fail();
  for (const value of Object.values(fields)) bytes += candidateV3EscapedBytes(value, cap - bytes);
  const result = wire({ ...header, ...fields });
  if (Buffer.byteLength(result) !== bytes) return fail();
  return boundedV3Text(result, cap);
}
function parse<T>(schema: z.ZodType<T>, input: unknown, cap: number): T {
  try {
    const text = boundedV3Text(input, cap), parsed = schema.parse(JSON.parse(text));
    if (wire(parsed) !== text) return fail();
    return deepFreeze(parsed);
  } catch { return fail(); }
}
export function encodeCandidateV3BootstrapRequest(headerWire: unknown, metadata: unknown, inventory: unknown, history: unknown): string {
  const header = parse(bootstrapHeader, headerWire, V3_MESSAGE_LIMITS.headerBytes);
  const metadataWire = boundedV3Text(metadata, CANDIDATE_V3_META_MAX_BYTES);
  const inventoryWire = boundedV3Text(inventory, CANDIDATE_V3_MAX_INVENTORY_BYTES);
  const historyWire = boundedV3Text(history, CANDIDATE_V3_MAX_INVENTORY_BYTES);
  return encode({ ...header, metadataDigest: sha256Digest(metadataWire), inventoryDigest: sha256Digest(inventoryWire), historyDigest: sha256Digest(historyWire) },
    { metadataWire, inventoryWire, historyWire }, V3_MESSAGE_LIMITS.bootstrapBytes);
}
export function encodeCandidateV3AppendRequest(headerWire: unknown, inventory: unknown, checkpoint: unknown): string {
  const header = parse(appendHeader, headerWire, V3_MESSAGE_LIMITS.headerBytes);
  const inventoryWire = boundedV3Text(inventory, CANDIDATE_V3_MAX_INVENTORY_BYTES);
  const checkpointWire = boundedV3Text(checkpoint, CANDIDATE_V3_MAX_CHECKPOINT_BYTES);
  return encode({ ...header, inputDigest: sha256Digest(inventoryWire), checkpointDigest: sha256Digest(checkpointWire) },
    { inventoryWire, checkpointWire }, V3_MESSAGE_LIMITS.appendBytes);
}
export function parseCandidateV3Request(operation: CandidateV3Operation, input: unknown): CandidateV3Request {
  // Expected operation comes from the caller's private phase, not a field in
  // the unparsed transport. Enforce its own cap BEFORE JSON.parse.
  try {
    if (operation !== "bootstrap" && operation !== "append") return fail();
    const cap = operation === "bootstrap" ? V3_MESSAGE_LIMITS.bootstrapBytes : V3_MESSAGE_LIMITS.appendBytes;
    const text = boundedV3Text(input, cap), decoded: unknown = JSON.parse(text);
    const value = operation === "bootstrap" ? bootstrapRequest.parse(decoded) : appendRequest.parse(decoded);
    boundedV3Text(value.inventoryWire, CANDIDATE_V3_MAX_INVENTORY_BYTES);
    if (value.operation === "bootstrap") {
      boundedV3Text(value.metadataWire, CANDIDATE_V3_META_MAX_BYTES); boundedV3Text(value.historyWire, CANDIDATE_V3_MAX_INVENTORY_BYTES);
      if (value.metadataDigest !== sha256Digest(value.metadataWire) || value.inventoryDigest !== sha256Digest(value.inventoryWire)
        || value.historyDigest !== sha256Digest(value.historyWire)) return fail();
    } else {
      boundedV3Text(value.checkpointWire, CANDIDATE_V3_MAX_CHECKPOINT_BYTES);
      if (value.inputDigest !== sha256Digest(value.inventoryWire) || value.checkpointDigest !== sha256Digest(value.checkpointWire)) return fail();
    }
    if (wire(value) !== text) return fail();
    return deepFreeze(value);
  } catch { return fail(); }
}
function responseCore(q: CandidateV3Request, requestDigest: string, post: z.infer<typeof identity>) {
  if (q.operation === "bootstrap") {
    const { metadataWire: _m, inventoryWire: _i, historyWire: _h, domain: _d, ...bindings } = q;
    return { ...bindings, domain: "agent-candidate-v3-bootstrap-response/v1" as const, requestDigest, post };
  }
  const { inventoryWire: _i, checkpointWire: _c, domain: _d, ...bindings } = q;
  return { ...bindings, domain: "agent-candidate-v3-append-response/v1" as const, requestDigest, post };
}
function checkKnownPost(q: CandidateV3Request, post: CandidateV3Identity): void {
  if (q.operation === "bootstrap") {
    if (post[0] !== q.metadataDigest || post[1] !== q.inventoryDigest || post[2] !== q.historyDigest) return fail();
  } else if (post[0] !== q.pre[0] || post[1] !== q.inputDigest) return fail();
  // Remaining components still require the coordinator's staged-state check;
  // this does not replace pure history validation or durable-pair confirmation.
}
/** All public inputs are primitive canonical strings, including the identity.
 * This encodes a CLAIM, not proof the caller validated or durably committed it. */
export function encodeCandidateV3Response(operation: CandidateV3Operation, requestWire: unknown, postIdentityWire: unknown): string {
  const q = parseCandidateV3Request(operation, requestWire), post = parse(identity, postIdentityWire, V3_MESSAGE_LIMITS.headerBytes);
  checkKnownPost(q, post);
  const core = responseCore(q, sha256Digest(requestWire as string), post);
  return boundedV3Text(wire({ ...core, resultDigest: hash(core) }), V3_MESSAGE_LIMITS.responseBytes);
}
export function parseCandidateV3Response(operation: CandidateV3Operation, input: unknown, requestWire: unknown) {
  // Reject oversized or active responses before touching the pending request.
  const text = boundedV3Text(input, V3_MESSAGE_LIMITS.responseBytes);
  const q = parseCandidateV3Request(operation, requestWire);
  const r = q.operation === "bootstrap" ? parse(bootstrapResponse, text, V3_MESSAGE_LIMITS.responseBytes)
    : parse(appendResponse, text, V3_MESSAGE_LIMITS.responseBytes);
  const { resultDigest, ...core } = r;
  if (hash(core) !== resultDigest || wire(core) !== wire(responseCore(q, sha256Digest(requestWire as string), r.post))) return fail();
  checkKnownPost(q, r.post);
  return r;
}
