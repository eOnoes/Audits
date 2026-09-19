import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';import {once} from 'node:events';import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {MetadataNodeClockState as State} from '../windows-v3-metadata-node-clock-policy.mjs';
import {MetadataNodeHostClock as Clock,bindMetadataNodeHostClock as bind} from '../windows-v3-metadata-node-clock.mjs';
import {MetadataWatchdogArmWindow as Arm} from '../windows-v3-metadata-arm.mjs';
import {MetadataWatchdogSession as Session} from '../windows-v3-metadata-session.mjs';
import {MetadataBootstrapReportSession as Report} from '../windows-v3-metadata-report-session.mjs';
const max=(1n<<63n)-1n,ms=1000000n,second=1000000000n;
const hash=(d,b)=>createHash('sha256').update(d+'\0','ascii').update(b).digest();
const seal=b=>{hash('onoes-metadata-host-clock-context/v1',b.subarray(0,96)).copy(b,96);return b;};
const reference=b=>hash('onoes-metadata-host-clock-reference/v1',b).toString('hex');
const unavailable=/^Error: metadata-node-clock-unavailable$/;
const runtimeTest=(name,fn)=>test(name,{skip:process.platform!=='win32'||process.arch!=='x64'||process.version!=='v24.14.0'||process.versions.uv!=='1.51.0'},fn);
// Synthetic origin/pins only; not an authenticated C# context. Actual C# output
// is exercised separately by test-v3-metadata-node-clock-process.mjs.
function context(age=1000,work=5000,nonce='aa'.repeat(32)){
  const b=Buffer.alloc(128);b.write('OMK1');Buffer.from(nonce,'hex').copy(b,4);
  b.writeBigUInt64LE(process.hrtime.bigint()-BigInt(age)*ms,36);b.writeBigUInt64LE(second,44);
  [work,work+5000,work+10000].forEach((v,i)=>b.writeUInt32LE(v,52+i*4));b.fill(7,64,96);seal(b);
  return {b,args:[reference(b),'07'.repeat(32),nonce,work],pins:{inventoryDigest:'1'.repeat(64),runNonce:nonce,bundleDigest:'b'.repeat(64),fixtureDigest:'33'.repeat(32),workMs:work,clockReference:reference(b),intentReference:'d'.repeat(64)}};
}
const receive=c=>new Clock(c.b,...c.args);

test('QPC integer domain, budget and conversion range reject before sampling',()=>{
  for(const bad of [0n,-1n,max+1n,1,NaN,null,undefined,{}]){
    assert.throws(()=>new State(bad,second,5000),unavailable);assert.throws(()=>new State(second,bad,5000),unavailable);
  }
  for(const bad of [0,-1,25001,1.5,NaN,Infinity,'1'])assert.throws(()=>new State(second,second,bad),unavailable);
  assert.throws(()=>new State(max,1n,5000),unavailable);
});
test('one original epoch with upward rounding and expiry leaves stop/retention available',()=>{
  const s=new State(10n*second,second,1000);
  assert.equal(s.observe(10n*second+100n*ms),102);
  const elapsed=s.observe(11n*second);assert.equal(elapsed,1002);
  assert.throws(()=>s.requireBefore(elapsed,1000),/expired/);s.requireBefore(elapsed,6000);
  assert.equal(s.observe(12n*second),2002);assert.equal(s.observe(max),35000);
  assert.throws(()=>s.requireBefore(35000,11000),/expired/);
});
test('bad, future, uncertain or regressing samples latch without recovery/reset',()=>{
  for(const bad of [0n,-1n,max+1n,1,NaN,null,undefined,{},10n*second,10n*second+ms]){
    const s=new State(10n*second,second,5000);assert.throws(()=>s.observe(bad),unavailable);
    assert.throws(()=>s.observe(11n*second),unavailable);
  }
  const s=new State(10n*second,second,5000);s.observe(11n*second);assert.throws(()=>s.observe(11n*second-1n),unavailable);assert.throws(()=>s.observe(12n*second),unavailable);
});
test('invalid deadlines and explicit invalidation latch; exact deadline expires',()=>{
  for(const bad of [0,15001,1.5,NaN,Infinity,'5000']){const s=new State(second,second,5000);assert.throws(()=>s.requireBefore(100,bad),unavailable);assert.throws(()=>s.observe(2n*second),unavailable);}
  const s=new State(second,second,5000);s.requireBefore(4999,5000);assert.throws(()=>s.requireBefore(5000,5000),/expired/);s.invalidate();assert.throws(()=>s.observe(2n*second),unavailable);
});
test('conservative Node conversion dominates exact tick oracle across exponent/frequency cases',t=>{
  let checked=0;
  for(const frequency of [1n,3n,32768n,1000000n,10000000n,24000000n,1000000000n,3000000001n,max])
    for(let exponent=37n;exponent<=62n;exponent++)for(const offset of [-1n,0n,1n,12345n])for(const age of [2000n,5001n,24990n]){
      const ticks=(((1n<<exponent)+offset)*frequency)/second,origin=ticks-age*frequency/1000n;
      if(origin<=0n||ticks>max)continue;
      const sample=BigInt(Math.trunc(Number(ticks)/(Number(frequency)/1e9)));
      if(sample>max)continue;
      const exactNs=ticks*second/frequency,error=sample>exactNs?sample-exactNs:exactNs-sample;
      assert.ok(error<ms);
      const actual=new State(origin,frequency,25000).observe(sample),oracle=(ticks-origin+1n)*1000n/frequency;
      assert.ok(BigInt(actual)>=oracle,`${frequency}/${exponent}/${offset}/${age}`);checked++;
    }
  assert.ok(checked>1500,`checked=${checked}`);t.diagnostic(`exact tick oracle cases: ${checked}`);
});

