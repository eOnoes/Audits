import { z } from "zod";
import { canonicalJson as wire, sha256Digest } from "../compatibility/canonical-json.js";
import { effectUuid } from "./windows-candidate-effect-state.js";
import { CANDIDATE_V3_CHECKPOINT_HISTORY_DOMAIN } from "./windows-candidate-v3-data.js";
import { CANDIDATE_V3_MAX_INVENTORY_BYTES } from "./windows-candidate-v3-inventory.js";
import { createCandidateV3IncrementalClaims } from "./windows-candidate-v3-incremental.js";
import { boundedV3Text, CandidateV3MessageError, parseCandidateV3Request, encodeCandidateV3Response, V3_MESSAGE_LIMITS } from "./windows-candidate-v3-messages.js";
import type { CandidateV3Identity } from "./windows-candidate-v3-messages.js";

// DORMANT synchronous validation core for future off-dashboard hosting. NO
// worker/process, physical storage/anchor, admission, settlement or effect port.
// The trusted embedding must own this one session for its whole lifetime and
// enforce physical deadlines/termination; JS cannot interrupt synchronous replay.
const bindingSchema = z.object({ lifetimeId: effectUuid, epoch: effectUuid }).strict();
const fail = (): never => { throw new CandidateV3MessageError(); };
export function createCandidateV3ValidationSession(bindingWire: unknown, clock: () => number) {
  let binding: z.infer<typeof bindingSchema>;
  try {
    const raw = boundedV3Text(bindingWire, V3_MESSAGE_LIMITS.headerBytes);
    binding = bindingSchema.parse(JSON.parse(raw)); if (wire(binding) !== raw) return fail();
  } catch { return fail(); }
  let phase: "uninitialized" | "validating" | "ready" | "closed" = "uninitialized";
  let transcript: ReturnType<typeof createCandidateV3IncrementalClaims> | null = null;
  let metadata = "", history = "", identity: CandidateV3Identity | null = null;
  let requestNumber = 0, bootstrapAttempts = 0, lastTime = -1;
  const close = () => { phase = "closed"; transcript?.invalidate(); transcript = null; metadata = ""; history = ""; identity = null; };
  const now = () => { const n = clock(); if (!Number.isSafeInteger(n) || n < 0 || n < lastTime) return fail(); lastTime = n; return n; };
  return Object.freeze({
    status: () => Object.freeze({ kind: "dormant-v3-validation-status-not-custody" as const, phase, bootstrapAttempts, requestNumber }),
    close,
    request: (requestWire: unknown, signal: AbortSignal): string => {
      // Busy re-entrancy cannot poison an in-flight winner or queue a request.
      if (phase === "closed" || phase === "validating") return fail();
      const first = phase === "uninitialized";
      phase = "validating";
      if (first) bootstrapAttempts++;
      try {
        if (signal.aborted) return fail(); const start = now();
        const q = parseCandidateV3Request(first ? "bootstrap" : "append", requestWire);
        if (q.lifetimeId !== binding.lifetimeId || q.epoch !== binding.epoch || now() >= q.deadline
          || q.deadline - start > (first ? V3_MESSAGE_LIMITS.bootstrapMs : V3_MESSAGE_LIMITS.appendMs)) return fail();
        let post: CandidateV3Identity;
        if (first) {
          if (q.operation !== "bootstrap" || bootstrapAttempts !== 1 || q.anchorHistoryDigest !== q.historyDigest) return fail();
          metadata = q.metadataWire; history = q.historyWire;
          transcript = createCandidateV3IncrementalClaims(metadata, q.inventoryWire, history);
          post = Object.freeze([q.metadataDigest, q.inventoryDigest, q.historyDigest, transcript.snapshot().head.checkpointDigest]);
        } else {
          if (q.operation !== "append" || transcript === null || identity === null || requestNumber >= Number.MAX_SAFE_INTEGER
            || q.requestNumber !== requestNumber + 1 || wire(q.pre) !== wire(identity)) return fail();
          // Full bootstrap already validated this canonical history. Appending
          // one bounded encoded string preserves its layout without re-encoding
          // all historical checkpoints or reparsing the complete stream.
          const suffix = '],"domain":' + wire(CANDIDATE_V3_CHECKPOINT_HISTORY_DOMAIN) + '}';
          if (!history.endsWith(suffix)) return fail();
          const cp = wire(q.checkpointWire);
          const bytes = Buffer.byteLength(history) + 1 + Buffer.byteLength(cp);
          if (bytes > CANDIDATE_V3_MAX_INVENTORY_BYTES) return fail();
          const result = transcript.append(q.inventoryWire, q.checkpointWire);
          const nextHistory = history.slice(0, -suffix.length) + ',' + cp + suffix;
          if (Buffer.byteLength(nextHistory) !== bytes) return fail();
          post = Object.freeze([identity[0], q.inputDigest, sha256Digest(nextHistory), result.head.checkpointDigest]);
          history = nextHistory;
        }
        if (signal.aborted || now() >= q.deadline || phase !== "validating") return fail();
        const response = encodeCandidateV3Response(q.operation, requestWire, wire(post));
        if (signal.aborted || now() >= q.deadline || phase !== "validating") return fail();
        // Validation progress only. The coordinator must retain old confirmed S
        // until its distinct local read-back / anchor confirmation completes.
        identity = post; requestNumber = q.requestNumber; phase = "ready";
        return response;
      } catch { close(); return fail(); }
    },
  });
}
