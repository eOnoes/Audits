import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { z } from "zod";
import { canonicalJson, canonicalSha256Digest, sha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { isManagedCandidateReviewMaterial, type ManagedCandidateReviewMaterial } from "./windows-managed-candidate-review.js";

// Host-pinned reviewer-key authentication only. No private keys, signing,
// enrollment, provider, HTTP, approval, lease or dispatch. Key possession proves
// a signer claim, not the quality of a review or the real identity of a model.
export const CANDIDATE_REVIEW_AUTH_LIMITS = Object.freeze({ policyBytes: 16384, envelopeBytes: 12288, requestBytes: 16384, responseBytes: 8192 });
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
// Match the saved candidate/session grammar. Never normalize signed UUID bytes.
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const time = z.string().refine(v => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v);
const policySchema = z.object({ schemaVersion: z.literal("agent-candidate-review-trust/v1"), policyId: uuid,
  generatedAt: time, expiresAt: time,
  reviewers: z.array(z.object({ actorId: id, keyId: digest, publicKeySpkiBase64: z.string().max(128) }).strict()).min(1).max(16),
  revokedKeyIds: z.array(digest).max(16) }).strict();
const envelopeSchema = z.object({ schemaVersion: z.literal("agent-candidate-review-envelope/v1"), keyId: digest,
  payloadBase64: z.string().max(8192), signatureBase64: z.string().max(88) }).strict();
const assertionSchema = z.object({ schemaVersion: z.literal("agent-candidate-review-assertion/v1"),
  phase: z.literal("pre-dispatch-source-review"), reviewId: uuid, reviewerActorId: id, builderActorId: id,
  reviewMaterialDigest: digest, decision: z.enum(["pass", "fail", "blocked"]),
  findingCodes: z.array(z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/)).max(64), reviewedAt: time, expiresAt: time,
}).strict().refine(v => v.reviewerActorId !== v.builderActorId && new Set(v.findingCodes).size === v.findingCodes.length
  && (v.decision !== "pass" || v.findingCodes.length === 0));
type Assertion = Readonly<z.infer<typeof assertionSchema>>;
type Authenticated = Readonly<{ assertion: Assertion; envelopeDigest: string; signerKeyId: string }>;
export interface CandidateReviewTrustOptions { readonly policyWire: string; readonly expectedPolicyDigest: string; readonly now?: () => string; }
const fail = (): never => { throw new Error("candidate-review-authentication-denied"); };
function parse<T>(schema: z.ZodType<T>, wire: unknown, cap: number): T {
  if (typeof wire !== "string" || wire.length > cap || Buffer.byteLength(wire) > cap) return fail();
  const value = schema.parse(JSON.parse(wire)); if (canonicalJson(value) !== wire) return fail(); return value;
}
function decode(value: string): Buffer {
  const bytes = Buffer.from(value, "base64"); if (bytes.toString("base64") !== value) return fail(); return bytes;
}
/** Domain-separated bytes for the external reviewer implementation. Not signing. */
export function candidateReviewSignatureInput(payload: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from("onoes-candidate-pre-dispatch-review/v1\0", "utf8"), payload]);
}