runtimeTest('runtime wire is exact, pinned, immutable and copied without calling hooks',()=>{
  const c=context(),clock=receive(c),r=bind(clock,...[c.pins.clockReference,c.pins.runNonce,c.pins.workMs]);
  assert.ok(Object.isFrozen(clock));assert.ok(Object.isFrozen(Clock.prototype));assert.equal(r.startedAtMs,0);
  c.b.fill(0);assert.ok(clock.readElapsedMilliseconds()>=1000);assert.ok(r.read()>=1000);
  assert.throws(()=>{clock.readElapsedMilliseconds=()=>0;},TypeError);
  const d=context();Object.defineProperty(d.b,'byteLength',{get(){throw Error('hook');}});receive(d);
  let calls=0;const p=new Proxy(context().b,{get(){calls++;throw Error('hook');}});
  assert.throws(()=>new Clock(p,...d.args),unavailable);assert.equal(calls,0);
});
runtimeTest('all OMK1 byte mutations, lengths and unsupported buffers deny',()=>{
  const c=context();for(let i=0;i<128;i++){const b=Buffer.from(c.b);b[i]^=1;assert.throws(()=>new Clock(b,...c.args),unavailable);}
  for(let n=0;n<=129;n++)if(n!==128)assert.throws(()=>new Clock(Buffer.alloc(n),...c.args),unavailable);
  for(const b of [new Uint8Array(new SharedArrayBuffer(128)),new DataView(c.b.buffer),{},null])assert.throws(()=>new Clock(b,...c.args),unavailable);
  const detached=new Uint8Array(128);structuredClone(detached.buffer,{transfer:[detached.buffer]});assert.throws(()=>new Clock(detached,...c.args),unavailable);
});
runtimeTest('coherent rewrites do not substitute independent pins or repair invalid domains',()=>{
  const c=context();for(const at of [4,36,44,52,56,60,64]){const b=Buffer.from(c.b);b[at]^=1;seal(b);assert.throws(()=>new Clock(b,...c.args),unavailable);}
  for(const edit of [b=>b.writeBigUInt64LE(0n,36),b=>b.writeBigUInt64LE(max+1n,36),b=>b.writeBigUInt64LE(0n,44),b=>b.writeBigUInt64LE(max+1n,44),b=>b.writeUInt32LE(1,56),b=>b.writeUInt32LE(1,60)]){
    const b=Buffer.from(c.b);edit(b);seal(b);assert.throws(()=>new Clock(b,reference(b),...c.args.slice(1)),unavailable);
  }
  for(let i=0;i<3;i++)for(const bad of [null,{},'0'.repeat(64),'A'.repeat(64),'f'.repeat(64)]){const args=[...c.args];args[i]=bad;assert.throws(()=>new Clock(c.b,...args),unavailable);}
  assert.throws(()=>receive(context(6000,5000)),unavailable);assert.throws(()=>receive(context(-1000,5000)),unavailable);
});
runtimeTest('only the privately branded clock binds; mismatches poison existing bindings',()=>{
  for(const value of [{readElapsedMilliseconds:()=>0},Object.create(Clock.prototype),null,new Proxy(receive(context()),{})])assert.throws(()=>bind(value,'c'.repeat(64),'a'.repeat(64),5000),unavailable);
  class Fake extends Clock{}const c=context();assert.throws(()=>new Fake(c.b,...c.args),unavailable);
  for(const field of [0,1,2]){
    const clock=receive(c),args=[c.pins.clockReference,c.pins.runNonce,c.pins.workMs],bound=bind(clock,...args);args[field]=field===2?5001:'f'.repeat(64);
    assert.throws(()=>bind(clock,...args),unavailable);assert.throws(()=>bound.read(),unavailable);assert.throws(()=>clock.readElapsedMilliseconds(),unavailable);
  }
});
runtimeTest('binding captures sampler and does not invoke a substituted public hrtime property',()=>{
  const c=context(),saved=process.hrtime.bigint;
  try{process.hrtime.bigint=()=>{throw Error('caller-hook');};assert.ok(receive(c).readElapsedMilliseconds()>=1000);}finally{process.hrtime.bigint=saved;}
});
runtimeTest('elapsed persists across delay and constructor recreation',async()=>{
  const c=context(),a=receive(c),first=a.readElapsedMilliseconds();await delay(25);
  const b=receive(c);assert.ok(b.readElapsedMilliseconds()>=first+20);assert.ok(a.readElapsedMilliseconds()>=first+20);
});
for(const mode of ['throw','regress','range','version','platform','arch','uv'])runtimeTest(`isolated runtime ${mode} denies without diagnostic leakage`,()=>{
  const fixture=fileURLToPath(new URL('../../tests/helpers/v3-metadata-node-clock-fault.mjs',import.meta.url));
  const r=spawnSync(process.execPath,[fixture,mode],{windowsHide:true,shell:false,encoding:'utf8',timeout:5000,maxBuffer:4096,
    env:{SystemRoot:process.env.SystemRoot,ONOES_METADATA_NODE_CLOCK_MOCK:'1'}});
  assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');assert.deepEqual(JSON.parse(r.stdout),{mode,denied:true,authority:'none'});
});

