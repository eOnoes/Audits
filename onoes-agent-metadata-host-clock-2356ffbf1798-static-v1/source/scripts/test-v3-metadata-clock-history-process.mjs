// Local C# -> Node codec interoperability only. No native store/VM/authentication.
import assert from 'node:assert/strict';import {join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {readPinnedCompileReceipt,snapshotBuildInput,matchesBuildIdentity} from './windows-v3-metadata-build-inputs.mjs';
import {compareMetadataClockHistoricalRecords as compare} from './windows-v3-metadata-history.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),[directory,pin]=process.argv.slice(2);
assert.equal(process.argv.length,4);assert.equal(process.platform,'win32');
assert.match(directory.replaceAll('\\','/'),/\/v3-metadata-compile-[A-Za-z0-9]+$/);assert.equal(resolve(directory,'..'),resolve(root,'artifacts'));
const receipt=readPinnedCompileReceipt(directory,pin),id=receipt.results.find(r=>r.output.path==='controller-retention-tests.exe').output;
const executable=join(directory,id.path);
function check(){const b=snapshotBuildInput(executable,4194304);try{assert.ok(matchesBuildIdentity(b,id));}finally{b.fill(0);}}
check();const run=spawnSync(executable,['history-vector'],{cwd:directory,windowsHide:true,shell:false,encoding:'utf8',timeout:5000,maxBuffer:4096,
  env:{SystemRoot:'C:\\Windows',ONOES_METADATA_HISTORY_PROBE:'1'}});
assert.equal(run.error,undefined);assert.equal(run.signal,null);assert.equal(run.status,0,run.stderr);assert.equal(run.stderr,'');check();
const vector=JSON.parse(run.stdout),keys=['controllerIntent','controllerReport','watchdogIntent','watchdogTerminal'],lengths=[292,452,292,72];
assert.deepEqual(Object.keys(vector),['kind',...keys]);assert.equal(vector.kind,'synthetic-clock-history-vector');
const frames=keys.map((key,i)=>{assert.match(vector[key],new RegExp(`^[a-f0-9]{${lengths[i]*2}}$`));return Buffer.from(vector[key],'hex');});
// Fixture pins are independently specified here, not inferred from emitted bytes.
const hex=n=>n.toString(16).padStart(2,'0').repeat(32),pins=[hex(8),'032b6d91586a06256d52cdb7c1ae3d85a2521dc90037bd0af6323842f993fb46',hex(7),hex(1),hex(9),hex(2),hex(0x33),25000];
const result=compare(...frames,...pins);assert.equal(result.controller.claims.failure,'provision');assert.equal(result.watchdog.claims.stopWithinBudget,true);
assert.equal(result.sharedClockBoundByWire,true);assert.equal(result.mayDispatch,false);assert.equal(result.requiresReconciliation,true);
let mutations=0;
for(let field=0;field<4;field++)for(let at=0;at<frames[field].length;at++){
  const altered=frames.map(b=>Buffer.from(b));altered[field][at]^=1;
  assert.throws(()=>compare(...altered,...pins),/^Error: metadata-history-invalid$/);mutations++;
}
for(let i=0;i<7;i++){const changed=[...pins];changed[i]=hex(17);assert.throws(()=>compare(...frames,...changed),/^Error: metadata-history-invalid$/);}
console.log(JSON.stringify({kind:'producer-csharp-node-clock-history-interoperability',executable:id,args:['history-vector'],
  rawStdoutSha256:createHash('sha256').update(run.stdout).digest('hex'),vector,result,mutations,independentPinMismatches:7,
  nativeMetadataExecuted:false,vmContact:false,authenticationEstablished:false,authority:'none'}));
