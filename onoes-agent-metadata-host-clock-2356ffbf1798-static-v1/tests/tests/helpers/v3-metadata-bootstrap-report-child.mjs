// Synthetic owned child, fabricated bytes only. No native/VM/file/network calls.
import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
assert.equal(process.env.ONOES_METADATA_BOOTSTRAP_MOCK,'1');
const [mode]=process.argv.slice(2);
assert.ok(['normal','hold','hang','fragmented','nonzero','stderr','partial','extra','oversized','corrupt','wrong-pin','empty'].includes(mode));
const h=(d,b)=>createHash('sha256').update(d+'\0','ascii').update(b).digest();
const b=Buffer.alloc(384);b.write('OMB1');b.set([1,1,1,1],4);b.writeUInt32LE(100,8);b.writeUInt16LE(1,12);b[18]=1;
h('onoes-metadata-report-run/v1',Buffer.alloc(32,1)).copy(b,32);b.fill(mode==='wrong-pin'?4:2,64,96);b.fill(0x33,96,128);
h('onoes-metadata-bootstrap-report/v1',b.subarray(0,352)).copy(b,352);if(mode==='corrupt')b[18]^=1;
process.stdin.resume();const fallback=setTimeout(()=>process.exit(91),5000);let sent=false;
function exit(){clearTimeout(fallback);process.exit(mode==='nonzero'?7:0);}
function after(){if(mode==='hold')setTimeout(exit,600);else if(mode!=='hang')exit();}
process.stdout.on('error',()=>process.exit(92));
process.stdin.once('data',()=>{
  if(sent)return;sent=true;
  if(mode==='stderr')process.stderr.write('private-bootstrap-diagnostic\n');
  if(mode==='empty'){exit();return;}
  if(mode==='fragmented'){let at=0;const send=()=>{if(at===b.length){after();return;}const end=Math.min(at+32,b.length);process.stdout.write(b.subarray(at,end),()=>{at=end;setTimeout(send,2);});};send();return;}
  let wire=b;if(mode==='partial')wire=b.subarray(0,383);if(mode==='extra')wire=Buffer.concat([b,b]);if(mode==='oversized')wire=Buffer.alloc(4097);
  process.stdout.write(wire,after);
});
