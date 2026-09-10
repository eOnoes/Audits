import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Database from "better-sqlite3";
import { canonicalJson, canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import { parseWindowsWorkspacePolicy } from "../../src/build-only/windows-workspace-policy.js";
import { initializeWindowsOperatorTaskStore, SqliteWindowsOperatorTaskStore } from "../../src/build-only/windows-operator-task-store.js";
import { WindowsManagedDraftPlanningSession } from "../../src/build-only/windows-managed-draft-planning.js";
import { WindowsManagedTaskInspector, type ManagedTaskInspectionOptions } from "../../src/build-only/windows-managed-task-inspection.js";
import { WindowsManagedPlanningContextCompiler } from "../../src/build-only/windows-managed-planning-context.js";
import { WindowsManagedWorkProposalComposer, ManagedWorkProposalError } from "../../src/build-only/windows-managed-work-proposal.js";
import { parseManagedVerificationCatalog, resolveManagedVerificationDefinition } from "../../src/build-only/windows-managed-verification-catalog.js";
import { AGENT_FORBIDDEN_ACTIONS, AGENT_WORK_TASK_SCHEMA_VERSION } from "../../src/builder/agent-workflow-types.js";
import { computeAgentFrozenCommandDigest, computeAgentWorkTaskDigest, computeAgentChangeProposalDigest, bindAgentWorkTaskToBuilderScope } from "../../src/builder/agent-workflow.js";
import { computeBuilderInspectionScopeDigest } from "../../src/builder/schemas.js";
import { BUILDER_CONTRACT_VERSION } from "../../src/builder/types.js";

const windowsTest = process.platform === "win32" ? test : test.skip;
const d = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`;
const wire = (value: unknown) => canonicalJson(JSON.parse(JSON.stringify(value)));
const reason = (value: string) => (e: unknown) => e instanceof ManagedWorkProposalError && e.reason === value;
const NOW = "2026-09-09T00:00:00.000Z", END = "2026-09-09T00:01:00.000Z";
async function fixture() {
  const db = new Database(":memory:"), storeId = initializeWindowsOperatorTaskStore(db);
  const policy = parseWindowsWorkspacePolicy({ schemaVersion: "agent-windows-workspace-policy/v1", revision: 1,
    allowedRoots: [{ path: "D:\\Source", access: "read-write" }, { path: "D:\\Managed", access: "read-write" }], deniedRoots: ["C:\\"] });
  const snapshot = { policy, binding: { storeId: randomUUID(), revision: 1, policyDigest: canonicalSha256Digest(policy) } };
  const policyStore: ManagedTaskInspectionOptions["policy"] = { snapshot: () => snapshot,
    assertCurrentBinding(binding) { assert.deepEqual(binding, snapshot.binding); }, listEffectIntents: () => [] };
  const draftStore = new SqliteWindowsOperatorTaskStore(db, storeId, policyStore, () => NOW);
  const paths = ["docs/handoff.md", "src/a.ts"], taskId = randomUUID(), sessionId = randomUUID();
  const brief = wire({ schemaVersion: "agent-operator-task-intake-input/v1", expectedBinding: snapshot.binding,
    objective: "Correct label.", workspaceRoot: "D:\\Source", requestedReadFiles: paths, requestedWriteFiles: paths,
    acceptanceCriteria: ["Label is correct."] });
  draftStore.create(taskId, 1, brief);
  const files = new Map([["docs/handoff.md", "# Prior handoff\n"], ["src/a.ts", "const label = 'old';\n"]]);
  const workspace = { workspaceDigest: d(1), repositoryRoot: "D:\\Source", worktreeRoot: "D:\\Managed", worktreeAttestationDigest: d(2) };
  let adapterReads = 0;
  const inspectionOptions: ManagedTaskInspectionOptions = { workspace, policy: policyStore, io: { workspaceDigest: d(1),
    async openCustody() { return { async assertCustody() {}, async close() {}, async read(path: string, cap: number) {
      assert.equal(db.inTransaction, false); adapterReads++; const bytes = Buffer.from(files.get(path)!); assert.ok(bytes.length <= cap); return bytes;
    } }; } } };
  const inspection = await new WindowsManagedTaskInspector(inspectionOptions).inspect(brief);
  const entries = [{ schemaVersion: "onoes-managed-verification-definition/v1", verificationId: "fixture-check", displayName: "Fixture check",
    runnerArtifactDigest: d(3), commandContractDigest: d(4), networkAccess: "denied", workspaceAccess: "read-only", scratchAccess: "private-bounded",
    timeoutMs: 5000, maximumOutputBytes: 4096, maximumScratchBytes: 4096, maximumProcessCount: 2 }];
  const catalogDigest = canonicalSha256Digest({ domain: "onoes-managed-verification-catalog/v1", entries });
  const verification = resolveManagedVerificationDefinition(parseManagedVerificationCatalog(wire({ schemaVersion: "onoes-managed-verification-catalog/v1",
    kind: "trusted-static-definitions-not-task-commands", entries, catalogDigest })), "fixture-check", catalogDigest);
  const compiler = new WindowsManagedPlanningContextCompiler({ workspace, policy: policyStore, verification });
  const selection = wire({ schemaVersion: "agent-managed-planning-context-input/v1", briefDigest: inspection.briefDigest,
    inspectionDigest: inspection.inspectionDigest, verificationId: "fixture-check", catalogDigest, definitionDigest: verification.definitionDigest,
    files: inspection.files.map(f => ({ relativePath: f.relativePath, contentDigest: f.contentDigest, startByte: 0, endByte: f.byteLength })), ruleFilePins: [] });
  const context = compiler.compile(brief, selection, inspection); if (context.status !== "ready-for-planning") assert.fail("context");
  const edit = wire({ schemaVersion: "agent-managed-edit-candidate-input/v1", contextDigest: context.contextDigest,
    inspectionDigest: inspection.inspectionDigest, summary: "Correct label.", patches: [{ relativePath: "src/a.ts",
      expectedPreimageDigest: inspection.files.find(f => f.relativePath === "src/a.ts")!.contentDigest,
      operations: [{ operation: "replace-exact", before: "old", after: "new", expectedOccurrences: 1 }] }] });
  const candidate = compiler.prepareEdits(brief, selection, inspection, edit); if (candidate.status !== "requires-task-and-review") assert.fail("candidate");
  const command = { commandId: "fixture-command", verificationId: "fixture-check", executable: "node" as const,
    arguments: ["protected-runner.mjs"], workingDirectory: ".", shell: false as const, effect: "verification" as const };
  const commandBinding = { command, commandDigest: computeAgentFrozenCommandDigest(command), catalogDigest,
    definitionDigest: verification.definitionDigest, commandContractDigest: d(4) };
  let time = NOW; const options = { commandBinding, now: () => time }, composer = new WindowsManagedWorkProposalComposer(options);
  const scope = { contractVersion: BUILDER_CONTRACT_VERSION, taskId, sessionId, profileId: "builder", repositoryRoot: workspace.repositoryRoot,
    worktreeRoot: workspace.worktreeRoot, worktreeAttestationDigest: workspace.worktreeAttestationDigest,
    allowedReadFiles: paths, allowedWriteFiles: paths, allowedVerificationIds: ["fixture-check"], maxFiles: 2, maxFileBytes: 1024,
    maxTotalBytes: 4096, maxPatchOperations: 1, issuedAt: NOW, expiresAt: END };
  const task = { schemaVersion: AGENT_WORK_TASK_SCHEMA_VERSION, taskId, sessionId, profileId: "builder", objective: "Correct label.",
    builderScopeDigest: computeBuilderInspectionScopeDigest(scope), allowedReadFiles: paths, allowedWriteFiles: paths,
    expectedArtifactPaths: ["src/a.ts"], handoffPath: "docs/handoff.md", commands: [command],
    acceptanceCriteria: [{ criterionId: "correct", description: "Label is correct.", verificationIds: ["fixture-check"],
      requiredEvidenceIds: ["test", "review", "verify", "file"] }], forbiddenActions: AGENT_FORBIDDEN_ACTIONS,
    evidenceRequirements: [
      { evidenceId: "test", kind: "test-receipt", artifactPath: null, readBackRequired: false },
      { evidenceId: "review", kind: "review-receipt", artifactPath: null, readBackRequired: false },
      { evidenceId: "verify", kind: "verification-receipt", artifactPath: null, readBackRequired: false },
      { evidenceId: "file", kind: "artifact-readback", artifactPath: "src/a.ts", readBackRequired: true }],
    stopConditions: { maxImplementationPasses: 1, maxTargetedFixPasses: 2, stopOnAcceptancePassed: true, stopOnBlocked: true, stopOnBudgetExhausted: true },
    ruleReferences: { scripts: [], modelIds: [], serviceNames: [], authorityClaims: ["none"] }, contextTags: ["managed"], maxContextBytes: 262144,
    createdAt: NOW, expiresAt: END, authority: "none" };
  const request = JSON.parse(wire({ schemaVersion: "agent-managed-work-proposal-input/v1", contextDigest: context.contextDigest,
    candidateDigest: candidate.candidateDigest, task, scope, proposalId: "proposal-1", planId: "plan-1", builderActorId: "builder-1",
    iteration: { implementationPass: 1, targetedFixPass: 0 }, knownRiskCodes: [] }));
  const sessions: WindowsManagedDraftPlanningSession[] = [];
  return { composer, context, candidate, inspection, request, commandBinding, options, selection, edit, db, draftStore,
    reads: () => adapterReads, setTime: (v: string) => { time = v; },
    compose: (input: unknown = request) => composer.compose(context, candidate, inspection, wire(input)),
    session() { const session = new WindowsManagedDraftPlanningSession({ drafts: draftStore, inspection: inspectionOptions, verification, proposal: options });
      sessions.push(session); return session; }, selector: wire({ storeId, taskId, creationEpoch: 1, expectedRevision: 1 }),
    dispose() { sessions.forEach(s => s.close()); db.close(); } };
}

windowsTest("complete task/proposal preserves legacy digests and exact predicted patches without authority", async () => {
  const f = await fixture(); try {
    const before = f.db.serialize(), reads = f.reads(), out = f.compose();
    assert.deepEqual(out.task, bindAgentWorkTaskToBuilderScope(f.request.task, f.request.scope));
    assert.equal(out.taskDigest, computeAgentWorkTaskDigest(out.task)); assert.equal(out.proposalDigest, computeAgentChangeProposalDigest(out.proposal));
    assert.deepEqual(out.plan.patches, f.candidate.request.patches); assert.equal(out.predictedFiles[0]!.predictedPostimageDigest, f.candidate.files[0]!.predictedPostimageDigest);
    assert.equal(out.runtimeRulesVerified, false); assert.equal(out.approvalAvailable, false); assert.equal(out.executionEnabled, false);
    assert.equal(out.handoff.written, false); assert.ok(Object.isFrozen(out)); assert.deepEqual(f.compose(), out);
    assert.equal(f.reads(), reads); assert.deepEqual(f.db.serialize(), before);
    const { workProposalDigest, ...core } = out; assert.equal(workProposalDigest, canonicalSha256Digest(core));
  } finally { f.dispose(); }
});

windowsTest("copied producers and cross-subject digest substitutions cannot form a work proposal", async () => {
  const f = await fixture(); try {
    for (const [context, candidate, inspection] of [[structuredClone(f.context), f.candidate, f.inspection],
      [f.context, structuredClone(f.candidate), f.inspection], [f.context, f.candidate, structuredClone(f.inspection)]])
      assert.throws(() => f.composer.compose(context, candidate, inspection, wire(f.request)), reason("producer-untrusted"));
    for (const key of ["contextDigest", "candidateDigest"]) assert.throws(() => f.compose({ ...f.request, [key]: d(88) }), reason("binding-mismatch"));
  } finally { f.dispose(); }
});

windowsTest("task commands cannot replace or extend the trusted host command description", async () => {
  const f = await fixture(); try {
    for (const changed of [{ arguments: ["-e", "process.exit(0)"] }, { workingDirectory: "src" }, { executable: "npm" }]) {
      const r = structuredClone(f.request); Object.assign(r.task.commands[0], changed); assert.throws(() => f.compose(r), reason("command-mismatch"));
    }
    for (const key of ["catalogDigest", "definitionDigest", "commandContractDigest"]) {
      const composer = new WindowsManagedWorkProposalComposer({ ...f.options, commandBinding: { ...f.commandBinding, [key]: d(99) } });
      assert.throws(() => composer.compose(f.context, f.candidate, f.inspection, wire(f.request)), reason("command-mismatch"));
    }
    assert.throws(() => new WindowsManagedWorkProposalComposer({ ...f.options, commandBinding: { ...f.commandBinding, commandDigest: d(99) } }), reason("command-mismatch"));
  } finally { f.dispose(); }
});

windowsTest("task cannot change intent, path spellings, expected edits or fixed workflow constraints", async () => {
  const f = await fixture(); try {
    for (const mutation of [(r: any) => { r.task.objective = "Other"; }, (r: any) => { r.task.acceptanceCriteria[0].description = "Other"; },
      (r: any) => { r.task.handoffPath = "Docs/handoff.md"; }, (r: any) => { r.task.forbiddenActions.pop(); }]) {
      const r = structuredClone(f.request); mutation(r); assert.throws(() => f.compose(r), reason("scope-mismatch"));
    }
    const r = structuredClone(f.request); r.task.expectedArtifactPaths = []; assert.throws(() => f.compose(r), reason("evidence-incomplete"));
    const widened = structuredClone(f.request); widened.scope.allowedVerificationIds.push("other");
    widened.task.builderScopeDigest = computeBuilderInspectionScopeDigest(widened.scope); assert.throws(() => f.compose(widened), reason("command-mismatch"));
  } finally { f.dispose(); }
});

windowsTest("every criterion requires tests, review, verification and exact artifact read-back", async () => {
  const f = await fixture(); try {
    for (const id of ["test", "review", "verify", "file"]) {
      const r = structuredClone(f.request); r.task.acceptanceCriteria[0].requiredEvidenceIds = r.task.acceptanceCriteria[0].requiredEvidenceIds.filter((x: string) => x !== id);
      assert.throws(() => f.compose(r), reason("evidence-incomplete"));
    }
    const r = structuredClone(f.request); r.task.evidenceRequirements[3].artifactPath = "src/A.ts";
    assert.throws(() => f.compose(r), reason("evidence-incomplete"));
  } finally { f.dispose(); }
});

windowsTest("actual source/postimage/context budgets must fit the exact task and scope", async () => {
  const f = await fixture(); try {
    for (const key of ["maxFileBytes", "maxTotalBytes"]) {
      const r = structuredClone(f.request); r.scope[key] = 1; r.task.builderScopeDigest = computeBuilderInspectionScopeDigest(r.scope);
      assert.throws(() => f.compose(r), reason("budget-exceeded"));
    }
    const r = structuredClone(f.request); r.task.maxContextBytes = 1; assert.throws(() => f.compose(r), reason("budget-exceeded"));
  } finally { f.dispose(); }
});

windowsTest("canonical request and exact UTC-ms lifetime fail closed, including clock rollback", async () => {
  const f = await fixture(); try {
    for (const input of [wire(f.request) + "\n", "\ufeff" + wire(f.request), "{}", wire({ ...f.request, approval: true })])
      assert.throws(() => f.composer.compose(f.context, f.candidate, f.inspection, input), reason("input-invalid"));
    const r = structuredClone(f.request); r.task.createdAt = "2026-09-09T00:00:00+00:00"; assert.throws(() => f.compose(r), reason("input-invalid"));
    f.setTime(END); assert.throws(() => f.compose(), reason("task-expired"));
    f.setTime(NOW); assert.throws(() => f.compose(), reason("clock-invalid"));
    f.setTime(END); assert.throws(() => f.compose(), reason("clock-invalid"));
  } finally { f.dispose(); }
});

windowsTest("saved-draft session composes current owned data and invalidates after history closure", async () => {
  const f = await fixture(); try {
    const s = f.session(), inspected = await s.inspect(f.selector), before = f.db.serialize();
    assert.equal(inspected.inspection.inspectionDigest, f.inspection.inspectionDigest);
    const out = s.prepareProposal(inspected.inspectionHandle, f.selection, f.edit, wire(f.request));
    assert.equal(out.status, "requires-rules-review-and-approval"); assert.deepEqual(f.db.serialize(), before);
    if (out.status !== "requires-rules-review-and-approval") assert.fail("draft proposal blocked");
    assert.deepEqual(out.selector, JSON.parse(f.selector)); assert.equal(out.workProposal.task.taskId, out.selector.taskId);
    const { draftProposalDigest, ...core } = out; assert.equal(draftProposalDigest, canonicalSha256Digest(core));
    f.draftStore.close(randomUUID(), f.request.task.taskId, 1, 1);
    assert.throws(() => s.prepareProposal(inspected.inspectionHandle, f.selection, f.edit, wire(f.request)), /draft-closed/);
  } finally { f.dispose(); }
});

windowsTest("saved-draft proposal cannot rename a task even with a self-consistent replacement scope", async () => {
  const f = await fixture(); try {
    const s = f.session(), inspected = await s.inspect(f.selector), r = structuredClone(f.request);
    r.scope.taskId = randomUUID(); r.task.taskId = r.scope.taskId; r.task.builderScopeDigest = computeBuilderInspectionScopeDigest(r.scope);
    assert.throws(() => s.prepareProposal(inspected.inspectionHandle, f.selection, f.edit, wire(r)), /draft-changed/);
    assert.throws(() => s.compile(inspected.inspectionHandle, f.selection), /inspection-missing/);
  } finally { f.dispose(); }
});

windowsTest("host command binding is snapshotted and expiry is rechecked after complete composition", async () => {
  const f = await fixture(); try {
    const expected = f.compose(); f.commandBinding.command.arguments[0] = "changed.mjs";
    assert.deepEqual(f.compose(), expected);
    let calls = 0;
    const composer = new WindowsManagedWorkProposalComposer({ commandBinding: expected.commandBinding, now: () => ++calls === 1 ? NOW : END });
    assert.throws(() => composer.compose(f.context, f.candidate, f.inspection, wire(f.request)), reason("task-expired"));
    assert.equal(calls, 2);
  } finally { f.dispose(); }
});

windowsTest("canonical byte bounds and bounded secret rejection do not return partial work proposals", async () => {
  const f = await fixture(); try {
    assert.throws(() => f.composer.compose(f.context, f.candidate, f.inspection, " ".repeat(262145)), reason("budget-exceeded"));
    const r = structuredClone(f.request); r.task.objective = "api_key=" + "x".repeat(24);
    assert.throws(() => f.compose(r), reason("input-invalid"));
    assert.equal(f.compose().status, "requires-rules-review-and-approval");
  } finally { f.dispose(); }
});
