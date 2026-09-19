// HOST COMPILE ONLY. V2 create-only retention and separate historical read.
// Never adopt legacy files, authenticate the host, renew a run, or permit replay.
using System;using System.Diagnostics;using System.IO;using System.Threading;
namespace Onoes.MetadataExperiment {
    internal sealed partial class MetadataHostReportSink {
        byte[] controllerClockIntent;
        internal static MetadataHostReportSink ReserveClockBoundInApprovedHost(string root,uint volume,uint high,uint low,
            byte[] nonce,byte[] inventory,byte[] bundle,byte[] fixture,int workMs,MetadataHostRunClock original,
            byte[] context,byte[] contextReference,byte[] hostSession){
            var ownedContext=MetadataHostClockTransfer.RequireExistingInTrustedHost(original,context,contextReference,hostSession,nonce,workMs);
            var bound=MetadataControllerClockRecords.Intent(MetadataWatchdogRetentionPolicy.RootBinding(root,volume,high,low),inventory,bundle,fixture,ownedContext);
            var owner=OpenRoot(root,volume,high,low,MetadataHostClockContext.Parse(ownedContext).Nonce,
                MetadataBytes.Slice(bound,36,32),MetadataBytes.Slice(bound,68,32),MetadataBytes.Slice(bound,100,32),original,null,original.RetentionDeadlineMs);
            try{
                owner.controllerClockIntent=bound;
                owner.intent=owner.WriteNew(".controller-intent-v2",bound);
                owner.Parents(true);original.RequireBefore(workMs);owner.reservationReady=true;return owner;
            }catch{owner.poisoned=true;try{owner.Dispose();}catch{}throw new InvalidOperationException("metadata-host-sink-unavailable");}
        }
        internal void RecordClockBoundBootstrapClaims(byte[] input){
            Need(!closed && !poisoned && reservationReady && controllerClockIntent!=null && Interlocked.CompareExchange(ref reportAttempted,1,0)==0);
            byte[] report=null;
            try{
                Time();report=MetadataControllerClockRecords.Report(controllerClockIntent,input);
                CheckFile(intent,names[1]+"\\"+leaf+".controller-intent-v2",controllerClockIntent);
                using(var recorded=WriteNew(".controller-report-v2",report)){Parents(true);}Time();
            }catch{poisoned=true;throw new InvalidOperationException("metadata-host-sink-unavailable");}
            finally{if(report!=null)Array.Clear(report,0,report.Length);}
        }
        internal static MetadataControllerClockHistory ReadClockBoundHistoryInApprovedHost(string root,uint volume,uint high,uint low,
            byte[] nonce,byte[] inventory,byte[] bundle,byte[] fixture,int workMs,byte[] context,byte[] contextReference,byte[] hostSession,Stopwatch readClock){
            // Structural match only: an expired historical clock is not restarted.
            var clock=MetadataHostClockContext.Parse(context);clock.Match(contextReference,hostSession,nonce,workMs);
            var expected=MetadataControllerClockRecords.Intent(MetadataWatchdogRetentionPolicy.RootBinding(root,volume,high,low),inventory,bundle,fixture,clock.ToWire());
            MetadataHostReportSink owner=null;FileStream report=null;byte[] savedIntent=null,savedReport=null;
            MetadataControllerClockHistory result=null;bool failed=false;
            try{
                owner=OpenRoot(root,volume,high,low,clock.Nonce,MetadataBytes.Slice(expected,36,32),MetadataBytes.Slice(expected,68,32),MetadataBytes.Slice(expected,100,32),null,readClock,5000);
                owner.intent=owner.OpenHistorical(".controller-intent-v2",false);
                savedIntent=owner.ReadHistoricalBytes(owner.intent,".controller-intent-v2",MetadataControllerClockRecords.IntentBytes);
                MetadataControllerClockRecords.MatchIntent(savedIntent,expected);
                report=owner.OpenHistorical(".controller-report-v2",true);
                if(report!=null)savedReport=owner.ReadHistoricalBytes(report,".controller-report-v2",MetadataControllerClockRecords.ReportBytes);
                result=MetadataControllerClockHistory.Create(savedIntent,savedReport,expected);
                owner.CheckFile(owner.intent,owner.names[1]+"\\"+owner.leaf+".controller-intent-v2",savedIntent);
                if(report!=null)owner.CheckFile(report,owner.names[1]+"\\"+owner.leaf+".controller-report-v2",savedReport);
                owner.Parents(true);
            }catch{failed=true;}
            finally{
                try{if(report!=null)report.Dispose();}catch{failed=true;}
                try{if(owner!=null)owner.Dispose();}catch{failed=true;}
                if(savedIntent!=null)Array.Clear(savedIntent,0,savedIntent.Length);
                if(savedReport!=null)Array.Clear(savedReport,0,savedReport.Length);
            }
            Need(!failed && result!=null && readClock!=null && readClock.IsRunning && readClock.ElapsedMilliseconds<5000);return result;
        }
    }
}
