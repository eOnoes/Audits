// TEST LINK SUBSTITUTE ONLY. Never compiled into host-report-sink.dll.
// The real bridge is exercised against this fake retention owner, NOT native I/O.
using System;
using System.Collections.Generic;
namespace Onoes.MetadataExperiment {
    internal sealed class MetadataHostReportSink {
        internal static readonly List<string> Trace=new List<string>();
        internal static bool FailReserve,FailReady,FailRecord,FailDispose;
        internal static void Reset(){Trace.Clear();FailReserve=FailReady=FailRecord=FailDispose=false;}
        internal sealed class WatchdogReservation : IDisposable {
            internal byte[] Intent;
            internal void AssertReadyForArm(){Trace.Add("ready");if(FailReady)throw new Exception("fake-private-ready");}
            internal void RecordTerminalClaims(byte[] input){MetadataWatchdogClockRecords.ValidateTerminal(input,Intent);Trace.Add("record");if(FailRecord)throw new Exception("fake-private-record");}
            public void Dispose(){Trace.Add("dispose");if(FailDispose)throw new Exception("fake-private-dispose");}
        }
        internal static WatchdogReservation ReserveWatchdogInApprovedHost(string root,uint volume,uint high,uint low,
            byte[] nonce,byte[] inventory,byte[] bundle,byte[] fixture,int work,MetadataHostRunClock clock,byte[] context,byte[] reference,byte[] hostSession){
            var wire=MetadataHostClockTransfer.RequireExistingInTrustedHost(clock,context,reference,hostSession,nonce,work);
            var intent=MetadataWatchdogClockRecords.Intent(MetadataWatchdogRetentionPolicy.RootBinding(root,volume,high,low),inventory,bundle,fixture,wire);
            Trace.Add("reserve");if(FailReserve)throw new Exception("fake-private-reserve");return new WatchdogReservation{Intent=intent};
        }
    }
}
