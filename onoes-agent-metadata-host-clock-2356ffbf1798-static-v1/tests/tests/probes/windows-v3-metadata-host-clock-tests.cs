// Deterministic arithmetic plus local Stopwatch timestamp sampling. No native
// metadata, storage, guest, child process, authenticated channel or effect.
using System;using System.Diagnostics;using System.Reflection;
using Onoes.MetadataExperiment;
internal static class HostClockTests {
    static byte[] Nonce(){var n=new byte[32];n[0]=1;return n;}
    static void Need(bool ok){if(!ok)throw new Exception("host-clock-test-failed");}
    static void Deny(Action action,string reason){bool denied=false;try{action();}catch(InvalidOperationException e){Need(e.Message==reason && e.InnerException==null);denied=true;}Need(denied);}
    const string Bad="metadata-host-clock-unavailable",Expired="metadata-host-clock-expired";
    static MetadataHostClockState State(long origin,long frequency,int work){return new MetadataHostClockState(origin,frequency,Nonce(),work);}
    static int Main(){
        foreach(long origin in new[]{0L,-1L,Int64.MinValue})Deny(()=>State(origin,1000,25000),Bad);
        foreach(long frequency in new[]{0L,-1L,Int64.MinValue})Deny(()=>State(1,frequency,25000),Bad);
        foreach(int work in new[]{0,-1,25001,Int32.MaxValue})Deny(()=>State(1,1000,work),Bad);
        foreach(var nonce in new[]{null,new byte[0],new byte[31],new byte[32],new byte[33]})
            Deny(()=>new MetadataHostClockState(1,1000,nonce,25000),Bad);
        var n=Nonce();var copied=new MetadataHostClockState(1,1000,n,25000);n[0]=9;
        copied.RequireBinding(Nonce(),25000);var copy=copied.CopyNonce();copy[0]=9;copied.RequireBinding(Nonce(),25000);
        Deny(()=>copied.RequireBinding(copy,25000),Bad);Deny(()=>copied.Observe(2,1000,true),Bad);
        foreach(int work in new[]{1,2,5000,24999,25000})foreach(long frequency in new[]{10000L,10000000L}){
            foreach(int deadline in new[]{Math.Min(work,5000),work,work+5000,work+10000}){
                var state=State(9000000000000000000L,frequency,work);long origin=state.OriginTicks;
                long boundary=origin+deadline*(frequency/1000);
                state.RequireBefore(state.Observe(boundary-2,frequency,true),deadline);
                Deny(()=>state.RequireBefore(state.Observe(boundary-1,frequency,true),deadline),Expired);
                Deny(()=>state.RequireBefore(state.Observe(boundary,frequency,true),deadline),Expired);
                Deny(()=>state.RequireBefore(state.Observe(boundary+1,frequency,true),deadline),Expired);
            }
        }
        var phases=State(1,10000000,1000);
        long elapsed=phases.Observe(10000001,10000000,true);Deny(()=>phases.RequireBefore(elapsed,1000),Expired);
        phases.RequireBefore(elapsed,6000);phases.RequireBefore(elapsed,11000);
        Need(State(Int64.MaxValue-2,Int64.MaxValue,25000).Observe(Int64.MaxValue,Int64.MaxValue,true)==0);
        Need(State(1,1,25000).Observe(Int64.MaxValue,1,true)==35000);
        var fine=State(100,10000000,1);Need(fine.Observe(100,10000000,true)==0);fine.RequireBefore(0,1);
        var coarse=State(100,1000,1);Deny(()=>coarse.RequireBefore(coarse.Observe(100,1000,true),1),Expired);
        for(int mode=0;mode<5;mode++){
            var state=State(100,1000,25000);state.Observe(110,1000,true);
            if(mode==0)Deny(()=>state.Observe(99,1000,true),Bad);
            if(mode==1)Deny(()=>state.Observe(109,1000,true),Bad);
            if(mode==2)Deny(()=>state.Observe(110,999,true),Bad);
            if(mode==3)Deny(()=>state.Observe(110,1000,false),Bad);
            if(mode==4)state.Invalidate();
            Deny(()=>state.Observe(111,1000,true),Bad);
        }
        foreach(long limit in new[]{0L,-1L,35001L,Int64.MaxValue}){
            var state=State(1,1000,25000);Deny(()=>state.RequireBefore(0,limit),Bad);Deny(()=>state.Observe(2,1000,true),Bad);
        }
        var wrongBudget=State(1,1000,25000);Deny(()=>wrongBudget.RequireBudget(24999),Bad);Deny(()=>wrongBudget.RequireBudget(25000),Bad);
        var runtime=MetadataHostRunClock.CaptureInTrustedHost(Nonce(),25000);
        Need(runtime.WorkMs==25000 && runtime.StopDeadlineMs==30000 && runtime.RetentionDeadlineMs==35000 && runtime.CodePreparationDeadlineMs==5000);
        runtime.RequireRun(Nonce(),25000);runtime.RequireBudget(25000);
        var peer=MetadataHostRunClock.ReceiveInTrustedHost(runtime.OriginTicks,runtime.Frequency,Nonce(),25000);
        Need(peer.OriginTicks==runtime.OriginTicks && peer.Frequency==runtime.Frequency);
        long first=runtime.ElapsedMilliseconds;Need(peer.ElapsedMilliseconds>=first);
        var clone=runtime.CopyNonce();clone[0]=3;runtime.RequireRun(Nonce(),25000);
        Deny(()=>runtime.RequireRun(clone,25000),Bad);Deny(()=>runtime.RequireBefore(35000),Bad);
        Deny(()=>MetadataHostRunClock.ReceiveInTrustedHost(Int64.MaxValue,Stopwatch.Frequency,Nonce(),25000),Bad);
        Deny(()=>MetadataHostRunClock.ReceiveInTrustedHost(Stopwatch.GetTimestamp(),Stopwatch.Frequency+1,Nonce(),25000),Bad);
        long aged=Stopwatch.GetTimestamp()-Stopwatch.Frequency*26;
        if(aged>0)Deny(()=>MetadataHostRunClock.ReceiveInTrustedHost(aged,Stopwatch.Frequency,Nonce(),25000),Expired);
        Need(typeof(MetadataHostRunClock).GetConstructors().Length==0 && typeof(MetadataHostRunClock).IsSealed);
        foreach(var method in typeof(MetadataHostRunClock).GetMethods(BindingFlags.Public|BindingFlags.Instance|BindingFlags.Static))
            Need(method.Name!="Restart" && method.Name!="Reset" && method.Name!="Stop" && method.Name!="Invalidate");
        Console.WriteLine("{\"kind\":\"host-clock-arithmetic-and-local-counter-only\",\"nativeCases\":\"NOT_RUN\"}");return 0;
    }
}
