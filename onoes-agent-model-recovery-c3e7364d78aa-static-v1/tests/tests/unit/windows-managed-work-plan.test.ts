import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Database from "better-sqlite3";
import { canonicalJson, canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import { computeAgentFrozenCommandDigest } from "../../src/builder/agent-workflow.js";
import { computeBuilderInspectionScopeDigest } from "../../src/builder/schemas.js";
import { parseWindowsWorkspacePolicy } from "../../src/build-only/windows-workspace-policy.js";
import { initializeWindowsOperatorTaskStore, SqliteWindowsOperatorTaskStore } from "../../src/build-only/windows-operator-task-store.js";
import { WindowsManagedTaskInspector, type ManagedTaskInspectionOptions } from "../../src/build-only/windows-managed-task-inspection.js";
import { WindowsManagedPlanningContextCompiler } from "../../src/build-only/windows-managed-planning-context.js";
import { parseManagedVerificationCatalog, resolveManagedVerificationDefinition } from "../../src/build-only/windows-managed-verification-catalog.js";
import { WindowsManagedWorkProposalComposer } from "../../src/build-only/windows-managed-work-proposal.js";
import { WindowsManagedWorkPlanCompiler, ManagedWorkPlanError, type ManagedWorkPlanOptions } from "../../src/build-only/windows-managed-work-plan.js";
import { WindowsManagedDraftPlanningSession } from "../../src/build-only/windows-managed-draft-planning.js";
import type { WorkspaceEffectRecord } from "../../src/build-only/windows-workspace-policy-store.js";

const windowsTest = process.platform === "win32" ? test : test.skip;
const d = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`;
const wire = (value: unknown) => canonicalJson(JSON.parse(JSON.stringify(value)));
const NOW = "2026-09-09T00:00:00.000Z", END = "2026-09-09T00:01:00.000Z";
const reason = (r: string) => (e: unknown) => e instanceof ManagedWorkPlanError && e.reason === r;
function fixture() {
  const db = new Database(":memory:"), storeId = initializeWindowsOperatorTaskStore(db), taskId = randomUUID();
  let policy = parseWindowsWorkspacePolicy({ schemaVersion: "agent-windows-workspace-policy/v1", revision: 1,
    allowedRoots: [{ path: "D:\\Source", access: "read-write" }, { path: "D:\\Managed", access: "read-write" }], deniedRoots: ["C:\\"] });
  const policyId = randomUUID(); let recovery = false, boundaryChecks = 0, onBoundary = () => {};
  let effects: readonly WorkspaceEffectRecord[] = [];
  const policyStore: ManagedTaskInspectionOptions["policy"] = {
    snapshot() { assert.equal(db.inTransaction, false); return { policy, binding: { storeId: policyId, revision: policy.revision, policyDigest: canonicalSha256Digest(policy) } }; },
    assertCurrentBinding(binding) { assert.equal(db.inTransaction, false); boundaryChecks++; onBoundary(); assert.deepEqual(binding, this.snapshot().binding); },
    listEffectIntents() { assert.equal(db.inTransaction, false); if (recovery) throw new Error("record-unreadable"); return effects; },
  };
  const store = new SqliteWindowsOperatorTaskStore(db, storeId, policyStore, () => NOW);
  const brief = wire({ schemaVersion: "agent-operator-task-intake-input/v1", expectedBinding: policyStore.snapshot().binding,
    objective: "Correct the label.", workspaceRoot: "D:\\Source", requestedReadFiles: ["docs/handoff.md", "src/a.ts"],
    requestedWriteFiles: ["docs/handoff.md", "src/a.ts"], acceptanceCriteria: ["Label is correct."] });
  store.create(taskId, 1, brief);
  const workspace = { workspaceDigest: d(1), repositoryRoot: "D:\\Source", worktreeRoot: "D:\\Managed", worktreeAttestationDigest: d(2) };
  let reads = 0, opens = 0, closes = 0, time = NOW, monotonic = 0;
  const sessions: WindowsManagedDraftPlanningSession[] = [];
  const inspectionOptions: ManagedTaskInspectionOptions = { workspace, policy: policyStore, io: { workspaceDigest: d(1), async openCustody() {
    opens++; return { async assertCustody() {}, async close() { closes++; }, async read(path: string) {
      assert.equal(db.inTransaction, false); reads++; return Buffer.from(path === "docs/handoff.md" ? "# Handoff\n" : "\ufeffconst label = 'old';\r\n");
    } };
  } } };
  const entries = [{ schemaVersion: "onoes-managed-verification-definition/v1", verificationId: "fixture-check", displayName: "Fixture check",
    runnerArtifactDigest: d(3), commandContractDigest: d(4), networkAccess: "denied", workspaceAccess: "read-only", scratchAccess: "private-bounded",
    timeoutMs: 5000, maximumOutputBytes: 4096, maximumScratchBytes: 4096, maximumProcessCount: 2 }];
  const catalogDigest = canonicalSha256Digest({ domain: "onoes-managed-verification-catalog/v1", entries });
  const verification = resolveManagedVerificationDefinition(parseManagedVerificationCatalog(wire({ schemaVersion: "onoes-managed-verification-catalog/v1",
    kind: "trusted-static-definitions-not-task-commands", entries, catalogDigest })), "fixture-check", catalogDigest);
  const command = { commandId: "fixture-command", verificationId: "fixture-check", executable: "node" as const, arguments: ["not-installed.mjs"],
    workingDirectory: ".", shell: false as const, effect: "verification" as const };
  const commandBinding = { command, commandDigest: computeAgentFrozenCommandDigest(command), catalogDigest,
    definitionDigest: verification.definitionDigest, commandContractDigest: d(4) };
  const options: ManagedWorkPlanOptions = { drafts: store, policy: policyStore, workspace, verification, commandBinding, builderActorId: "host-builder", now: () => time };
  const compiler = new WindowsManagedWorkPlanCompiler(options), selector = { storeId, taskId, creationEpoch: 1, expectedRevision: 1 };
  const choices = { handoffPath: "docs/handoff.md", maxFileBytes: 1024, maxTotalBytes: 4096, maxPatchOperations: 1, maxContextBytes: 262144,
    lifetimeMs: 60000, maxTargetedFixPasses: 2, knownRiskCodes: ["fixture-only"] };
  return { compiler, options, db, store, selector, choices, policyStore,
    stats: () => ({ reads, opens, closes }), checks: () => boundaryChecks,
    setTime: (value: string) => { time = value; }, setMonotonic: (value: number) => { monotonic = value; }, setBoundary: (fn: () => void) => { onBoundary = fn; },
    unreadableRecovery: () => { recovery = true; },
    blockRecovery(quarantined = false) { effects = [{ schemaVersion: "agent-workspace-effect-intent/v1", operationId: randomUUID(),
      authorizationDigest: d(60), requestDigest: d(61), binding: policyStore.snapshot().binding, startedAt: NOW,
      settlement: quarantined ? { outcome: "quarantined", evidenceDigest: d(62), recordedAt: NOW } : null }]; },
    revoke: () => { policy = parseWindowsWorkspacePolicy({ ...policy, revision: 2, allowedRoots: [] }); },
    closeDraft: () => store.close(randomUUID(), taskId, 1, 1),
    request() { return { schemaVersion: "agent-managed-work-plan-input/v1", selector, expectedDescriptionDigest: compiler.describe(wire(selector)).descriptionDigest,
      choices: structuredClone(choices), confirmDescriptionOnly: true }; },
    session(enabled = true) {
      const s = new WindowsManagedDraftPlanningSession({ drafts: store, inspection: inspectionOptions, verification, proposal: { commandBinding, now: () => time },
        monotonicNow: () => monotonic, ...(enabled ? { workPlan: { builderActorId: "host-builder" } } : {}) });
      sessions.push(s); return s;
    },
    sessionEdits(s: WindowsManagedDraftPlanningSession, inspected: Awaited<ReturnType<WindowsManagedDraftPlanningSession["inspect"]>>) {
      const inspection = inspected.inspection;
      const selection = wire({ schemaVersion: "agent-managed-planning-context-input/v1", briefDigest: inspection.briefDigest, inspectionDigest: inspection.inspectionDigest,
        verificationId: "fixture-check", catalogDigest, definitionDigest: verification.definitionDigest,
        files: inspection.files.map(f => ({ relativePath: f.relativePath, contentDigest: f.contentDigest, startByte: 0, endByte: f.byteLength })), ruleFilePins: [] });
      const context = s.compile(inspected.inspectionHandle, selection); if (context.status !== "ready-for-planning") assert.fail("context blocked");
      const edit = wire({ schemaVersion: "agent-managed-edit-candidate-input/v1", contextDigest: context.contextDigest, inspectionDigest: inspection.inspectionDigest,
        summary: "Correct label.", patches: [{ relativePath: "src/a.ts", expectedPreimageDigest: inspection.files.find(f => f.relativePath === "src/a.ts")!.contentDigest,
          operations: [{ operation: "replace-exact", before: "old", after: "new", expectedOccurrences: 1 }] }] });
      return { selection, edit };
    },
    async inspect() {
      const inspection = await new WindowsManagedTaskInspector(inspectionOptions).inspect(brief);
      const contextCompiler = new WindowsManagedPlanningContextCompiler({ workspace, policy: policyStore, verification });
      const selection = wire({ schemaVersion: "agent-managed-planning-context-input/v1", briefDigest: inspection.briefDigest, inspectionDigest: inspection.inspectionDigest,
        verificationId: "fixture-check", catalogDigest, definitionDigest: verification.definitionDigest,
        files: inspection.files.map(f => ({ relativePath: f.relativePath, contentDigest: f.contentDigest, startByte: 0, endByte: f.byteLength })), ruleFilePins: [] });
      const context = contextCompiler.compile(brief, selection, inspection); if (context.status !== "ready-for-planning") assert.fail("context blocked");
      const candidate = contextCompiler.prepareEdits(brief, selection, inspection, wire({ schemaVersion: "agent-managed-edit-candidate-input/v1",
        contextDigest: context.contextDigest, inspectionDigest: inspection.inspectionDigest, summary: "Correct label.", patches: [{ relativePath: "src/a.ts",
          expectedPreimageDigest: inspection.files.find(f => f.relativePath === "src/a.ts")!.contentDigest,
          operations: [{ operation: "replace-exact", before: "old", after: "new", expectedOccurrences: 1 }] }] }));
      if (candidate.status !== "requires-task-and-review") assert.fail("candidate blocked");
      return { inspection, context, candidate };
    },
    dispose() { sessions.forEach(s => s.close()); db.close(); },
  };
}

windowsTest("plan preparation precedes file inspection and materializes an unchanged existing proposal contract", async () => {
  const f = fixture(); try {
    const before = f.db.serialize(), input = f.request(), plan = f.compiler.prepare(wire(input));
    assert.deepEqual(f.stats(), { reads: 0, opens: 0, closes: 0 }); assert.deepEqual(f.db.serialize(), before);
    assert.deepEqual(plan.choices, input.choices); assert.ok(Object.isFrozen(plan.choices));
    assert.equal(plan.expiresAt, END); assert.equal(plan.approvalAvailable, false); assert.equal(plan.fixedWorkflow.handoffWritten, false);
    const { inspection, context, candidate } = await f.inspect(), request = f.compiler.materialize(plan, context, candidate, inspection);
    const out = new WindowsManagedWorkProposalComposer({ commandBinding: f.options.commandBinding, now: () => NOW }).compose(context, candidate, inspection, request);
    assert.equal(out.task.taskId, f.selector.taskId); assert.equal(out.task.createdAt, NOW); assert.equal(out.task.expiresAt, END);
    assert.equal(out.task.builderScopeDigest, computeBuilderInspectionScopeDigest(out.scope));
    assert.equal(out.task.handoffPath, input.choices.handoffPath); assert.deepEqual(out.task.commands, [f.options.commandBinding.command]);
    assert.equal(out.task.evidenceRequirements.length, 4); assert.equal(out.reviewCompleted, false); assert.equal(out.handoff.written, false);
    assert.deepEqual(out.plan.patches, candidate.request.patches); assert.ok(candidate.files[0]!.before.startsWith("\ufeff"));
    f.setTime("2026-09-09T00:00:30.000Z"); assert.equal(f.compiler.materialize(plan, context, candidate, inspection), request);
    assert.deepEqual(f.stats(), { reads: 4, opens: 1, closes: 1 }); assert.deepEqual(f.db.serialize(), before);
  } finally { f.dispose(); }
});

windowsTest("plan choices require explicit canonical confirmation and never accept caller commands or widened roots", () => {
  const f = fixture(); try {
    const request = f.request();
    for (const input of [wire(request) + "\n", "\ufeff" + wire(request), {}, "x".repeat(4097), wire({ ...request, commands: [] }),
      wire({ ...request, confirmDescriptionOnly: false }), wire({ ...request, choices: { ...request.choices, repositoryRoot: "C:\\" } }),
      wire({ ...request, choices: { ...request.choices, maxFileBytes: 1048577 } }), wire({ ...request, choices: { ...request.choices, maxTargetedFixPasses: 3 } }),
      wire({ ...request, choices: { ...request.choices, lifetimeMs: 900001 } }), wire({ ...request, choices: { ...request.choices, maxTotalBytes: 1 } })])
      assert.throws(() => f.compiler.prepare(input), reason("input-invalid"));
    for (const key of Object.keys(request.choices)) {
      const changed = JSON.parse(wire(request)); delete changed.choices[key];
      assert.throws(() => f.compiler.prepare(wire(changed)), reason("input-invalid"));
    }
    assert.throws(() => f.compiler.prepare(wire({ ...request, expectedDescriptionDigest: d(99) })), reason("subject-mismatch"));
    assert.throws(() => f.compiler.prepare(wire({ ...request, choices: { ...request.choices, handoffPath: "Docs/handoff.md" } })), reason("subject-mismatch"));
    assert.deepEqual(f.stats(), { reads: 0, opens: 0, closes: 0 });
  } finally { f.dispose(); }
});

windowsTest("plan issuer rejects copied catalog resolutions and incoherent host command pins", () => {
  const f = fixture(); try {
    assert.throws(() => new WindowsManagedWorkPlanCompiler({ ...f.options, verification: structuredClone(f.options.verification) }), reason("host-binding-invalid"));
    for (const key of ["commandDigest", "definitionDigest", "catalogDigest", "commandContractDigest"])
      assert.throws(() => new WindowsManagedWorkPlanCompiler({ ...f.options, commandBinding: { ...f.options.commandBinding, [key]: d(99) } }), reason("host-binding-invalid"));
    assert.throws(() => new WindowsManagedWorkPlanCompiler({ ...f.options, workspace: { ...f.options.workspace, repositoryRoot: "D:\\Source\\..\\Other" } }), reason("host-binding-invalid"));
    const own = new WindowsManagedWorkPlanCompiler(f.options); f.options.commandBinding.command.arguments[0] = "changed-after-construction.mjs";
    assert.equal(own.describe(wire(f.selector)).commandBinding.command.arguments[0], "not-installed.mjs");
  } finally { f.dispose(); }
});

windowsTest("foreign, copied or rehashed plan records and producer clones cannot materialize task input", async () => {
  const f = fixture(); try {
    const plan = f.compiler.prepare(wire(f.request())), { inspection, context, candidate } = await f.inspect();
    for (const clone of [structuredClone(plan), Object.create(plan)]) assert.throws(() => f.compiler.materialize(clone, context, candidate, inspection), reason("plan-untrusted"));
    const changed = structuredClone(plan); changed.choices.maxTotalBytes++;
    const { workPlanDigest, ...core } = changed; changed.workPlanDigest = canonicalSha256Digest(core);
    assert.throws(() => f.compiler.materialize(changed, context, candidate, inspection), reason("plan-untrusted"));
    assert.throws(() => new WindowsManagedWorkPlanCompiler(f.options).materialize(plan, context, candidate, inspection), reason("plan-untrusted"));
    for (const args of [[structuredClone(context), candidate, inspection], [context, structuredClone(candidate), inspection], [context, candidate, structuredClone(inspection)]])
      assert.throws(() => f.compiler.materialize(plan, args[0], args[1], args[2]), reason("plan-untrusted"));
  } finally { f.dispose(); }
});

windowsTest("plan lifetime is exact and does not reset after materialization; clock failures latch", async () => {
  for (const time of [END, "2026-09-08T23:59:59.999Z", "2026-09-09T00:00:00Z", "not-a-date"]) {
    const f = fixture(); try {
      const plan = f.compiler.prepare(wire(f.request())), { inspection, context, candidate } = await f.inspect(); f.setTime(time);
      assert.throws(() => f.compiler.materialize(plan, context, candidate, inspection), reason(time === END ? "plan-expired" : "clock-invalid"));
      if (time !== END) { f.setTime(NOW); assert.throws(() => f.compiler.prepare(wire(f.request())), reason("clock-invalid")); }
    } finally { f.dispose(); }
  }
});

windowsTest("closed or revoked drafts and unreadable recovery deny prepared-plan reuse without extra source reads", async () => {
  for (const change of ["close", "revoke", "recovery"] as const) {
    const f = fixture(); try {
      const plan = f.compiler.prepare(wire(f.request())), { inspection, context, candidate } = await f.inspect();
      if (change === "close") f.closeDraft(); else if (change === "revoke") f.revoke(); else f.unreadableRecovery();
      assert.throws(() => f.compiler.materialize(plan, context, candidate, inspection), reason(change === "close" ? "draft-changed" : "policy-denied"));
      assert.equal(f.stats().reads, 4);
    } finally { f.dispose(); }
  }
});

windowsTest("descriptor selector mismatch and mutation during final boundary read never issue a usable plan", () => {
  const f = fixture(); try {
    assert.throws(() => f.compiler.describe(wire({ ...f.selector, storeId: randomUUID() })), reason("draft-unavailable"));
    assert.throws(() => f.compiler.describe(wire({ ...f.selector, expectedRevision: 2 })), reason("draft-changed"));
    const request = f.request(), trigger = f.checks() + 3;
    f.setBoundary(() => { if (f.checks() === trigger) f.revoke(); });
    assert.throws(() => f.compiler.prepare(wire(request)), reason("policy-denied"));
    assert.equal(f.stats().reads, 0);
  } finally { f.dispose(); }
});

windowsTest("explicit small plan budgets still fail the original composer after actual inspection", async () => {
  const f = fixture(); try {
    const request = f.request(); request.choices.maxFileBytes = 1;
    const plan = f.compiler.prepare(wire(request)), { inspection, context, candidate } = await f.inspect();
    assert.throws(() => f.compiler.materialize(plan, context, candidate, inspection), /managed-work-proposal-budget-exceeded/);
    assert.equal(plan.choices.maxFileBytes, 1); // never auto-widen to fit the source
  } finally { f.dispose(); }
});

windowsTest("host-owned guided session composes exact proposal only after its own fresh inspection", async () => {
  const f = fixture(); try {
    const s = f.session(), before = f.db.serialize(), input = f.request();
    assert.equal(s.describeWorkPlan(wire(f.selector)).descriptionDigest, input.expectedDescriptionDigest);
    input.choices.lifetimeMs = 900000;
    const plan = s.prepareWorkPlan(wire(input)); assert.equal(f.stats().opens, 0);
    assert.throws(() => s.prepareGuidedProposal(randomUUID(), "{}", "{}", plan.workPlanDigest), /inspection-missing/);
    const inspected = await s.inspect(wire(f.selector)), { selection, edit } = f.sessionEdits(s, inspected);
    const result = s.prepareGuidedProposal(inspected.inspectionHandle, selection, edit, plan.workPlanDigest);
    if (result.status === "blocked") assert.fail("guided proposal blocked");
    assert.equal(result.workProposal.task.expiresAt, plan.expiresAt); assert.equal(result.workProposal.plan.planId, plan.planId);
    assert.equal(result.workProposal.proposal.proposalId, plan.proposalId); assert.equal(result.workProposal.handoff.written, false);
    assert.deepEqual(f.db.serialize(), before); assert.equal(f.stats().reads, 4);
    f.setMonotonic(60000); // plan still has 15 minutes, original inspection does not
    assert.throws(() => s.prepareGuidedProposal(inspected.inspectionHandle, selection, edit, plan.workPlanDigest), /inspection-expired/);
    s.close(); assert.throws(() => s.describeWorkPlan(wire(f.selector)), /closed/);
  } finally { f.dispose(); }
});

windowsTest("guided session is opt-in and replacement plans cannot retain an earlier inspection or digest", async () => {
  const f = fixture(); try {
    const disabled = f.session(false); assert.throws(() => disabled.describeWorkPlan(wire(f.selector)), /planning-unavailable/);
    const s = f.session(), first = s.prepareWorkPlan(wire(f.request())), inspected = await s.inspect(wire(f.selector)), { selection, edit } = f.sessionEdits(s, inspected);
    assert.throws(() => s.prepareWorkPlan("{}"), /input-invalid/);
    assert.throws(() => s.prepareGuidedProposal(inspected.inspectionHandle, selection, edit, first.workPlanDigest), /inspection-missing/);
    const second = s.prepareWorkPlan(wire(f.request())); assert.notEqual(second.workPlanDigest, first.workPlanDigest);
    const next = await s.inspect(wire(f.selector)), edits = f.sessionEdits(s, next);
    assert.throws(() => s.prepareGuidedProposal(next.inspectionHandle, edits.selection, edits.edit, first.workPlanDigest), /planning-unavailable/);
  } finally { f.dispose(); }
});

windowsTest("pending and quarantined work block description; managed-root denial is independent of source-root allowance", () => {
  for (const quarantined of [false, true]) {
    const f = fixture(); try {
      f.blockRecovery(quarantined); assert.throws(() => f.compiler.describe(wire(f.selector)), reason("recovery-pending"));
      assert.equal(f.stats().opens, 0);
    } finally { f.dispose(); }
  }
  const f = fixture(); try {
    const other = new WindowsManagedWorkPlanCompiler({ ...f.options, workspace: { ...f.options.workspace, worktreeRoot: "C:\\Managed" } });
    assert.throws(() => other.describe(wire(f.selector)), reason("policy-denied")); assert.equal(f.stats().opens, 0);
  } finally { f.dispose(); }
});

windowsTest("an unrelated genuine inspection cannot be attached to a prepared plan", async () => {
  const f = fixture(), other = fixture(); try {
    const plan = f.compiler.prepare(wire(f.request())), parents = await other.inspect();
    assert.throws(() => f.compiler.materialize(plan, parents.context, parents.candidate, parents.inspection), reason("subject-mismatch"));
    assert.equal(f.stats().opens, 0);
  } finally { f.dispose(); other.dispose(); }
});

windowsTest("discarding the plan removes its capability to materialize even after a new inspection", async () => {
  const f = fixture(); try {
    const s = f.session(), plan = s.prepareWorkPlan(wire(f.request())); s.discardWorkPlan();
    const inspected = await s.inspect(wire(f.selector)), { selection, edit } = f.sessionEdits(s, inspected);
    assert.throws(() => s.prepareGuidedProposal(inspected.inspectionHandle, selection, edit, plan.workPlanDigest), /planning-unavailable/);
  } finally { f.dispose(); }
});
