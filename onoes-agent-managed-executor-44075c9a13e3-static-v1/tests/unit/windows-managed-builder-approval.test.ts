import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { canonicalJson } from "../../src/compatibility/canonical-json.js";
import { BUILDER_CONTRACT_VERSION, type BuilderTaskScope } from "../../src/builder/types.js";
import { builderTaskScopeSchema } from "../../src/builder/schemas.js";
import { sha256BuilderDigest } from "../../src/builder/content-policy.js";
import { computeBuilderWriteTargetDigest } from "../../src/builder/patch-executor.js";
import { KERNEL_CONTRACT_VERSION, KernelLeaseAuthority, evaluateActionProposal } from "../../src/kernel/index.js";
import type { ActionProposal, SealedCapabilityLease } from "../../src/kernel/index.js";
import { WindowsBuilderEffectJournal } from "../../src/build-only/windows-builder-effect-journal.js";
import { initializeWindowsBuilderRecoveryStore, SqliteWindowsBuilderRecoveryStore } from "../../src/build-only/windows-builder-recovery-store.js";
import { initializeWindowsWorkspacePolicyStore, SqliteWindowsWorkspacePolicyStore } from "../../src/build-only/windows-workspace-policy-store.js";
import { computeManagedBuilderTargetDigest, ManagedBuilderApprovalError, WindowsManagedBuilderApprovalRecorder,
  MANAGED_BUILDER_SUBJECT_VERSION, MANAGED_BUILDER_MAX_FRAME_BYTES, type ManagedBuilderSubject } from "../../src/build-only/windows-managed-builder-approval.js";

