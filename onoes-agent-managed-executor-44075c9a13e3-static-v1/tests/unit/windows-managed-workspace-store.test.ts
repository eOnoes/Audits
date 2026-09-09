import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { canonicalJson, canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import { initializeWindowsManagedWorkspaceStore, SqliteWindowsManagedWorkspaceStore,
  ManagedWorkspaceStoreError, type ManagedWorkspaceRequest } from "../../src/build-only/windows-managed-workspace-store.js";

const NOW = "2026-09-07T12:00:00.000Z", LATER = "2026-09-07T12:01:00.000Z";
const d = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`;
function request(n = 0): ManagedWorkspaceRequest {
  return {requestId: randomUUID(), workspaceDigest: d(100+n), rootIdentityDigest: d(200+n),
    manifestDigest: d(300+n), workerDigest: d(400), fileCount: 1, totalBytes: 123};
}
function fixture() {
  const parent = resolve(tmpdir()), directory = mkdtempSync(join(parent, "onoes-managed-registry-")), path = join(directory, "state.sqlite");
  const handles: Database.Database[] = [];
  const db = new Database(path); handles.push(db); const id = initializeWindowsManagedWorkspaceStore(db);
  const open = () => { const next = new Database(path, {fileMustExist: true}); handles.push(next); return next; };
  return {db,id,path,open,store: new SqliteWindowsManagedWorkspaceStore(db,id,()=>NOW),dispose() {
    for (const h of handles) if (h.open) h.close();
    assert.equal(dirname(resolve(directory)),parent); assert.ok(basename(directory).startsWith("onoes-managed-registry-"));
    rmSync(directory,{recursive:true,force:true});
  }};
}
const denied = (fn: () => unknown, reason: string) => assert.throws(fn, e => e instanceof ManagedWorkspaceStoreError && e.reason === reason);

test("managed registry persists import history, exact terminal retry and cold read-back without a new effect", () => {
  const f = fixture(); try {
    const input = request(), reserved = f.store.reserve(input);
    assert.ok(Object.isFrozen(reserved) && Object.isFrozen(reserved.request));
    assert.equal(reserved.kind,"import-history-not-authorization");
    assert.equal(reserved.importingAt,null); assert.equal(reserved.terminal,null);
    assert.equal(reserved.requestDigest,canonicalSha256Digest(input));
    assert.equal(f.db.pragma("journal_mode",{simple:true}),"wal");
    assert.equal(f.db.pragma("synchronous",{simple:true}),2);
    assert.equal(f.store.beginImport(input.requestId,reserved.requestDigest).importingAt,NOW);
    const ready = f.store.recordTerminal(input.requestId,reserved.requestDigest,"ready",d(1));
    assert.equal(ready.terminal?.state,"ready"); f.db.close();
    const cold = new SqliteWindowsManagedWorkspaceStore(f.open(),f.id,()=>{throw new Error("read sampled clock");});
    assert.deepEqual(cold.reserve(input),ready); assert.deepEqual(cold.list(),[ready]);
    assert.deepEqual(cold.recordTerminal(input.requestId,reserved.requestDigest,"ready",d(1)),ready);
    denied(()=>cold.beginImport(input.requestId,reserved.requestDigest),"transition-denied");
    denied(()=>cold.recordTerminal(input.requestId,reserved.requestDigest,"ready",d(2)),"request-conflict");
    denied(()=>cold.recordTerminal(input.requestId,reserved.requestDigest,"quarantined",d(1)),"request-conflict");
  } finally { f.dispose(); }
});

test("cold interrupted import cannot become ready even with a matching manifest or a forged completion assertion", () => {
  const f=fixture(); try {
    const input=request(), r=f.store.reserve(input); f.store.beginImport(input.requestId,r.requestDigest); f.db.close();
    const cold=new SqliteWindowsManagedWorkspaceStore(f.open(),f.id,()=>LATER);
    assert.equal(cold.read(input.requestId).importingAt,NOW);
    denied(()=>cold.recordTerminal(input.requestId,r.requestDigest,"ready",d(1)),"transition-denied");
    const q=cold.recordTerminal(input.requestId,r.requestDigest,"quarantined",d(2));
    assert.equal(q.terminal?.recordedAt,LATER);
    denied(()=>cold.beginImport(input.requestId,r.requestDigest),"transition-denied");
    denied(()=>cold.recordTerminal(input.requestId,r.requestDigest,"ready",d(2)),"request-conflict");
    denied(()=>cold.reserve({...input,requestId:randomUUID()}),"workspace-reused");
    denied(()=>cold.reserve({...input,requestId:randomUUID(),workspaceDigest:d(999)}),"root-reused");
  } finally { f.dispose(); }
});

test("prepared root is not ready; exact preparation retries never confer start or completion", () => {
  const f=fixture(); try {
    const input=request(), r=f.store.reserve(input);
    assert.deepEqual(f.store.reserve(input),r);
    denied(()=>f.store.recordTerminal(input.requestId,r.requestDigest,"ready",d(1)),"transition-denied");
    const cold=new SqliteWindowsManagedWorkspaceStore(f.open(),f.id,()=>LATER);
    const q=cold.recordTerminal(input.requestId,r.requestDigest,"quarantined",d(2));
    assert.equal(q.importingAt,null); assert.equal(q.terminal?.state,"quarantined");
    denied(()=>f.store.beginImport(input.requestId,r.requestDigest),"transition-denied");
  } finally { f.dispose(); }
});

test("separate handles share one start and quarantine domain; another handle cannot mint live completion", () => {
  const f=fixture(); try {
    const other=new SqliteWindowsManagedWorkspaceStore(f.open(),f.id,()=>NOW), input=request(), r=f.store.reserve(input);
    f.store.beginImport(input.requestId,r.requestDigest);
    denied(()=>other.beginImport(input.requestId,r.requestDigest),"transition-denied");
    denied(()=>other.recordTerminal(input.requestId,r.requestDigest,"ready",d(1)),"transition-denied");
    other.recordTerminal(input.requestId,r.requestDigest,"quarantined",d(2));
    denied(()=>f.store.recordTerminal(input.requestId,r.requestDigest,"ready",d(1)),"request-conflict");
  } finally { f.dispose(); }
});

test("every immutable import identity change denies retry and root/workspace lifetime reuse", () => {
  const f=fixture(); try {
    const input=request(), r=f.store.reserve(input);
    for (const change of [{workspaceDigest:d(1)},{rootIdentityDigest:d(2)},{workerDigest:d(3)},
      {manifestDigest:d(4)},{fileCount:2},{totalBytes:124}]) denied(()=>f.store.reserve({...input,...change}),"request-conflict");
    denied(()=>f.store.reserve({...input,sourcePath:"C:\\private"}),"request-invalid");
    denied(()=>f.store.reserve({...input,approvalId:randomUUID()}),"request-invalid");
    denied(()=>f.store.beginImport(input.requestId,d(1)),"request-conflict");
    denied(()=>f.store.read(randomUUID()),"missing");
    f.store.beginImport(input.requestId,r.requestDigest); f.store.recordTerminal(input.requestId,r.requestDigest,"ready",d(5));
    denied(()=>f.store.reserve({...input,requestId:randomUUID()}),"workspace-reused");
    denied(()=>f.store.reserve({...input,requestId:randomUUID(),workspaceDigest:d(999)}),"root-reused");
  } finally { f.dispose(); }
});

test("store opens only exact initialized schema with separately pinned identity; no automatic recovery initialization", () => {
  const f=fixture(), empty=new Database(":memory:"); try {
    denied(()=>new SqliteWindowsManagedWorkspaceStore(empty,f.id),"schema-invalid");
    assert.equal((empty.prepare("SELECT count(*) AS n FROM sqlite_schema").get() as {n:number}).n,0);
    denied(()=>new SqliteWindowsManagedWorkspaceStore(f.db,randomUUID()),"store-identity-mismatch");
    denied(()=>initializeWindowsManagedWorkspaceStore(f.db),"schema-invalid");
    f.db.exec("CREATE TABLE foreign_state (x TEXT)"); denied(()=>f.store.list(),"schema-invalid");
  } finally { empty.close(); f.dispose(); }
});

test("durability drift, active transactions and malformed time cannot silently lower import evidence", () => {
  const f=fixture(); try {
    const input=request(), r=f.store.reserve(input);
    f.db.pragma("synchronous=NORMAL"); denied(()=>f.store.beginImport(input.requestId,r.requestDigest),"durability-invalid");
    f.db.pragma("synchronous=FULL");
    f.db.transaction(()=>denied(()=>f.store.list(),"transaction-active")).immediate();
    const bad=new SqliteWindowsManagedWorkspaceStore(f.open(),f.id,()=>"2026-09-07T12:00:00Z");
    denied(()=>bad.beginImport(input.requestId,r.requestDigest),"clock-invalid");
    assert.equal(f.store.read(input.requestId).importingAt,null);
    const backwards=new SqliteWindowsManagedWorkspaceStore(f.open(),f.id,()=>"2026-09-06T12:00:00.000Z");
    denied(()=>backwards.beginImport(input.requestId,r.requestDigest),"clock-invalid");
  } finally { f.dispose(); }
});

test("failed ready persistence is reconcile-only; no second completion guessed from assumed rollback", () => {
  const f=fixture(); try {
    let now=NOW; const store=new SqliteWindowsManagedWorkspaceStore(f.open(),f.id,()=>now), input=request();
    const r=store.reserve(input); store.beginImport(input.requestId,r.requestDigest); now="invalid";
    denied(()=>store.recordTerminal(input.requestId,r.requestDigest,"ready",d(1)),"clock-invalid");
    now=LATER; denied(()=>store.recordTerminal(input.requestId,r.requestDigest,"ready",d(1)),"transition-denied");
    assert.equal(store.read(input.requestId).terminal,null);
    assert.equal(store.recordTerminal(input.requestId,r.requestDigest,"quarantined",d(2)).terminal?.state,"quarantined");
  } finally { f.dispose(); }
});

test("record read-back rejects changed bytes, hash, indexed identity and impossible state", () => {
  for (const attack of ["json","digest","identity","terminal","canonical"]) {
    const f=fixture(); try {
      const input=request(), r=f.store.reserve(input), copy={...structuredClone(r)};
      if (attack==="json") f.db.prepare("UPDATE managed_workspace_records SET record_json=?").run("xx");
      else if (attack==="digest") f.db.prepare("UPDATE managed_workspace_records SET record_digest=?").run(d(9));
      else if (attack==="identity") f.db.prepare("UPDATE managed_workspace_records SET workspace_digest=?").run(d(9));
      else if (attack==="canonical") f.db.prepare("UPDATE managed_workspace_records SET record_json=?").run(JSON.stringify(r));
      else {
        copy.terminal={state:"ready",recordedAt:NOW,evidenceDigest:d(9)};
        f.db.prepare("UPDATE managed_workspace_records SET record_json=?,record_digest=?").run(canonicalJson(copy),canonicalSha256Digest(copy));
      }
      denied(()=>f.store.read(input.requestId),"state-invalid");
    } finally { f.dispose(); }
  }
});

test("oversized damaged DB rows are rejected before raw JSON materialization", () => {
  const f=fixture(); try {
    f.store.reserve(request()); f.db.pragma("ignore_check_constraints=ON");
    f.db.exec("UPDATE managed_workspace_records SET record_json=CAST(zeroblob(1000000) AS TEXT)");
    f.db.pragma("ignore_check_constraints=OFF"); denied(()=>f.store.list(),"state-invalid");
  } finally { f.dispose(); }
});

test("lifetime row and byte quotas bind at declared boundaries, including completed imports", () => {
  for (const byBytes of [false,true]) {
    const f=fixture(); try {
      const count=byBytes?16:32;
      for (let i=0;i<count;i++) {
        const input={...request(i),totalBytes:byBytes?4_194_304:0};
        const r=f.store.reserve(input); f.store.beginImport(input.requestId,r.requestDigest);
        f.store.recordTerminal(input.requestId,r.requestDigest,"ready",d(1));
      }
      assert.equal(f.store.list().length,count);
      denied(()=>f.store.reserve({...request(count),totalBytes:byBytes?1:0}),"limit-exceeded");
      assert.equal(f.db.pragma("quick_check",{simple:true}),"ok");
    } finally { f.dispose(); }
  }
});

test("empty-file imports and metadata receipts have bounded non-content fields", () => {
  const f=fixture(); try {
    const input={...request(),fileCount:64,totalBytes:0}, r=f.store.reserve(input);
    assert.equal(r.request.totalBytes,0); assert.ok(Buffer.byteLength(canonicalJson(r))<4096);
    for (const input of [{...request(1),totalBytes:4_194_305},{...request(1),fileCount:65},{...request(1),fileCount:0},
      {...request(1),totalBytes:-1},{...request(1),requestId:"a"}]) denied(()=>f.store.reserve(input),"request-invalid");
    assert.ok(!JSON.stringify(r).includes("relativePath"));
  } finally { f.dispose(); }
});
