// Pure bounded historical CLAIMS. Checksums are not provenance, stop evidence,
// protected storage, rollback resistance or permission to repeat an experiment.
using System;
using System.Text;
using System.Globalization;
namespace Onoes.MetadataExperiment {
    internal static class MetadataWatchdogRetentionPolicy {
        internal const int IntentBytes=208,TerminalBytes=72,StopMs=5000,RetentionMs=5000;
        static void Need(bool ok){if(!ok)throw new InvalidOperationException("metadata-watchdog-retention-invalid");}
        internal static byte[] RootBinding(string volumeRoot,uint volume,uint high,uint low){
            MetadataFixturePolicy.VolumeRoot(volumeRoot);Need(high!=0 || low!=0);
            var path=Encoding.ASCII.GetBytes(volumeRoot+"OnoesMetadataEvidence01");
            var core=new byte[4+path.Length+12];MetadataBytes.Number(core,0,(ulong)path.Length,4);MetadataBytes.Put(core,4,path);
            MetadataBytes.Number(core,4+path.Length,volume,4);MetadataBytes.Number(core,8+path.Length,high,4);MetadataBytes.Number(core,12+path.Length,low,4);
            return MetadataBytes.Hash("onoes-metadata-watchdog-root/v1",core);
        }
        internal static byte[] Intent(byte[] root,byte[] nonce,byte[] inventory,byte[] bundle,byte[] fixture,int workMs){
            Need(workMs>=1 && workMs<=25000);var wire=new byte[IntentBytes];
            wire[0]=79;wire[1]=77;wire[2]=87;wire[3]=73; // OMWI; v1 domain below
            MetadataBytes.Put(wire,4,MetadataBytes.DigestCopy(root));MetadataBytes.Put(wire,36,MetadataBytes.DigestCopy(nonce));
            MetadataBytes.Put(wire,68,MetadataBytes.DigestCopy(inventory));MetadataBytes.Put(wire,100,MetadataBytes.DigestCopy(bundle));
            MetadataBytes.Put(wire,132,MetadataBytes.DigestCopy(fixture));MetadataBytes.Number(wire,164,(ulong)workMs,4);
            MetadataBytes.Number(wire,168,StopMs,4);MetadataBytes.Number(wire,172,RetentionMs,4);
            MetadataBytes.Put(wire,176,MetadataBytes.Hash("onoes-metadata-watchdog-intent/v1",MetadataBytes.Slice(wire,0,176)));return wire;
        }
        internal static byte[] ValidateIntent(byte[] input){
            Need(input!=null && input.Length==IntentBytes);var wire=(byte[])input.Clone();
            Need(wire[0]==79 && wire[1]==77 && wire[2]==87 && wire[3]==73);
            foreach(int offset in new[]{4,36,68,100,132})MetadataBytes.DigestCopy(MetadataBytes.Slice(wire,offset,32));
            ulong work=MetadataBytes.Number(wire,164,4);Need(work>=1 && work<=25000 && MetadataBytes.Number(wire,168,4)==StopMs && MetadataBytes.Number(wire,172,4)==RetentionMs);
            Need(MetadataBytes.Same(MetadataBytes.Slice(wire,176,32),MetadataBytes.Hash("onoes-metadata-watchdog-intent/v1",MetadataBytes.Slice(wire,0,176))));return wire;
        }
        internal static void MatchIntent(byte[] input,byte[] expected){
            Need(MetadataBytes.Same(ValidateIntent(input),ValidateIntent(expected)));
        }
        internal static byte[] IntentReference(byte[] input){return MetadataBytes.Hash("onoes-metadata-watchdog-intent-reference/v1",ValidateIntent(input));}
        static string Hex(byte[] bytes){return BitConverter.ToString(bytes).Replace("-","").ToLowerInvariant();}
        internal static byte[] ArmFrame(byte[] expectedIntent){
            var wire=ValidateIntent(expectedIntent);
            string text="{\"kind\":\"metadata-watchdog-armed-not-authorization\",\"inventoryDigest\":\""+Hex(MetadataBytes.Slice(wire,68,32))+
                "\",\"runNonce\":\""+Hex(MetadataBytes.Slice(wire,36,32))+"\",\"bundleDigest\":\""+Hex(MetadataBytes.Slice(wire,100,32))+
                "\",\"workMs\":"+MetadataBytes.Number(wire,164,4).ToString(CultureInfo.InvariantCulture)+",\"stopMs\":5000}\n";
            var frame=Encoding.UTF8.GetBytes(text);Need(frame.Length<=1024);return frame;
        }
        internal static byte[] Observation(byte[] expectedIntent,string inventory,string nonce,string bundle,string trigger,
            bool armed,bool attempted,bool off,bool settled,bool timely){
            var wire=ValidateIntent(expectedIntent);
            Need(inventory==Hex(MetadataBytes.Slice(wire,68,32)) && nonce==Hex(MetadataBytes.Slice(wire,36,32)) && bundle==Hex(MetadataBytes.Slice(wire,100,32)));
            string[] triggers={"arm-failed","deadline","owner-eof","unexpected-input","lifeline-error"};
            int index=Array.IndexOf(triggers,trigger);Need(index>=0);
            return Terminal(wire,index,(armed?1:0)|(attempted?2:0)|(off?4:0)|(settled?8:0)|(timely?16:0));
        }
        internal static void Claims(int trigger,int flags){
            // Trigger: 0 arm-failed, 1 deadline, 2 owner-eof, 3 unexpected-input,
            // 4 lifeline-error. Flags: armed, attempted, Off, job-settled, timely.
            Need(trigger>=0 && trigger<=4 && flags>=0 && flags<=31);
            Need(((flags&1)!=0)?trigger!=0:trigger==0);
            Need((flags&16)==0 || (flags&12)==12);
        }
        internal static byte[] Terminal(byte[] expectedIntent,int trigger,int flags){
            Claims(trigger,flags);var wire=new byte[TerminalBytes];wire[0]=79;wire[1]=77;wire[2]=87;wire[3]=84; // OMWT
            MetadataBytes.Put(wire,4,IntentReference(expectedIntent));wire[36]=(byte)trigger;wire[37]=(byte)flags;
            MetadataBytes.Put(wire,40,MetadataBytes.Hash("onoes-metadata-watchdog-terminal/v1",MetadataBytes.Slice(wire,0,40)));return wire;
        }
        internal static byte[] ValidateTerminal(byte[] input,byte[] expectedIntent){
            Need(input!=null && input.Length==TerminalBytes);var wire=(byte[])input.Clone();
            Need(wire[0]==79 && wire[1]==77 && wire[2]==87 && wire[3]==84 && wire[38]==0 && wire[39]==0);
            Claims(wire[36],wire[37]);Need(MetadataBytes.Same(MetadataBytes.Slice(wire,4,32),IntentReference(expectedIntent)));
            Need(MetadataBytes.Same(MetadataBytes.Slice(wire,40,32),MetadataBytes.Hash("onoes-metadata-watchdog-terminal/v1",MetadataBytes.Slice(wire,0,40))));return wire;
        }
    }
    internal sealed class MetadataWatchdogHistoricalClaims {
        readonly byte[] intent,terminal;
        MetadataWatchdogHistoricalClaims(byte[] i,byte[] t){intent=i;terminal=t;}
        internal bool RequiresReconciliation {get{return true;}}
        internal bool MayDispatch {get{return false;}}
        internal bool StopProven {get{return false;}}
        internal string Kind {get{return "metadata-watchdog-history-not-verification";}}
        internal string Status {get{return terminal==null?"intent-only-unconfirmed":"recorded-claims-not-verification";}}
        internal byte[] IntentWire {get{return (byte[])intent.Clone();}}
        internal byte[] TerminalWire {get{return terminal==null?null:(byte[])terminal.Clone();}}
        internal static MetadataWatchdogHistoricalClaims Create(byte[] intent,byte[] terminal,byte[] expectedIntent){
            var i=MetadataWatchdogRetentionPolicy.ValidateIntent(intent);MetadataWatchdogRetentionPolicy.MatchIntent(i,expectedIntent);
            return new MetadataWatchdogHistoricalClaims(i,terminal==null?null:MetadataWatchdogRetentionPolicy.ValidateTerminal(terminal,i));
        }
    }
}
