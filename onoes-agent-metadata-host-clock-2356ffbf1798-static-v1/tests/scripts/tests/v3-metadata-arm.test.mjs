import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {MetadataWatchdogArmWindow} from '../windows-v3-metadata-arm.mjs';
const fixture=fileURLToPath(new URL('../../tests/helpers/v3-metadata-arm-child.mjs',import.meta.url));
const pins={inventoryDigest:'1'.repeat(64),runNonce:'a'.repeat(64),bundleDigest:'b'.repeat(64),workMs:2000,clockReference:'c'.repeat(64),intentReference:'d'.repeat(64)};
const denied=/metadata-watchdog-arm-unavailable/;
function child(t,mode='normal',workMs=2000){
  const process=spawn(globalThis.process.execPath,[fixture,mode,String(workMs)],{windowsHide:true,shell:false,stdio:['pipe','pipe','pipe'],env:{ONOES_METADATA_WATCHDOG_MOCK:'1',SystemRoot:globalThis.process.env.SystemRoot}});
  let stderr='';process.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4096);});
  const closed=once(process,'close');let ended=false;closed.then(()=>{ended=true;});
  t.after(async()=>{if(!ended){process.stdin.end();const timer=setTimeout(()=>process.kill(),1000);try{await closed;}finally{clearTimeout(timer);}}assert.equal(stderr,'');});
  return{process,closed};
}
test('controller arm gate has no launcher, VM command or authority-grant surface',()=>{
  const source=readFileSync(new URL('../windows-v3-metadata-arm.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:spawn|exec|execFile|Invoke-Command|Stop-VM|Get-VM)\s*\(/);
  assert.doesNotMatch(source,/\.kill\(|authority:'(?:approval|execution)'/);
});
for(const field of ['inventoryDigest','runNonce','bundleDigest','clockReference','intentReference'])for(const value of ['0'.repeat(64),'A'.repeat(64),'x'])
  test(`arm denies invalid ${field}: ${value[0]}`,()=>assert.throws(()=>new MetadataWatchdogArmWindow({...pins,[field]:value}),denied));
for(const workMs of [0,25001,1.5,NaN])test(`arm denies invalid work budget ${workMs}`,()=>assert.throws(()=>new MetadataWatchdogArmWindow({...pins,workMs}),denied));
for(const mode of ['normal','fragmented'])test(`real child arm ${mode} yields one non-authorizing claim`,async t=>{
  let now=10;const gate=new MetadataWatchdogArmWindow(pins,()=>now);t.after(()=>gate.close());
  const c=child(t,mode);gate.attach(c.process);assert.equal((await gate.waitForArm()).authority,'none');
  now=1510;const claim=gate.claimDispatch();assert.equal(claim.remainingMs,500);assert.equal(claim.authority,'none');assert.equal(Object.isFrozen(claim),true);
  assert.throws(()=>gate.claimDispatch(),denied);assert.equal((await c.closed)[0],0);
});
for(const mode of ['wrong-pin','wrong-budget','wrong-clock','wrong-intent','legacy','duplicate','trailing','oversized','partial'])test(`real child malformed arm ${mode} closes without claim`,async t=>{
  const workMs=mode==='partial'?400:2000,gate=new MetadataWatchdogArmWindow({...pins,workMs});t.after(()=>gate.close());
  const c=child(t,mode,workMs);gate.attach(c.process);await assert.rejects(gate.waitForArm(),denied);assert.throws(()=>gate.claimDispatch(),denied);assert.equal((await c.closed)[0],0);
});
for(const nowValue of [2000,2500,NaN,Infinity,-1])test(`buffered arm cannot renew exhausted or invalid clock ${nowValue}`,async t=>{
  let now=0;const gate=new MetadataWatchdogArmWindow(pins,()=>now);t.after(()=>gate.close());const c=child(t);
  gate.attach(c.process);await gate.waitForArm();now=nowValue;assert.throws(()=>gate.claimDispatch(),denied);now=0;assert.throws(()=>gate.claimDispatch(),denied);
});
test('arm received after original deadline denies even while guardian remains alive',async t=>{
  let now=0;const gate=new MetadataWatchdogArmWindow(pins,()=>now);t.after(()=>gate.close());const c=child(t);
  gate.attach(c.process);now=2000;await assert.rejects(gate.waitForArm(),denied);assert.throws(()=>gate.claimDispatch(),denied);
});
test('original process exit invalidates a buffered successful arm',async t=>{
  const gate=new MetadataWatchdogArmWindow(pins);t.after(()=>gate.close());const c=child(t,'exit');gate.attach(c.process);
  await c.closed;await assert.rejects(gate.waitForArm(),denied);assert.throws(()=>gate.claimDispatch(),denied);
});
test('terminal output after arm permanently closes forward claims',async t=>{
  const gate=new MetadataWatchdogArmWindow(pins);t.after(()=>gate.close());const c=child(t,'terminal');gate.attach(c.process);await gate.waitForArm();
  c.process.stdin.write('terminal');await c.closed;assert.throws(()=>gate.claimDispatch(),denied);
});
test('local close requests guardian EOF but does not assert stop',async t=>{
  const gate=new MetadataWatchdogArmWindow(pins),c=child(t);gate.attach(c.process);await gate.waitForArm();gate.close();gate.close();
  assert.equal((await c.closed)[0],0);assert.throws(()=>gate.claimDispatch(),denied);
});
test('claim before arm and reuse of a closed gate both permanently deny',async t=>{
  const gate=new MetadataWatchdogArmWindow(pins);t.after(()=>gate.close());assert.throws(()=>gate.claimDispatch(),denied);
  const c=child(t);assert.throws(()=>gate.attach(c.process),denied);await assert.rejects(gate.waitForArm(),denied);
});
test('clock time spent before attach is charged, not renewed',async t=>{
  let now=0;const gate=new MetadataWatchdogArmWindow(pins,()=>now),c=child(t);now=2000;
  assert.throws(()=>gate.attach(c.process),denied);await assert.rejects(gate.waitForArm(),denied);
});
test('clock exception latches denial even after the clock recovers',async t=>{
  let broken=false;const gate=new MetadataWatchdogArmWindow(pins,()=>{if(broken)throw Error('private-clock-detail');return 10;});t.after(()=>gate.close());
  const c=child(t);gate.attach(c.process);await gate.waitForArm();broken=true;assert.throws(()=>gate.claimDispatch(),denied);
  broken=false;assert.throws(()=>gate.claimDispatch(),denied);
});
test('closing captured arm stream invalidates claims before process exit',async t=>{
  const gate=new MetadataWatchdogArmWindow(pins);t.after(()=>gate.close());const c=child(t);gate.attach(c.process);await gate.waitForArm();
  c.process.stdout.destroy();assert.equal(c.process.exitCode,null);assert.throws(()=>gate.claimDispatch(),denied);
  assert.equal((await c.closed)[0],0);await assert.rejects(gate.waitForArm(),denied);
});
test('real controller stall cannot turn a buffered arm into a fresh work budget',async t=>{
  const workMs=200,gate=new MetadataWatchdogArmWindow({...pins,workMs});t.after(()=>gate.close());const c=child(t,'normal',workMs);gate.attach(c.process);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,300);
  await assert.rejects(gate.waitForArm(),denied);assert.throws(()=>gate.claimDispatch(),denied);assert.equal((await c.closed)[0],0);
});
test('gate cannot rebind from its original guardian to a second child',async t=>{
  const gate=new MetadataWatchdogArmWindow(pins);t.after(()=>gate.close());const a=child(t),b=child(t);
  gate.attach(a.process);await gate.waitForArm();assert.throws(()=>gate.attach(b.process),denied);assert.throws(()=>gate.claimDispatch(),denied);
});
test('original child kill denies claims without adopting a replacement PID',async t=>{
  const gate=new MetadataWatchdogArmWindow(pins);t.after(()=>gate.close());const c=child(t);gate.attach(c.process);await gate.waitForArm();
  assert.equal(c.process.kill(),true);assert.throws(()=>gate.claimDispatch(),denied);await c.closed;
});
test('controller gate accepts actual mocked PowerShell arm and EOF requests one stop',{skip:process.platform!=='win32',timeout:15000},async t=>{
  const inventoryDigest='90aa390a454b9046b558fed7b55284f31675e72a57d99e07ab6a5b2203acfe64',workMs=6000;
  const gate=new MetadataWatchdogArmWindow({...pins,inventoryDigest,workMs});
  const core=fileURLToPath(new URL('../windows-v3-metadata-watchdog.ps1',import.meta.url));
  const mock=fileURLToPath(new URL('../../tests/helpers/v3-metadata-watchdog-fixture.ps1',import.meta.url));
  const c=spawn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoProfile','-NonInteractive','-File',mock,'-CorePath',core,'-Mode','normal','-InventoryPin',inventoryDigest,'-WorkMs',String(workMs),'-Pipes'],
    {windowsHide:true,shell:false,stdio:['pipe','pipe','pipe'],env:{SystemRoot:process.env.SystemRoot,ONOES_METADATA_WATCHDOG_MOCK:'1'}});
  const closed=once(c,'close');let ended=false,stdout='',stderr='';closed.then(()=>{ended=true;});
  c.stdout.on('data',chunk=>{stdout+=chunk;assert.ok(stdout.length<16384);});c.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4096);});
  t.after(async()=>{gate.close();if(!ended){const timer=setTimeout(()=>c.kill(),1000);try{await closed;}finally{clearTimeout(timer);}}assert.equal(stderr,'');});
  gate.attach(c);assert.equal((await gate.waitForArm()).authority,'none');
  const claim=gate.claimDispatch();assert.ok(claim.remainingMs>0&&claim.remainingMs<workMs);gate.close();
  assert.equal((await closed)[0],0);
  const lines=stdout.trim().split(/\r?\n/);assert.equal(lines.length,2);
  const terminal=JSON.parse(lines[1]);assert.equal(terminal.mockOnly,true);assert.equal(terminal.denied,false);
  assert.equal(terminal.trace.filter(v=>v==='stop').length,1);assert.equal(terminal.report.trigger,'owner-eof');
  assert.equal(terminal.report.stopWithinBudget,true);assert.equal(terminal.report.controllerDispatchClosed,false);
  assert.equal(terminal.report.verificationEvidence,false);assert.equal(terminal.report.authority,'none');
  assert.throws(()=>gate.claimDispatch(),denied);
});
