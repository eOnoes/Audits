import { performance } from "node:perf_hooks";
import { z } from "zod";
import type { ManagedReadOnlyVerifier } from "./windows-managed-builder-executor.js";
import { isManagedVerificationRequest, MANAGED_VERIFICATION_MAX_RESULT_BYTES,
  parseManagedVerificationResult, type ManagedVerificationRequest } from "./windows-managed-verification-evidence.js";

// Dormant lifecycle composition, not a Hyper-V adapter or approval issuer. The
// host must prepare an exclusive, authenticated ONE-SHOT session before creating
// this object. Preparation must not launch work: rejected/pre-aborted requests
// make no port calls. The host owns cleanup of any pre-existing VM/resources.
// No default port, process spawn, credentials, VM boot or HTTP route.
// The real port and installer still need scoped execution and independent review.
export interface ManagedVmVerificationSession {
  readonly vmId: string;
  readonly sessionId: string;
  /** Fixed allowlisted runner only; request is identity, never launch material.
   * Bound transport allocation before producing this string. A returned value
   * or rejection does NOT assert guest/descendant quiescence. */
  run(request: ManagedVerificationRequest, signal: AbortSignal): Promise<string>;
  /** Host-side observation, never guest-supplied JSON. Permanently prohibit new
   * launch/restart for this session and confirm the exact VM is Off. This must
   * not depend on the caller's revoked/expired permission to stop work. Never
   * resolve from root-process exit, guest result bytes, Saved or Stopping state.
   * No retry/reboot/adoption after uncertain completion. The port must enforce
   * exclusive one-shot ownership across wrappers/processes; this class's latch
   * is only per instance and is not durable cross-process enforcement. */
  stopAndConfirm(): Promise<Readonly<{ vmId: string; sessionId: string; state: "Off"; dispatchClosed: true }>>;
}
export const MANAGED_VM_VERIFIER_LIMITS = Object.freeze({ runMs: 60_000, stopMs: 10_000 });
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const stoppedSchema = z.object({ vmId: uuid, sessionId: uuid, state: z.literal("Off"), dispatchClosed: z.literal(true) }).strict();
// Prevent accidental double wrapping of the same host capability object. This
// is not process-persistent ownership or protection against a host creating clones.
const boundSessions = new WeakSet<object>();
type State = "idle" | "running" | "stopping" | "settled" | "unconfirmed";
type Failure = "cancelled" | "timeout" | "runner-failed" | "result-invalid" | "clock-invalid";
const denied = (reason: string): Error => new Error(`managed-vm-verification-${reason}`);
function limit(value: number | undefined, maximum: number): number {
  const result = value ?? maximum;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) throw denied("budget-invalid");
  return result;
}

/** Reuses the executor's branded request and exact result parser. Both success
 * AND rejection after run contact are withheld until run/stop promises settle
 * and a matching host-Off observation arrives within the stop budget. Otherwise
 * verify stays pending forever and state latches unconfirmed: the existing
 * executor's bounded grace then quarantines instead of rolling back alongside
 * unknown activity. This deliberately cannot make a hung host port preemptible.
 * State is in-memory diagnostics, NOT a durable blocker or authority receipt. */
