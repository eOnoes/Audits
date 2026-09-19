// Isolated data/runtime test. Optional guarded modes expose synthetic clock bytes
// to a LOCAL process test; command-line delivery here is NOT a production channel.
using System;using System.Diagnostics;using System.Globalization;
using Onoes.MetadataExperiment;
internal static class HostClockContextTests {
    static byte[] D(byte value){var b=new byte[32];for(int i=0;i<32;i++)b[i]=value;return b;}
    static void Need(bool ok){if(!ok)throw new Exception("host-clock-context-test-failed");}
    static void Deny(Action action){bool denied=false;try{action();}catch(InvalidOperationException){denied=true;}Need(denied);}
    static string Hex(byte[] b){return BitConverter.ToString(b).Replace("-","").ToLowerInvariant();}
    static byte[] Unhex(string s,int length){
        Need(s!=null && s.Length==length*2);var bytes=new byte[length];
        for(int i=0;i<s.Length;i++)Need((s[i]>='0' && s[i]<='9') || (s[i]>='a' && s[i]<='f'));
        for(int i=0;i<length;i++)bytes[i]=Byte.Parse(s.Substring(i*2,2),NumberStyles.HexNumber,CultureInfo.InvariantCulture);return bytes;
    }
    static string Number(long n){return n.ToString(CultureInfo.InvariantCulture);}
    static void Rehash(byte[] b){MetadataBytes.Put(b,96,MetadataBytes.Hash("onoes-metadata-host-clock-context/v1",MetadataBytes.Slice(b,0,96)));}
    static int Probe(string[] args){
        Need(Environment.GetEnvironmentVariable("ONOES_METADATA_CLOCK_PROBE")=="1");
        if(args.Length==1 && (args[0]=="capture" || args[0]=="vector")){
            var wire=args[0]=="capture"?MetadataHostClockTransfer.CreateInTrustedHost(MetadataHostRunClock.CaptureInTrustedHost(D(1),25000),D(7)):
                MetadataHostClockContext.Create(123456789012345678,10000000,D(1),25000,D(7)).ToWire();
            Console.WriteLine("{\"wire\":\""+Hex(wire)+"\",\"reference\":\""+Hex(MetadataHostClockTransfer.ContextReference(wire))+"\"}");return 0;
        }
        Need(args.Length==3 && args[0]=="receive");
        var input=Unhex(args[1],128);var reference=Unhex(args[2],32);
        try{
            long before=Stopwatch.GetTimestamp();var clock=MetadataHostClockTransfer.ReceiveInTrustedHost(input,reference,D(7),D(1),25000);
            long elapsed=clock.ReadElapsedMilliseconds(),after=Stopwatch.GetTimestamp();
            Console.WriteLine("{\"accepted\":true,\"origin\":\""+Number(clock.OriginTicks)+"\",\"frequency\":\""+Number(clock.Frequency)+
                "\",\"before\":\""+Number(before)+"\",\"after\":\""+Number(after)+"\",\"elapsed\":"+Number(elapsed)+"}");
        }catch(InvalidOperationException){Console.WriteLine("{\"accepted\":false}");}
        return 0;
    }
    static int Main(string[] args){
        if(args.Length!=0)return Probe(args);
        var nonce=D(1);var host=D(7);var c=MetadataHostClockContext.Create(123456789012345678,10000000,nonce,25000,host);
        nonce[0]=8;host[0]=8;var wire=c.ToWire();var reference=c.Reference();c.Match(reference,D(7),D(1),25000);
        Need(c.OriginTicks==123456789012345678 && c.Frequency==10000000 && c.WorkMs==25000);
        for(int i=0;i<128;i++){var bad=(byte[])wire.Clone();bad[i]^=1;Deny(()=>MetadataHostClockContext.Parse(bad));}
        for(int n=0;n<128;n++)Deny(()=>MetadataHostClockContext.Parse(new byte[n]));
        foreach(int n in new[]{129,164,208,4096})Deny(()=>MetadataHostClockContext.Parse(new byte[n]));Deny(()=>MetadataHostClockContext.Parse(null));
        var parsed=MetadataHostClockContext.Parse(wire);wire[0]^=1;Need(parsed.ToWire()[0]==79);var returned=parsed.ToWire();returned[4]^=1;parsed.Match(reference,D(7),D(1),25000);
        var nonceCopy=parsed.Nonce;nonceCopy[0]^=1;parsed.Match(reference,D(7),D(1),25000);
        foreach(int offset in new[]{4,36,44,52,56,60,64}){
            var bad=parsed.ToWire();bad[offset]^=1;Rehash(bad);
            Deny(()=>MetadataHostClockContext.Parse(bad).Match(reference,D(7),D(1),25000));
        }
        foreach(int offset in new[]{36,44})foreach(ulong badValue in new[]{0UL,(ulong)Int64.MaxValue+1,UInt64.MaxValue}){
            var bad=parsed.ToWire();MetadataBytes.Number(bad,offset,badValue,8);Rehash(bad);Deny(()=>MetadataHostClockContext.Parse(bad));
        }
        foreach(int offset in new[]{4,64}){var bad=parsed.ToWire();Array.Clear(bad,offset,32);Rehash(bad);Deny(()=>MetadataHostClockContext.Parse(bad));}
        Deny(()=>parsed.Match(D(9),D(7),D(1),25000));Deny(()=>parsed.Match(reference,D(9),D(1),25000));
        Deny(()=>parsed.Match(reference,D(7),D(9),25000));Deny(()=>parsed.Match(reference,D(7),D(1),24999));
        foreach(int work in new[]{0,-1,25001,Int32.MaxValue})Deny(()=>MetadataHostClockContext.Create(1,1,D(1),work,D(7)));
        var original=MetadataHostRunClock.CaptureInTrustedHost(D(1),25000);var live=MetadataHostClockTransfer.CreateInTrustedHost(original,D(7));
        var received=MetadataHostClockTransfer.ReceiveInTrustedHost(live,MetadataHostClockTransfer.ContextReference(live),D(7),D(1),25000);
        Need(received.OriginTicks==original.OriginTicks && received.Frequency==original.Frequency);received.RequireRun(D(1),25000);
        original.Invalidate();Deny(()=>MetadataHostClockTransfer.CreateInTrustedHost(original,D(7)));
        Console.WriteLine("{\"kind\":\"host-clock-context-pure-and-local-runtime-only\",\"wireBytes\":128,\"byteMutations\":128,\"nativeCases\":\"NOT_RUN\"}");return 0;
    }
}
