import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";

export const MANAGED_VERIFICATION_CATALOG_VERSION = "onoes-managed-verification-catalog/v1" as const;
export const MANAGED_VERIFICATION_MAX_CATALOG_BYTES = 131_072;
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const verificationId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const label = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 ._:/()+-]{0,79}$/);
const definitionSchema = z.object({
  schemaVersion: z.literal("onoes-managed-verification-definition/v1"),
  verificationId,
  displayName: label,
  runnerArtifactDigest: digest,
  commandContractDigest: digest,
  networkAccess: z.literal("denied"),
  workspaceAccess: z.literal("read-only"),
  scratchAccess: z.literal("private-bounded"),
  timeoutMs: z.number().int().min(1_000).max(60_000),
  maximumOutputBytes: z.number().int().min(1).max(1_048_576),
  maximumScratchBytes: z.number().int().min(0).max(67_108_864),
  maximumProcessCount: z.number().int().min(1).max(32),
}).strict();
const catalogSchema = z.object({
  schemaVersion: z.literal(MANAGED_VERIFICATION_CATALOG_VERSION),
  kind: z.literal("trusted-static-definitions-not-task-commands"),
  entries: z.array(definitionSchema).min(1).max(64),
  catalogDigest: digest,
}).strict();
export type ManagedVerificationDefinition = Readonly<z.infer<typeof definitionSchema>>;
export type ManagedVerificationCatalog = Readonly<z.infer<typeof catalogSchema>>;
export interface ResolvedManagedVerificationDefinition {
  readonly schemaVersion: "onoes-managed-verification-resolution/v1";
  readonly kind: "resolved-trusted-definition-not-execution";
  readonly catalogDigest: string;
  readonly definitionDigest: string;
  readonly definition: ManagedVerificationDefinition;
}
export class ManagedVerificationCatalogError extends Error {
  constructor(readonly reason: "catalog-invalid" | "catalog-untrusted" | "verification-not-enrolled") {
    super(`managed-verification-${reason}`); this.name = "ManagedVerificationCatalogError";
  }
}
const fail = (reason: ManagedVerificationCatalogError["reason"]): never => { throw new ManagedVerificationCatalogError(reason); };
const parsedCatalogs = new WeakSet<object>();
const resolvedDefinitions = new WeakSet<object>();

/** Parse exact bounded transport bytes. This enrolls no runner and executes no
 * command. The trusted host must separately pin expectedCatalogDigest. */
export function parseManagedVerificationCatalog(input: string | Uint8Array): ManagedVerificationCatalog {
  try {
    let text: string;
    if (typeof input === "string") {
      if (Buffer.byteLength(input) > MANAGED_VERIFICATION_MAX_CATALOG_BYTES) return fail("catalog-invalid");
      text = input;
    } else {
      if (!(input instanceof Uint8Array) || input.buffer instanceof SharedArrayBuffer
        || input.byteLength > MANAGED_VERIFICATION_MAX_CATALOG_BYTES) return fail("catalog-invalid");
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.from(input));
    }
    const parsed = catalogSchema.parse(JSON.parse(text));
    if (canonicalJson(parsed) !== text) return fail("catalog-invalid");
    let prior = "";
    for (const entry of parsed.entries) {
      if (entry.verificationId <= prior) return fail("catalog-invalid");
      prior = entry.verificationId;
    }
    const expected = canonicalSha256Digest({ domain: MANAGED_VERIFICATION_CATALOG_VERSION, entries: parsed.entries });
    if (parsed.catalogDigest !== expected) return fail("catalog-invalid");
    const result = deepFreeze(parsed) as ManagedVerificationCatalog;
    parsedCatalogs.add(result);
    return result;
  } catch (error) {
    if (error instanceof ManagedVerificationCatalogError) throw error;
    return fail("catalog-invalid");
  }
}

/** Resolve only from this parser's immutable result and an independently pinned
 * catalog digest. No task-provided launch material is returned or accepted. */
export function resolveManagedVerificationDefinition(catalog: ManagedVerificationCatalog,
  requestedVerificationId: string, expectedCatalogDigest: string): ResolvedManagedVerificationDefinition {
  if (typeof catalog !== "object" || catalog === null || !parsedCatalogs.has(catalog)
    || !digest.safeParse(expectedCatalogDigest).success || catalog.catalogDigest !== expectedCatalogDigest) return fail("catalog-untrusted");
  if (!verificationId.safeParse(requestedVerificationId).success) return fail("verification-not-enrolled");
  const definition = catalog.entries.find(entry => entry.verificationId === requestedVerificationId);
  if (definition === undefined) return fail("verification-not-enrolled");
  const result: ResolvedManagedVerificationDefinition = deepFreeze({ schemaVersion: "onoes-managed-verification-resolution/v1",
    kind: "resolved-trusted-definition-not-execution", catalogDigest: catalog.catalogDigest,
    definitionDigest: canonicalSha256Digest({ domain: "onoes-managed-verification-definition/v1", definition }), definition } as const);
  resolvedDefinitions.add(result);
  return result;
}

/** Private parser provenance check for later build-only composition. This is a
 * data-origin check, not authority, enrollment, executable custody or launch. */
export function isResolvedManagedVerificationDefinition(value: unknown): value is ResolvedManagedVerificationDefinition {
  return typeof value === "object" && value !== null && resolvedDefinitions.has(value);
}
