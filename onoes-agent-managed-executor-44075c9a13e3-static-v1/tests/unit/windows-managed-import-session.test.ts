import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Database from "better-sqlite3";
import { canonicalJson, sha256Digest } from "../../src/compatibility/canonical-json.js";
import { prepareManagedImport, discardPreparedManagedImport } from "../../src/build-only/windows-managed-import.js";
import { WindowsManagedImportSession } from "../../src/build-only/windows-managed-import-session.js";
import { WindowsManagedNativeIo } from "../../src/build-only/windows-managed-native-io.js";
import { initializeWindowsManagedWorkspaceStore, SqliteWindowsManagedWorkspaceStore, ManagedWorkspaceStoreError } from "../../src/build-only/windows-managed-workspace-store.js";

const d=(n:number)=>`sha256:${n.toString(16).padStart(64,"0")}`;
// No worker exists or is run by these pre-effect tests. Real execution is tested
// separately in disposable guests, never on the user's working machine.
const native={workspaceDigest:d(1),executablePath:"R:\\OnoesNonexistentUnitFixture\\io.exe",executableSha256:d(2)};
function fixture() {
  const db=new Database(":memory:"), id=initializeWindowsManagedWorkspaceStore(db), store=new SqliteWindowsManagedWorkspaceStore(db,id);
  const prepared=prepareManagedImport(Buffer.from(canonicalJson({schemaVersion:"onoes-managed-workspace-import/v1",files:[
    {relativePath:"empty.txt",contentBase64:"",sha256:sha256Digest(Buffer.alloc(0))}]})));
  return {db,store,prepared,close(){discardPreparedManagedImport(prepared);db.close();}};
}

test("import session rejects counterfeit or discarded preparation before durable intent or native invocation",async()=>{
  const f=fixture();try {
    for(const input of [{...f.prepared},Object.create(f.prepared),f.prepared]) {
      if(input===f.prepared)discardPreparedManagedImport(f.prepared);
      await assert.rejects(new WindowsManagedImportSession(f.store,native,d(3)).importNew(randomUUID(),input,new AbortController().signal));
      assert.equal(f.store.list().length,0);
    }
  }finally{f.close();}
});
test("cancelled import session records no intent and cannot use a malformed root binding",async()=>{
  const f=fixture();try {
    assert.throws(()=>new WindowsManagedImportSession(f.store,native,"C:\\untrusted"),/managed-import-session-invalid/);
    const abort=new AbortController();abort.abort();
    await assert.rejects(new WindowsManagedImportSession(f.store,native,d(3)).importNew(randomUUID(),f.prepared,abort.signal),/managed-import-session-unavailable/);
    assert.equal(f.store.list().length,0);
  }finally{f.close();}
});
test("an exact recorded import retry is bookkeeping only and never launches another worker",async()=>{
  const f=fixture();try {
    const requestId=randomUUID();
    const r=f.store.reserve({requestId,workspaceDigest:native.workspaceDigest,workerDigest:native.executableSha256,
      rootIdentityDigest:d(3),manifestDigest:f.prepared.manifestDigest,fileCount:1,totalBytes:0});
    f.store.beginImport(requestId,r.requestDigest);
    const session=new WindowsManagedImportSession(f.store,native,d(3));
    await assert.rejects(session.importNew(requestId,f.prepared,new AbortController().signal),
      e=>e instanceof ManagedWorkspaceStoreError&&e.reason==="transition-denied");
    await assert.rejects(session.importNew(requestId,f.prepared,new AbortController().signal),/managed-import-session-unavailable/);
    assert.equal(f.store.read(requestId).terminal,null);
    assert.equal(f.store.list().length,1);
  }finally{f.close();}
});
test("cancellation after settled native success cannot erase terminal import bookkeeping",async()=>{
  const f=fixture(),abort=new AbortController();
  const original=WindowsManagedNativeIo.prototype.importPrepared;
  WindowsManagedNativeIo.prototype.importPrepared=async()=>{abort.abort();};
  try {
    const requestId=randomUUID();
    const result=await new WindowsManagedImportSession(f.store,native,d(3)).importNew(requestId,f.prepared,abort.signal);
    assert.equal(result.terminal?.state,"ready");assert.equal(f.store.read(requestId).terminal?.state,"ready");
  } finally {WindowsManagedNativeIo.prototype.importPrepared=original;f.close();}
});
