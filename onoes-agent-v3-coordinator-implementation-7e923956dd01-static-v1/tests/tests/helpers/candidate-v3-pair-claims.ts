import { createHash } from "node:crypto";
import { canonicalJson } from "../../src/compatibility/canonical-json.js";
import { CandidateV3DataError } from "../../src/build-only/windows-candidate-v3-data.js";
import { parseCandidateV3CheckpointHistory } from "../../src/build-only/windows-candidate-v3-inventory.js";

// TEST-ONLY groundwork for D-1/D-2/C13. These are unauthenticated strings, NOT
// ledger reads, authenticated anchor discovery, coordinator state or admission.
// No storage/worker/effect port exists here; physical C13 remains NOT RUN.
const fail = (): never => { throw new CandidateV3DataError(); };
const digest = (wire: string) => "sha256:" + createHash("sha256").update(wire, "utf8").digest("hex");
export function inspectSyntheticPairClaims(metadataWire: unknown, inventoryWire: unknown, localHistoryWire: unknown, anchorHistoryWire: unknown) {
  if (typeof metadataWire !== "string" || typeof inventoryWire !== "string"
    || typeof localHistoryWire !== "string" || typeof anchorHistoryWire !== "string") return fail();
  const local = parseCandidateV3CheckpointHistory(inventoryWire, metadataWire, localHistoryWire);
  // The reference has validated the canonical envelope and every local prefix.
  // Anchor claims must be byte-exact equal to that stream or its one-tail prefix;
  // no normalization, head-only comparison or arbitrary anchor input parse.
  const history = JSON.parse(localHistoryWire) as { domain: string; checkpoints: string[] };
  const equal = anchorHistoryWire === localHistoryWire;
  const oneAhead = history.checkpoints.length > 1 && anchorHistoryWire === canonicalJson({
    domain: history.domain, checkpoints: history.checkpoints.slice(0, -1),
  });
  if (!equal && !oneAhead) return fail();
  return Object.freeze({ kind: "synthetic-pair-claims-not-authenticated-not-admission" as const,
    relation: equal ? "equal-claims" as const : "one-ahead-claims" as const,
    identity: Object.freeze([digest(metadataWire), digest(inventoryWire), digest(localHistoryWire), local.head.checkpointDigest] as const),
    localCheckpointCount: history.checkpoints.length,
    claimedAnchorCheckpointCount: history.checkpoints.length - (equal ? 0 : 1),
  });
}

// Even in the future harness, one-ahead is not normal forward readiness. This
// predicate does not perform reconciliation, authenticate a stream or call effects.
export function requireEqualSyntheticPair(metadataWire: unknown, inventoryWire: unknown, localHistoryWire: unknown, anchorHistoryWire: unknown) {
  const pair = inspectSyntheticPairClaims(metadataWire, inventoryWire, localHistoryWire, anchorHistoryWire);
  if (pair.relation !== "equal-claims") return fail();
  return pair;
}
