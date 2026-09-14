// Shared synthetic fixture for executor composition tests. Never an operator approval issuer.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { canonicalJson, canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import { sha256BuilderDigest } from "../../src/builder/content-policy.js";
import { KernelLeaseAuthority } from "../../src/kernel/lease-authority.js";
import { evaluateActionProposal } from "../../src/kernel/policy.js";
import { KERNEL_CONTRACT_VERSION } from "../../src/kernel/types.js";
import { computeManagedBuilderTargetDigest, decodeManagedBuilderFrame, type ManagedBuilderSubject } from "../../src/build-only/windows-managed-builder-approval.js";
import { initializeWindowsWorkspacePolicyStore, SqliteWindowsWorkspacePolicyStore } from "../../src/build-only/windows-workspace-policy-store.js";
import { initializeWindowsBuilderRecoveryStore, SqliteWindowsBuilderRecoveryStore } from "../../src/build-only/windows-builder-recovery-store.js";
import { WindowsBuilderEffectJournal } from "../../src/build-only/windows-builder-effect-journal.js";
import { WindowsManagedBuilderExecutor, type ManagedWorkspaceIo, type ManagedWorkspaceCustodySession,
  type ManagedReadOnlyVerifier, type ManagedExecutorOptions } from "../../src/build-only/windows-managed-builder-executor.js";
import { parseManagedVerificationCatalog, resolveManagedVerificationDefinition } from "../../src/build-only/windows-managed-verification-catalog.js";
import { MANAGED_VERIFICATION_RESULT_VERSION, MANAGED_VERIFICATION_MAX_RESULT_BYTES, type ManagedVerificationRequest } from "../../src/build-only/windows-managed-verification-evidence.js";

