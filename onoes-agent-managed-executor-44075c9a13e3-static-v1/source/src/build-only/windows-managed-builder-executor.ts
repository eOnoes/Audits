import { performance } from "node:perf_hooks";
import { win32 } from "node:path";
import { types } from "node:util";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { countExactOccurrences, decodeBuilderText, replaceBuilderLiteral, sha256BuilderDigest } from "../builder/content-policy.js";
import { pluginIdentitySchema } from "../kernel/schemas.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { WindowsBuilderEffectJournal, type BuilderEffectJournalReceipt } from "./windows-builder-effect-journal.js";
import { decodeManagedBuilderFrame, computeManagedBuilderTargetDigest, WindowsManagedBuilderApprovalRecorder,
  MANAGED_BUILDER_MAX_FRAME_BYTES, MANAGED_BUILDER_MAX_PATCH_SCAN_BYTES, type ManagedBuilderApprovalOptions } from "./windows-managed-builder-approval.js";
import { previewWindowsWorkspaceAccess } from "./windows-workspace-policy.js";
import { isResolvedManagedVerificationDefinition, type ResolvedManagedVerificationDefinition } from "./windows-managed-verification-catalog.js";
import { createManagedVerificationRequest, parseManagedVerificationResult, MANAGED_VERIFICATION_MAX_FILES, MANAGED_VERIFICATION_MAX_RESULT_BYTES,
  type ManagedVerificationRequest } from "./windows-managed-verification-evidence.js";

