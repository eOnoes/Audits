import { canonicalJson } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { CandidateV3DataError } from "./windows-candidate-v3-data.js";
import { parseCandidateV3CheckpointHistory, parseCandidateV3CheckpointSnapshot } from "./windows-candidate-v3-inventory.js";

// PURE CLAIM VALIDATION ONLY. No storage, anchor, owner epoch, clock, callback,
// process, effect or permission. Advancing this transcript is NOT promoting a
// coordinator's confirmed S after a durable pair. No live consumer is wired.
// A future protected coordinator must separately stage and confirm its pair;
// passing strings here cannot prove physical custody or authentic history.
type ClaimState = ReturnType<typeof parseCandidateV3CheckpointHistory>;
const fail = (): never => { throw new CandidateV3DataError(); };
const outcomes: ReadonlySet<string> = new Set(["completed", "failed", "cancelled", "restored", "stopped-without-result"]);

function summary(state: ClaimState) {
  return deepFreeze({ kind: "validated-v3-incremental-claim-not-admission" as const,
    head: state.head, inventoryRootDigest: state.inventory.inventoryRootDigest,
    operationCount: state.inventory.rows.length, lastAt: state.lastAt,
    outcomeCheckpointByOperation: state.outcomeCheckpointByOperation });
}

/** Full replay is the only bootstrap. There is no serialized-state import,
 * reset, caller object inspection or alternate acceptance path. Any append
 * denial permanently invalidates this instance, including parse failures. */
export function createCandidateV3IncrementalClaims(metadataWire: unknown, inventoryWire: unknown, historyWire: unknown) {
  if (typeof metadataWire !== "string") return fail();
  let state: ClaimState | null = parseCandidateV3CheckpointHistory(inventoryWire, metadataWire, historyWire);
  const current = (): ClaimState => state ?? fail();
  return Object.freeze({
    snapshot: () => summary(current()),
    invalidate: (): void => { state = null; },
    append: (nextInventoryWire: unknown, checkpointWire: unknown) => {
      try {
        const before = current();
        // Exactly one full inventory parse/root calculation, through the join.
        const next = parseCandidateV3CheckpointSnapshot(nextInventoryWire, metadataWire, checkpointWire);
        const cp = next.checkpoint;
        if (cp.sequence !== before.head.sequence + 1 || cp.previousCheckpointDigest !== before.head.checkpointDigest) return fail();
        const priorRows = new Map(before.inventory.rows.map(r => [r.record.intent.operationId, r]));
        const rows = new Map(next.inventory.rows.map(r => [r.record.intent.operationId, r]));
        let changed = 0;
        for (const [id, prior] of priorRows) {
          const row = rows.get(id);
          if (!row) return fail();
          if (canonicalJson(row.record) !== canonicalJson(prior.record)) {
            if (id !== cp.operationId) return fail();
            changed++;
          }
          if (prior.settlementEvidence !== null && canonicalJson(prior.settlementEvidence) !== canonicalJson(row.settlementEvidence)) return fail();
          // Stricter than stateless replay: a bound context cannot disappear.
          if (prior.outcomeCheckpoint !== null && canonicalJson(prior.outcomeCheckpoint) !== canonicalJson(row.outcomeCheckpoint)) return fail();
        }
        for (const id of rows.keys()) if (!priorRows.has(id)) {
          if (id !== cp.operationId) return fail();
          changed++;
        }
        if (changed !== 1 || cp.operationId === null) return fail();
        const row = rows.get(cp.operationId);
        if (!row) return fail();
        const record = row.record, prior = priorRows.get(cp.operationId);
        if (prior) {
          if (record.events.length !== prior.record.events.length + 1
            || canonicalJson({ ...record, events: record.events.slice(0, -1) }) !== canonicalJson(prior.record)) return fail();
        } else {
          if (record.events.length !== 0) return fail();
          if (before.inventory.rows.some(r => r.record.intent.workspaceDigest === record.intent.workspaceDigest
            && r.record.events.at(-1)?.state !== "released")) return fail();
          if (record.intent.kind === "publish"
            && priorRows.get(record.intent.executionOperationId)?.record.events.at(-1)?.state !== "released") return fail();
        }
        const event = record.events.at(-1), lastAt = event?.recordedAt ?? record.reservedAt;
        if (lastAt < before.lastAt) return fail();
        const knownA = { ...before.outcomeCheckpointByOperation };
        if (event && outcomes.has(event.state)) {
          if (knownA[cp.operationId] !== undefined) return fail();
          knownA[cp.operationId] = cp.checkpointDigest;
        }
        for (const [id, entry] of rows) {
          if (entry.outcomeCheckpoint !== null && entry.outcomeCheckpoint.checkpointDigest !== knownA[id]) return fail();
        }
        // Only the data transcript advances. Nothing here asserts a commit,
        // authenticated append, response settlement or current-owner admission.
        const candidate: ClaimState = deepFreeze({ ...before, inventory: next.inventory, head: cp,
          checkpointCount: before.checkpointCount + 1, lastAt, outcomeCheckpointByOperation: knownA });
        const result = summary(candidate);
        state = candidate;
        return result;
      } catch {
        state = null;
        return fail();
      }
    },
  });
}
