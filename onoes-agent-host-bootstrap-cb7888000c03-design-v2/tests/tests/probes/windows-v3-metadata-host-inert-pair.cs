// COMPILE ONLY. Same-process INERT TEST factory, NOT production endpoint admission.
// No file paths, process launch, inheritance, services, VM or protected enrollment.
// No arbitrary caller handles/names/SIDs accepted; environment guard is NOT authorization.
using System;using System.Runtime.InteropServices;using System.Security.AccessControl;using System.Security.Cryptography;using System.Security.Principal;using System.Threading;
using Microsoft.Win32.SafeHandles;
namespace Onoes.MetadataExperiment {
    internal sealed class MetadataHostInertPair : IDisposable {
        static readonly object rootsGate=new object();static readonly MetadataHostInertPair[] roots=new MetadataHostInertPair[6];
        readonly object gate=new object();readonly MetadataHostPairPolicy policy;readonly IoCompletionPolicy connect;
        internal readonly HostReadRoute Route;internal readonly MetadataHostRunClock Clock;
        SafePipeHandle reader,writer;SafeWaitHandle completion;IntPtr overlap,rawReader;bool added;
        string sid;uint own;
        [StructLayout(LayoutKind.Sequential)]struct Security {internal int Length;internal IntPtr Descriptor;internal int Inherit;}
        [StructLayout(LayoutKind.Sequential)]struct Overlap {internal UIntPtr Internal,InternalHigh;internal uint Offset,OffsetHigh;internal IntPtr Event;}
        MetadataHostInertPair(HostReadRoute route,MetadataHostRunClock clock){
            if(clock==null)throw new InvalidOperationException("host-pair-clock");Route=route;Clock=clock;
            policy=new MetadataHostPairPolicy(route,clock.WorkMs);connect=new IoCompletionPolicy(PipeIoKind.Connect,0,policy.Deadline);
        }
        // Inert-harness diagnostics only: source line, never names, SID or exception text.
        static void Need(bool b,[System.Runtime.CompilerServices.CallerLineNumber]int line=0){if(!b)throw new InvalidOperationException("host-pair-native-denied:"+line);}
        long Now(){return Clock.ReadElapsedMilliseconds();}
        void Before(){Clock.RequireBefore(policy.Deadline);}
        void Enter(){if(!Monitor.TryEnter(gate))throw new InvalidOperationException("host-pair-busy");}
        void FreeConnect(){
            Need(connect.MayRelease);
            if(overlap!=IntPtr.Zero){Marshal.FreeHGlobal(overlap);overlap=IntPtr.Zero;}
            if(completion!=null){completion.Dispose();completion=null;}
            if(added){reader.DangerousRelease();added=false;}rawReader=IntPtr.Zero;
        }
        void CloseOwned(){
            policy.Close();
            if(!connect.MayRelease){
                connect.Abandon();
                if(!connect.CancelCalled){connect.MarkCancelAttempt();try{bool ok=CancelIoEx(rawReader,overlap);int error=ok?0:Marshal.GetLastWin32Error();connect.NoteCancelResult(ok,error);}catch{}}
                return; // complete pair/addref/event/OVERLAPPED stay rooted; no retry/reap
            }
            FreeConnect();if(reader!=null){reader.Dispose();reader=null;}if(writer!=null){writer.Dispose();writer=null;}
        }
        void SecurityCheck(SafePipeHandle pipe){
            IntPtr owner,group,dacl,sacl,sd=IntPtr.Zero;
            try{
                Need(GetSecurityInfo(pipe,1,5,out owner,out group,out dacl,out sacl,out sd)==0&&sd!=IntPtr.Zero);
                uint length=GetSecurityDescriptorLength(sd);Need(length>0&&length<=4096);var bytes=new byte[length];Marshal.Copy(sd,bytes,0,(int)length);
                var descriptor=new RawSecurityDescriptor(bytes,0);var required=ControlFlags.DiscretionaryAclPresent|ControlFlags.DiscretionaryAclProtected;
                Need((descriptor.ControlFlags&required)==required&&descriptor.Owner!=null&&descriptor.Owner.Value==sid&&descriptor.DiscretionaryAcl!=null&&descriptor.DiscretionaryAcl.Count==1);
                var ace=descriptor.DiscretionaryAcl[0] as CommonAce;
                Need(ace!=null&&!ace.IsCallback&&ace.AceFlags==AceFlags.None&&ace.AceQualifier==AceQualifier.AccessAllowed&&ace.SecurityIdentifier.Value==sid&&unchecked((uint)ace.AccessMask)==MetadataHostPairPolicy.CreatorAcl);
            }finally{if(sd!=IntPtr.Zero)LocalFree(sd);}
        }
        void CheckReader(){
            uint h=0,p=0,o=0,i=0,n=0,s=0,c=0;Need(reader!=null&&!reader.IsInvalid&&!reader.IsClosed&&GetHandleInformation(reader,out h));
            // Query the server using its mapped READ access. Do not widen client rights for these queries.
            Need(GetNamedPipeInfo(reader,out p,out o,out i,out n)&&GetNamedPipeHandleStateW(reader,out s,out c,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,0));
            uint type=GetFileType(reader);
            Need(type==3);
            Need(h==0);
            if(p!=9)throw new InvalidOperationException("host-pair-flags:"+p);
            Need(o<=65536);
            Need(i<=65536);
            Need(n==1);
            Need(s==0);
            Need(c==1);
            MetadataHostPairPolicy.CheckServer(type,h,p,o,i,n,s,c);SecurityCheck(reader);
        }
        void CheckWriter(){uint flags=0;Need(writer!=null&&!writer.IsInvalid&&!writer.IsClosed&&GetHandleInformation(writer,out flags));MetadataHostPairPolicy.CheckClient(GetFileType(writer),flags);SecurityCheck(writer);}
        void Create(){
            policy.Begin(Now());own=GetCurrentProcessId();Need(own!=0);
            using(var identity=WindowsIdentity.GetCurrent(TokenAccessLevels.Query)){
                Need(identity.User!=null&&identity.ImpersonationLevel==TokenImpersonationLevel.None);sid=identity.User.Value;
            }
            var random=new byte[16];using(var rng=new RNGCryptoServiceProvider())rng.GetBytes(random);
            string name=@"\\.\pipe\OnoesHostInert-"+BitConverter.ToString(random).Replace("-","");Array.Clear(random,0,random.Length);
            IntPtr descriptor=IntPtr.Zero;uint length;
            try{
                Need(ConvertStringSecurityDescriptorToSecurityDescriptorW("O:"+sid+"D:P(A;;0x0012008f;;;"+sid+")",1,out descriptor,out length)&&length>0&&length<=4096);
                var security=new Security{Length=Marshal.SizeOf(typeof(Security)),Descriptor=descriptor,Inherit=0};Before();
                reader=CreateNamedPipeW(name,MetadataHostPairPolicy.ServerOpen,MetadataHostPairPolicy.PipeMode,1,4096,4096,1,ref security);Need(reader!=null&&!reader.IsInvalid);
            }finally{if(descriptor!=IntPtr.Zero)LocalFree(descriptor);}
            Before();writer=CreateFileW(name,MetadataHostPairPolicy.ClientAccess,0,IntPtr.Zero,3,MetadataHostPairPolicy.ClientOpen,IntPtr.Zero);Need(writer!=null&&!writer.IsInvalid);
            // Connect this already-owned local client, with valid overlapped storage even for ERROR_PIPE_CONNECTED.
            Before();reader.DangerousAddRef(ref added);rawReader=reader.DangerousGetHandle();Need(Marshal.SizeOf(typeof(Overlap))==32);
            completion=CreateEventW(IntPtr.Zero,true,false,null);Need(completion!=null&&!completion.IsInvalid);
            overlap=Marshal.AllocHGlobal(32);Marshal.StructureToPtr(new Overlap{Event=completion.DangerousGetHandle()},overlap,false);
            connect.Begin(Now(),false);bool ok=ConnectNamedPipe(rawReader,overlap);int error=ok?0:Marshal.GetLastWin32Error();connect.StartReturned(ok,error,Now(),false);
            if(!connect.Settled){uint count;ok=GetOverlappedResult(rawReader,overlap,out count,false);error=ok?0:Marshal.GetLastWin32Error();connect.Observe(ok,error,count,Now(),false);}
            Need(connect.MayReturnSuccess);FreeConnect();Before();CheckReader();CheckWriter();
            uint client=0,server=0;Need(GetNamedPipeClientProcessId(reader,out client)&&GetNamedPipeServerProcessId(writer,out server));MetadataHostPairPolicy.CheckPeers(own,client,server);
            policy.Connected(Now());
        }
        internal static MetadataHostInertPair CreateForInertHarness(HostReadRoute route,MetadataHostRunClock originalClock){
            Need(Environment.GetEnvironmentVariable("ONOES_HOST_PIPE_INERT_TEST")=="1"&&Environment.OSVersion.Platform==PlatformID.Win32NT&&IntPtr.Size==8);
            var pair=new MetadataHostInertPair(route,originalClock);
            if(!Monitor.TryEnter(rootsGate))throw new InvalidOperationException("host-pair-creation-busy");
            try{int index=(int)route-1;Need(roots[index]==null);roots[index]=pair;}finally{Monitor.Exit(rootsGate);}
            try{pair.Create();return pair;}catch{pair.CloseOwned();throw;}
        }
        internal SafePipeHandle TakeReader(){Enter();try{policy.RequireReady(Now());Before();CheckReader();policy.Take(true,Now());var result=reader;reader=null;return result;}catch{CloseOwned();throw;}finally{Monitor.Exit(gate);}}
        internal SafePipeHandle TakeWriter(){Enter();try{policy.RequireReady(Now());Before();CheckWriter();policy.Take(false,Now());var result=writer;writer=null;return result;}catch{CloseOwned();throw;}finally{Monitor.Exit(gate);}}
        public void Dispose(){Enter();try{CloseOwned();}finally{Monitor.Exit(gate);}}
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern SafePipeHandle CreateNamedPipeW(string name,uint access,uint mode,uint instances,uint output,uint input,uint timeout,ref Security security);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern SafePipeHandle CreateFileW(string name,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetHandleInformation(SafePipeHandle pipe,out uint flags);
        [DllImport("kernel32.dll",SetLastError=true)]static extern uint GetFileType(SafePipeHandle pipe);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetNamedPipeInfo(SafePipeHandle pipe,out uint flags,out uint output,out uint input,out uint instances);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool GetNamedPipeHandleStateW(SafePipeHandle pipe,out uint state,out uint current,IntPtr collection,IntPtr timeout,IntPtr user,uint size);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe,out uint id);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe,out uint id);
        [DllImport("kernel32.dll")]static extern uint GetCurrentProcessId();
        [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text,uint revision,out IntPtr descriptor,out uint size);
        [DllImport("advapi32.dll")]static extern uint GetSecurityInfo(SafePipeHandle pipe,uint type,uint info,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
        [DllImport("advapi32.dll")]static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
        [DllImport("kernel32.dll")]static extern IntPtr LocalFree(IntPtr pointer);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern SafeWaitHandle CreateEventW(IntPtr security,bool manual,bool initial,string name);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool ConnectNamedPipe(IntPtr pipe,IntPtr overlap);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetOverlappedResult(IntPtr pipe,IntPtr overlap,out uint bytes,bool wait);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool CancelIoEx(IntPtr pipe,IntPtr overlap);
    }
}
