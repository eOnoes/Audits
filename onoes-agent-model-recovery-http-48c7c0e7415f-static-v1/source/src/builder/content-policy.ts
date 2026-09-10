import { createHash } from "node:crypto";

const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bbot\d{6,}:[A-Za-z0-9_-]{20,}\b/i,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\b\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{20,}/i,
];

export function sha256BuilderDigest(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function decodeBuilderText(bytes: Uint8Array): string {
  if (bytes.includes(0)) throw new TypeError("binary-rejected");
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new TypeError("binary-rejected");
  }
}

export function containsSecretLikeContent(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

export function countExactOccurrences(source: string, needle: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= source.length - needle.length) {
    const found = source.indexOf(needle, offset);
    if (found === -1) break;
    count += 1;
    // Advance one UTF-16 code unit so overlapping matches still make an exact
    // replacement anchor ambiguous (for example "aa" within "aaa").
    offset = found + 1;
  }
  return count;
}

/** Exact patch payloads are literal source bytes, never JS replacement syntax. */
export function replaceBuilderLiteral(source: string, before: string, after: string): string {
  return source.replace(before, () => after);
}
