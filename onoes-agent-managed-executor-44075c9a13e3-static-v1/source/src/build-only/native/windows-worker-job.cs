// Dormant trusted-bootstrap primitive, compiled only by the disposable guest.
// Job membership is lifecycle control, NOT filesystem/network/token confinement.
// The caller must establish immutable executable/script custody before this call.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

internal sealed class WorkerNativeHandle : SafeHandleZeroOrMinusOneIsInvalid {
    public WorkerNativeHandle() : base(true) {}
    public WorkerNativeHandle(IntPtr value) : base(true) { SetHandle(value); }
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr value);
    protected override bool ReleaseHandle() { return CloseHandle(handle); }
}
internal sealed class WorkerJobExit {
    public uint ExitCode;
    public bool TimedOut;
    public uint RemainingBeforeStop;
    public long StopElapsedMs;
}
internal sealed partial class WindowsWorkerJob : IDisposable {
    const uint WAIT_OBJECT_0=0, WAIT_TIMEOUT=258;
    const int StopBudgetMs=5000;
    readonly object gate=new object();
    WorkerNativeHandle job, process, observedMember;
    bool stopped, disposed, timedOut, terminationUnconfirmed;
    Timer watchdog;
    uint beforeStop;
    long stopElapsed;
    readonly Stopwatch lifetime=Stopwatch.StartNew();
    readonly int runBudget;
    WindowsWorkerJob(int milliseconds) { runBudget=milliseconds; }

    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long ProcessTime,JobTime; public uint Flags;
        public UIntPtr MinWorkingSet,MaxWorkingSet; public uint ActiveProcessLimit;
        public UIntPtr Affinity; public uint Priority,Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOps,WriteOps,OtherOps,ReadBytes,WriteBytes,OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
        public BasicLimits Basic; public IoCounters Io;
        public UIntPtr ProcessMemory,JobMemory,PeakProcessMemory,PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)] struct Accounting {
        public long UserTime,KernelTime,PeriodUserTime,PeriodKernelTime;
        public uint PageFaults,TotalProcesses,ActiveProcesses,TerminatedProcesses;
    }
    [StructLayout(LayoutKind.Sequential)] struct Startup {
        public uint Size; public IntPtr Reserved,Desktop,Title;
        public uint X,Y,XSize,YSize,XChars,YChars,Fill,Flags;
        public ushort Show,ReservedSize; public IntPtr ReservedBytes,Input,Output,Error;
    }
    [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup Startup; public IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process,Thread; public uint Pid,Tid; }
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern WorkerNativeHandle CreateJobObjectW(IntPtr security,string name);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(WorkerNativeHandle job,int kind,ref ExtendedLimits value,uint length);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(WorkerNativeHandle job,int kind,out Accounting value,uint length,IntPtr returned);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(WorkerNativeHandle process,WorkerNativeHandle job,out bool result);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(WorkerNativeHandle job,uint code);
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(WorkerNativeHandle handle,uint milliseconds);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(WorkerNativeHandle process,out uint code);
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(WorkerNativeHandle thread);
    [DllImport("kernel32.dll",SetLastError=true)] static extern WorkerNativeHandle OpenProcess(uint access,bool inherit,uint pid);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,uint flags,ref IntPtr size);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr key,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string application,StringBuilder command,
        IntPtr processSecurity,IntPtr threadSecurity,bool inherit,uint flags,IntPtr environment,string directory,ref StartupEx startup,out ProcessInfo process);
    static void Require(bool valid,string reason) { if(!valid) throw new InvalidOperationException(reason+":"+Marshal.GetLastWin32Error()); }
    static string DirectoryArgument(string value) {
        if(String.IsNullOrEmpty(value) || value.Length>240 || value.IndexOfAny(new[]{'"','\r','\n','\0'})>=0
           || value.StartsWith("\\") || value.Length<4 || value[1]!=':' || value[2]!='\\'
           || value.EndsWith("\\") || !String.Equals(Path.GetFullPath(value),value,StringComparison.Ordinal))
            throw new InvalidOperationException("worker-directory-invalid");
        return value;
    }
    // Fixed node.exe + run.mjs, no caller command string, shell, PATH, NODE_OPTIONS,
    // inherited stdio/handles, named job or breakaway. The service identity is
    // inherited; this function MUST NOT be used to run untrusted repository code.
    public static WindowsWorkerJob StartNode(string runtimeDirectory,string temporaryDirectory,int maximumRunMs) {
        if(Environment.OSVersion.Platform!=PlatformID.Win32NT || IntPtr.Size!=8 || maximumRunMs<1 || maximumRunMs>60000)
            throw new InvalidOperationException("worker-platform-or-budget-invalid");
        string runtime=DirectoryArgument(runtimeDirectory), temp=DirectoryArgument(temporaryDirectory);
        string executable=Path.Combine(runtime,"node.exe"), script=Path.Combine(runtime,"run.mjs");
        var worker=new WindowsWorkerJob(maximumRunMs);
        IntPtr attributes=IntPtr.Zero, jobList=IntPtr.Zero, environment=IntPtr.Zero;
        bool attributesInitialized=false;
        WorkerNativeHandle thread=null;
        try {
            worker.job=CreateJobObjectW(IntPtr.Zero,null); Require(!worker.job.IsInvalid,"worker-job-create");
            var limits=new ExtendedLimits();
            limits.Basic.Flags=0x2000|0x8|0x200; // KILL_ON_JOB_CLOSE | ACTIVE_PROCESS | JOB_MEMORY.
            limits.Basic.ActiveProcessLimit=8; limits.JobMemory=new UIntPtr(536870912);
            Require(SetInformationJobObject(worker.job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimits))),"worker-job-limits");
            IntPtr size=IntPtr.Zero;
            bool sized=InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);
            Require(!sized && Marshal.GetLastWin32Error()==122 && size.ToInt64()>0 && size.ToInt64()<=65536,"worker-attribute-size");
            attributes=Marshal.AllocHGlobal(size);
            Require(InitializeProcThreadAttributeList(attributes,1,0,ref size),"worker-attribute-init"); attributesInitialized=true;
            jobList=Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobList,worker.job.DangerousGetHandle());
            // JOB_LIST assigns membership as part of process creation. No orphan
            // gap exists between CreateProcess and a later AssignProcess call.
            Require(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x0002000D),jobList,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"worker-job-attribute");
            var startup=new StartupEx(); startup.Startup.Size=(uint)Marshal.SizeOf(typeof(StartupEx)); startup.Attributes=attributes;
            string block="NODE_ENV=production\0SystemRoot="+Environment.GetFolderPath(Environment.SpecialFolder.Windows)+"\0TEMP="+temp+"\0TMP="+temp+"\0\0";
            environment=Marshal.StringToHGlobalUni(block);
            ProcessInfo info;
            // EXTENDED_STARTUPINFO_PRESENT | NO_WINDOW | UNICODE_ENV | SUSPENDED.
            Require(CreateProcessW(executable,new StringBuilder("\""+executable+"\" \""+script+"\""),IntPtr.Zero,IntPtr.Zero,false,
                0x08080404,environment,runtime,ref startup,out info),"worker-process-create");
            worker.process=new WorkerNativeHandle(info.Process); thread=new WorkerNativeHandle(info.Thread);
            bool member; Require(IsProcessInJob(worker.process,worker.job,out member)&&member,"worker-job-membership");
            // Arm independently of WaitForCompletion, and before any child code.
            // No caller await, heartbeat, PID enumeration or cooperative abort
            // is required for the deadline to terminate this owned process group.
            worker.watchdog=new Timer(worker.OnDeadline,null,(int)Math.Max(1,maximumRunMs-worker.lifetime.ElapsedMilliseconds),Timeout.Infinite);
            Require(ResumeThread(thread)==1,"worker-resume");
            return worker;
        } catch {
            // Preserve the creation/start failure. Cleanup still runs, but a
            // secondary stop-confirmation exception must not replace the
            // original diagnostic at the exact path where launch failed.
            try { worker.Dispose(); } catch {}
            throw;
        }
        finally {
            if(thread!=null) thread.Dispose();
            if(attributesInitialized) DeleteProcThreadAttributeList(attributes);
            if(attributes!=IntPtr.Zero) Marshal.FreeHGlobal(attributes);
            if(jobList!=IntPtr.Zero) Marshal.FreeHGlobal(jobList);
            if(environment!=IntPtr.Zero) Marshal.FreeHGlobal(environment);
            GC.KeepAlive(worker);
        }
    }
    uint ActiveCount() {
        Accounting value;
        Require(QueryInformationJobObject(job,1,out value,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero),"worker-accounting");
        return value.ActiveProcesses;
    }
    void OnDeadline(object unused) {
        lock(gate) {
            if(disposed || stopped) return;
            timedOut=true;
            try { StopAndConfirm(); }
            catch {
                terminationUnconfirmed=true;
                // Closing this sole, non-inherited handle requests kill too,
                // but inability to observe empty membership MUST NOT become PASS.
                if(job!=null) job.Dispose();
            }
        }
    }
    public bool HasConfirmedTimeout { get { lock(gate) { return timedOut && stopped && !terminationUnconfirmed; } } }
    // Optional bounded diagnostic positive control. Membership and liveness are
    // checked on a retained handle, never inferred from a PID or executable name.
    public void ObserveLiveMember(uint pid) {
        lock(gate) {
            if(disposed || stopped || observedMember!=null || pid==0) throw new InvalidOperationException("worker-observation-invalid");
            var member=OpenProcess(0x00101000,false,pid); // synchronize + query limited.
            try {
                bool inJob;
                Require(!member.IsInvalid && IsProcessInJob(member,job,out inJob)&&inJob
                    && WaitForSingleObject(member,0)==WAIT_TIMEOUT,"worker-observed-member-not-live");
                observedMember=member; member=null;
            } finally { if(member!=null) member.Dispose(); }
        }
    }
    // Diagnostic membership read-back for another already-identified worker.
    // This does not replace the retained root/member handles or zero-job check.
    public void VerifyAdditionalLiveMember(uint pid) {
        lock(gate) {
            if(disposed || stopped || pid==0) throw new InvalidOperationException("worker-observation-invalid");
            using(var member=OpenProcess(0x00101000,false,pid)) {
                bool inJob;
                Require(!member.IsInvalid && IsProcessInJob(member,job,out inJob)&&inJob
                    && WaitForSingleObject(member,0)==WAIT_TIMEOUT,"worker-additional-member-not-live");
            }
        }
    }
    // A zero exit status is not a cleanup receipt. Wait for root-handle signal
    // AND zero members after termination. Never infer quiescence from a PID list.
    public WorkerJobExit WaitForCompletion() {
        uint code;
        while(true) {
            lock(gate) {
                if(disposed) throw new InvalidOperationException("worker-disposed");
                if(terminationUnconfirmed) throw new InvalidOperationException("worker-stop-unconfirmed");
                uint state=WaitForSingleObject(process,0);
                Require(state==WAIT_OBJECT_0 || state==WAIT_TIMEOUT,"worker-root-wait");
                if(state==WAIT_OBJECT_0) {
                    // If observation is late and the watchdog has not run yet,
                    // do not infer an on-time finish from a signaled handle.
                    if(!stopped && lifetime.ElapsedMilliseconds>=runBudget) timedOut=true;
                    break;
                }
                if(lifetime.ElapsedMilliseconds>=runBudget) { timedOut=true; break; }
            }
            Thread.Sleep(10);
        }
        StopAndConfirm();
        lock(gate) {
            Require(GetExitCodeProcess(process,out code),"worker-exit-code");
            return new WorkerJobExit {ExitCode=code,TimedOut=timedOut,RemainingBeforeStop=beforeStop,StopElapsedMs=stopElapsed};
        }
    }
    public void StopAndConfirm() {
        lock(gate) {
            if(stopped) return;
            if(disposed || terminationUnconfirmed) throw new InvalidOperationException("worker-stop-unconfirmed");
            if(job==null || job.IsInvalid) { stopped=true; return; }
            var timer=Stopwatch.StartNew(); beforeStop=ActiveCount();
            Require(TerminateJobObject(job,93),"worker-terminate-job");
            while(true) {
                uint state=process==null ? WAIT_OBJECT_0 : WaitForSingleObject(process,0);
                Require(state==WAIT_OBJECT_0 || state==WAIT_TIMEOUT,"worker-stop-wait");
                bool observedStopped=observedMember==null || WaitForSingleObject(observedMember,0)==WAIT_OBJECT_0;
                if(state==WAIT_OBJECT_0 && observedStopped && ActiveCount()==0 && timer.ElapsedMilliseconds<=StopBudgetMs) {
                    stopped=true; stopElapsed=timer.ElapsedMilliseconds;
                    if(watchdog!=null) watchdog.Change(Timeout.Infinite,Timeout.Infinite);
                    return;
                }
                if(timer.ElapsedMilliseconds>=StopBudgetMs) throw new InvalidOperationException("worker-stop-timeout");
                Thread.Sleep(10);
            }
        }
    }
    public void Dispose() {
        lock(gate) {
            if(disposed) return;
            try { StopAndConfirm(); }
            finally { disposed=true; if(watchdog!=null) watchdog.Dispose(); if(job!=null) job.Dispose(); if(process!=null) process.Dispose(); if(observedMember!=null) observedMember.Dispose(); }
        }
    }
}
