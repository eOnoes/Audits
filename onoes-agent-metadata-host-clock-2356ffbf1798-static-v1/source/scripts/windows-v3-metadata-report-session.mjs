// In-memory transport observation only. Does not spawn, kill, dispatch, stop a VM
// or persist evidence. ChildProcess/clock/options are trusted launcher inputs.
import {ChildProcess} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {types} from 'node:util';
import {decodeMetadataBootstrapReport} from './windows-v3-metadata-report.mjs';
import {bindMetadataNodeHostClock} from './windows-v3-metadata-node-clock.mjs';
const invalid=()=>{throw Error('metadata-report-session-unavailable');};
const digest=v=>typeof v==='string'&&v.length===64&&/^[a-f0-9]{64}$/.test(v)&&v!=='0'.repeat(64);
export class MetadataBootstrapReportSession {
  #pins;#clock;#start;#last;#deadline;#timer;#child;#attached=false;#ended=false;#closed=false;
  #buffer=Buffer.alloc(384);#length=0;#chunks=0;#reason=null;#done=false;#settle;#pending;
  #retainWire;#wireReady=false;#wireTaken=false;
  static fromHostClock(pins,hostClock,{retainReportWire=false}={}){
    const bound=bindMetadataNodeHostClock(hostClock,pins.clockReference,pins.runNonce,pins.workMs);
    return new MetadataBootstrapReportSession(pins,{startedAtMs:bound.startedAtMs,observationMs:bound.workMs+5000,retainReportWire},bound.read);
  }
  constructor(pins,{startedAtMs,observationMs,retainReportWire=false},clock=()=>performance.now()){
    try{
      if(![pins.runNonce,pins.bundleDigest,pins.fixtureDigest].every(digest)||typeof clock!=='function'||
        typeof retainReportWire!=='boolean'||!Number.isFinite(startedAtMs)||startedAtMs<0||!Number.isSafeInteger(observationMs)||observationMs<1||observationMs>30000)invalid();
      this.#retainWire=retainReportWire;
      this.#pins=Object.freeze({runNonce:pins.runNonce,bundleDigest:pins.bundleDigest,fixtureDigest:pins.fixtureDigest});
      this.#clock=clock;this.#start=startedAtMs;this.#last=startedAtMs;this.#deadline=startedAtMs+observationMs;
      const now=clock();if(!Number.isFinite(now)||now<startedAtMs||now>=this.#deadline)invalid();this.#last=now;
      this.#pending=new Promise(resolve=>{this.#settle=resolve;});
      // Original pre-launch start, not constructor/attach/first-byte time.
      this.#timer=setTimeout(()=>{
        if(this.#done){this.#discardWire();return;}
        this.#fail('observation-timeout');this.#finish(null,null);
      },this.#deadline-now);this.#timer.unref();
    }catch{invalid();}
  }
  #fail(reason){if(!this.#reason)this.#reason=reason;this.#buffer.fill(0);}
  #time(){
    try{const now=this.#clock();if(!Number.isFinite(now)||now<this.#last){this.#fail('clock-invalid');return null;}
      this.#last=now;if(now>=this.#deadline){this.#fail('late-observation');return null;}return now;
    }catch{this.#fail('clock-invalid');return null;}
  }
  attach(child){
    try{
      if(this.#done||this.#attached)invalid();this.#attached=true;
      if(this.#time()===null||types.isProxy(child)||!(child instanceof ChildProcess)||!child.stdout||!child.stderr||
        !Number.isSafeInteger(child.pid)||child.pid<=0||child.exitCode!==null||child.signalCode!==null||child.killed||
        child.stdout.destroyed||child.stdout.readableEnded||child.stderr.destroyed)invalid();
      this.#child=child;
      child.stdout.on('data',chunk=>{
        if(this.#done||this.#reason)return;
        if(this.#time()===null)return;
        if(!Buffer.isBuffer(chunk)||chunk.length===0||++this.#chunks>128||this.#length+chunk.length>384){this.#fail('transport-invalid');return;}
        chunk.copy(this.#buffer,this.#length);this.#length+=chunk.length;
      });
      child.stdout.once('end',()=>{this.#ended=true;});
      child.stdout.once('error',()=>{if(!this.#done)this.#fail('transport-invalid');});
      child.stderr.on('data',()=>{if(!this.#done)this.#fail('transport-invalid');}); // never retain raw diagnostics
      child.stderr.once('error',()=>{if(!this.#done)this.#fail('transport-invalid');});
      child.once('error',()=>{if(!this.#done)this.#fail('transport-invalid');});
      child.once('close',(code,signal)=>{this.#closed=true;this.#finish(code,signal);});
      if(this.#time()===null)invalid();
    }catch{this.#fail('transport-invalid');this.#finish(null,null);invalid();}
  }
  #discardWire(){clearTimeout(this.#timer);this.#wireReady=false;this.#buffer.fill(0);this.#buffer=Buffer.alloc(0);}
  cancel(){if(!this.#done){this.#fail('canceled');this.#finish(null,null);}else this.#discardWire();} // no termination inference or child kill
  // Trusted retention host only. Returns caller-owned EXACT transport bytes,
  // never an encoder's reconstruction, permission, or durable evidence. Even a
  // premature request consumes this one local opportunity; it cannot be retried.
  takeCheckedReportWire(){
    if(this.#wireTaken)invalid();this.#wireTaken=true;
    if(!this.#done||!this.#retainWire||!this.#wireReady||this.#reason)invalid();
    let copied;
    try{
      if(this.#time()===null)invalid();copied=Buffer.from(this.#buffer);
      if(this.#time()===null){copied.fill(0);invalid();}return copied;
    }finally{this.#discardWire();}
  }
  waitForObservation(){
    if(!this.#attached&&!this.#done){this.#fail('transport-invalid');this.#finish(null,null);}return this.#pending;
  }
  #finish(code,signal){
    if(this.#done)return;
    let now=this.#time();let claims=null;
    if(!this.#reason){
      if(!this.#closed||!this.#ended||code!==0||signal!==null)this.#fail('transport-close-unconfirmed');
      else if(this.#length!==384)this.#fail('transport-invalid');
      else try{claims=decodeMetadataBootstrapReport(this.#buffer,this.#pins.runNonce,this.#pins.bundleDigest,this.#pins.fixtureDigest);}catch{this.#fail('report-invalid');}
    }
    if(!this.#reason)now=this.#time(); // decoding cannot turn a late observation into a timely report
    this.#done=true;
    if(!this.#reason&&this.#retainWire&&!this.#wireTaken){
      this.#wireReady=true;
      // Keep the original timer, never rearm it at close. A delayed timer cannot
      // extend disclosure: takeCheckedReportWire rechecks around copying.
    }else this.#discardWire();
    this.#settle(Object.freeze({kind:'metadata-bootstrap-collected-not-verification',status:this.#reason?'unconfirmed':'reported',reason:this.#reason,
      transportCloseObserved:this.#closed,elapsedMs:now===null?null:Math.ceil(now-this.#start),claims:this.#reason?null:claims,
      observerStopProven:false,guestStopProven:false,verificationEvidence:false,durableEvidenceRetained:false,authority:'none'}));
  }
}
