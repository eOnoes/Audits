import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync,readFileSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename,dirname,join,resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import Database from "better-sqlite3";
import { canonicalJson } from "../../src/compatibility/canonical-json.js";
import { initializeWindowsWorkspacePolicyStore,upgradeWindowsWorkspacePolicyEffectIntents,
  SqliteWindowsWorkspacePolicyStore,WorkspacePolicyStoreError } from "../../src/build-only/windows-workspace-policy-store.js";

const NOW="2026-09-06T12:00:00.000Z", D=`sha256:${"a".repeat(64)}`, E=`sha256:${"b".repeat(64)}`;
function fixture(){
  const parent=resolve(tmpdir()),directory=mkdtempSync(join(parent,"onoes-effect-intent-"));
  const path=join(directory,"policy.sqlite"),handles:Database.Database[]=[];
  const open=()=>{const db=new Database(path);handles.push(db);return db;};
  const db=open();initializeWindowsWorkspacePolicyStore(db);
  const store=new SqliteWindowsWorkspacePolicyStore(db,()=>NOW);
  return {path,directory,db,store,open,dispose(){
    for(const handle of handles)if(handle.open)handle.close();
    assert.equal(dirname(resolve(directory)),parent);assert.ok(basename(directory).startsWith("onoes-effect-intent-"));
    rmSync(directory,{recursive:true,force:true});
  }};
}
const update=(store:SqliteWindowsWorkspacePolicyStore)=>({requestId:randomUUID(),expectedBinding:store.snapshot().binding,
  rules:{allowedRoots:[],deniedRoots:["C:\\"]}});
const intent=(store:SqliteWindowsWorkspacePolicyStore)=>({operationId:randomUUID(),authorizationDigest:D,requestDigest:E,binding:store.snapshot().binding});
function denies(fn:()=>unknown,reason:string){assert.throws(fn,(e:unknown)=>e instanceof WorkspacePolicyStoreError&&e.reason===reason);}

test("durable intent blocks policy updates and exposes no transaction-held callback API",()=>{
  const f=fixture();try{
    const request=intent(f.store),record=f.store.beginEffectIntent(request);
    assert.equal(f.db.inTransaction,false);assert.equal(record.settlement,null);
    const db=f.open(),other=new SqliteWindowsWorkspacePolicyStore(db,()=>NOW);
    db.exec("BEGIN IMMEDIATE");db.exec("ROLLBACK"); // Positive proof: no long-held writer lock.
    denies(()=>other.update(update(other)),"effect-pending");
    denies(()=>other.beginEffectIntent({...request,operationId:randomUUID(),authorizationDigest:E}),"effect-pending");
    assert.equal("withExclusivePolicyBinding" in other,false);
    assert.deepEqual(other.readEffectIntent(request.operationId),record);
    assert.ok(Object.isFrozen(record.binding));
  }finally{f.dispose();}
});

test("one-shot begin and immutable settlement survive restart and do not resample retry clocks",()=>{
  const f=fixture();try{
    const request=intent(f.store);f.store.beginEffectIntent(request);
    denies(()=>f.store.beginEffectIntent(request),"effect-already-started");
    const finish={operationId:request.operationId,requestDigest:request.requestDigest,outcome:"completed",evidenceDigest:D};
    const receipt=f.store.settleEffectIntent(finish);assert.equal(f.db.inTransaction,false);
    f.db.close();const other=new SqliteWindowsWorkspacePolicyStore(f.open(),()=>{throw new Error("retry clock");});
    assert.deepEqual(other.settleEffectIntent(finish),receipt);
    denies(()=>other.settleEffectIntent({...finish,evidenceDigest:E}),"effect-conflict");
    denies(()=>other.beginEffectIntent(request),"effect-already-started");
    denies(()=>other.beginEffectIntent({...request,operationId:randomUUID()}),"authorization-reused");
    const current=new SqliteWindowsWorkspacePolicyStore(f.open(),()=>NOW);current.update(update(current));
    denies(()=>current.beginEffectIntent({...request,operationId:randomUUID(),authorizationDigest:E}),"stale-policy");
    assert.deepEqual(current.readEffectIntent(request.operationId),receipt);
  }finally{f.dispose();}
});

test("quarantine never silently releases policy; malformed requests and inconsistent records deny",()=>{
  const f=fixture();try{
    const request=intent(f.store);
    for(const bad of [null,{}, {...request,approved:true},{...request,operationId:"a"},{...request,authorizationDigest:"private-path"}])
      denies(()=>f.store.beginEffectIntent(bad),"request-invalid");
    f.store.beginEffectIntent(request);
    denies(()=>f.store.settleEffectIntent({operationId:request.operationId,requestDigest:D,outcome:"completed",evidenceDigest:D}),"effect-conflict");
    f.store.settleEffectIntent({operationId:request.operationId,requestDigest:E,outcome:"quarantined",evidenceDigest:D});
    denies(()=>f.store.update(update(f.store)),"effect-pending");
    f.db.prepare("UPDATE workspace_policy_effects SET active=NULL").run();
    denies(()=>f.store.snapshot(),"state-invalid");
  }finally{f.dispose();}
});

