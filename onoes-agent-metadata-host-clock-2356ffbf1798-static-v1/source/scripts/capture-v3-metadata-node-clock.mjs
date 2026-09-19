// Local producer evidence only: pure/fake suites and ordinary clock processes.
import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),reportPath='docs/reports/v3-metadata-node-clock-20260919';
const hash=b=>createHash('sha256').update(b).digest('hex');
const identity=path=>{const b=readFileSync(join(root,path));return {path,byteLength:b.length,sha256:hash(b)};};
const paths=['scripts','scripts/tests','tests/probes','tests/helpers'].flatMap(dir=>readdirSync(join(root,dir))
  .filter(p=>p.includes('v3-metadata')&&/\.(?:cs|mjs|ps1)$/.test(p)).map(p=>`${dir}/${p}`)).sort();
const before=paths.map(identity),startedAt=new Date().toISOString(),outputs=[],commands=[];mkdirSync(join(root,reportPath));
function run(name,args){
  const r=spawnSync(process.execPath,args,{cwd:root,windowsHide:true,shell:false,encoding:'utf8',timeout:240000,maxBuffer:16*1024*1024});
  for(const [suffix,bytes] of [['stdout',r.stdout??''],['stderr',r.stderr??'']]){
    const path=`${reportPath}/${name}.${suffix}`;writeFileSync(join(root,path),bytes,{flag:'wx'});outputs.push(identity(path));
  }
  commands.push({executable:process.execPath,args,status:r.status,signal:r.signal,error:r.error?.code??null});return r;
}
let failure=null,purePassed=false,transferPassed=false,historyPassed=false,nodeJoinPassed=false;
try{
  const pure=run('pure',['scripts/test-v3-metadata-channel.mjs']);assert.equal(pure.status,0,pure.stderr);assert.equal(pure.error,undefined);
  const lines=pure.stdout.trim().split(/\r?\n/).map(s=>JSON.parse(s));
  assert.equal(lines.length,2);assert.equal(lines[0].results.length,40);assert.equal(lines[1].results.length,33);purePassed=true;
  const compile=lines[0],receiptPin=hash(readFileSync(join(compile.output,'receipt.json')));
  const transfer=run('transfer',['scripts/test-v3-metadata-clock-transfer-process.mjs',compile.output,receiptPin]);
  assert.equal(transfer.status,0,transfer.stderr);assert.equal(transfer.error,undefined);transferPassed=true;
  const history=run('history',['scripts/test-v3-metadata-clock-history-process.mjs',compile.output,receiptPin]);
  assert.equal(history.status,0,history.stderr);assert.equal(history.error,undefined);historyPassed=true;
  const nodeJoin=run('node-join',['scripts/test-v3-metadata-node-clock-process.mjs',compile.output,receiptPin]);
  assert.equal(nodeJoin.status,0,nodeJoin.stderr);assert.equal(nodeJoin.error,undefined);nodeJoinPassed=true;
  const files=readdirSync(join(root,'scripts/tests')).filter(p=>/^v3-metadata-.*\.test\.mjs$/.test(p)).sort().map(p=>`scripts/tests/${p}`);
  const node=run('metadata',['--test','--test-reporter=tap',...files]);assert.equal(node.status,0,node.stderr);assert.equal(node.error,undefined);
  assert.deepEqual(paths.map(identity),before);
}catch(error){failure=String(error);}
const receipt={kind:'producer-node-original-clock-synthetic-only',startedAt,finishedAt:new Date().toISOString(),node:process.version,uv:process.versions.uv,arch:process.arch,platform:process.platform,
  before,inputsUnchanged:JSON.stringify(before)===JSON.stringify(paths.map(identity)),outputs,commands,succeeded:failure===null,failure,
  purePassed,transferPassed,historyPassed,nodeJoinPassed,sameHostBootAssumed:true,authenticatedChannel:false,protectedRuntimeCustodyEstablished:false,
  nativeHostLibraryLoaded:false,nativeRetentionExecuted:false,vmContact:false,privilegedSetup:false};
writeFileSync(join(root,reportPath,'execution.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({reportPath,succeeded:receipt.succeeded,inputs:before.length,inputsUnchanged:receipt.inputsUnchanged,failure}));
if(failure)process.exitCode=1;