function child(t,leaf,args,env){
  const p=spawn(process.execPath,[fileURLToPath(new URL('../../tests/helpers/'+leaf,import.meta.url)),...args],{windowsHide:true,shell:false,stdio:['pipe','pipe','pipe'],env:{SystemRoot:process.env.SystemRoot,...env}});
  const closed=once(p,'close');let ended=false,stderr='';closed.then(()=>{ended=true;});p.stderr.on('data',b=>{stderr+=b;});
  t.after(async()=>{if(!ended){p.stdin.end();const timer=setTimeout(()=>p.kill(),1000);try{await closed;}finally{clearTimeout(timer);}}assert.equal(stderr,'');});
  return p;
}
runtimeTest('original host age is charged to real-child ARM and one claim',async t=>{
  const c=context(),arm=Arm.fromHostClock(c.pins,receive(c));t.after(()=>arm.close());
  const p=child(t,'v3-metadata-arm-child.mjs',['normal','5000',c.pins.clockReference],{ONOES_METADATA_WATCHDOG_MOCK:'1'});
  arm.attach(p);await arm.waitForArm();const claim=arm.claimDispatch();assert.ok(claim.remainingMs<=4000&&claim.remainingMs>0);assert.equal(claim.authority,'none');
});
runtimeTest('original host age survives watchdog ARM, EOF, report and child close',async t=>{
  const c=context(),session=Session.fromHostClock(c.pins,receive(c));t.after(()=>session.requestStop());
  session.attach(child(t,'v3-metadata-report-child.mjs',['normal','5000',c.pins.clockReference],{ONOES_METADATA_WATCHDOG_MOCK:'1'}));
  await session.waitForArm();assert.ok(session.claimDispatch().remainingMs<=4000);session.requestStop();
  const result=await session.waitForObservation();assert.equal(result.status,'reported');assert.ok(result.elapsedMs>=1000);assert.equal(result.authority,'none');
});
runtimeTest('original clock bounds bootstrap report collection and exact one-use handoff',async t=>{
  const c=context(1000,5000,'01'.repeat(32));c.pins.bundleDigest='02'.repeat(32);
  const session=Report.fromHostClock(c.pins,receive(c),{retainReportWire:true});t.after(()=>session.cancel());
  const p=child(t,'v3-metadata-bootstrap-report-child.mjs',['normal'],{ONOES_METADATA_BOOTSTRAP_MOCK:'1'});session.attach(p);p.stdin.write('report');
  const result=await session.waitForObservation();assert.equal(result.status,'reported');assert.ok(result.elapsedMs>=1000);assert.equal(result.authority,'none');
  assert.equal(session.takeCheckedReportWire().length,384);assert.throws(()=>session.takeCheckedReportWire(),/unavailable/);
});
test('explicit original start never adds received age back to arm or session deadlines',async()=>{
  const pins=context().pins;
  for(const Class of [Arm,Session])assert.throws(()=>new Class(pins,()=>5000,0),/unavailable/);
  const session=new Session(pins,()=>1000,0);session.requestStop();const result=await session.waitForObservation();assert.equal(result.elapsedMs,1000);
  assert.throws(()=>new Report(pins,{startedAtMs:0,observationMs:10000},()=>10000),/unavailable/);
});
test('original-start ARM timer uses remaining time even with a frozen synthetic clock',async()=>{
  const pins=context().pins,arm=new Arm(pins,()=>4950,0);
  // Timer expiry closes the gate at ~50ms, not a renewed 5000ms. attach then
  // rejects on #closed before looking at this hostile child-shaped sentinel.
  await delay(90);let touched=false;
  const p=new Proxy({},{get(){touched=true;throw Error('child-hook');}});
  assert.throws(()=>arm.attach(p),/unavailable/);assert.equal(touched,false);
});
test('original-start watchdog observation timer does not renew pre-constructor time',async()=>{
  const pins=context().pins,session=new Session(pins,()=>4900,0);
  // observation ends at original 10000: 5100ms left instead of a renewed 10000.
  // No child is launched; do not call waitForObservation until timer fires.
  await delay(5200);const result=await session.waitForObservation();
  assert.equal(result.reason,'observation-timeout');assert.equal(result.rootCloseObserved,false);
});
