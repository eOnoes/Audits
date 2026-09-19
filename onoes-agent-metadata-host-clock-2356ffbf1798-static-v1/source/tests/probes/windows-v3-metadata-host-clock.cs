// Same-host/boot runtime primitive, NOT a wire authenticator or effect permission.
// Origin/run/budget input must come from an already-authenticated host context.
// No guest/reboot adoption, public reset, injected reader or Stopwatch transport.
using System;
using System.Diagnostics;
namespace Onoes.MetadataExperiment {
    public sealed class MetadataHostRunClock {
        readonly object gate=new object();readonly MetadataHostClockState state;
        MetadataHostRunClock(long origin,long frequency,byte[] nonce,int workMs){
            state=new MetadataHostClockState(origin,frequency,nonce,workMs);
            RequireBefore(workMs);
        }
        public static MetadataHostRunClock CaptureInTrustedHost(byte[] nonce,int workMs){
            return new MetadataHostRunClock(Stopwatch.GetTimestamp(),Stopwatch.Frequency,nonce,workMs);
        }
        public static MetadataHostRunClock ReceiveInTrustedHost(long originTicks,long frequency,byte[] nonce,int workMs){
            return new MetadataHostRunClock(originTicks,frequency,nonce,workMs);
        }
        public long OriginTicks {get{return state.OriginTicks;}}
        public long Frequency {get{return state.Frequency;}}
        public int WorkMs {get{return state.WorkMs;}}
        public int StopDeadlineMs {get{return state.WorkMs+5000;}}
        public int RetentionDeadlineMs {get{return state.WorkMs+10000;}}
        public int CodePreparationDeadlineMs {get{return Math.Min(state.WorkMs,5000);}}
        public byte[] CopyNonce(){lock(gate){return state.CopyNonce();}}
        long Sample(){
            try{return state.Observe(Stopwatch.GetTimestamp(),Stopwatch.Frequency,Stopwatch.IsHighResolution);}
            catch{state.Invalidate();throw new InvalidOperationException("metadata-host-clock-unavailable");}
        }
        // PowerShell's property adapter can turn a throwing getter into $null.
        // Script consumers MUST use this method so failure is terminating.
        public long ReadElapsedMilliseconds(){lock(gate){return Sample();}}
        public long ElapsedMilliseconds {get{return ReadElapsedMilliseconds();}}
        public void RequireBefore(long deadlineMs){lock(gate){state.RequireBefore(Sample(),deadlineMs);}}
        public void RequireRun(byte[] nonce,int workMs){lock(gate){
            state.RequireBinding(nonce,workMs);state.RequireBefore(Sample(),state.WorkMs);
        }}
        public void RequireBudget(int workMs){lock(gate){state.RequireBudget(workMs);state.RequireBefore(Sample(),state.WorkMs);}}
        // Denial only; internal fault seams cannot supply a replacement time.
        internal void Invalidate(){lock(gate){state.Invalidate();}}
    }
}
