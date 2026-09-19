// Dormant same-host/same-boot clock join ONLY. The protected launcher must pin
// OMK1 independently and authenticate its origin; hashes/runtime strings do not.
// Not portable hrtime API behavior: this is pinned to the reviewed Windows Node
// implementation. No process, native library, filesystem, VM or provider access.
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {hrtime,version,versions,platform,arch} from 'node:process';
import {MetadataNodeClockState} from './windows-v3-metadata-node-clock-policy.mjs';
const sample=hrtime.bigint; // capture before callers can replace the public property
const supported=platform==='win32'&&arch==='x64'&&version==='v24.14.0'&&versions.uv==='1.51.0';
const stateByClock=new WeakMap(),deny=()=>{throw Error('metadata-node-clock-unavailable');};
const need=ok=>{if(!ok)deny();};
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)&&!/^0{64}$/.test(v);
const hash=(domain,b)=>createHash('sha256').update(domain+'\0','ascii').update(b).digest();
const typed=Object.getPrototypeOf(Uint8Array.prototype);
const getters=Object.fromEntries(['buffer','byteOffset','byteLength'].map(k=>[k,Object.getOwnPropertyDescriptor(typed,k).get]));
function snapshot(wire){
  need(!types.isProxy(wire)&&types.isUint8Array(wire));
  const buffer=getters.buffer.call(wire),offset=getters.byteOffset.call(wire),size=getters.byteLength.call(wire);
  need(!types.isSharedArrayBuffer(buffer)&&size===128);
  return Buffer.from(new Uint8Array(buffer,offset,size));
}
function read(entry){
  try{return entry.state.observe(sample());}catch{entry.state.invalidate();deny();}
}
export class MetadataNodeHostClock {
  constructor(wire,expectedReference,expectedHostSession,expectedNonce,expectedWorkMs){
    let bytes;
    try{
      need(new.target===MetadataNodeHostClock&&supported);
      need([expectedReference,expectedHostSession,expectedNonce].every(digest));
      need(Number.isSafeInteger(expectedWorkMs)&&expectedWorkMs>=1&&expectedWorkMs<=25000);
      bytes=snapshot(wire);
      need(bytes.subarray(0,4).equals(Buffer.from('OMK1','ascii'))&&bytes.subarray(96).equals(hash('onoes-metadata-host-clock-context/v1',bytes.subarray(0,96))));
      need(hash('onoes-metadata-host-clock-reference/v1',bytes).toString('hex')===expectedReference);
      need(bytes.subarray(4,36).toString('hex')===expectedNonce&&bytes.subarray(64,96).toString('hex')===expectedHostSession);
      need(bytes.readUInt32LE(52)===expectedWorkMs&&bytes.readUInt32LE(56)===expectedWorkMs+5000&&bytes.readUInt32LE(60)===expectedWorkMs+10000);
      const state=new MetadataNodeClockState(bytes.readBigUInt64LE(36),bytes.readBigUInt64LE(44),expectedWorkMs);
      const entry=Object.freeze({state,reference:expectedReference,nonce:expectedNonce,workMs:expectedWorkMs});
      state.requireBefore(read(entry),expectedWorkMs); // late reception cannot renew work
      stateByClock.set(this,entry);Object.freeze(this);
    }catch{deny();}finally{bytes?.fill(0);}
  }
  readElapsedMilliseconds(){const entry=stateByClock.get(this);need(entry);return read(entry);}
}
Object.freeze(MetadataNodeHostClock.prototype);Object.freeze(MetadataNodeHostClock);

// Collectors use the private brand + fixed read closure, not caller methods.
// Work may expire while stop/report bookkeeping continues on this SAME clock.
export function bindMetadataNodeHostClock(clock,reference,nonce,workMs){
  const entry=stateByClock.get(clock);need(entry);
  if(entry.reference!==reference||entry.nonce!==nonce||entry.workMs!==workMs){entry.state.invalidate();deny();}
  read(entry);
  return Object.freeze({read:()=>read(entry),startedAtMs:0,workMs:entry.workMs});
}