export class WindowsCandidateReviewVerifier {
  readonly #policy: z.infer<typeof policySchema>;
  readonly #policyDigest: string;
  readonly #keys = new Map<string, { actorId: string; key: KeyObject }>();
  readonly #now: () => string;
  readonly #issued = new WeakSet<object>();
  #last = ""; #closed = false;
  constructor(options: CandidateReviewTrustOptions) {
    this.#now = options.now ?? (() => new Date().toISOString());
    try {
      this.#policy = deepFreeze(parse(policySchema, options.policyWire, CANDIDATE_REVIEW_AUTH_LIMITS.policyBytes));
      this.#policyDigest = canonicalSha256Digest(this.#policy);
      if (this.#policyDigest !== options.expectedPolicyDigest || this.#policy.generatedAt >= this.#policy.expiresAt) return fail();
      const actors = new Set<string>();
      for (const entry of this.#policy.reviewers) {
        const bytes = decode(entry.publicKeySpkiBase64);
        const key = createPublicKey({ key: bytes, type: "spki", format: "der" });
        if (key.asymmetricKeyType !== "ed25519" || !key.export({ type: "spki", format: "der" }).equals(bytes)
          || sha256Digest(bytes) !== entry.keyId || this.#keys.has(entry.keyId) || actors.has(entry.actorId)) return fail();
        actors.add(entry.actorId); this.#keys.set(entry.keyId, { actorId: entry.actorId, key });
      }
      if (new Set(this.#policy.revokedKeyIds).size !== this.#policy.revokedKeyIds.length
        || this.#policy.revokedKeyIds.some(key => !this.#keys.has(key))) return fail();
      this.#time();
    } catch { throw new Error("candidate-review-authentication-denied"); }
  }
  #time(): string {
    try {
      if (this.#closed) return fail(); const now = time.parse(this.#now());
      if (now < this.#last || now < this.#policy.generatedAt || now >= this.#policy.expiresAt) return fail();
      this.#last = now; return now;
    } catch { this.#closed = true; return fail(); }
  }
  /** Revocation/rotation requires closing the old host session. No receipt is a
   * permanently valid authorization token, and no old verifier reopens itself. */
  close(): void { this.#closed = true; }
  #current(assertion: Assertion): void {
    const now = this.#time();
    if (assertion.reviewedAt > now || assertion.expiresAt <= now || assertion.reviewedAt >= assertion.expiresAt
      || assertion.reviewedAt < this.#policy.generatedAt || assertion.expiresAt > this.#policy.expiresAt) return fail();
  }
  verify(wire: unknown): Authenticated {
    try {
      this.#time(); const envelope = parse(envelopeSchema, wire, CANDIDATE_REVIEW_AUTH_LIMITS.envelopeBytes);
      const entry = this.#keys.get(envelope.keyId);
      if (!entry || this.#policy.revokedKeyIds.includes(envelope.keyId)) return fail();
      const payload = decode(envelope.payloadBase64), signature = decode(envelope.signatureBase64);
      if (payload.length > 4096 || signature.length !== 64) return fail();
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(payload);
      const assertion = deepFreeze(parse(assertionSchema, text, 4096));
      if (entry.actorId !== assertion.reviewerActorId
        || !verify(null, candidateReviewSignatureInput(payload), entry.key, signature)) return fail();
      this.#current(assertion);
      const result = deepFreeze({ assertion, envelopeDigest: canonicalSha256Digest(envelope), signerKeyId: envelope.keyId });
      this.#issued.add(result); return result;
    } catch { return fail(); }
  }
  assertCurrent(value: unknown): void {
    if (typeof value !== "object" || value === null || !this.#issued.has(value)) return fail();
    this.#current((value as Authenticated).assertion);
  }
  bind(value: unknown, material: ManagedCandidateReviewMaterial) {
    try {
      if (typeof value !== "object" || value === null || !this.#issued.has(value) || !isManagedCandidateReviewMaterial(material)) return fail();
      const claim = value as Authenticated, assertion = claim.assertion; this.#current(assertion);
      const { reviewMaterialDigest, ...core } = material;
      if (canonicalSha256Digest(core) !== reviewMaterialDigest || assertion.reviewMaterialDigest !== reviewMaterialDigest) return fail();
      const proposal = material.proposal["proposal"] as { builderActorId?: unknown };
      const task = material.proposal["task"] as { createdAt?: unknown; expiresAt?: unknown };
      const scope = material.proposal["scope"] as { issuedAt?: unknown; expiresAt?: unknown };
      const created = time.parse(task.createdAt), expires = time.parse(task.expiresAt);
      const issued = time.parse(scope.issuedAt), scopeExpires = time.parse(scope.expiresAt);
      if (proposal.builderActorId !== assertion.builderActorId || assertion.reviewedAt < created || assertion.expiresAt > expires
        || assertion.reviewedAt < issued || assertion.expiresAt > scopeExpires) return fail();
      this.#current(assertion);
      return deepFreeze({ kind: "host-pinned-signer-claim-not-approval" as const, ...assertion,
        schemaVersion: "agent-candidate-review-assessment/v1" as const,
        trustPolicyDigest: this.#policyDigest, signerKeyId: claim.signerKeyId, envelopeDigest: claim.envelopeDigest,
        candidateStoreId: material.candidateStoreId, artifactDigest: material.artifactDigest, workProposalDigest: material.workProposalDigest,
        sourceIncluded: false as const, reviewPerformance: "signer-asserted-not-observed" as const, testStatus: "not-run" as const,
        rulesStatus: "not-independently-verified" as const,
        approvalAvailable: false as const, executionEnabled: false as const, authority: "none" as const });
    } catch { return fail(); }
  }
}
