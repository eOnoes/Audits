// TEST LINK SUBSTITUTE ONLY. Never linked into the native host DLL.
using System;using System.Collections.Generic;
namespace Onoes.MetadataExperiment {
    internal sealed class MetadataHostReportSink : IDisposable {
        internal static readonly List<string> Trace=new List<string>();
        internal static bool FailReserve,FailRecord,FailDispose,StopAtReserve,StopAtRecord,StopAtDispose;
        internal static byte[] LastReport,LastIntent,LastEnvelope;static MetadataHostRunClock original;
        internal static void Reset(){Trace.Clear();FailReserve=FailRecord=FailDispose=StopAtReserve=StopAtRecord=StopAtDispose=false;LastReport=LastIntent=LastEnvelope=null;original=null;}
        internal static MetadataHostReportSink ReserveClockBoundInApprovedHost(string root,uint volume,uint high,uint low,byte[] nonce,byte[] inventory,byte[] bundle,byte[] fixture,int workMs,MetadataHostRunClock clock,byte[] context,byte[] reference,byte[] session){
            var wire=MetadataHostClockTransfer.RequireExistingInTrustedHost(clock,context,reference,session,nonce,workMs);
            LastIntent=MetadataControllerClockRecords.Intent(MetadataWatchdogRetentionPolicy.RootBinding(root,volume,high,low),inventory,bundle,fixture,wire);
            Trace.Add("reserve");original=clock;if(FailReserve)throw new Exception("synthetic-private-reserve");if(StopAtReserve)clock.Invalidate();return new MetadataHostReportSink();
        }
        internal void RecordClockBoundBootstrapClaims(byte[] bytes){Trace.Add("record");LastReport=bytes;LastEnvelope=MetadataControllerClockRecords.Report(LastIntent,bytes);if(StopAtRecord)original.Invalidate();if(FailRecord)throw new Exception("synthetic-private-record");}
        public void Dispose(){Trace.Add("dispose");if(StopAtDispose)original.Invalidate();if(FailDispose)throw new Exception("synthetic-private-dispose");}
    }
}
