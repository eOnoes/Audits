// Host-side preparation: decode OMB1/OMQ1 claims, not physical proof or authority.
// No transport, files, VM commands, retries, approval or production consumer.
import {createHash} from 'node:crypto';
import {types} from 'node:util';
const typedArray=Object.getPrototypeOf(Uint8Array.prototype);
const getters=Object.fromEntries(['buffer','byteOffset','byteLength'].map(k=>[k,Object.getOwnPropertyDescriptor(typedArray,k).get]));
const deny=()=>{throw Error('metadata-bootstrap-report-invalid');};
const need=ok=>{if(!ok)deny();};
const hash=(domain,b)=>createHash('sha256').update(`${domain}\0`,'ascii').update(b).digest();
const zero=(b,at,n)=>b.subarray(at,at+n).every(v=>v===0);
const bit=(b,n)=>(b&n)!==0;
const cleanup=['not-observed','disposal-returned','disposal-threw'];
const failures=['none-recorded','provision','setup','startup','case','cleanup','deadline'];
const caseFailures=['none-recorded','configuration','preparation','readiness','dispatch','protocol','stop','roots','cleanup','deadline'];
const roots=['still-running','completion-and-cleanup-reported','incomplete-or-uncertain-reported','fixed-entry-failure','unexpected-exit'];
function pin(value){need(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)&&!/^0{64}$/.test(value));return Buffer.from(value,'hex');}
function snapshot(value){
  need(!types.isProxy(value)&&types.isUint8Array(value));
  const buffer=getters.buffer.call(value),length=getters.byteLength.call(value),offset=getters.byteOffset.call(value);
  need(!types.isSharedArrayBuffer(buffer)&&length===384);
  // Intrinsic view getters, no caller iterator, constructor, species or methods.
  return Buffer.from(new Uint8Array(buffer,offset,length));
}
function prefix(masks,count){
  const expected=masks.map(()=>0);
  for(let step=0;step<=count*masks.length;step++){
    if(masks.every((v,i)=>v===expected[i]))return true;
    if(step<count*masks.length)expected[step%masks.length]|=1<<Math.floor(step/masks.length);
  }return false;
}
function freeze(value){if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}
function decodeCase(b,nonce,bundle,fixture){
  need(b.subarray(0,6).equals(Buffer.from([79,77,81,49,1,5]))&&b[7]<=9);
  need(b.subarray(192).equals(hash('onoes-metadata-case-report/v1',b.subarray(0,192))));
  need(b[12]<=2&&zero(b,13,3)&&zero(b,145,3)&&zero(b,172,20));
  need(b.subarray(48,80).equals(bundle)&&b.subarray(80,112).equals(fixture)&&b.subarray(112,144).equals(hash('onoes-metadata-report-run/v1',nonce)));
  const flags=b[6],elapsedMs=b.readUInt32LE(8),j=b[144];
  need(elapsedMs<=30000&&bit(flags,128)===(elapsedMs===30000));
  need(!bit(flags,1)===zero(b,16,32));
  need(!bit(flags,2)||bit(flags,1));need(!bit(flags,4)||bit(flags,2));need(!bit(flags,8)||bit(flags,4));
  need(j<=31);if(!bit(flags,16))need(j===0);
  need(!bit(j,4)||bit(j,2));need(!bit(j,8)||(j&3)===3);
  const rootClaims=[],controlClaims=[];
  for(let i=0;i<3;i++){
    const at=148+i*4,c=b[160+i*4];
    need(b[at]<=4&&b[at+1]<=1&&zero(b,at+2,2));if(!bit(flags,32))need(zero(b,at,4));
    if(bit(flags,32)&&bit(j,8))need(b[at]!==0);
    need(c<=127&&zero(b,161+i*4,3));if(!bit(flags,64))need(c===0);
    need(!bit(c,2)||bit(c,1));need(!bit(c,4)||bit(c,2));need(!bit(c,8)||bit(c,4));need(!bit(c,32)||bit(c,16));
    if(bit(flags,64)&&bit(flags,2))need((c&3)===3);if(bit(flags,64)&&bit(flags,4))need((c&12)===12);
    rootClaims.push({kind:roots[b[at]],priorUncertainty:!!b[at+1]});
    controlClaims.push({prepareAttempted:bit(c,1),prepareReturned:bit(c,2),dispatchAttempted:bit(c,4),dispatchReturned:bit(c,8),stopAttempted:bit(c,16),stopReturned:bit(c,32),uncertain:bit(c,64)});
  }
  if(b[7]===0){need(flags===127&&j===11&&b[12]===1);for(let i=0;i<3;i++)need(b[148+i*4]===1&&b[149+i*4]===0&&b[160+i*4]===63);}
  return {caseNumber:5,failure:caseFailures[b[7]],elapsedMs,deadlineReached:bit(flags,128),disposal:cleanup[b[12]],
    configurationDigest:bit(flags,1)?b.subarray(16,48).toString('hex'):null,prepared:bit(flags,2),dispatched:bit(flags,4),protocolCompleted:bit(flags,8),
    job:bit(flags,16)?{allAttached:bit(j,1),stopRequested:bit(j,2),killAttempted:bit(j,4),stopConfirmed:bit(j,8),uncertain:bit(j,16)}:null,
    roots:bit(flags,32)?rootClaims:null,controls:bit(flags,64)?controlClaims:null};
}
export function decodeMetadataBootstrapReport(supplied,runNonce,bundleDigest,fixtureDigest){
  let b;
  try{
    // Pins are independent primitive strings supplied by the trusted launcher;
    // no pin is adopted from the received report.
    const nonce=pin(runNonce),bundle=pin(bundleDigest),fixture=pin(fixtureDigest);b=snapshot(supplied);
    need(b.subarray(0,5).equals(Buffer.from([79,77,66,49,1]))&&b[5]<=31&&b[6]<=6&&b[7]<=2);
    need(b.subarray(352).equals(hash('onoes-metadata-bootstrap-report/v1',b.subarray(0,352))));
    need(b.subarray(32,64).equals(hash('onoes-metadata-report-run/v1',nonce))&&b.subarray(64,96).equals(bundle)&&b.subarray(96,128).equals(fixture));
    const flags=b[5],elapsedMs=b.readUInt32LE(8),p=[b.readUInt16LE(12),b.readUInt16LE(14),b.readUInt16LE(16)],s=[b[20],b[21],b[22]],t=[b[24],b[25],b[26],b[27],b[28]];
    need(elapsedMs<=30000&&bit(flags,16)===(elapsedMs===30000));need(b[19]===0&&zero(b,30,2)&&b[18]<=3&&b[23]<=1&&b[29]<=7);
    need(prefix(p,9)&&prefix(s,3)&&prefix(t,3));
    if(!bit(flags,1))need(zero(b,12,7));if(bit(b[18],2))need(p[2]===511);
    if(!bit(flags,2))need(zero(b,20,4));else need(bit(flags,1)&&b[18]===2&&p[2]===511);
    if(!bit(flags,4))need(zero(b,24,6));else need(bit(flags,2)&&s[2]===7&&b[23]===0);
    if(bit(b[29],2))need(t[4]===7);if(bit(b[29],4))need(bit(b[29],2));
    let caseClaims=null;
    if(!bit(flags,8))need(zero(b,128,224));else{
      need(bit(flags,4)&&bit(b[29],2)&&t[4]===7);caseClaims=decodeCase(b.subarray(128,352),nonce,bundle,fixture);need(caseClaims.elapsedMs<=elapsedMs);
    }
    if(b[6]===0)need(flags===15&&b[7]===1&&b[29]===6&&b[135]===0);
    return freeze({kind:'metadata-bootstrap-claims-not-verification',reportDigest:createHash('sha256').update(b).digest('hex'),
      runDigest:b.subarray(32,64).toString('hex'),bundleDigest,fixtureDigest,failure:failures[b[6]],elapsedMs,deadlineReached:bit(flags,16),disposal:cleanup[b[7]],
      provisionClaims:bit(flags,1)?{attempted:p[0],created:p[1],verified:p[2],uncertain:bit(b[18],1),finished:bit(b[18],2)}:null,
      setupClaims:bit(flags,2)?{attempted:s[0],created:s[1],verified:s[2],uncertain:!!b[23]}:null,
      startupClaims:bit(flags,4)?{enableAttempted:t[0],enabled:t[1],startAttempted:t[2],startReturned:t[3],observed:t[4],uncertain:bit(b[29],1),finished:bit(b[29],2),transferred:bit(b[29],4)}:null,
      caseClaims,observerStopProven:false,guestStopProven:false,verificationEvidence:false,authority:'none'});
  }catch{deny();}finally{b?.fill(0);}
}
