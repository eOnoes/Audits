// TEST-ONLY fixed host writes. Whole-frame once, never retry a short/uncertain write.
// Completion means local byte transfer, not peer acceptance or effect settlement.
using System;
namespace Onoes.MetadataExperiment {
    internal sealed class MetadataHostWritePolicy {
        readonly int[] frames;readonly int work;readonly bool firstIsWork;
        int frame;long last,operationDeadline,drainDeadline;
        bool returned,denied,uncertain,cancelReported;
        internal bool Outstanding {get;private set;}
        internal bool Settled {get;private set;}
        internal bool CancelNeeded {get;private set;}
        internal bool CancelAttempted {get;private set;}
        internal bool Finished {get{return frame==frames.Length;}}
        internal bool Closed {get{return denied||uncertain||Finished;}}
        internal bool MayRelease {get{return !Outstanding||Settled;}}
        internal bool MayAcknowledge {get{return Outstanding&&Settled&&!denied&&!uncertain;}}
        internal bool MaySubmit {get{return Outstanding&&!returned&&!denied&&!uncertain;}}
        internal bool MustRetain {get{return Outstanding&&!Settled&&(uncertain||(CancelNeeded&&last>=drainDeadline));}}
        internal int Requested {get;private set;}
        internal MetadataHostWritePolicy(HostReadRoute route,int workMs){
            if(workMs<1||workMs>25000)throw new InvalidOperationException("host-write-budget");
            frames=MetadataHostReadPolicy.FrameSizes(route);firstIsWork=route!=HostReadRoute.WatchdogFromGuard;work=workMs;drainDeadline=work+10000;
        }
        void BadOrder(){denied=true;throw new InvalidOperationException("host-write-order");}
        internal void Tick(long now,bool cancel){
            if(now<0||now<last){uncertain=true;denied=true;}else last=now;
            long deadline=Outstanding?operationDeadline:(frame==0&&firstIsWork?work:work+10000);
            if(cancel||uncertain||now>=deadline){
                denied=true;if(!CancelNeeded){CancelNeeded=true;if(now>=0&&now<work+10000)drainDeadline=Math.Min(drainDeadline,now+1000);}
            }
        }
        internal byte[] Begin(byte[] input,long now){
            Tick(now,false);if(Outstanding||Closed||input==null||input.Length!=frames[frame]){BadOrder();return null;}
            // Bound before snapshot. Trusted same-process arrays must not be concurrently mutated.
            byte[] snapshot=(byte[])input.Clone();Requested=snapshot.Length;
            operationDeadline=frame==0&&firstIsWork?work:work+10000;
            Outstanding=true;returned=false;Settled=false;return snapshot;
        }
        internal void StartReturned(bool success,int error,long now){
            Tick(now,false);if(!Outstanding||returned||Settled||uncertain){BadOrder();return;}returned=true;
            if(success||error==997)return;Settled=true;denied=true;
        }
        internal void Observe(bool success,int error,uint bytes,long now){
            Tick(now,false);if(!Outstanding||!returned||Settled||uncertain){BadOrder();return;}
            if(!success){
                if(error==996)return;
                if(error==995||error==109||error==232||error==233||error==234){Settled=true;denied=true;return;}
                Abandon();return;
            }
            Settled=true;
            if(bytes!=(uint)Requested){denied=true;return;} // no suffix retry, even when partial bytes were written
            frame++;
        }
        internal void MarkCancel(){if(!Outstanding||Settled||CancelAttempted){BadOrder();return;}Tick(last,true);CancelAttempted=true;}
        internal void CancelReturned(bool success,int error){if(!CancelAttempted||cancelReported){BadOrder();return;}cancelReported=true;}
        internal void ReleaseOperation(){if(!Outstanding||!Settled){BadOrder();return;}Outstanding=false;}
        internal void Abandon(){uncertain=true;denied=true;CancelNeeded=true;}
    }
}
