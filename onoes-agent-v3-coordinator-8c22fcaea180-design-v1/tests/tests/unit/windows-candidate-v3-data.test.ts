import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import { effectApprovalIdentity, effectIntentSchema, effectParse } from "../../src/build-only/windows-candidate-effect-state.js";
import { CANDIDATE_V3_DOMAIN, CANDIDATE_V3_APPROVAL_IDENTITY_DOMAIN, CANDIDATE_SETTLEMENT_DOMAIN,
  CANDIDATE_SETTLEMENT_MAX_BYTES, CandidateV3DataError, parseCandidateV3Metadata,
  candidateV3ApprovalIdentity, parseCandidateSettlementCore, parseCandidateSettlementTimeline,
} from "../../src/build-only/windows-candidate-v3-data.js";

// No platform skip: pure schema checks run on any supported Node host. Synthetic
// claims only, with no database, task, provider, approval issuer or anchor.
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const d = (n: number) => "sha256:" + n.toString(16).padStart(64, "0");
const at = "2026-09-15T00:00:00.000Z", later = "2026-09-15T00:00:01.000Z";
const meta = { domain: CANDIDATE_V3_DOMAIN, installationId: id(1), namespaceId: id(2), storeId: id(3) };
function evidence() {
  return { ...meta, domain: CANDIDATE_SETTLEMENT_DOMAIN, kind: "execute", operationId: id(4), workflowId: id(5),
    intentDigest: d(1), requestDigest: d(2), sourceManifestDigest: d(3), workspaceDigest: d(4),
    policyBindingDigest: d(5), ownerGeneration: id(6), guestGeneration: id(7),
    controllerIdentityDigest: d(6), resourcePolicyDigest: d(7), priorOutcomeRecordDigest: d(8),
    outcome: "completed", resultDigest: d(9) as string | null, verificationPassed: true as boolean | null,
    observedAt: at, validUntil: later, contactAccountingDigest: d(10), ownerFenceEvidenceDigest: d(11),
    processSettlementEvidenceDigest: d(12), generationRetirementEvidenceDigest: d(13),
    custodyReleaseEvidenceDigest: d(14), publicationExclusionEvidenceDigest: d(15), workspaceSafetyEvidenceDigest: d(16) };
}
const denied = (fn: () => unknown) => assert.throws(fn, e => e instanceof CandidateV3DataError && e.message === "candidate-v3-data-invalid");

test("v3 metadata binds exact installation/namespace/store/domain without creating authority", () => {
  assert.deepEqual(parseCandidateV3Metadata(canonicalJson(meta)), meta);
  assert.ok(Object.isFrozen(parseCandidateV3Metadata(canonicalJson(meta))));
  for (const field of Object.keys(meta)) { const value = { ...meta } as Record<string, unknown>; delete value[field]; denied(() => parseCandidateV3Metadata(canonicalJson(value))); }
  for (const value of [{ ...meta, domain: "agent-candidate-effect-ledger/v2" }, { ...meta, installationId: "" },
    { ...meta, permission: true }, { ...meta, installationId: "00000000-0000-4000-8000-00000000000A" }]) denied(() => parseCandidateV3Metadata(canonicalJson(value)));
  assert.notDeepEqual(parseCandidateV3Metadata(canonicalJson({ ...meta, installationId: id(99) })), meta,
    "a different well-formed identity remains different; parsing is not enrollment validation");
});

test("v3 approval identity stays identical to v2 across stores and schema domains", () => {
  const legacy = effectParse(effectIntentSchema, { schemaVersion: "agent-candidate-effect-ledger/v2", kind: "execute",
    namespaceId: id(2), storeId: id(3), operationId: id(4), workflowId: id(5), approvalId: id(6),
    workspaceDigest: d(1), policyBindingDigest: d(2), candidateDigest: d(3), reviewMaterialDigest: d(4),
    sourceManifestDigest: d(5), requestDigest: d(6), guestImageDigest: d(7), guestGeneration: id(7),
    controllerIdentityDigest: d(8), resourcePolicyDigest: d(9), expiresAt: later });
  const wire = canonicalJson({ namespaceId: legacy.namespaceId, approvalId: legacy.approvalId });
  assert.equal(CANDIDATE_V3_APPROVAL_IDENTITY_DOMAIN, "agent-candidate-effect-ledger/v1");
  assert.equal(candidateV3ApprovalIdentity(wire), effectApprovalIdentity(legacy));
  assert.equal(candidateV3ApprovalIdentity(wire), effectApprovalIdentity({ ...legacy, storeId: id(99) }));
  assert.notEqual(candidateV3ApprovalIdentity(canonicalJson({ namespaceId: id(99), approvalId: id(6) })), candidateV3ApprovalIdentity(wire));
  assert.notEqual(candidateV3ApprovalIdentity(canonicalJson({ namespaceId: id(2), approvalId: id(99) })), candidateV3ApprovalIdentity(wire));
  denied(() => candidateV3ApprovalIdentity(canonicalJson({ namespaceId: id(2), approvalId: id(6), storeId: id(3) })));
});

