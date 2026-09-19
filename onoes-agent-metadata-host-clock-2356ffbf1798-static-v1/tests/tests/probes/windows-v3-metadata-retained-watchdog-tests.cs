// Real bridge + fake retention class + memory streams ONLY. No native implementation.
using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Onoes.MetadataExperiment;
internal static class RetainedWatchdogTests {
    static void Need(bool value){if(!value)throw new Exception("retained-watchdog-model-failed");}
    static void Deny(Action f){bool bad=false;try{f();}catch{bad=true;}Need(bad);}
    static byte[] D(byte value){var b=new byte[32];for(int i=0;i<32;i++)b[i]=value;return b;}
    static string Hex(byte value){return BitConverter.ToString(D(value)).Replace("-","").ToLowerInvariant();}
    const string Root=@"\\?\Volume{00000000-0000-4000-8000-000000000001}\";
    static byte[] Frame(){return MetadataWatchdogClockRecords.ArmFrame(MetadataWatchdogClockRecords.Intent(
        MetadataWatchdogRetentionPolicy.RootBinding(Root,1,2,3),D(3),D(4),D(5),context));}
    static MetadataHostRunClock clock;
    static byte[] context;
    static MetadataWatchdogRetentionBridge Open(Stream output){clock=MetadataHostRunClock.CaptureInTrustedHost(D(2),25000);
        context=MetadataHostClockTransfer.CreateInTrustedHost(clock,D(7));return MetadataWatchdogRetentionBridge.Reserve(Root,1,2,3,D(2),D(3),D(4),D(5),25000,clock,output,context,MetadataHostClockTransfer.ContextReference(context),D(7));}
    static void Arm(MetadataWatchdogRetentionBridge b){var frame=Frame();b.ArmedOutput.WriteAsync(frame,0,frame.Length).GetAwaiter().GetResult();b.ArmedOutput.FlushAsync().GetAwaiter().GetResult();}
    static void Record(MetadataWatchdogRetentionBridge b){b.RecordClaims(Hex(3),Hex(2),Hex(4),"owner-eof",true,true,true,true,true);}
    sealed class HeldStream : MemoryStream {
        internal readonly TaskCompletionSource<int> Pending=new TaskCompletionSource<int>();
        internal bool HoldFlush;byte[] bytes;int start,count;
        public override Task WriteAsync(byte[] input,int offset,int length,CancellationToken token){
            if(HoldFlush)return base.WriteAsync(input,offset,length,token);
            bytes=input;start=offset;count=length;return Pending.Task;
        }
        public override Task FlushAsync(CancellationToken token){return HoldFlush?Pending.Task:Task.FromResult(0);}
        internal void Complete(){if(!HoldFlush)base.Write(bytes,start,count);Pending.SetResult(0);}
    }
    static int Main(){
        WatchdogClockRecordsTests.Run();
        MetadataHostReportSink.Reset();var output=new MemoryStream();var bridge=Open(output);Arm(bridge);Record(bridge);bridge.Dispose();
        Need(String.Join(",",MetadataHostReportSink.Trace)=="reserve,ready,ready,record,dispose");
        Need(MetadataBytes.Same(output.ToArray(),Frame()) && output.CanWrite);Deny(()=>Record(bridge));
        MetadataHostReportSink.Reset();bridge=Open(new MemoryStream());var alreadySent=Frame();
        bridge.ArmedOutput.WriteAsync(alreadySent,0,alreadySent.Length).GetAwaiter().GetResult();
        MetadataHostReportSink.FailReady=true;
        // After arm bytes can escape, storage failure must not prevent entering
        // the watchdog stop loop. Only the original clock/transport may gate flush.
        bridge.ArmedOutput.FlushAsync().GetAwaiter().GetResult();Record(bridge);bridge.Dispose();
        MetadataHostReportSink.Reset();bridge=Open(new MemoryStream());Deny(()=>Record(bridge));Deny(()=>Record(bridge));bridge.Dispose();
        Need(!MetadataHostReportSink.Trace.Contains("record"));
        MetadataHostReportSink.Reset();output=new MemoryStream();bridge=Open(output);var wrong=Frame();wrong[0]^=1;
        Deny(()=>bridge.ArmedOutput.WriteAsync(wrong,0,wrong.Length));Deny(()=>Arm(bridge));Need(output.Length==0);bridge.Dispose();
        MetadataHostReportSink.Reset();bridge=Open(new MemoryStream());Arm(bridge);
        Deny(()=>bridge.RecordClaims(Hex(9),Hex(2),Hex(4),"owner-eof",true,true,true,true,true));Deny(()=>Record(bridge));bridge.Dispose();
        Need(!MetadataHostReportSink.Trace.Contains("record"));
        MetadataHostReportSink.Reset();var held=new HeldStream();bridge=Open(held);var sent=Frame();var pending=bridge.ArmedOutput.WriteAsync(sent,0,sent.Length);
        sent[0]^=1;Deny(()=>bridge.ArmedOutput.FlushAsync());Deny(()=>Record(bridge));bridge.Dispose();held.Complete();pending.GetAwaiter().GetResult();
        Need(MetadataBytes.Same(held.ToArray(),Frame())); // forwarded owned bytes, not mutable caller buffer
        MetadataHostReportSink.Reset();held=new HeldStream{HoldFlush=true};bridge=Open(held);sent=Frame();
        bridge.ArmedOutput.WriteAsync(sent,0,sent.Length).GetAwaiter().GetResult();pending=bridge.ArmedOutput.FlushAsync();
        Deny(()=>Record(bridge));bridge.Dispose();int checks=MetadataHostReportSink.Trace.Count;held.Complete();
        Deny(()=>pending.GetAwaiter().GetResult());Need(MetadataHostReportSink.Trace.Count==checks); // no post-close native call
        MetadataHostReportSink.Reset();MetadataHostReportSink.FailReserve=true;Deny(()=>Open(new MemoryStream()));Need(String.Join(",",MetadataHostReportSink.Trace)=="reserve");
        MetadataHostReportSink.Reset();MetadataHostReportSink.FailReady=true;Deny(()=>Open(new MemoryStream()));Need(String.Join(",",MetadataHostReportSink.Trace)=="reserve,ready,dispose");
        MetadataHostReportSink.Reset();bridge=Open(new MemoryStream());Arm(bridge);MetadataHostReportSink.FailRecord=true;Deny(()=>Record(bridge));Deny(()=>Record(bridge));bridge.Dispose();
        Need(MetadataHostReportSink.Trace.FindAll(s=>s=="record").Count==1);
        MetadataHostReportSink.Reset();bridge=Open(new MemoryStream());MetadataHostReportSink.FailDispose=true;Deny(()=>bridge.Dispose());bridge.Dispose();
        Need(MetadataHostReportSink.Trace.FindAll(s=>s=="dispose").Count==1);
        foreach(bool nonceMismatch in new[]{false,true}){
            MetadataHostReportSink.Reset();clock=MetadataHostRunClock.CaptureInTrustedHost(D(nonceMismatch?(byte)9:(byte)2),nonceMismatch?25000:24999);
            context=MetadataHostClockTransfer.CreateInTrustedHost(clock,D(7));
            Deny(()=>MetadataWatchdogRetentionBridge.Reserve(Root,1,2,3,D(2),D(3),D(4),D(5),25000,clock,new MemoryStream(),context,MetadataHostClockTransfer.ContextReference(context),D(7)));Need(MetadataHostReportSink.Trace.Count==0);
        }
        for(int mode=0;mode<6;mode++){
            MetadataHostReportSink.Reset();clock=MetadataHostRunClock.CaptureInTrustedHost(D(2),25000);
            context=MetadataHostClockTransfer.CreateInTrustedHost(clock,D(7));var reference=MetadataHostClockTransfer.ContextReference(context);var host=D(7);
            if(mode==0)reference[0]^=1;if(mode==1)host[0]^=1;if(mode==2)context[0]^=1;
            if(mode==3 || mode==4){MetadataBytes.Number(context,mode==3?36:44,(ulong)(mode==3?clock.OriginTicks+1:clock.Frequency+1),8);
                MetadataBytes.Put(context,96,MetadataBytes.Hash("onoes-metadata-host-clock-context/v1",MetadataBytes.Slice(context,0,96)));reference=MetadataHostClockTransfer.ContextReference(context);}
            if(mode==5)clock.Invalidate();
            Deny(()=>MetadataWatchdogRetentionBridge.Reserve(Root,1,2,3,D(2),D(3),D(4),D(5),25000,clock,new MemoryStream(),context,reference,host));
            Need(MetadataHostReportSink.Trace.Count==0);
        }
        MetadataHostReportSink.Reset();bridge=Open(new MemoryStream());Arm(bridge);clock.Invalidate();
        Deny(()=>Record(bridge));Deny(()=>Record(bridge));Need(!MetadataHostReportSink.Trace.Contains("record"));bridge.Dispose();
        Console.WriteLine("{\"kind\":\"retained-watchdog-bridge-fake-native-only\",\"nativeCases\":\"NOT_RUN\"}");return 0;
    }
}
