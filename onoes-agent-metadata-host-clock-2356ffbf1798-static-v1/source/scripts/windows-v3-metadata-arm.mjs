// Test-preparation controller seam, not a production launcher or effect permit.
// No process creation, VM contact, installation, credential or guest dispatch.
// Trusted launcher supplies the ChildProcess and monotonic clock; Node process
// events are not retained native handles or atomic liveness/dispatch custody.
// V2 pins must come from the trusted launcher, NOT the incoming arm. This class
// fromHostClock uses the pinned original QPC clock. The default constructor is
// a synthetic process-local seam, not the physical launcher's timing contract.
import {ChildProcess} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {bindMetadataNodeHostClock} from './windows-v3-metadata-node-clock.mjs';

const invalid=()=>{throw Error('metadata-watchdog-arm-unavailable');};
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)&&value!=='0'.repeat(64);
export class MetadataWatchdogArmWindow {
  #clock; #last; #deadline; #expected; #child; #armed=false; #closed=false;
  #claimed=false; #attached=false; #buffer=Buffer.alloc(0); #timer; #settle; #ready;
  static fromHostClock(pins,hostClock){
    const bound=bindMetadataNodeHostClock(hostClock,pins.clockReference,pins.runNonce,pins.workMs);
    return new MetadataWatchdogArmWindow(pins,bound.read,bound.startedAtMs);
  }
  constructor({inventoryDigest,runNonce,bundleDigest,workMs,clockReference,intentReference},clock=()=>performance.now(),startedAtMs=undefined){
    if(![inventoryDigest,runNonce,bundleDigest,clockReference,intentReference].every(digest)||!Number.isSafeInteger(workMs)||workMs<1||workMs>25000||typeof clock!=='function')invalid();
    this.#clock=clock;this.#last=clock();if(!Number.isFinite(this.#last)||this.#last<0)invalid();
    const start=startedAtMs===undefined?this.#last:startedAtMs;
    if(!Number.isFinite(start)||start<0||start>this.#last)invalid();
    this.#deadline=start+workMs;if(this.#last>=this.#deadline)invalid();
    this.#expected=Buffer.from(JSON.stringify({kind:'metadata-watchdog-armed-v2-not-authorization',inventoryDigest,runNonce,bundleDigest,workMs,stopMs:5000,clockReference,intentReference})+'\n');
    this.#ready=new Promise(resolve=>{this.#settle=resolve;});
    // Created BEFORE spawning the guardian. Arm receipt never renews this budget.
    this.#timer=setTimeout(()=>this.close(),this.#deadline-this.#last);this.#timer.unref();
  }
  #remaining(){
    try{
      const now=this.#clock();
      if(this.#closed||!Number.isFinite(now)||now<this.#last||now>=this.#deadline)invalid();
      this.#last=now;return this.#deadline-now;
    }catch{this.close();return invalid();}
  }
  #live(){
    const child=this.#child;
    if(!child||!Number.isSafeInteger(child.pid)||child.pid<=0||child.exitCode!==null||child.signalCode!==null||child.killed||
      child.stdout.destroyed||child.stdout.readableEnded||child.stdin.destroyed||child.stdin.writableEnded)invalid();
  }
  attach(child){
    try{
      this.#remaining();if(this.#attached)invalid();this.#attached=true;
      if(!(child instanceof ChildProcess)||!child.stdout||!child.stdin)invalid();
      this.#child=child;
      child.once('error',()=>this.close());child.once('exit',()=>this.close());child.once('close',()=>this.close());
      child.stdout.once('end',()=>this.close());child.stdout.once('error',()=>this.close());child.stdout.once('close',()=>this.close());
      child.stdin.once('error',()=>this.close());child.stdin.once('close',()=>this.close());
      this.#live();this.#remaining();
      child.stdout.on('data',chunk=>{
        try{
          this.#remaining();this.#live();
          // Bytes after the arm (including a terminal report) permanently stop
          // forward claims. A separate retained sink must collect final evidence.
          if(this.#armed||!Buffer.isBuffer(chunk)||chunk.length===0||this.#buffer.length+chunk.length>1024)invalid();
          this.#buffer=Buffer.concat([this.#buffer,chunk]);
          if(this.#buffer.includes(10)){
            if(!this.#buffer.equals(this.#expected))invalid();
            this.#armed=true;this.#buffer.fill(0);this.#buffer=Buffer.alloc(0);
            this.#remaining();this.#settle(true);
          }
        }catch{this.close();}
      });
    }catch{this.close();invalid();}
  }
  async waitForArm(){
    if(!this.#attached){this.close();invalid();}
    if(!await this.#ready)invalid();
    try{this.#remaining();this.#live();if(!this.#armed)invalid();}
    catch{this.close();invalid();}
    return Object.freeze({kind:'metadata-arm-observed-not-authorization',authority:'none'});
  }
  claimDispatch(){
    try{
      // Consumption precedes any return. This is a single local accounting mark,
      // NOT guest dispatch, approval consumption or proof of no later OS race.
      if(this.#claimed)invalid();this.#claimed=true;
      const remainingMs=this.#remaining();this.#live();if(!this.#armed)invalid();
      return Object.freeze({kind:'metadata-dispatch-claim-not-authorization',remainingMs,authority:'none'});
    }catch{this.close();return invalid();}
  }
  close(){
    if(this.#closed)return;this.#closed=true;clearTimeout(this.#timer);
    this.#buffer.fill(0);this.#buffer=Buffer.alloc(0);this.#settle(false);
    // Close only the owned lifeline. EOF asks the guardian to attempt its stop;
    // it is not stop confirmation and does not kill/restart any host/VM process.
    try{if(this.#child&&!this.#child.stdin.destroyed)this.#child.stdin.end();}catch{}
  }
}
