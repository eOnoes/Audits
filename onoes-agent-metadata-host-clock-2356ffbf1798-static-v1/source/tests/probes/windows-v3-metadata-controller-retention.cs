// HOST COMPILE ONLY. No process, IPC, loader or approval authenticator.
// Caller must supply a protected host, independently enrolled root/pins and the
// original pre-dispatch clock. This wrapper records CLAIMS, never transport proof.
using System;
namespace Onoes.MetadataExperiment {
    public sealed class MetadataControllerRetentionSnapshot {
        public readonly bool ReportWriteAttempted,ReportWriteReadBackReturned,CleanupReturned,LocalRetentionUncertain;
        internal MetadataControllerRetentionSnapshot(bool attempted,bool recorded,bool cleanup,bool uncertain){
            ReportWriteAttempted=attempted;ReportWriteReadBackReturned=recorded;CleanupReturned=cleanup;LocalRetentionUncertain=uncertain;
        }
        public string Kind {get{return "metadata-controller-retention-claims-not-verification";}}
        public bool ReservationReadBackReturned {get{return true;}}
        public bool RequiresReconciliation {get{return true;}}
        public bool DurableEvidenceRetained {get{return false;}}
        public bool ExecutionAuthorized {get{return false;}}
    }
    public sealed class MetadataControllerRetentionBridge : IDisposable {
        readonly object sync=new object();readonly MetadataHostRunClock clock;readonly long deadline;
        readonly byte[] nonce,inventory,bundle,fixture;MetadataHostReportSink owner;
        bool completionClaimed,closed,attempted,recorded,cleanup,failed;
        static void Need(bool value){if(!value)throw new InvalidOperationException("metadata-controller-retention-unavailable");}
        MetadataControllerRetentionBridge(byte[] n,byte[] i,byte[] b,byte[] f,int work,MetadataHostRunClock original){
            nonce=MetadataBytes.DigestCopy(n);inventory=MetadataBytes.DigestCopy(i);bundle=MetadataBytes.DigestCopy(b);fixture=MetadataBytes.DigestCopy(f);
            clock=original;deadline=work+10000;
        }
        void Time(long limit){Need(clock!=null);clock.RequireBefore(limit);}
        public static MetadataControllerRetentionBridge Reserve(string volumeRoot,uint volume,uint high,uint low,
            byte[] nonce,byte[] inventory,byte[] bundle,byte[] fixture,int workMs,MetadataHostRunClock original,
            byte[] clockContext,byte[] clockReference,byte[] hostSession){
            MetadataControllerRetentionBridge value=null;
            try{
                Need(original!=null);original.RequireRun(nonce,workMs);
                value=new MetadataControllerRetentionBridge(nonce,inventory,bundle,fixture,workMs,original);
                var context=MetadataHostClockTransfer.RequireExistingInTrustedHost(original,clockContext,clockReference,hostSession,value.nonce,workMs);
                // After independent checks, re-use OWNED context pins across the
                // native call rather than re-reading mutable caller arrays.
                var reference=MetadataHostClockTransfer.ContextReference(context);var session=MetadataBytes.Slice(context,64,32);
                value.owner=MetadataHostReportSink.ReserveClockBoundInApprovedHost(volumeRoot,volume,high,low,value.nonce,value.inventory,value.bundle,value.fixture,workMs,original,context,reference,session);
                value.Time(workMs);return value;
            }catch{if(value!=null)try{value.Dispose();}catch{}throw new InvalidOperationException("metadata-controller-retention-unavailable");}
        }
        // A checked collector wire is required by the host contract; this method
        // cannot itself prove original transport closure or authenticated origin.
        public MetadataControllerRetentionSnapshot RecordAndClose(byte[] checkedWire){lock(sync){
            Need(!closed && !completionClaimed);completionClaimed=true;byte[] wire=null;
            try{
                Time(deadline);
                wire=MetadataBootstrapReport.Validate(checkedWire,nonce,bundle,BitConverter.ToString(fixture).Replace("-","").ToLowerInvariant());
                Time(deadline);attempted=true;owner.RecordClockBoundBootstrapClaims(wire);recorded=true;Time(deadline);
            }catch{failed=true;}
            finally{
                if(wire!=null)Array.Clear(wire,0,wire.Length);
                CloseOwner();
            }
            try{Time(deadline);}catch{failed=true;}
            return SnapshotCore();
        }}
        MetadataControllerRetentionSnapshot SnapshotCore(){return new MetadataControllerRetentionSnapshot(attempted,recorded,cleanup,failed||!closed||!recorded||!cleanup);}
        public MetadataControllerRetentionSnapshot Snapshot {get{lock(sync){return SnapshotCore();}}}
        void CloseOwner(){
            if(closed)return;closed=true;
            try{if(owner!=null){owner.Dispose();cleanup=true;}}catch{failed=true;}
            foreach(var bytes in new[]{nonce,inventory,bundle,fixture})Array.Clear(bytes,0,bytes.Length);
        }
        public void Dispose(){lock(sync){if(closed)return;failed=true;CloseOwner();
            if(!cleanup)throw new InvalidOperationException("metadata-controller-retention-unavailable");
        }}
    }
}