test("explicit legacy upgrade preserves all policy and receipt bytes and reopens",()=>{
  const f=fixture();try{
    const first=update(f.store);f.store.update(first);f.store.update(update(f.store));
    const snapshot=f.store.snapshot();
    const before=canonicalJson(f.db.prepare("SELECT * FROM workspace_policy_updates ORDER BY resulting_revision").all());
    const state=canonicalJson(f.db.prepare("SELECT * FROM workspace_policy_state").all());
    f.db.exec("DROP TABLE workspace_policy_effects"); // Exact old two-table fixture, never a repair workflow.
    denies(()=>new SqliteWindowsWorkspacePolicyStore(f.db),"schema-invalid");
    upgradeWindowsWorkspacePolicyEffectIntents(f.db);f.db.close();
    const db=f.open(),reopened=new SqliteWindowsWorkspacePolicyStore(db,()=>NOW);
    assert.deepEqual(reopened.snapshot(),snapshot);
    assert.equal(canonicalJson(db.prepare("SELECT * FROM workspace_policy_updates ORDER BY resulting_revision").all()),before);
    assert.equal(canonicalJson(db.prepare("SELECT * FROM workspace_policy_state").all()),state);
    assert.equal(reopened.update(first).binding.revision,2);
    reopened.beginEffectIntent(intent(reopened));denies(()=>reopened.update(update(reopened)),"effect-pending");
    denies(()=>upgradeWindowsWorkspacePolicyEffectIntents(db),"schema-invalid");
  }finally{f.dispose();}
});

test("legacy corruption aborts upgrade without leaving an effects table",()=>{
  const f=fixture();try{
    f.store.update(update(f.store));f.db.exec("DROP TABLE workspace_policy_effects");
    f.db.exec("UPDATE workspace_policy_updates SET receipt_digest='invalid'");
    denies(()=>upgradeWindowsWorkspacePolicyEffectIntents(f.db),"state-invalid");
    assert.equal(f.db.prepare("SELECT 1 FROM sqlite_schema WHERE name='workspace_policy_effects'").get(),undefined);
    assert.equal(f.db.inTransaction,false);
  }finally{f.dispose();}
});

test("effect timestamps reject regression and errors reveal no inputs",()=>{
  const f=fixture();try{
    const request=intent(f.store);
    const bad=new SqliteWindowsWorkspacePolicyStore(f.open(),()=>"2026-09-06T12:00:00+00:00");
    denies(()=>bad.beginEffectIntent(request),"clock-invalid");
    f.store.beginEffectIntent(request);
    const older=new SqliteWindowsWorkspacePolicyStore(f.open(),()=>"2026-09-05T12:00:00.000Z");
    denies(()=>older.settleEffectIntent({operationId:request.operationId,requestDigest:E,outcome:"unchanged",evidenceDigest:D}),"clock-regression");
    try{f.store.beginEffectIntent({...request,secret:"never-export-this"});assert.fail();}
    catch(e){assert.equal((e as Error).message,"workspace-policy-request-invalid");}
  }finally{f.dispose();}
});

test("lost begin read-back preserves the pending record; retry cannot begin another effect",()=>{
  const f=fixture();try{
    const request=intent(f.store);
    f.store.readEffectIntent=()=>{throw new Error("fixed-readback-failure");};
    denies(()=>f.store.beginEffectIntent(request),"storage-unavailable");
    const recovered=new SqliteWindowsWorkspacePolicyStore(f.open(),()=>NOW);
    assert.equal(recovered.readEffectIntent(request.operationId).settlement,null);
    denies(()=>recovered.beginEffectIntent(request),"effect-already-started");
    denies(()=>recovered.update(update(recovered)),"effect-pending");
  }finally{f.dispose();}
});

test("a changed committed intent cannot be returned as a fresh begin result",()=>{
  const f=fixture();try{
    const request=intent(f.store),other=new SqliteWindowsWorkspacePolicyStore(f.open(),()=>NOW);
    const read=f.store.readEffectIntent.bind(f.store);
    f.store.readEffectIntent=id=>{
      other.settleEffectIntent({operationId:id,requestDigest:E,outcome:"unchanged",evidenceDigest:D});
      other.update(update(other));return read(id);
    };
    denies(()=>f.store.beginEffectIntent(request),"effect-conflict");
    assert.equal(other.readEffectIntent(request.operationId).settlement?.outcome,"unchanged");
  }finally{f.dispose();}
});

