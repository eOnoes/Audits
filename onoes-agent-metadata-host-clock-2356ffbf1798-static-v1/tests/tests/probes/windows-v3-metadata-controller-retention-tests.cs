// Real wrapper and codec with fake native storage only. No filesystem/VM effects.
using System;using Onoes.MetadataExperiment;
internal static class ControllerRetentionTests {
    static void Need(bool value){if(!value)throw new Exception("controller-retention-model-failed");}
    static void Deny(Action f){bool bad=false;try{f();}catch(InvalidOperationException e){Need(e.Message=="metadata-controller-retention-unavailable" && e.InnerException==null);bad=true;}Need(bad);}
    static byte[] D(byte n){var b=new byte[32];for(int i=0;i<32;i++)b[i]=n;return b;}
    static MetadataControllerRetentionBridge Open(){
        var clock=MetadataHostRunClock.CaptureInTrustedHost(D(1),25000);var wire=MetadataHostClockTransfer.CreateInTrustedHost(clock,D(7));
        return Open(clock,wire,MetadataHostClockTransfer.ContextReference(wire),D(7));
    }
    static MetadataControllerRetentionBridge Open(MetadataHostRunClock clock,byte[] wire,byte[] reference,byte[] host){
        return MetadataControllerRetentionBridge.Reserve(@"\\?\Volume{00000000-0000-4000-8000-000000000001}\",1,2,3,D(1),D(9),D(2),D(0x33),25000,clock,wire,reference,host);
    }
    static byte[] Report(){return MetadataBootstrapReport.Encode(D(1),D(2),new string('3',64),12,MetadataBootstrapFailure.Provision,null,null,null,null,MetadataCaseCleanup.DisposalReturned);}
    static void NonAuthority(MetadataControllerRetentionSnapshot s){Need(s.Kind=="metadata-controller-retention-claims-not-verification" && s.RequiresReconciliation && !s.DurableEvidenceRetained && !s.ExecutionAuthorized);}
    static int Main(string[] args){
        if(args.Length!=0){Need(args.Length==1 && args[0]=="history-vector");ControllerClockRecordsTests.Vector();return 0;}
        ControllerClockRecordsTests.Run();
        MetadataHostReportSink.Reset();var owner=Open();var before=owner.Snapshot;NonAuthority(before);
        Need(before.ReservationReadBackReturned && before.LocalRetentionUncertain && !before.ReportWriteAttempted && !before.CleanupReturned);
        var bytes=Report();var result=owner.RecordAndClose(bytes);NonAuthority(result);
        Need(result.ReportWriteAttempted && result.ReportWriteReadBackReturned && result.CleanupReturned && !result.LocalRetentionUncertain);
        Need(String.Join(",",MetadataHostReportSink.Trace)=="reserve,record,dispose");
        Need(bytes[0]==79 && Array.TrueForAll(MetadataHostReportSink.LastReport,b=>b==0));
        Need(MetadataControllerClockRecords.ValidateReport(MetadataHostReportSink.LastEnvelope,MetadataHostReportSink.LastIntent).Length==452);
        Need(before.LocalRetentionUncertain && !before.ReportWriteAttempted);Deny(()=>owner.RecordAndClose(bytes));owner.Dispose();
        foreach(byte[] invalid in new[]{null,new byte[0],new byte[383],new byte[384],new byte[385]}){
            MetadataHostReportSink.Reset();owner=Open();result=owner.RecordAndClose(invalid);
            Need(!result.ReportWriteAttempted && !result.ReportWriteReadBackReturned && result.CleanupReturned && result.LocalRetentionUncertain);
            Need(String.Join(",",MetadataHostReportSink.Trace)=="reserve,dispose");Deny(()=>owner.RecordAndClose(Report()));
        }
        MetadataHostReportSink.Reset();owner=Open();bytes=Report();bytes[64]^=1;result=owner.RecordAndClose(bytes);Need(!result.ReportWriteAttempted && result.LocalRetentionUncertain);
        for(int mask=0;mask<4;mask++){
            MetadataHostReportSink.Reset();owner=Open();MetadataHostReportSink.FailRecord=(mask&1)!=0;MetadataHostReportSink.FailDispose=(mask&2)!=0;
            result=owner.RecordAndClose(Report());Need(result.ReportWriteAttempted && result.ReportWriteReadBackReturned==((mask&1)==0) && result.CleanupReturned==((mask&2)==0) && result.LocalRetentionUncertain==(mask!=0));
            Need(String.Join(",",MetadataHostReportSink.Trace)=="reserve,record,dispose");owner.Dispose();Deny(()=>owner.RecordAndClose(Report()));
            Need(Array.TrueForAll(MetadataHostReportSink.LastReport,b=>b==0));NonAuthority(result);
        }
        foreach(bool duringRecord in new[]{false,true}){
            MetadataHostReportSink.Reset();owner=Open();MetadataHostReportSink.StopAtRecord=duringRecord;MetadataHostReportSink.StopAtDispose=!duringRecord;
            result=owner.RecordAndClose(Report());Need(result.ReportWriteReadBackReturned && result.CleanupReturned && result.LocalRetentionUncertain);
        }
        MetadataHostReportSink.Reset();MetadataHostReportSink.StopAtReserve=true;Deny(()=>Open());Need(String.Join(",",MetadataHostReportSink.Trace)=="reserve,dispose");
        MetadataHostReportSink.Reset();MetadataHostReportSink.FailReserve=true;Deny(()=>Open());Need(String.Join(",",MetadataHostReportSink.Trace)=="reserve");
        MetadataHostReportSink.Reset();owner=Open();owner.Dispose();result=owner.Snapshot;Need(!result.ReportWriteAttempted && result.CleanupReturned && result.LocalRetentionUncertain);
        Deny(()=>owner.RecordAndClose(Report()));Need(String.Join(",",MetadataHostReportSink.Trace)=="reserve,dispose");
        foreach(bool nonceMismatch in new[]{false,true}){
            MetadataHostReportSink.Reset();var clock=MetadataHostRunClock.CaptureInTrustedHost(D(nonceMismatch?(byte)2:(byte)1),nonceMismatch?25000:24999);
            var wire=MetadataHostClockTransfer.CreateInTrustedHost(clock,D(7));
            Deny(()=>Open(clock,wire,MetadataHostClockTransfer.ContextReference(wire),D(7)));
            Need(MetadataHostReportSink.Trace.Count==0);
        }
        for(int mode=0;mode<6;mode++){
            MetadataHostReportSink.Reset();var clock=MetadataHostRunClock.CaptureInTrustedHost(D(1),25000);
            var wire=MetadataHostClockTransfer.CreateInTrustedHost(clock,D(7));var reference=MetadataHostClockTransfer.ContextReference(wire);var host=D(7);
            if(mode==0)reference[0]^=1;if(mode==1)host[0]^=1;if(mode==2)wire[0]^=1;
            if(mode==3 || mode==4){ // Validly rehashed different origin/frequency, even with a new reference.
                MetadataBytes.Number(wire,mode==3?36:44,(ulong)(mode==3?clock.OriginTicks+1:clock.Frequency+1),8);
                MetadataBytes.Put(wire,96,MetadataBytes.Hash("onoes-metadata-host-clock-context/v1",MetadataBytes.Slice(wire,0,96)));
                reference=MetadataHostClockTransfer.ContextReference(wire);
            }
            if(mode==5)clock.Invalidate();
            Deny(()=>Open(clock,wire,reference,host));Need(MetadataHostReportSink.Trace.Count==0);
        }
        Console.WriteLine("{\"kind\":\"controller-retention-fake-native-only\",\"nativeCases\":\"NOT_RUN\"}");return 0;
    }
}
