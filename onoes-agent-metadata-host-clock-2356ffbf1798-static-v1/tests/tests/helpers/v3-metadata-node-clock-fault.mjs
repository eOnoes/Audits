// Test-only process: replace the sampler BEFORE module import to exercise fixed
// runtime failure handling. This seam is not exported by the runtime module.
import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
assert.equal(process.env.ONOES_METADATA_NODE_CLOCK_MOCK,'1');
const [mode]=process.argv.slice(2);assert.ok(['throw','regress','range','version','platform','arch','uv'].includes(mode));
let now=11000000000n;
process.hrtime.bigint=()=>{if(now===null)throw Error('private-counter-diagnostic');return now;};
if(mode==='version')Object.defineProperty(process,'version',{value:'v0.0.0'});
if(mode==='platform')Object.defineProperty(process,'platform',{value:'linux'});
if(mode==='arch')Object.defineProperty(process,'arch',{value:'arm64'});
if(mode==='uv')Object.defineProperty(process.versions,'uv',{value:'0.0.0'});
const {MetadataNodeHostClock:Clock,bindMetadataNodeHostClock:bind}=await import('../../scripts/windows-v3-metadata-node-clock.mjs');
const hash=(d,b)=>createHash('sha256').update(d+'\0','ascii').update(b).digest();
const wire=Buffer.alloc(128);wire.write('OMK1');wire.fill(1,4,36);wire.writeBigUInt64LE(10000000000n,36);wire.writeBigUInt64LE(1000000000n,44);
[5000,10000,15000].forEach((v,i)=>wire.writeUInt32LE(v,52+i*4));wire.fill(7,64,96);hash('onoes-metadata-host-clock-context/v1',wire.subarray(0,96)).copy(wire,96);
const ref=hash('onoes-metadata-host-clock-reference/v1',wire).toString('hex'),args=[ref,'07'.repeat(32),'01'.repeat(32),5000];
const error=/^Error: metadata-node-clock-unavailable$/;
if(['version','platform','arch','uv'].includes(mode))assert.throws(()=>new Clock(wire,...args),error);
else{
  const clock=new Clock(wire,...args),bound=bind(clock,ref,args[2],5000);assert.equal(bound.read(),1002);
  now=mode==='throw'?null:mode==='regress'?10999999999n:1n<<63n;
  assert.throws(()=>bound.read(),error);now=12000000000n;
  assert.throws(()=>clock.readElapsedMilliseconds(),error);assert.throws(()=>bound.read(),error);
}
console.log(JSON.stringify({mode,denied:true,authority:'none'}));
