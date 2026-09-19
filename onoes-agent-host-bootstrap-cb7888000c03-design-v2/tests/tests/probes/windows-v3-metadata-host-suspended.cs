// COMPILE ONLY, INERT CONTROLLER PREPARATION. No resume API and no product caller.
// Requires a separately pinned fixed inert-role-child.exe beside this assembly.
// Path selection is NOT loader custody. No G/S independent-lifetime claim.
using System;using System.IO;using System.Runtime.InteropServices;using System.Text;using System.Threading;
using Microsoft.Win32.SafeHandles;
namespace Onoes.MetadataExperiment {
    internal sealed class HostCreationHandle : SafeHandleZeroOrMinusOneIsInvalid {
        internal HostCreationHandle():base(true){}
        internal HostCreationHandle(IntPtr value):base(true){SetHandle(value);}
        [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr value);
        protected override bool ReleaseHandle(){return CloseHandle(handle);}
    }
    internal sealed class MetadataHostInertSuspendedController : IDisposable {
        static MetadataHostInertSuspendedController root;static readonly object claimGate=new object();
        readonly object gate=new object();readonly MetadataHostRunClock clock;readonly HostSuspendedPolicy policy;
        HostCreationHandle job,process,thread;Timer timer;uint pid;long created;bool released;
        MetadataHostInertSuspendedController(MetadataHostRunClock original){clock=original;policy=new HostSuspendedPolicy(original.WorkMs);}
        [StructLayout(LayoutKind.Sequential)]struct Basic {internal long ProcessTime,JobTime;internal uint Flags;internal UIntPtr Min,Max;internal uint Count;internal UIntPtr Affinity;internal uint Priority,Scheduling;}
        [StructLayout(LayoutKind.Sequential)]struct Io {internal ulong ReadOps,WriteOps,OtherOps,ReadBytes,WriteBytes,OtherBytes;}
        [StructLayout(LayoutKind.Sequential)]struct Limits {internal Basic Basic;internal Io Io;internal UIntPtr ProcessMemory,JobMemory,PeakProcess,PeakJob;}
        [StructLayout(LayoutKind.Sequential)]struct Cpu {internal uint Flags,Rate;}
        [StructLayout(LayoutKind.Sequential)]struct Accounting {internal long User,Kernel,PeriodUser,PeriodKernel;internal uint Faults,Total,Active,Terminated;}
        [StructLayout(LayoutKind.Sequential)]struct Startup {internal uint Size;internal IntPtr Reserved,Desktop,Title;internal uint X,Y,W,H,XC,YC,Fill,Flags;internal ushort Show,ReservedSize;internal IntPtr ReservedBytes,Input,Output,Error;}
        [StructLayout(LayoutKind.Sequential)]struct StartupEx {internal Startup Startup;internal IntPtr Attributes;}
        [StructLayout(LayoutKind.Sequential)]struct ProcessInfo {internal IntPtr Process,Thread;internal uint Pid,Tid;}
        [StructLayout(LayoutKind.Sequential)]struct FileTime {internal uint Low,High;}
        static void Need(bool value){if(!value)throw new InvalidOperationException("host-suspended-native-denied");}
        long Now(){try{return clock.ReadElapsedMilliseconds();}catch{policy.Unknown();return -1;}}
        uint Active(){Accounting a;Need(QueryInformationJobObject(job,1,out a,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero));return a.Active;}
        long Creation(){FileTime c,e,k,u;Need(GetProcessTimes(process,out c,out e,out k,out u));return unchecked((long)(((ulong)c.High<<32)|c.Low));}
        void Identity(){bool member;Need(process!=null&&!process.IsInvalid&&GetProcessId(process)==pid&&Creation()==created&&created>0);
            Need(IsProcessInJob(process,job,out member)&&member&&WaitForSingleObject(process,0)==258&&Active()==1);}
        void CheckLimits(){Limits limits;Cpu cpu;Need(QueryInformationJobObject(job,9,out limits,(uint)Marshal.SizeOf(typeof(Limits)),IntPtr.Zero));
            Need(QueryInformationJobObject(job,15,out cpu,(uint)Marshal.SizeOf(typeof(Cpu)),IntPtr.Zero));
            Need(limits.Basic.Flags==0x2208&&limits.Basic.Count==1&&limits.JobMemory.ToUInt64()==268435456&&cpu.Flags==5&&cpu.Rate==2000);}
        internal static MetadataHostInertSuspendedController Prepare(MetadataHostInertInheritance channels){
            Need(channels!=null&&channels.Role==HostActor.Controller&&Environment.GetEnvironmentVariable("ONOES_HOST_PIPE_INERT_TEST")=="1");
            var owner=new MetadataHostInertSuspendedController(channels.OriginalClock);
            lock(claimGate){Need(root==null);root=owner;}
            IntPtr attributes=IntPtr.Zero,jobValue=IntPtr.Zero,environment=IntPtr.Zero;bool initialized=false,borrowed=false;
            try{
                owner.clock.RequireBefore(Math.Min(owner.clock.WorkMs,5000));
                owner.job=CreateJobObjectW(IntPtr.Zero,null);Need(owner.job!=null&&!owner.job.IsInvalid);
                var limits=new Limits();limits.Basic.Flags=0x2208;limits.Basic.Count=1;limits.JobMemory=new UIntPtr(268435456);
                Need(SetInformationJobObject(owner.job,9,ref limits,(uint)Marshal.SizeOf(typeof(Limits))));
                var cpu=new Cpu{Flags=5,Rate=2000};Need(SetInformationJobObject(owner.job,15,ref cpu,(uint)Marshal.SizeOf(typeof(Cpu))));owner.CheckLimits();
                IntPtr size=IntPtr.Zero;bool sized=InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref size);
                Need(!sized&&Marshal.GetLastWin32Error()==122&&size.ToInt64()>0&&size.ToInt64()<=65536);
                attributes=Marshal.AllocHGlobal(size);Need(InitializeProcThreadAttributeList(attributes,2,0,ref size));initialized=true;
                jobValue=Marshal.AllocHGlobal(IntPtr.Size);Marshal.WriteIntPtr(jobValue,owner.job.DangerousGetHandle());
                Need(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x2000D),jobValue,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero));
                int bytes;IntPtr handles=channels.BeginBorrow(out bytes);borrowed=true;Need(bytes==16);
                Need(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x20002),handles,new IntPtr(bytes),IntPtr.Zero,IntPtr.Zero));
                string directory=Path.GetDirectoryName(typeof(MetadataHostInertSuspendedController).Assembly.Location);
                Need(!String.IsNullOrEmpty(directory)&&directory.IndexOfAny(new[]{'"','\r','\n','\0'})<0);
                string executable=Path.Combine(directory,"inert-role-child.exe");
                // No task argument, arbitrary command, PATH, stdio or credential inheritance.
                environment=Marshal.StringToHGlobalUni("ONOES_HOST_PIPE_INERT_TEST=1\0SystemRoot="+Environment.GetFolderPath(Environment.SpecialFolder.Windows)+"\0\0");
                var startup=new StartupEx();startup.Startup.Size=(uint)Marshal.SizeOf(typeof(StartupEx));startup.Attributes=attributes;
                owner.policy.BeginCreate(owner.Now());ProcessInfo info;
                bool ok=CreateProcessW(executable,new StringBuilder("\""+executable+"\" --never-resume"),IntPtr.Zero,IntPtr.Zero,true,
                    0x08080404,environment,directory,ref startup,out info);
                // Retain returned identities immediately, before any time/property check.
                if(ok){owner.process=new HostCreationHandle(info.Process);owner.thread=new HostCreationHandle(info.Thread);owner.pid=info.Pid;}
                owner.policy.CreateReturned(ok,owner.Now());Need(ok);
                owner.created=owner.Creation();owner.Identity();owner.CheckLimits();owner.policy.RequirePrepared(owner.Now());
            }catch{owner.policy.Deny();throw;}
            finally{
                // No observer thread may free memory while CreateProcess is in flight.
                // Control reaches here only when the synchronous call unwound.
                try{
                    if(initialized)DeleteProcThreadAttributeList(attributes);
                    if(attributes!=IntPtr.Zero)Marshal.FreeHGlobal(attributes);
                    if(jobValue!=IntPtr.Zero)Marshal.FreeHGlobal(jobValue);
                    if(environment!=IntPtr.Zero)Marshal.FreeHGlobal(environment);
                    if(borrowed)channels.EndBorrow();else channels.Dispose();
                }catch{owner.policy.Unknown();channels.Dispose();throw;}
                finally{if(owner.policy.Closed)owner.Dispose();}
            }
            lock(owner.gate){
                try{owner.timer=new Timer(owner.Tick,null,1,10);}catch{owner.Dispose();throw;}
                // No resume method exists. The timer terminates even an unused owner.
            }
            return owner;
        }
        void Stop(){
            if(process==null){if(job!=null){job.Dispose();job=null;}released=true;return;}
            if(!policy.StopAttempted){policy.BeginStop(Now());bool ok=TerminateJobObject(job,93);if(!ok)policy.Unknown();}
            if(!policy.Uncertain)policy.ObserveStop(WaitForSingleObject(process,0),Active(),Now());
            if(policy.StopConfirmed){thread.Dispose();process.Dispose();job.Dispose();released=true;if(timer!=null)timer.Dispose();}
        }
        void Tick(object ignored){lock(gate){if(released)return;try{
            long now=Now();if(policy.Closed||now<0||now>=Math.Min(clock.WorkMs,5000))Stop();
        }catch{policy.Unknown();}if(policy.Uncertain&&timer!=null)timer.Dispose();}}
        internal bool StopConfirmed {get{lock(gate){return policy.StopConfirmed&&!policy.Uncertain;}}}
        internal void AssertPreparedForInertProbe(){lock(gate){Need(!released);policy.RequirePrepared(Now());Identity();CheckLimits();}}
        public void Dispose(){lock(gate){if(released)return;policy.Deny();try{Stop();}catch{policy.Unknown();}
            if(!released&&!policy.Uncertain&&timer==null)timer=new Timer(Tick,null,1,10);
            if(policy.Uncertain&&timer!=null)timer.Dispose();}}
        // Unknown stop retains job/root handles in the static root. No retry, PID
        // reopening, kill-success-as-settlement, or automatic fresh owner exists.
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern HostCreationHandle CreateJobObjectW(IntPtr security,string name);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool SetInformationJobObject(HostCreationHandle job,int kind,ref Limits value,uint size);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool SetInformationJobObject(HostCreationHandle job,int kind,ref Cpu value,uint size);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool QueryInformationJobObject(HostCreationHandle job,int kind,out Limits value,uint size,IntPtr returned);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool QueryInformationJobObject(HostCreationHandle job,int kind,out Cpu value,uint size,IntPtr returned);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool QueryInformationJobObject(HostCreationHandle job,int kind,out Accounting value,uint size,IntPtr returned);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool IsProcessInJob(HostCreationHandle process,HostCreationHandle job,out bool member);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool TerminateJobObject(HostCreationHandle job,uint code);
        [DllImport("kernel32.dll",SetLastError=true)]static extern uint WaitForSingleObject(HostCreationHandle handle,uint timeout);
        [DllImport("kernel32.dll")]static extern uint GetProcessId(HostCreationHandle process);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetProcessTimes(HostCreationHandle process,out FileTime created,out FileTime exit,out FileTime kernel,out FileTime user);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,uint flags,ref IntPtr size);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr key,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
        [DllImport("kernel32.dll")]static extern void DeleteProcThreadAttributeList(IntPtr list);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CreateProcessW(string application,StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,uint flags,IntPtr environment,string directory,ref StartupEx startup,out ProcessInfo info);
    }
}
