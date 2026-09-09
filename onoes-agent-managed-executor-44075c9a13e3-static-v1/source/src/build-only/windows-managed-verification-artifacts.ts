import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { isSafeBuilderRelativePath } from "../builder/schemas.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { isResolvedManagedVerificationLaunchContract,
  type ResolvedManagedVerificationLaunchContract } from "./windows-managed-verification-launch-contract.js";

export const MANAGED_VERIFICATION_ARTIFACT_INVENTORY_VERSION = "onoes-managed-verification-artifact-inventory/v1" as const;
export const MANAGED_VERIFICATION_MAX_ARTIFACT_INVENTORY_BYTES = 131_072;
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const artifactId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const artifactSchema = z.object({
  artifactId, role: z.enum(["runtime", "runner"]),
  relativePath: z.string().refine(isSafeBuilderRelativePath), artifactDigest: digest,
  byteLength: z.number().int().min(1).max(268_435_456),
}).strict();
const inventorySchema = z.object({
  schemaVersion: z.literal(MANAGED_VERIFICATION_ARTIFACT_INVENTORY_VERSION),
  kind: z.literal("protected-install-relative-artifact-pins-not-custody"),
  rootBindingDigest: digest, entries: z.array(artifactSchema).min(2).max(128), inventoryDigest: digest,
}).strict();
export type ManagedVerificationArtifactInventory = Readonly<z.infer<typeof inventorySchema>>;
export interface ResolvedManagedVerificationArtifacts {
  readonly schemaVersion: "onoes-managed-verification-artifact-resolution/v1";
  readonly kind: "matched-protected-relative-artifacts-not-opened";
  readonly catalogDigest: string;
  readonly definitionDigest: string;
  readonly launchContractDigest: string;
  readonly inventoryDigest: string;
  readonly rootBindingDigest: string;
  readonly runtime: Readonly<z.infer<typeof artifactSchema>>;
  readonly runner: Readonly<z.infer<typeof artifactSchema>>;
}
export class ManagedVerificationArtifactError extends Error {
  constructor(readonly reason: "inventory-invalid" | "inventory-untrusted" | "artifact-mismatch") {
    super(`managed-verification-artifact-${reason}`); this.name = "ManagedVerificationArtifactError";
  }
}
const fail = (reason: ManagedVerificationArtifactError["reason"]): never => { throw new ManagedVerificationArtifactError(reason); };
const inventories = new WeakSet<object>();
const resolutions = new WeakSet<object>();

/** Parses exact inventory bytes. Relative paths are declarations under a future
 * protected root handle; parsing does not resolve or open them. */
export function parseManagedVerificationArtifactInventory(input: string | Uint8Array): ManagedVerificationArtifactInventory {
  try {
    let text: string;
    if (typeof input === "string") {
      if (Buffer.byteLength(input) > MANAGED_VERIFICATION_MAX_ARTIFACT_INVENTORY_BYTES) return fail("inventory-invalid");
      text = input;
    } else {
      if (!(input instanceof Uint8Array) || input.buffer instanceof SharedArrayBuffer
        || input.byteLength > MANAGED_VERIFICATION_MAX_ARTIFACT_INVENTORY_BYTES) return fail("inventory-invalid");
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.from(input));
    }
    const parsed = inventorySchema.parse(JSON.parse(text));
    if (canonicalJson(parsed) !== text) return fail("inventory-invalid");
    let prior = "";
    const paths = new Set<string>(), digests = new Set<string>();
    for (const entry of parsed.entries) {
      if (entry.artifactId <= prior) return fail("inventory-invalid"); prior = entry.artifactId;
      const path = entry.relativePath.toLowerCase();
      if (paths.has(path) || digests.has(entry.artifactDigest)) return fail("inventory-invalid");
      paths.add(path); digests.add(entry.artifactDigest);
    }
    const expected = canonicalSha256Digest({ domain: MANAGED_VERIFICATION_ARTIFACT_INVENTORY_VERSION,
      rootBindingDigest: parsed.rootBindingDigest, entries: parsed.entries });
    if (parsed.inventoryDigest !== expected) return fail("inventory-invalid");
    const result = deepFreeze(parsed); inventories.add(result); return result;
  } catch (error) {
    if (error instanceof ManagedVerificationArtifactError) throw error;
    return fail("inventory-invalid");
  }
}

/** Matches the launch pin to one runtime and one runner artifact. It does not
 * accept a root path and cannot establish file identity or custody. */
export function resolveManagedVerificationArtifacts(launch: ResolvedManagedVerificationLaunchContract,
  inventory: ManagedVerificationArtifactInventory, expectedInventoryDigest: string,
  expectedRootBindingDigest: string): ResolvedManagedVerificationArtifacts {
  if (!isResolvedManagedVerificationLaunchContract(launch) || typeof inventory !== "object" || inventory === null
    || !inventories.has(inventory) || !digest.safeParse(expectedInventoryDigest).success
    || !digest.safeParse(expectedRootBindingDigest).success) return fail("inventory-untrusted");
  if (inventory.inventoryDigest !== expectedInventoryDigest || inventory.rootBindingDigest !== expectedRootBindingDigest)
    return fail("artifact-mismatch");
  const runtime = inventory.entries.filter(entry => entry.role === "runtime"
    && entry.artifactDigest === launch.contract.runtimeArtifactDigest);
  const runner = inventory.entries.filter(entry => entry.role === "runner"
    && entry.artifactDigest === launch.contract.runnerArtifactDigest);
  if (runtime.length !== 1 || runner.length !== 1) return fail("artifact-mismatch");
  const result: ResolvedManagedVerificationArtifacts = deepFreeze({
    schemaVersion: "onoes-managed-verification-artifact-resolution/v1",
    kind: "matched-protected-relative-artifacts-not-opened", catalogDigest: launch.catalogDigest,
    definitionDigest: launch.definitionDigest, launchContractDigest: launch.contractDigest,
    inventoryDigest: inventory.inventoryDigest, rootBindingDigest: inventory.rootBindingDigest,
    runtime: runtime[0]!, runner: runner[0]!,
  } as const);
  resolutions.add(result); return result;
}

export function isResolvedManagedVerificationArtifacts(value: unknown): value is ResolvedManagedVerificationArtifacts {
  return typeof value === "object" && value !== null && resolutions.has(value);
}