const NOW = "2026-09-06T12:00:02.000Z", d = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`;
const PLUGIN = { pluginId: "engineering", version: "1.1.0", artifactDigest: d(1) };
const key = () => new KernelLeaseAuthority("managed-builder-fixture-only", new Uint8Array(32).fill(7));
const files = () => [{ relativePath: "src/a.ts", bytes: Buffer.from("export const value = 1;\n") }];
// This component deliberately targets Windows. Non-Windows has an explicit
// denial test below, not a simulated claim of Windows path enforcement.
const windowsTest = (name: string, fn: () => void) => test(name, { skip: process.platform !== "win32" }, fn);
function fixture() {
  const parent = resolve(tmpdir()), directory = mkdtempSync(join(parent, "onoes-managed-approval-"));
  const policyPath = join(directory, "policy.sqlite"), recoveryPath = join(directory, "recovery.sqlite");
  const policyDb = new Database(policyPath), recoveryDb = new Database(recoveryPath);
  initializeWindowsWorkspacePolicyStore(policyDb); const recoveryId = initializeWindowsBuilderRecoveryStore(recoveryDb);
  const policy = new SqliteWindowsWorkspacePolicyStore(policyDb, () => NOW);
  policy.update({ requestId: randomUUID(), expectedBinding: policy.snapshot().binding,
    rules: { allowedRoots: [{ path: "D:\\ManagedFixture", access: "read-write" }], deniedRoots: ["C:\\"] } });
  const recovery = new SqliteWindowsBuilderRecoveryStore(recoveryDb, recoveryId, () => NOW), authority = key();
  const workspace = { workspaceDigest: d(2), repositoryRoot: "D:\\OriginalFixture", worktreeRoot: "D:\\ManagedFixture",
    worktreeAttestationDigest: d(3) };
  const scope: BuilderTaskScope = { contractVersion: BUILDER_CONTRACT_VERSION, taskId: "task-1", sessionId: "session-1", profileId: "builder",
    repositoryRoot: workspace.repositoryRoot, worktreeRoot: workspace.worktreeRoot, worktreeAttestationDigest: workspace.worktreeAttestationDigest,
    allowedReadFiles: ["src/a.ts"], allowedWriteFiles: ["src/a.ts"], allowedVerificationIds: ["fixture-verifier"],
    maxFiles: 4, maxFileBytes: 1024, maxTotalBytes: 4096, maxPatchOperations: 4,
    issuedAt: "2026-09-06T12:00:00.000Z", expiresAt: "2026-09-06T12:10:00.000Z" };
  const subject: ManagedBuilderSubject = { schemaVersion: MANAGED_BUILDER_SUBJECT_VERSION, operationId: randomUUID(),
    workspaceDigest: workspace.workspaceDigest, policyBinding: policy.snapshot().binding, scope: builderTaskScopeSchema.parse(scope),
    plan: { contractVersion: BUILDER_CONTRACT_VERSION, taskId: scope.taskId, planId: "plan-1", verificationId: "fixture-verifier",
      patches: [{ relativePath: "src/a.ts", expectedPreimageDigest: sha256BuilderDigest(files()[0]!.bytes),
        operations: [{ operation: "replace-exact", before: "value = 1", after: "value = 2", expectedOccurrences: 1 }] }] } };
  const recorder = (a = authority, now = () => NOW) => new WindowsManagedBuilderApprovalRecorder({ authority: a, expectedPlugin: PLUGIN,
    workspace, policy, recovery, now });
  return { policyDb, recoveryDb, policy, recovery, recoveryId, policyPath, recoveryPath, authority, subject, workspace, recorder,
    dispose() { if (policyDb.open) policyDb.close(); if (recoveryDb.open) recoveryDb.close();
      const target = resolve(directory); assert.equal(dirname(target), parent); assert.ok(basename(target).startsWith("onoes-managed-approval-"));
      rmSync(target, { recursive: true, force: true }); } };
}
function issue(subject: ManagedBuilderSubject, authority: KernelLeaseAuthority, options: {
  approvalId?: string; leaseId?: string; target?: string; noApproval?: boolean; plugin?: typeof PLUGIN; maxInputBytes?: number; maxOutputBytes?: number; maxOperations?: number;
} = {}): SealedCapabilityLease {
  const target = options.target ?? computeManagedBuilderTargetDigest(subject), plugin = options.plugin ?? PLUGIN;
  const bounds = { timeoutMs: 60_000, maxOperations: options.maxOperations ?? 4, maxInputBytes: options.maxInputBytes ?? 65_536, maxOutputBytes: options.maxOutputBytes ?? 4096 };
  const proposal: ActionProposal = { schemaVersion: KERNEL_CONTRACT_VERSION, proposalId: "proposal-1", sessionId: subject.scope.sessionId,
    actorId: "fixture-operator", profileId: "builder", capability: "bounded-file-write", plugin,
    effect: options.noApproval ? "pure" : "write", target: { resourceType: "managed-builder-subject", normalizedRef: `digest:${target}` },
    input: {}, requiredApproval: options.noApproval ? "none" : "standard", requestedBounds: bounds,
    expectedResult: { schemaId: "fixture-result", maxBytes: Math.min(4096, bounds.maxOutputBytes) }, rollback: { strategy: "restore-preimage", verificationRef: "fixed" } };
  const decision = evaluateActionProposal(proposal, { policyVersion: "1.1.0", decisionId: "decision-1",
    evaluatedAt: "2026-09-06T12:00:00.000Z", effectiveCapabilities: ["bounded-file-write"], allowedEffects: ["write", "pure"],
    pinnedPlugins: [plugin], kernelMaximums: bounds });
  return authority.issue(proposal, decision, { leaseId: options.leaseId ?? "lease-1", issuedAt: "2026-09-06T12:00:01.000Z", targetDigest: target },
    options.noApproval ? undefined : { schemaVersion: KERNEL_CONTRACT_VERSION, approvalId: options.approvalId ?? "approval-1",
      proposalId: proposal.proposalId, decisionId: decision.decisionId, level: "standard", approvedByHash: d(10),
      approvedAt: "2026-09-06T12:00:00.000Z", expiresAt: "2026-09-06T12:05:00.000Z" });
}
const frame = (subject: ManagedBuilderSubject, authorization: unknown) => Buffer.from(canonicalJson({ subject, authorization }));
function denied(fn: () => unknown, reason?: string) {
  assert.throws(fn, (e: unknown) => e instanceof ManagedBuilderApprovalError && (reason === undefined || e.reason === reason));
}
function empty(f: ReturnType<typeof fixture>) {
  assert.equal((f.recoveryDb.prepare("SELECT count(*) AS n FROM builder_recovery_operations").get() as { n: number }).n, 0);
  assert.equal((f.policyDb.prepare("SELECT count(*) AS n FROM workspace_policy_effects").get() as { n: number }).n, 0);
}

windowsTest("managed approval binds the real kernel seal to exact workspace, policy, operation and patch", () => {
  const f = fixture(); try {
    const auth = issue(f.subject, f.authority), recorder = f.recorder();
    const result = recorder.recordIntent(frame(f.subject, auth), files());
    assert.equal(result.kind, "recorded-state-not-authorization"); assert.equal(result.state, "effects-possible");
    assert.equal(f.authority.isConsumed(auth.lease.leaseId), true);
    const record = f.recovery.read(f.subject.operationId);
    assert.equal(record.request.identity.proposalDigest, computeManagedBuilderTargetDigest(f.subject));
    assert.deepEqual(f.recovery.readPreimages(f.subject.operationId).map(p => Buffer.from(p.bytes)), files().map(p => p.bytes));
    denied(() => recorder.recordIntent(frame(f.subject, auth), files()), "authorization-replayed");
    for (const text of ["export const", "src/a.ts", "ManagedFixture", "hmac-sha256", "approval-1"])
      assert.equal(JSON.stringify(result).includes(text), false);
  } finally { f.dispose(); }
});

windowsTest("old Builder target and changed signed managed claims cannot enter the journal", () => {
  const f = fixture(); try {
    const old = issue(f.subject, f.authority, { target: computeBuilderWriteTargetDigest(f.subject.scope, f.subject.plan) });
    denied(() => f.recorder().recordIntent(frame(f.subject, old), files()), "authorization-invalid");
    const auth = issue(f.subject, f.authority);
    const mutations = [
      { ...f.subject, operationId: randomUUID() },
      { ...f.subject, policyBinding: { ...f.subject.policyBinding, revision: 3 } },
      { ...f.subject, plan: { ...f.subject.plan, planId: "changed-plan" } },
      { ...f.subject, scope: { ...f.subject.scope, maxFileBytes: 1000 } },
    ];
    for (const subject of mutations) denied(() => f.recorder().recordIntent(frame(subject, auth), files()), "authorization-invalid");
    denied(() => f.recorder().recordIntent(frame({ ...f.subject, workspaceDigest: d(99) }, auth), files()), "workspace-mismatch");
    empty(f);
  } finally { f.dispose(); }
});

windowsTest("missing approval, wrong key/plugin, revocation and expired leases deny before durable effects", () => {
  const f = fixture(); try {
    const auth = issue(f.subject, f.authority);
    const cases = [issue(f.subject, f.authority, { noApproval: true }),
      issue(f.subject, new KernelLeaseAuthority("other-key", new Uint8Array(32).fill(8))),
      issue(f.subject, f.authority, { plugin: { ...PLUGIN, artifactDigest: d(90) } })];
    for (const value of cases) denied(() => f.recorder().recordIntent(frame(f.subject, value), files()), "authorization-invalid");
    denied(() => f.recorder(f.authority, () => "2026-09-06T12:02:00.000Z").recordIntent(frame(f.subject, auth), files()), "authorization-invalid");
    f.authority.revoke(auth.lease.leaseId, NOW);
    denied(() => f.recorder().recordIntent(frame(f.subject, auth), files()), "authorization-invalid"); empty(f);
  } finally { f.dispose(); }
});

windowsTest("policy revision, deny precedence, C denial and read-only roots are never bypassed by a valid seal", () => {
  for (const rule of ["revision", "denied", "readonly", "C"] as const) {
    const f = fixture(); try {
      const original = issue(f.subject, f.authority);
      const path = rule === "C" ? "C:\\ManagedFixture" : f.workspace.worktreeRoot;
      f.policy.update({ requestId: randomUUID(), expectedBinding: f.policy.snapshot().binding,
        rules: { allowedRoots: [{ path, access: rule === "readonly" ? "read-only" : "read-write" }],
          deniedRoots: rule === "denied" ? [path] : ["C:\\"] } });
      if (rule === "revision") denied(() => f.recorder().recordIntent(frame(f.subject, original), files()), "policy-denied");
      else {
        const subject = { ...f.subject, policyBinding: f.policy.snapshot().binding, scope: { ...f.subject.scope, worktreeRoot: path } };
        const recorder = new WindowsManagedBuilderApprovalRecorder({ authority: f.authority, expectedPlugin: PLUGIN,
          workspace: { ...f.workspace, worktreeRoot: path }, policy: f.policy, recovery: f.recovery, now: () => NOW });
        denied(() => recorder.recordIntent(frame(subject, issue(subject, f.authority)), files()), "policy-denied");
      }
      empty(f);
    } finally { f.dispose(); }
  }
});

windowsTest("preimage identity, exact scope, context and decoded byte budgets precede recording", () => {
  const f = fixture(); try {
    const auth = issue(f.subject, f.authority), recorder = f.recorder();
    for (const preimages of [[], [{ relativePath: "src/A.ts", bytes: files()[0]!.bytes }],
      [{ relativePath: "src/a.ts", bytes: Buffer.from("not approved") }]])
      denied(() => recorder.recordIntent(frame(f.subject, auth), preimages), "preimage-mismatch");
    denied(() => recorder.recordIntent(frame(f.subject, auth), [{ relativePath: "src/a.ts", bytes: Buffer.alloc(1025, 65) }]), "budget-exceeded");
    denied(() => recorder.recordIntent(frame(f.subject, issue(f.subject, f.authority, { maxInputBytes: 10 })), files()), "budget-exceeded");
    denied(() => recorder.recordIntent(frame(f.subject, issue(f.subject, f.authority, { maxOutputBytes: 1 })), files()), "budget-exceeded");
    for (const mutation of ["context", "scope", "verifier", "operations", "output"] as const) {
      const changed = structuredClone(f.subject);
      if (mutation === "context") changed.plan.patches[0]!.operations[0]!.before = "not present";
      if (mutation === "scope") changed.plan.patches[0]!.relativePath = "src/b.ts";
      if (mutation === "verifier") changed.plan.verificationId = "not-allowed";
      if (mutation === "operations") changed.plan.patches[0]!.operations = Array.from({ length: 5 }, () => ({ ...changed.plan.patches[0]!.operations[0]! }));
      if (mutation === "output") changed.plan.patches[0]!.operations[0]!.after = "x".repeat(1025);
      denied(() => recorder.recordIntent(frame(changed, issue(changed, f.authority)), files()), ["operations", "output"].includes(mutation) ? "budget-exceeded" : "patch-invalid");
    }
    empty(f);
  } finally { f.dispose(); }
});

windowsTest("wire framing is bounded, canonical, mutation-isolated and content-free on denial", () => {
  const f = fixture(); try {
    const auth = issue(f.subject, f.authority), good = frame(f.subject, auth), recorder = f.recorder();
    for (const value of [Buffer.from("{}"), Buffer.concat([good, Buffer.from("\n")]),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), good]), Buffer.from([0xff]),
      Buffer.alloc(MANAGED_BUILDER_MAX_FRAME_BYTES + 1), new Uint8Array(new SharedArrayBuffer(4)),
      Buffer.from(canonicalJson({ subject: f.subject, authorization: auth, approved: true }))])
      denied(() => recorder.recordIntent(value, files()), "invalid-request");
    empty(f);
    const result = recorder.recordIntent(good, files()); good.fill(0);
    assert.equal(result.state, "effects-possible"); assert.ok(Object.isFrozen(result));
    assert.equal(f.recovery.read(f.subject.operationId).request.identity.proposalDigest, computeManagedBuilderTargetDigest(f.subject));
  } finally { f.dispose(); }
});

windowsTest("reissued leases and fresh authority instances cannot reuse the durable approval identity", () => {
  const f = fixture(); let p: Database.Database | undefined, r: Database.Database | undefined; try {
    const auth = issue(f.subject, f.authority), first = f.recorder().recordIntent(frame(f.subject, auth), files());
    new WindowsBuilderEffectJournal(f.recovery, f.policy).recordSettlement({ operationId: f.subject.operationId,
      requestDigest: first.requestDigest, outcome: "restored", evidenceDigest: d(30) });
    f.policyDb.close(); f.recoveryDb.close();
    p = new Database(f.policyPath, { fileMustExist: true }); r = new Database(f.recoveryPath, { fileMustExist: true });
    // Reopened durable stores and a new authority without the consumed-lease set.
    const restarted = key(), subject = { ...f.subject, operationId: randomUUID() };
    const recorder = new WindowsManagedBuilderApprovalRecorder({ authority: restarted, expectedPlugin: PLUGIN, workspace: f.workspace,
      policy: new SqliteWindowsWorkspacePolicyStore(p, () => NOW), recovery: new SqliteWindowsBuilderRecoveryStore(r, f.recoveryId, () => NOW), now: () => NOW });
    denied(() => recorder.recordIntent(frame(subject, issue(subject, restarted, { leaseId: "lease-2" })), files()), "recording-unconfirmed");
    assert.equal((r.prepare("SELECT count(*) AS n FROM builder_recovery_operations").get() as { n: number }).n, 1);
    const next = issue(subject, restarted, { leaseId: "lease-3", approvalId: "approval-2" });
    assert.equal(recorder.recordIntent(frame(subject, next), files()).state, "effects-possible");
  } finally { if (p?.open) p.close(); if (r?.open) r.close(); f.dispose(); }
});

windowsTest("patch scan budget accepts its exact ceiling and denies the next scan before journal writes", () => {
  const size = 1_048_576, content = Buffer.from("0" + "x".repeat(size - 1));
  for (const count of [256, 257]) {
    const f = fixture(); try {
      const subject = structuredClone(f.subject);
      subject.scope.maxFileBytes = size; subject.scope.maxTotalBytes = size; subject.scope.maxPatchOperations = count;
      subject.plan.patches[0]!.expectedPreimageDigest = sha256BuilderDigest(content);
      subject.plan.patches[0]!.operations = Array.from({ length: count }, (_, i) => ({ operation: "replace-exact",
        before: i % 2 ? "1" : "0", after: i % 2 ? "0" : "1", expectedOccurrences: 1 }));
      const auth = issue(subject, f.authority, { maxOperations: count, maxOutputBytes: size });
      const run = () => f.recorder().recordIntent(frame(subject, auth), [{ relativePath: "src/a.ts", bytes: content }]);
      if (count === 256) assert.equal(run().state, "effects-possible");
      else { denied(run, "budget-exceeded"); empty(f); }
    } finally { f.dispose(); }
  }
});

windowsTest("an oversized intermediate patch cannot evade limits by shrinking in a later operation", () => {
  const f = fixture(); try {
    const subject = structuredClone(f.subject);
    subject.plan.patches[0]!.operations = [
      { operation: "replace-exact", before: "value = 1", after: "y".repeat(1025), expectedOccurrences: 1 },
      { operation: "replace-exact", before: "y".repeat(1025), after: "value = 2", expectedOccurrences: 1 },
    ];
    denied(() => f.recorder().recordIntent(frame(subject, issue(subject, f.authority)), files()), "budget-exceeded"); empty(f);
  } finally { f.dispose(); }
});

windowsTest("expiry after durable recording retains blockers and never grants an effect", () => {
  const f = fixture(); try {
    const auth = issue(f.subject, f.authority); let calls = 0;
    const recorder = f.recorder(f.authority, () => ++calls < 3 ? NOW : "2026-09-06T12:02:00.000Z");
    denied(() => recorder.recordIntent(frame(f.subject, auth), files()), "authorization-invalid");
    assert.equal(new WindowsBuilderEffectJournal(f.recovery, f.policy).inspect(f.subject.operationId).state, "effects-possible");
    assert.equal(f.authority.isConsumed(auth.lease.leaseId), false);
    denied(() => f.recorder(key()).recordIntent(frame(f.subject, auth), files()), "recording-unconfirmed");
    assert.equal(f.recovery.read(f.subject.operationId).terminal, null);
  } finally { f.dispose(); }
});

windowsTest("clock grammar, reentrancy and literal dollar payload validation cannot skip the gate", () => {
  const f = fixture(); try {
    const auth = issue(f.subject, f.authority);
    denied(() => f.recorder(f.authority, () => "2026-09-06T12:00:02+00:00").recordIntent(frame(f.subject, auth), files()), "clock-invalid");
    let recorder: WindowsManagedBuilderApprovalRecorder;
    recorder = f.recorder(f.authority, () => { denied(() => recorder.recordIntent(frame(f.subject, auth), files()), "busy"); return NOW; });
    const subject = structuredClone(f.subject); subject.plan.patches[0]!.operations[0]!.after = "$& $$ $` $' $1";
    assert.equal(recorder.recordIntent(frame(subject, issue(subject, f.authority)), files()).state, "effects-possible");
  } finally { f.dispose(); }
});

test("managed recorder selects the platform gate before considering an invalid frame", () => {
  const p = new Database(":memory:"), r = new Database(":memory:");
  try {
    initializeWindowsWorkspacePolicyStore(p); const id = initializeWindowsBuilderRecoveryStore(r);
    const recorder = new WindowsManagedBuilderApprovalRecorder({ authority: key(), expectedPlugin: PLUGIN,
      workspace: { workspaceDigest: d(1), repositoryRoot: "D:\\fixture-source", worktreeRoot: "D:\\fixture-copy", worktreeAttestationDigest: d(2) },
      policy: new SqliteWindowsWorkspacePolicyStore(p), recovery: new SqliteWindowsBuilderRecoveryStore(r, id) });
    denied(() => recorder.recordIntent(Buffer.from("{}"), []), process.platform === "win32" ? "invalid-request" : "unsupported-platform");
  } finally { p.close(); r.close(); }
});
