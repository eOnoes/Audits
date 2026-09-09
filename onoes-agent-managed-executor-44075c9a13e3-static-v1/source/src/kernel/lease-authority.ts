import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { deepFreeze } from "../validation/deep-freeze.js";
import { capabilityLeaseSchema, parseCapabilityLease } from "./schemas.js";
import { issueCapabilityLease } from "./policy.js";
import type {
  ActionProposal,
  ApprovalEvidence,
  CapabilityLease,
  LeaseIssuanceContext,
  PolicyDecision,
} from "./types.js";
import type { ProfileId } from "../profiles/types.js";

const stableId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const mac = z.string().regex(/^hmac-sha256:[a-f0-9]{64}$/);

export interface CapabilityLeaseSeal {
  readonly keyId: string;
  readonly leaseDigest: string;
  readonly mac: string;
}

export interface SealedCapabilityLease {
  readonly lease: CapabilityLease;
  readonly seal: CapabilityLeaseSeal;
}

export interface LeaseVerificationExpectation {
  readonly sessionId: string;
  readonly profileId: ProfileId;
  readonly capability: string;
  readonly targetDigest: string;
  readonly pluginId?: string;
  readonly pluginVersion?: string;
  readonly pluginArtifactDigest?: string;
  readonly approvalRequired?: boolean;
}

export type LeaseVerificationReason =
  | "verified"
  | "invalid-envelope"
  | "wrong-trust-root"
  | "seal-mismatch"
  | "lease-not-active"
  | "lease-expired"
  | "lease-revoked"
  | "scope-mismatch";

export interface LeaseVerificationResult {
  readonly valid: boolean;
  readonly reasonCode: LeaseVerificationReason;
  readonly lease?: CapabilityLease;
}

const sealedCapabilityLeaseSchema = z.object({
  lease: capabilityLeaseSchema,
  seal: z.object({ keyId: stableId, leaseDigest: digest, mac }).strict(),
}).strict();

function canonicalLeaseBytes(lease: CapabilityLease): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(parseCapabilityLease(lease)));
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export class KernelLeaseAuthority {
  readonly #keyId: string;
  readonly #key: Buffer;
  readonly #revokedAt = new Map<string, string>();
  readonly #consumedLeaseIds = new Set<string>();

  public constructor(keyId: string, keyMaterial: Uint8Array) {
    this.#keyId = stableId.parse(keyId);
    if (keyMaterial.byteLength < 32) throw new RangeError("lease-authority-key-too-short");
    this.#key = Buffer.from(keyMaterial);
  }

  public issue(
    proposal: ActionProposal,
    decision: PolicyDecision,
    issuance: LeaseIssuanceContext,
    approval?: ApprovalEvidence,
  ): SealedCapabilityLease {
    if (proposal.target.normalizedRef.startsWith("digest:")
      && proposal.target.normalizedRef !== `digest:${issuance.targetDigest}`) {
      throw new TypeError("lease-target-digest-mismatch");
    }
    const lease = issueCapabilityLease(proposal, decision, issuance, approval);
    const bytes = canonicalLeaseBytes(lease);
    const leaseDigest = sha256(bytes);
    const seal = deepFreeze({
      keyId: this.#keyId,
      leaseDigest,
      mac: `hmac-sha256:${createHmac("sha256", this.#key).update(bytes).digest("hex")}`,
    });
    return deepFreeze({ lease, seal });
  }

  public revoke(leaseId: string, revokedAt: string): boolean {
    if (!stableId.safeParse(leaseId).success || !Number.isFinite(Date.parse(revokedAt))) return false;
    if (this.#revokedAt.has(leaseId)) return false;
    this.#revokedAt.set(leaseId, revokedAt);
    return true;
  }

  public isConsumed(leaseId: string): boolean {
    return this.#consumedLeaseIds.has(leaseId);
  }

  public consume(leaseId: string): boolean {
    if (!stableId.safeParse(leaseId).success || this.#consumedLeaseIds.has(leaseId)) return false;
    this.#consumedLeaseIds.add(leaseId);
    return true;
  }

  public verify(input: unknown, expected: LeaseVerificationExpectation, verifiedAt: string): LeaseVerificationResult {
    let envelope: SealedCapabilityLease;
    try {
      envelope = deepFreeze(sealedCapabilityLeaseSchema.parse(input)) as SealedCapabilityLease;
    } catch {
      return deepFreeze({ valid: false, reasonCode: "invalid-envelope" });
    }
    if (envelope.seal.keyId !== this.#keyId) return deepFreeze({ valid: false, reasonCode: "wrong-trust-root" });

    const bytes = canonicalLeaseBytes(envelope.lease);
    const leaseDigest = sha256(bytes);
    const expectedMac = createHmac("sha256", this.#key).update(bytes).digest();
    const suppliedMac = Buffer.from(envelope.seal.mac.slice("hmac-sha256:".length), "hex");
    if (envelope.seal.leaseDigest !== leaseDigest
      || suppliedMac.byteLength !== expectedMac.byteLength
      || !timingSafeEqual(suppliedMac, expectedMac)) {
      return deepFreeze({ valid: false, reasonCode: "seal-mismatch" });
    }

    const verifiedAtMs = Date.parse(verifiedAt);
    if (!Number.isFinite(verifiedAtMs) || Date.parse(envelope.lease.issuedAt) > verifiedAtMs) {
      return deepFreeze({ valid: false, reasonCode: "lease-not-active" });
    }
    if (Date.parse(envelope.lease.expiresAt) <= verifiedAtMs) return deepFreeze({ valid: false, reasonCode: "lease-expired" });
    const authorityRevocation = this.#revokedAt.get(envelope.lease.leaseId);
    if ((authorityRevocation !== undefined && Date.parse(authorityRevocation) <= verifiedAtMs)
      || (envelope.lease.revokedAt !== undefined && Date.parse(envelope.lease.revokedAt) <= verifiedAtMs)) {
      return deepFreeze({ valid: false, reasonCode: "lease-revoked" });
    }

    if (envelope.lease.sessionId !== expected.sessionId
      || envelope.lease.profileId !== expected.profileId
      || envelope.lease.capability !== expected.capability
      || envelope.lease.targetDigest !== expected.targetDigest
      || (expected.pluginId !== undefined && envelope.lease.plugin.pluginId !== expected.pluginId)
      || (expected.pluginVersion !== undefined && envelope.lease.plugin.version !== expected.pluginVersion)
      || (expected.pluginArtifactDigest !== undefined && envelope.lease.plugin.artifactDigest !== expected.pluginArtifactDigest)
      || (expected.approvalRequired === true && envelope.lease.approvalId === undefined)) {
      return deepFreeze({ valid: false, reasonCode: "scope-mismatch" });
    }
    return deepFreeze({ valid: true, reasonCode: "verified", lease: envelope.lease });
  }
}
