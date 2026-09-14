import type { WindowsManagedVmControllerChannel } from "./windows-managed-vm-controller-channel.js";

// Startup observation for an ALREADY owned host channel. Never spawns, boots,
// kills, authenticates, issues approvals or dispatches a verification request.
// The owner must obtain credentials/protected controller custody beforehand.
export const VM_ACQUISITION_LIMITS = Object.freeze({ startupMs: 30_000, stopMs: 10_000 });
type Reason = "initialized" | "cancelled" | "startup-timeout" | "controller-failed" | "clock-invalid";
export interface ManagedVmAcquisitionResult {
  readonly kind: "vm-controller-acquisition-not-authorization";
  readonly vmId: string;
  readonly sessionId: string;
  readonly status: "ready" | "stopped" | "unconfirmed";
  readonly reason: Reason;
  readonly authority: "none";
}
const acquired = new WeakSet<object>();
function bounded(value: number | undefined, maximum: number): number {
  const n = value ?? maximum;
  if (!Number.isSafeInteger(n) || n < 1 || n > maximum) throw new Error("managed-vm-acquisition-budget-invalid");
  return n;
}

/** A failed startup always requests the channel's one-shot stop, even when the
 * caller was already cancelled. A bounded return with status=unconfirmed means
 * UNKNOWN LIVE WORK, not settlement: retain ownership/blockers and escalate to
 * the independent stop owner. Never map that return to executor quiescence.
 * This is not that independent watchdog, and cannot preempt a blocked host loop.
 * The channel is trusted host input; in-process deduplication is not durable VM
 * ownership. Invalid options/reuse reject without acquiring cleanup ownership. */
export async function acquireManagedVmController(channel: WindowsManagedVmControllerChannel, options: {
  readonly signal: AbortSignal; readonly startupTimeoutMs?: number; readonly stopTimeoutMs?: number;
  readonly now?: () => number;
}): Promise<ManagedVmAcquisitionResult> {
  const startupMs = bounded(options.startupTimeoutMs, VM_ACQUISITION_LIMITS.startupMs);
  const stopMs = bounded(options.stopTimeoutMs, VM_ACQUISITION_LIMITS.stopMs);
  if (acquired.has(channel)) throw new Error("managed-vm-acquisition-already-used");
  const signal = options.signal, now = options.now ?? (() => performance.now());
  const vmId = channel.vmId, sessionId = channel.sessionId;
  const ready = channel.ready.bind(channel), stop = channel.stopAndConfirm.bind(channel);
  let last = -Infinity, clockFailed = false;
  const time = (): number => {
    try {
      const n = now();
      if (clockFailed || !Number.isFinite(n) || n < 0 || n < last) throw new Error();
      last = n; return n;
    } catch { clockFailed = true; throw new Error("managed-vm-acquisition-clock-invalid"); }
  };
  const result = (status: ManagedVmAcquisitionResult["status"], reason: Reason): ManagedVmAcquisitionResult => Object.freeze({
    kind: "vm-controller-acquisition-not-authorization", vmId, sessionId, status, reason, authority: "none",
  });
  // Claim before any caller clock, promise callback or channel contact can reenter.
  acquired.add(channel);
  let reason: Reason = "initialized";
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let abort!: () => void;
  try {
    const deadline = time() + startupMs;
    if (signal.aborted) reason = "cancelled";
    else {
      const interrupted = new Promise<Reason>(resolve => {
        abort = () => resolve("cancelled");
        signal.addEventListener("abort", abort, { once: true });
        startupTimer = setTimeout(() => resolve("startup-timeout"), startupMs);
      });
      let pending: Promise<void>;
      try { pending = ready(); } catch { pending = Promise.reject(new Error()); }
      reason = await Promise.race([pending.then<Reason, Reason>(() => "initialized", () => "controller-failed"), interrupted]);
      // A delayed timer must not make a late readiness callback acceptable.
      const observedAt = time();
      if (signal.aborted) reason = "cancelled";
      else if (observedAt >= deadline) reason = "startup-timeout";
      else if (reason === "initialized" && !channel.readyForRequest) reason = "controller-failed";
    }
  } catch { reason = "clock-invalid"; }
  finally { clearTimeout(startupTimer); if (abort) signal.removeEventListener("abort", abort); }
  if (reason === "initialized") return result("ready", reason);

  let stopStarted = 0, timer: ReturnType<typeof setTimeout> | undefined;
  try { stopStarted = time(); } catch { /* Still request stop on a broken clock. */ }
  try {
    const expired = new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), stopMs); });
    let pending: ReturnType<typeof stop>;
    try { pending = stop(); } catch { pending = Promise.reject(new Error()); }
    const confirmed = pending.then(value => value.vmId === vmId && value.sessionId === sessionId
      && value.state === "Off" && value.dispatchClosed === true, () => false);
    const observed = await Promise.race([confirmed, expired]);
    // Inclusive cutoff and latched clock failure prevent late cleanup from
    // retroactively converting an unknown acquisition into a successful stop.
    const timely = time() - stopStarted < stopMs;
    return result(observed && timely ? "stopped" : "unconfirmed", reason);
  } catch { return result("unconfirmed", reason); }
  finally { clearTimeout(timer); }
}