for(const phase of ["intent-inserted","intent-committed","effect-written","settlement-committed"]){
  test(`real process kill at ${phase} preserves policy block and never repeats effect`,{timeout:20_000},async()=>{
    const f=fixture(),request=intent(f.store),target=join(f.directory,"fixed-effect.txt");
    let child:ReturnType<typeof spawn>|undefined,closed:Promise<void>|undefined;
    try{
      writeFileSync(target,"before");f.db.close();
      const module=pathToFileURL(resolve(".test-dist/src/build-only/windows-workspace-policy-store.js")).href;
      const library=pathToFileURL(resolve("node_modules/better-sqlite3/lib/index.js")).href;
      const script=`import Database from ${JSON.stringify(library)};
        import {writeSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
        import {SqliteWindowsWorkspacePolicyStore} from ${JSON.stringify(module)};
        const [path,target,phase,json]=process.argv.slice(1),request=JSON.parse(json),db=new Database(path,{fileMustExist:true});
        const store=new SqliteWindowsWorkspacePolicyStore(db,()=>${JSON.stringify(NOW)});
        function cut(point){if(point!==phase)return;writeSync(1,JSON.stringify({phase:point,active:db.inTransaction})+'\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);throw new Error('resumed');}
        const prepare=db.prepare.bind(db);db.prepare=sql=>{const s=prepare(sql);if(sql.startsWith('INSERT INTO workspace_policy_effects')){const run=s.run.bind(s);s.run=(...args)=>{const r=run(...args);cut('intent-inserted');return r;};}return s;};
        let commits=0;const transaction=db.transaction.bind(db);db.transaction=fn=>{const tx=transaction(fn);const result=(...args)=>tx(...args);result.deferred=tx.deferred;result.immediate=(...args)=>{const r=tx.immediate(...args);cut(++commits===1?'intent-committed':'settlement-committed');return r;};return result;};
        store.beginEffectIntent(request);
        const fd=openSync(target,'r+');writeFileSync(fd,'after!');fsyncSync(fd);closeSync(fd);cut('effect-written');
        store.settleEffectIntent({operationId:request.operationId,requestDigest:request.requestDigest,outcome:'completed',evidenceDigest:${JSON.stringify(D)}});
        throw new Error('cut-missed');`;
      child=spawn(process.execPath,["--input-type=module","-e",script,f.path,target,phase,JSON.stringify(request)],{
        stdio:["ignore","pipe","pipe"],windowsHide:true,timeout:12_000,env:{SystemRoot:process.env["SystemRoot"]??"C:\\Windows"}});
      closed=new Promise<void>(done=>child!.once("close",()=>done()));
      const marker=await new Promise<{phase:string;active:boolean}>((accept,reject)=>{
        let output="";child!.once("error",reject);child!.once("close",()=>reject(new Error("child-ended-before-cut")));
        child!.stderr!.on("data",()=>reject(new Error("child-fixture-diagnostic")));
        child!.stdout!.on("data",(chunk:Buffer)=>{output+=chunk.toString();if(output.length>4096)return reject(new Error("marker-limit"));
          if(output.endsWith("\n")){try{accept(JSON.parse(output));}catch{reject(new Error("marker-invalid"));}}});
      });
      assert.equal(marker.phase,phase);assert.equal(marker.active,phase==="intent-inserted");
      assert.equal(child.exitCode,null);assert.equal(child.kill("SIGKILL"),true);await closed;
      const db=f.open(),recovered=new SqliteWindowsWorkspacePolicyStore(db,()=>NOW);
      assert.equal(db.pragma("quick_check",{simple:true}),"ok");assert.equal(db.inTransaction,false);
      const written=phase==="effect-written"||phase==="settlement-committed";
      assert.equal(readFileSync(target,"utf8"),written?"after!":"before");
      if(phase==="intent-inserted"){
        denies(()=>recovered.readEffectIntent(request.operationId),"effect-missing");recovered.update(update(recovered));
      }else{
        denies(()=>recovered.beginEffectIntent(request),"effect-already-started");
        const record=recovered.readEffectIntent(request.operationId);
        if(phase==="settlement-committed"){
          assert.equal(record.settlement?.outcome,"completed");
          assert.deepEqual(recovered.settleEffectIntent({operationId:request.operationId,requestDigest:E,outcome:"completed",evidenceDigest:D}),record);
          recovered.update(update(recovered));
        }else{assert.equal(record.settlement,null);denies(()=>recovered.update(update(recovered)),"effect-pending");}
      }
      assert.equal(readFileSync(target,"utf8"),written?"after!":"before","recovery did not execute a filesystem callback");
    }finally{
      if(child&&child.exitCode===null&&child.signalCode===null)child.kill("SIGKILL");if(closed)await closed;f.dispose();
    }
  });
}
