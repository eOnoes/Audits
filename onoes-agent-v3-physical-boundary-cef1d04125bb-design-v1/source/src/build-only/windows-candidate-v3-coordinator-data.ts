import { z } from "zod";
import { canonicalJson as wire, sha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { CANDIDATE_V3_CHECKPOINT_HISTORY_DOMAIN, CANDIDATE_V3_META_MAX_BYTES, parseCandidateV3Metadata } from "./windows-candidate-v3-data.js";
import { CANDIDATE_V3_MAX_INVENTORY_BYTES, CANDIDATE_V3_MAX_OPERATIONS } from "./windows-candidate-v3-inventory.js";
import { CANDIDATE_V3_MAX_CHECKPOINT_BYTES, parseCandidateV3Checkpoint } from "./windows-candidate-v3-record.js";
import { CandidateV3MessageError, V3_MESSAGE_LIMITS, boundedV3Text, candidateV3EscapedBytes } from "./windows-candidate-v3-messages.js";

// DORMANT local snapshot transport, not new ledger/record/history formats or
// evidence that any storage exists. Full inventory/history validity belongs to
// the private validation session; this layer independently binds exact bytes.
const domain = "agent-candidate-v3-local-snapshot/v1";
const snapshotSchema = z.object({ domain: z.literal(domain), metadataWire: z.string(), inventoryWire: z.string(), historyWire: z.string() }).strict();
const historySchema = z.object({ domain: z.literal(CANDIDATE_V3_CHECKPOINT_HISTORY_DOMAIN),
  checkpoints: z.array(z.string().max(CANDIDATE_V3_MAX_CHECKPOINT_BYTES)).min(1).max(7 * CANDIDATE_V3_MAX_OPERATIONS + 1) }).strict();
const fail = (): never => { throw new CandidateV3MessageError(); };
export function encodeCandidateV3LocalSnapshot(metadata: unknown, inventory: unknown, history: unknown): string {
  const metadataWire = boundedV3Text(metadata, CANDIDATE_V3_META_MAX_BYTES);
  const inventoryWire = boundedV3Text(inventory, CANDIDATE_V3_MAX_INVENTORY_BYTES);
  const historyWire = boundedV3Text(history, CANDIDATE_V3_MAX_INVENTORY_BYTES);
  let bytes = Buffer.byteLength(wire({ domain, metadataWire: "", inventoryWire: "", historyWire: "" }));
  for (const s of [metadataWire, inventoryWire, historyWire]) bytes += candidateV3EscapedBytes(s, V3_MESSAGE_LIMITS.bootstrapBytes - bytes);
  const result = wire({ domain, metadataWire, inventoryWire, historyWire });
  if (Buffer.byteLength(result) !== bytes) return fail();
  return result;
}
export function parseCandidateV3LocalSnapshot(input: unknown) {
  try {
    const snapshotWire = boundedV3Text(input, V3_MESSAGE_LIMITS.bootstrapBytes);
    const s = snapshotSchema.parse(JSON.parse(snapshotWire));
    boundedV3Text(s.metadataWire, CANDIDATE_V3_META_MAX_BYTES); boundedV3Text(s.inventoryWire, CANDIDATE_V3_MAX_INVENTORY_BYTES);
    boundedV3Text(s.historyWire, CANDIDATE_V3_MAX_INVENTORY_BYTES);
    if (wire(s) !== snapshotWire) return fail();
    parseCandidateV3Metadata(s.metadataWire);
    const decoded: unknown = JSON.parse(s.historyWire);
    if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)
      || !Array.isArray((decoded as { checkpoints?: unknown }).checkpoints)
      || (decoded as { checkpoints: unknown[] }).checkpoints.length > 7 * CANDIDATE_V3_MAX_OPERATIONS + 1) return fail();
    const history = historySchema.parse(decoded);
    if (wire(history) !== s.historyWire) return fail();
    const head = parseCandidateV3Checkpoint(history.checkpoints.at(-1), s.metadataWire);
    return deepFreeze({ kind: "local-snapshot-byte-claims-not-validated-history" as const, ...s, snapshotWire, head,
      identity: [sha256Digest(s.metadataWire), sha256Digest(s.inventoryWire), sha256Digest(s.historyWire), head.checkpointDigest] as const });
  } catch { return fail(); }
}
export function stageCandidateV3LocalSnapshot(beforeWire: unknown, inventory: unknown, checkpoint: unknown) {
  const before = parseCandidateV3LocalSnapshot(beforeWire), inventoryWire = boundedV3Text(inventory, CANDIDATE_V3_MAX_INVENTORY_BYTES);
  const checkpointWire = boundedV3Text(checkpoint, CANDIDATE_V3_MAX_CHECKPOINT_BYTES), cp = parseCandidateV3Checkpoint(checkpointWire, before.metadataWire);
  if (cp.sequence !== before.head.sequence + 1 || cp.previousCheckpointDigest !== before.head.checkpointDigest) return fail();
  const suffix = '],"domain":' + wire(CANDIDATE_V3_CHECKPOINT_HISTORY_DOMAIN) + '}';
  if (!before.historyWire.endsWith(suffix)) return fail();
  const encodedCp = wire(checkpointWire), size = Buffer.byteLength(before.historyWire) + 1 + Buffer.byteLength(encodedCp);
  if (size > CANDIDATE_V3_MAX_INVENTORY_BYTES) return fail();
  const history = before.historyWire.slice(0, -suffix.length) + ',' + encodedCp + suffix;
  return parseCandidateV3LocalSnapshot(encodeCandidateV3LocalSnapshot(before.metadataWire, inventoryWire, history));
}
