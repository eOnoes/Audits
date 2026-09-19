// Pure arithmetic for the pinned Windows libuv QPC conversion. Not a live clock,
// authentication or permission. Runtime code never accepts this object from callers.
const deny=()=>{throw Error('metadata-node-clock-unavailable');};
const max=(1n<<63n)-1n,nsPerMs=1000000n,nsPerSecond=1000000000n;
const positive=v=>typeof v==='bigint'&&v>0n&&v<=max;
export class MetadataNodeClockState {
  #originNs;#guard;#last=0n;#invalid=false;#work;
  constructor(originTicks,frequency,workMs){
    if(!positive(originTicks)||!positive(frequency)||!Number.isSafeInteger(workMs)||workMs<1||workMs>25000)deny();
    this.#originNs=originTicks*nsPerSecond/frequency;
    if(!positive(this.#originNs))deny();
    // Binary64 conversions/divisions in pinned libuv have <2^-49 relative
    // error (including integer conversions). For accepted samples <=2^63-1,
    // true nanoseconds <2^64: <32768ns error, plus <1ns truncation. 1ms is a
    // deliberately larger allowance. Add one QPC tick for cross-thread sampling.
    this.#guard=nsPerMs+(nsPerSecond+frequency-1n)/frequency;
    this.#work=workMs;Object.freeze(this);
  }
  invalidate(){this.#invalid=true;}
  observe(nowNs){
    if(this.#invalid||!positive(nowNs)||nowNs<this.#last||nowNs<this.#originNs+this.#guard+1n){this.#invalid=true;deny();}
    this.#last=nowNs;
    // Subtract exact BigInts before conversion; round UP, never grant later
    // than the original deadline. Saturation preserves expiry, not renewal.
    const upper=(nowNs+this.#guard-this.#originNs+nsPerMs-1n)/nsPerMs;
    return Number(upper>35000n?35000n:upper);
  }
  requireBefore(elapsed,deadlineMs){
    if(this.#invalid||!Number.isSafeInteger(elapsed)||elapsed<0||elapsed>35000||!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>this.#work+10000){this.#invalid=true;deny();}
    if(elapsed>=deadlineMs)throw Error('metadata-node-clock-expired');
  }
}
Object.freeze(MetadataNodeClockState.prototype);
