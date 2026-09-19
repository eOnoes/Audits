// Pure V2 watchdog claims. No authentication, current clock or effect authority.
using System;using System.Text;using System.Globalization;
namespace Onoes.MetadataExperiment {
    internal static class MetadataWatchdogClockRecords {
        internal const int IntentBytes=292,TerminalBytes=72;
        static void Need(bool ok){if(!ok)throw new InvalidOperationException("metadata-watchdog-clock-record-invalid");}
        static string Hex(byte[] b){return BitConverter.ToString(b).Replace("-","").ToLowerInvariant();}
        internal static byte[] Intent(byte[] root,byte[] inventory,byte[] bundle,byte[] fixture,byte[] context){
            var clock=MetadataHostClockContext.Parse(context);var b=new byte[IntentBytes];b[0]=79;b[1]=77;b[2]=87;b[3]=50; // OMW2
            MetadataBytes.Put(b,4,MetadataBytes.DigestCopy(root));MetadataBytes.Put(b,36,MetadataBytes.DigestCopy(inventory));
            MetadataBytes.Put(b,68,MetadataBytes.DigestCopy(bundle));MetadataBytes.Put(b,100,MetadataBytes.DigestCopy(fixture));MetadataBytes.Put(b,132,clock.ToWire());
            MetadataBytes.Put(b,260,MetadataBytes.Hash("onoes-metadata-watchdog-intent/v2",MetadataBytes.Slice(b,0,260)));return b;
        }
        internal static byte[] ValidateIntent(byte[] input){
            Need(input!=null && input.Length==IntentBytes);var b=(byte[])input.Clone();Need(b[0]==79 && b[1]==77 && b[2]==87 && b[3]==50);
            foreach(int at in new[]{4,36,68,100})MetadataBytes.DigestCopy(MetadataBytes.Slice(b,at,32));
            MetadataHostClockContext.Parse(MetadataBytes.Slice(b,132,128));
            Need(MetadataBytes.Same(MetadataBytes.Slice(b,260,32),MetadataBytes.Hash("onoes-metadata-watchdog-intent/v2",MetadataBytes.Slice(b,0,260))));return b;
        }
        internal static void MatchIntent(byte[] input,byte[] expected){Need(MetadataBytes.Same(ValidateIntent(input),ValidateIntent(expected)));}
        internal static MetadataHostClockContext Clock(byte[] intent){return MetadataHostClockContext.Parse(MetadataBytes.Slice(ValidateIntent(intent),132,128));}
        internal static byte[] IntentReference(byte[] intent){return MetadataBytes.Hash("onoes-metadata-watchdog-intent-reference/v2",ValidateIntent(intent));}
        internal static byte[] ArmFrame(byte[] expected){
            var i=ValidateIntent(expected);var c=Clock(i);
            var text="{\"kind\":\"metadata-watchdog-armed-v2-not-authorization\",\"inventoryDigest\":\""+Hex(MetadataBytes.Slice(i,36,32))+
                "\",\"runNonce\":\""+Hex(c.Nonce)+"\",\"bundleDigest\":\""+Hex(MetadataBytes.Slice(i,68,32))+
                "\",\"workMs\":"+c.WorkMs.ToString(CultureInfo.InvariantCulture)+",\"stopMs\":5000,\"clockReference\":\""+Hex(c.Reference())+
                "\",\"intentReference\":\""+Hex(IntentReference(i))+"\"}\n";
            var b=Encoding.UTF8.GetBytes(text);Need(b.Length<=1024);return b;
        }
        internal static byte[] Observation(byte[] intent,string inventory,string nonce,string bundle,string trigger,bool armed,bool attempted,bool off,bool settled,bool timely){
            var i=ValidateIntent(intent);Need(inventory==Hex(MetadataBytes.Slice(i,36,32)) && nonce==Hex(Clock(i).Nonce) && bundle==Hex(MetadataBytes.Slice(i,68,32)));
            int index=Array.IndexOf(new[]{"arm-failed","deadline","owner-eof","unexpected-input","lifeline-error"},trigger);
            return Terminal(i,index,(armed?1:0)|(attempted?2:0)|(off?4:0)|(settled?8:0)|(timely?16:0));
        }
        internal static byte[] Terminal(byte[] intent,int trigger,int flags){
            MetadataWatchdogRetentionPolicy.Claims(trigger,flags);var b=new byte[TerminalBytes];b[0]=79;b[1]=87;b[2]=84;b[3]=50; // OWT2
            MetadataBytes.Put(b,4,IntentReference(intent));b[36]=(byte)trigger;b[37]=(byte)flags;
            MetadataBytes.Put(b,40,MetadataBytes.Hash("onoes-metadata-watchdog-terminal/v2",MetadataBytes.Slice(b,0,40)));return b;
        }
        internal static byte[] ValidateTerminal(byte[] input,byte[] expected){
            Need(input!=null && input.Length==TerminalBytes);var b=(byte[])input.Clone();
            Need(MetadataBytes.Same(b,Terminal(expected,b[36],b[37])));return b;
        }
    }
    internal sealed class MetadataWatchdogClockHistory {
        readonly byte[] intent,terminal;
        MetadataWatchdogClockHistory(byte[] i,byte[] t){intent=i;terminal=t;}
        internal static MetadataWatchdogClockHistory Create(byte[] saved,byte[] terminal,byte[] expected){
            var i=MetadataWatchdogClockRecords.ValidateIntent(saved);MetadataWatchdogClockRecords.MatchIntent(i,expected);
            return new MetadataWatchdogClockHistory(i,terminal==null?null:MetadataWatchdogClockRecords.ValidateTerminal(terminal,i));
        }
        internal string Kind {get{return "metadata-watchdog-clock-history-not-verification";}}
        internal string Status {get{return terminal==null?"intent-only-unconfirmed":"recorded-claims-not-verification";}}
        internal bool RequiresReconciliation {get{return true;}}
        internal bool MayDispatch {get{return false;}}
        internal bool StopProven {get{return false;}}
        internal byte[] IntentWire {get{return (byte[])intent.Clone();}}
        internal byte[] TerminalWire {get{return terminal==null?null:(byte[])terminal.Clone();}}
    }
}
