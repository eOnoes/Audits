import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Database from "better-sqlite3";
import { canonicalJson, canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import { sha256BuilderDigest } from "../../src/builder/content-policy.js";
import { KernelLeaseAuthority } from "../../src/kernel/lease-authority.js";
import { evaluateActionProposal } from "../../src/kernel/policy.js";
import { KERNEL_CONTRACT_VERSION } from "../../src/kernel/types.js";
import { computeManagedBuilderTargetDigest, type ManagedBuilderSubject } from "../../src/build-only/windows-managed-builder-approval.js";
import { initializeWindowsWorkspacePolicyStore, SqliteWindowsWorkspacePolicyStore } from "../../src/build-only/windows-workspace-policy-store.js";
import { initializeWindowsBuilderRecoveryStore, SqliteWindowsBuilderRecoveryStore } from "../../src/build-only/windows-builder-recovery-store.js";
import { WindowsBuilderEffectJournal } from "../../src/build-only/windows-builder-effect-journal.js";
import { WindowsManagedBuilderExecutor, type ManagedWorkspaceIo, type ManagedWorkspaceCustodySession,
  type ManagedReadOnlyVerifier, type ManagedExecutorOptions } from "../../src/build-only/windows-managed-builder-executor.js";
import { parseManagedVerificationCatalog, resolveManagedVerificationDefinition } from "../../src/build-only/windows-managed-verification-catalog.js";
import { MANAGED_VERIFICATION_RESULT_VERSION, MANAGED_VERIFICATION_MAX_RESULT_BYTES, type ManagedVerificationRequest } from "../../src/build-only/windows-managed-verification-evidence.js";

const NOW = "2026-09-06T12:00:02.000Z", d = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`;
const windowsTest = (name: string, fn: () => Promise<void>) => test(name, { skip: process.platform !== "win32" }, fn);
function verificationResolution() {
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
function verificationResult(request: ManagedVerificationRequest, passed = true): string {
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
function fixture() {
  const p = new Database(":memory:"), r = new Database(":memory:");
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
function original(f: ReturnType<typeof fixture>) { for (const bytes of f.files.values()) assert.equal(bytes.toString(), "export const value = 1;\n"); }

windowsTest("verification preflight denies a mismatched selected ID without consuming approval or opening custody", async () => {
  const f = fixture();
  try {
    f.subject.plan.verificationId = "another-readonly";
    f.subject.scope.allowedVerificationIds.push("another-readonly");
    const frame = f.frame(), executor = f.executor();
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await executor.execute(frame);
      assert.equal(result.disposition, "denied"); assert.equal(result.reason, "verification-failed");
      assert.equal(result.journal, null); assert.equal(result.attemptedFiles, 0);
      assert.equal(f.authority.isConsumed("fixture-lease"), false);
      assert.deepEqual(f.counts(), { reads: 0, custody: 0, verifies: 0, opens: 0, closes: 0, sessionActive: false });
      assert.equal(f.calls.length, 0); original(f);
    }
  } finally { f.close(); }
});

for (const fileCount of [128, 129]) {
  windowsTest(`verification preflight enforces the existing file contract at ${fileCount} files`, async () => {
    const f = fixture();
    try {
      while (f.files.size < fileCount) f.files.set(`src/file${f.files.size.toString().padStart(3, "0")}.ts`, Buffer.from("export const value = 1;\n"));
      f.subject.scope.allowedReadFiles = [...f.files.keys()]; f.subject.scope.allowedWriteFiles = [...f.files.keys()];
      f.subject.scope.maxFiles = fileCount;
      f.hooks.verify = async request => { assert.equal(request.files.length, fileCount); return verificationResult(request); };
      const frame = f.frame(), executor = f.executor(), result = await executor.execute(frame);
      if (fileCount === 128) {
        assert.equal(result.disposition, "completed"); assert.equal(result.attemptedFiles, 2);
        assert.equal(f.authority.isConsumed("fixture-lease"), true);
        assert.equal(f.counts().verifies, 1); assert.equal(f.counts().closes, 1);
        assert.equal(f.recovery.read(f.subject.operationId).terminal?.outcome, "completed");
      } else {
        assert.equal(result.disposition, "denied"); assert.equal(result.reason, "invalid-request");
        assert.equal(result.journal, null); assert.equal(result.attemptedFiles, 0);
        assert.equal(f.authority.isConsumed("fixture-lease"), false);
        assert.equal((await executor.execute(frame)).reason, "invalid-request");
        assert.deepEqual(f.counts(), { reads: 0, custody: 0, verifies: 0, opens: 0, closes: 0, sessionActive: false });
        assert.equal(f.calls.length, 0); original(f);
      }
    } finally { f.close(); }
  });
}

function completedEvidenceDigest(verificationDigest: string) {
  return canonicalSha256Digest({ domain: "managed-executor-local-evidence/v1", outcome: "completed", reason: "completed",
    verificationDigest, attempted: ["src/a.ts", "src/b.ts"].map(path => ({ pathDigest: canonicalSha256Digest(path),
      before: sha256BuilderDigest(Buffer.from("export const value = 1;\n")),
      after: sha256BuilderDigest(Buffer.from("export const value = 2;\n")) })), restored: 0 });
}

windowsTest("verifier-result accessor cannot substitute an unchecked receipt digest", async () => {
  const f = fixture(); let digestReads = 0;
  try {
    f.hooks.verify = async () => ({ passed: true,
      get resultDigest() { return ++digestReads <= 2 ? d(7) : "unchecked-verifier-digest"; } });
    const executor = f.executor(), frame = f.frame(), result = await executor.execute(frame);
    const terminal = f.recovery.read(f.subject.operationId).terminal;
    // This identifies the original bug, not merely any failed assertion.
    if (result.disposition === "completed") {
      assert.equal(digestReads, 3);
      assert.equal(terminal?.evidenceDigest, completedEvidenceDigest("unchecked-verifier-digest"));
    }
    assert.equal(result.disposition, "failed", "unchecked verifier output must never complete");
    assert.equal(result.reason, "verification-failed"); assert.equal(digestReads, 0, "do not invoke result getters");
    assert.equal(terminal?.outcome, "restored"); assert.equal(result.restoredFiles, 2); original(f);
    assert.equal((await executor.execute(frame)).disposition, "denied"); assert.equal(f.counts().verifies, 1);
  } finally { f.close(); }
});

const malformedVerifierResults: [string, () => unknown][] = [
  ["null", () => null], ["undefined", () => undefined], ["primitive", () => true],
  ["array", () => Object.assign([], { passed: true, resultDigest: d(7) })],
  ["custom prototype", () => Object.assign(Object.create({}), { passed: true, resultDigest: d(7) })],
  ["inherited passed", () => Object.assign(Object.create({ passed: true }), { resultDigest: d(7) })],
  ["inherited digest", () => Object.assign(Object.create({ resultDigest: d(7) }), { passed: true })],
  ["extra enumerable key", () => ({ passed: true, resultDigest: d(7), extra: true })],
  ["extra hidden key", () => Object.defineProperty({ passed: true, resultDigest: d(7) }, "extra", { value: true })],
  ["symbol key", () => ({ passed: true, resultDigest: d(7), [Symbol("extra")]: true })],
  ["hidden passed", () => Object.defineProperty({ resultDigest: d(7) }, "passed", { value: true })],
  ["hidden digest", () => Object.defineProperty({ passed: true }, "resultDigest", { value: d(7) })],
  ["missing passed", () => ({ resultDigest: d(7) })], ["missing digest", () => ({ passed: true })],
  ["false", () => ({ passed: false, resultDigest: d(7) })], ["truthy passed", () => ({ passed: 1, resultDigest: d(7) })],
  ["boxed digest", () => ({ passed: true, resultDigest: new String(d(7)) })],
  ["invalid digest", () => ({ passed: true, resultDigest: "sha256:bad" })],
  ["newline digest", () => ({ passed: true, resultDigest: d(7) + "\n" })],
];
for (const [shape, make] of malformedVerifierResults) {
  windowsTest(`verifier-result rejects ${shape} and restores only attempted files`, async () => {
    const f = fixture();
    try {
      f.hooks.verify = async () => make() as Awaited<ReturnType<ManagedReadOnlyVerifier["verify"]>>;
      const executor = f.executor(), frame = f.frame(), result = await executor.execute(frame);
      assert.equal(result.disposition, "failed"); assert.equal(result.reason, "verification-failed");
      assert.equal(result.attemptedFiles, 2); assert.equal(result.restoredFiles, 2);
      assert.equal(f.recovery.read(f.subject.operationId).terminal?.outcome, "restored"); original(f);
      assert.deepEqual(f.calls.map(c => c.path), ["src/a.ts", "src/b.ts", "src/b.ts", "src/a.ts"]);
      assert.equal((await executor.execute(frame)).disposition, "denied"); assert.equal(f.counts().verifies, 1);
    } finally { f.close(); }
  });
}
for (const field of ["passed", "resultDigest"] as const) {
  windowsTest(`verifier-result rejects ${field} accessor without invoking it`, async () => {
    const f = fixture(); let getterCalls = 0;
    try {
      const candidate = { passed: true, resultDigest: d(7) };
      Object.defineProperty(candidate, field, { enumerable: true, get() { getterCalls++; throw new Error("private-adapter-data"); } });
      f.hooks.verify = async () => candidate;
      const result = await f.executor().execute(f.frame());
      assert.equal(result.reason, "verification-failed"); assert.equal(getterCalls, 0);
      assert.equal(result.disposition, "failed"); assert.equal(result.restoredFiles, 2); original(f);
      assert.equal(JSON.stringify(result).includes("private-adapter-data"), false);
    } finally { f.close(); }
  });
}
windowsTest("verifier-result rejects a proxy before inspecting its fields or shape", async () => {
  const f = fixture(); let resultTraps = 0;
  try {
    const candidate = new Proxy({ passed: true, resultDigest: d(7) }, {
      get(target, key, receiver) { if (key !== "then") resultTraps++; return Reflect.get(target, key, receiver); },
      getPrototypeOf(target) { resultTraps++; return Reflect.getPrototypeOf(target); },
      ownKeys(target) { resultTraps++; return Reflect.ownKeys(target); },
      getOwnPropertyDescriptor(target, key) { resultTraps++; return Reflect.getOwnPropertyDescriptor(target, key); },
    });
    // Promise assimilation may read `then` before validation; this is NOT a
    // sandbox against executing a trusted adapter's JavaScript.
    f.hooks.verify = async () => candidate;
    const result = await f.executor().execute(f.frame());
    assert.equal(result.reason, "verification-failed"); assert.equal(resultTraps, 0);
    assert.equal(result.disposition, "failed"); assert.equal(result.restoredFiles, 2); original(f);
  } finally { f.close(); }
});
for (const shape of ["string", "bytes", "offset view", "changed source bytes after return"] as const) {
  windowsTest(`verifier-result snapshots canonical ${shape} into durable local evidence`, async () => {
    const f = fixture(); let mutated = false, expectedResultDigest = "";
    try {
      let candidate: Buffer | undefined;
      f.hooks.verify = async request => {
        const transport = verificationResult(request);
        expectedResultDigest = JSON.parse(transport).resultDigest as string;
        if (shape === "string") return transport;
        if (shape === "offset view") {
          const backing = Buffer.alloc(MANAGED_VERIFICATION_MAX_RESULT_BYTES + 1024, 0xff);
          const length = backing.write(transport, 256, "utf8");
          return backing.subarray(256, 256 + length);
        }
        candidate = Buffer.from(transport);
        return candidate;
      };
      if (shape === "changed source bytes after return") f.hooks.read = async () => {
        if (f.counts().verifies > 0 && candidate !== undefined) { mutated = true; candidate.fill(0); }
      };
      const result = await f.executor().execute(f.frame());
      assert.equal(result.disposition, "completed"); assert.equal(result.attemptedFiles, 2); assert.equal(result.restoredFiles, 0);
      const terminal = f.recovery.read(f.subject.operationId).terminal;
      assert.equal(terminal?.outcome, "completed");
      assert.equal(terminal?.evidenceDigest, completedEvidenceDigest(expectedResultDigest));
      assert.equal(mutated, shape === "changed source bytes after return"); assert.equal(f.counts().verifies, 1);
      assert.deepEqual(f.calls.map(c => c.path), ["src/a.ts", "src/b.ts"]);
      assert.equal(f.files.get("src/untouched.ts")!.toString(), "export const value = 1;\n");
    } finally { f.close(); }
  });
}
for (const shape of ["buffer", "typed-array", "spoofed-length"] as const) {
  windowsTest(`verifier transport budget rejects oversized ${shape} before copying`, async () => {
    const f = fixture(); let forbiddenCopies = 0, getterCalls = 0;
    const bytes = new Uint8Array(MANAGED_VERIFICATION_MAX_RESULT_BYTES + 1);
    const candidate = shape === "buffer" ? Buffer.from(bytes) : bytes;
    if (shape === "spoofed-length") {
      for (const key of ["buffer", "byteLength", "byteOffset", "length"]) Object.defineProperty(candidate, key, {
        get() { getterCalls++; throw new Error("private-result-getter"); },
      });
    }
    const originalFrom = Buffer.from;
    try {
      // Observe the actual executor allocation boundary, not merely its later
      // parser denial. Other Buffer copies in the fixture are unaffected.
      Buffer.from = new Proxy(originalFrom, { apply(target, receiver, args) {
        if (args[0] === candidate || (ArrayBuffer.isView(args[0])
          && args[0].byteLength > MANAGED_VERIFICATION_MAX_RESULT_BYTES)) forbiddenCopies++;
        return Reflect.apply(target, receiver, args);
      } });
      f.hooks.verify = async () => candidate;
      const result = await f.executor().execute(f.frame());
      assert.equal(result.disposition, "failed"); assert.equal(result.reason, "verification-failed");
      assert.equal(forbiddenCopies, 0, "oversized transport must not be copied before rejection");
      assert.equal(getterCalls, 0, "use intrinsic storage bounds, not adapter-owned properties");
      assert.equal(result.restoredFiles, 2); original(f);
      assert.equal(f.recovery.read(f.subject.operationId).terminal?.outcome, "restored");
      assert.equal(f.counts().closes, 1); assert.equal(f.counts().sessionActive, false);
    } finally { Buffer.from = originalFrom; f.close(); }
  });
}

for (const shape of ["ascii", "multibyte", "shared", "detached"] as const) {
  windowsTest(`verifier transport budget rejects ${shape} invalid storage and restores`, async () => {
    const f = fixture();
    try {
      let candidate: string | Uint8Array;
      if (shape === "ascii") candidate = "x".repeat(MANAGED_VERIFICATION_MAX_RESULT_BYTES + 1);
      else if (shape === "multibyte") candidate = "€".repeat(Math.floor(MANAGED_VERIFICATION_MAX_RESULT_BYTES / 3) + 1);
      else if (shape === "shared") candidate = new Uint8Array(new SharedArrayBuffer(8));
      else { const backing = new ArrayBuffer(8); candidate = new Uint8Array(backing); structuredClone(backing, { transfer: [backing] }); }
      f.hooks.verify = async () => candidate;
      const result = await f.executor().execute(f.frame());
      assert.equal(result.disposition, "failed"); assert.equal(result.reason, "verification-failed");
      assert.equal(result.restoredFiles, 2); original(f);
      assert.equal(f.recovery.read(f.subject.operationId).terminal?.outcome, "restored");
      assert.equal(f.counts().closes, 1);
    } finally { f.close(); }
  });
}

windowsTest("well-formed verification evidence from another request cannot authorize this operation", async () => {
  const f = fixture(); try {
    f.hooks.verify = async request => {
      const parsed = JSON.parse(verificationResult(request));
      parsed.requestDigest = d(90);
      const { resultDigest: _discarded, ...core } = parsed;
      return canonicalJson({ ...core,
        resultDigest: canonicalSha256Digest({ domain: MANAGED_VERIFICATION_RESULT_VERSION, result: core }) });
    };
    const result = await f.executor().execute(f.frame());
    assert.equal(result.disposition, "failed"); assert.equal(result.reason, "verification-failed");
    assert.equal(result.restoredFiles, 2); original(f);
  } finally { f.close(); }
});

for (const site of ["preimage", "final-readback", "recovery-current", "recovery-final"] as const) {
  for (const shape of ["shared", "array", "oversized"] as const) {
    windowsTest(`executor rejects ${shape} adapter bytes at ${site}`, async () => {
      const f = fixture();
      try {
        const read = f.options.io.read.bind(f.options.io);
        let calls = 0, injected = false;
        const isRecovery = site.startsWith("recovery-");
        if (isRecovery) f.hooks.verify = async () => ({ passed:false, resultDigest:d(8) });
        const target = site === "preimage" ? 1 : site === "recovery-final" ? 6 : 4;
        f.options.io.read = async (path, cap, signal) => {
          const bytes = await read(path,cap,signal);
          if (++calls !== target) return bytes;
          injected = true;
          if (shape === "shared") {
            const shared = new Uint8Array(new SharedArrayBuffer(bytes.length)); shared.set(bytes); return shared;
          }
          if (shape === "array") return [...bytes] as unknown as Uint8Array;
          return Buffer.alloc(cap+1);
        };
        const result = await f.executor().execute(f.frame());
        assert.equal(injected,true,"the intended read site must actually run");
        assert.equal(result.reason,"io-failed");
        assert.equal(result.disposition,site === "preimage" ? "denied" : isRecovery ? "quarantined" : "failed");
        if (site === "preimage") assert.equal(result.journal,null);
        else assert.equal(f.recovery.read(f.subject.operationId).terminal?.outcome,isRecovery ? "quarantined" : "restored");
        if (site === "preimage") assert.equal(f.calls.length,0);
        else if (!isRecovery) original(f);
      } finally { f.close(); }
    });
  }
}

windowsTest("managed executor composes real seals and SQLite with exact two-file effects and no transaction-held callback", async () => {
  const f = fixture(); try {
    const executor = f.executor(), frame = f.frame(), result = await executor.execute(frame);
    assert.equal(result.disposition, "completed"); assert.equal(result.journal?.state, "settled");
    assert.equal(result.kind, "local-execution-not-independent-review"); assert.equal(result.attemptedFiles, 2);
    assert.deepEqual(f.calls.map(c => c.path), ["src/a.ts", "src/b.ts"]); assert.equal(f.counts().verifies, 1);
    assert.deepEqual({ opens: f.counts().opens, closes: f.counts().closes, active: f.counts().sessionActive },
      { opens: 1, closes: 1, active: false }, "one continuous custody session spans the whole operation");
    assert.equal(f.files.get("src/untouched.ts")!.toString(), "export const value = 1;\n");
    assert.equal((await executor.execute(frame)).disposition, "denied"); assert.equal(f.calls.length, 2);
    for (const text of ["src/", "export const", "FixtureManaged", "hmac-sha256", "fixture-approval"])
      assert.equal(JSON.stringify(result).includes(text), false);
  } finally { f.close(); }
});
windowsTest("a custody holder that does not stop is quarantined and permanently poisons the executor", async () => {
  const f = fixture(); let release!: () => void;
  try {
    f.hooks.close = () => new Promise<void>(resolve => { release = resolve; });
    const executor = f.executor({ stepTimeoutMs: 25, cancellationGraceMs: 10 });
    const outcome = await executor.execute(f.frame());
    assert.equal(outcome.disposition, "quarantined"); assert.equal(outcome.reason, "unsettled-work");
    assert.equal(f.recovery.read(f.subject.operationId).terminal?.outcome, "quarantined");
    assert.equal((await executor.execute(f.frame())).reason, "busy");
  } finally { release?.(); await new Promise(resolve => setImmediate(resolve)); f.close(); }
});
windowsTest("invalid seal, changed workspace, malformed frame and denied policy cause no adapter access", async () => {
  for (const mode of ["seal", "workspace", "wire", "policy"]) {
    const f = fixture(); try {
      let bytes = f.frame();
      if (mode === "seal") bytes = f.frame(f.subject, new KernelLeaseAuthority("wrong", new Uint8Array(32).fill(8)));
      if (mode === "workspace") bytes = f.frame({ ...f.subject, workspaceDigest: d(99) });
      if (mode === "wire") bytes = Buffer.from("{}");
      if (mode === "policy") f.policy.update({ requestId: randomUUID(), expectedBinding: f.policy.snapshot().binding,
        rules: { allowedRoots: [], deniedRoots: ["C:\\"] } });
      assert.equal((await f.executor().execute(bytes)).disposition, "denied");
      assert.deepEqual(f.counts(), { reads: 0, custody: 0, verifies: 0, opens: 0, closes: 0, sessionActive: false }); assert.equal(f.calls.length, 0);
    } finally { f.close(); }
  }
});
windowsTest("pre-cancelled request records nothing, while cancellation after first effect restores only that path", async () => {
  for (const early of [true, false]) {
    const f = fixture(), abort = new AbortController(); try {
      if (early) abort.abort(); else f.hooks.afterReplace = async () => { abort.abort(); };
      const result = await f.executor().execute(f.frame(), abort.signal);
      assert.equal(result.disposition, "cancelled"); original(f);
      assert.deepEqual(f.calls.map(c => c.path), early ? [] : ["src/a.ts", "src/a.ts"]);
      assert.equal(result.journal?.state ?? null, early ? null : "settled");
      if (early) assert.equal(f.recovery.listUnfinished().length, 0);
      else assert.equal(f.recovery.read(f.subject.operationId).terminal?.outcome, "restored");
    } finally { f.close(); }
  }
});
windowsTest("failed read-only verification restores in reverse order without rewriting unattempted files", async () => {
  const f = fixture(); try {
    f.hooks.verify = async () => ({ passed: false, resultDigest: d(8) });
    const result = await f.executor().execute(f.frame());
    assert.equal(result.disposition, "failed"); assert.equal(result.reason, "verification-failed"); original(f);
    assert.deepEqual(f.calls.map(c => c.path), ["src/a.ts", "src/b.ts", "src/b.ts", "src/a.ts"]);
    assert.equal(result.restoredFiles, 2);
  } finally { f.close(); }
});
for (const site of ["read", "foreign-bytes", "replace-before", "replace-after"] as const) {
  windowsTest(`quiescent recovery ${site} fault preserves quarantine but does not abandon the other attempted file`, async () => {
    const f = fixture(); let recovering = false, injected = false;
    const reads: string[] = [], replacements: string[] = [];
    try {
      const read = f.options.io.read.bind(f.options.io), replace = f.options.io.replace.bind(f.options.io);
      f.hooks.verify = async () => {
        recovering = true;
        if (site === "foreign-bytes") { f.files.set("src/b.ts", Buffer.from("unrelated")); injected = true; }
        return { passed: false, resultDigest: d(8) };
      };
      f.options.io.read = async (path, cap, signal) => {
        if (recovering) {
          reads.push(path);
          if (site === "read" && path === "src/b.ts" && !injected) { injected = true; throw new Error("private-recovery-fault"); }
        }
        return read(path, cap, signal);
      };
      f.options.io.replace = async (path, expected, bytes, signal) => {
        if (recovering) replacements.push(path);
        const fail = recovering && path === "src/b.ts" && site.startsWith("replace-");
        if (fail && site === "replace-before") { injected = true; throw new Error("private-recovery-fault"); }
        await replace(path, expected, bytes, signal);
        if (fail) { injected = true; throw new Error("private-recovery-fault"); }
      };
      const executor = f.executor(), frame = f.frame(), result = await executor.execute(frame);
      assert.equal(injected, true);
      assert.equal(result.disposition, "quarantined"); assert.equal(result.reason, "io-failed");
      assert.equal(f.files.get("src/a.ts")!.toString(), "export const value = 1;\n");
      assert.equal(result.attemptedFiles, 2); assert.equal(result.restoredFiles, 1);
      assert.equal(f.files.get("src/b.ts")!.toString(), site === "foreign-bytes" ? "unrelated"
        : site === "replace-after" ? "export const value = 1;\n" : "export const value = 2;\n");
      assert.equal(f.files.get("src/untouched.ts")!.toString(), "export const value = 1;\n");
      assert.deepEqual(replacements, site.startsWith("replace-") ? ["src/b.ts", "src/a.ts"] : ["src/a.ts"]);
      assert.deepEqual(reads, ["src/b.ts", "src/a.ts", "src/a.ts", "src/b.ts", "src/untouched.ts"]);
      assert.equal(f.recovery.read(f.subject.operationId).terminal?.outcome, "quarantined");
      assert.equal(f.recovery.listUnfinished().length, 1);
      assert.equal(f.authority.isConsumed("fixture-lease"), true);
      const writes = f.calls.length;
      assert.equal((await executor.execute(frame)).disposition, "denied"); assert.equal(f.calls.length, writes);
      assert.throws(() => f.policy.update({ requestId: randomUUID(), expectedBinding: f.policy.snapshot().binding,
        rules: { allowedRoots: [], deniedRoots: [] } }));
      for (const text of ["private-recovery-fault", "src/", "unrelated", "export const"])
        assert.equal(JSON.stringify(result).includes(text), false);
    } finally { f.close(); }
  });
}
windowsTest("failed final recovery read-back still inspects the other captured files and keeps quarantine", async () => {
  const f = fixture(); let recovering = false, injected = false, firstFileReads = 0;
  const finalReads: string[] = [];
  try {
    const read = f.options.io.read.bind(f.options.io);
    f.hooks.verify = async () => { recovering = true; return { passed: false, resultDigest: d(8) }; };
    f.options.io.read = async (path, cap, signal) => {
      if (recovering && path === "src/a.ts") firstFileReads++;
      if (recovering && firstFileReads >= 2) {
        finalReads.push(path);
        if (path === "src/a.ts") { injected = true; throw new Error("private-final-read"); }
      }
      return read(path, cap, signal);
    };
    const result = await f.executor().execute(f.frame());
    assert.equal(injected, true); assert.deepEqual(finalReads, ["src/a.ts", "src/b.ts", "src/untouched.ts"]);
    original(f); assert.equal(result.restoredFiles, 2); assert.equal(result.disposition, "quarantined");
    assert.equal(f.recovery.read(f.subject.operationId).terminal?.outcome, "quarantined");
  } finally { f.close(); }
});
windowsTest("recovery custody failure is global and forbids later file reads or writes", async () => {
  const f = fixture(); let recovering = false, recoveryCustody = 0;
  const reads: string[] = [];
  try {
    f.hooks.verify = async () => { recovering = true; return { passed: false, resultDigest: d(8) }; };
    // Allow the first file to restore; the next custody check must end recovery.
    f.hooks.custody = async () => { if (recovering && ++recoveryCustody === 2) throw new Error("custody-lost"); };
    f.hooks.read = async path => { if (recovering) reads.push(path); };
    const result = await f.executor().execute(f.frame());
    assert.equal(recoveryCustody, 2); assert.equal(result.disposition, "quarantined");
    assert.deepEqual(reads, ["src/b.ts"]);
    assert.deepEqual(f.calls.map(c => c.path), ["src/a.ts", "src/b.ts", "src/b.ts"]);
    assert.equal(f.files.get("src/a.ts")!.toString(), "export const value = 2;\n");
    assert.equal(f.files.get("src/b.ts")!.toString(), "export const value = 1;\n");
  } finally { f.close(); }
});
for (const site of ["read", "replace"] as const) {
  windowsTest(`unsettled recovery ${site} stops later I/O and poisons the executor`, async () => {
    const f = fixture(); let recovering = false, injected = false, abortObserved = false, finish: (() => void) | undefined;
    const reads: string[] = [];
    try {
      const read = f.options.io.read.bind(f.options.io), replace = f.options.io.replace.bind(f.options.io);
      const pending = (signal: AbortSignal) => new Promise<void>(resolve => {
        injected = true; finish = resolve; signal.addEventListener("abort", () => { abortObserved = true; }, { once: true });
      });
      f.hooks.verify = async () => { recovering = true; return { passed: false, resultDigest: d(8) }; };
      f.options.io.read = async (path, cap, signal) => {
        if (recovering) { reads.push(path); if (path === "src/b.ts" && site === "read") await pending(signal); }
        return read(path, cap, signal);
      };
      f.options.io.replace = async (path, expected, bytes, signal) => {
        await replace(path, expected, bytes, signal);
        if (recovering && path === "src/b.ts" && site === "replace") await pending(signal);
      };
      const executor = f.executor({ stepTimeoutMs: 150, cancellationGraceMs: 50 });
      const result = await executor.execute(f.frame());
      assert.equal(injected, true); assert.equal(abortObserved, true); assert.equal(result.disposition, "quarantined");
      assert.deepEqual(reads, ["src/b.ts"]);
      assert.deepEqual(f.calls.map(c => c.path), site === "read" ? ["src/a.ts", "src/b.ts"] : ["src/a.ts", "src/b.ts", "src/b.ts"]);
      assert.equal(f.files.get("src/a.ts")!.toString(), "export const value = 2;\n");
      assert.equal((await executor.execute(f.frame())).reason, "busy");
      finish!(); await new Promise(resolve => setImmediate(resolve));
      assert.equal((await executor.execute(f.frame())).reason, "busy");
    } finally { finish?.(); await new Promise(resolve => setImmediate(resolve)); f.close(); }
  });
}
windowsTest("one total recovery deadline stops later work without resetting the budget per file", async () => {
  const f = fixture(); let recovering = false, injected = false;
  const reads: string[] = [];
  try {
    const read = f.options.io.read.bind(f.options.io);
    f.hooks.verify = async () => { recovering = true; return { passed: false, resultDigest: d(8) }; };
    f.options.io.read = async (path, cap, signal) => {
      if (recovering) {
        reads.push(path); injected = true;
        // Bounded synchronous fixture deliberately delays the timer: the actual
        // monotonic deadline, not winning the promise race, must stop next I/O.
        const until = performance.now() + 75; while (performance.now() < until) { /* fixed delay */ }
      }
      return read(path, cap, signal);
    };
    const result = await f.executor({ recoveryTimeoutMs: 50 }).execute(f.frame());
    assert.equal(injected, true); assert.equal(result.disposition, "quarantined");
    assert.deepEqual(reads, ["src/b.ts"]); assert.equal(f.calls.length, 2);
    assert.equal(f.files.get("src/a.ts")!.toString(), "export const value = 2;\n");
    assert.equal(f.files.get("src/b.ts")!.toString(), "export const value = 2;\n");
  } finally { f.close(); }
});
windowsTest("complete-or-error reads quarantine grown files without accepting their expected prefix", async () => {
  for (const path of ["src/b.ts", "src/untouched.ts"]) {
    const f = fixture();
    try {
      let grown!: Buffer<ArrayBuffer>;
      f.hooks.verify = async () => {
        grown = Buffer.concat([f.files.get(path)!,Buffer.from("unexpected suffix")]);
        f.files.set(path,grown);
        return { passed:false, resultDigest:d(8) };
      };
      const result = await f.executor().execute(f.frame());
      assert.equal(result.disposition,"quarantined");
      assert.equal(result.reason,"io-failed");
      assert.deepEqual(f.files.get(path),grown);
      assert.equal(f.recovery.read(f.subject.operationId).terminal?.outcome,"quarantined");
      assert.equal(f.recovery.listUnfinished().length,1);
      assert.equal(f.calls.some(call=>call.path==="src/untouched.ts"),false);
    } finally { f.close(); }
  }
});

for (const reason of ["verification-failed", "cancelled", "timeout", "runner-error", "boundary-denied"] as const) {
  windowsTest(`canonical bound verifier ${reason} cannot be recorded as completed`, async () => {
    const f = fixture();
    try {
      f.hooks.verify = async request => {
        const { resultDigest: ignored, ...core } = JSON.parse(verificationResult(request, false));
        core.reason = reason;
        core.exitCode = reason === "verification-failed" ? 1 : null;
        return canonicalJson({ ...core, resultDigest: canonicalSha256Digest({
          domain: MANAGED_VERIFICATION_RESULT_VERSION, result: core }) });
      };
      const frame = f.frame(), executor = f.executor();
      const result = await executor.execute(frame);
      assert.equal(result.disposition, "failed");
      assert.equal(result.reason, "verification-failed");
      assert.equal(result.attemptedFiles, 2);
      assert.equal(result.restoredFiles, 2);
      assert.equal(f.recovery.read(f.subject.operationId).terminal?.outcome, "restored");
      assert.deepEqual(f.calls.map(call => call.path), ["src/a.ts", "src/b.ts", "src/b.ts", "src/a.ts"]);
      original(f);
      assert.equal(f.counts().closes, 1);
      const writes = f.calls.length;
      assert.equal((await executor.execute(frame)).disposition, "denied");
      assert.equal(f.calls.length, writes, "a failed verifier cannot reopen consumed authorization");
    } finally { f.close(); }
  });
}

windowsTest("final read-back budgets use exact postimages including empty and resized files", async () => {
  const f = fixture(); let verifying = false;
  const caps: { path: string; cap: number; expected: number }[] = [];
  try {
    f.files.set("src/untouched.ts", Buffer.alloc(0));
    // Reserve the first patch's three-byte growth before the later deletion;
    // every intermediate output must satisfy the existing aggregate ceiling.
    f.subject.scope.maxTotalBytes = [...f.files.values()].reduce((n, b) => n + b.length, 3);
    f.subject.plan.patches[0]!.operations[0]!.after = "value = 2000";
    f.subject.plan.patches[1]!.operations[0]!.before = f.files.get("src/b.ts")!.toString();
    f.subject.plan.patches[1]!.operations[0]!.after = "";
    f.hooks.verify = async request => { verifying = true; return verificationResult(request); };
    const read = f.options.io.read.bind(f.options.io);
    f.options.io.read = async (path, cap, signal) => {
      if (verifying) caps.push({ path, cap, expected: f.files.get(path)!.length });
      return read(path, cap, signal);
    };
    const result = await f.executor().execute(f.frame());
    assert.equal(result.disposition, "completed");
    assert.deepEqual(caps.map(({ path, cap }) => ({ path, cap })), [
      { path: "src/a.ts", cap: Buffer.byteLength("export const value = 2000;\n") },
      { path: "src/b.ts", cap: 0 }, { path: "src/untouched.ts", cap: 0 },
    ]);
    assert.ok(caps.every(row => row.cap === row.expected));
    assert.ok(caps.reduce((n, row) => n + row.cap, 0) <= f.subject.scope.maxTotalBytes);
    assert.equal(f.counts().closes, 1);
    assert.equal(f.recovery.read(f.subject.operationId).terminal?.outcome, "completed");
  } finally { f.close(); }
});

for (const path of ["src/b.ts", "src/untouched.ts"]) {
  for (const honorsCap of [true, false]) {
    windowsTest(`post-verification growth at ${path} is bounded and quarantines (adapter honors cap: ${honorsCap})`, async () => {
      const f = fixture(); let verifying = false, expectedLength = 0, grown!: Buffer<ArrayBuffer>;
      const caps: number[] = [];
      try {
        f.hooks.verify = async request => {
          expectedLength = f.files.get(path)!.length;
          grown = Buffer.concat([f.files.get(path)!, Buffer.from("unexpected suffix")]);
          assert.ok(grown.length < f.subject.scope.maxFileBytes, "growth fits the former broad cap");
          f.files.set(path, grown); verifying = true;
          return verificationResult(request);
        };
        const read = f.options.io.read.bind(f.options.io);
        f.options.io.read = async (candidate, cap, signal) => {
          if (verifying && candidate === path) {
            caps.push(cap);
            if (!honorsCap) return Buffer.from(f.files.get(path)!);
          }
          return read(candidate, cap, signal);
        };
        const result = await f.executor().execute(f.frame());
        assert.equal(caps[0], expectedLength, "forward read refuses growth before whole-file allocation");
        assert.equal(result.disposition, "quarantined");
        assert.equal(result.reason, "io-failed");
        assert.deepEqual(f.files.get(path), grown, "recovery never overwrites unexpected bytes");
        assert.equal(f.recovery.read(f.subject.operationId).terminal?.outcome, "quarantined");
        assert.equal(f.calls.some(call => call.path === "src/untouched.ts"), false);
        assert.equal(f.counts().closes, 1);
      } finally { f.close(); }
    });
  }
}

windowsTest("a replacement that changes bytes then rejects is included in rollback", async () => {
  const f = fixture(); let failed = false; try {
    f.hooks.afterReplace = async () => { if (!failed) { failed = true; throw new Error("fixture-private-error"); } };
    const result = await f.executor().execute(f.frame()); assert.equal(result.disposition, "failed"); original(f);
    assert.deepEqual(f.calls.map(c => c.path), ["src/a.ts", "src/a.ts"]);
    assert.equal(JSON.stringify(result).includes("fixture-private-error"), false);
  } finally { f.close(); }
});
windowsTest("unrelated changed bytes are never overwritten and leave durable quarantine", async () => {
  const f = fixture(); try {
    f.hooks.verify = async () => { f.files.set("src/untouched.ts", Buffer.from("unrelated")); return { passed: true, resultDigest: d(7) }; };
    const result = await f.executor().execute(f.frame()); assert.equal(result.disposition, "quarantined");
    assert.equal(f.files.get("src/untouched.ts")!.toString(), "unrelated");
    assert.equal(f.calls.some(c => c.path === "src/untouched.ts"), false);
    assert.equal(f.recovery.listUnfinished().length, 1);
    assert.throws(() => f.policy.update({ requestId: randomUUID(), expectedBinding: f.policy.snapshot().binding, rules: { allowedRoots: [], deniedRoots: [] } }));
  } finally { f.close(); }
});
windowsTest("unsettled verifier causes no rollback and poisons the executor; abort alone is not quiescence", async () => {
  const f = fixture(); let finish!: () => void, abortObserved = false; try {
    f.hooks.verify = (_id, signal) => new Promise(resolve => {
      finish = () => resolve({ passed: false, resultDigest: d(8) }); signal.addEventListener("abort", () => { abortObserved = true; });
    });
    const executor = f.executor({ stepTimeoutMs: 150, cancellationGraceMs: 50 });
    const result = await executor.execute(f.frame()); assert.equal(result.disposition, "quarantined");
    assert.equal(result.reason, "unsettled-work"); assert.equal(abortObserved, true); assert.equal(f.calls.length, 2);
    assert.equal((await executor.execute(f.frame())).reason, "busy"); finish();
  } finally { f.close(); }
});
windowsTest("timeout waits for actual verifier settlement before restoring", async () => {
  const f = fixture(); let settled = false; try {
    f.hooks.verify = (_id, signal) => new Promise(resolve => signal.addEventListener("abort", () => {
      setTimeout(() => { settled = true; resolve({ passed: false, resultDigest: d(8) }); }, 5);
    }));
    f.hooks.afterReplace = async (_path, signal) => { if (f.calls.length > 2) { assert.equal(settled, true); assert.equal(signal.aborted, false); } };
    const result = await f.executor({ stepTimeoutMs: 150, cancellationGraceMs: 100 }).execute(f.frame());
    assert.equal(result.reason, "timeout"); assert.equal(result.disposition, "failed"); original(f); assert.equal(f.calls.length, 4);
  } finally { f.close(); }
});
windowsTest("post-commit response loss never starts compensating writes or reclassifies completed history", async () => {
  const f = fixture(); try {
    const originalSettle = f.policy.settleEffectIntent.bind(f.policy);
    f.policy.settleEffectIntent = (...args: Parameters<typeof originalSettle>) => { originalSettle(...args); throw new Error("response-lost"); };
    const result = await f.executor().execute(f.frame()); assert.equal(result.disposition, "needs-reconciliation"); assert.equal(f.calls.length, 2);
    const record = f.recovery.read(f.subject.operationId); assert.equal(record.terminal?.outcome, "completed");
    assert.equal(new WindowsBuilderEffectJournal(f.recovery, f.policy).inspect(f.subject.operationId).state, "settled");
  } finally { f.close(); }
});
windowsTest("revocation between custody await and first write stops effects while preserving single use", async () => {
  const f = fixture(); let checks = 0; try {
    f.hooks.custody = async () => { if (++checks === 2) f.authority.revoke("fixture-lease", NOW); };
    const result = await f.executor().execute(f.frame()); assert.equal(result.reason, "authority-denied"); assert.equal(f.calls.length, 0); original(f);
    assert.equal(result.journal?.state, "settled"); assert.equal(f.recovery.read(f.subject.operationId).terminal?.outcome, "restored");
  } finally { f.close(); }
});
windowsTest("frame mutation during async reading cannot change the verified program and busy requests do not queue", async () => {
  const f = fixture(); let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; }); let once = false;
  try {
    f.hooks.read = async () => { if (!once) { once = true; entered(); await new Promise<void>(resolve => { release = resolve; }); } };
    const executor = f.executor(), frame = f.frame(), running = executor.execute(frame); await ready;
    frame.fill(0); const count = f.counts().reads;
    assert.equal((await executor.execute(f.frame())).reason, "busy"); assert.equal(f.counts().reads, count);
    release(); assert.equal((await running).disposition, "completed"); assert.equal(f.calls.length, 2);
  } finally { f.close(); }
});
windowsTest("literal replacement strings remain literal in the generic executor", async () => {
  const f = fixture(); try {
    const subject = structuredClone(f.subject); subject.plan.patches[0]!.operations[0]!.after = "$& $$ $1";
    const result = await f.executor().execute(f.frame(subject)); assert.equal(result.disposition, "completed");
    assert.equal(f.files.get("src/a.ts")!.toString(), "export const $& $$ $1;\n");
  } finally { f.close(); }
});
windowsTest("managed replacement preserves an authorized UTF-8 BOM byte-for-byte", async () => {
  const f = fixture(); try {
    const before = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("export const value = 1;\n")]);
    f.files.set("src/a.ts", before);
    f.subject.plan.patches[0]!.expectedPreimageDigest = sha256BuilderDigest(before);
    const result = await f.executor().execute(f.frame());
    assert.equal(result.disposition, "completed");
    const written = f.files.get("src/a.ts")!;
    assert.deepEqual(written.subarray(0, 3), Buffer.from([0xef, 0xbb, 0xbf]));
    assert.equal(written.toString("utf8"), "\ufeffexport const value = 2;\n");
    assert.equal(written.length, before.length);
  } finally { f.close(); }
});
windowsTest("overlapping replacement anchors are ambiguous and deny before durable intent", async () => {
  const f = fixture(); try {
    const before = Buffer.from("aaa"); f.files.set("src/a.ts", before);
    f.subject.plan.patches = [{ relativePath: "src/a.ts", expectedPreimageDigest: sha256BuilderDigest(before),
      operations: [{ operation: "replace-exact", before: "aa", after: "b", expectedOccurrences: 1 }] }];
    const result = await f.executor().execute(f.frame());
    assert.equal(result.disposition, "denied"); assert.equal(result.reason, "authority-denied");
    assert.equal(result.journal, null); assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});
windowsTest("already-original attempted files count as successfully restored without another write", async () => {
  const f = fixture(); try {
    f.hooks.verify = async request => {
      f.files.set("src/a.ts", Buffer.from("export const value = 1;\n"));
      return verificationResult(request, false);
    };
    const result = await f.executor().execute(f.frame());
    assert.equal(result.disposition, "failed"); assert.equal(result.restoredFiles, 2); original(f);
    assert.deepEqual(f.calls.map(call => call.path), ["src/a.ts", "src/b.ts", "src/b.ts"]);
  } finally { f.close(); }
});

// Named adapter boundaries, not a magic invocation count. The successful
// control below must reproduce this exact trace before the interruption cases
// can be read as coverage of the current executor's complete forward path.
const forwardBoundaries = [
  "custody:1", "read:src/a.ts:1", "read:src/b.ts:1", "read:src/untouched.ts:1",
  "custody:2", "replace:src/a.ts:1", "custody:3", "replace:src/b.ts:1",
  "verify:1", "custody:4", "read:src/a.ts:2", "read:src/b.ts:2", "read:src/untouched.ts:2",
] as const;
function traceAdapterBoundaries(f: ReturnType<typeof fixture>, after: (site: string) => void) {
  const io = f.options.io, verifier = f.options.verifier;
  const custody = io.assertCustody.bind(io), read = io.read.bind(io), replace = io.replace.bind(io), verify = verifier.verify.bind(verifier);
  const trace: string[] = [], counts = new Map<string, number>();
  const finish = (kind: string) => {
    const count = (counts.get(kind) ?? 0) + 1; counts.set(kind, count);
    const site = `${kind}:${count}`; trace.push(site); after(site);
  };
  io.assertCustody = async signal => { await custody(signal); finish("custody"); };
  io.read = async (path, cap, signal) => { const bytes = await read(path, cap, signal); finish(`read:${path}`); return bytes; };
  io.replace = async (path, digest, bytes, signal) => { await replace(path, digest, bytes, signal); finish(`replace:${path}`); };
  verifier.verify = async (id, signal) => { const result = await verify(id, signal); finish("verify"); return result; };
  return trace;
}
windowsTest("managed interruption sweep positive control names every forward adapter boundary", async () => {
  const f = fixture(); try {
    const trace = traceAdapterBoundaries(f, () => undefined);
    assert.equal((await f.executor().execute(f.frame())).disposition, "completed");
    assert.deepEqual(trace, forwardBoundaries);
  } finally { f.close(); }
});
for (const mode of ["cancel", "revoke"] as const) {
  for (const target of forwardBoundaries) {
    windowsTest(`managed ${mode} sweep at ${target} stops forward effects and preserves recovery evidence`, async () => {
      const f = fixture(), controller = new AbortController(); let injected = false;
      let writesAtInterruption = -1, verifiesAtInterruption = -1;
      try {
        const trace = traceAdapterBoundaries(f, site => {
          if (site !== target || injected) return;
          injected = true; writesAtInterruption = f.calls.length; verifiesAtInterruption = f.counts().verifies;
          if (mode === "cancel") controller.abort(); else f.authority.revoke("fixture-lease", NOW);
        });
        const executor = f.executor(), frame = f.frame();
        const result = await executor.execute(frame, controller.signal);
        assert.equal(injected, true, "the named boundary must actually be reached");
        const index = forwardBoundaries.indexOf(target);
        assert.deepEqual(trace.slice(0, index + 1), forwardBoundaries.slice(0, index + 1));
        assert.equal(result.reason, mode === "cancel" ? "cancelled" : "authority-denied");
        assert.notEqual(result.disposition, "completed"); original(f);
        assert.equal(f.counts().verifies, verifiesAtInterruption, "never start a verifier after interruption");
        const forward = f.calls.filter(call => call.text === "export const value = 2;\n");
        assert.equal(forward.length, writesAtInterruption, "never start a later forward replacement");
        assert.equal(result.attemptedFiles, writesAtInterruption);
        assert.equal(result.restoredFiles, writesAtInterruption);
        assert.deepEqual(f.calls.map(call => call.path), [...forward.map(call => call.path), ...forward.map(call => call.path).reverse()]);
        assert.equal(f.calls.some(call => call.path === "src/untouched.ts"), false);
        const beforeIntent = index < 4;
        assert.equal(f.authority.isConsumed("fixture-lease"), !beforeIntent);
        if (beforeIntent) {
          assert.equal(result.journal, null); assert.equal(f.recovery.listUnfinished().length, 0);
          assert.throws(() => f.recovery.read(f.subject.operationId), { reason: "operation-missing" });
          // Cancellation before intent does not consume authorization. The SAME
          // frame with a fresh signal can complete; revocation cannot be undone.
          if (mode === "cancel") assert.equal((await executor.execute(frame)).disposition, "completed");
        } else {
          assert.equal(result.journal?.state, "settled");
          assert.equal(f.recovery.read(f.subject.operationId).terminal?.outcome, "restored");
          assert.equal(new WindowsBuilderEffectJournal(f.recovery, f.policy).inspect(f.subject.operationId).state, "settled");
          const count = f.calls.length;
          assert.equal((await executor.execute(frame)).disposition, "denied");
          assert.equal(f.calls.length, count, "single-use authorization never replays effects");
        }
        for (const text of ["src/", "export const", "FixtureManaged", "fixture-lease", "fixture-approval"])
          assert.equal(JSON.stringify(result).includes(text), false);
      } finally { f.close(); }
    });
  }
}
for (const mode of ["revoke", "expire", "clock-regress"] as const) {
  for (const target of ["custody:4", "read:src/a.ts:2", "read:src/b.ts:2"] as const) {
    windowsTest(`final read-back ${mode} at ${target} enters recovery before another forward read`, async () => {
      const f = fixture(); let now = NOW, injected = false;
      try {
        const trace = traceAdapterBoundaries(f, site => {
          if (site !== target || injected) return;
          injected = true;
          if (mode === "revoke") f.authority.revoke("fixture-lease", NOW);
          else now = mode === "expire" ? f.subject.scope.expiresAt : "2026-09-06T12:00:01.500Z";
        });
        const executor = f.executor({ now: () => now }), frame = f.frame();
        const result = await executor.execute(frame);
        assert.equal(injected, true, "the named final-read boundary must actually run");
        const index = forwardBoundaries.indexOf(target);
        assert.deepEqual(trace.slice(0, index + 1), forwardBoundaries.slice(0, index + 1));
        // The next adapter operation must be the first RECOVERY custody check,
        // not another forward read under the now-invalid lease/time. The success
        // control above pins the four custody checks before this recovery phase.
        assert.equal(trace[index + 1], "custody:5", "no forward read after authority invalidation");
        assert.equal(result.reason, "authority-denied"); assert.equal(result.disposition, "failed");
        assert.equal(result.attemptedFiles, 2); assert.equal(result.restoredFiles, 2); original(f);
        assert.deepEqual(f.calls.map(call => call.path), ["src/a.ts", "src/b.ts", "src/b.ts", "src/a.ts"]);
        assert.equal(f.counts().verifies, 1);
        assert.equal(f.recovery.read(f.subject.operationId).terminal?.outcome, "restored");
        assert.equal(f.authority.isConsumed("fixture-lease"), true);
        const count = f.calls.length;
        assert.equal((await executor.execute(frame)).disposition, "denied");
        assert.equal(f.calls.length, count, "recovery must not reauthorize or replay effects");
      } finally { f.close(); }
    });
  }
}
for (const target of ["custody", "read", "replace", "verify"] as const) {
  windowsTest(`external cancellation waits for pending ${target} settlement before recovery`, async () => {
    const f = fixture(), controller = new AbortController();
    let release: (() => void) | undefined, entered!: () => void, abortObserved = false, settled = false, resultReturned = false;
    let finished: Promise<unknown> | undefined;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    let held = false;
    const hold = async (signal: AbortSignal) => {
      if (held) return;
      held = true; signal.addEventListener("abort", () => { abortObserved = true; }, { once: true });
      entered(); await new Promise<void>(resolve => { release = resolve; }); settled = true;
    };
    try {
      const io = f.options.io, verifier = f.options.verifier;
      const custody = io.assertCustody.bind(io), read = io.read.bind(io), replace = io.replace.bind(io), verify = verifier.verify.bind(verifier);
      if (target === "custody") io.assertCustody = async signal => { await custody(signal); await hold(signal); };
      if (target === "read") io.read = async (path, cap, signal) => { const bytes = await read(path, cap, signal); await hold(signal); return bytes; };
      if (target === "replace") io.replace = async (path, digest, bytes, signal) => { await replace(path, digest, bytes, signal); await hold(signal); };
      if (target === "verify") verifier.verify = async (id, signal) => { const result = await verify(id, signal); await hold(signal); return result; };
      const executor = f.executor({ cancellationGraceMs: 1000 });
      const running = executor.execute(f.frame(), controller.signal).then(result => { resultReturned = true; return result; });
      finished = running;
      await Promise.race([ready, running.then(() => { throw new Error("fixture did not reach the pending boundary"); })]);
      const calls = f.calls.length, counts = f.counts(); controller.abort();
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(abortObserved, true); assert.equal(settled, false); assert.equal(resultReturned, false);
      assert.equal(f.calls.length, calls); assert.deepEqual(f.counts(), counts, "no I/O or verifier overlaps pending work");
      assert.equal((await executor.execute(f.frame())).reason, "busy");
      release!(); const result = await running;
      assert.equal(settled, true); assert.equal(result.disposition, "cancelled"); assert.equal(result.reason, "cancelled");
      assert.equal(result.restoredFiles, calls); original(f);
      if (calls) assert.equal(f.recovery.read(f.subject.operationId).terminal?.outcome, "restored");
      else assert.equal(result.journal, null);
    } finally { release?.(); await finished; f.close(); }
  });
}
