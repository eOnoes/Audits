import assert from 'node:assert/strict';import test from 'node:test';
import {spawn} from 'node:child_process';import {once} from 'node:events';
import {fileURLToPath} from 'node:url';import {readFileSync} from 'node:fs';
import {MetadataWatchdogSession} from '../windows-v3-metadata-session.mjs';
const pins={inventoryDigest:'1'.repeat(64),runNonce:'a'.repeat(64),bundleDigest:'b'.repeat(64),workMs:2000,clockReference:'c'.repeat(64),intentReference:'d'.repeat(64)};
const fixture=fileURLToPath(new URL('../../tests/helpers/v3-metadata-report-child.mjs',import.meta.url));
const denied=/metadata-watchdog-session-unavailable/;
function launch(t,mode,clock){
  const session=new MetadataWatchdogSession(pins,clock);
  const child=spawn(process.execPath,[fixture,mode,String(pins.workMs)],{windowsHide:true,shell:false,stdio:['pipe','pipe','pipe'],env:{SystemRoot:process.env.SystemRoot,ONOES_METADATA_WATCHDOG_MOCK:'1'}});
  const closed=once(child,'close');let ended=false;closed.then(()=>{ended=true;});
  t.after(async()=>{session.requestStop();if(!ended){const timer=setTimeout(()=>child.kill(),1500);try{await closed;}finally{clearTimeout(timer);}}});
  session.attach(child);return{session,child,closed};
}
test('collection definitions do not spawn, invoke a guest or write a report file',()=>{
  const source=readFileSync(new URL('../windows-v3-metadata-session.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:spawn|exec|execFile|writeFile|Invoke-Command|Stop-VM|Get-VM)\s*\(/);
  assert.match(source,/#bytes\.length\+chunk\.length>4096/);assert.match(source,/\+\+this.#chunks>128/);
});
test('one arm, one local claim, EOF stop, bounded report and confirmed root close compose',async t=>{
  const {session}=launch(t,'normal');assert.equal((await session.waitForArm()).authority,'none');
  assert.equal(session.claimDispatch().authority,'none');session.requestStop();
  const result=await session.waitForObservation();assert.equal(result.status,'reported');assert.equal(result.reason,null);
  assert.equal(result.rootCloseObserved,true);assert.equal(result.localClaimMade,true);assert.equal(result.report.stopWithinBudget,true);
  for(const key of ['controllerDispatchClosed','guestStopProven','verificationEvidence'])assert.equal(result[key],false);
  assert.equal(result.authority,'none');assert.equal(Object.isFrozen(result),true);assert.equal(Object.isFrozen(result.report),true);
  assert.throws(()=>session.claimDispatch(),denied);
});
test('complete report bytes do not settle while the original process stays live',async t=>{
  const {session,child}=launch(t,'hold');await session.waitForArm();let settled=false;
  const pending=session.waitForObservation().then(v=>{settled=true;return v;});child.stdin.write('report');
  await new Promise(resolve=>setTimeout(resolve,120));assert.equal(child.exitCode,null);assert.equal(settled,false);
  const result=await pending;assert.equal(result.rootCloseObserved,true);assert.equal(result.status,'reported');
});

test('watchdog deadline crossed during final decoding withholds the report',async t=>{
  let closing=false,reads=0;const clock=()=>closing?(++reads===1?100:7100):100;
  const {session,child}=launch(t,'normal',clock);child.prependOnceListener('close',()=>{closing=true;});
  await session.waitForArm();session.claimDispatch();session.requestStop();
  const result=await session.waitForObservation();assert.equal(result.status,'unconfirmed');
  assert.equal(result.reason,'late-observation');assert.equal(result.report,null);
});
test('observation deadline returns unconfirmed without pretending a live process stopped',{timeout:11000},async t=>{
  const {session,child,closed}=launch(t,'hang');await session.waitForArm();child.stdin.write('report');
  const result=await session.waitForObservation();assert.equal(result.status,'unconfirmed');assert.equal(result.reason,'observation-timeout');
  assert.equal(result.rootCloseObserved,false);assert.equal(result.report,null);assert.equal(child.exitCode,null);
  // Test cleanup owns this synthetic child; the session itself never kills it.
  assert.equal(child.kill(),true);await closed;assert.equal(await session.waitForObservation(),result);
  assert.equal(result.rootCloseObserved,false,'late process close cannot rewrite delivered uncertainty');
});
test('independent chunk ceiling rejects small fragments before aggregate byte ceiling',async t=>{
  const {session,child}=launch(t,'normal');await session.waitForArm();
  // Explicit stream-event injection tests the collector boundary deterministically;
  // it is not a claim that the OS preserves network/pipe chunk boundaries.
  for(let i=0;i<129;i++)child.stdout.emit('data',Buffer.from('x'));
  const result=await session.waitForObservation();assert.equal(result.status,'unconfirmed');assert.equal(result.reason,'transport-invalid');
});
for(const mode of ['nonzero','wrong-pin','unknown-field','false-proof','incoherent','duplicate-key','trailing','partial','oversized','stderr','bad-utf8','extra-frame'])
  test(`malformed/failed report ${mode} remains unconfirmed and redacted`,async t=>{
    const {session}=launch(t,mode);await session.waitForArm();session.requestStop();const result=await session.waitForObservation();
    assert.equal(result.status,'unconfirmed');assert.equal(result.report,null);assert.equal(result.verificationEvidence,false);
    assert.doesNotMatch(JSON.stringify(result),/must-not-escape|private-diagnostic|secret/);
    assert.equal(result.reason,mode==='nonzero'?'root-exit-unconfirmed':'transport-invalid');
  });
test('report after the original stop deadline is not upgraded by clean exit',async t=>{
  let now=10;const {session}=launch(t,'normal',()=>now);await session.waitForArm();now=7010;session.requestStop();
  const result=await session.waitForObservation();assert.equal(result.status,'unconfirmed');assert.equal(result.reason,'late-observation');
  assert.equal(result.report,null);assert.equal(result.elapsedMs,null);
});
test('clock regression during collection permanently denies even a coherent report',async t=>{
  let now=10;const {session}=launch(t,'normal',()=>now);await session.waitForArm();now=9;session.requestStop();
  const result=await session.waitForObservation();assert.equal(result.status,'unconfirmed');assert.equal(result.reason,'clock-invalid');
});
test('missing child is immediately unconfirmed without claiming any exit',async()=>{
  const session=new MetadataWatchdogSession(pins),result=await session.waitForObservation();
  assert.equal(result.rootCloseObserved,false);assert.equal(result.status,'unconfirmed');assert.equal(result.localClaimMade,false);
});
test('actual PowerShell watchdog report composes under mock-only management',{skip:process.platform!=='win32',timeout:15000},async t=>{
  const inventoryDigest='90aa390a454b9046b558fed7b55284f31675e72a57d99e07ab6a5b2203acfe64',workMs=6000;
  const session=new MetadataWatchdogSession({...pins,inventoryDigest,workMs});
  const child=spawn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-NonInteractive','-File',
    fileURLToPath(new URL('../../tests/helpers/v3-metadata-watchdog-fixture.ps1',import.meta.url)),'-CorePath',fileURLToPath(new URL('../windows-v3-metadata-watchdog.ps1',import.meta.url)),
    '-Mode','normal','-InventoryPin',inventoryDigest,'-WorkMs',String(workMs),'-Pipes','-DirectReport'],
    {windowsHide:true,shell:false,stdio:['pipe','pipe','pipe'],env:{SystemRoot:process.env.SystemRoot,ONOES_METADATA_WATCHDOG_MOCK:'1'}});
  const closed=once(child,'close');let ended=false;closed.then(()=>{ended=true;});
  t.after(async()=>{session.requestStop();if(!ended){const timer=setTimeout(()=>child.kill(),1500);try{await closed;}finally{clearTimeout(timer);}}});
  session.attach(child);await session.waitForArm();session.claimDispatch();session.requestStop();
  const result=await session.waitForObservation();assert.equal(result.status,'reported');assert.equal(result.rootCloseObserved,true);
  assert.equal(result.report.trigger,'owner-eof');assert.equal(result.report.stopWithinBudget,true);assert.equal(result.report.inventoryDigest,inventoryDigest);
  assert.equal(result.controllerDispatchClosed,false);assert.equal(result.guestStopProven,false);assert.equal(result.verificationEvidence,false);
});
