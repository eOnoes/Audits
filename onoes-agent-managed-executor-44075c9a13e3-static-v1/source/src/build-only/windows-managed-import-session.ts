import { canonicalSha256Digest } from "../compatibility/canonical-json.js";
import type { PreparedManagedImport } from "./windows-managed-import.js";
import { WindowsManagedNativeIo, encodeManagedNativeImportRequest, type ManagedNativeIoOptions } from "./windows-managed-native-io.js";
import { SqliteWindowsManagedWorkspaceStore, type ManagedWorkspaceRecord } from "./windows-managed-workspace-store.js";

/** Dormant trusted-host composition, no client listener or production caller.
 * BEFORE constructing: separate import approval + source-read policy, newly
 * provisioned root and immutable native config, exclusive service/job custody.
 * This class is not an admission gate and creates no approval/lease identity.
 * The worker's protected config must bind the SAME root identity supplied here.
 */
export class WindowsManagedImportSession {
  readonly #io: WindowsManagedNativeIo;
  readonly #native: Readonly<ManagedNativeIoOptions>;
  #used = false;
  constructor(private readonly store: SqliteWindowsManagedWorkspaceStore,
    native: ManagedNativeIoOptions, private readonly rootIdentityDigest: string) {
    if (!/^sha256:[a-f0-9]{64}$/.test(rootIdentityDigest)) throw new Error("managed-import-session-invalid");
    this.#native = Object.freeze({...native}); this.#io = new WindowsManagedNativeIo(this.#native);
  }
  async importNew(requestId: string, prepared: PreparedManagedImport, signal: AbortSignal): Promise<ManagedWorkspaceRecord> {
    if (this.#used || !(signal instanceof AbortSignal) || signal.aborted) throw new Error("managed-import-session-unavailable");
    this.#used = true;
    // Validate private byte association BEFORE durable intent or process spawn.
    // No descriptors returned to caller and no raw contents persisted here.
    try {
      const encoded = encodeManagedNativeImportRequest(this.#native.workspaceDigest, prepared); encoded.fill(0);
      const reserved = this.store.reserve({requestId, workspaceDigest: this.#native.workspaceDigest,
        rootIdentityDigest: this.rootIdentityDigest, workerDigest: this.#native.executableSha256,
        manifestDigest: prepared.manifestDigest, fileCount: prepared.summary.fileCount, totalBytes: prepared.summary.byteLength});
      if (signal.aborted) throw new Error("managed-import-session-unavailable");
      this.store.beginImport(requestId, reserved.requestDigest);
      // No transaction is held across this effect. Any throw/lost commit response
      // leaves importing or a terminal record; NEVER automatically start again,
      // clean the root, or infer ready. The outer job contains hung workers.
      await this.#io.importPrepared(prepared, signal);
      // Native success includes response validation and actual child exit. A
      // cancellation observed after that durable effect cannot erase its
      // terminal bookkeeping or turn a ready import into an orphaned row.
      return this.store.recordTerminal(requestId, reserved.requestDigest, "ready", canonicalSha256Digest({
        domain: "agent-managed-import-native-completion/v1", requestDigest: reserved.requestDigest,
        response: "op4-success-and-child-exit-zero"}));
    } finally { this.#io.close(); }
  }
}