export class WindowsManagedVmVerifier implements ManagedReadOnlyVerifier {
  readonly #run: ManagedVmVerificationSession["run"];
  readonly #stop: ManagedVmVerificationSession["stopAndConfirm"];
  readonly #vmId: string;
  readonly #sessionId: string;
  readonly #runMs: number;
  readonly #stopMs: number;
  readonly #now: () => number;
  #last = -Infinity;
  #clockFailed = false;
  #state: State = "idle";
  #confirmQuiescence!: () => void;
  readonly #quiescent = new Promise<void>(resolve => { this.#confirmQuiescence = resolve; });
  constructor(session: ManagedVmVerificationSession, options: {
    readonly runTimeoutMs?: number; readonly stopTimeoutMs?: number; readonly now?: () => number;
  } = {}) {
    if (boundSessions.has(session)) throw denied("session-already-bound");
    this.#vmId = uuid.parse(session.vmId); this.#sessionId = uuid.parse(session.sessionId);
    this.#run = session.run.bind(session); this.#stop = session.stopAndConfirm.bind(session);
    this.#runMs = limit(options.runTimeoutMs, MANAGED_VM_VERIFIER_LIMITS.runMs);
    this.#stopMs = limit(options.stopTimeoutMs, MANAGED_VM_VERIFIER_LIMITS.stopMs);
    this.#now = options.now ?? (() => performance.now());
    boundSessions.add(session);
  }
  get state(): State { return this.#state; }
  #time(): number {
    try {
      if (this.#clockFailed) throw denied("clock-invalid");
      const current = this.#now();
      if (!Number.isFinite(current) || current < 0 || current < this.#last) throw denied("clock-invalid");
      this.#last = current; return current;
    } catch { this.#clockFailed = true; throw denied("clock-invalid"); }
  }
  async verify(request: ManagedVerificationRequest, signal: AbortSignal): Promise<string> {
    if (this.#state !== "idle") {
      // The executor interprets any rejection as related work being settled.
      // Reuse denial must not imply that while this shared session is live or
      // unconfirmed. Only confirmed quiescence can release this rejection.
      await this.#quiescent;
      throw denied("session-used");
    }
    if (!isManagedVerificationRequest(request)) throw denied("request-untrusted");
    if (signal.aborted) throw denied("cancelled");
    let started: number;
    try { started = this.#time(); } catch {
      this.#state = "unconfirmed";
      this.#confirmQuiescence(); // No run or stop contact occurred.
      throw denied("clock-invalid");
    }
    this.#state = "running";
    const deadline = started + Math.min(this.#runMs, request.timeoutMs);
    const controller = new AbortController();
    let failure: Failure | undefined, wire: string | undefined;
    let stopStarted = false, stopAt = 0;
    let runTimer: ReturnType<typeof setTimeout> | undefined, stopTimer: ReturnType<typeof setTimeout> | undefined;
    let finishStop!: (valid: boolean) => void, expireStop!: (valid: false) => void;
    const stopDone = new Promise<boolean>(resolve => { finishStop = resolve; });
    const stopExpired = new Promise<false>(resolve => { expireStop = resolve; });
    const stopOnce = () => {
      if (stopStarted) return;
      stopStarted = true; this.#state = "stopping";
      clearTimeout(runTimer);
      try { stopAt = this.#time(); } catch { failure ??= "clock-invalid"; }
      stopTimer = setTimeout(() => expireStop(false), this.#stopMs);
      // Set the one-way latch BEFORE abort callbacks or port code can reenter.
      controller.abort();
      void Promise.resolve().then(() => this.#stop()).then(value => {
        try {
          const stopped = stoppedSchema.parse(value);
          finishStop(stopped.vmId === this.#vmId && stopped.sessionId === this.#sessionId);
        } catch { finishStop(false); }
      }, () => finishStop(false));
    };
    const onAbort = () => { failure ??= "cancelled"; stopOnce(); };
    signal.addEventListener("abort", onAbort, { once: true });
    runTimer = setTimeout(() => { failure ??= "timeout"; stopOnce(); }, Math.min(this.#runMs, request.timeoutMs));
    // Invoke directly: no deferred launch may begin after stop has been selected.
    // Attach both settlement handlers even if run throws synchronously.
    let work: Promise<string>;
    try { work = Promise.resolve(this.#run(request, controller.signal)); }
    catch { work = Promise.reject(denied("runner-failed")); }
    const runDone = work.then(value => {
      if (failure !== undefined) return;
      try {
        if (signal.aborted) { failure = "cancelled"; return; }
        if (this.#time() >= deadline) { failure = "timeout"; return; }
        // Only immutable strings cross this port. No getters/shared byte views.
        if (typeof value !== "string" || value.length > MANAGED_VERIFICATION_MAX_RESULT_BYTES
          || Buffer.byteLength(value) > MANAGED_VERIFICATION_MAX_RESULT_BYTES) throw denied("result-invalid");
        parseManagedVerificationResult(value, request); wire = value;
      } catch { failure = "result-invalid"; }
    }, () => { failure ??= "runner-failed"; }).then(stopOnce);
    const allStopped = Promise.all([runDone, stopDone]).then(([, valid]) => valid);
    let settled = await Promise.race([allStopped, stopExpired]);
    clearTimeout(runTimer); clearTimeout(stopTimer); signal.removeEventListener("abort", onAbort);
    try {
      const now = this.#time();
      if (now - stopAt >= this.#stopMs) settled = false;
      if (now >= deadline) failure ??= "timeout";
    } catch { settled = false; }
    if (!settled) {
      wire = undefined; this.#state = "unconfirmed";
      // Never turn an uncertain stop into a settled rejection. Late promise
      // resolution is already handled but cannot reset this latch or release data.
      return new Promise<string>(() => {});
    }
    this.#state = "settled";
    this.#confirmQuiescence();
    if (signal.aborted) failure ??= "cancelled";
    if (failure !== undefined || wire === undefined) throw denied(failure ?? "result-invalid");
    return wire;
  }
}