// Dormant trusted-service composition. NO default host filesystem/shell adapter,
// production consumer, caller-provided parsed approval, or release authorization.
// The installer/real adapter must separately establish OS custody and the fresh
// independent admission/consumer gate. These interfaces do NOT prove either.
export interface ManagedWorkspaceCustodySession {
  assertCustody(signal: AbortSignal): Promise<void>;
  /** Return the complete file through verified EOF within maximumBytes. Reject
   * growth/overflow, never return a truncated prefix. Return non-shared bytes;
   * the executor copies them before use. A byte array alone cannot prove EOF:
   * this remains a trusted adapter/native-custody obligation, not an assertion
   * that TypeScript can detect an adapter fabricating an in-budget prefix.
   * All methods settle only when their related I/O is quiescent. */
  read(relativePath: string, maximumBytes: number, signal: AbortSignal): Promise<Uint8Array>;
  /** Compare exact current bytes, replace via a NEW private file, not the old
   * inode. A settled promise means related I/O is quiescent even on rejection.
   * No task code, inherited untrusted handles or writes outside this namespace. */
  replace(relativePath: string, expectedDigest: string, bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  /** Resolve only after the custody holder and all related I/O have stopped and
   * the exclusive lock/handles are released. Rejection is never quiescence. */
  close(): Promise<void>;
}
export interface ManagedWorkspaceIo {
  readonly workspaceDigest: string;
  /** Acquire one operation-scoped native custody holder. The same returned
   * session must own every read/replace and remain alive through verification,
   * final read-back, and any attempted rollback. */
  openCustody(signal: AbortSignal): Promise<ManagedWorkspaceCustodySession>;
}
export interface ManagedReadOnlyVerifier {
  /** Trusted allowlisted runner, NOT a caller command. The request is minted by
   * this executor from the exact post-edit subject and a parser-proven static
   * definition. Return one canonical bounded result transport. Resolution and
   * rejection settle only after all related work/descendants have stopped.
   * Abort requests cancellation; it is not evidence of termination. */
  verify(request: ManagedVerificationRequest, signal: AbortSignal): Promise<string | Uint8Array>;
}
export interface ManagedExecutorOptions extends ManagedBuilderApprovalOptions {
  readonly io: ManagedWorkspaceIo;
  readonly verifier: ManagedReadOnlyVerifier;
  /** Parser-proven host-owned definition. A clone or caller-built lookalike is
   * rejected before any filesystem or verifier callback is reached. */
  readonly verificationResolution: ResolvedManagedVerificationDefinition;
  /** Trusted host budgets only, never parsed from a candidate frame. */
  readonly stepTimeoutMs?: number;
  readonly cancellationGraceMs?: number;
  readonly recoveryTimeoutMs?: number;
}
type Reason = "completed" | "invalid-request" | "unsupported-platform" | "busy" | "authority-denied"
  | "cancelled" | "timeout" | "io-failed" | "verification-failed" | "unsettled-work" | "recording-unconfirmed";
export interface ManagedExecutionResult {
  readonly schemaVersion: "agent-managed-execution-local/v1";
  readonly kind: "local-execution-not-independent-review";
  readonly operationId: string | null;
  readonly disposition: "completed" | "denied" | "cancelled" | "failed" | "quarantined" | "needs-reconciliation";
  readonly reason: Reason;
  readonly attemptedFiles: number;
  readonly restoredFiles: number;
  readonly journal: BuilderEffectJournalReceipt | null;
}
class StepError extends Error {
  constructor(readonly reason: Reason, readonly quiescent = true) { super(reason); }
}
function copyAdapterBytes(value: unknown, maximumBytes: number): Buffer {
  if (!(value instanceof Uint8Array) || value.buffer instanceof SharedArrayBuffer
    || value.byteLength > maximumBytes) throw new StepError("io-failed");
  return Buffer.from(value);
}
const exactTime = (s: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s)
  && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
const bounded = (n: number | undefined, fallback: number, cap: number) => {
  const value = n ?? fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > cap) throw new Error("managed-executor-budget-invalid");
  return value;
};
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
const typedArrayByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")!.get!;
function snapshotVerificationTransport(value: unknown): string | Buffer {
  try {
    if (typeof value === "string") {
      if (value.length > MANAGED_VERIFICATION_MAX_RESULT_BYTES
        || Buffer.byteLength(value, "utf8") > MANAGED_VERIFICATION_MAX_RESULT_BYTES)
        throw new StepError("verification-failed");
      return value;
    }
    if (typeof value !== "object" || value === null || types.isProxy(value) || !types.isUint8Array(value))
      throw new StepError("verification-failed");
    // Inspect intrinsic storage, not shadowable adapter-owned length/buffer
    // properties. Check the view budget BEFORE allocating a private copy.
    const backing = Reflect.apply(typedArrayBuffer, value, []) as ArrayBufferLike;
    const length = Reflect.apply(typedArrayByteLength, value, []) as number;
    const offset = Reflect.apply(typedArrayByteOffset, value, []) as number;
    if (types.isSharedArrayBuffer(backing) || length > MANAGED_VERIFICATION_MAX_RESULT_BYTES)
      throw new StepError("verification-failed");
    // A fresh built-in view avoids subclass methods/species and honors a
    // bounded subview of a larger buffer. Detached storage throws and denies.
    return Buffer.from(new Uint8Array(backing, offset, length));
  } catch { throw new StepError("verification-failed"); }
}

/** One exclusive trusted service instance per managed workspace. The SQL stores
 * also retain durable blockers across instances/restart. No async callback ever
 * runs in one of their transactions. A poisoned instance cannot do further I/O. */
