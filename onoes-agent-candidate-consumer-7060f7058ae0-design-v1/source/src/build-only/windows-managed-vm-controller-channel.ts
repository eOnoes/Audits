import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { z } from "zod";
import { canonicalJson } from "../compatibility/canonical-json.js";
import { isManagedVerificationRequest, MANAGED_VERIFICATION_MAX_RESULT_BYTES,
  type ManagedVerificationRequest } from "./windows-managed-verification-evidence.js";
import type { ManagedVmVerificationSession } from "./windows-managed-vm-verifier.js";

// Host-controller stdio transport ONLY. This module never spawns, boots, kills,
// installs, authenticates or chooses a VM. The supplied process must be a
// protected, exclusively owned host controller, NOT the guest runner. The real
// controller must wrap guest bytes as result data; only host observations may
// produce stop frames. Framing/UUID equality does not authenticate that origin.
export const VM_CONTROLLER_CHANNEL_LIMITS = Object.freeze({
  headerBytes: 8, frameBodyBytes: 98_304, outputFrames: 3, outputChunks: 2048,
  chunkBytes: 65_536, requestBytes: 65_536,
});
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const readySchema = z.object({ kind: z.literal("vm-controller-ready/v1"), vmId: uuid, sessionId: uuid }).strict();
const resultSchema = z.object({ kind: z.literal("vm-controller-result/v1"), vmId: uuid, sessionId: uuid,
  requestDigest: digest, payloadBase64: z.string().max(87_384) }).strict();
const failedSchema = z.object({ kind: z.literal("vm-controller-run-failed/v1"), vmId: uuid, sessionId: uuid,
  requestDigest: digest }).strict();
const offSchema = z.object({ kind: z.literal("vm-controller-stopped/v1"), vmId: uuid, sessionId: uuid,
  state: z.literal("Off"), dispatchClosed: z.literal(true) }).strict();
const messageSchema = z.discriminatedUnion("kind", [readySchema, resultSchema, failedSchema, offSchema]);
type Off = Awaited<ReturnType<ManagedVmVerificationSession["stopAndConfirm"]>>;
const boundChildren = new WeakSet<object>();
const error = (): Error => new Error("managed-vm-controller-channel-unconfirmed");
function frame(value: unknown): Buffer {
  const body = Buffer.from(canonicalJson(value));
  if (body.length > VM_CONTROLLER_CHANNEL_LIMITS.frameBodyBytes) throw error();
  const output = Buffer.alloc(8 + body.length); output.write("OVC1", 0, "ascii");
  output.writeUInt32BE(body.length, 4); body.copy(output, 8); return output;
}

/** Implements the lifecycle port for an already acquired HOST controller.
 * Request and stop are the only commands. Successful stop requires a matching
 * host-Off message followed by clean controller close AND exact framing EOF.
 * Rejection is uncertainty, never VM quiescence; use WindowsManagedVmVerifier
 * to compose this port with the executor, not the raw run promise.
 * The owner must supervise controller death/hang and perform authenticated VM
 * stop/reconciliation independently. Killing this process is NOT VM stop.
 * This transport has no durable ownership/approval or independent verification. */
