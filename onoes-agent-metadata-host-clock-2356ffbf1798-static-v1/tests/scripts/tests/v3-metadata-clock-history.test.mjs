import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {compareMetadataClockHistoricalRecords as compare,compareMetadataHistoricalRecords as legacy} from '../windows-v3-metadata-history.mjs';
const hex=n=>n.toString(16).padStart(2,'0').repeat(32);
const h=(d,b)=>createHash('sha256').update(d+'\0','ascii').update(b).digest();
const seals=[[260,'onoes-metadata-controller-intent/v2'],[420,'onoes-metadata-controller-report/v2'],[260,'onoes-metadata-watchdog-intent/v2'],[40,'onoes-metadata-watchdog-terminal/v2']];
const seal=(b,at,d)=>{h(d,b.subarray(0,at)).copy(b,at);return b;};
const contextReference='032b6d91586a06256d52cdb7c1ae3d85a2521dc90037bd0af6323842f993fb46';
const pins=[hex(8),contextReference,hex(7),hex(1),hex(9),hex(2),hex(0x33)];
function frames(){
  const clock=Buffer.alloc(128);clock.write('OMK1');clock.fill(1,4,36);clock.writeBigUInt64LE(123456789012345678n,36);clock.writeBigUInt64LE(10000000n,44);
  [25000,30000,35000].forEach((v,i)=>clock.writeUInt32LE(v,52+i*4));clock.fill(7,64,96);seal(clock,96,'onoes-metadata-host-clock-context/v1');
  const c=Buffer.alloc(292),w=Buffer.alloc(292);c.write('OMH2');w.write('OMW2');
  for(const i of [c,w]){[8,9,2,0x33].forEach((n,at)=>i.fill(n,4+32*at,36+32*at));clock.copy(i,132);}
  seal(c,...seals[0]);seal(w,...seals[2]);
  const raw=Buffer.alloc(384);raw.write('OMB1');raw.set([1,0,1,1],4);raw.writeUInt32LE(12,8);
  h('onoes-metadata-report-run/v1',Buffer.alloc(32,1)).copy(raw,32);raw.fill(2,64,96);raw.fill(0x33,96,128);seal(raw,352,'onoes-metadata-bootstrap-report/v1');
  const b=Buffer.alloc(452);b.write('OHR2');h('onoes-metadata-controller-intent-reference/v2',c).copy(b,4);raw.copy(b,36);seal(b,...seals[1]);
  const t=Buffer.alloc(72);t.write('OWT2');h('onoes-metadata-watchdog-intent-reference/v2',w).copy(t,4);t[36]=2;t[37]=31;seal(t,...seals[3]);
  return[c,b,w,t];
}
const read=(f=frames(),p=pins,work=25000)=>compare(...f,...p,work);
const deny=fn=>assert.throws(fn,e=>e instanceof Error&&e.message==='metadata-history-invalid');
function noAuthority(r){
  assert.equal(r.authority,'none');assert.equal(r.requiresReconciliation,true);
  for(const key of ['protectedRootCustodyEstablished','clockProvenanceEstablished','atomicSnapshotEstablished','freshnessEstablished',
    'durableEvidenceRetained','controllerDispatchClosed','guestStopProven','verificationEvidence','mayDispatch'])assert.equal(r[key],false,key);
  for(const key of ['controllerRootBoundByWire','watchdogRootBoundByWire','sharedClockBoundByWire'])assert.equal(r[key],true,key);
}
function rebind(f){
  for(const at of [0,2]){seal(f[at].subarray(132,260),96,'onoes-metadata-host-clock-context/v1');seal(f[at],...seals[at]);}
  h('onoes-metadata-controller-intent-reference/v2',f[0]).copy(f[1],4);seal(f[1],...seals[1]);
  h('onoes-metadata-watchdog-intent-reference/v2',f[2]).copy(f[3],4);seal(f[3],...seals[3]);
}
test('V2 shared root/clock is structural agreement, never reconciliation or stop proof',()=>{
  const f=frames(),r=read(f);noAuthority(r);assert.equal(r.controller.claims.failure,'provision');assert.equal(r.watchdog.claims.stopWithinBudget,true);
  assert.equal(r.status,'both-reports-recorded-claims');assert.equal(r.clockContextReference,contextReference);
  assert.equal(JSON.stringify(r).includes(hex(1)),false);assert.equal(JSON.stringify(r).includes(hex(7)),false);
  function frozen(o){if(o&&typeof o==='object'){assert.ok(Object.isFrozen(o));for(const x of Object.values(o))frozen(x);}}frozen(r);
  const saved=JSON.stringify(r);for(const b of f)b.fill(0);assert.equal(JSON.stringify(r),saved);
});
for(const b of [false,true])for(const t of [false,true])test(`V2 optional reports b=${b} t=${t} do not create missing evidence`,()=>{
  const f=frames();if(!b)f[1]=null;if(!t)f[3]=null;const r=read(f);noAuthority(r);
  assert.equal(r.controller.claims===null,!b);assert.equal(r.watchdog.claims===null,!t);assert.equal(r.status,b&&t?'both-reports-recorded-claims':'incomplete-recorded-claims');
});
test('all 1108 byte mutations and every short/oversized record deny',()=>{
  for(let field=0;field<4;field++){
    const n=frames()[field].length;
    for(let i=0;i<n;i++){const f=frames();f[field][i]^=1;deny(()=>read(f));}
    for(let len=0;len<=n+1;len++)if(len!==n){const f=frames();f[field]=Buffer.alloc(len);deny(()=>read(f));}
  }
});
test('V2 independent pins and budget are mandatory, primitive, nonzero and exact',()=>{
  for(let i=0;i<pins.length;i++)for(const v of [undefined,null,{},1,'0'.repeat(64),'A'.repeat(64),'f'.repeat(63),hex(17)]){
    const p=[...pins];p[i]=v;deny(()=>read(frames(),p));
  }
  for(const v of [undefined,null,'25000',0,-1,1.5,25001,NaN,Infinity,24999])deny(()=>compare(...frames(),...pins,v));
});
test('coherent record rewrites and clock substitutions cannot defeat independent pins',()=>{
  for(const side of [0,2])for(const at of [4,36,68,100,136,168,176,184,188,192,196]){
    const f=frames();f[side][at]^=1;rebind(f);deny(()=>read(f));
  }
  for(const at of [136,168,176,184,188,192,196]){
    const f=frames();f[0][at]^=1;f[2][at]^=1;rebind(f);deny(()=>read(f));
  }
});
test('even independently repinned clock framing requires positive signed counters and exact deadlines',()=>{
  for(const offset of [36,44])for(const value of [0n,1n<<63n,(1n<<64n)-1n]){
    const f=frames();for(const side of [0,2])f[side].writeBigUInt64LE(value,132+offset);rebind(f);
    const p=[...pins];p[1]=h('onoes-metadata-host-clock-reference/v1',f[0].subarray(132,260)).toString('hex');deny(()=>read(f,p));
  }
  for(const offset of [56,60]){const f=frames();for(const side of [0,2])f[side].writeUInt32LE(1,132+offset);rebind(f);
    const p=[...pins];p[1]=h('onoes-metadata-host-clock-reference/v1',f[0].subarray(132,260)).toString('hex');deny(()=>read(f,p));}
});
test('role swap, legacy framing, missing required intents and non-null report sentinels deny',()=>{
  for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){const f=frames();[f[i],f[j]]=[f[j],f[i]];deny(()=>read(f));}
  for(const at of [0,2])for(const value of [null,undefined,Buffer.alloc(164),Buffer.alloc(208)]){const f=frames();f[at]=value;deny(()=>read(f));}
  for(const at of [1,3])for(const value of [undefined,{},'',new Error('private'),Buffer.alloc(384)]){const f=frames();f[at]=value;deny(()=>read(f));}
  deny(()=>legacy(...frames(),hex(8),hex(1),hex(9),hex(2),hex(0x33),25000));
});
test('V2 shared/exotic/detached/proxy views deny without executing property hooks',()=>{
  let calls=0;
  for(let field=0;field<4;field++){
    const f=frames(),n=f[field].length;
    for(const k of ['buffer','byteOffset','byteLength','length','constructor'])Object.defineProperty(f[field],k,{get(){calls++;throw Error('private');}});
    f[field][Symbol.iterator]=()=>{calls++;throw Error('private');};noAuthority(read(f));
    const detached=new Uint8Array(n);structuredClone(detached.buffer,{transfer:[detached.buffer]});
    for(const v of [new Proxy(frames()[field],{get(){calls++;throw Error('private');}}),new Uint8Array(new SharedArrayBuffer(n)),new DataView(new ArrayBuffer(n)),new Uint16Array(n/2),detached]){
      const f=frames();f[field]=v;deny(()=>read(f));
    }
    const shifted=frames(),large=new Uint8Array(n+16);large.set(shifted[field],8);shifted[field]=large.subarray(8,n+8);noAuthority(read(shifted));
  }
  assert.equal(calls,0);
});
test('V2 terminal claim combinations remain claims and rehashed malformed envelopes fail',()=>{
  for(let trigger=0;trigger<7;trigger++)for(let flags=0;flags<34;flags++){
    const f=frames();f[3][36]=trigger;f[3][37]=flags;seal(f[3],...seals[3]);
    const valid=trigger<=4&&flags<=31&&Boolean(flags&1)===(trigger!==0)&&(!(flags&16)||(flags&12)===12);
    if(valid)noAuthority(read(f));else deny(()=>read(f));
  }
  for(const field of [1,3])for(const offset of field===1?[0,4,36,100]:[0,4,38,39]){
    const f=frames();f[field][offset]^=1;seal(f[field],...seals[field]);deny(()=>read(f));
  }
});
test('narrow historical budgets require repinned exact context and never sample present time',()=>{
  for(const work of [1,1000,24999,25000]){
    const f=frames();for(const side of [0,2])for(const [index,n] of [work,work+5000,work+10000].entries())f[side].writeUInt32LE(n,184+4*index);
    rebind(f);const p=[...pins];p[1]=h('onoes-metadata-host-clock-reference/v1',f[0].subarray(132,260)).toString('hex');
    const r=read(f,p,work);assert.equal(r.workMs,work);noAuthority(r);
  }
});
test('rehashing nested bootstrap bindings cannot launder a different run or artifact',()=>{
  for(const offset of [32,64,96]){
    const f=frames(),raw=f[1].subarray(36,420);raw[offset]^=1;seal(raw,352,'onoes-metadata-bootstrap-report/v1');seal(f[1],...seals[1]);deny(()=>read(f));
  }
});
