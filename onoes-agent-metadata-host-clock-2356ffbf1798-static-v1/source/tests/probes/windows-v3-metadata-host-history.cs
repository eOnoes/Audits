// Pure historical claim snapshot. Never a fresh observation, stop proof or permit.
using System;
namespace Onoes.MetadataExperiment {
    internal sealed class MetadataHostHistoricalClaims {
        readonly byte[] intent,report;
        MetadataHostHistoricalClaims(byte[] savedIntent,byte[] savedReport){intent=savedIntent;report=savedReport;}
        internal string Kind { get{return "metadata-host-historical-claims-not-verification";} }
        internal string Status { get{return report==null?"intent-only-unconfirmed":"recorded-claims-not-verification";} }
        internal bool RequiresReconciliation { get{return true;} }
        internal bool MayDispatch { get{return false;} }
        internal bool StopProven { get{return false;} }
        internal byte[] IntentWire { get{return (byte[])intent.Clone();} }
        internal byte[] BootstrapWire { get{return report==null?null:(byte[])report.Clone();} }
        internal static MetadataHostHistoricalClaims Create(byte[] inputIntent,byte[] inputReport,byte[] nonce,byte[] inventory,byte[] bundle,byte[] fixture){
            // Bound before copy; null report is a positive native FILE_NOT_FOUND
            // observation supplied by the trusted reader, not a catch-all error.
            if(inputIntent==null || inputIntent.Length!=MetadataHostSinkPolicy.IntentBytes ||
                (inputReport!=null && inputReport.Length!=MetadataBootstrapReport.WireBytes))throw new InvalidOperationException("metadata-host-history-invalid");
            var saved=(byte[])inputIntent.Clone();MetadataHostSinkPolicy.MatchIntent(saved,nonce,inventory,bundle,fixture);
            var verified=inputReport==null?null:MetadataBootstrapReport.Validate(inputReport,nonce,bundle,
                BitConverter.ToString(MetadataBytes.DigestCopy(fixture)).Replace("-","").ToLowerInvariant());
            return new MetadataHostHistoricalClaims(saved,verified);
        }
    }
}
