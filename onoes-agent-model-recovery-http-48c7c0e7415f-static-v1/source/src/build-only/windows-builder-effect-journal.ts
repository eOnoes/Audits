import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { SqliteWindowsBuilderRecoveryStore, type RecoveryPreimage, type RecoveryRecord } from "./windows-builder-recovery-store.js";
import { SqliteWindowsWorkspacePolicyStore, WorkspacePolicyStoreError, type WorkspaceEffectRecord, type WorkspacePolicyBinding } from "./windows-workspace-policy-store.js";

// Trusted-host bookkeeping ONLY. No approval verification, lease consumption,
// filesystem callback, worker termination, or execution capability is provided.
// A future consumer must satisfy the independent admission/custody gate first.
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const terminalInput = z.object({ operationId: uuid, requestDigest: digest,
  outcome: z.enum(["completed", "restored", "quarantined"]), evidenceDigest: digest }).strict();
export type BuilderEffectJournalState = "prepared-only" | "intent-recorded" | "effects-possible"
  | "recovery-settled" | "settled" | "quarantined";
export interface BuilderEffectJournalReceipt {
  readonly schemaVersion: "agent-builder-effect-journal/v1";
  readonly kind: "recorded-state-not-authorization";
  readonly operationId: string;
  readonly requestDigest: string;
  readonly state: BuilderEffectJournalState;
  readonly recoveryRecordDigest: string;
  readonly policyEffectRecordDigest: string | null;
}
export interface BuilderEffectJournalInventory {
  readonly schemaVersion: "agent-builder-effect-inventory/v1";
  readonly kind: "recorded-state-not-authorization";
  readonly policyBinding: WorkspacePolicyBinding;
  readonly recoveryStoreId: string;
  readonly operations: readonly BuilderEffectJournalReceipt[];
  readonly unresolvedOperationCount: number;
  readonly inventoryDigest: string;
}
export class BuilderEffectJournalError extends Error {
  constructor(public readonly reason: "request-invalid" | "pair-conflict" | "start-already-recorded"
    | "settlement-not-ready" | "storage-unavailable" | "snapshot-changed") {
    super(`builder-effect-journal-${reason}`); this.name = "BuilderEffectJournalError";
  }
}
const fail = (reason: BuilderEffectJournalError["reason"]): never => { throw new BuilderEffectJournalError(reason); };
function guarded<T>(fn: () => T): T {
  try { return fn(); } catch (error) {
    if (error instanceof BuilderEffectJournalError) throw error;
    return fail("storage-unavailable");
  }
}
function policyOutcome(outcome: "completed" | "restored" | "quarantined") {
  // "unchanged" describes the restored final bytes, NOT absence of prior effects.
  return outcome === "restored" ? "unchanged" as const : outcome;
}
type Pair = { recovery: RecoveryRecord; effect: WorkspaceEffectRecord | null; state: BuilderEffectJournalState };

/** Coordinates two existing stores without pretending their commits are atomic.
 * Both stores and this object belong to ONE exclusive trusted executor. Startup
 * reconciliation must first prove that the old executor/verifier cannot act.
 * A caller-supplied flag, promise rejection or this receipt is not that proof.
 */
export class WindowsBuilderEffectJournal {
  constructor(private readonly recovery: SqliteWindowsBuilderRecoveryStore,
    private readonly policy: SqliteWindowsWorkspacePolicyStore) {}

  /** After separate admission/custody checks: persist preimages, policy blocker,
   * then the effects-possible marker. Returned data is never permission to write.
   * Once the intent exists, retrying this method always denies; inspect/reconcile
   * instead. A preparation-only retry may record an intent, but only after the
   * consumer repeats its independent admission and current-custody checks.
   */
  recordStart(identityInput: unknown, preimages: readonly RecoveryPreimage[]): BuilderEffectJournalReceipt {
    return guarded(() => {
      // Recovery owns identity parsing/copying and lifetime authorization reuse.
      // It is intentionally not replaced by the policy table's uniqueness rule.
      const prepared = this.recovery.prepare(identityInput, preimages);
      const before = this.pair(prepared.operationId);
      if (before.state !== "prepared-only") fail("start-already-recorded");
      const identity = before.recovery.request.identity;
      this.policy.beginEffectIntent({ operationId: prepared.operationId,
        authorizationDigest: identity.authorizationDigest, requestDigest: prepared.requestDigest,
        binding: identity.policyBinding }, prepared.preparedAt);
      // Any error/response loss after the preceding COMMIT leaves a policy
      // blocker. Never erase it or call the effect as an exception fallback.
      this.recovery.markEffectsPossible(prepared.operationId, prepared.requestDigest);
      const after = this.pair(prepared.operationId);
      if (after.state !== "effects-possible"
        || after.recovery.prepared.requestDigest !== prepared.requestDigest) fail("pair-conflict");
      return this.receipt(after);
    });
  }

  /** Read-only recorded-state assessment. In particular, intent-recorded and
   * effects-possible NEVER mean resume, retry, or infer unchanged filesystem.
   */
  inspect(operationId: string): BuilderEffectJournalReceipt {
    if (!uuid.safeParse(operationId).success) fail("request-invalid");
    return guarded(() => this.receipt(this.pair(operationId)));
  }

