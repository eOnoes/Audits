// Local cross-process clock experiment only. No native metadata, VM or network.
// Command-line pins are SYNTHETIC test transport, never production authentication.
import assert from 'node:assert/strict';import {join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {readPinnedCompileReceipt,snapshotBuildInput,matchesBuildIdentity} from './windows-v3-metadata-build-inputs.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),[directory,pin]=process.argv.slice(2);
assert.equal(process.argv.length,4);assert.equal(process.platform,'win32');
// Only a just-compiled fixed test target under this product's artifact directory.
const base=resolve(root,'artifacts');assert.match(directory.replaceAll('\\','/'),/\/v3-metadata-compile-[A-Za-z0-9]+$/);
assert.equal(resolve(directory,'..'),base);
const receipt=readPinnedCompileReceipt(directory,pin),id=receipt.results.find(r=>r.output.path==='host-clock-context-tests.exe').output;
const executable=join(directory,id.path),commands=[];
function run(args){
  const bytes=snapshotBuildInput(executable,4194304);try{assert.ok(matchesBuildIdentity(bytes,id));}finally{bytes.fill(0);}
  const r=spawnSync(executable,args,{cwd:directory,windowsHide:true,shell:false,encoding:'utf8',timeout:5000,maxBuffer:4096,
    env:{SystemRoot:'C:\\Windows',ONOES_METADATA_CLOCK_PROBE:'1'}});
  assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');
  const after=snapshotBuildInput(executable,4194304);try{assert.ok(matchesBuildIdentity(after,id));}finally{after.fill(0);}
  const result=JSON.parse(r.stdout);commands.push({args,result});return result;
}
const hash=(domain,b)=>createHash('sha256').update(domain+'\0','ascii').update(b).digest();
const rehash=b=>hash('onoes-metadata-host-clock-context/v1',b.subarray(0,96)).copy(b,96);
const reference=b=>hash('onoes-metadata-host-clock-reference/v1',b).toString('hex');
function checkWire(record){
  assert.match(record.wire,/^[a-f0-9]{256}$/);assert.match(record.reference,/^[a-f0-9]{64}$/);
  const b=Buffer.from(record.wire,'hex');assert.equal(b.subarray(0,4).toString('ascii'),'OMK1');
  assert.deepEqual(b.subarray(4,36),Buffer.alloc(32,1));assert.deepEqual(b.subarray(64,96),Buffer.alloc(32,7));
  assert.equal(b.readUInt32LE(52),25000);assert.equal(b.readUInt32LE(56),30000);assert.equal(b.readUInt32LE(60),35000);
  assert.deepEqual(b.subarray(96),hash('onoes-metadata-host-clock-context/v1',b.subarray(0,96)));
  assert.equal(record.reference,reference(b));return b;
}
const vector=run(['vector']),v=checkWire(vector);assert.equal(v.readBigUInt64LE(36),123456789012345678n);assert.equal(v.readBigUInt64LE(44),10000000n);
const start=run(['capture']),wire=checkWire(start),origin=wire.readBigUInt64LE(36),frequency=wire.readBigUInt64LE(44);
await delay(125); // deliberate test-only elapsed startup time, never a production synchronization primitive
const received=run(['receive',start.wire,start.reference]);assert.equal(received.accepted,true);
assert.equal(BigInt(received.origin),origin);assert.equal(BigInt(received.frequency),frequency);assert.ok(received.elapsed>=125);
assert.ok(Number.isSafeInteger(received.elapsed));
const lower=((BigInt(received.before)-origin+1n)*1000n)/frequency,upper=((BigInt(received.after)-origin+1n)*1000n)/frequency;
assert.ok(BigInt(received.elapsed)>=lower && BigInt(received.elapsed)<=upper);
// A coherently rehashed edit still fails the independently retained reference.
for(const offset of [4,36,44,64]){
  const changed=Buffer.from(wire);changed[offset]^=1;rehash(changed);
  assert.deepEqual(run(['receive',changed.toString('hex'),start.reference]),{accepted:false});
}
// Even a new expected reference cannot make unsupported runtime state live.
for(const [name,edit] of [
  ['frequency',b=>b.writeBigUInt64LE(frequency+1n,44)],
  ['future',b=>b.writeBigUInt64LE(0x7fffffffffffffffn,36)],
  ['expired',b=>{assert.ok(origin>frequency*30n);b.writeBigUInt64LE(origin-frequency*30n,36);}]
]){
  const changed=Buffer.from(wire);edit(changed);rehash(changed);
  assert.deepEqual(run(['receive',changed.toString('hex'),reference(changed)]),{accepted:false},name);
}
console.log(JSON.stringify({kind:'producer-local-clock-transfer-not-authenticated-channel',executable:id,commands,
  preservedOrigin:true,elapsedIncludesStartup:true,independentBigIntBounds:{lower:lower.toString(),upper:upper.toString()},
  authenticatedChannel:false,nativeMetadataExecuted:false,vmContact:false,authority:'none'}));
