// Synthetic report/lifecycle faults only; no filesystem, VM or provider access.
import assert from 'node:assert/strict';
assert.equal(process.env.ONOES_METADATA_WATCHDOG_MOCK,'1');
const [mode,workMs,clockReference='c'.repeat(64)]=process.argv.slice(2);
assert.match(clockReference,/^[a-f0-9]{64}$/);
assert.ok(['normal','hold','hang','nonzero','wrong-pin','unknown-field','false-proof','incoherent','duplicate-key','trailing','partial','oversized','stderr','bad-utf8','extra-frame'].includes(mode));
const pins={inventoryDigest:'1'.repeat(64),runNonce:'a'.repeat(64),bundleDigest:'b'.repeat(64)};
process.stdout.write(JSON.stringify({kind:'metadata-watchdog-armed-v2-not-authorization',...pins,workMs:Number(workMs),stopMs:5000,clockReference,intentReference:'d'.repeat(64)})+'\n');
process.stdin.resume();let terminalSent=false;
const fallback=setTimeout(()=>process.exit(91),12000);process.stdout.on('error',()=>process.exit(92));
function finish(){clearTimeout(fallback);process.exit(mode==='nonzero'?7:0);}
function report(){
  if(terminalSent)return;terminalSent=true;
  const value={kind:'metadata-watchdog-observation-not-verification',...pins,armed:true,trigger:'owner-eof',stopAttempted:true,hostOffObserved:true,
    stopJobSettled:true,stopWithinBudget:true,controllerDispatchClosed:false,guestStopProven:false,verificationEvidence:false,authority:'none'};
  if(mode==='wrong-pin')value.bundleDigest='c'.repeat(64);
  if(mode==='unknown-field')value.secret='must-not-escape';
  if(mode==='false-proof')value.guestStopProven=true;
  if(mode==='incoherent')value.hostOffObserved=false;
  let wire=JSON.stringify(value)+'\r\n';
  if(mode==='duplicate-key')wire=wire.replace('"authority":"none"','"authority":"bad","authority":"none"');
  if(mode==='trailing')wire+='x';if(mode==='extra-frame')wire+=wire;
  if(mode==='partial')wire=wire.slice(0,-2);if(mode==='oversized')wire='x'.repeat(4097);
  if(mode==='bad-utf8')wire=Buffer.from([255,10]);
  if(mode==='stderr')process.stderr.write('private-diagnostic-must-not-escape\n');
  process.stdout.write(wire,()=>{if(mode!=='hold'&&mode!=='hang')finish();});
}
process.stdin.on('data',()=>report());
process.stdin.once('end',()=>{if(mode==='hold'){setTimeout(finish,600);}else if(mode!=='hang')report();});
