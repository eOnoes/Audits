// HOST COMPILE ONLY. Reopen exact historical claims; no write, repair or replay.
// Missing/invalid data never means no effect, restored approval, or a safe restart.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace Onoes.MetadataExperiment {
    internal sealed partial class MetadataHostReportSink {
        FileStream OpenHistorical(string suffix,bool allowMissing){
            Parents(true);string path=names[1]+"\\"+leaf+suffix;Time();
            // READ_CONTROL/read attributes/data/synchronize; SHARE_READ only;
            // OPEN_EXISTING, OPEN_REPARSE_POINT and sequential scan. Never create.
            SafeFileHandle handle=CreateFileW(path,0x00120089,1,IntPtr.Zero,3,0x08200000,IntPtr.Zero);
            int error=Marshal.GetLastWin32Error();
            try{
                if(handle==null || handle.IsInvalid){
                    Need(allowMissing && error==2); // ERROR_FILE_NOT_FOUND only, not access/sharing/path errors
                    Parents(true);return null;
                }
                var file=new FileStream(handle,FileAccess.Read,4096,false);handle=null;return file;
            }finally{if(handle!=null)handle.Dispose();}
        }
        byte[] ReadHistoricalBytes(FileStream file,string suffix,int length){
            string path=names[1]+"\\"+leaf+suffix;
            var before=CheckFileShape(file,path,length); // bounded exact length BEFORE allocation/read
            byte[] bytes=new byte[length];bool returned=false;
            try{
                file.Position=0;int at=0;
                while(at<bytes.Length){Time();int n=file.Read(bytes,at,bytes.Length-at);Need(n>0);at+=n;}
                Need(file.ReadByte()==-1);Time();
                var after=CheckFileShape(file,path,length);Need(Same(before,after) && before.WriteHigh==after.WriteHigh && before.WriteLow==after.WriteLow);
                Parents(true);returned=true;return bytes;
            }finally{if(!returned)Array.Clear(bytes,0,bytes.Length);}
        }
        internal static MetadataHostHistoricalClaims ReadHistoricalClaimsInApprovedHost(string expectedVolumeRoot,uint expectedVolume,uint rootIndexHigh,uint rootIndexLow,
            byte[] nonce,byte[] inventory,byte[] bundle,byte[] fixture,Stopwatch originalReadClock){
            MetadataHostReportSink owner=null;FileStream report=null;byte[] savedIntent=null,savedReport=null;
            MetadataHostHistoricalClaims result=null;bool failed=false;
            try{
                // A separate bounded historical READ budget, never a renewed
                // effect/dispatch deadline. Caller starts it before this method.
                owner=OpenRoot(expectedVolumeRoot,expectedVolume,rootIndexHigh,rootIndexLow,nonce,inventory,bundle,fixture,null,originalReadClock,5000);
                owner.intent=owner.OpenHistorical(".intent",false);
                savedIntent=owner.ReadHistoricalBytes(owner.intent,".intent",MetadataHostSinkPolicy.IntentBytes);
                MetadataHostSinkPolicy.MatchIntent(savedIntent,owner.nonce,owner.inventory,owner.bundle,owner.fixture);
                report=owner.OpenHistorical(".bootstrap",true);
                if(report!=null)savedReport=owner.ReadHistoricalBytes(report,".bootstrap",MetadataBootstrapReport.WireBytes);
                result=MetadataHostHistoricalClaims.Create(savedIntent,savedReport,owner.nonce,owner.inventory,owner.bundle,owner.fixture);
                // Recheck both retained files and ancestors before disclosure;
                // no path reopen or mutable caller pin is used for these checks.
                owner.CheckFile(owner.intent,owner.names[1]+"\\"+owner.leaf+".intent",savedIntent);
                if(report!=null)owner.CheckFile(report,owner.names[1]+"\\"+owner.leaf+".bootstrap",savedReport);
                owner.Parents(true);
            }catch{failed=true;}
            finally{
                try{if(report!=null)report.Dispose();}catch{failed=true;}
                try{if(owner!=null)owner.Dispose();}catch{failed=true;}
                if(savedIntent!=null)Array.Clear(savedIntent,0,savedIntent.Length);
                if(savedReport!=null)Array.Clear(savedReport,0,savedReport.Length);
            }
            // A close that crosses the read deadline cannot disclose a timely read.
            Need(!failed && result!=null && originalReadClock!=null && originalReadClock.IsRunning && originalReadClock.ElapsedMilliseconds<5000);
            return result;
        }
    }
}
