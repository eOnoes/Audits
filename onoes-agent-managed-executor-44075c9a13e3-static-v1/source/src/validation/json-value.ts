const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 100_000;

interface PendingValue {
  readonly value: unknown;
  readonly depth: number;
}

function inspectJsonShape(root: unknown): void {
  const pending: PendingValue[] = [{ value: root, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;

  while (pending.length > 0) {
    const current = pending.pop()!;
    nodes += 1;
    if (nodes > MAX_JSON_NODES || current.depth > MAX_JSON_DEPTH) throw new RangeError("json-value-complexity-exceeded");

    const value = current.value;
    if (value === null || typeof value === "string" || typeof value === "boolean") continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new TypeError("json-value-invalid-number");
      continue;
    }
    if (typeof value !== "object") throw new TypeError("json-value-invalid-type");
    if (seen.has(value)) throw new TypeError("json-value-repeated-reference");
    seen.add(value);

    const prototype = Object.getPrototypeOf(value);
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) throw new TypeError("json-value-invalid-array-prototype");
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1 || !keys.includes("length")) throw new TypeError("json-value-invalid-array-shape");
      for (let index = value.length - 1; index >= 0; index -= 1) {
        const key = String(index);
        if (!keys.includes(key)) throw new TypeError("json-value-sparse-array");
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("json-value-accessor-rejected");
        pending.push({ value: descriptor.value, depth: current.depth + 1 });
      }
      continue;
    }

    if (prototype !== Object.prototype && prototype !== null) throw new TypeError("json-value-invalid-object-prototype");
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) throw new TypeError("json-value-symbol-key-rejected");
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("json-value-accessor-rejected");
      pending.push({ value: descriptor.value, depth: current.depth + 1 });
    }
  }
}

export function canonicalizeJsonValue(input: unknown, maximumBytes: number): unknown {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw new RangeError("json-value-budget-invalid");
  inspectJsonShape(input);
  let encoded: string;
  try {
    const candidate = JSON.stringify(input);
    if (candidate === undefined) throw new TypeError("json-value-invalid-root");
    encoded = candidate;
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) throw error;
    throw new TypeError("json-value-encoding-failed");
  }
  if (new TextEncoder().encode(encoded).byteLength > maximumBytes) throw new RangeError("json-value-budget-exceeded");
  return JSON.parse(encoded) as unknown;
}
