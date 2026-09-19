import assert from 'node:assert/strict';import test from 'node:test';import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';import {once} from 'node:events';import {fileURLToPath} from 'node:url';import {readFileSync} from 'node:fs';
import {MetadataBootstrapReportSession} from '../windows-v3-metadata-report-session.mjs';
const pins={runNonce:'01'.repeat(32),bundleDigest:'02'.repeat(32),fixtureDigest:'33'.repeat(32)};
const fixture=fileURLToPath(new URL('../../tests/helpers/v3-metadata-bootstrap-report-child.mjs',import.meta.url));
const unavailable=/metadata-report-session-unavailable/;
function launch(t,mode,{clock=()=>performance.now(),startedAtMs=clock(),observationMs=2500,retainReportWire=false}={}){
  const session=new MetadataBootstrapReportSession(pins,{startedAtMs,observationMs,retainReportWire},clock);
  const child=spawn(process.execPath,[fixture,mode],{windowsHide:true,shell:false,stdio:['pipe','pipe','pipe'],env:{SystemRoot:process.env.SystemRoot,ONOES_METADATA_BOOTSTRAP_MOCK:'1'}});
  let closed=false;const end=once(child,'close');end.then(()=>{closed=true;});
  t.after(async()=>{session.cancel();if(!closed){child.kill();await end;}});session.attach(child);
  return {session,child,end,send:()=>child.stdin.write('report')};
}
test('collector has fixed byte/chunk caps and no process/VM/file effects',()=>{
  const s=readFileSync(new URL('../windows-v3-metadata-report-session.mjs',import.meta.url),'utf8');
  assert.match(s,/Buffer.alloc\(384\)/);assert.match(s,/\+\+this.#chunks>128/);assert.match(s,/this.#length\+chunk.length>384/);
  assert.doesNotMatch(s,/\b(?:spawn|execFile|kill|writeFile|Stop-VM|Invoke-Command)\s*\(/);
});
test('opt-in handoff returns exact observed bytes once without promoting evidence',async t=>{
  const {session,child,send}=launch(t,'fragmented',{retainReportWire:true});const chunks=[];
  child.stdout.on('data',b=>chunks.push(Buffer.from(b)));send();const observation=await session.waitForObservation();
  const wire=session.takeCheckedReportWire();assert.equal(wire.length,384);assert.deepEqual(wire,Buffer.concat(chunks));
  assert.throws(()=>session.takeCheckedReportWire(),unavailable);wire.fill(0);
  assert.equal(observation.claims.failure,'provision');assert.equal(observation.durableEvidenceRetained,false);assert.equal(observation.authority,'none');
});
test('wire handoff is disabled by default',async t=>{
  const {session,send}=launch(t,'normal');send();await session.waitForObservation();assert.throws(()=>session.takeCheckedReportWire(),unavailable);
});
test('premature wire request cannot retry after transport close',async t=>{
  const {session,send}=launch(t,'normal',{retainReportWire:true});assert.throws(()=>session.takeCheckedReportWire(),unavailable);
  send();assert.equal((await session.waitForObservation()).status,'reported');assert.throws(()=>session.takeCheckedReportWire(),unavailable);
});
for(const mode of ['stderr','corrupt','partial'])test(`failed report has no retained wire: ${mode}`,async t=>{
  const {session,send}=launch(t,mode,{retainReportWire:true});send();assert.equal((await session.waitForObservation()).status,'unconfirmed');
  assert.throws(()=>session.takeCheckedReportWire(),unavailable);
});
for(const mode of ['deadline','regression','throw','cancel'])test(`post-close ${mode} withholds wire without rewriting historical observation`,async t=>{
  let now=100;const clock=()=>{if(now==='throw')throw Error('private-clock-detail');return now;};
  const {session,send}=launch(t,'normal',{retainReportWire:true,clock,startedAtMs:100,observationMs:1000});
  send();const observation=await session.waitForObservation();const snapshot=JSON.stringify(observation);
  if(mode==='cancel')session.cancel();else now=mode==='deadline'?1100:mode==='regression'?99:'throw';
  assert.throws(()=>session.takeCheckedReportWire(),unavailable);assert.equal(JSON.stringify(observation),snapshot);
});
test('deadline crossed during wire copy withholds the copied bytes',async t=>{
  let taking=false,reads=0;const clock=()=>taking?(++reads===1?100:1100):100;
  const {session,send}=launch(t,'normal',{retainReportWire:true,clock,startedAtMs:100,observationMs:1000});
  send();await session.waitForObservation();taking=true;assert.throws(()=>session.takeCheckedReportWire(),unavailable);assert.equal(reads,2);
});
test('retention timer expires even when the injected clock does not advance',async t=>{
  const {session,send}=launch(t,'normal',{retainReportWire:true,clock:()=>0,startedAtMs:0,observationMs:500});
  send();const observation=await session.waitForObservation();assert.equal(observation.status,'reported');
  await new Promise(resolve=>setTimeout(resolve,550));assert.throws(()=>session.takeCheckedReportWire(),unavailable);
});
test('retention option must be a boolean',()=>{
  for(const retainReportWire of [null,1,'true',{}])assert.throws(()=>new MetadataBootstrapReportSession(pins,{startedAtMs:0,observationMs:1000,retainReportWire},()=>0),unavailable);
});
test('close does not renew the original retention timer with a frozen injected clock',{timeout:6000},async t=>{
  const {session,send}=launch(t,'hold',{retainReportWire:true,clock:()=>0,startedAtMs:0,observationMs:2000});
  send();assert.equal((await session.waitForObservation()).status,'reported');
  // Child deliberately holds about 600ms. At least 2150ms has elapsed since
  // construction, but less than a renewed 2000ms window from its close.
  await new Promise(resolve=>setTimeout(resolve,1550));assert.throws(()=>session.takeCheckedReportWire(),unavailable);
});
for(const mode of ['normal','fragmented'])test(`exact synthetic report requires EOF and original transport close: ${mode}`,async t=>{
  const {session,send}=launch(t,mode);send();const r=await session.waitForObservation();assert.equal(r.status,'reported');assert.equal(r.transportCloseObserved,true);
  assert.equal(r.claims.failure,'provision');assert.equal(r.claims.provisionClaims.attempted,1);assert.equal(r.claims.provisionClaims.created,0);assert.equal(r.claims.provisionClaims.uncertain,true);
  assert.equal(r.authority,'none');for(const k of ['observerStopProven','guestStopProven','verificationEvidence','durableEvidenceRetained'])assert.equal(r[k],false);
  assert.equal(Object.isFrozen(r),true);assert.equal(Object.isFrozen(r.claims.provisionClaims),true);
});
for(const mode of ['hold','eof-hold'])test(`complete bytes${mode==='eof-hold'?' plus injected EOF notification':''} do not settle while transport lives`,async t=>{
  const {session,child,send}=launch(t,'hold');const data=once(child.stdout,'data');send();await data;
  if(mode==='eof-hold')child.stdout.emit('end'); // seam injection, NOT a physical pre-exit EOF observation
  let settled=false;
  const pending=session.waitForObservation().then(v=>{settled=true;return v;});await new Promise(r=>setTimeout(r,80));assert.equal(settled,false);assert.equal(child.exitCode,null);
  const r=await pending;assert.equal(r.status,'reported');assert.equal(r.transportCloseObserved,true);
});
for(const mode of ['nonzero','stderr','partial','extra','oversized','corrupt','wrong-pin','empty'])test(`invalid synthetic report withholds claims: ${mode}`,async t=>{
  const {session,send}=launch(t,mode);send();const r=await session.waitForObservation();assert.equal(r.status,'unconfirmed');assert.equal(r.claims,null);
  assert.equal(r.transportCloseObserved,true);assert.doesNotMatch(JSON.stringify(r),/private-bootstrap-diagnostic/);assert.equal(r.authority,'none');
});
test('real deadline returns uncertainty while child lives; later close cannot upgrade it',{timeout:6000},async t=>{
  const {session,child,send,end}=launch(t,'hang',{observationMs:800});send();const r=await session.waitForObservation();
  assert.equal(r.status,'unconfirmed');assert.equal(r.reason,'observation-timeout');assert.equal(r.transportCloseObserved,false);assert.equal(child.exitCode,null);assert.equal(child.killed,false);
  child.kill();await end;assert.equal(await session.waitForObservation(),r);assert.equal(r.transportCloseObserved,false);assert.equal(r.claims,null);
});
test('cancel is not termination and permanently withholds even a later valid report',async t=>{
  const {session,child,send,end}=launch(t,'normal');session.cancel();const r=await session.waitForObservation();assert.equal(r.reason,'canceled');assert.equal(r.transportCloseObserved,false);
  assert.equal(child.killed,false);send();await end;assert.equal(await session.waitForObservation(),r);assert.equal(r.claims,null);
});
test('129 injected data events hit the independent chunk cap before 384 bytes',async t=>{
  const {session,child,send}=launch(t,'normal');for(let i=0;i<129;i++)child.stdout.emit('data',Buffer.from([0]));send();
  const r=await session.waitForObservation();assert.equal(r.reason,'transport-invalid');assert.equal(r.claims,null);
});
for(const mode of ['regression','throw','late'])test(`clock ${mode} cannot disclose claims`,async t=>{
  let now=100;const clock=()=>{if(now==='throw')throw Error('private-clock-diagnostic');return now;};
  const {session,send}=launch(t,'normal',{clock,startedAtMs:100,observationMs:1000});now=mode==='throw'?'throw':mode==='late'?1100:99;send();
  const r=await session.waitForObservation();assert.equal(r.status,'unconfirmed');assert.equal(r.claims,null);assert.doesNotMatch(JSON.stringify(r),/private-clock/);
});
test('post-decode clock check rejects a deadline crossed during final decoding',async t=>{
  let closing=false,reads=0;const clock=()=>closing?(++reads===1?100:1100):100;
  const {session,child,send}=launch(t,'normal',{clock,startedAtMs:100,observationMs:1000});
  child.prependOnceListener('close',()=>{closing=true;});send();const r=await session.waitForObservation();assert.equal(r.reason,'late-observation');assert.equal(r.claims,null);
});
test('attach cannot renew an old start or substitute another child',async t=>{
  let now=100;const {session,child}=launch(t,'hang',{clock:()=>now,startedAtMs:0,observationMs:1000});now=1000;
  assert.throws(()=>session.attach(child),unavailable);const r=await session.waitForObservation();assert.equal(r.status,'unconfirmed');assert.equal(r.claims,null);
});
test('old-start remaining duration, not full allowance, controls real timer',{timeout:6000},async t=>{
  const startedAtMs=performance.now()-700,begin=performance.now();const {session,child}=launch(t,'hang',{startedAtMs,observationMs:1500});
  const r=await session.waitForObservation();assert.equal(r.reason,'observation-timeout');assert.equal(child.killed,false);assert.ok(performance.now()-begin<1450);
});
test('no child, invalid pins/budgets and invalid original times fail closed',async()=>{
  const s=new MetadataBootstrapReportSession(pins,{startedAtMs:0,observationMs:1000},()=>1);assert.equal((await s.waitForObservation()).reason,'transport-invalid');
  for(const observationMs of [0,-1,30001,NaN,1.5])assert.throws(()=>new MetadataBootstrapReportSession(pins,{startedAtMs:0,observationMs},()=>0),unavailable);
  for(const startedAtMs of [-1,NaN,Infinity,1000])assert.throws(()=>new MetadataBootstrapReportSession(pins,{startedAtMs,observationMs:1000},()=>0),unavailable);
  assert.throws(()=>new MetadataBootstrapReportSession({...pins,runNonce:'0'.repeat(64)},{startedAtMs:0,observationMs:1000},()=>0),unavailable);
  const invalidChild=new MetadataBootstrapReportSession(pins,{startedAtMs:0,observationMs:1000},()=>0);assert.throws(()=>invalidChild.attach({}),unavailable);assert.equal((await invalidChild.waitForObservation()).claims,null);
});
