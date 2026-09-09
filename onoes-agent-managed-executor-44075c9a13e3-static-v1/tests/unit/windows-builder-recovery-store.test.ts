import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename,dirname,join,resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { canonicalJson,canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import { initializeWindowsBuilderRecoveryStore,SqliteWindowsBuilderRecoveryStore,RecoveryStoreError,
  RECOVERY_MAX_FILE_BYTES,RECOVERY_MAX_OPERATION_BYTES,RECOVERY_MAX_STORE_BYTES,RECOVERY_MAX_OPERATIONS } from "../../src/build-only/windows-builder-recovery-store.js";

const NOW="2026-09-05T20:40:00.000Z";
const d=(n:number)=>`sha256:${n.toString(16).padStart(64,"0")}`;
function identity(){return {operationId:randomUUID(),taskDigest:d(1),proposalDigest:d(2),authorizationDigest:d(3),
  workspaceDigest:d(4),scopeDigest:d(5),policyBinding:{storeId:randomUUID(),revision:1,policyDigest:d(6)}};}
const files=()=>[{relativePath:"src/a.ts",bytes:Buffer.from("export const a = 1;\r\n")},
  {relativePath:"src/b.ts",bytes:Buffer.from([0xef,0xbb,0xbf,...Buffer.from("// second\n")])}];
function fixture(){
  const parent=resolve(tmpdir()),directory=mkdtempSync(join(parent,"onoes-recovery-store-")),path=join(directory,"journal.sqlite");
  const handles:Database.Database[]=[];
  const open=()=>{const db=new Database(path,{fileMustExist:true});handles.push(db);return db;};
  const db=new Database(path);handles.push(db);const id=initializeWindowsBuilderRecoveryStore(db);
  return {db,id,path,open,store:new SqliteWindowsBuilderRecoveryStore(db,id,()=>NOW),dispose(){
    for(const h of handles)if(h.open)h.close();
    const target=resolve(directory);assert.equal(dirname(target),parent);assert.ok(basename(target).startsWith("onoes-recovery-store-"));
    rmSync(target,{recursive:true,force:true});
  }};
}
function denies(fn:()=>unknown,reason:string){assert.throws(fn,(e:unknown)=>e instanceof RecoveryStoreError&&e.reason===reason);}

test("recovery snapshots commit exact bytes, isolate caller mutation and reopen unfinished",()=>{
  const f=fixture();try{
    const request=identity(), preimages=files();
    const prepared=f.store.prepare(request,preimages);
    assert.equal(prepared.totalBytes,preimages.reduce((n,p)=>n+p.bytes.length,0));
    assert.ok(Object.isFrozen(prepared));assert.equal(f.db.pragma("journal_mode",{simple:true}),"wal");
    assert.equal(f.db.pragma("synchronous",{simple:true}),2);assert.equal(f.db.pragma("foreign_keys",{simple:true}),1);
    assert.equal(f.db.pragma("quick_check",{simple:true}),"ok");
    preimages[0]!.bytes.fill(120);request.policyBinding.revision=2;
    const returned=f.store.readPreimages(request.operationId);
    assert.deepEqual(returned.map(x=>Buffer.from(x.bytes)),files().map(x=>x.bytes));
    returned[0]!.bytes.fill(121);
    assert.deepEqual(f.store.readPreimages(request.operationId).map(x=>Buffer.from(x.bytes)),files().map(x=>x.bytes));
    f.db.close();const recovered=new SqliteWindowsBuilderRecoveryStore(f.open(),f.id,()=>{throw new Error("read must not sample clock");});
    const pending=recovered.listUnfinished();assert.equal(pending.length,1);assert.equal(pending[0]!.effectsPossibleAt,null);
    assert.equal(pending[0]!.terminal,null);assert.equal(pending[0]!.request.identity.policyBinding.revision,1);
    assert.deepEqual(recovered.readPreimages(request.operationId).map(x=>Buffer.from(x.bytes)),files().map(x=>x.bytes));
    const text=JSON.stringify(prepared);assert.equal(text.includes("src/a.ts"),false);assert.equal(text.includes("export const"),false);
  }finally{f.dispose();}
});

test("recovery preparation retries are exact and marker retries cannot repeat execution",()=>{
  const f=fixture();try{
    const request=identity(),prepared=f.store.prepare(request,files());
    const retry=new SqliteWindowsBuilderRecoveryStore(f.open(),f.id,()=>{throw new Error("retry clock");});
    assert.deepEqual(retry.prepare(request,files()),prepared);
    denies(()=>f.store.prepare({...request,scopeDigest:d(99)},files()),"request-conflict");
    denies(()=>f.store.prepare(request,[{relativePath:"src/a.ts",bytes:Buffer.from("changed")}]),"request-conflict");
    denies(()=>f.store.markEffectsPossible(request.operationId,d(99)),"request-conflict");
    const started=f.store.markEffectsPossible(request.operationId,prepared.requestDigest);
    assert.equal(started.effectsPossibleAt,NOW);
    denies(()=>retry.markEffectsPossible(request.operationId,prepared.requestDigest),"transition-denied");
    assert.deepEqual(retry.prepare(request,files()),prepared);
    assert.equal(retry.read(request.operationId).effectsPossibleAt,NOW);
    assert.equal(retry.listUnfinished().length,1);
  }finally{f.dispose();}
});

test("one authorization cannot acquire two journal entries, even after terminal recording",()=>{
  const f=fixture();try{
    const request=identity(),p=f.store.prepare(request,files());
    denies(()=>f.store.prepare({...request,operationId:randomUUID(),workspaceDigest:d(20)},files()),"authorization-reused");
    denies(()=>f.store.prepare({...request,operationId:randomUUID(),authorizationDigest:d(21)},files()),"workspace-unfinished");
    denies(()=>f.store.recordTerminal({operationId:request.operationId,requestDigest:p.requestDigest,outcome:"completed",evidenceDigest:d(22)}),"transition-denied");
    f.store.markEffectsPossible(request.operationId,p.requestDigest);
    const outcome={operationId:request.operationId,requestDigest:p.requestDigest,outcome:"restored",evidenceDigest:d(22)};
    const terminal=f.store.recordTerminal(outcome);assert.equal(f.store.listUnfinished().length,0);
    const retry=new SqliteWindowsBuilderRecoveryStore(f.open(),f.id,()=>{throw new Error("retry clock");});
    assert.deepEqual(retry.recordTerminal(outcome),terminal);
    denies(()=>retry.recordTerminal({...outcome,evidenceDigest:d(23)}),"request-conflict");
    denies(()=>retry.recordTerminal({...outcome,outcome:"completed"}),"request-conflict");
    denies(()=>retry.markEffectsPossible(request.operationId,p.requestDigest),"transition-denied");
    denies(()=>f.store.prepare({...request,operationId:randomUUID()},files()),"authorization-reused");
    const next=f.store.prepare({...request,operationId:randomUUID(),authorizationDigest:d(24)},files());
    assert.notEqual(next.operationId,p.operationId);assert.equal(f.store.listUnfinished().length,1);
  }finally{f.dispose();}
});

test("quarantine survives restart, blocks its workspace and cannot be cleared by a terminal retry",()=>{
  const f=fixture();try{
    const request=identity(),p=f.store.prepare(request,files());f.store.markEffectsPossible(request.operationId,p.requestDigest);
    const result={operationId:request.operationId,requestDigest:p.requestDigest,outcome:"quarantined",evidenceDigest:d(30)};
    const original=f.store.recordTerminal(result);f.db.close();
    const recovered=new SqliteWindowsBuilderRecoveryStore(f.open(),f.id,()=>NOW);
    assert.deepEqual(recovered.listUnfinished(),[original]);assert.deepEqual(recovered.recordTerminal(result),original);
    denies(()=>recovered.recordTerminal({...result,outcome:"restored"}),"request-conflict");
    denies(()=>recovered.prepare({...request,operationId:randomUUID(),authorizationDigest:d(31)},files()),"workspace-unfinished");
  }finally{f.dispose();}
});

test("recovery store never initializes missing, foreign or differently pinned state on open",()=>{
  const f=fixture();const empty=new Database(":memory:");try{
    denies(()=>new SqliteWindowsBuilderRecoveryStore(empty,f.id),"schema-invalid");
    assert.equal((empty.prepare("SELECT count(*) AS n FROM sqlite_schema").get() as {n:number}).n,0);
    denies(()=>new SqliteWindowsBuilderRecoveryStore(f.db,randomUUID()),"store-identity-mismatch");
    denies(()=>initializeWindowsBuilderRecoveryStore(f.db),"schema-invalid");
    f.db.exec("CREATE TABLE foreign_data (value TEXT)");denies(()=>f.store.listUnfinished(),"schema-invalid");
  }finally{empty.close();f.dispose();}
});

test("changed SQLite settings, caller transactions, temp shadows and attached databases deny",()=>{
  for(const statement of ["PRAGMA synchronous=NORMAL","PRAGMA foreign_keys=OFF","PRAGMA trusted_schema=ON",
    "PRAGMA busy_timeout=251","PRAGMA ignore_check_constraints=ON","BEGIN IMMEDIATE",
    "CREATE TEMP TABLE builder_recovery_operations (x TEXT)","ATTACH ':memory:' AS extra"]){
    const f=fixture();try{
      f.db.exec(statement);
      const reason=statement.startsWith("BEGIN")?"transaction-active":statement.startsWith("CREATE")||statement.startsWith("ATTACH")?"schema-invalid":"durability-invalid";
      denies(()=>f.store.listUnfinished(),reason);
      if(f.db.inTransaction)f.db.exec("ROLLBACK");
    }finally{f.dispose();}
  }
});

test("preparation input rejects unsafe, case-aliased, unsorted, oversized, binary and secret-like snapshots",()=>{
  const f=fixture();try{
    for(const snapshot of [[],[{relativePath:"../a",bytes:Buffer.from("a")}],
      [{relativePath:"src/A",bytes:Buffer.from("a")},{relativePath:"src/a",bytes:Buffer.from("a")}],files().reverse(),
      [{relativePath:"a",bytes:Buffer.from([0])}],[{relativePath:"a",bytes:Buffer.from([0xc0,0xaf])}],
      [{relativePath:"a",bytes:Buffer.from("api_key = "+"x".repeat(32))}]])denies(()=>f.store.prepare(identity(),snapshot),"request-invalid");
    denies(()=>f.store.prepare({...identity(),extra:true},files()),"request-invalid");
    denies(()=>f.store.prepare(identity(),[{relativePath:"a",bytes:new Uint8Array(RECOVERY_MAX_FILE_BYTES+1)}]),"limit-exceeded");
    assert.equal(f.store.listUnfinished().length,0);
  }finally{f.dispose();}
});

test("corrupt metadata, missing preimages, changed BLOBs and extra BLOBs cannot cross the effects marker",()=>{
  for(const mutate of [
    (db:Database.Database)=>db.exec("UPDATE builder_recovery_operations SET record_digest='bad'"),
    (db:Database.Database)=>db.exec("DELETE FROM builder_recovery_preimages WHERE relative_path='src/a.ts'"),
    (db:Database.Database)=>db.exec("UPDATE builder_recovery_preimages SET content=CAST('changed' AS BLOB) WHERE relative_path='src/a.ts'"),
    (db:Database.Database)=>db.exec("INSERT INTO builder_recovery_preimages SELECT operation_id,'src/extra.ts',CAST('x' AS BLOB) FROM builder_recovery_operations"),
  ]){
    const f=fixture();try{
      const request=identity(),p=f.store.prepare(request,files());mutate(f.db);
      denies(()=>f.store.markEffectsPossible(request.operationId,p.requestDigest),"state-invalid");
      const row=f.db.prepare("SELECT record_json FROM builder_recovery_operations").get() as {record_json:string};
      assert.equal((JSON.parse(row.record_json) as {effectsPossibleAt:null}).effectsPossibleAt,null);
    }finally{f.dispose();}
  }
});

test("failed insertion rolls back the whole intent and every preimage",()=>{
  const f=fixture();try{
    const prepare=f.db.prepare.bind(f.db);let inserts=0;
    f.db.prepare=((sql:string)=>{
      const statement=prepare(sql);
      if(sql.startsWith("INSERT INTO builder_recovery_preimages")){
        const run=statement.run.bind(statement);
        statement.run=((...args:unknown[])=>{const r=run(...args);if(++inserts===2)throw new Error("fixed-insert-fault");return r;}) as typeof statement.run;
      }
      return statement;
    }) as typeof f.db.prepare;
    denies(()=>f.store.prepare(identity(),files()),"storage-unavailable");assert.equal(inserts,2);
    assert.equal(f.db.inTransaction,false);assert.equal(f.store.listUnfinished().length,0);
    assert.equal((prepare("SELECT count(*) AS n FROM builder_recovery_preimages").get() as {n:number}).n,0);
  }finally{f.dispose();}
});

test("clock regression cannot advance recovery state and successful output is deeply immutable",()=>{
  const f=fixture();try{
    const request=identity(),p=f.store.prepare(request,files());
    for(const now of ["not-a-date","2026-09-05T20:40:00Z","2026-09-04T20:40:00.000Z"]){
      const store=new SqliteWindowsBuilderRecoveryStore(f.open(),f.id,()=>now);
      denies(()=>store.markEffectsPossible(request.operationId,p.requestDigest),"clock-invalid");
    }
    const r=f.store.markEffectsPossible(request.operationId,p.requestDigest);
    assert.ok(Object.isFrozen(r.request.files));assert.ok(Object.isFrozen(r.request.identity.policyBinding));
    assert.equal(canonicalSha256Digest(r.request),p.requestDigest);
    assert.equal(canonicalJson(r), (f.db.prepare("SELECT record_json FROM builder_recovery_operations").get() as {record_json:string}).record_json);
    assert.deepEqual([RECOVERY_MAX_FILE_BYTES,RECOVERY_MAX_OPERATION_BYTES,RECOVERY_MAX_STORE_BYTES,RECOVERY_MAX_OPERATIONS],
      [16_777_216,67_108_864,268_435_456,1_000]);
  }finally{f.dispose();}
});

test("an oversized damaged journal JSON is rejected before the driver returns its contents",()=>{
  const f=fixture();try{
    const request=identity();f.store.prepare(request,files());
    f.db.pragma("ignore_check_constraints=ON");
    f.db.prepare("UPDATE builder_recovery_operations SET record_json=?").run("x".repeat(700_001));
    f.db.pragma("ignore_check_constraints=OFF");
    const prepare=f.db.prepare.bind(f.db);let observed=false;
    f.db.prepare=((sql:string)=>{
      const statement=prepare(sql);
      if(sql.includes("ELSE NULL END AS record_json")){
        const get=statement.get.bind(statement);
        statement.get=((...args:unknown[])=>{const row=get(...args) as {record_json:unknown};assert.equal(row.record_json,null);observed=true;return row;}) as typeof statement.get;
      }
      return statement;
    }) as typeof f.db.prepare;
    denies(()=>f.store.read(request.operationId),"state-invalid");assert.equal(observed,true);
  }finally{f.dispose();}
});

test("a second connection cannot prepare while another writer owns the transaction",()=>{
  const f=fixture();try{
    const other=f.open(),store=new SqliteWindowsBuilderRecoveryStore(other,f.id,()=>NOW);
    f.db.exec("BEGIN IMMEDIATE");
    try{denies(()=>store.prepare(identity(),files()),"storage-unavailable");}
    finally{f.db.exec("ROLLBACK");}
    assert.equal(store.listUnfinished().length,0);assert.equal(other.inTransaction,false);
    assert.equal(store.prepare(identity(),files()).fileCount,2);
  }finally{f.dispose();}
});

test("operation and raw-byte quota decisions reject before insertion at the fixed limits",()=>{
  // Inject only the aggregate result at the SQL seam; do not allocate 256 MiB
  // or claim this is a real full-volume/storage-capacity test.
  for(const limit of ["operations","bytes"] as const){
    const f=fixture();try{
      const prepare=f.db.prepare.bind(f.db);let quotaRead=false;
      f.db.prepare=((sql:string)=>{
        const statement=prepare(sql);
        if((limit==="operations"&&sql==="SELECT count(*) AS n FROM builder_recovery_operations")
          ||(limit==="bytes"&&sql==="SELECT coalesce(sum(length(content)),0) AS n FROM builder_recovery_preimages")){
          statement.get=(()=>{quotaRead=true;return {n:limit==="operations"?RECOVERY_MAX_OPERATIONS:RECOVERY_MAX_STORE_BYTES};}) as typeof statement.get;
        }
        return statement;
      }) as typeof f.db.prepare;
      denies(()=>f.store.prepare(identity(),files()),"limit-exceeded");assert.equal(quotaRead,true);
      assert.equal((prepare("SELECT count(*) AS n FROM builder_recovery_operations").get() as {n:number}).n,0);
      assert.equal(f.db.inTransaction,false);
    }finally{f.dispose();}
  }
});

test("empty text preimages are retained and terminal bytes are not inferred from matching filenames",()=>{
  const f=fixture();try{
    const request=identity(),p=f.store.prepare(request,[{relativePath:"empty.txt",bytes:new Uint8Array()}]);
    assert.equal(p.totalBytes,0);assert.equal(f.store.readPreimages(request.operationId)[0]!.bytes.length,0);
    assert.equal(f.store.read(request.operationId).terminal,null);
    denies(()=>f.store.prepare(request,[{relativePath:"empty.txt",bytes:Buffer.from("now populated")}]),"request-conflict");
    const tooMany=Array.from({length:1001},(_,i)=>({relativePath:`f${i.toString().padStart(4,"0")}.txt`,bytes:new Uint8Array()}));
    denies(()=>f.store.prepare(identity(),tooMany),"request-invalid");
  }finally{f.dispose();}
});
