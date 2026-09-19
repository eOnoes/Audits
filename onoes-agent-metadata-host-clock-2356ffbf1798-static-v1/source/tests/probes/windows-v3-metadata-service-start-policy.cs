// Pure one-attempt startup accounting; snapshots are NOT authority or stop proof.
using System;
namespace Onoes.MetadataExperiment {
    internal sealed class MetadataStartSnapshot {
        internal readonly int EnableAttempted,Enabled,StartAttempted,StartReturned,Observed;
        internal readonly bool Uncertain,Finished,Transferred;
        internal MetadataStartSnapshot(int ea,int en,int sa,int sr,int ob,bool u,bool f,bool t) {
            EnableAttempted=ea;Enabled=en;StartAttempted=sa;StartReturned=sr;Observed=ob;Uncertain=u;Finished=f;Transferred=t;
        }
    }
    internal sealed class MetadataServiceStartPolicy {
        int enableAttempted,enabled,startAttempted,startReturned,observed,next,phase;
        long last;
        bool uncertain,finished,transferred;
        void Deny() { uncertain=true;throw new InvalidOperationException("metadata-service-start-policy"); }
        void Time(long now) { if(now<0 || now<last || now>=25000 || uncertain || transferred) Deny();last=now; }
        void Step(int index,int expected,long now) {
            Time(now);if(finished || index<0 || index>=3 || index!=next || phase!=expected) Deny();
        }
        internal void BeginEnable(int index,long now) { Step(index,0,now);enableAttempted|=1<<index;phase=1; }
        internal void Enabled(int index,long now) { Step(index,1,now);enabled|=1<<index;phase=2; }
        internal void BeginStart(int index,long now) { Step(index,2,now);startAttempted|=1<<index;phase=3; }
        internal void StartReturned(int index,bool succeeded,long now) {
            Step(index,3,now);if(!succeeded) Deny();startReturned|=1<<index;phase=4;
        }
        internal void Observed(int index,long now) { Step(index,4,now);observed|=1<<index;phase=0;next++; }
        internal void Finish(long now) { Time(now);if(finished || observed!=7 || phase!=0) Deny();finished=true; }
        internal void Transfer(long now) { Time(now);if(!finished || observed!=7) Deny();transferred=true; }
        internal void Failed() { uncertain=true; }
        internal MetadataStartSnapshot Snapshot() {
            return new MetadataStartSnapshot(enableAttempted,enabled,startAttempted,startReturned,observed,uncertain,finished,transferred);
        }
        // Late/false returns retain attempted bits. Enabled/StartReturned record
        // in-time observations, not absence of an effect when their bits are zero.
    }
}
