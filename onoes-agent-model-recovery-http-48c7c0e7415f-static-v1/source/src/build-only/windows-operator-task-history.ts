import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { parseWindowsOperatorTaskIntakeRequest } from "./windows-operator-task-intake.js";
import { OperatorTaskStoreError, type SqliteWindowsOperatorTaskStore } from "./windows-operator-task-store.js";

// Dormant paired draft bookkeeping. No approval, candidate import, effect,
// deletion, policy mutation or automatic rebase/retry is available on this API.
export const OPERATOR_TASK_HISTORY_MAX_BODY_BYTES = 200_704;
export const OPERATOR_TASK_HISTORY_MAX_RESPONSE_BYTES = 262_144;
export const OPERATOR_TASK_HISTORY_RATE_LIMIT = 10;
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const epoch = z.number().int().min(1).max(1_000_000_000);
const selector = { storeId: uuid, taskId: uuid, creationEpoch: epoch };
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("index") }).strict(),
  z.object({ action: z.literal("read"), ...selector }).strict(),
  z.object({ action: z.literal("receipt"), storeId: uuid, requestId: uuid, expectedOperationDigest: digest }).strict(),
  z.object({ action: z.literal("create"), storeId: uuid, requestId: uuid, creationEpoch: epoch,
    expectedOperationDigest: digest, brief: z.unknown() }).strict(),
  z.object({ action: z.literal("close"), ...selector, requestId: uuid, expectedRevision: z.number().int().min(1).max(63),
    briefDigest: digest, expectedOperationDigest: digest }).strict(),
]);
export type OperatorTaskHistoryRequest = Readonly<z.infer<typeof schema>>;
const invalid = (): never => { throw new OperatorTaskStoreError("request-invalid"); };
export function parseOperatorTaskHistoryRequest(input: unknown): OperatorTaskHistoryRequest {
  // HTTP supplies fresh canonical JSON. Re-snapshot here so the trusted-host API
  // also never retains mutable caller objects. Canonical JSON rejects accessor
  // properties; this is not a sandbox for hostile in-process JavaScript objects.
  try {
    const wire = canonicalJson(input);
    if (Buffer.byteLength(wire) > OPERATOR_TASK_HISTORY_MAX_BODY_BYTES) return invalid();
    const parsed = schema.safeParse(JSON.parse(wire));
    if (!parsed.success) return invalid();
    if (parsed.data.action === "create") {
      const brief = parseWindowsOperatorTaskIntakeRequest(canonicalJson(parsed.data.brief));
      return deepFreeze({ ...parsed.data, brief });
    }
    return deepFreeze(parsed.data);
  } catch { return invalid(); }
}

/** Pre-computable idempotency identity. Retain the exact request BEFORE sending;
 * never replace its epoch, revision, policy binding or ID after an uncertain result. */
export function computeOperatorTaskHistoryOperationDigest(input: unknown): string {
  let r: OperatorTaskHistoryRequest;
  try {
    const wire = canonicalJson(input);
    if (Buffer.byteLength(wire) > OPERATOR_TASK_HISTORY_MAX_BODY_BYTES) return invalid();
    const fields: unknown = JSON.parse(wire);
    if (fields === null || typeof fields !== "object" || Array.isArray(fields)) return invalid();
    r = parseOperatorTaskHistoryRequest({ ...fields, expectedOperationDigest: `sha256:${"0".repeat(64)}` });
  } catch { return invalid(); }
  if (r.action !== "create" && r.action !== "close") return invalid();
  return canonicalSha256Digest({ domain: "agent-operator-task-operation/v1", operation: r.action,
    requestId: r.requestId, taskId: r.action === "create" ? r.requestId : r.taskId,
    briefDigest: r.action === "create" ? canonicalSha256Digest(r.brief) : r.briefDigest,
    creationEpoch: r.creationEpoch, expectedRevision: r.action === "create" ? 0 : r.expectedRevision, candidate: null });
}

export function accessOperatorTaskHistory(input: unknown, store: SqliteWindowsOperatorTaskStore) {
  const r = parseOperatorTaskHistoryRequest(input);
  const mutation = r.action === "create" || r.action === "close";
  // The store pin is mandatory even for receipt retrieval. A host switching DBs
  // must not silently route an old outbox to the replacement store.
  if (r.action !== "index" && store.readCreationEpoch().storeId !== r.storeId) throw new OperatorTaskStoreError("store-identity-mismatch");
  if (mutation && computeOperatorTaskHistoryOperationDigest(r) !== r.expectedOperationDigest) return invalid();
  let value: unknown;
  switch (r.action) {
    case "index": value = store.listSnapshot(); break;
    case "read": value = store.read(r.taskId, r.creationEpoch); break;
    case "receipt": value = store.readOperation(r.requestId, r.expectedOperationDigest); break;
    case "create": value = store.create(r.requestId, r.creationEpoch, canonicalJson(r.brief)); break;
    case "close": {
      // Read-before-close checks the exact saved subject but grants no authority;
      // the store repeats epoch/revision checks atomically under its write lock.
      if (store.read(r.taskId, r.creationEpoch).briefDigest !== r.briefDigest) throw new OperatorTaskStoreError("binding-mismatch");
      value = store.close(r.requestId, r.taskId, r.creationEpoch, r.expectedRevision); break;
    }
  }
  const response = deepFreeze({ schemaVersion: "agent-operator-task-history-response/v1" as const,
    kind: "draft-bookkeeping-not-work-authorization" as const,
    requestDigest: canonicalSha256Digest(r), action: r.action, value,
    authority: "none" as const, approvalAvailable: false as const, executionEnabled: false as const,
    resumeRequirement: "fresh-policy-inspection-and-planning" as const });
  if (Buffer.byteLength(canonicalJson(response)) > OPERATOR_TASK_HISTORY_MAX_RESPONSE_BYTES) throw new OperatorTaskStoreError("state-invalid");
  return response;
}