  /** Discover history without a remembered operation ID after response loss.
   * Read all operation metadata in both stores, not only listUnfinished(). A terminal
   * recovery row can still be missing its policy settlement. Validate each pair
   * and repeat the entire metadata pass to reject observed drift. This is not
   * an atomic cross-database snapshot or proof that a prior worker has stopped.
   * Exclusive trusted ownership remains required; no repair/settlement occurs.
   * Stored preimage CONTENT is neither loaded nor exported by this assessment.
   */
  inspectRecordedOperations(): BuilderEffectJournalInventory {
    return guarded(() => {
      const collect = () => {
        const policyBinding = this.policy.snapshot().binding;
        const recoveryStoreId = this.recovery.readStoreId();
        const effects = new Map(this.policy.listEffectIntents().map(effect => [effect.operationId, effect]));
        const ids = this.recovery.listOperationIds(), idSet = new Set(ids);
        if ([...effects.keys()].some(id => !idSet.has(id))) fail("pair-conflict");
        const operations = ids.map(id => this.receipt(this.join(this.recovery.read(id),
          effects.get(id) ?? null, policyBinding.storeId)));
        if (canonicalJson(this.policy.snapshot().binding) !== canonicalJson(policyBinding)) fail("snapshot-changed");
        return { policyBinding, recoveryStoreId, operations };
      };
      const first = collect(), second = collect();
      if (canonicalJson(first) !== canonicalJson(second)) fail("snapshot-changed");
      return deepFreeze({ schemaVersion: "agent-builder-effect-inventory/v1",
        kind: "recorded-state-not-authorization", ...second,
        unresolvedOperationCount: second.operations.filter(operation => operation.state !== "settled").length,
        inventoryDigest: canonicalSha256Digest({ domain: "agent-builder-effect-inventory/v1", ...second }) });
    });
  }

  /** Trusted host records its independently verified, quiescent result. This
   * does not inspect files or stop a worker. Persist recovery first, release the
   * policy blocker last. Lost responses replay only these immutable records.
   */
  recordSettlement(input: unknown): BuilderEffectJournalReceipt {
    const parsed = terminalInput.safeParse(input);
    if (!parsed.success) return fail("request-invalid");
    const request = parsed.data;
    return guarded(() => {
      const before = this.pair(request.operationId);
      if (before.recovery.prepared.requestDigest !== request.requestDigest) fail("pair-conflict");
      if (before.state === "prepared-only" || before.state === "intent-recorded") fail("settlement-not-ready");
      const saved = this.recovery.recordTerminal(request);
      if (saved.terminal === null) return fail("pair-conflict");
      if (saved.terminal.outcome !== request.outcome
        || saved.terminal.evidenceDigest !== request.evidenceDigest) fail("pair-conflict");
      // Validate the joined record again BEFORE releasing the second blocker.
      const middle = this.pair(request.operationId);
      if (canonicalJson(middle.recovery) !== canonicalJson(saved)) fail("pair-conflict");
      this.policy.settleEffectIntent({ operationId: request.operationId, requestDigest: request.requestDigest,
        outcome: policyOutcome(request.outcome), evidenceDigest: request.evidenceDigest }, saved.terminal.recordedAt);
      const after = this.pair(request.operationId);
      if (canonicalJson(after.recovery) !== canonicalJson(saved)
        || after.state !== (request.outcome === "quarantined" ? "quarantined" : "settled")) fail("pair-conflict");
      return this.receipt(after);
    });
  }

  private pair(operationId: string): Pair {
    const recovery = this.recovery.read(operationId);
    const policyStoreId = this.policy.snapshot().binding.storeId;
    if (policyStoreId !== recovery.request.identity.policyBinding.storeId) fail("pair-conflict");
    let effect: WorkspaceEffectRecord | null;
    try { effect = this.policy.readEffectIntent(operationId); } catch (error) {
      if (!(error instanceof WorkspacePolicyStoreError) || error.reason !== "effect-missing") throw error;
      effect = null;
    }
    return this.join(recovery, effect, policyStoreId);
  }

  private join(recovery: RecoveryRecord, effect: WorkspaceEffectRecord | null, policyStoreId: string): Pair {
    if (policyStoreId !== recovery.request.identity.policyBinding.storeId) fail("pair-conflict");
    if (effect === null) {
      if (recovery.effectsPossibleAt !== null || recovery.terminal !== null) fail("pair-conflict");
      return { recovery, effect, state: "prepared-only" };
    }
    const identity = recovery.request.identity, terminal = recovery.terminal;
    if (effect.operationId !== recovery.prepared.operationId
      || effect.authorizationDigest !== identity.authorizationDigest
      || effect.requestDigest !== recovery.prepared.requestDigest
      || canonicalJson(effect.binding) !== canonicalJson(identity.policyBinding)
      || effect.startedAt < recovery.prepared.preparedAt
      || (recovery.effectsPossibleAt !== null && recovery.effectsPossibleAt < effect.startedAt)) fail("pair-conflict");
    if (effect.settlement !== null) {
      if (terminal === null) return fail("pair-conflict");
      if (effect.settlement.outcome !== policyOutcome(terminal.outcome)
        || effect.settlement.evidenceDigest !== terminal.evidenceDigest
        || effect.settlement.recordedAt < terminal.recordedAt) fail("pair-conflict");
      return { recovery, effect, state: terminal.outcome === "quarantined" ? "quarantined" : "settled" };
    }
    return { recovery, effect, state: terminal !== null ? "recovery-settled"
      : recovery.effectsPossibleAt !== null ? "effects-possible" : "intent-recorded" };
  }

  private receipt(pair: Pair): BuilderEffectJournalReceipt {
    return deepFreeze({ schemaVersion: "agent-builder-effect-journal/v1", kind: "recorded-state-not-authorization",
      operationId: pair.recovery.prepared.operationId, requestDigest: pair.recovery.prepared.requestDigest,
      state: pair.state, recoveryRecordDigest: canonicalSha256Digest(pair.recovery),
      policyEffectRecordDigest: pair.effect === null ? null : canonicalSha256Digest(pair.effect) });
  }
}
