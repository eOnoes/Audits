// HOST COMPILE ONLY. No Main/caller/launcher; do NOT execute without separate
// approved protected-root enrollment and independent-watchdog composition.
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
namespace Onoes.MetadataExperiment {
    internal sealed partial class MetadataHostReportSink {
        // A distinct type exposes NO controller bootstrap writer. Its private
        // owner/handles belong to the future independent watchdog, not its parent.
        internal sealed class WatchdogReservation : IDisposable {
            readonly MetadataHostReportSink owner;readonly byte[] expectedIntent;
            int attempted;bool closed;
            internal WatchdogReservation(MetadataHostReportSink value,byte[] intentWire){owner=value;expectedIntent=(byte[])intentWire.Clone();}
            internal void AssertReadyForArm(){
                Need(!closed && attempted==0);owner.Time();owner.Parents(true);
                owner.CheckFile(owner.intent,owner.names[1]+"\\"+owner.leaf+".watchdog-intent-v2",expectedIntent);
                owner.clock.RequireBefore(MetadataWatchdogClockRecords.Clock(expectedIntent).WorkMs);
            }
            internal void RecordTerminalClaims(byte[] input){
                Need(!closed && Interlocked.CompareExchange(ref attempted,1,0)==0);byte[] wire=null;
                try{
                    owner.Time();wire=MetadataWatchdogClockRecords.ValidateTerminal(input,expectedIntent);
                    owner.CheckFile(owner.intent,owner.names[1]+"\\"+owner.leaf+".watchdog-intent-v2",expectedIntent);
                    using(var recorded=owner.WriteNew(".watchdog-terminal-v2",wire)){owner.Parents(true);}owner.Time();
                }catch{owner.poisoned=true;throw new InvalidOperationException("metadata-host-sink-unavailable");}
                finally{if(wire!=null)Array.Clear(wire,0,wire.Length);}
            }
            public void Dispose(){if(closed)return;closed=true;
                try{owner.Dispose();}finally{Array.Clear(expectedIntent,0,expectedIntent.Length);}}
        }
        internal static WatchdogReservation ReserveWatchdogInApprovedHost(string expectedVolumeRoot,uint expectedVolume,uint rootIndexHigh,uint rootIndexLow,
            byte[] nonce,byte[] inventory,byte[] bundle,byte[] fixture,int workMs,MetadataHostRunClock original,byte[] context,byte[] reference,byte[] hostSession){
            var owned=MetadataHostClockTransfer.RequireExistingInTrustedHost(original,context,reference,hostSession,nonce,workMs);
            byte[] expected=MetadataWatchdogClockRecords.Intent(MetadataWatchdogRetentionPolicy.RootBinding(expectedVolumeRoot,expectedVolume,rootIndexHigh,rootIndexLow),
                inventory,bundle,fixture,owned);
            MetadataHostReportSink owner=null;
            try{
                Need(original!=null);original.RequireRun(nonce,workMs);
                owner=OpenRoot(expectedVolumeRoot,expectedVolume,rootIndexHigh,rootIndexLow,
                    MetadataWatchdogClockRecords.Clock(expected).Nonce,MetadataBytes.Slice(expected,36,32),MetadataBytes.Slice(expected,68,32),MetadataBytes.Slice(expected,100,32),original,null,
                    workMs+MetadataWatchdogRetentionPolicy.StopMs+MetadataWatchdogRetentionPolicy.RetentionMs);
                // Separate reservation BEFORE any future arm. Never open the
                // controller's .intent, depend on its object, or widen sharing.
                owner.intent=owner.WriteNew(".watchdog-intent-v2",expected);
                owner.Parents(true);original.RequireBefore(workMs);owner.reservationReady=true;
                return new WatchdogReservation(owner,expected);
            }catch{if(owner!=null){owner.poisoned=true;try{owner.Dispose();}catch{}}throw new InvalidOperationException("metadata-host-sink-unavailable");}
            finally{Array.Clear(expected,0,expected.Length);}
        }
        internal static MetadataWatchdogHistoricalClaims ReadWatchdogHistoryInApprovedHost(string expectedVolumeRoot,uint expectedVolume,uint rootIndexHigh,uint rootIndexLow,
            byte[] nonce,byte[] inventory,byte[] bundle,byte[] fixture,int workMs,Stopwatch originalReadClock){
            var expected=MetadataWatchdogRetentionPolicy.Intent(MetadataWatchdogRetentionPolicy.RootBinding(expectedVolumeRoot,expectedVolume,rootIndexHigh,rootIndexLow),
                nonce,inventory,bundle,fixture,workMs);
            MetadataHostReportSink owner=null;FileStream terminal=null;byte[] savedIntent=null,savedTerminal=null;
            MetadataWatchdogHistoricalClaims result=null;bool failed=false;
            try{
                owner=OpenRoot(expectedVolumeRoot,expectedVolume,rootIndexHigh,rootIndexLow,
                    MetadataBytes.Slice(expected,36,32),MetadataBytes.Slice(expected,68,32),MetadataBytes.Slice(expected,100,32),MetadataBytes.Slice(expected,132,32),null,originalReadClock,5000);
                owner.intent=owner.OpenHistorical(".watchdog-intent",false);
                savedIntent=owner.ReadHistoricalBytes(owner.intent,".watchdog-intent",MetadataWatchdogRetentionPolicy.IntentBytes);
                MetadataWatchdogRetentionPolicy.MatchIntent(savedIntent,expected);
                terminal=owner.OpenHistorical(".watchdog-terminal",true);
                if(terminal!=null)savedTerminal=owner.ReadHistoricalBytes(terminal,".watchdog-terminal",MetadataWatchdogRetentionPolicy.TerminalBytes);
                result=MetadataWatchdogHistoricalClaims.Create(savedIntent,savedTerminal,expected);
                owner.CheckFile(owner.intent,owner.names[1]+"\\"+owner.leaf+".watchdog-intent",savedIntent);
                if(terminal!=null)owner.CheckFile(terminal,owner.names[1]+"\\"+owner.leaf+".watchdog-terminal",savedTerminal);
                owner.Parents(true);
            }catch{failed=true;}
            finally{
                try{if(terminal!=null)terminal.Dispose();}catch{failed=true;}
                try{if(owner!=null)owner.Dispose();}catch{failed=true;}
                foreach(var bytes in new[]{expected,savedIntent,savedTerminal})if(bytes!=null)Array.Clear(bytes,0,bytes.Length);
            }
            Need(!failed && result!=null && originalReadClock!=null && originalReadClock.IsRunning && originalReadClock.ElapsedMilliseconds<5000);
            return result;
        }
    }
}
