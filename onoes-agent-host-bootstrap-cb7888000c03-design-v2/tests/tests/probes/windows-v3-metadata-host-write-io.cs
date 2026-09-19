// COMPILE ONLY. Private constructor; separate same-process inert test admission.
// Only a future protected creator may supply its own overlapped write endpoint,
// original clock, exact direction/access and retained process/inheritance binding.
using System;using System.Runtime.InteropServices;using System.Threading;
using Microsoft.Win32.SafeHandles;
namespace Onoes.MetadataExperiment {
    internal sealed partial class MetadataHostWriteLane {
        static readonly object rootsGate=new object();
        static readonly MetadataHostWriteLane[] roots=new MetadataHostWriteLane[6];
        readonly object gate=new object();readonly SafePipeHandle pipe;readonly MetadataHostRunClock clock;readonly MetadataHostWritePolicy policy;
        IntPtr raw,buffer,overlap;SafeWaitHandle completion;bool added,closed;
        [StructLayout(LayoutKind.Sequential)]struct NativeOverlapped {internal UIntPtr Internal,InternalHigh;internal uint Offset,OffsetHigh;internal IntPtr Event;}
        MetadataHostWriteLane(SafePipeHandle ownedPipe,MetadataHostRunClock originalClock,HostReadRoute route){
            if(Environment.OSVersion.Platform!=PlatformID.Win32NT||IntPtr.Size!=8||ownedPipe==null||ownedPipe.IsInvalid||ownedPipe.IsClosed||originalClock==null)
                throw new InvalidOperationException("host-write-configuration");
            pipe=ownedPipe;clock=originalClock;policy=new MetadataHostWritePolicy(route,clock.WorkMs);
            if(!Monitor.TryEnter(rootsGate))throw new InvalidOperationException("host-write-construction-busy");
            try{int index=(int)route-1;if(roots[index]!=null)throw new InvalidOperationException("host-write-route-consumed");roots[index]=this;}
            finally{Monitor.Exit(rootsGate);}
        }
        long Sample(){try{return clock.ReadElapsedMilliseconds();}catch{policy.Abandon();return -1;}}
        // Local buffer/operation cleanup only, never peer/effect settlement.
        internal bool LocalIoSettled {get{if(!Monitor.TryEnter(gate))return false;try{return !policy.Outstanding&&!added&&buffer==IntPtr.Zero&&overlap==IntPtr.Zero&&completion==null;}finally{Monitor.Exit(gate);}}}
        void Enter(){if(!Monitor.TryEnter(gate))throw new InvalidOperationException("host-write-busy");}
        void ReleaseSettled(){
            if(!policy.MayRelease)throw new InvalidOperationException("host-write-pending");
            if(overlap!=IntPtr.Zero){Marshal.FreeHGlobal(overlap);overlap=IntPtr.Zero;}
            if(buffer!=IntPtr.Zero){Marshal.FreeHGlobal(buffer);buffer=IntPtr.Zero;}
            if(completion!=null){completion.Dispose();completion=null;}
            if(added){pipe.DangerousRelease();added=false;}raw=IntPtr.Zero;
            if(policy.Outstanding)policy.ReleaseOperation();
        }
        void CancelOnce(){
            if(!policy.Outstanding||policy.Settled||policy.CancelAttempted)return;policy.MarkCancel();
            try{bool ok=CancelIoEx(raw,overlap);int error=ok?0:Marshal.GetLastWin32Error();policy.CancelReturned(ok,error);}catch{policy.Abandon();}
        }
        void Fail(){closed=true;policy.Tick(Sample(),true);CancelOnce();if(policy.MayRelease){ReleaseSettled();pipe.Dispose();}else policy.Abandon();}
        internal void BeginWrite(byte[] frame){
            Enter();try{
                if(closed||policy.Closed||policy.Outstanding)throw new InvalidOperationException("host-write-closed-or-pending");
                pipe.DangerousAddRef(ref added);raw=pipe.DangerousGetHandle();uint flags;
                if(GetFileType(raw)!=3||!GetHandleInformation(raw,out flags)||flags!=0)throw new InvalidOperationException("host-write-handle");
                if(Marshal.SizeOf(typeof(NativeOverlapped))!=32)throw new InvalidOperationException("host-write-layout");
                completion=CreateEventW(IntPtr.Zero,true,false,null);if(completion==null||completion.IsInvalid)throw new InvalidOperationException("host-write-event");
                overlap=Marshal.AllocHGlobal(32);Marshal.StructureToPtr(new NativeOverlapped{Event=completion.DangerousGetHandle()},overlap,false);
                buffer=Marshal.AllocHGlobal(452);
                var snapshot=policy.Begin(frame,Sample());Marshal.Copy(snapshot,0,buffer,snapshot.Length);Array.Clear(snapshot,0,snapshot.Length);
                policy.Tick(Sample(),false);if(!policy.MaySubmit)throw new InvalidOperationException("host-write-expired-before-submit");
                bool ok=WriteFile(raw,buffer,(uint)policy.Requested,IntPtr.Zero,overlap);int error=ok?0:Marshal.GetLastWin32Error();
                policy.StartReturned(ok,error,Sample());
            }catch{Fail();throw;}finally{Monitor.Exit(gate);}
        }
        // At most one non-waiting completion query. True reports local completion ONLY.
        internal bool Poll(){
            Enter();try{
                if(closed||!policy.Outstanding)throw new InvalidOperationException("host-write-not-pending");
                policy.Tick(Sample(),false);if(policy.CancelNeeded)CancelOnce();
                if(!policy.Settled&&!policy.MustRetain){
                    uint count;bool ok=GetOverlappedResult(raw,overlap,out count,false);int error=ok?0:Marshal.GetLastWin32Error();policy.Observe(ok,error,count,Sample());
                }
                if(policy.MustRetain){Fail();throw new InvalidOperationException("host-write-completion-unconfirmed");}
                if(!policy.Settled)return false;
                policy.Tick(Sample(),false);if(!policy.MayAcknowledge){Fail();throw new InvalidOperationException("host-write-denied");}
                bool finished=policy.Finished;ReleaseSettled();if(finished){closed=true;pipe.Dispose();}return true;
            }catch{Fail();throw;}finally{Monitor.Exit(gate);}
        }
        internal void RequestClose(){Enter();try{
            policy.Tick(Sample(),true);CancelOnce();if(policy.MayRelease){ReleaseSettled();closed=true;pipe.Dispose();}
        }catch{Fail();throw;}finally{Monitor.Exit(gate);}}
        [DllImport("kernel32.dll",SetLastError=true)]static extern uint GetFileType(IntPtr handle);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetHandleInformation(IntPtr handle,out uint flags);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern SafeWaitHandle CreateEventW(IntPtr security,bool manual,bool initial,string name);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool WriteFile(IntPtr handle,IntPtr bytes,uint length,IntPtr transferred,IntPtr overlapped);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetOverlappedResult(IntPtr handle,IntPtr overlapped,out uint bytes,bool wait);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool CancelIoEx(IntPtr handle,IntPtr overlapped);
    }
}