export const NOW = "2026-09-06T12:00:02.000Z", d = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`;
export function verificationResolution() {
  const definition = { schemaVersion: "onoes-managed-verification-definition/v1" as const,
    verificationId: "fixture-readonly", displayName: "Fixture readonly", runnerArtifactDigest: d(31),
    commandContractDigest: d(32), networkAccess: "denied" as const, workspaceAccess: "read-only" as const,
    scratchAccess: "private-bounded" as const, timeoutMs: 5_000, maximumOutputBytes: 4_096,
    maximumScratchBytes: 4_096, maximumProcessCount: 2 };
  const entries = [definition];
  const catalogDigest = canonicalSha256Digest({ domain: "onoes-managed-verification-catalog/v1", entries });
  const catalog = parseManagedVerificationCatalog(canonicalJson({ schemaVersion: "onoes-managed-verification-catalog/v1",
    kind: "trusted-static-definitions-not-task-commands", entries, catalogDigest }));
  return resolveManagedVerificationDefinition(catalog, definition.verificationId, catalogDigest);
}
export function verificationResult(request: ManagedVerificationRequest, passed = true): string {
  const core = { schemaVersion: MANAGED_VERIFICATION_RESULT_VERSION,
    kind: "content-free-settled-result-not-independent-review" as const,
    requestDigest: request.requestDigest, workspaceSubjectDigest: request.workspaceSubjectDigest,
    catalogDigest: request.catalogDigest, definitionDigest: request.definitionDigest,
    verificationId: request.verificationId, runnerArtifactDigest: request.runnerArtifactDigest,
    commandContractDigest: request.commandContractDigest, disposition: passed ? "passed" as const : "failed" as const,
    reason: passed ? "completed" as const : "verification-failed" as const, exitCode: passed ? 0 : 1,
    processCount: 1, outputBytes: 0, scratchBytes: 0, networkAccess: "denied" as const,
    workspaceMutationObserved: false as const, allRelatedWorkSettled: true as const, evidenceDigest: d(33) };
  return canonicalJson({ ...core, resultDigest: canonicalSha256Digest({ domain: MANAGED_VERIFICATION_RESULT_VERSION, result: core }) });
}
export function managedExecutorFixture(databaseDirectory?: string) {
  const p = new Database(databaseDirectory === undefined ? ":memory:" : join(databaseDirectory, "policy.sqlite"));
  const r = new Database(databaseDirectory === undefined ? ":memory:" : join(databaseDirectory, "recovery.sqlite"));
  initializeWindowsWorkspacePolicyStore(p); const rid = initializeWindowsBuilderRecoveryStore(r);
  const policy = new SqliteWindowsWorkspacePolicyStore(p, () => NOW), recovery = new SqliteWindowsBuilderRecoveryStore(r, rid, () => NOW);
  const workspace = { workspaceDigest: d(2), repositoryRoot: "D:\\FixtureOriginal", worktreeRoot: "D:\\FixtureManaged", worktreeAttestationDigest: d(3) };
  policy.update({ requestId: randomUUID(), expectedBinding: policy.snapshot().binding,
    rules: { allowedRoots: [{ path: workspace.worktreeRoot, access: "read-write" }], deniedRoots: ["C:\\"] } });
  const plugin = { pluginId: "engineering", version: "1.1.0", artifactDigest: d(1) };
  const authority = new KernelLeaseAuthority("executor-public-fixture", new Uint8Array(32).fill(7));
  const files = new Map(["src/a.ts", "src/b.ts", "src/untouched.ts"].map(path => [path, Buffer.from("export const value = 1;\n")]));
  const calls: { path: string; text: string }[] = []; let reads = 0, custody = 0, verifies = 0, opens = 0, closes = 0, sessionActive = false;
  const hooks: { read?: (path: string) => Promise<void>; custody?: () => Promise<void>;
    afterReplace?: (path: string, signal: AbortSignal) => Promise<void>;
    verify?: (request: ManagedVerificationRequest, signal: AbortSignal) => Promise<unknown>;
    close?: () => Promise<void> } = {};
  const session: ManagedWorkspaceCustodySession = {
    async assertCustody() { assert.equal(sessionActive, true); custody++; assert.equal(p.inTransaction || r.inTransaction, false); await hooks.custody?.(); },
    async read(path, cap) { assert.equal(sessionActive, true); reads++; assert.equal(p.inTransaction || r.inTransaction, false); await hooks.read?.(path);
      const bytes = files.get(path)!; assert.ok(bytes.length <= cap); return bytes; },
    async replace(path, expected, bytes, signal) { assert.equal(sessionActive, true); assert.equal(p.inTransaction || r.inTransaction, false);
      assert.equal(sha256BuilderDigest(files.get(path)!), expected); assert.equal(signal.aborted, false);
      calls.push({ path, text: Buffer.from(bytes).toString() }); files.set(path, Buffer.from(bytes)); await hooks.afterReplace?.(path, signal); },
    async close() { assert.equal(sessionActive, true); await hooks.close?.(); sessionActive = false; closes++; },
  };
  const io: ManagedWorkspaceIo & ManagedWorkspaceCustodySession = { workspaceDigest: workspace.workspaceDigest,
    ...session,
    async openCustody() { assert.equal(sessionActive, false); sessionActive = true; opens++; return io; },
  };
  const verifier: ManagedReadOnlyVerifier = { async verify(request, signal) { verifies++; assert.equal(request.verificationId, "fixture-readonly");
    assert.equal(sessionActive, true, "one custody session must remain held through verification");
    assert.equal(p.inTransaction || r.inTransaction, false);
    return (hooks.verify ? await hooks.verify(request, signal) : verificationResult(request)) as string | Uint8Array;
  } };
  const subject: ManagedBuilderSubject = { schemaVersion: "agent-managed-builder-subject/v1", operationId: randomUUID(),
    workspaceDigest: workspace.workspaceDigest, policyBinding: policy.snapshot().binding,
    scope: { contractVersion: "1.1.0", taskId: "fixture-task", sessionId: "fixture-session", profileId: "builder", ...{ repositoryRoot: workspace.repositoryRoot,
      worktreeRoot: workspace.worktreeRoot, worktreeAttestationDigest: workspace.worktreeAttestationDigest },
      allowedReadFiles: [...files.keys()], allowedWriteFiles: [...files.keys()], allowedVerificationIds: ["fixture-readonly"],
      maxFiles: 3, maxFileBytes: 1024, maxTotalBytes: 4096, maxPatchOperations: 3,
      issuedAt: "2026-09-06T12:00:00.000Z", expiresAt: "2026-09-06T12:05:00.000Z" },
    plan: { contractVersion: "1.1.0", taskId: "fixture-task", planId: "fixture-plan", verificationId: "fixture-readonly",
      patches: ["src/a.ts", "src/b.ts"].map(relativePath => ({ relativePath, expectedPreimageDigest: sha256BuilderDigest(files.get(relativePath)!),
        operations: [{ operation: "replace-exact", before: "value = 1", after: "value = 2", expectedOccurrences: 1 }] })) } };
  function frame(s = subject, sealKey = authority) {
    const targetDigest = computeManagedBuilderTargetDigest(s), bounds = { timeoutMs: 60_000, maxOperations: 3, maxInputBytes: 65_536, maxOutputBytes: 4096 };
    const proposal = { schemaVersion: KERNEL_CONTRACT_VERSION, proposalId: "fixture-proposal", sessionId: s.scope.sessionId, actorId: "fixture-operator",
      profileId: "builder" as const, capability: "bounded-file-write", plugin, effect: "write" as const,
      target: { resourceType: "managed-builder-subject", normalizedRef: `digest:${targetDigest}` }, input: {}, requiredApproval: "standard" as const,
      requestedBounds: bounds, expectedResult: { schemaId: "fixture-result", maxBytes: 4096 }, rollback: { strategy: "restore-preimage" as const, verificationRef: "fixed" } };
    const decision = evaluateActionProposal(proposal, { policyVersion: "1.1.0", decisionId: "fixture-decision", evaluatedAt: "2026-09-06T12:00:00.000Z",
      effectiveCapabilities: ["bounded-file-write"], allowedEffects: ["write"], pinnedPlugins: [plugin], kernelMaximums: bounds });
    const authorization = sealKey.issue(proposal, decision, { leaseId: "fixture-lease", issuedAt: "2026-09-06T12:00:01.000Z", targetDigest },
      { schemaVersion: KERNEL_CONTRACT_VERSION, approvalId: "fixture-approval", proposalId: proposal.proposalId, decisionId: decision.decisionId,
        level: "standard", approvedByHash: d(4), approvedAt: "2026-09-06T12:00:00.000Z", expiresAt: "2026-09-06T12:05:00.000Z" });
    return Buffer.from(canonicalJson({ subject: s, authorization }));
  }
  const options = { authority, expectedPlugin: plugin, workspace, policy, recovery, io, verifier,
    verificationResolution: verificationResolution(), now: () => NOW };
  return { p, r, policy, recovery, authority, subject, files, calls, hooks, frame, options,
    executor: (extra: Partial<ManagedExecutorOptions> = {}) => new WindowsManagedBuilderExecutor({ ...options, ...extra }),
    counts: () => ({ reads, custody, verifies, opens, closes, sessionActive }), close() { p.close(); r.close(); } };
}
