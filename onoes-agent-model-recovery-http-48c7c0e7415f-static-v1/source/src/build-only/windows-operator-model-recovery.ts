import { performance } from "node:perf_hooks";
import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import type { OperatorSettingsSession } from "./windows-operator-session.js";
import { MANAGED_MODEL_RECOVERY_MAX_BYTES, type SqliteManagedModelBudget } from "./windows-managed-model-budget.js";

// Dormant host-owned read boundary, not an HTTP route or production consumer.
// Its caller must preserve one controller per session/book lifetime; recreating
// it per request defeats rate limits. Pairing/secret delivery remains host-owned.
export const OPERATOR_MODEL_RECOVERY_LIMITS = Object.freeze({ requestBytes: 512,
  responseBytes: MANAGED_MODEL_RECOVERY_MAX_BYTES + 1024, readsPerMinute: 2, windowMs: 60_000 });
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const schema = z.object({ schemaVersion: z.literal("agent-operator-model-recovery-request/v1"),
  action: z.literal("read"), budgetDigest: digest, readAllocationMetadata: z.literal(true) }).strict();
type Reason = "configuration-invalid" | "session-denied" | "request-invalid" | "rate-limited"
  | "clock-invalid" | "closed" | "inventory-unavailable";
export class OperatorModelRecoveryError extends Error {
  constructor(readonly reason: Reason) { super(`operator-model-recovery-${reason}`); this.name = "OperatorModelRecoveryError"; }
}
const fail = (reason: Reason): never => { throw new OperatorModelRecoveryError(reason); };

export class WindowsOperatorModelRecovery {
  readonly #authenticate: OperatorSettingsSession["assertSession"];
  readonly #snapshot: SqliteManagedModelBudget["recoverySnapshot"];
  readonly #budgetDigest: string;
  readonly #clock: () => number;
  #lastTime = 0;
  #attempts: number[] = [];
  #closed = false;
  constructor(options: { session: Pick<OperatorSettingsSession, "assertSession">;
    book: Pick<SqliteManagedModelBudget, "recoverySnapshot">; expectedBudgetDigest: string; now?: () => number }) {
    if (!digest.safeParse(options.expectedBudgetDigest).success) throw new OperatorModelRecoveryError("configuration-invalid");
    this.#budgetDigest = options.expectedBudgetDigest;
    this.#authenticate = options.session.assertSession.bind(options.session);
    this.#snapshot = options.book.recoverySnapshot.bind(options.book);
    this.#clock = options.now ?? (() => performance.now());
  }
  close(): void { this.#closed = true; }
  #session(sessionToken: unknown, csrfToken: unknown): void {
    try { this.#authenticate(sessionToken, csrfToken); } catch { return fail("session-denied"); }
  }
  #time(): number {
    let now: number;
    try { now = this.#clock(); } catch { this.close(); return fail("clock-invalid"); }
    if (!Number.isFinite(now) || now < this.#lastTime || now > Number.MAX_SAFE_INTEGER) {
      this.close(); return fail("clock-invalid");
    }
    this.#lastTime = now; return now;
  }
  read(wire: unknown, sessionToken: unknown, csrfToken: unknown): string {
    // Invalid sessions cannot use this API to inspect a book or consume its quota.
    this.#session(sessionToken, csrfToken);
    if (this.#closed) return fail("closed");
    const now = this.#time();
    this.#attempts = this.#attempts.filter(time => now - time < OPERATOR_MODEL_RECOVERY_LIMITS.windowMs);
    if (this.#attempts.length >= OPERATOR_MODEL_RECOVERY_LIMITS.readsPerMinute) return fail("rate-limited");
    this.#attempts.push(now); // Authenticated malformed requests and read failures also count.
    let request: z.infer<typeof schema>;
    try {
      if (typeof wire !== "string" || wire.length > OPERATOR_MODEL_RECOVERY_LIMITS.requestBytes
        || Buffer.byteLength(wire) > OPERATOR_MODEL_RECOVERY_LIMITS.requestBytes) return fail("request-invalid");
      request = schema.parse(JSON.parse(wire));
      if (canonicalJson(request) !== wire || request.budgetDigest !== this.#budgetDigest) return fail("request-invalid");
    } catch { return fail("request-invalid"); }
    let response: string;
    try {
      // The host supplies the validated journal implementation, never a caller-
      // chosen database path, snapshot object or generic callback from HTTP.
      const inventory = this.#snapshot();
      if (inventory.summary.budgetDigest !== this.#budgetDigest
        || Buffer.byteLength(canonicalJson(inventory)) > MANAGED_MODEL_RECOVERY_MAX_BYTES) return fail("inventory-unavailable");
      response = canonicalJson({ schemaVersion: "agent-operator-model-recovery-response/v1",
        kind: "paired-read-only-allocation-observation-not-authorization", requestDigest: canonicalSha256Digest(request),
        budgetDigest: this.#budgetDigest, inventory, approvalAvailable: false, executionEnabled: false,
        automaticRetryAvailable: false, authority: "none" });
      if (Buffer.byteLength(response) > OPERATOR_MODEL_RECOVERY_LIMITS.responseBytes) return fail("inventory-unavailable");
    } catch { return fail("inventory-unavailable"); }
    // No disclosure after an expired/revoked session or host close during read.
    this.#time(); this.#session(sessionToken, csrfToken);
    if (this.#closed) return fail("closed");
    return response;
  }
}