for (const kind of ["execute", "publish"]) for (const outcome of ["completed", "failed", "cancelled", "restored", "stopped-without-result", "quarantined"]) {
  test(`settlement kind/outcome/null matrix: ${kind}/${outcome}`, () => {
    for (const resultDigest of [null, d(9)]) for (const verificationPassed of [null, false, true]) {
      const value = { ...evidence(), kind, outcome, resultDigest, verificationPassed };
      const allowed = kind === "execute" && (outcome === "completed" || outcome === "failed")
        ? resultDigest !== null && verificationPassed === (outcome === "completed")
        : (kind === "execute" ? ["cancelled", "stopped-without-result"] : ["completed", "restored", "cancelled"]).includes(outcome)
          && resultDigest === null && verificationPassed === null;
      if (allowed) assert.deepEqual(parseCandidateSettlementCore(canonicalJson(value)), value);
      else denied(() => parseCandidateSettlementCore(canonicalJson(value)));
    }
  });
}

test("every settlement field is required, strictly typed and part of the digest", () => {
  const valid = evidence(), wire = canonicalJson(valid), parsed = parseCandidateSettlementCore(wire);
  assert.ok(Object.isFrozen(parsed)); assert.ok(Buffer.byteLength(wire) < CANDIDATE_SETTLEMENT_MAX_BYTES);
  assert.deepEqual(parsed, valid);
  for (const field of Object.keys(valid)) {
    const omitted = { ...valid } as Record<string, unknown>; delete omitted[field];
    denied(() => parseCandidateSettlementCore(canonicalJson(omitted)));
    denied(() => parseCandidateSettlementCore(canonicalJson({ ...valid, [field]: "" })));
    denied(() => parseCandidateSettlementCore(canonicalJson({ ...valid, [field]: {} })));
    if (field.endsWith("Digest")) {
      const changed = parseCandidateSettlementCore(canonicalJson({ ...valid, [field]: d(999) }));
      assert.notEqual(canonicalSha256Digest(changed), canonicalSha256Digest(parsed), field);
      denied(() => parseCandidateSettlementCore(canonicalJson({ ...valid, [field]: "sha256:" + "A".repeat(64) })));
    }
  }
  denied(() => parseCandidateSettlementCore(canonicalJson({ ...valid, authenticated: true })));
  assert.equal("authority" in parsed, false); assert.equal("released" in parsed, false);
});

test("canonical primitive-wire parsing rejects alternate spelling and oversize before parsing", () => {
  const wire = canonicalJson(evidence());
  for (const invalid of ["\ufeff" + wire, " " + wire, wire + "\n", JSON.stringify(evidence()),
    wire.replace('"kind":"execute"', '"kind":"publish","kind":"execute"'),
    wire.replace('"execute"', '"\\u0065xecute"'), "null", "[]", "{", "x".repeat(8193),
    "é".repeat(4097), wire.replace(at, "2026-02-30T00:00:00.000Z"),
    wire.replace(at, "2026-09-15T00:00:00Z"), wire.replace(at, "2026-09-15T00:00:00.000+00:00")]) {
    denied(() => parseCandidateSettlementCore(invalid));
  }
  const original = JSON.parse; let calls = 0;
  JSON.parse = ((...args: Parameters<typeof JSON.parse>) => { calls++; return original(...args); }) as typeof JSON.parse;
  try { denied(() => parseCandidateSettlementCore("é".repeat(4097))); denied(() => parseCandidateSettlementCore("x".repeat(8193))); assert.equal(calls, 0); }
  finally { JSON.parse = original; }
});

test("non-text and proxy/accessor inputs are rejected without running caller code", () => {
  let hits = 0;
  const hostile = new Proxy({}, { get() { hits++; throw Error("get"); }, ownKeys() { hits++; throw Error("keys"); },
    getPrototypeOf() { hits++; throw Error("prototype"); } });
  const accessor = { get toJSON() { hits++; throw Error("getter"); } };
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const input of [hostile, accessor, revoked.proxy, Buffer.from(canonicalJson(evidence())), new String(canonicalJson(evidence())),
    undefined, null, 1, true, Symbol("wire"), () => { hits++; }]) {
    denied(() => parseCandidateSettlementCore(input)); denied(() => parseCandidateV3Metadata(input));
    denied(() => candidateV3ApprovalIdentity(input));
    denied(() => parseCandidateSettlementTimeline(canonicalJson(evidence()), input));
  }
  assert.equal(hits, 0);
});

test("settlement observation and release bounds are exact, with no clock or renewal claim", () => {
  const core = evidence(), wire = canonicalJson(core);
  for (const validUntil of [at, "2026-09-14T23:59:59.999Z"]) denied(() => parseCandidateSettlementCore(canonicalJson({ ...core, validUntil })));
  for (const releaseRecordedAt of [null, at, "2026-09-15T00:00:00.999Z"]) {
    const parsed = parseCandidateSettlementTimeline(wire, canonicalJson({ outcomeRecordedAt: at, releaseRecordedAt }));
    assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.timeline));
  }
  for (const timeline of [
    { outcomeRecordedAt: "2026-09-14T23:59:59.999Z", releaseRecordedAt: null },
    { outcomeRecordedAt: later, releaseRecordedAt: null },
    { outcomeRecordedAt: at, releaseRecordedAt: later },
    { outcomeRecordedAt: "2026-09-15T00:00:00.001Z", releaseRecordedAt: at },
    { outcomeRecordedAt: at }, { outcomeRecordedAt: at, releaseRecordedAt: null, authenticated: true },
  ]) denied(() => parseCandidateSettlementTimeline(wire, canonicalJson(timeline)));
  // Old canonical timestamps are legal data. Actual now, predecessor history,
  // subject joins, authenticated freshness and physical release are NOT checked.
  assert.equal(parseCandidateSettlementTimeline(wire, canonicalJson({ outcomeRecordedAt: at, releaseRecordedAt: null })).core.observedAt, at);
});
