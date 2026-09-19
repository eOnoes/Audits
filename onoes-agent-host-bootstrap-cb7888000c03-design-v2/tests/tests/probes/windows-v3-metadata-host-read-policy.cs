// TEST-ONLY host read accounting. Fabricated native results are not OS evidence.
using System;
namespace Onoes.MetadataExperiment {
    internal enum HostReadRoute { GuardFromController=1,GuardFromWatchdog=2,GuardFromStop=3,ControllerFromGuard=4,WatchdogFromGuard=5,StopFromGuard=6 }
    internal sealed class MetadataHostReadPolicy {
        readonly int[] frames;readonly int work;readonly bool firstIsWork;
        int frame,remaining,chunks;long last,operationDeadline,drainDeadline;
        bool returned,denied,uncertain,cancelReported;
        internal bool Outstanding {get;private set;}
        internal bool Settled {get;private set;}
        internal bool Finished {get;private set;}
        internal bool CancelNeeded {get;private set;}
        internal bool CancelAttempted {get;private set;}
        internal int Requested {get;private set;}
        internal uint Bytes {get;private set;}
        internal bool MayRelease {get{return !Outstanding||Settled;}}
        internal bool MayDeliver {get{return Outstanding&&Settled&&!denied&&!uncertain;}}
        internal bool EofAccepted {get;private set;}
        internal bool Closed {get{return denied||uncertain||Finished;}}
        internal bool MustRetain {get{return Outstanding&&!Settled&&(uncertain||(CancelNeeded&&last>=drainDeadline));}}
        internal int PositiveChunks {get{return chunks;}}
        internal static int[] FrameSizes(HostReadRoute route){
            // Fresh arrays: read and write share a fixed itinerary, never mutable global state.
            switch(route){
                case HostReadRoute.GuardFromController:return new[]{208,248,452};
                case HostReadRoute.GuardFromWatchdog:return new[]{208,208};
                case HostReadRoute.GuardFromStop:return new[]{208,408};
                case HostReadRoute.ControllerFromGuard:return new[]{208};
                case HostReadRoute.WatchdogFromGuard:return new[]{408};
                case HostReadRoute.StopFromGuard:return new[]{208};
                default:throw new InvalidOperationException("host-read-route");
            }
        }
        internal MetadataHostReadPolicy(HostReadRoute route,int workMs){
            if(workMs<1||workMs>25000)throw new InvalidOperationException("host-read-budget");work=workMs;
            frames=FrameSizes(route);firstIsWork=route!=HostReadRoute.WatchdogFromGuard;
            remaining=frames[0];drainDeadline=work+10000;
        }
        void BadOrder(){denied=true;throw new InvalidOperationException("host-read-order");}
        internal void Tick(long now,bool cancel){
            if(now<0||now<last){uncertain=true;denied=true;}else last=now;
            long deadline=Outstanding?operationDeadline:(frame==0&&firstIsWork?work:work+10000);
            if(cancel||uncertain||now>=deadline){
                denied=true;
                if(!CancelNeeded){CancelNeeded=true;if(now>=0&&now<work+10000)drainDeadline=Math.Min(drainDeadline,now+1000);}
            }
        }
        internal int Begin(long now){
            Tick(now,false);if(Outstanding||Closed){BadOrder();return 0;}
            if(frame<frames.Length&&chunks>=64){denied=true;throw new InvalidOperationException("host-read-chunks");}
            Requested=frame==frames.Length?1:remaining;
            operationDeadline=frame==0&&firstIsWork?work:work+10000;
            Outstanding=true;returned=false;Settled=false;Bytes=0;EofAccepted=false;return Requested;
        }
        internal void StartReturned(bool success,int error,long now){
            Tick(now,false);if(!Outstanding||returned||Settled||uncertain){BadOrder();return;}returned=true;
            if(success||error==997)return; // even immediate success is queried, never use an undefined byte count
            CompleteError(error); // failed submission: no pending I/O was reported
        }
        void CompleteError(int error){
            Settled=true;
            if(error==109&&frame==frames.Length&&!denied&&!uncertain){EofAccepted=true;Finished=true;}
            else denied=true;
        }
        internal void Observe(bool success,int error,uint bytes,long now){
            Tick(now,false);if(!Outstanding||!returned||Settled||uncertain){BadOrder();return;}
            if(!success){
                if(error==996)return;
                if(error==995||error==109||error==232||error==233||error==234){CompleteError(error);return;}
                Abandon();return; // invalid handle/parameter or unclassified completion: cannot release
            }
            Settled=true;Bytes=bytes;
            // A successful zero-byte read can be a zero-byte message, not writer closure.
            if(frame==frames.Length||bytes==0||bytes>(uint)Requested||++chunks>64){denied=true;return;}
            remaining-=(int)bytes;if(remaining==0){frame++;if(frame<frames.Length)remaining=frames[frame];}
        }
        internal void MarkCancel(){if(!Outstanding||Settled||CancelAttempted){BadOrder();return;}Tick(last,true);CancelAttempted=true;}
        internal void CancelReturned(bool success,int error){
            if(!CancelAttempted||cancelReported){BadOrder();return;}cancelReported=true;
            // Success, ERROR_NOT_FOUND and all other cancellation returns prove no settlement.
        }
        internal void ReleaseOperation(){
            if(!Outstanding||!Settled){BadOrder();return;}Outstanding=false;
        }
        internal void Abandon(){uncertain=true;denied=true;CancelNeeded=true;}
    }
}
