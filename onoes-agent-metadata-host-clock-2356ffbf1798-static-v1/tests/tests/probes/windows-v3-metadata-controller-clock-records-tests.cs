// Pure exhaustive framing/mismatch controls; no native calls or persistence.
using System;using Onoes.MetadataExperiment;
internal static class ControllerClockRecordsTests {
    static byte[] D(byte n){var b=new byte[32];for(int i=0;i<32;i++)b[i]=n;return b;}
    static void Need(bool ok){if(!ok)throw new Exception("controller-clock-records-test-failed");}
    static void Deny(Action f){bool denied=false;try{f();}catch(InvalidOperationException){denied=true;}Need(denied);}
    static string Hex(byte[] b){return BitConverter.ToString(b).Replace("-","").ToLowerInvariant();}
    internal static void Vector(){
        Need(Environment.GetEnvironmentVariable("ONOES_METADATA_HISTORY_PROBE")=="1");
        var context=MetadataHostClockContext.Create(123456789012345678,10000000,D(1),25000,D(7)).ToWire();
        var c=MetadataControllerClockRecords.Intent(D(8),D(9),D(2),D(0x33),context);
        var raw=MetadataBootstrapReport.Encode(D(1),D(2),new string('3',64),12,MetadataBootstrapFailure.Provision,null,null,null,null,MetadataCaseCleanup.DisposalReturned);
        var b=MetadataControllerClockRecords.Report(c,raw);
        var w=MetadataWatchdogClockRecords.Intent(D(8),D(9),D(2),D(0x33),context);var t=MetadataWatchdogClockRecords.Terminal(w,2,31);
        Console.WriteLine("{\"kind\":\"synthetic-clock-history-vector\",\"controllerIntent\":\""+Hex(c)+"\",\"controllerReport\":\""+Hex(b)+
            "\",\"watchdogIntent\":\""+Hex(w)+"\",\"watchdogTerminal\":\""+Hex(t)+"\"}");
    }
    internal static void Run(){
        var context=MetadataHostClockContext.Create(123456789012345678,10000000,D(1),25000,D(7)).ToWire();
        var intent=MetadataControllerClockRecords.Intent(D(8),D(9),D(2),D(0x33),context);
        Need(MetadataBytes.Same(MetadataControllerClockRecords.IntentReference(intent),MetadataBytes.Hex("e0cd664edf3728425b65d4b95f4787bc5aa587bd7cc2fac19b06d518851414d3")));
        var bootstrap=MetadataBootstrapReport.Encode(D(1),D(2),new string('3',64),12,MetadataBootstrapFailure.Provision,null,null,null,null,MetadataCaseCleanup.DisposalReturned);
        var report=MetadataControllerClockRecords.Report(intent,bootstrap);
        Need(intent.Length==292 && report.Length==452);
        for(int i=0;i<intent.Length;i++){var bad=(byte[])intent.Clone();bad[i]^=1;Deny(()=>MetadataControllerClockRecords.ValidateIntent(bad));}
        for(int i=0;i<report.Length;i++){var bad=(byte[])report.Clone();bad[i]^=1;Deny(()=>MetadataControllerClockRecords.ValidateReport(bad,intent));}
        for(int i=0;i<292;i++)Deny(()=>MetadataControllerClockRecords.ValidateIntent(new byte[i]));
        for(int i=0;i<452;i++)Deny(()=>MetadataControllerClockRecords.ValidateReport(new byte[i],intent));
        Deny(()=>MetadataControllerClockRecords.ValidateIntent(new byte[293]));Deny(()=>MetadataControllerClockRecords.ValidateIntent(null));
        Deny(()=>MetadataControllerClockRecords.ValidateReport(new byte[453],intent));Deny(()=>MetadataControllerClockRecords.ValidateReport(null,intent));
        Deny(()=>MetadataControllerClockRecords.ValidateIntent(MetadataHostSinkPolicy.Intent(D(1),D(9),D(2),D(0x33))));
        Deny(()=>MetadataControllerClockRecords.ValidateReport(bootstrap,intent));
        // Coherent replacement pins and clock context remain different histories.
        foreach(int at in new[]{4,36,68,100,136,168,176,196}){
            var bad=(byte[])intent.Clone();bad[at]^=1;
            if(at>=132)MetadataBytes.Put(bad,228,MetadataBytes.Hash("onoes-metadata-host-clock-context/v1",MetadataBytes.Slice(bad,132,96)));
            MetadataBytes.Put(bad,260,MetadataBytes.Hash("onoes-metadata-controller-intent/v2",MetadataBytes.Slice(bad,0,260)));
            MetadataControllerClockRecords.ValidateIntent(bad);
            Deny(()=>MetadataControllerClockRecords.MatchIntent(bad,intent));Deny(()=>MetadataControllerClockRecords.ValidateReport(report,bad));
        }
        // Outer rehash cannot hide wrong report parent or invalid nested claims.
        foreach(int at in new[]{0,4,36,100}){
            var bad=(byte[])report.Clone();bad[at]^=1;
            MetadataBytes.Put(bad,420,MetadataBytes.Hash("onoes-metadata-controller-report/v2",MetadataBytes.Slice(bad,0,420)));
            Deny(()=>MetadataControllerClockRecords.ValidateReport(bad,intent));
        }
        var history=MetadataControllerClockHistory.Create(intent,report,intent);
        var missing=MetadataControllerClockHistory.Create(intent,null,intent);
        Need(history.RequiresReconciliation && !history.MayDispatch && !history.StopProven && history.Status=="recorded-claims-not-verification");
        Need(missing.Status=="intent-only-unconfirmed" && missing.ReportWire==null && !missing.MayDispatch);
        intent[0]=0;report[0]=0;context[0]=0;var copy=history.IntentWire;copy[0]=0;copy=history.ReportWire;copy[0]=0;
        Need(history.IntentWire[0]==79 && history.ReportWire[0]==79);
    }
}
