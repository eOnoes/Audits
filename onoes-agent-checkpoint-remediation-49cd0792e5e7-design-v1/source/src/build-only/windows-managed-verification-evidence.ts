import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { isSafeBuilderRelativePath } from "../builder/schemas.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { isResolvedManagedVerificationDefinition, type ResolvedManagedVerificationDefinition } from "./windows-managed-verification-catalog.js";

export const MANAGED_VERIFICATION_REQUEST_VERSION = "onoes-managed-verification-request/v1" as const;
export const MANAGED_VERIFICATION_RESULT_VERSION = "onoes-managed-verification-result/v1" as const;
export const MANAGED_VERIFICATION_MAX_RESULT_BYTES = 65_536;
export const MANAGED_VERIFICATION_MAX_FILES = 128;
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const verificationId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const fileSchema = z.object({ relativePath: z.string().refine(isSafeBuilderRelativePath), contentDigest: digest }).strict();
const requestSchema = z.object({
  schemaVersion: z.literal(MANAGED_VERIFICATION_REQUEST_VERSION),
  kind: z.literal("trusted-content-free-request-not-launch-material"),
  requestId: uuid, operationId: uuid, workspaceDigest: digest, policyBindingDigest: digest,
  files: z.array(fileSchema).min(1).max(MANAGED_VERIFICATION_MAX_FILES), workspaceSubjectDigest: digest, catalogDigest: digest, definitionDigest: digest,
  verificationId, runnerArtifactDigest: digest, commandContractDigest: digest,
  networkAccess: z.literal("denied"), workspaceAccess: z.literal("read-only"),
  scratchAccess: z.literal("private-bounded"), timeoutMs: z.number().int().min(1_000).max(60_000),
  maximumOutputBytes: z.number().int().min(1).max(1_048_576),
  maximumScratchBytes: z.number().int().min(0).max(67_108_864),
  maximumProcessCount: z.number().int().min(1).max(32), requestDigest: digest,
}).strict();
const resultCoreSchema = z.object({
  schemaVersion: z.literal(MANAGED_VERIFICATION_RESULT_VERSION),
  kind: z.literal("content-free-settled-result-not-independent-review"),
  requestDigest: digest, workspaceSubjectDigest: digest, catalogDigest: digest,
  definitionDigest: digest, verificationId, runnerArtifactDigest: digest, commandContractDigest: digest,
  disposition: z.enum(["passed", "failed"]),
  reason: z.enum(["completed", "verification-failed", "cancelled", "timeout", "runner-error", "boundary-denied"]),
  exitCode: z.number().int().min(0).max(255).nullable(),
  processCount: z.number().int().min(0).max(32), outputBytes: z.number().int().min(0).max(1_048_576),
  scratchBytes: z.number().int().min(0).max(67_108_864), networkAccess: z.literal("denied"),
  workspaceMutationObserved: z.literal(false), allRelatedWorkSettled: z.literal(true), evidenceDigest: digest,
}).strict();
const resultSchema = resultCoreSchema.extend({ resultDigest: digest }).strict().superRefine((value, context) => {
  const passed = value.disposition === "passed";
  if (passed !== (value.reason === "completed" && value.exitCode === 0))
    context.addIssue({ code: "custom", message: "pass requires completed zero exit" });
});

export interface ManagedVerificationWorkspaceSubject {
  readonly workspaceDigest: string;
  readonly policyBindingDigest: string;
  readonly files: readonly { readonly relativePath: string; readonly contentDigest: string }[];
}
export type ManagedVerificationRequest = Readonly<z.infer<typeof requestSchema>>;
export type ManagedVerificationResult = Readonly<z.infer<typeof resultSchema>>;
export class ManagedVerificationEvidenceError extends Error {
  constructor(readonly reason: "request-invalid" | "resolution-untrusted" | "result-invalid" | "result-mismatch") {
    super(`managed-verification-evidence-${reason}`); this.name = "ManagedVerificationEvidenceError";
  }
}
const fail = (reason: ManagedVerificationEvidenceError["reason"]): never => { throw new ManagedVerificationEvidenceError(reason); };
const requests = new WeakSet<object>();
/** Provenance only: not approval, launch authority or proof of physical custody. */
export function isManagedVerificationRequest(value: unknown): value is ManagedVerificationRequest {
  return typeof value === "object" && value !== null && requests.has(value);
}
const compareCodeUnits = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

