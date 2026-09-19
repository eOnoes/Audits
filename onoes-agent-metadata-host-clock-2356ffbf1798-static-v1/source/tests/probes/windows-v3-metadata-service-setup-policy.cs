// TEST-ONLY disabled-definition accounting. Never an enable/start permit.
using System;
namespace Onoes.MetadataExperiment {
    internal sealed class MetadataSetupSnapshot {
        internal readonly int Attempted,Created,Verified;
        internal readonly bool Uncertain;
        internal MetadataSetupSnapshot(int attempted,int created,int verified,bool uncertain) {
            Attempted=attempted;Created=created;Verified=verified;Uncertain=uncertain;
        }
    }
    internal sealed class MetadataServiceSetupPolicy {
        internal const uint CreateAccess=0xe0007; // QUERY_CONFIG|CHANGE_CONFIG|QUERY_STATUS|READ_CONTROL|WRITE_DAC|WRITE_OWNER
        internal const int LimitMs=25000;
        int attempted,created,verified,next,pending;
        long last;
        bool uncertain,finished;
        void Deny() { uncertain=true;throw new InvalidOperationException("metadata-service-setup-policy"); }
        void Time(long now) { if(now<0 || now<last || now>=LimitMs || uncertain || finished) Deny();last=now; }
        internal void BeginCreate(int index,long now) {
            Time(now);if(index!=next || index<0 || index>=3 || pending!=0 || attempted!=(1<<index)-1 || verified!=attempted) Deny();
            attempted|=1<<index;pending=1;
        }
        internal void CreatedDisabled(int index,long now) {
            Time(now);if(index!=next || pending!=1) Deny();created|=1<<index;pending=2;
        }
        internal void VerifiedDisabled(int index,long now) {
            Time(now);if(index!=next || pending!=2) Deny();verified|=1<<index;pending=0;next++;
        }
        internal void Finish(long now) { Time(now);if(verified!=7 || pending!=0) Deny();finished=true; }
        internal void Failed() { uncertain=true; }
        internal MetadataSetupSnapshot Snapshot() { return new MetadataSetupSnapshot(attempted,created,verified,uncertain); }
        // Created/Verified mean in-time observations only. A late/failed RPC can
        // leave more objects than these masks say; Attempted + Uncertain must be
        // reconciled externally. Failure never undoes a possible SCM mutation.
    }
}
