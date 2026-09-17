import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { CandidateV3DataError, parseCandidateV3Metadata, CANDIDATE_SETTLEMENT_MAX_BYTES,
  CANDIDATE_V3_INVENTORY_ROOT_DOMAIN, CANDIDATE_V3_INVENTORY_TRANSPORT_DOMAIN,
  CANDIDATE_V3_CHECKPOINT_HISTORY_DOMAIN } from "./windows-candidate-v3-data.js";
import { parseCandidateV3Record, parseCandidateV3Checkpoint, CANDIDATE_V3_MAX_RECORD_BYTES,
  CANDIDATE_V3_MAX_CHECKPOINT_BYTES, CANDIDATE_V3_OUTCOME_STATES } from "./windows-candidate-v3-record.js";

// DATA ONLY. A caller can omit or coherently forge rows AND their checkpoint.
// Authentic complete storage discovery, anchor freshness and admission are absent.
export const CANDIDATE_V3_MAX_OPERATIONS = 1_000;
export const CANDIDATE_V3_MAX_INVENTORY_BYTES = 64 * 1024 * 1024;
const transport = z.object({ domain: z.literal(CANDIDATE_V3_INVENTORY_TRANSPORT_DOMAIN), records: z.array(z.object({
  recordWire: z.string().max(CANDIDATE_V3_MAX_RECORD_BYTES),
  settlementWire: z.string().max(CANDIDATE_SETTLEMENT_MAX_BYTES).nullable(),
  checkpointAWire: z.string().max(CANDIDATE_V3_MAX_CHECKPOINT_BYTES).nullable(),
}).strict()).max(CANDIDATE_V3_MAX_OPERATIONS) }).strict();
const fail = (): never => { throw new CandidateV3DataError(); };
const parentFields = ["installationId", "namespaceId", "storeId", "workflowId", "workspaceDigest", "policyBindingDigest",
  "candidateDigest", "reviewMaterialDigest", "sourceManifestDigest", "requestDigest", "guestImageDigest", "guestGeneration",
  "controllerIdentityDigest", "resourcePolicyDigest"] as const;

/** Validate every supplied row independently of SQL indexes, then hash only the
 * bounded tuple inventory. Does not establish that the caller supplied all rows. */
export function parseCandidateV3Inventory(wire: unknown, metadataWire: unknown) {
  try {
    const metadata = parseCandidateV3Metadata(metadataWire);
    if (typeof wire !== "string" || wire.length > CANDIDATE_V3_MAX_INVENTORY_BYTES
      || Buffer.byteLength(wire, "utf8") > CANDIDATE_V3_MAX_INVENTORY_BYTES) return fail();
    const decoded: unknown = JSON.parse(wire);
    // JSON.parse produces passive data. Check collection size before zod can
    // traverse a hostile oversized array and accumulate per-element errors.
    if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)
      || !Array.isArray((decoded as { records?: unknown }).records)
      || (decoded as { records: unknown[] }).records.length > CANDIDATE_V3_MAX_OPERATIONS) return fail();
    const input = transport.parse(decoded);
    if (canonicalJson(input) !== wire) return fail();
    const rows = input.records.map(r => parseCandidateV3Record(r.recordWire, metadataWire, r.settlementWire, r.checkpointAWire));
    const approvals = new Set<string>(), workflows = new Set<string>(), blockedWorkspaces = new Set<string>();
    const byId = new Map(rows.map(r => [r.record.intent.operationId, r]));
    let previousId = "", sequence = 0;
    const entries = rows.map(({ record }) => {
      const { intent } = record, workflow = `${intent.workflowId}/${intent.kind}`, state = record.events.at(-1)?.state ?? "reserved";
      if (intent.operationId <= previousId || approvals.has(record.approvalIdentityDigest) || workflows.has(workflow)) return fail();
      previousId = intent.operationId; approvals.add(record.approvalIdentityDigest); workflows.add(workflow);
      if (state !== "released") {
        if (blockedWorkspaces.has(intent.workspaceDigest)) return fail();
        blockedWorkspaces.add(intent.workspaceDigest);
      }
      sequence += record.events.length + 1;
      if (intent.kind === "publish") {
        const parent = byId.get(intent.executionOperationId), release = parent?.record.events.at(-1);
        if (!parent || parent.record.intent.kind !== "execute" || release?.state !== "released" || release.outcome !== "completed"
          || parent.settlementEvidence?.verificationPassed !== true || parent.settlementEvidence.resultDigest !== intent.resultDigest
          || parentFields.some(k => parent.record.intent[k] !== intent[k]) || record.reservedAt < release.recordedAt) return fail();
      }
      return { operationId: intent.operationId, eventIndex: record.events.length,
        recordDigest: canonicalSha256Digest(record), approvalIdentityDigest: record.approvalIdentityDigest, state };
    });
    const core = { domain: CANDIDATE_V3_INVENTORY_ROOT_DOMAIN, installationId: metadata.installationId,
      namespaceId: metadata.namespaceId, storeId: metadata.storeId, operationCount: rows.length, entries };
    return deepFreeze({ kind: "parsed-v3-inventory-not-admission" as const, core,
      inventoryRootDigest: canonicalSha256Digest(core), sequence, rows });
  } catch { return fail(); }
}