/** Builds content-free request identity only. It accepts no executable, command,
 * arguments, environment, cwd, shell, callback, approval or credentials. */
export function createManagedVerificationRequest(resolution: ResolvedManagedVerificationDefinition,
  input: { readonly requestId: string; readonly operationId: string; readonly subject: ManagedVerificationWorkspaceSubject }): ManagedVerificationRequest {
  if (!isResolvedManagedVerificationDefinition(resolution)) return fail("resolution-untrusted");
  try {
    const files = z.array(fileSchema).min(1).max(MANAGED_VERIFICATION_MAX_FILES).parse(input.subject.files).map(file => ({ ...file }))
      .sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath));
    if (new Set(files.map(file => file.relativePath)).size !== files.length
      || new Set(files.map(file => file.relativePath.toLowerCase())).size !== files.length) return fail("request-invalid");
    const workspaceDigest = digest.parse(input.subject.workspaceDigest);
    const policyBindingDigest = digest.parse(input.subject.policyBindingDigest);
    const workspaceSubjectDigest = canonicalSha256Digest({ domain: "onoes-managed-verification-workspace-subject/v1",
      workspaceDigest, policyBindingDigest, files });
    const definition = resolution.definition;
    const core = { schemaVersion: MANAGED_VERIFICATION_REQUEST_VERSION,
      kind: "trusted-content-free-request-not-launch-material" as const,
      requestId: uuid.parse(input.requestId), operationId: uuid.parse(input.operationId), workspaceDigest, policyBindingDigest,
      files, workspaceSubjectDigest, catalogDigest: resolution.catalogDigest, definitionDigest: resolution.definitionDigest,
      verificationId: definition.verificationId, runnerArtifactDigest: definition.runnerArtifactDigest,
      commandContractDigest: definition.commandContractDigest, networkAccess: definition.networkAccess,
      workspaceAccess: definition.workspaceAccess, scratchAccess: definition.scratchAccess, timeoutMs: definition.timeoutMs,
      maximumOutputBytes: definition.maximumOutputBytes, maximumScratchBytes: definition.maximumScratchBytes,
      maximumProcessCount: definition.maximumProcessCount };
    const result = deepFreeze(requestSchema.parse({ ...core,
      requestDigest: canonicalSha256Digest({ domain: MANAGED_VERIFICATION_REQUEST_VERSION, request: core }) }));
    requests.add(result); return result;
  } catch (error) {
    if (error instanceof ManagedVerificationEvidenceError) throw error;
    return fail("request-invalid");
  }
}

/** Parses one exact content-free result from a separately trusted runner. It
 * validates identity and ceilings but does not prove the runner or boundary. */
export function parseManagedVerificationResult(input: string | Uint8Array,
  request: ManagedVerificationRequest): ManagedVerificationResult {
  if (!isManagedVerificationRequest(request)) return fail("request-invalid");
  try {
    let text: string;
    if (typeof input === "string") {
      if (Buffer.byteLength(input) > MANAGED_VERIFICATION_MAX_RESULT_BYTES) return fail("result-invalid");
      text = input;
    } else {
      if (!(input instanceof Uint8Array) || input.buffer instanceof SharedArrayBuffer
        || input.byteLength > MANAGED_VERIFICATION_MAX_RESULT_BYTES) return fail("result-invalid");
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.from(input));
    }
    const parsed = resultSchema.parse(JSON.parse(text));
    if (canonicalJson(parsed) !== text) return fail("result-invalid");
    const { resultDigest, ...core } = parsed;
    if (resultDigest !== canonicalSha256Digest({ domain: MANAGED_VERIFICATION_RESULT_VERSION, result: core }))
      return fail("result-invalid");
    for (const key of ["requestDigest", "workspaceSubjectDigest", "catalogDigest", "definitionDigest",
      "verificationId", "runnerArtifactDigest", "commandContractDigest"] as const)
      if (parsed[key] !== request[key]) return fail("result-mismatch");
    if (parsed.processCount > request.maximumProcessCount || parsed.outputBytes > request.maximumOutputBytes
      || parsed.scratchBytes > request.maximumScratchBytes) return fail("result-mismatch");
    return deepFreeze(parsed);
  } catch (error) {
    if (error instanceof ManagedVerificationEvidenceError) throw error;
    return fail("result-invalid");
  }
}
