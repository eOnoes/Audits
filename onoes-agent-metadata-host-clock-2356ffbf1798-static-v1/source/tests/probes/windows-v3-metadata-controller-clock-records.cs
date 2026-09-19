// Pure V2 retained CLAIMS. Hashes are integrity/binding, not authentication,
// freshness, custody, durable stop proof or authority to repeat any operation.
using System;
namespace Onoes.MetadataExperiment {
    internal static class MetadataControllerClockRecords {
        internal const int IntentBytes=292,ReportBytes=452;
        static void Need(bool ok){if(!ok)throw new InvalidOperationException("metadata-controller-clock-record-invalid");}
        static string Hex(byte[] b){return BitConverter.ToString(b).Replace("-","").ToLowerInvariant();}
        internal static byte[] Intent(byte[] root,byte[] inventory,byte[] bundle,byte[] fixture,byte[] context){
            var clock=MetadataHostClockContext.Parse(context);var b=new byte[IntentBytes];
            b[0]=79;b[1]=77;b[2]=72;b[3]=50; // OMH2; OMH1 has no clock/root binding.
            MetadataBytes.Put(b,4,MetadataBytes.DigestCopy(root));MetadataBytes.Put(b,36,MetadataBytes.DigestCopy(inventory));
            MetadataBytes.Put(b,68,MetadataBytes.DigestCopy(bundle));MetadataBytes.Put(b,100,MetadataBytes.DigestCopy(fixture));
            MetadataBytes.Put(b,132,clock.ToWire());
            MetadataBytes.Put(b,260,MetadataBytes.Hash("onoes-metadata-controller-intent/v2",MetadataBytes.Slice(b,0,260)));
            return b;
        }
        internal static byte[] ValidateIntent(byte[] input){
            Need(input!=null && input.Length==IntentBytes);var b=(byte[])input.Clone();
            Need(b[0]==79 && b[1]==77 && b[2]==72 && b[3]==50);
            foreach(int at in new[]{4,36,68,100})MetadataBytes.DigestCopy(MetadataBytes.Slice(b,at,32));
            MetadataHostClockContext.Parse(MetadataBytes.Slice(b,132,128));
            Need(MetadataBytes.Same(MetadataBytes.Slice(b,260,32),MetadataBytes.Hash("onoes-metadata-controller-intent/v2",MetadataBytes.Slice(b,0,260))));return b;
        }
        internal static byte[] MatchIntent(byte[] input,byte[] expected){
            var b=ValidateIntent(input);var pin=ValidateIntent(expected);Need(MetadataBytes.Same(b,pin));return b;
        }
        internal static byte[] IntentReference(byte[] intent){return MetadataBytes.Hash("onoes-metadata-controller-intent-reference/v2",ValidateIntent(intent));}
        internal static byte[] Report(byte[] intent,byte[] bootstrap){
            var pin=ValidateIntent(intent);var clock=MetadataHostClockContext.Parse(MetadataBytes.Slice(pin,132,128));
            var claims=MetadataBootstrapReport.Validate(bootstrap,clock.Nonce,MetadataBytes.Slice(pin,68,32),Hex(MetadataBytes.Slice(pin,100,32)));
            var b=new byte[ReportBytes];b[0]=79;b[1]=72;b[2]=82;b[3]=50; // OHR2, never a bare OMB1.
            MetadataBytes.Put(b,4,IntentReference(pin));MetadataBytes.Put(b,36,claims);
            MetadataBytes.Put(b,420,MetadataBytes.Hash("onoes-metadata-controller-report/v2",MetadataBytes.Slice(b,0,420)));return b;
        }
        internal static byte[] ValidateReport(byte[] input,byte[] expectedIntent){
            Need(input!=null && input.Length==ReportBytes);var b=(byte[])input.Clone();
            // Exact canonical reconstruction validates framing, parent binding,
            // nested bootstrap semantics and checksum. No current-clock assertion.
            Need(MetadataBytes.Same(b,Report(expectedIntent,MetadataBytes.Slice(b,36,384))));return b;
        }
    }
    internal sealed class MetadataControllerClockHistory {
        readonly byte[] intent,report;
        MetadataControllerClockHistory(byte[] i,byte[] r){intent=i;report=r;}
        internal static MetadataControllerClockHistory Create(byte[] savedIntent,byte[] savedReport,byte[] expectedIntent){
            var i=MetadataControllerClockRecords.MatchIntent(savedIntent,expectedIntent);
            var r=savedReport==null?null:MetadataControllerClockRecords.ValidateReport(savedReport,i);
            return new MetadataControllerClockHistory(i,r);
        }
        internal string Kind {get{return "metadata-controller-clock-history-not-verification";}}
        internal string Status {get{return report==null?"intent-only-unconfirmed":"recorded-claims-not-verification";}}
        internal bool RequiresReconciliation {get{return true;}}
        internal bool MayDispatch {get{return false;}}
        internal bool StopProven {get{return false;}}
        internal byte[] IntentWire {get{return (byte[])intent.Clone();}}
        internal byte[] ReportWire {get{return report==null?null:(byte[])report.Clone();}}
    }
}
