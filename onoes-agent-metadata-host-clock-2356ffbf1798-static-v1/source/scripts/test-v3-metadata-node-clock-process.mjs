// Actual C# QPC -> pinned Node timer experiment, ordinary local processes ONLY.
// Synthetic public pins over stdout are NOT an authenticated launch channel.
import assert from 'node:assert/strict';import {join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {readPinnedCompileReceipt,snapshotBuildInput,matchesBuildIdentity} from './windows-v3-metadata-build-inputs.mjs';
import {MetadataNodeHostClock as Clock,bindMetadataNodeHostClock as bind} from './windows-v3-metadata-node-clock.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),[directory,pin]=process.argv.slice(2);
assert.equal(process.argv.length,4);assert.equal(process.platform,'win32');assert.equal(process.version,'v24.14.0');assert.equal(process.versions.uv,'1.51.0');assert.equal(process.arch,'x64');
assert.match(directory.replaceAll('\\','/'),/\/v3-metadata-compile-[A-Za-z0-9]+$/);assert.equal(resolve(directory,'..'),resolve(root,'artifacts'));
const receipt=readPinnedCompileReceipt(directory,pin),id=receipt.results.find(r=>r.output.path==='host-clock-context-tests.exe').output;
const executable=join(directory,id.path),commands=[];
function check(){const b=snapshotBuildInput(executable,4194304);try{assert.ok(matchesBuildIdentity(b,id));}finally{b.fill(0);}}
function run(args){
  check();const before=process.hrtime.bigint();
  const r=spawnSync(executable,args,{cwd:directory,windowsHide:true,shell:false,encoding:'utf8',timeout:5000,maxBuffer:4096,
    env:{SystemRoot:'C:\\Windows',ONOES_METADATA_CLOCK_PROBE:'1'}});
  const after=process.hrtime.bigint();assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');check();
  const result=JSON.parse(r.stdout);commands.push({args,result,nodeBeforeNs:before.toString(),nodeAfterNs:after.toString()});return {result,before,after};
}
const {result:c,before,after}=run(['capture']),wire=Buffer.from(c.wire,'hex');
assert.equal(wire.length,128);const origin=wire.readBigUInt64LE(36),frequency=wire.readBigUInt64LE(44),originNs=origin*1000000000n/frequency;
assert.ok(originNs>=before-1000000n&&originNs<=after+1000000n);
await delay(125);
const args=[c.reference,'07'.repeat(32),'01'.repeat(32),25000],clock=new Clock(wire,...args),bound=bind(clock,c.reference,args[2],25000);
assert.equal(bound.startedAtMs,0);const nodeElapsedBefore=bound.read();assert.ok(nodeElapsedBefore>=125);
const native=run(['receive',c.wire,c.reference]).result;assert.equal(native.accepted,true);
const nodeElapsedAfter=bound.read();assert.ok(nodeElapsedAfter>=native.elapsed);assert.ok(native.elapsed>=nodeElapsedBefore-3);
await delay(25);const recreated=new Clock(wire,...args);assert.ok(recreated.readElapsedMilliseconds()>=nodeElapsedAfter+20);
const h=(d,b)=>createHash('sha256').update(d+'\0','ascii').update(b).digest();
const rehash=b=>h('onoes-metadata-host-clock-context/v1',b.subarray(0,96)).copy(b,96);
for(const at of [4,36,44,52,64]){const b=Buffer.from(wire);b[at]^=1;rehash(b);assert.throws(()=>new Clock(b,...args),/metadata-node-clock-unavailable/);}
for(const edit of [b=>b.writeBigUInt64LE((1n<<63n)-1n,36),b=>b.writeBigUInt64LE(origin-frequency*30n,36)]){
  const b=Buffer.from(wire);edit(b);rehash(b);const ref=h('onoes-metadata-host-clock-reference/v1',b).toString('hex');assert.throws(()=>new Clock(b,ref,...args.slice(1)),/metadata-node-clock-unavailable/);
}
console.log(JSON.stringify({kind:'producer-local-csharp-node-original-clock-join',node:process.version,uv:process.versions.uv,arch:process.arch,executable:id,commands,
  nodeElapsedBefore,nativeElapsed:native.elapsed,nodeElapsedAfter,elapsedIncludesStartup:true,recreationPreservesOrigin:true,
  sameHostBootAssumed:true,clockAuthenticationEstablished:false,protectedRuntimeCustodyEstablished:false,nativeMetadataExecuted:false,vmContact:false,authority:'none'}));
