// Pure preparation bookkeeping. Discovery/creation are NOT enrollment or authority.
using System;
namespace Onoes.MetadataExperiment {
    internal sealed class MetadataHostRootSnapshot {
        internal readonly bool Attempted,Created,Verified,Finished,Uncertain;
        internal MetadataHostRootSnapshot(bool attempted,bool created,bool verified,bool finished,bool uncertain){
            Attempted=attempted;Created=created;Verified=verified;Finished=finished;Uncertain=uncertain;
        }
    }
    internal sealed class MetadataHostRootPolicy {
        internal const long BudgetMs=5000;
        long last;int stage;bool attempted,created,verified,finished,failed;
        void Need(bool value){if(!value){Failed();throw new InvalidOperationException("metadata-host-root-unavailable");}}
        void Time(long now){Need(!failed && !finished && now>=last && now>=0 && now<BudgetMs);last=now;}
        internal void Begin(long now){Time(now);Need(stage==0);attempted=true;stage=1;}
        // Preserve observed effects even when the native call returned late.
        internal void Created(long now){Need(!failed && stage==1);created=true;stage=2;Time(now);}
        internal void Verified(long now){Need(!failed && stage==2);verified=true;stage=3;Time(now);}
        internal void Finish(long now){Time(now);Need(stage==3);finished=true;stage=4;}
        internal void Failed(){failed=true;finished=false;}
        internal MetadataHostRootSnapshot Snapshot(){return new MetadataHostRootSnapshot(attempted,created,verified,finished,failed);}
    }
    internal sealed class MetadataHostRootProposal {
        internal const string Kind="created-host-root-identity-not-enrollment";
        internal readonly string VolumeRoot;
        internal readonly uint Volume,IndexHigh,IndexLow;
        internal bool ExecutionAuthorized {get{return false;}}
        internal MetadataHostRootProposal(string root,uint volume,uint high,uint low){
            MetadataFixturePolicy.VolumeRoot(root);
            if(high==0 && low==0)throw new InvalidOperationException("metadata-host-root-unavailable");
            VolumeRoot=root;Volume=volume;IndexHigh=high;IndexLow=low;
        }
    }
}
