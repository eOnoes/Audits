// Pure local inherited-channel bookkeeping, NOT peer admission or readiness.
// Observations must eventually come from a trusted native child startup adapter.
using System;
namespace Onoes.MetadataExperiment {
    internal sealed class HostChildChannelPolicy {
        readonly int[] ends;readonly long[] handles;readonly int deadline;
        long last;int next;bool pending,closed,complete;
        internal bool Closed {get{return closed;}}
        internal bool LocallyChecked {get{return complete&&!closed;}}
        internal HostChildChannelPolicy(HostActor role,int work){
            ends=HostInheritancePolicy.Ends(role);
            if(work<1||work>25000)throw new InvalidOperationException("host-child-budget");
            handles=new long[ends.Length];deadline=Math.Min(work,5000);
        }
        void Need(bool ok){if(!ok){closed=true;throw new InvalidOperationException("host-child-order");}}
        void Time(long originalElapsed){
            Need(!closed&&originalElapsed>=0&&originalElapsed>=last&&originalElapsed<deadline);
            last=originalElapsed;
        }
        // A token is a fixture representation, not an accepted native handle.
        // Route sign binds the expected ownership map, NOT actual granted access.
        internal void BeforeClear(int end,long token,uint fileType,uint flags,long originalElapsed){
            Time(originalElapsed);Need(!complete&&!pending&&next<ends.Length);
            Need(end==ends[next]&&token>0&&fileType==3&&flags==1);
            for(int i=0;i<next;i++)Need(handles[i]!=token);
            handles[next]=token;pending=true;
        }
        // A successful SetHandleInformation alone is insufficient: verify flags
        // and type again on the SAME retained handle before moving to the next.
        internal void AfterClear(long token,bool callSucceeded,uint fileType,uint flags,long originalElapsed){
            Time(originalElapsed);Need(!complete&&pending&&next<ends.Length);
            Need(token==handles[next]&&callSucceeded&&fileType==3&&flags==0);
            pending=false;next++;
        }
        internal void Finish(long originalElapsed){
            Time(originalElapsed);Need(!complete&&!pending&&next==ends.Length);complete=true;
        }
        // Recheck original time before consuming the local result. It cannot be
        // converted into readiness without separate access/context/peer proof.
        internal void RequireLocallyChecked(long originalElapsed){Time(originalElapsed);Need(complete);}
        internal void Close(){closed=true;}
    }
}