export class WindowsManagedVmControllerChannel implements ManagedVmVerificationSession {
  readonly vmId: string;
  readonly sessionId: string;
  readonly #input: ChildProcessWithoutNullStreams["stdin"];
  #runCalled = false; #stopCalled = false; #runMessage = false; #readySeen = false; #off: Off | undefined;
  #closed = false; #bad = false; #requestDigest: string | undefined;
  #chunks = 0; #bytes = 0; #frames = 0;
  readonly #header = Buffer.alloc(8); #headerUsed = 0;
  #body: Buffer | undefined; #bodyUsed = 0;
  #resolveRun!: (value: string) => void; #rejectRun!: (reason: Error) => void;
  #resolveReady!: () => void; #rejectReady!: (reason: Error) => void;
  #resolveStop!: (value: Off) => void; #rejectStop!: (reason: Error) => void;
  readonly #runResult = new Promise<string>((resolve, reject) => { this.#resolveRun = resolve; this.#rejectRun = reject; });
  readonly #readyResult = new Promise<void>((resolve, reject) => { this.#resolveReady = resolve; this.#rejectReady = reject; });
  readonly #stopResult = new Promise<Off>((resolve, reject) => { this.#resolveStop = resolve; this.#rejectStop = reject; });
  constructor(child: ChildProcessWithoutNullStreams, identity: { readonly vmId: string; readonly sessionId: string }) {
    this.vmId = uuid.parse(identity.vmId); this.sessionId = uuid.parse(identity.sessionId);
    if (boundChildren.has(child) || child.exitCode !== null || child.signalCode !== null
      || !child.stdin || !child.stdout || !child.stderr) throw error();
    Object.defineProperties(this, { vmId: { writable: false, configurable: false }, sessionId: { writable: false, configurable: false } });
    this.#input = child.stdin; boundChildren.add(child);
    // An early spawn/pipe error may precede the caller's run/stop. Preserve the
    // rejected promises for that caller without an unhandled-rejection leak.
    void this.#runResult.catch(() => {}); void this.#stopResult.catch(() => {}); void this.#readyResult.catch(() => {});
    child.stdin.on("error", () => this.#fail());
    child.stdout.on("error", () => this.#fail()); child.stderr.on("error", () => this.#fail());
    child.stdout.on("data", (chunk: Buffer) => this.#data(chunk));
    child.stderr.on("data", () => this.#fail()); // discard, never retain diagnostics
    child.once("error", () => this.#fail());
    child.once("close", (code, signal) => {
      this.#closed = true;
      if (!this.#readySeen) this.#rejectReady(error());
      if (!this.#runMessage) this.#rejectRun(error());
      if (!this.#bad && code === 0 && signal === null && this.#stopCalled && this.#off
        && this.#headerUsed === 0 && this.#body === undefined) this.#resolveStop(this.#off);
      else this.#rejectStop(error());
      this.#clear();
    });
  }
  #clear(): void { this.#header.fill(0); this.#body?.fill(0); this.#body = undefined; this.#bodyUsed = 0; this.#headerUsed = 0; }
  #fail(): void {
    this.#bad = true; this.#clear(); this.#rejectRun(error()); this.#rejectStop(error()); this.#rejectReady(error());
    // Still send one stop command when possible; never kill the only host
    // controller as a substitute for stopping the VM. No retry after write loss.
    if (this.#runCalled && !this.#stopCalled) void this.stopAndConfirm().catch(() => {});
  }
  #data(chunk: Buffer): void {
    if (this.#bad) return; // drain without retaining attacker-controlled bytes
    const cap = VM_CONTROLLER_CHANNEL_LIMITS;
    if (!Buffer.isBuffer(chunk) || ++this.#chunks > cap.outputChunks || chunk.length > cap.chunkBytes
      || (this.#bytes += chunk.length) > cap.outputFrames * (cap.headerBytes + cap.frameBodyBytes)) { this.#fail(); return; }
    try {
      let offset = 0;
      while (offset < chunk.length) {
        if (this.#frames >= cap.outputFrames) throw error();
        if (!this.#body) {
          const take = Math.min(8 - this.#headerUsed, chunk.length - offset);
          chunk.copy(this.#header, this.#headerUsed, offset, offset + take); this.#headerUsed += take; offset += take;
          if (this.#headerUsed !== 8) continue;
          if (!this.#header.subarray(0, 4).equals(Buffer.from("OVR1"))) throw error();
          const length = this.#header.readUInt32BE(4);
          if (length === 0 || length > cap.frameBodyBytes) throw error();
          this.#body = Buffer.alloc(length); // only after header and cap validation
        }
        const take = Math.min(this.#body.length - this.#bodyUsed, chunk.length - offset);
        chunk.copy(this.#body, this.#bodyUsed, offset, offset + take); this.#bodyUsed += take; offset += take;
        if (this.#bodyUsed !== this.#body.length) continue;
        const body = this.#body; this.#body = undefined; this.#bodyUsed = 0; this.#headerUsed = 0; this.#frames++;
        try { this.#message(body); } finally { body.fill(0); }
      }
    } catch { this.#fail(); }
  }
  #message(body: Buffer): void {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
    const value = messageSchema.parse(JSON.parse(text));
    if (canonicalJson(value) !== text || value.vmId !== this.vmId || value.sessionId !== this.sessionId || this.#off) throw error();
    if (value.kind === "vm-controller-ready/v1") {
      if (this.#readySeen || this.#runCalled) throw error();
      this.#readySeen = true;
      if (this.#stopCalled) this.#rejectReady(error()); else this.#resolveReady();
      return;
    }
    if (value.kind === "vm-controller-stopped/v1") {
      if (!this.#stopCalled) throw error();
      this.#off = Object.freeze({ vmId: this.vmId, sessionId: this.sessionId, state: "Off", dispatchClosed: true });
      return;
    }
    if (!this.#readySeen || !this.#runCalled || this.#runMessage || value.requestDigest !== this.#requestDigest) throw error();
    this.#runMessage = true;
    if (value.kind === "vm-controller-run-failed/v1") { this.#rejectRun(error()); return; }
    const bytes = Buffer.from(value.payloadBase64, "base64");
    try {
      if (bytes.length > MANAGED_VERIFICATION_MAX_RESULT_BYTES || bytes.toString("base64") !== value.payloadBase64) throw error();
      this.#resolveRun(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
    } finally { bytes.fill(0); }
  }
  /** Host acquisition phase, BEFORE minting/dispatching the timed request. A
   * matching readiness frame only reports controller initialization, not safety
   * or authority. Startup/login needs its own host-owned timeout and cleanup. */
  ready(): Promise<void> {
    if (this.#closed || this.#bad || this.#stopCalled) return Promise.reject(error());
    return this.#readyResult;
  }
  /** Current transport state only, not permission or future liveness. Recheck
   * after awaiting readiness: a fulfilled readiness promise cannot be revoked
   * when a close/error/stop arrives before its continuation runs. */
  get readyForRequest(): boolean {
    return this.#readySeen && !this.#runCalled && !this.#stopCalled && !this.#closed && !this.#bad;
  }
  run(request: ManagedVerificationRequest, signal: AbortSignal): Promise<string> {
    if (!this.#readySeen || this.#runCalled || this.#stopCalled || this.#closed || this.#bad || signal.aborted || !isManagedVerificationRequest(request))
      return Promise.reject(error());
    const wire = canonicalJson(request);
    if (Buffer.byteLength(wire) > VM_CONTROLLER_CHANNEL_LIMITS.requestBytes) return Promise.reject(error());
    const input = frame({ kind: "vm-controller-run/v1", vmId: this.vmId, sessionId: this.sessionId,
      requestDigest: request.requestDigest, payloadBase64: Buffer.from(wire).toString("base64") });
    this.#runCalled = true; this.#requestDigest = request.requestDigest;
    try { this.#input.write(input, e => { input.fill(0); if (e) this.#fail(); }); }
    catch { input.fill(0); this.#fail(); }
    // Caller abort is consumed by the lifecycle adapter, which sends stop. This
    // raw port must not label abort as a settled guest operation.
    return this.#runResult;
  }
  stopAndConfirm(): Promise<Off> {
    if (this.#stopCalled) return this.#stopResult;
    this.#stopCalled = true;
    if (this.#closed || this.#input.destroyed) { this.#rejectStop(error()); return this.#stopResult; }
    const input = frame({ kind: "vm-controller-stop/v1", vmId: this.vmId, sessionId: this.sessionId });
    try { this.#input.end(input, () => input.fill(0)); }
    catch { input.fill(0); this.#fail(); }
    return this.#stopResult;
  }
}
