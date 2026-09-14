import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { isResolvedManagedVerificationDefinition, type ResolvedManagedVerificationDefinition } from "./windows-managed-verification-catalog.js";

export const MANAGED_VERIFICATION_LAUNCH_CONTRACT_VERSION = "onoes-managed-verification-launch-contract/v1" as const;
export const MANAGED_VERIFICATION_MAX_LAUNCH_CONTRACT_BYTES = 32_768;
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const verificationId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const contractCoreSchema = z.object({
  schemaVersion: z.literal(MANAGED_VERIFICATION_LAUNCH_CONTRACT_VERSION),
  kind: z.literal("trusted-static-launch-shape-not-task-input"), verificationId,
  runtimeKind: z.literal("node-esm"), runtimeArtifactDigest: digest, runnerArtifactDigest: digest,
  invocationProfile: z.literal("runtime-runner-request-stdin-result-stdout/v1"),
  workingDirectoryPolicy: z.literal("private-scratch-root"),
  environmentPolicy: z.literal("fixed-minimal-no-caller-inheritance/v1"),
  standardInputPolicy: z.literal("one-canonical-managed-verification-request/v1"),
  standardOutputPolicy: z.literal("one-canonical-managed-verification-result/v1"),
  standardErrorPolicy: z.literal("bounded-discarded-content-not-evidence/v1"),
  networkAccess: z.literal("denied"), workspaceAccess: z.literal("read-only"),
  scratchAccess: z.literal("private-bounded"), detachedProcesses: z.literal("denied"),
}).strict();
const contractSchema = contractCoreSchema.extend({ contractDigest: digest }).strict();
export type ManagedVerificationLaunchContract = Readonly<z.infer<typeof contractSchema>>;
export interface ResolvedManagedVerificationLaunchContract {
  readonly schemaVersion: "onoes-managed-verification-launch-resolution/v1";
  readonly kind: "matched-static-launch-shape-not-execution";
  readonly catalogDigest: string;
  readonly definitionDigest: string;
  readonly contractDigest: string;
  readonly contract: ManagedVerificationLaunchContract;
}
export class ManagedVerificationLaunchContractError extends Error {
  constructor(readonly reason: "contract-invalid" | "contract-untrusted" | "contract-mismatch") {
    super(`managed-verification-launch-${reason}`); this.name = "ManagedVerificationLaunchContractError";
  }
}
const fail = (reason: ManagedVerificationLaunchContractError["reason"]): never => { throw new ManagedVerificationLaunchContractError(reason); };
const parsedContracts = new WeakSet<object>();
const resolvedContracts = new WeakSet<object>();

/** Parses one exact host-owned launch-shape pin. It contains no executable path,
 * command, argument, cwd, environment value, callback, approval or credential. */
export function parseManagedVerificationLaunchContract(input: string | Uint8Array): ManagedVerificationLaunchContract {
  try {
    let text: string;
    if (typeof input === "string") {
      if (Buffer.byteLength(input) > MANAGED_VERIFICATION_MAX_LAUNCH_CONTRACT_BYTES) return fail("contract-invalid");
      text = input;
    } else {
      if (!(input instanceof Uint8Array) || input.buffer instanceof SharedArrayBuffer
        || input.byteLength > MANAGED_VERIFICATION_MAX_LAUNCH_CONTRACT_BYTES) return fail("contract-invalid");
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.from(input));
    }
    const parsed = contractSchema.parse(JSON.parse(text));
    if (canonicalJson(parsed) !== text) return fail("contract-invalid");
    const { contractDigest, ...core } = parsed;
    if (contractDigest !== canonicalSha256Digest({ domain: MANAGED_VERIFICATION_LAUNCH_CONTRACT_VERSION, contract: core }))
      return fail("contract-invalid");
    const result = deepFreeze(parsed); parsedContracts.add(result); return result;
  } catch (error) {
    if (error instanceof ManagedVerificationLaunchContractError) throw error;
    return fail("contract-invalid");
  }
}

/** Matches two independently parsed pins. The result still carries identities
 * and declarative policy only; it cannot locate or launch an artifact. */
export function resolveManagedVerificationLaunchContract(resolution: ResolvedManagedVerificationDefinition,
  contract: ManagedVerificationLaunchContract, expectedContractDigest: string): ResolvedManagedVerificationLaunchContract {
  if (!isResolvedManagedVerificationDefinition(resolution) || typeof contract !== "object" || contract === null
    || !parsedContracts.has(contract) || !digest.safeParse(expectedContractDigest).success) return fail("contract-untrusted");
  if (expectedContractDigest !== contract.contractDigest || resolution.definition.commandContractDigest !== contract.contractDigest
    || resolution.definition.verificationId !== contract.verificationId
    || resolution.definition.runnerArtifactDigest !== contract.runnerArtifactDigest
    || resolution.definition.networkAccess !== contract.networkAccess
    || resolution.definition.workspaceAccess !== contract.workspaceAccess
    || resolution.definition.scratchAccess !== contract.scratchAccess) return fail("contract-mismatch");
  const result: ResolvedManagedVerificationLaunchContract = deepFreeze({
    schemaVersion: "onoes-managed-verification-launch-resolution/v1",
    kind: "matched-static-launch-shape-not-execution", catalogDigest: resolution.catalogDigest,
    definitionDigest: resolution.definitionDigest, contractDigest: contract.contractDigest, contract,
  } as const);
  resolvedContracts.add(result); return result;
}

/** Private provenance predicate for a later build-only trusted host. */
export function isResolvedManagedVerificationLaunchContract(value: unknown): value is ResolvedManagedVerificationLaunchContract {
  return typeof value === "object" && value !== null && resolvedContracts.has(value);
}
