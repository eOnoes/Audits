// Controller preparation only: owns an already-launched watchdog's pipes, not a
// VM, protected file sink or guest dispatch. Received claims are NOT OS evidence.
import {performance} from 'node:perf_hooks';
import {MetadataWatchdogArmWindow} from './windows-v3-metadata-arm.mjs';
import {bindMetadataNodeHostClock} from './windows-v3-metadata-node-clock.mjs';
const unavailable=()=>{throw Error('metadata-watchdog-session-unavailable');};
const booleans=['armed','stopAttempted','hostOffObserved','stopJobSettled','stopWithinBudget','controllerDispatchClosed','guestStopProven','verificationEvidence'];
const fields=['kind','inventoryDigest','runNonce','bundleDigest','armed','trigger','stopAttempted','hostOffObserved','stopJobSettled','stopWithinBudget','controllerDispatchClosed','guestStopProven','verificationEvidence','authority'];
export class MetadataWatchdogSession {
  #arm; #pins; #clock; #started; #last; #deadline; #timer; #child;
  #bytes=Buffer.alloc(0); #chunks=0; #bad=null; #rootClosed=false; #ended=false;
  #claimed=false; #done=false; #settle; #result; #waiting;
  static fromHostClock(pins,hostClock){
    const bound=bindMetadataNodeHostClock(hostClock,pins.clockReference,pins.runNonce,pins.workMs);
    return new MetadataWatchdogSession(pins,bound.read,bound.startedAtMs);
  }
  constructor(pins,clock=()=>performance.now(),startedAtMs=undefined){
    // Options/clock/ChildProcess are trusted launcher inputs. Only stream bytes
    // are hostile transport. No constructor value authenticates operator consent.
    this.#clock=clock;
    let now;
    try{now=clock();this.#started=startedAtMs===undefined?now:startedAtMs;
      if(!Number.isFinite(now)||!Number.isFinite(this.#started)||this.#started<0||now<this.#started)unavailable();}
    catch{unavailable();}
    let initial=true;
    this.#arm=new MetadataWatchdogArmWindow(pins,()=>{if(initial){initial=false;return now;}return clock();},this.#started);
    this.#pins=Object.freeze({inventoryDigest:pins.inventoryDigest,runNonce:pins.runNonce,bundleDigest:pins.bundleDigest,workMs:pins.workMs,
      clockReference:pins.clockReference,intentReference:pins.intentReference});
    this.#last=now;this.#deadline=this.#started+pins.workMs+5000;
    this.#waiting=new Promise(resolve=>{this.#settle=resolve;});
    this.#timer=setTimeout(()=>{this.#fail('observation-timeout');this.#finish(null,null);},this.#deadline-now);this.#timer.unref();
  }
  #fail(reason){if(!this.#bad)this.#bad=reason;this.#arm.close();}
  #time(){
    try{
      const now=this.#clock();
      if(!Number.isFinite(now)||now<this.#last){this.#fail('clock-invalid');return null;}
      this.#last=now;if(now>=this.#deadline){this.#fail('late-observation');return null;}return now;
    }catch{this.#fail('clock-invalid');return null;}
  }
  attach(child){
    if(this.#done||this.#child){this.#fail('transport-invalid');unavailable();}
    try{
      // Arm attach verifies the original ChildProcess/pipe shape. No await or
      // caller callback between its registration and this bounded collector.
      this.#arm.attach(child);this.#child=child;
      child.stdout.on('data',chunk=>{
        if(this.#done)return;
        if(this.#time()===null)return;
        if(!Buffer.isBuffer(chunk)||++this.#chunks>128||this.#bytes.length+chunk.length>4096){this.#fail('transport-invalid');return;}
        if(!this.#bad)this.#bytes=Buffer.concat([this.#bytes,chunk]);
      });
      child.stderr.on('data',()=>this.#fail('transport-invalid')); // discard diagnostics, never retain/disclose
      child.stderr.once('error',()=>this.#fail('transport-invalid'));
      child.stdout.once('end',()=>{this.#ended=true;});
      child.stdout.once('error',()=>this.#fail('transport-invalid'));
      child.once('error',()=>this.#fail('transport-invalid'));
      child.once('close',(code,signal)=>{this.#rootClosed=true;this.#finish(code,signal);});
    }catch{this.#fail('transport-invalid');this.#finish(null,null);unavailable();}
  }
  async waitForArm(){
    try{if(!this.#child||this.#bad||this.#done)unavailable();return await this.#arm.waitForArm();}
    catch{this.#fail('arm-unconfirmed');unavailable();}
  }
  claimDispatch(){
    try{if(this.#bad||this.#done)unavailable();const value=this.#arm.claimDispatch();this.#claimed=true;return value;}
    catch{this.#fail('arm-unconfirmed');return unavailable();}
  }
  requestStop(){this.#arm.close();} // local closure + EOF request, never Stop confirmation
  waitForObservation(){
    if(!this.#child&&!this.#done){this.#fail('transport-invalid');this.#finish(null,null);}
    return this.#waiting;
  }
  #parse(){
    const text=this.#bytes.toString('utf8');if(!Buffer.from(text).equals(this.#bytes))unavailable();
    const lines=text.split('\n');if(lines.length!==3||lines[2]!=='')unavailable();
    const {inventoryDigest,runNonce,bundleDigest,workMs,clockReference,intentReference}=this.#pins;
    const expected=JSON.stringify({kind:'metadata-watchdog-armed-v2-not-authorization',inventoryDigest,runNonce,bundleDigest,workMs,stopMs:5000,clockReference,intentReference});
    if(lines[0]!==expected)unavailable();
    const terminal=lines[1].endsWith('\r')?lines[1].slice(0,-1):lines[1],record=JSON.parse(terminal);
    if(!record||typeof record!=='object'||Array.isArray(record)||Object.keys(record).join()!==fields.join()||JSON.stringify(record)!==terminal||
      record.kind!=='metadata-watchdog-observation-not-verification'||record.inventoryDigest!==this.#pins.inventoryDigest||
      record.runNonce!==this.#pins.runNonce||record.bundleDigest!==this.#pins.bundleDigest||record.authority!=='none'||
      booleans.some(name=>typeof record[name]!=='boolean')||record.controllerDispatchClosed||record.guestStopProven||record.verificationEvidence||
      !['arm-failed','deadline','owner-eof','unexpected-input','lifeline-error'].includes(record.trigger)||
      (record.armed?(record.trigger==='arm-failed'):(record.trigger!=='arm-failed'))||
      (record.stopWithinBudget&&(!record.hostOffObserved||!record.stopJobSettled)))unavailable();
    return Object.freeze(record);
  }
  #finish(code,signal){
    if(this.#done)return;
    let now=this.#time();let report=null;
    if(!this.#bad){
      if(!this.#rootClosed||!this.#ended||code!==0||signal!==null)this.#fail('root-exit-unconfirmed');
      else try{report=this.#parse();}catch{this.#fail('transport-invalid');}
    }
    if(!this.#bad)now=this.#time(); // parsed bytes cannot override a crossed observation deadline
    this.#done=true;clearTimeout(this.#timer);this.#arm.close();
    this.#bytes.fill(0);this.#bytes=Buffer.alloc(0);
    this.#result=Object.freeze({kind:'metadata-watchdog-collected-not-verification',status:this.#bad?'unconfirmed':'reported',reason:this.#bad,
      rootCloseObserved:this.#rootClosed,localClaimMade:this.#claimed,elapsedMs:now===null?null:Math.ceil(now-this.#started),
      report:this.#bad?null:report,controllerDispatchClosed:false,guestStopProven:false,verificationEvidence:false,authority:'none'});
    this.#settle(this.#result);
  }
}