export class WindowsManagedBuilderExecutor {
  readonly #options: ManagedExecutorOptions;
  readonly #recorder: WindowsManagedBuilderApprovalRecorder;
  readonly #journal: WindowsBuilderEffectJournal;
  readonly #stepMs: number;
  readonly #graceMs: number;
  readonly #recoveryMs: number;
  #busy = false;
  #poisoned = false;
  constructor(options: ManagedExecutorOptions) {
    this.#options = { ...options, workspace: deepFreeze(structuredClone(options.workspace)),
      expectedPlugin: deepFreeze(pluginIdentitySchema.parse(options.expectedPlugin)) };
    if (options.io.workspaceDigest !== options.workspace.workspaceDigest) throw new Error("managed-executor-workspace-mismatch");
    if (!isResolvedManagedVerificationDefinition(options.verificationResolution))
      throw new Error("managed-executor-verification-resolution-untrusted");
    this.#recorder = new WindowsManagedBuilderApprovalRecorder(this.#options);
    this.#journal = new WindowsBuilderEffectJournal(options.recovery, options.policy);
    this.#stepMs = bounded(options.stepTimeoutMs, 5000, 5000);
    // Both default and ceiling are 1000; every integer from 1 through 1000 is valid.
    this.#graceMs = bounded(options.cancellationGraceMs, 1000, 1000);
    this.#recoveryMs = bounded(options.recoveryTimeoutMs, 5000, 30000);
  }

  /** Returned data is a local execution assessment, not fresh review approval.
   * Only tests/disposable service fixtures may call this until consumer audit. */
  async execute(frameInput: Uint8Array, signal: AbortSignal = new AbortController().signal): Promise<ManagedExecutionResult> {
    let operationId: string | null = null, journal: BuilderEffectJournalReceipt | null = null;
    const attempted: string[] = []; let restored = 0, recordingStarted = false, verificationDigest: string | null = null;
    const result = (disposition: ManagedExecutionResult["disposition"], reason: Reason): ManagedExecutionResult => deepFreeze({
      schemaVersion: "agent-managed-execution-local/v1", kind: "local-execution-not-independent-review",
      operationId, disposition, reason, attemptedFiles: attempted.length, restoredFiles: restored, journal });
    if (this.#busy || this.#poisoned) return result("denied", "busy");
    if (process.platform !== "win32") return result("denied", "unsupported-platform");
    this.#busy = true;
    let activeIo: ManagedWorkspaceCustodySession | undefined;
    const preimages = new Map<string, Buffer>(), outputs = new Map<string, Buffer>();
    let allPaths: string[] = [];
    const checkAbort = () => { if (signal.aborted) throw new StepError("cancelled"); };
    let deadline = performance.now() + 60_000;
    const run = <T>(fn: (s: AbortSignal) => Promise<T>, recovery = false) => this.step(fn,
      recovery ? undefined : signal, Math.min(this.#stepMs, deadline - performance.now()));
    const closeCustody = async () => {
      const session = activeIo; activeIo = undefined;
      if (session !== undefined) {
        // Initiate stop before entering the bounded wait. Even if the global
        // operation deadline is exhausted, a stuck child can only consume the
        // grace interval before the executor poisons and quarantines.
        const closing = session.close();
        await this.step(() => closing, undefined, Math.max(1, Math.min(this.#stepMs, deadline - performance.now())));
      }
    };
    const settle = (receipt: BuilderEffectJournalReceipt, outcome: "completed" | "restored" | "quarantined", reason: Reason) => {
      try {
        journal = this.#journal.recordSettlement({ operationId: receipt.operationId, requestDigest: receipt.requestDigest, outcome,
          evidenceDigest: canonicalSha256Digest({ domain: "managed-executor-local-evidence/v1", outcome, reason,
            verificationDigest, attempted: attempted.map(path => ({ pathDigest: canonicalSha256Digest(path),
              before: sha256BuilderDigest(preimages.get(path)!), after: sha256BuilderDigest(outputs.get(path)!) })), restored }) });
      } catch { return result("needs-reconciliation", "recording-unconfirmed"); }
      return result(outcome === "quarantined" ? "quarantined" : outcome === "completed" ? "completed"
        : reason === "cancelled" ? "cancelled" : "failed", reason);
    };
    try {
      if (!(signal instanceof AbortSignal) || !(frameInput instanceof Uint8Array) || frameInput.buffer instanceof SharedArrayBuffer
        || frameInput.byteLength > MANAGED_BUILDER_MAX_FRAME_BYTES) return result("denied", "invalid-request");
      const frame = Buffer.from(frameInput), decoded = decodeManagedBuilderFrame(frame), { subject, authorization } = decoded;
      operationId = subject.operationId;
      const { workspace, authority, policy } = this.#options, plugin = pluginIdentitySchema.parse(this.#options.expectedPlugin);
      if (subject.workspaceDigest !== workspace.workspaceDigest || subject.scope.repositoryRoot !== workspace.repositoryRoot
        || subject.scope.worktreeRoot !== workspace.worktreeRoot || subject.scope.worktreeAttestationDigest !== workspace.worktreeAttestationDigest)
        return result("denied", "authority-denied");
      const expected = { sessionId: subject.scope.sessionId, profileId: subject.scope.profileId, capability: "bounded-file-write",
        targetDigest: computeManagedBuilderTargetDigest(subject), pluginId: plugin.pluginId, pluginVersion: plugin.version,
        pluginArtifactDigest: plugin.artifactDigest, approvalRequired: true } as const;
      let lastTime = "";
      const authorize = () => {
        checkAbort();
        if (performance.now() >= deadline) throw new StepError("timeout");
        const now = (this.#options.now ?? (() => new Date().toISOString()))();
        if (!exactTime(now) || !exactTime(subject.scope.issuedAt) || !exactTime(subject.scope.expiresAt)
          || now < lastTime || now < subject.scope.issuedAt || now >= subject.scope.expiresAt) throw new StepError("authority-denied");
        lastTime = now;
        const verified = authority.verify(authorization, expected, now);
        if (!verified.valid || !verified.lease?.approvalId || (journal === null && authority.isConsumed(verified.lease.leaseId)))
          throw new StepError("authority-denied");
        const snapshot = policy.snapshot();
        if (canonicalJson(snapshot.binding) !== canonicalJson(subject.policyBinding)) throw new StepError("authority-denied");
        for (const path of subject.scope.allowedWriteFiles) {
          if (previewWindowsWorkspaceAccess(snapshot.policy, { path: win32.join(workspace.worktreeRoot, path), operation: "write" }).decision !== "requires-filesystem-validation")
            throw new StepError("authority-denied");
        }
        return verified.lease;
      };
      const lease = authorize(); deadline = Math.min(deadline, performance.now() + lease.bounds.timeoutMs);
      allPaths = [...subject.scope.allowedWriteFiles].sort();
      if (allPaths.length === 0 || allPaths.length > MANAGED_VERIFICATION_MAX_FILES
        || new Set(allPaths.map(s => s.toLowerCase())).size !== allPaths.length
        || subject.plan.taskId !== subject.scope.taskId || !subject.scope.allowedVerificationIds.includes(subject.plan.verificationId)
        || subject.plan.patches.some(p => !allPaths.includes(p.relativePath))) return result("denied", "invalid-request");
      const verificationResolution = this.#options.verificationResolution;
      if (verificationResolution.definition.verificationId !== subject.plan.verificationId)
        return result("denied", "verification-failed");
      // Store the cleanup handle inside the bounded callback. step() performs
      // a post-settlement deadline/cancellation check, so assigning only from
      // its return value could otherwise discard a successfully opened holder.
      await run(async s => { activeIo = await this.#options.io.openCustody(s); });
      await run(s => activeIo!.assertCustody(s));
      let total = 0;
      for (const path of allPaths) {
        authorize();
        const cap = Math.min(subject.scope.maxFileBytes, subject.scope.maxTotalBytes - total);
        const copy = copyAdapterBytes(await run(s => activeIo!.read(path, cap, s)), cap);
        preimages.set(path, copy); total += copy.length;
      }
      let scan = 0, outputTotal = total;
      for (const patch of subject.plan.patches) {
        const original = preimages.get(patch.relativePath)!; let text = decodeBuilderText(original);
        if (sha256BuilderDigest(original) !== patch.expectedPreimageDigest) throw new StepError("authority-denied");
        for (const op of patch.operations) {
          const size = Buffer.byteLength(text); scan += size;
          const next = size - Buffer.byteLength(op.before) + Buffer.byteLength(op.after);
          if (scan > MANAGED_BUILDER_MAX_PATCH_SCAN_BYTES || countExactOccurrences(text, op.before) !== 1
            || next > subject.scope.maxFileBytes || outputTotal - original.length + next > subject.scope.maxTotalBytes
            || outputTotal - original.length + next > lease.bounds.maxOutputBytes) throw new StepError("authority-denied");
          text = replaceBuilderLiteral(text, op.before, op.after);
        }
        const output = Buffer.from(text); outputTotal += output.length - original.length; outputs.set(patch.relativePath, output);
      }
      // Validate the entire immutable verification subject before recording
      // intent or consuming approval. These are predicted postimages, not a
      // claim that replacement/verification has happened; final read-back still
      // checks these exact bytes after the separately bound verifier succeeds.
      const verificationRequest = createManagedVerificationRequest(verificationResolution, {
        requestId: subject.operationId, operationId: subject.operationId,
        subject: { workspaceDigest: subject.workspaceDigest,
          policyBindingDigest: canonicalSha256Digest({ domain: "onoes-managed-verification-policy-binding/v1",
            binding: subject.policyBinding }),
          files: allPaths.map(relativePath => ({ relativePath,
            contentDigest: sha256BuilderDigest(outputs.get(relativePath) ?? preimages.get(relativePath)!) })) },
      });
      authorize();
      recordingStarted = true;
      journal = this.#recorder.recordIntent(frame, allPaths.map(relativePath => ({ relativePath, bytes: preimages.get(relativePath)! })));
      for (const patch of subject.plan.patches) {
        authorize(); await run(s => activeIo!.assertCustody(s)); authorize();
        await run(s => {
          attempted.push(patch.relativePath); // A rejected invocation may already have changed bytes.
          return activeIo!.replace(patch.relativePath, sha256BuilderDigest(preimages.get(patch.relativePath)!),
            Buffer.from(outputs.get(patch.relativePath)!), s);
        });
      }
      authorize();
      const verificationTransport = snapshotVerificationTransport(
        await run(s => this.#options.verifier.verify(verificationRequest, s)));
      try {
        const verification = parseManagedVerificationResult(verificationTransport, verificationRequest);
        verificationDigest = verification.resultDigest;
        // Canonical identity proves which run reported this outcome; a valid
        // failed result still requires recovery, never successful settlement.
        if (verification.disposition !== "passed") throw new StepError("verification-failed");
      } catch { throw new StepError("verification-failed"); }
      authorize();
      await run(s => activeIo!.assertCustody(s));
      for (const path of allPaths) {
        // Custody/read awaits may outlive the lease or observe revocation. These
        // are still forward checks; only the separate recovery path may proceed
        // under its bounded restoration obligation after authority is lost.
        authorize();
        const expectedBytes = outputs.get(path) ?? preimages.get(path)!;
        // Expected postimages already satisfy the per-file and aggregate scope
        // budgets. Bound read-back to those exact lengths, including zero-byte
        // files; the adapter must still verify EOF and reject a grown suffix.
        const cap = expectedBytes.length;
        const actual = copyAdapterBytes(await run(s => activeIo!.read(path, cap, s)), cap);
        if (sha256BuilderDigest(actual) !== sha256BuilderDigest(expectedBytes)) throw new StepError("io-failed");
      }
      authorize();
      await closeCustody();
      return settle(journal, "completed", "completed");
    } catch (error) {
      const fault = error instanceof StepError ? error : new StepError(recordingStarted && journal === null ? "recording-unconfirmed" : "io-failed");
      if (!fault.quiescent) this.#poisoned = true;
      if (journal === null) {
        try { await closeCustody(); } catch { this.#poisoned = true; }
        return result(recordingStarted ? "needs-reconciliation" : fault.reason === "cancelled" ? "cancelled" : "denied", fault.reason);
      }
      if (!fault.quiescent) {
        try { await closeCustody(); } catch { this.#poisoned = true; }
        return settle(journal, "quarantined", "unsettled-work");
      }
      // Cancellation/revocation never requires another approval to STOP work.
      // Recovery is bounded separately and never touches an unattempted path.
      deadline = performance.now() + this.#recoveryMs;
      let recoveryFailed = false;
      const fileFailure = (error: unknown) => {
        // A settled rejection permits trying a DIFFERENT attempted file, not a
        // retry or a successful-restoration claim. Unknown activity is global:
        // never run another operation concurrently with unsettled recovery I/O.
        if (error instanceof StepError && !error.quiescent) throw error;
        recoveryFailed = true;
      };
      try {
        for (const path of [...attempted].reverse()) {
          // Custody is global, not a per-file failure we may continue past.
          await run(s => activeIo!.assertCustody(s), true);
          try {
            const before = preimages.get(path)!, after = outputs.get(path)!;
            const cap = Math.max(before.length, after.length);
            const current = copyAdapterBytes(await run(s => activeIo!.read(path, cap, s), true), cap);
            if (sha256BuilderDigest(current) === sha256BuilderDigest(before)) { restored++; continue; }
            if (sha256BuilderDigest(current) !== sha256BuilderDigest(after)) throw new StepError("io-failed");
            await run(s => activeIo!.replace(path, sha256BuilderDigest(after), Buffer.from(before), s), true); restored++;
          } catch (error) { fileFailure(error); }
        }
        await run(s => activeIo!.assertCustody(s), true);
        for (const path of allPaths) {
          try {
            const before = preimages.get(path)!;
            const current = copyAdapterBytes(await run(s => activeIo!.read(path, before.length, s), true), before.length);
            if (sha256BuilderDigest(current) !== sha256BuilderDigest(before)) throw new StepError("io-failed");
          } catch (error) { fileFailure(error); }
        }
      } catch (restoreError) {
        if (restoreError instanceof StepError && !restoreError.quiescent) this.#poisoned = true;
        try { await closeCustody(); } catch { this.#poisoned = true; }
        return settle(journal, "quarantined", "io-failed");
      }
      try { await closeCustody(); } catch { this.#poisoned = true; return settle(journal, "quarantined", "unsettled-work"); }
      return settle(journal, recoveryFailed ? "quarantined" : "restored", recoveryFailed ? "io-failed" : fault.reason);
    } finally {
      if (activeIo !== undefined) { try { await closeCustody(); } catch { this.#poisoned = true; } }
      this.#busy = false;
    }
  }

  private async step<T>(fn: (signal: AbortSignal) => Promise<T>, external: AbortSignal | undefined, availableMs: number): Promise<T> {
    if (external?.aborted) throw new StepError("cancelled");
    if (availableMs <= 0) throw new StepError("timeout");
    const controller = new AbortController();
    const stepDeadline = performance.now() + availableMs;
    type Done = { type: "value"; value: T } | { type: "error" };
    let timer: ReturnType<typeof setTimeout> | undefined, grace: ReturnType<typeof setTimeout> | undefined;
    let stop!: (reason: "cancelled" | "timeout") => void;
    const stopped = new Promise<{ type: "stop"; reason: "cancelled" | "timeout" }>(resolve => {
      stop = reason => { resolve({ type: "stop", reason }); controller.abort(); };
      timer = setTimeout(() => stop("timeout"), Math.max(1, Math.floor(availableMs)));
    });
    const onAbort = () => stop("cancelled"); external?.addEventListener("abort", onAbort, { once: true });
    const done: Promise<Done> = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new StepError("cancelled");
      return fn(controller.signal);
    }).then(value => ({ type: "value", value }), () => ({ type: "error" }));
    try {
      const first = await Promise.race([done, stopped]);
      if (first.type === "value") {
        if (performance.now() >= stepDeadline) throw new StepError("timeout");
        return first.value;
      }
      if (first.type === "error") throw new StepError("io-failed");
      const completion = await Promise.race([done, new Promise<null>(resolve => { grace = setTimeout(() => resolve(null), this.#graceMs); })]);
      throw new StepError(first.reason, completion !== null);
    } finally { clearTimeout(timer); clearTimeout(grace); external?.removeEventListener("abort", onAbort); }
  }
}