/** Match one checkpoint claim to all supplied post-commit records. The exact
 * sequence assumes retained append-only histories, with one checkpoint per
 * reservation/event and no pruning/migration. No anchor authentication occurs. */
export function parseCandidateV3CheckpointSnapshot(inventoryWire: unknown, metadataWire: unknown, checkpointWire: unknown) {
  const inventory = parseCandidateV3Inventory(inventoryWire, metadataWire), checkpoint = parseCandidateV3Checkpoint(checkpointWire, metadataWire);
  if (checkpoint.inventoryRootDigest !== inventory.inventoryRootDigest || checkpoint.operationCount !== inventory.rows.length
    || checkpoint.sequence !== inventory.sequence) return fail();
  if (inventory.rows.length) {
    const subject = inventory.rows.find(r => r.record.intent.operationId === checkpoint.operationId);
    if (!subject || checkpoint.eventIndex !== subject.record.events.length || checkpoint.recordDigest !== canonicalSha256Digest(subject.record)
      || checkpoint.approvalIdentityDigest !== subject.record.approvalIdentityDigest
      || checkpoint.producerGeneration !== subject.record.intent.ownerGeneration) return fail();
    const at = subject.record.events.at(-1)?.recordedAt ?? subject.record.reservedAt;
    if (inventory.rows.some(r => (r.record.events.at(-1)?.recordedAt ?? r.record.reservedAt) > at)) return fail();
  }
  return deepFreeze({ kind: "matched-v3-checkpoint-claim-not-admission" as const, inventory, checkpoint });
}

/** Restricted adjacent A->B data model: no intervening operation/checkpoint.
 * Authenticate neither checkpoint and do not infer physical fence release. */
export function parseCandidateV3ReleasePair(beforeWire: unknown, afterWire: unknown, metadataWire: unknown,
  checkpointAWire: unknown, checkpointBWire: unknown) {
  const a = parseCandidateV3CheckpointSnapshot(beforeWire, metadataWire, checkpointAWire);
  const b = parseCandidateV3CheckpointSnapshot(afterWire, metadataWire, checkpointBWire);
  if (b.checkpoint.sequence !== a.checkpoint.sequence + 1 || b.checkpoint.previousCheckpointDigest !== a.checkpoint.checkpointDigest
    || b.checkpoint.operationId !== a.checkpoint.operationId || a.inventory.rows.length !== b.inventory.rows.length) return fail();
  for (let n = 0; n < a.inventory.rows.length; n++) {
    const before = a.inventory.rows[n]!, after = b.inventory.rows[n]!;
    if (before.record.intent.operationId !== after.record.intent.operationId) return fail();
    if (before.record.intent.operationId !== a.checkpoint.operationId) {
      if (canonicalJson(before) !== canonicalJson(after)) return fail();
      continue;
    }
    const release = after.record.events.at(-1);
    if (release?.state !== "released" || after.record.events.length !== before.record.events.length + 1
      || canonicalJson({ ...after.record, events: after.record.events.slice(0, -1) }) !== canonicalJson(before.record)
      || canonicalJson(before.settlementEvidence) !== canonicalJson(after.settlementEvidence)
      || after.outcomeCheckpoint?.checkpointDigest !== a.checkpoint.checkpointDigest
      || release.outcomeCheckpointDigest !== a.checkpoint.checkpointDigest) return fail();
  }
  return deepFreeze({ kind: "matched-v3-release-pair-not-admission" as const, before: a, after: b });
}

/** Replay the complete retained checkpoint stream, including interleaved
 * operations between A and B. No pruning, missing genesis or inferred records.
 * This authenticates nothing: a coherent forged stream remains a coherent claim. */
