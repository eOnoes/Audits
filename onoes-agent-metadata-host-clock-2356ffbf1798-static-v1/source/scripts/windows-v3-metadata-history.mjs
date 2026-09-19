// Dormant host preparation: compare separately read historical byte records.
// No filesystem/transport/VM access, authentication, atomic snapshot or admission.
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {decodeMetadataBootstrapReport} from './windows-v3-metadata-report.mjs';
const typedArray=Object.getPrototypeOf(Uint8Array.prototype);
const getters=Object.fromEntries(['buffer','byteOffset','byteLength'].map(k=>[k,Object.getOwnPropertyDescriptor(typedArray,k).get]));
const deny=()=>{throw Error('metadata-history-invalid');};
const need=ok=>{if(!ok)deny();};
const hash=(domain,b)=>createHash('sha256').update(`${domain}\0`,'ascii').update(b).digest();
const digest=b=>createHash('sha256').update(b).digest('hex');
const triggers=['arm-failed','deadline','owner-eof','unexpected-input','lifeline-error'];
function pin(value){need(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)&&!/^0{64}$/.test(value));return Buffer.from(value,'hex');}
function snapshot(value,length){
  need(!types.isProxy(value)&&types.isUint8Array(value));
  const buffer=getters.buffer.call(value),offset=getters.byteOffset.call(value),actual=getters.byteLength.call(value);
  need(!types.isSharedArrayBuffer(buffer)&&actual===length);
  return Buffer.from(new Uint8Array(buffer,offset,length));
}
function seal(b,magic,offset,domain){need(b.subarray(0,4).equals(Buffer.from(magic,'ascii'))&&b.subarray(offset).equals(hash(domain,b.subarray(0,offset))));}
export function compareMetadataHistoricalRecords(controllerIntent,bootstrapReport,watchdogIntent,watchdogTerminal,
  expectedWatchdogRoot,runNonce,inventoryDigest,bundleDigest,fixtureDigest,workMs){
  const owned=[];
  const copy=(v,n)=>{const b=snapshot(v,n);owned.push(b);return b;};
  try{
    // Independent primitive pins; never infer run, root or budget from a record.
    const pins=[expectedWatchdogRoot,runNonce,inventoryDigest,bundleDigest,fixtureDigest].map(pin);
    need(Number.isInteger(workMs)&&workMs>=1&&workMs<=25000);
    // Required intents: missing, unreadable and partial input are not safe absence.
    // Only explicit null denotes a caller-reported missing optional report.
    const c=copy(controllerIntent,164),b=bootstrapReport===null?null:copy(bootstrapReport,384);
    const w=copy(watchdogIntent,208),t=watchdogTerminal===null?null:copy(watchdogTerminal,72);
    seal(c,'OMH1',132,'onoes-metadata-host-intent/v1');
    for(let i=0;i<4;i++)need(c.subarray(4+i*32,36+i*32).equals(pins[i+1]));
    seal(w,'OMWI',176,'onoes-metadata-watchdog-intent/v1');
    for(let i=0;i<5;i++)need(w.subarray(4+i*32,36+i*32).equals(pins[i]));
    need(w.readUInt32LE(164)===workMs&&w.readUInt32LE(168)===5000&&w.readUInt32LE(172)===5000);
    const bootstrapClaims=b===null?null:decodeMetadataBootstrapReport(b,runNonce,bundleDigest,fixtureDigest);
    let terminalClaims=null;
    if(t!==null){
      seal(t,'OMWT',40,'onoes-metadata-watchdog-terminal/v1');
      need(t.subarray(4,36).equals(hash('onoes-metadata-watchdog-intent-reference/v1',w)));
      const trigger=t[36],flags=t[37];
      need(trigger<=4&&flags<=31&&t[38]===0&&t[39]===0);
      need(Boolean(flags&1)===(trigger!==0));need(!(flags&16)||(flags&12)===12);
      terminalClaims=Object.freeze({trigger:triggers[trigger],armed:!!(flags&1),stopAttempted:!!(flags&2),
        hostOffObserved:!!(flags&4),stopJobSettled:!!(flags&8),stopWithinBudget:!!(flags&16)});
    }
    return Object.freeze({kind:'metadata-history-comparison-not-reconciliation',
      status:b!==null&&t!==null?'both-reports-recorded-claims':'incomplete-recorded-claims',
      controller:Object.freeze({intentDigest:digest(c),reportDigest:b===null?null:digest(b),
        status:b===null?'intent-only-unconfirmed':'recorded-claims-not-verification',claims:bootstrapClaims}),
      watchdog:Object.freeze({intentDigest:digest(w),reportDigest:t===null?null:digest(t),
        status:t===null?'intent-only-unconfirmed':'recorded-claims-not-verification',claims:terminalClaims}),
      workMs,stopMs:5000,retentionMs:5000,requiresReconciliation:true,
      // OMH1 contains no root binding. Its protected reader must establish custody;
      // comparing its run pins to OMWI cannot manufacture a controller root claim.
      controllerRootBoundByWire:false,atomicSnapshotEstablished:false,freshnessEstablished:false,
      durableEvidenceRetained:false,controllerDispatchClosed:false,guestStopProven:false,
      verificationEvidence:false,mayDispatch:false,authority:'none'});
  }catch{deny();}finally{for(const b of owned)b.fill(0);}
}

