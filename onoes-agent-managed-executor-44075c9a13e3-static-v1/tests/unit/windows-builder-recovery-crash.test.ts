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
import { initializeWindowsBuilderRecoveryStore,SqliteWindowsBuilderRecoveryStore,RecoveryStoreError } from "../../src/build-only/windows-builder-recovery-store.js";

const NOW="2026-09-05T20:40:00.000Z";
const phases=["intent-inserted","preimage-inserted","prepare-committed","effects-marker-committed",
  "effect-written","terminal-committed","terminal-returned"] as const;
for(const phase of phases){
  test(`recovery process kill at ${phase} exposes only committed state and never repeats effects`,{timeout:20_000},async()=>{
    const parent=resolve(tmpdir()),directory=mkdtempSync(join(parent,"onoes-recovery-crash-"));
    const path=join(directory,"journal.sqlite"),target=join(directory,"fixed-effect.txt");
    let db:Database.Database|undefined,child:ReturnType<typeof spawn>|undefined,closed:Promise<void>|undefined;
    try{
      writeFileSync(target,"original fixture\n");
      db=new Database(path);const storeId=initializeWindowsBuilderRecoveryStore(db);db.close();db=undefined;
      const digest=`sha256:${"a".repeat(64)}`;
      const identity={operationId:randomUUID(),taskDigest:digest,proposalDigest:digest,authorizationDigest:digest,
        workspaceDigest:digest,scopeDigest:digest,policyBinding:{storeId:randomUUID(),revision:1,policyDigest:digest}};
      const module=pathToFileURL(resolve(".test-dist/src/build-only/windows-builder-recovery-store.js")).href;
      const library=pathToFileURL(resolve("node_modules/better-sqlite3/lib/index.js")).href;
      const script=`import Database from ${JSON.stringify(library)};
        import {writeSync,writeFileSync} from 'node:fs';
        import {SqliteWindowsBuilderRecoveryStore} from ${JSON.stringify(module)};
        const [path,storeId,phase,json,target]=process.argv.slice(1), identity=JSON.parse(json);
        const db=new Database(path,{fileMustExist:true});
        const store=new SqliteWindowsBuilderRecoveryStore(db,storeId,()=>${JSON.stringify(NOW)});
        let commits=0;
        function cut(point){
          if(point!==phase)return;
          const inside=['intent-inserted','preimage-inserted'].includes(point);
          if(db.inTransaction!==inside)throw new Error('wrong-cut-transaction');
          writeSync(1,JSON.stringify({phase:point,inTransaction:db.inTransaction,commits})+'\\n');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
          throw new Error('cut-resumed');
        }
        const prepare=db.prepare.bind(db);
        db.prepare=sql=>{
          const s=prepare(sql);
          const point=sql.startsWith('INSERT INTO builder_recovery_operations')?'intent-inserted':
            sql.startsWith('INSERT INTO builder_recovery_preimages')?'preimage-inserted':null;
          if(point){const run=s.run.bind(s);s.run=(...args)=>{const r=run(...args);if(r.changes!==1)throw new Error('insert-missed');cut(point);return r;};}
          return s;
        };
        const transaction=db.transaction.bind(db);
        db.transaction=fn=>{
          const tx=transaction(fn);function wrapped(...args){return tx(...args);}
          wrapped.deferred=tx.deferred;wrapped.exclusive=tx.exclusive;
          wrapped.immediate=(...args)=>{const result=tx.immediate(...args);commits++;
            cut(['prepare-committed','effects-marker-committed','terminal-committed'][commits-1]);return result;};
          return wrapped;
        };
        const prepared=store.prepare(identity,[{relativePath:'fixed-effect.txt',bytes:Buffer.from('original fixture\\n')}]);
        store.markEffectsPossible(identity.operationId,prepared.requestDigest);
        writeFileSync(target,'changed fixture\\n');cut('effect-written');
        store.recordTerminal({operationId:identity.operationId,requestDigest:prepared.requestDigest,outcome:'completed',evidenceDigest:${JSON.stringify(digest)}});
        cut('terminal-returned');throw new Error('cut-missed');`;
      child=spawn(process.execPath,["--input-type=module","-e",script,path,storeId,phase,JSON.stringify(identity),target],{
        stdio:["ignore","pipe","pipe"],windowsHide:true,timeout:12_000,
        env:{SystemRoot:process.env["SystemRoot"]??"C:\\Windows"},
      });
      closed=new Promise<void>(done=>child!.once("close",()=>done()));
      let output="",diagnostic="";
      const marker=await new Promise<{phase:string;inTransaction:boolean;commits:number}>((accept,reject)=>{
        child!.once("error",reject);child!.once("close",()=>reject(new Error("child-exited-before-cut:"+diagnostic)));
        child!.stderr!.on("data",(chunk:Buffer)=>{diagnostic+=chunk.toString("utf8").slice(0,2048-diagnostic.length);reject(new Error("fixture-diagnostic:"+diagnostic));});
        child!.stdout!.on("data",(chunk:Buffer)=>{
          output+=chunk.toString("utf8");if(Buffer.byteLength(output)>4096){reject(new Error("marker-limit"));return;}
          if(output.endsWith("\n")){try{accept(JSON.parse(output));}catch{reject(new Error("marker-invalid"));}}
        });
      });
      assert.equal(marker.phase,phase);assert.equal(child.exitCode,null);assert.equal(child.signalCode,null);
      assert.equal(child.kill("SIGKILL"),true);await closed;assert.equal(diagnostic,"");
      assert.ok(child.exitCode!==0||child.signalCode!==null);
      const uncommitted=phase==="intent-inserted"||phase==="preimage-inserted";
      const started=!uncommitted&&phase!=="prepare-committed";
      const terminal=phase==="terminal-committed"||phase==="terminal-returned";
      assert.equal(marker.inTransaction,uncommitted);assert.equal(marker.commits,uncommitted?0:terminal?3:started?2:1);
      db=new Database(path,{fileMustExist:true});assert.equal(db.pragma("quick_check",{simple:true}),"ok");
      const store=new SqliteWindowsBuilderRecoveryStore(db,storeId,()=>{throw new Error("recovery must not run clock or effects");});
      const rows=(db.prepare("SELECT count(*) AS n FROM builder_recovery_operations").get() as {n:number}).n;
      assert.equal(rows,uncommitted?0:1);
      assert.equal((db.prepare("SELECT count(*) AS n FROM builder_recovery_preimages").get() as {n:number}).n,rows);
      assert.equal(store.listUnfinished().length,uncommitted||terminal?0:1);
      if(!uncommitted){
        const record=store.read(identity.operationId);
        assert.equal(record.effectsPossibleAt,started?NOW:null);
        assert.equal(record.terminal?.outcome??null,terminal?"completed":null);
        assert.equal(Buffer.from(store.readPreimages(identity.operationId)[0]!.bytes).toString(),"original fixture\n");
        assert.deepEqual(store.prepare(identity,[{relativePath:"fixed-effect.txt",bytes:Buffer.from("original fixture\n")}]),record.prepared);
        if(started)assert.throws(()=>store.markEffectsPossible(identity.operationId,record.prepared.requestDigest),
          (e:unknown)=>e instanceof RecoveryStoreError&&e.reason==="transition-denied");
        if(terminal){
          const before=(db.prepare("SELECT record_json FROM builder_recovery_operations").get() as {record_json:string}).record_json;
          const retry=store.recordTerminal({operationId:identity.operationId,requestDigest:record.prepared.requestDigest,outcome:"completed",evidenceDigest:digest});
          assert.equal(canonicalJson(retry),before);
        }
      }
      const effectOccurred=phase==="effect-written"||terminal;
      assert.equal(readFileSync(target,"utf8"),effectOccurred?"changed fixture\n":"original fixture\n");
      if(phase==="effect-written")assert.equal(store.listUnfinished()[0]!.terminal,null,"changed file without terminal evidence remains unresolved");
    }finally{
      if(child&&child.exitCode===null&&child.signalCode===null)child.kill("SIGKILL");
      if(closed)await closed;if(db?.open)db.close();
      const targetDirectory=resolve(directory);assert.equal(dirname(targetDirectory),parent);assert.ok(basename(targetDirectory).startsWith("onoes-recovery-crash-"));
      rmSync(targetDirectory,{recursive:true,force:true});
    }
  });
}
