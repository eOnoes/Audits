import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";

// Build-only: no HTTP route, UI, store mutation, bootstrap display or execution.
// Possession of a launcher-delivered secret is NOT proof of a human identity or
// isolation from a compromised host/browser. Never expose the factory over HTTP.
export const OPERATOR_PAIRING_TTL_MS = 120_000;
export const OPERATOR_SESSION_TTL_MS = 900_000;
export const OPERATOR_PAIRING_MAX_ATTEMPTS = 5;
const TOKEN = /^[a-f0-9]{64}$/;

export class OperatorSessionDenied extends Error {
  public constructor() {
    super("operator-session-denied");
    this.name = "OperatorSessionDenied";
  }
}

export interface OperatorSessionCredentials {
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly expiresAfterMs: typeof OPERATOR_SESSION_TTL_MS;
}

export interface OperatorSettingsSession {
  pair(bootstrapSecret: unknown): OperatorSessionCredentials;
  assertSession(sessionToken: unknown, csrfToken: unknown): void;
  revoke(): void;
}

function digest(token: string): Buffer {
  return createHash("sha256").update(token, "ascii").digest();
}

function matches(candidate: unknown, expected: Buffer): boolean {
  if (typeof candidate !== "string" || candidate.length !== 64 || !TOKEN.test(candidate)) return false;
  const actual = digest(candidate);
  try { return timingSafeEqual(actual, expected); }
  finally { actual.fill(0); }
}

class ProcessOperatorSession implements OperatorSettingsSession {
  readonly #clock: () => number;
  readonly #pairingStarted: number;
  #lastTime: number;
  #pairingHash: Buffer | undefined;
  #sessionHash: Buffer | undefined;
  #csrfHash: Buffer | undefined;
  #sessionStarted = 0;
  #attempts = 0;
  #closed = false;

  public constructor(secret: string, clock: () => number) {
    this.#clock = clock;
    let started: number;
    try { started = clock(); } catch { throw new OperatorSessionDenied(); }
    if (!Number.isFinite(started) || started < 0 || started > Number.MAX_SAFE_INTEGER) throw new OperatorSessionDenied();
    this.#lastTime = started;
    this.#pairingStarted = started;
    this.#pairingHash = digest(secret);
    Object.freeze(this);
  }

  public pair(secret: unknown): OperatorSessionCredentials {
    const now = this.#time();
    if (this.#sessionHash !== undefined) throw new OperatorSessionDenied();
    if (now - this.#pairingStarted >= OPERATOR_PAIRING_TTL_MS || this.#pairingHash === undefined) {
      this.revoke();
      throw new OperatorSessionDenied();
    }
    this.#attempts++;
    if (!matches(secret, this.#pairingHash)) {
      if (this.#attempts >= OPERATOR_PAIRING_MAX_ATTEMPTS) this.revoke();
      throw new OperatorSessionDenied();
    }
    try {
      const sessionToken = randomBytes(32).toString("hex");
      const csrfToken = randomBytes(32).toString("hex");
      this.#sessionHash = digest(sessionToken);
      this.#csrfHash = digest(csrfToken);
      this.#sessionStarted = now;
      this.#pairingHash.fill(0);
      this.#pairingHash = undefined;
      return Object.freeze({ sessionToken, csrfToken, expiresAfterMs: OPERATOR_SESSION_TTL_MS });
    } catch {
      this.revoke();
      throw new OperatorSessionDenied();
    }
  }

  public assertSession(sessionToken: unknown, csrfToken: unknown): void {
    const now = this.#time();
    if (this.#sessionHash === undefined || this.#csrfHash === undefined) throw new OperatorSessionDenied();
    if (now - this.#sessionStarted >= OPERATOR_SESSION_TTL_MS) {
      this.revoke();
      throw new OperatorSessionDenied();
    }
    const sessionMatches = matches(sessionToken, this.#sessionHash);
    const csrfMatches = matches(csrfToken, this.#csrfHash);
    if (!sessionMatches || !csrfMatches) throw new OperatorSessionDenied();
    // A successful check does not extend the lifetime or authorize an effect.
  }

  public revoke(): void {
    this.#closed = true;
    this.#pairingHash?.fill(0);
    this.#sessionHash?.fill(0);
    this.#csrfHash?.fill(0);
    this.#pairingHash = undefined;
    this.#sessionHash = undefined;
    this.#csrfHash = undefined;
  }

  #time(): number {
    if (this.#closed) throw new OperatorSessionDenied();
    let now: number;
    try { now = this.#clock(); }
    catch { this.revoke(); throw new OperatorSessionDenied(); }
    if (!Number.isFinite(now) || now < this.#lastTime || now > Number.MAX_SAFE_INTEGER) {
      this.revoke();
      throw new OperatorSessionDenied();
    }
    this.#lastTime = now;
    return now;
  }
}

/** Trusted launcher construction only. The returned bootstrap secret must be
 * delivered outside the unauthenticated dashboard surface and discarded there
 * after pairing. The monotonic clock is injectable by trusted tests, never HTTP.
 * The caller owns distribution; this module cannot make that distribution safe.
 */
export function createWindowsOperatorSession(clock: () => number = () => performance.now()): Readonly<{
  bootstrapSecret: string;
  pairingExpiresAfterMs: typeof OPERATOR_PAIRING_TTL_MS;
  session: OperatorSettingsSession;
}> {
  try {
    const bootstrapSecret = randomBytes(32).toString("hex");
    return Object.freeze({ bootstrapSecret, pairingExpiresAfterMs: OPERATOR_PAIRING_TTL_MS,
      session: new ProcessOperatorSession(bootstrapSecret, clock) });
  } catch { throw new OperatorSessionDenied(); }
}
