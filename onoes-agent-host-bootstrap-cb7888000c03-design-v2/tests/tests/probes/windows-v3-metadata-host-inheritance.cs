// COMPILE ONLY. INERT fixture handle staging, NOT a protected host launcher.
// No process creation/resume, VM, evidence handles, paths, credentials or jobs.
// The future dedicated creator must prevent concurrent broad-inheritance launches.
using System;using System.Runtime.InteropServices;using System.Threading;
using Microsoft.Win32.SafeHandles;
namespace Onoes.MetadataExperiment {
    internal sealed class MetadataHostInertInheritance : IDisposable {
        static readonly object rootsGate=new object();
        static readonly MetadataHostInertInheritance[] roots=new MetadataHostInertInheritance[4];
        readonly object gate=new object();readonly HostInheritancePolicy policy;
        readonly MetadataHostRunClock clock;readonly SafePipeHandle[] duplicates;
        internal readonly HostActor Role;
        internal MetadataHostRunClock OriginalClock {get{return clock;}}
        IntPtr values;bool released;
        MetadataHostInertInheritance(HostActor role,MetadataHostRunClock original){
            Role=role;clock=original;policy=new HostInheritancePolicy(role,original.WorkMs);
            duplicates=new SafePipeHandle[HostInheritancePolicy.Ends(role).Length];
        }
        static void Need(bool ok){if(!ok)throw new InvalidOperationException("host-inheritance-native-denied");}
        void Enter(){if(!Monitor.TryEnter(gate))throw new InvalidOperationException("host-inheritance-busy");}
        void Before(){clock.RequireBefore(Math.Min(clock.WorkMs,5000));}
        void Release(){
            if(released||!policy.MayRelease)return;
            if(values!=IntPtr.Zero){Marshal.FreeHGlobal(values);values=IntPtr.Zero;}
            foreach(var pipe in duplicates)if(pipe!=null)pipe.Dispose();released=true;
        }
        internal static MetadataHostInertInheritance Prepare(HostActor role,MetadataHostInertPair[] supplied,MetadataHostRunClock original){
            Need(Environment.GetEnvironmentVariable("ONOES_HOST_PIPE_INERT_TEST")=="1"&&IntPtr.Size==8&&
                Environment.OSVersion.Platform==PlatformID.Win32NT&&original!=null&&supplied!=null&&supplied.Length==6);
            var pairs=(MetadataHostInertPair[])supplied.Clone();var ends=HostInheritancePolicy.Ends(role);
            for(int i=0;i<6;i++)Need(pairs[i]!=null&&(int)pairs[i].Route==i+1&&Object.ReferenceEquals(pairs[i].Clock,original));
            var owner=new MetadataHostInertInheritance(role,original);
            if(!Monitor.TryEnter(rootsGate))throw new InvalidOperationException("host-inheritance-creation-busy");
            try{int index=(int)role-1;Need(roots[index]==null);roots[index]=owner;}finally{Monitor.Exit(rootsGate);}
            try{
                owner.Before();owner.values=Marshal.AllocHGlobal(IntPtr.Size*ends.Length);
                for(int i=0;i<ends.Length;i++){
                    owner.Before();int end=ends[i];var pair=pairs[Math.Abs(end)-1];
                    // Take consumes ownership before duplication; no reacquisition on failure.
                    using(var source=end>0?pair.TakeReader():pair.TakeWriter()){
                        uint flags;Need(GetHandleInformation(source,out flags)&&flags==0&&GetFileType(source)==3);
                        SafePipeHandle copy;
                        bool ok=DuplicateHandle(GetCurrentProcess(),source,GetCurrentProcess(),out copy,HostInheritancePolicy.AccessForEnd(end),true,0);
                        owner.duplicates[i]=copy;
                        Need(ok&&copy!=null&&!copy.IsInvalid&&!copy.IsClosed);
                        Need(GetHandleInformation(copy,out flags)&&flags==1&&GetFileType(copy)==3);
                        // Duplicates cannot outlive this rooted owner accidentally. No
                        // raw handle value or list may be serialized as evidence.
                        Marshal.WriteIntPtr(owner.values,i*IntPtr.Size,copy.DangerousGetHandle());
                    }
                }
                owner.Before();owner.policy.Prepared(original.ReadElapsedMilliseconds());return owner;
            }catch{owner.policy.Close();owner.Release();throw;}
        }
        // Trusted synchronous native caller only. No current caller exists.
        // Keep owner and all values alive until the CreateProcess call returned
        // AND DeleteProcThreadAttributeList completed, including a failed create.
        internal IntPtr BeginBorrow(out int byteLength){
            Enter();try{
                Before();Need(!released);policy.BeginBorrow(clock.ReadElapsedMilliseconds());
                byteLength=checked(duplicates.Length*IntPtr.Size);return values;
            }catch{policy.Close();Release();throw;}finally{Monitor.Exit(gate);}
        }
        internal void EndBorrow(){Enter();try{policy.EndBorrow();Release();}finally{Monitor.Exit(gate);}}
        public void Dispose(){Enter();try{policy.Close();Release();}finally{Monitor.Exit(gate);}}
        // Dispose while borrowed retains all storage/handles in static roots.
        // Timeout, cancellation and exceptions do not fabricate native return.
        [DllImport("kernel32.dll")]static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool DuplicateHandle(IntPtr sourceProcess,SafePipeHandle source,IntPtr targetProcess,out SafePipeHandle target,uint access,bool inherit,uint options);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetHandleInformation(SafePipeHandle pipe,out uint flags);
        [DllImport("kernel32.dll",SetLastError=true)]static extern uint GetFileType(SafePipeHandle pipe);
    }
}
