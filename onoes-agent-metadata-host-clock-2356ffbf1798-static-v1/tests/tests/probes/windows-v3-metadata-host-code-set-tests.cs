// Real set owner + pure pins against substituted holds; native methods NOT linked.
using System;using System.Linq;using Onoes.MetadataExperiment;
using Hold=Onoes.MetadataExperiment.MetadataHostReportSink.HostCodeReadHold;
internal static class HostCodeSetTests {
    static void Need(bool value){if(!value)throw new Exception("host-code-set-test-failed");}
    static void Deny(Action action){bool denied=false;try{action();}catch(InvalidOperationException e){Need(e.Message=="metadata-host-code-set-unavailable" && e.InnerException==null);denied=true;}Need(denied);}
    static MetadataHostCodePin Pin(int role){var digest=new byte[32];digest[0]=1;return new MetadataHostCodePin((MetadataHostCodeRole)role,3,digest);}
    static void Reset(){Hold.Reset();var nonce=new byte[32];nonce[0]=1;Hold.Clock=MetadataHostRunClock.CaptureInTrustedHost(nonce,25000);Hold.Root=@"\\?\Volume{00000000-0000-4000-8000-000000000001}\";Hold.Volume=7;Hold.High=8;Hold.Low=9;Hold.Work=25000;}
    static MetadataHostCodeSet Open(){return MetadataHostCodeSet.OpenInApprovedHost(Hold.Root,Hold.Volume,Hold.High,Hold.Low,Pin(1),Pin(2),Pin(3),Hold.Clock,Hold.Work);}
    static void Cleared(){foreach(var b in Hold.Buffers)Need(b==null || Array.TrueForAll(b,x=>x==0));}
    static int Main(){
        Reset();var owner=Open();Need(String.Join(",",Hold.Trace)=="open:0,open:1,open:2,read:0,read:1,read:2,check:0,check:1,check:2");
        var output=owner.TakeCheckedBytes(MetadataHostCodeRole.WatchdogCore);Need(output[0]==2 && Hold.Buffers[1][0]==0);
        Need(Hold.Trace.All(s=>!s.StartsWith("dispose:")));owner.CheckForUse();owner.Dispose();Cleared();Need(output[0]==2);
        int end=Hold.Trace.Count;owner.Dispose();Need(Hold.Trace.Count==end);Deny(()=>owner.CheckForUse());Deny(()=>owner.TakeCheckedBytes(MetadataHostCodeRole.RetentionLibrary));
        foreach(string phase in new[]{"open","read","check"})for(int index=0;index<3;index++){
            Reset();Hold.FailAt=phase+":"+index;Deny(()=>Open());Cleared();
            int count=phase=="open"?index:3;Need(Hold.Trace.Count(s=>s.StartsWith("dispose:"))==count);
            Need(String.Join(",",Hold.Trace.Where(s=>s.StartsWith("dispose:")))==String.Join(",",Enumerable.Range(0,count).Reverse().Select(i=>"dispose:"+i)));
        }
        for(int mask=0;mask<8;mask++){
            Reset();owner=Open();Hold.DisposeMask=mask;if(mask==0)owner.Dispose();else Deny(()=>owner.Dispose());
            Cleared();Need(Hold.Trace.Count(s=>s.StartsWith("dispose:"))==3);end=Hold.Trace.Count;owner.Dispose();Need(Hold.Trace.Count==end);
        }
        foreach(string stop in new[]{"open:1","read:1","check:2"}){
            Reset();Hold.StopAt=stop;Deny(()=>Open());Cleared();Need(Hold.Trace.Any(s=>s.StartsWith("dispose:")));
        }
        Reset();owner=Open();owner.TakeCheckedBytes(MetadataHostCodeRole.RetentionLibrary);Deny(()=>owner.TakeCheckedBytes(MetadataHostCodeRole.RetentionLibrary));
        Need(Hold.Trace.All(s=>!s.StartsWith("dispose:")));Deny(()=>owner.TakeCheckedBytes(MetadataHostCodeRole.WatchdogCore));owner.Dispose();Cleared();
        Reset();owner=Open();Hold.FailAt="check:1";Deny(()=>owner.TakeCheckedBytes(MetadataHostCodeRole.WatchdogWrapper));
        Need(Hold.Trace.All(s=>!s.StartsWith("dispose:")));Hold.FailAt=null;Deny(()=>owner.CheckForUse());owner.Dispose();Cleared();
        Reset();owner=Open();Deny(()=>owner.TakeCheckedBytes((MetadataHostCodeRole)0));Deny(()=>owner.CheckForUse());owner.Dispose();Cleared();
        Reset();Deny(()=>MetadataHostCodeSet.OpenInApprovedHost(Hold.Root,7,8,9,Pin(2),Pin(1),Pin(3),Hold.Clock,25000));Need(Hold.Trace.Count==0);
        Reset();Hold.Clock.Invalidate();Deny(()=>Open());Need(Hold.Trace.Count==0);
        Reset();Hold.Work=24999;Deny(()=>Open());Need(Hold.Trace.Count==0);
        Hold.Work=25000;Deny(()=>Open());Need(Hold.Trace.Count==0);
        Console.WriteLine("{\"kind\":\"host-code-set-fake-holds-only\",\"nativeCases\":\"NOT_RUN\"}");return 0;
    }
}
