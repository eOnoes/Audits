import { createHash } from "node:crypto";

export const CANONICAL_JSON_MAX_DEPTH = 64 as const;
export const CANONICAL_JSON_MAX_NODES = 100_000 as const;

interface CanonicalState {
  readonly seen: Set<object>;
  readonly active: Set<object>;
  nodes: number;
}

/**
 * Language-neutral Onoes canonical JSON contract.
 *
 * Objects use ascending UTF-16 key order, arrays retain order, and primitive
 * encoding follows ECMAScript JSON serialization. Unsupported values,
 * non-finite numbers, exotic prototypes, repeated references, cycles, and
 * over-complex inputs fail closed. Golden fixtures pin the resulting UTF-8
 * bytes for other runtimes.
 */
export function canonicalJson(value: unknown): string {
  return encodeCanonical(value, { seen: new Set<object>(), active: new Set<object>(), nodes: 0 }, 0);
}

function encodeCanonical(value: unknown, state: CanonicalState, depth: number): string {
  state.nodes += 1;
  if (depth > CANONICAL_JSON_MAX_DEPTH || state.nodes > CANONICAL_JSON_MAX_NODES) {
    throw new RangeError("canonical-json-complexity-exceeded");
  }
  if (value === null) return "null";
  if (typeof value === "string") {
    assertWellFormedUtf16(value);
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical-json-non-finite-number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (state.active.has(value)) throw new TypeError("canonical-json-cycle");
    if (state.seen.has(value)) throw new TypeError("canonical-json-repeated-reference");
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError("canonical-json-invalid-array-prototype");
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== value.length + 1 || !ownKeys.includes("length")) throw new TypeError("canonical-json-invalid-array-shape");
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError("canonical-json-invalid-array-shape");
      }
    }
    state.seen.add(value);
    state.active.add(value);
    const encoded = "[" + value.map((item) => encodeCanonical(item, state, depth + 1)).join(",") + "]";
    state.active.delete(value);
    return encoded;
  }
  if (typeof value === "object") {
    if (state.active.has(value)) throw new TypeError("canonical-json-cycle");
    if (state.seen.has(value)) throw new TypeError("canonical-json-repeated-reference");
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError("canonical JSON must contain only plain objects");
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) throw new TypeError("canonical-json-symbol-key-rejected");
    state.seen.add(value);
    state.active.add(value);
    const record = value as Record<string, unknown>;
    const keys = ownKeys as string[];
    for (const key of keys) assertWellFormedUtf16(key);
    const encoded = "{" + keys.sort().map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError("canonical-json-accessor-rejected");
      }
      return JSON.stringify(key) + ":" + encodeCanonical(record[key], state, depth + 1);
    }).join(",") + "}";
    state.active.delete(value);
    return encoded;
  }
  throw new TypeError("canonical-json-unsupported-value");
}

function assertWellFormedUtf16(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= value.length) throw new TypeError("canonical-json-unpaired-surrogate");
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) throw new TypeError("canonical-json-unpaired-surrogate");
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError("canonical-json-unpaired-surrogate");
    }
  }
}

export function sha256Digest(value: string | Uint8Array): string {
  return "sha256:" + createHash("sha256").update(value).digest("hex");
}

export function canonicalSha256Digest(value: unknown): string {
  return sha256Digest(canonicalJson(value));
}
