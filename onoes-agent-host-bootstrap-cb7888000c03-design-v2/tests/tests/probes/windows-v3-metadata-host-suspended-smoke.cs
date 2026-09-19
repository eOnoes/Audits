// PREPARED, NOT RUN. Requires separate bounded host execution approval.
// Creates exactly one fixed suspended child; never resumes it or controls a VM.
using System;using System.Diagnostics;using System.Runtime.InteropServices;using System.Threading;
using Microsoft.Win32.SafeHandles;using Onoes.MetadataExperiment;
internal static class HostSuspendedSmoke {
    static readonly Stopwatch elapsed=Stopwatch.StartNew();static int stage=10;
    static void Need(bool ok){if(!ok)throw new InvalidOperationException("inert-suspended-check");}
    static void Tick(){Need(elapsed.ElapsedMilliseconds<6500);Thread.Sleep(5);}
    [DllImport("kernel32.dll",SetLastError=true)]static extern bool PeekNamedPipe(SafePipeHandle pipe,IntPtr buffer,uint size,IntPtr read,out uint available,IntPtr left);
    [DllImport("kernel32.dll")]static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll",SetLastError=true)]static extern bool DuplicateHandle(IntPtr sourceProcess,SafePipeHandle source,IntPtr targetProcess,out SafePipeHandle target,uint access,bool inherit,uint options);
    [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetHandleInformation(SafePipeHandle pipe,out uint flags);
    static int Main(string[] args){
        if(args.Length!=1||Environment.GetEnvironmentVariable("ONOES_HOST_PIPE_INERT_TEST")!="1"||
            (args[0]!="dispose"&&args[0]!="deadline"&&args[0]!="duplicate-create"))return 2;
        using(var exitTimer=new Timer(_=>Environment.Exit(124),null,8000,Timeout.Infinite)){
            var pairs=new MetadataHostInertPair[6];SafePipeHandle reader=null,sentinelReader=null,sentinelWriter=null;
            MetadataHostInertInheritance channels=null;MetadataHostInertSuspendedController child=null;
            try{
                var nonce=new byte[32];nonce[0]=1;var clock=MetadataHostRunClock.CaptureInTrustedHost(nonce,4000);
                for(int i=0;i<6;i++)pairs[i]=MetadataHostInertPair.CreateForInertHarness((HostReadRoute)(i+1),clock);
                // Retain ONLY the counterpart of the child's output. Every other
                // creator end is closed after creation; no data is ever written.
                reader=pairs[0].TakeReader();stage=20;
                sentinelReader=pairs[1].TakeReader();
                using(var source=pairs[1].TakeWriter()){
                    Need(DuplicateHandle(GetCurrentProcess(),source,GetCurrentProcess(),out sentinelWriter,0,true,2));
                    uint flags;Need(sentinelWriter!=null&&!sentinelWriter.IsInvalid&&GetHandleInformation(sentinelWriter,out flags)&&flags==1);
                }
                channels=MetadataHostInertInheritance.Prepare(HostActor.Controller,pairs,clock);stage=30;
                child=MetadataHostInertSuspendedController.Prepare(channels);stage=40;
                sentinelWriter.Dispose();sentinelWriter=null;
                foreach(var pair in pairs)pair.Dispose();
                child.AssertPreparedForInertProbe();uint available;
                Need(PeekNamedPipe(reader,IntPtr.Zero,0,IntPtr.Zero,out available,IntPtr.Zero)&&available==0);
                // An inheritable but NOT allowlisted sentinel must already see EOF
                // while the retained child is live. Broad inheritance would fail.
                bool sentinel=PeekNamedPipe(sentinelReader,IntPtr.Zero,0,IntPtr.Zero,out available,IntPtr.Zero);
                int sentinelError=sentinel?0:Marshal.GetLastWin32Error();Need(!sentinel&&sentinelError==109);
                child.AssertPreparedForInertProbe();sentinelReader.Dispose();sentinelReader=null;
                if(args[0]=="duplicate-create"){
                    bool denied=false;try{MetadataHostInertSuspendedController.Prepare(channels);}catch(InvalidOperationException){denied=true;}
                    Need(denied);child.AssertPreparedForInertProbe();
                }
                stage=50;if(args[0]!="deadline")child.Dispose();
                while(!child.StopConfirmed)Tick();
                stage=60;
                bool peek=PeekNamedPipe(reader,IntPtr.Zero,0,IntPtr.Zero,out available,IntPtr.Zero);
                int error=peek?0:Marshal.GetLastWin32Error();Need(!peek&&error==109);
                reader.Dispose();reader=null;channels.Dispose();child.Dispose();stage=70;
                Console.WriteLine("{\"kind\":\"native-inert-suspended-controller\",\"mode\":\""+args[0]+"\",\"passed\":true,\"childStopObserved\":true,\"vmContact\":false,\"authority\":\"none\"}");return 0;
            }catch{Console.Error.WriteLine("inert-host-suspended-failed:"+stage);return 1;}
            finally{
                try{
                    if(child!=null)child.Dispose();if(channels!=null)channels.Dispose();if(reader!=null)reader.Dispose();
                    if(sentinelReader!=null)sentinelReader.Dispose();if(sentinelWriter!=null)sentinelWriter.Dispose();
                    foreach(var pair in pairs)if(pair!=null)pair.Dispose();
                }catch{Console.Error.WriteLine("inert-host-suspended-failed:70");}
            }
        }
    }
}
