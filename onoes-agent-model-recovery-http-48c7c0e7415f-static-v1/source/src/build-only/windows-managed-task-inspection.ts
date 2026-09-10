import { performance } from "node:perf_hooks";
import { win32 } from "node:path";
import { types } from "node:util";
import { z } from "zod";
import { canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { containsSecretLikeContent, decodeBuilderText, sha256BuilderDigest } from "../builder/content-policy.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { createWindowsOperatorTaskIntake } from "./windows-operator-task-intake.js";
import { parseWindowsWorkspacePolicy, previewWindowsWorkspaceAccess } from "./windows-workspace-policy.js";
import type { SqliteWindowsWorkspacePolicyStore } from "./windows-workspace-policy-store.js";
import type { ManagedWorkspaceCustodySession } from "./windows-managed-builder-executor.js";

// Dormant host-only inspection, no default filesystem adapter, HTTP consumer,
// command, approval or write capability. Host enrollment/custody is a separate
// prerequisite; a workspace digest or this interface does not establish it.
type ReadSession = Pick<ManagedWorkspaceCustodySession, "assertCustody" | "read" | "close">;
export interface ManagedTaskInspectionOptions {
  readonly workspace: Readonly<{ workspaceDigest: string; repositoryRoot: string; worktreeRoot: string;
    worktreeAttestationDigest: string }>;
  readonly io: Readonly<{ workspaceDigest: string; openCustody(signal: AbortSignal): Promise<ReadSession> }>;
  readonly policy: Pick<SqliteWindowsWorkspacePolicyStore, "snapshot" | "assertCurrentBinding" | "listEffectIntents">;
  readonly stepTimeoutMs?: number;
  readonly cancellationGraceMs?: number;
  readonly totalTimeoutMs?: number;
}
export const MANAGED_TASK_INSPECTION_LIMITS = Object.freeze({ files: 128, fileBytes: 1_048_576,
  totalBytes: 8_388_608, readPayloadBytes: 16_777_216, stepMs: 5_000, graceMs: 1_000, totalMs: 30_000 });
type Reason = "invalid-request" | "workspace-mismatch" | "policy-denied" | "recovery-pending" | "io-failed"
  | "content-rejected" | "budget-exceeded" | "changed-during-inspection" | "cancelled" | "timeout"
  | "unsettled-work" | "busy" | "poisoned" | "unsupported-platform";
export class ManagedTaskInspectionError extends Error {
  constructor(readonly reason: Reason, readonly quiescent = true) {
    super(`managed-task-inspection-${reason}`); this.name = "ManagedTaskInspectionError";
  }
}
const fail = (reason: Reason): never => { throw new ManagedTaskInspectionError(reason); };
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const workspaceSchema = z.object({ workspaceDigest: digest, repositoryRoot: z.string().min(1).max(2048),
  worktreeRoot: z.string().min(1).max(2048), worktreeAttestationDigest: digest }).strict();
const budget = (value: number | undefined, limit: number) => {
  const n = value ?? limit;
  if (!Number.isSafeInteger(n) || n < 1 || n > limit) return fail("invalid-request");
  return n;
};
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const bufferGetter = Object.getOwnPropertyDescriptor(typedArray, "buffer")!.get!;
const lengthGetter = Object.getOwnPropertyDescriptor(typedArray, "byteLength")!.get!;
const offsetGetter = Object.getOwnPropertyDescriptor(typedArray, "byteOffset")!.get!;
function snapshotBytes(value: unknown, cap: number): Buffer {
  try {
    if (types.isProxy(value) || !types.isUint8Array(value)) return fail("io-failed");
    const backing: ArrayBufferLike = Reflect.apply(bufferGetter, value, []);
    const length: number = Reflect.apply(lengthGetter, value, []);
    const offset: number = Reflect.apply(offsetGetter, value, []);
    if (types.isSharedArrayBuffer(backing)) return fail("io-failed");
    if (length > cap) return fail("budget-exceeded");
    // No property access, iterator or species hook on the adapter's value. EOF
    // completeness and bounded native allocation remain adapter obligations.
    return Buffer.from(new Uint8Array(backing, offset, length));
  } catch (error) {
    if (error instanceof ManagedTaskInspectionError) throw error;
    return fail("io-failed");
  }
}
type InspectedFile = Readonly<{ relativePath: string; text: string; byteLength: number; contentDigest: string }>;
function inspectionResult(brief: ReturnType<typeof createWindowsOperatorTaskIntake>,
  workspace: ManagedTaskInspectionOptions["workspace"], files: readonly InspectedFile[], totalBytes: number) {
  const core = { schemaVersion: "agent-managed-task-inspection/v1" as const,
    kind: "local-managed-inspection-not-independent-review" as const,
    requestDigest: brief.requestDigest, briefDigest: brief.draftDigest, policyBinding: brief.request.expectedBinding,
    workspace, files, totalBytes, readPayloadBytes: totalBytes * 2,
    custody: "trusted-adapter-single-session" as const,
    consistency: "matching-two-pass-reads-not-filesystem-snapshot" as const,
    freshness: "revalidate-before-use" as const, liveFilesRead: true as const,
    workTaskCreated: false as const, executionEnabled: false as const, persisted: false as const, authority: "none" as const };
  return deepFreeze({ ...core, inspectionDigest: canonicalSha256Digest(core) });
}
export type ManagedTaskInspection = ReturnType<typeof inspectionResult>;
const issued = new WeakSet<object>();
/** Local producer provenance only. Serialization/cloning loses it; not a grant. */
export function isManagedTaskInspection(value: unknown): value is ManagedTaskInspection {
  return typeof value === "object" && value !== null && issued.has(value);
}

export class WindowsManagedTaskInspector {
  readonly #options: ManagedTaskInspectionOptions;
  readonly #stepMs: number; readonly #graceMs: number; readonly #totalMs: number;
  #busy = false; #poisoned = false;
  constructor(options: ManagedTaskInspectionOptions) {
    let workspace: ManagedTaskInspectionOptions["workspace"];
    try {
      workspace = deepFreeze(workspaceSchema.parse(options.workspace));
      // Reuse the conservative Windows lexical grammar without normalizing the
      // exact host binding. Each root is parsed separately (they may coincide).
      for (const path of [workspace.repositoryRoot, workspace.worktreeRoot]) {
        parseWindowsWorkspacePolicy({ schemaVersion: "agent-windows-workspace-policy/v1", revision: 1,
          allowedRoots: [{ path, access: "read-only" }], deniedRoots: [] });
      }
    } catch (error) {
      if (error instanceof ManagedTaskInspectionError) throw error;
      throw new ManagedTaskInspectionError("invalid-request");
    }
    if (workspace.workspaceDigest !== options.io.workspaceDigest) throw new ManagedTaskInspectionError("workspace-mismatch");
    this.#options = { ...options, workspace };
    this.#stepMs = budget(options.stepTimeoutMs, MANAGED_TASK_INSPECTION_LIMITS.stepMs);
    this.#graceMs = budget(options.cancellationGraceMs, MANAGED_TASK_INSPECTION_LIMITS.graceMs);
    this.#totalMs = budget(options.totalTimeoutMs, MANAGED_TASK_INSPECTION_LIMITS.totalMs);
  }

  async inspect(wire: unknown, signal: AbortSignal = new AbortController().signal): Promise<ManagedTaskInspection> {
    if (this.#poisoned) return fail("poisoned");
    if (this.#busy) return fail("busy");
    if (process.platform !== "win32") return fail("unsupported-platform");
    if (!(signal instanceof AbortSignal)) return fail("invalid-request");
    this.#busy = true;
    const deadline = performance.now() + this.#totalMs;
    let session: ReadSession | undefined, abandoned = false, failure: ManagedTaskInspectionError | undefined;
    let result: ManagedTaskInspection | undefined;
    const buffers: Buffer[] = [];
    const checkTime = () => {
      if (signal.aborted) return fail("cancelled");
      if (performance.now() >= deadline) return fail("timeout");
    };
    const run = <T>(fn: (s: AbortSignal) => Promise<T>) => this.step(fn, signal, Math.min(this.#stepMs, deadline - performance.now()));
    const { workspace, io, policy } = this.#options;
    try {
      checkTime();
      let brief: ReturnType<typeof createWindowsOperatorTaskIntake>;
      try { brief = createWindowsOperatorTaskIntake(wire, policy.snapshot()); }
      catch { return fail("invalid-request"); }
      if (brief.request.workspaceRoot !== workspace.repositoryRoot) return fail("workspace-mismatch");
      const authorize = () => {
        checkTime();
        if (io.workspaceDigest !== workspace.workspaceDigest) return fail("workspace-mismatch");
        try {
          const current = policy.snapshot();
          createWindowsOperatorTaskIntake(wire, current); // source-root intent and exact revision
          for (const operation of ["read", "write"] as const) {
            const paths = operation === "read" ? brief.request.requestedReadFiles : brief.request.requestedWriteFiles;
            for (const path of paths) {
              if (previewWindowsWorkspaceAccess(current.policy, { path: win32.join(workspace.worktreeRoot, path), operation })
                .decision !== "requires-filesystem-validation") return fail("policy-denied");
            }
          }
          if (policy.listEffectIntents().some(row => row.settlement === null || row.settlement.outcome === "quarantined"))
            return fail("recovery-pending");
          policy.assertCurrentBinding(brief.request.expectedBinding);
        } catch (error) {
          if (error instanceof ManagedTaskInspectionError) throw error;
          return fail("policy-denied");
        }
        checkTime();
      };
      authorize();
      await run(async s => {
        const opened = await io.openCustody(s);
        // A timeout can precede successful acquisition. Retain cleanup inside
        // the callback so that late holders are still closed, never discarded.
        if (abandoned) { await opened.close(); throw new Error("late-custody"); }
        session = opened;
      });
      authorize(); await run(s => session!.assertCustody(s));
      const files: InspectedFile[] = []; let total = 0;
      for (const relativePath of [...brief.request.requestedReadFiles].sort()) {
        authorize();
        const cap = Math.min(MANAGED_TASK_INSPECTION_LIMITS.fileBytes, MANAGED_TASK_INSPECTION_LIMITS.totalBytes - total);
        let copy: Buffer | undefined;
        await run(async s => {
          const bytes = snapshotBytes(await session!.read(relativePath, cap, s), cap);
          if (abandoned) { bytes.fill(0); throw new Error("late-read"); }
          buffers.push(bytes); copy = bytes;
        });
        let text: string;
        try { text = decodeBuilderText(copy!); } catch { return fail("content-rejected"); }
        if (containsSecretLikeContent(text)) return fail("content-rejected");
        total += copy!.length;
        files.push({ relativePath, text, byteLength: copy!.length, contentDigest: sha256BuilderDigest(copy!) });
      }
      // Exact complete rereads, not stat-only observations or prefix reads.
      // This catches changes between observations, not a malicious trusted
      // service's ABA substitution. It is not an atomic filesystem snapshot.
      for (let i = 0; i < files.length; i++) {
        authorize(); const file = files[i]!;
        await run(async s => {
          const copy = snapshotBytes(await session!.read(file.relativePath, file.byteLength, s), file.byteLength);
          try { if (!copy.equals(buffers[i]!)) return fail("changed-during-inspection"); }
          finally { copy.fill(0); }
        });
      }
      authorize(); await run(s => session!.assertCustody(s)); authorize();
      result = inspectionResult(brief, workspace, files, total);
      checkTime();
    } catch (error) {
      failure = error instanceof ManagedTaskInspectionError ? error : new ManagedTaskInspectionError("io-failed");
      if (!failure.quiescent) this.#poisoned = true;
    } finally {
      abandoned = true;
      const closingSession = session; session = undefined;
      if (closingSession !== undefined) {
        try {
          // Always initiate stop, even after abort/deadline. A failed or stuck
          // close poisons this instance regardless of prior read success.
          const closing = closingSession.close();
          await this.step(() => closing, undefined, this.#stepMs);
        } catch { this.#poisoned = true; failure = new ManagedTaskInspectionError("unsettled-work", false); }
      }
      for (const bytes of buffers) bytes.fill(0);
      this.#busy = false;
    }
    if (failure) throw failure;
    // Closing is asynchronous: no result is published after revocation/abort
    // during cleanup. This also catches host changes immediately after capture.
    checkTime();
    if (io.workspaceDigest !== workspace.workspaceDigest) return fail("workspace-mismatch");
    try {
      createWindowsOperatorTaskIntake(wire, policy.snapshot());
      policy.assertCurrentBinding(result!.policyBinding);
      if (policy.listEffectIntents().some(row => row.settlement === null || row.settlement.outcome === "quarantined"))
        return fail("recovery-pending");
    } catch (error) {
      if (error instanceof ManagedTaskInspectionError) throw error;
      return fail("policy-denied");
    }
    checkTime(); issued.add(result!); return result!;
  }

  private async step<T>(fn: (signal: AbortSignal) => Promise<T>, external: AbortSignal | undefined, ms: number): Promise<T> {
    if (external?.aborted) return fail("cancelled");
    if (ms <= 0) return fail("timeout");
    const controller = new AbortController(), deadline = performance.now() + ms;
    type Done = { kind: "value"; value: T } | { kind: "error"; error: unknown };
    let timer: ReturnType<typeof setTimeout> | undefined, grace: ReturnType<typeof setTimeout> | undefined;
    let stop!: (reason: "cancelled" | "timeout") => void;
    const stopped = new Promise<{ kind: "stop"; reason: "cancelled" | "timeout" }>(resolve => {
      stop = reason => { resolve({ kind: "stop", reason }); controller.abort(); };
      timer = setTimeout(() => stop("timeout"), Math.max(1, Math.floor(ms)));
    });
    const onAbort = () => stop("cancelled"); external?.addEventListener("abort", onAbort, { once: true });
    const done: Promise<Done> = Promise.resolve().then(() => {
      if (controller.signal.aborted) return fail("cancelled");
      return fn(controller.signal);
    }).then(value => ({ kind: "value", value }), error => ({ kind: "error", error }));
    try {
      const first = await Promise.race([done, stopped]);
      if (first.kind === "value") {
        if (external?.aborted) return fail("cancelled");
        if (performance.now() >= deadline) return fail("timeout");
        return first.value;
      }
      if (first.kind === "error") {
        if (first.error instanceof ManagedTaskInspectionError) throw first.error;
        return fail("io-failed");
      }
      const settled = await Promise.race([done, new Promise<null>(resolve => { grace = setTimeout(() => resolve(null), this.#graceMs); })]);
      throw new ManagedTaskInspectionError(first.reason, settled !== null);
    } finally { clearTimeout(timer); clearTimeout(grace); external?.removeEventListener("abort", onAbort); }
  }
}