// V2 ONLY. Expected pins are supplied independently by a protected reader/host,
// never selected from the records. Structural agreement is not current custody.
export function compareMetadataClockHistoricalRecords(controllerIntent,controllerReport,watchdogIntent,watchdogTerminal,
  expectedRoot,expectedClockReference,expectedHostSession,runNonce,inventoryDigest,bundleDigest,fixtureDigest,workMs){
  const owned=[];const copy=(v,n)=>{const b=snapshot(v,n);owned.push(b);return b;};
  try{
    const root=pin(expectedRoot),clockRef=pin(expectedClockReference),host=pin(expectedHostSession),nonce=pin(runNonce);
    const inv=pin(inventoryDigest),bundle=pin(bundleDigest),fixture=pin(fixtureDigest);
    need(Number.isInteger(workMs)&&workMs>=1&&workMs<=25000);
    const c=copy(controllerIntent,292),b=controllerReport===null?null:copy(controllerReport,452);
    const w=copy(watchdogIntent,292),t=watchdogTerminal===null?null:copy(watchdogTerminal,72);
    seal(c,'OMH2',260,'onoes-metadata-controller-intent/v2');
    seal(w,'OMW2',260,'onoes-metadata-watchdog-intent/v2');
    for(const i of [c,w])for(const [index,p] of [root,inv,bundle,fixture].entries())need(i.subarray(4+index*32,36+index*32).equals(p));
    const clock=c.subarray(132,260);need(clock.equals(w.subarray(132,260)));
    seal(clock,'OMK1',96,'onoes-metadata-host-clock-context/v1');
    need(clock.subarray(4,36).equals(nonce)&&clock.subarray(64,96).equals(host));
    need(hash('onoes-metadata-host-clock-reference/v1',clock).equals(clockRef));
    const origin=clock.readBigUInt64LE(36),frequency=clock.readBigUInt64LE(44),max=(1n<<63n)-1n;
    need(origin>0n&&origin<=max&&frequency>0n&&frequency<=max);
    need(clock.readUInt32LE(52)===workMs&&clock.readUInt32LE(56)===workMs+5000&&clock.readUInt32LE(60)===workMs+10000);
    let bootstrapClaims=null,terminalClaims=null;
    if(b!==null){
      seal(b,'OHR2',420,'onoes-metadata-controller-report/v2');
      need(b.subarray(4,36).equals(hash('onoes-metadata-controller-intent-reference/v2',c)));
      bootstrapClaims=decodeMetadataBootstrapReport(b.subarray(36,420),runNonce,bundleDigest,fixtureDigest);
    }
    if(t!==null){
      seal(t,'OWT2',40,'onoes-metadata-watchdog-terminal/v2');
      need(t.subarray(4,36).equals(hash('onoes-metadata-watchdog-intent-reference/v2',w)));
      const trigger=t[36],flags=t[37];need(trigger<=4&&flags<=31&&t[38]===0&&t[39]===0);
      need(Boolean(flags&1)===(trigger!==0));need(!(flags&16)||(flags&12)===12);
      terminalClaims=Object.freeze({trigger:triggers[trigger],armed:!!(flags&1),stopAttempted:!!(flags&2),
        hostOffObserved:!!(flags&4),stopJobSettled:!!(flags&8),stopWithinBudget:!!(flags&16)});
    }
    return Object.freeze({kind:'metadata-clock-history-comparison-not-reconciliation',
      status:b!==null&&t!==null?'both-reports-recorded-claims':'incomplete-recorded-claims',
      controller:Object.freeze({intentDigest:digest(c),reportDigest:b===null?null:digest(b),
        status:b===null?'intent-only-unconfirmed':'recorded-claims-not-verification',claims:bootstrapClaims}),
      watchdog:Object.freeze({intentDigest:digest(w),reportDigest:t===null?null:digest(t),
        status:t===null?'intent-only-unconfirmed':'recorded-claims-not-verification',claims:terminalClaims}),
      clockContextReference:expectedClockReference,workMs,stopMs:5000,retentionMs:5000,
      controllerRootBoundByWire:true,watchdogRootBoundByWire:true,sharedClockBoundByWire:true,
      requiresReconciliation:true,protectedRootCustodyEstablished:false,clockProvenanceEstablished:false,
      atomicSnapshotEstablished:false,freshnessEstablished:false,durableEvidenceRetained:false,
      controllerDispatchClosed:false,guestStopProven:false,verificationEvidence:false,mayDispatch:false,authority:'none'});
  }catch{deny();}finally{for(const b of owned)b.fill(0);}
}