export function parseCandidateV3CheckpointHistory(inventoryWire: unknown, metadataWire: unknown, historyWire: unknown) {
  try {
    const inventory = parseCandidateV3Inventory(inventoryWire, metadataWire);
    if (typeof historyWire !== "string" || historyWire.length > CANDIDATE_V3_MAX_INVENTORY_BYTES
      || Buffer.byteLength(historyWire, "utf8") > CANDIDATE_V3_MAX_INVENTORY_BYTES) return fail();
    const decoded: unknown = JSON.parse(historyWire);
    if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)
      || !Array.isArray((decoded as { checkpoints?: unknown }).checkpoints)
      || (decoded as { checkpoints: unknown[] }).checkpoints.length > 7 * CANDIDATE_V3_MAX_OPERATIONS + 1) return fail();
    const input = z.object({ domain: z.literal(CANDIDATE_V3_CHECKPOINT_HISTORY_DOMAIN),
      checkpoints: z.array(z.string().max(CANDIDATE_V3_MAX_CHECKPOINT_BYTES)).min(1).max(7 * CANDIDATE_V3_MAX_OPERATIONS + 1),
    }).strict().parse(decoded);
    if (canonicalJson(input) !== historyWire || input.checkpoints.length !== inventory.sequence + 1) return fail();
    const rows = new Map(inventory.rows.map(r => [r.record.intent.operationId, r]));
    const entries = new Map<string, (typeof inventory.core.entries)[number]>(), blocked = new Map<string, string>();
    // Derived in the validated traversal, including when optional transport A
    // has not arrived. A plain frozen object avoids mutable Map.set on returns.
    const outcomeCheckpointByOperation: Record<string, string> = {};
    let previous = parseCandidateV3Checkpoint(input.checkpoints[0], metadataWire), lastAt = "";
    if (previous.sequence !== 0) return fail();
    for (let sequence = 1; sequence < input.checkpoints.length; sequence++) {
      const cp = parseCandidateV3Checkpoint(input.checkpoints[sequence], metadataWire), row = rows.get(cp.operationId ?? "");
      if (!row || cp.sequence !== sequence || cp.previousCheckpointDigest !== previous.checkpointDigest
        || cp.producerGeneration !== row.record.intent.ownerGeneration || cp.approvalIdentityDigest !== row.record.approvalIdentityDigest) return fail();
      const { record } = row, id = record.intent.operationId, prior = entries.get(id), index = cp.eventIndex!;
      if (index !== (prior ? prior.eventIndex + 1 : 0) || index > record.events.length) return fail();
      const prefix = { ...record, events: record.events.slice(0, index) }, event = prefix.events.at(-1);
      const at = event?.recordedAt ?? record.reservedAt;
      if (at < lastAt || cp.recordDigest !== canonicalSha256Digest(prefix)) return fail();
      lastAt = at;
      if (index === 0) {
        if (blocked.has(record.intent.workspaceDigest)) return fail();
        if (record.intent.kind === "publish") {
          const parent = entries.get(record.intent.executionOperationId);
          if (!parent || parent.state !== "released") return fail();
        }
        blocked.set(record.intent.workspaceDigest, id);
      } else if (event?.state === "released") {
        if (blocked.get(record.intent.workspaceDigest) !== id) return fail();
        blocked.delete(record.intent.workspaceDigest);
      }
      entries.set(id, { operationId: id, eventIndex: index, recordDigest: cp.recordDigest!,
        approvalIdentityDigest: record.approvalIdentityDigest, state: event?.state ?? "reserved" });
      const core = { ...inventory.core, operationCount: entries.size,
        entries: [...entries.values()].sort((a, b) => a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0) };
      if (cp.operationCount !== entries.size || cp.inventoryRootDigest !== canonicalSha256Digest(core)) return fail();
      // Any supplied A must be the exact historical checkpoint in this stream,
      // not a fabricated self-consistent prefix with a different inventory root.
      if (row.outcomeCheckpoint?.eventIndex === index && row.outcomeCheckpoint.checkpointDigest !== cp.checkpointDigest) return fail();
      if (event && (CANDIDATE_V3_OUTCOME_STATES as readonly string[]).includes(event.state)) {
        if (outcomeCheckpointByOperation[id] !== undefined) return fail();
        outcomeCheckpointByOperation[id] = cp.checkpointDigest;
      }
      previous = cp;
    }
    if (entries.size !== inventory.rows.length || previous.inventoryRootDigest !== inventory.inventoryRootDigest
      || inventory.core.entries.some(e => entries.get(e.operationId)?.recordDigest !== e.recordDigest)) return fail();
    return deepFreeze({ kind: "matched-v3-checkpoint-history-not-admission" as const, inventory, head: previous,
      checkpointCount: input.checkpoints.length, lastAt, outcomeCheckpointByOperation });
  } catch { return fail(); }
}
