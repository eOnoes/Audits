// Synthetic arm transport only: no VM, filesystem, shell or provider effects.
import assert from 'node:assert/strict';
assert.equal(process.env.ONOES_METADATA_WATCHDOG_MOCK,'1');
const [mode,workMs,clockReference='c'.repeat(64)]=process.argv.slice(2);
assert.match(clockReference,/^[a-f0-9]{64}$/);
assert.ok(['normal','fragmented','wrong-pin','wrong-budget','wrong-clock','wrong-intent','legacy','duplicate','trailing','oversized','partial','exit','terminal'].includes(mode));
const record={kind:'metadata-watchdog-armed-v2-not-authorization',inventoryDigest:'1'.repeat(64),runNonce:'a'.repeat(64),bundleDigest:'b'.repeat(64),workMs:Number(workMs),stopMs:5000,clockReference,intentReference:'d'.repeat(64)};
if(mode==='wrong-clock')record.clockReference='e'.repeat(64);
if(mode==='wrong-intent')record.intentReference='e'.repeat(64);
if(mode==='legacy'){record.kind='metadata-watchdog-armed-not-authorization';delete record.clockReference;delete record.intentReference;}
if(mode==='wrong-pin')record.runNonce='c'.repeat(64);
if(mode==='wrong-budget')record.workMs++;
const wire=JSON.stringify(record)+'\n';
const fallback=setTimeout(()=>process.exit(90),10000);
process.stdin.resume();process.stdin.once('end',()=>{clearTimeout(fallback);process.exit(0);});
process.stdout.on('error',()=>process.exit(91));
if(mode==='oversized')process.stdout.write('x'.repeat(1025));
else if(mode==='partial')process.stdout.write(wire.slice(0,-1));
else if(mode==='duplicate')process.stdout.write(wire+wire);
else if(mode==='trailing')process.stdout.write(wire+'x');
else if(mode==='fragmented'){
  for(const byte of Buffer.from(wire)){process.stdout.write(Buffer.from([byte]));await new Promise(resolve=>setImmediate(resolve));}
}else process.stdout.write(wire);
if(mode==='exit')process.stdout.end(()=>process.exit(0));
if(mode==='terminal')process.stdin.once('data',()=>process.stdout.write('{"terminal":true}\n'));
