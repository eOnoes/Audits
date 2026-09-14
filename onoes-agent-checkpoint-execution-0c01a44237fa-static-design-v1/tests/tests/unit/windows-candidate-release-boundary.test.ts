import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import { initializeCandidateEffectLedger, SqliteCandidateEffectLedger } from "../../src/build-only/windows-candidate-effect-ledger.js";
import { CANDIDATE_EFFECT_DOMAIN, candidateEffectBlocked, candidateEffectState } from "../../src/build-only/windows-candidate-effect-state.js";
import type { CandidateEffectAdvance, CandidateEffectIntent, CandidateEffectRecord } from "../../src/build-only/windows-candidate-effect-state.js";

// Boundary NEGATIVE controls, not a production release gate or an anchor adapter.
// The separately retained synthetic checkpoint is an in-memory test oracle only.
// Reopening the real SQLite file does not prove host reboot or protected freshness.
const AT = "2026-09-14T04:00:00.000Z";
const d = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`;
function fixture() {
  const parent = resolve(tmpdir()), dir = mkdtempSync(join(parent, "onoes-release-boundary-"));
  const path = join(dir, "ledger.sqlite"), namespaceId = randomUUID();
  let db = new Database(path);
  const storeId = initializeCandidateEffectLedger(db, namespaceId);
  let ledger = new SqliteCandidateEffectLedger(db, storeId, namespaceId, () => AT);
  const makeIntent = (): CandidateEffectIntent => ({
    schemaVersion: CANDIDATE_EFFECT_DOMAIN, namespaceId, storeId,
    operationId: randomUUID(), workflowId: randomUUID(), approvalId: randomUUID(), kind: "execute",
    workspaceDigest: d(1), policyBindingDigest: d(2), candidateDigest: d(3), reviewMaterialDigest: d(4),
    sourceManifestDigest: d(5), requestDigest: d(6), guestImageDigest: d(7), guestGeneration: randomUUID(),
    controllerIdentityDigest: d(8), resourcePolicyDigest: d(9), expiresAt: "2026-09-14T04:05:00.000Z",
  });
  return {
    get db() { return db; }, get ledger() { return ledger; }, makeIntent,
    reopen() {
      db.close(); db = new Database(path, { fileMustExist: true });
      ledger = new SqliteCandidateEffectLedger(db, storeId, namespaceId, () => AT);
    },
    // Controlled synchronous fixture only: no second writer. NOT an atomic
    // production inventory API. All terminal rows are included, unlike listBlocked.
    root() {
      const ids = db.prepare("SELECT operation_id FROM candidate_effect_operations ORDER BY operation_id").all() as { operation_id: string }[];
      return canonicalSha256Digest({ domain: "test-only-release-boundary-inventory", namespaceId, storeId,
        entries: ids.map(({ operation_id }) => {
          const r = ledger.read(operation_id); assert.ok(r);
          return { operationId: operation_id, recordDigest: canonicalSha256Digest(r) };
        }) });
    },
    dispose() {
      if (db.open) db.close();
      const target = resolve(dir);
      assert.equal(dirname(target), parent);
      assert.match(basename(target), /^onoes-release-boundary-[a-zA-Z0-9]+$/);
      rmSync(target, { recursive: true, force: true });
    },
  };
}
function next(r: CandidateEffectRecord, state: CandidateEffectAdvance["state"], passed = true): CandidateEffectAdvance {
  return { operationId: r.intent.operationId, intentDigest: r.intentDigest, state, evidenceDigest: d(10),
    resultDigest: state === "result-and-stop-observed" ? d(11) : null,
    verificationPassed: state === "result-and-stop-observed" ? passed : null };
}
function beforeTerminal(f: ReturnType<typeof fixture>, terminal: "completed" | "failed" | "cancelled" | "restored" | "publish-completed") {
  let r = f.ledger.reserve(f.makeIntent()).record;
  if (terminal === "cancelled") return r;
  for (const state of ["source-delivery-possible", "launch-possible", "result-and-stop-observed"] as const)
    r = f.ledger.advance(next(r, state, terminal !== "failed")).record;
  if (terminal === "completed" || terminal === "failed") return r;
  r = f.ledger.advance(next(r, "completed")).record;
  const publication: CandidateEffectIntent = { ...r.intent, kind: "publish", operationId: randomUUID(), approvalId: randomUUID(),
    executionOperationId: r.intent.operationId, resultDigest: d(11) };
  r = f.ledger.reserve(publication).record;
  return f.ledger.advance(next(r, "publication-possible")).record;
}

for (const terminal of ["completed", "failed", "cancelled", "restored", "publish-completed"] as const) {
  test(`boundary negative: v2 ${terminal} releases after SQLite reopen without an anchor acknowledgment`, () => {
    const f = fixture(); try {
      const prior = beforeTerminal(f, terminal), checkpointBeforeTerminal = f.root();
      assert.equal(candidateEffectBlocked(prior), true);
      const terminalState = terminal === "publish-completed" ? "completed" : terminal;
      const result = f.ledger.advance(next(prior, terminalState)).record;
      // Simulate terminal commit followed by process loss before anchor append.
      // No anchor callback exists in the ledger, and none was invoked here.
      f.reopen();
      assert.deepEqual(f.ledger.read(result.intent.operationId), result);
      assert.equal(candidateEffectState(result), terminalState);
      assert.equal(candidateEffectBlocked(result), false);
      assert.deepEqual(f.ledger.listBlocked(), []);
      assert.notEqual(f.root(), checkpointBeforeTerminal, "a fresh joined inventory would reject the stale checkpoint");
      // Affirmatively reproduce the boundary: the RAW v2 store permits a new
      // workflow. A future consumer MUST mediate this; this is not approval to do so.
      assert.equal(f.ledger.reserve(f.makeIntent()).disposition, "recorded");
    } finally { f.dispose(); }
  });
}

test("boundary: anchor response loss and absent append have identical ledger bytes but different independent histories", () => {
  const f = fixture(); try {
    const prior = beforeTerminal(f, "completed"), absentAppend = f.root();
    const terminal = f.ledger.advance(next(prior, "completed")).record;
    const persistedAppendWithLostReply = f.root();
    assert.notEqual(absentAppend, persistedAppendWithLostReply);
    f.reopen();
    assert.deepEqual(f.ledger.read(terminal.intent.operationId), terminal);
    assert.equal(f.root(), persistedAppendWithLostReply);
    assert.notEqual(f.root(), absentAppend);
    // Memory of a missing reply cannot decide whether the anchor persisted.
    // Neither equality above establishes owner fencing, safe custody or authority.
    assert.equal(f.ledger.reserve(terminal.intent).disposition, "replayed");
    assert.equal(f.root(), persistedAppendWithLostReply, "replay makes no new history");
  } finally { f.dispose(); }
});

test("boundary negative: deleting a releasing terminal is invisible to listBlocked but changes complete inventory", () => {
  const f = fixture(); try {
    const prior = beforeTerminal(f, "completed"), terminal = f.ledger.advance(next(prior, "completed")).record;
    const expected = f.root();
    assert.deepEqual(f.ledger.listBlocked(), []);
    // Deliberate corruption of this disposable SYNTHETIC fixture only.
    f.db.prepare("DELETE FROM candidate_effect_operations WHERE operation_id=?").run(terminal.intent.operationId);
    f.reopen();
    assert.deepEqual(f.ledger.listBlocked(), []);
    assert.equal(f.ledger.read(terminal.intent.operationId), undefined);
    assert.notEqual(f.root(), expected, "complete independently retained inventory exposes the deletion");
  } finally { f.dispose(); }
});

test("boundary: v2 missing-result quarantine stays absorbing and cannot emulate the proposed release protocol", () => {
  const f = fixture(); try {
    let r = f.ledger.reserve(f.makeIntent()).record;
    r = f.ledger.advance(next(r, "source-delivery-possible")).record;
    r = f.ledger.advance(next(r, "launch-possible")).record;
    r = f.ledger.advance(next(r, "quarantined")).record;
    const expected = f.root(); f.reopen();
    assert.deepEqual(f.ledger.listBlocked(), [r]);
    assert.throws(() => f.ledger.reserve(f.makeIntent()), /workspace-blocked/);
    assert.throws(() => f.ledger.advance(next(r, "completed")), /transition-denied/);
    assert.throws(() => f.ledger.advance({ ...next(r, "completed"), state: "released" }), /input-invalid/);
    assert.equal(f.root(), expected);
  } finally { f.dispose(); }
});
