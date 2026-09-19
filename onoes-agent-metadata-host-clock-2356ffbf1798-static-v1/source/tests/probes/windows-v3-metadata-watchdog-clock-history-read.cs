// HOST COMPILE ONLY. Separate V2 historical read, never a live-run clock or retry.
using System;using System.Diagnostics;using System.IO;
namespace Onoes.MetadataExperiment {
    internal sealed partial class MetadataHostReportSink {
        internal static MetadataWatchdogClockHistory ReadWatchdogClockHistoryInApprovedHost(string root,uint volume,uint high,uint low,
            byte[] nonce,byte[] inventory,byte[] bundle,byte[] fixture,int workMs,byte[] context,byte[] reference,byte[] hostSession,Stopwatch readClock){
            var clock=MetadataHostClockContext.Parse(context);clock.Match(reference,hostSession,nonce,workMs);
            var expected=MetadataWatchdogClockRecords.Intent(MetadataWatchdogRetentionPolicy.RootBinding(root,volume,high,low),inventory,bundle,fixture,clock.ToWire());
            MetadataHostReportSink owner=null;FileStream terminal=null;byte[] savedIntent=null,savedTerminal=null;
            MetadataWatchdogClockHistory result=null;bool failed=false;
            try{
                owner=OpenRoot(root,volume,high,low,clock.Nonce,MetadataBytes.Slice(expected,36,32),MetadataBytes.Slice(expected,68,32),MetadataBytes.Slice(expected,100,32),null,readClock,5000);
                owner.intent=owner.OpenHistorical(".watchdog-intent-v2",false);
                savedIntent=owner.ReadHistoricalBytes(owner.intent,".watchdog-intent-v2",MetadataWatchdogClockRecords.IntentBytes);
                MetadataWatchdogClockRecords.MatchIntent(savedIntent,expected);
                terminal=owner.OpenHistorical(".watchdog-terminal-v2",true);
                if(terminal!=null)savedTerminal=owner.ReadHistoricalBytes(terminal,".watchdog-terminal-v2",MetadataWatchdogClockRecords.TerminalBytes);
                result=MetadataWatchdogClockHistory.Create(savedIntent,savedTerminal,expected);
                owner.CheckFile(owner.intent,owner.names[1]+"\\"+owner.leaf+".watchdog-intent-v2",savedIntent);
                if(terminal!=null)owner.CheckFile(terminal,owner.names[1]+"\\"+owner.leaf+".watchdog-terminal-v2",savedTerminal);
                owner.Parents(true);
            }catch{failed=true;}
            finally{
                try{if(terminal!=null)terminal.Dispose();}catch{failed=true;}
                try{if(owner!=null)owner.Dispose();}catch{failed=true;}
                foreach(var bytes in new[]{expected,savedIntent,savedTerminal})if(bytes!=null)Array.Clear(bytes,0,bytes.Length);
            }
            Need(!failed && result!=null && readClock!=null && readClock.IsRunning && readClock.ElapsedMilliseconds<5000);return result;
        }
    }
}
