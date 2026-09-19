// COMPILE ONLY. Low-level local property checks, NOT inherited-handle admission.
// No caller exists. Caller must own/retain trusted endpoints, provide the original
// authenticated run clock, and close its endpoints on failure. No ownership transfer.
using System;using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace Onoes.MetadataExperiment {
    internal static class MetadataHostChildLocal {
        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        delegate int QueryObject(IntPtr handle,int kind,IntPtr buffer,uint length,out uint returned);
        // NtQueryObject's documented PUBLIC_OBJECT_BASIC_INFORMATION has fourteen
        // uint32 fields (56 bytes); GrantedAccess is field two. No names/tokens read.
        internal static uint ClearAndMeasure(SafePipeHandle pipe,int expectedEnd,MetadataHostRunClock original,HostChildChannelPolicy policy){
            HostInheritancePolicy.AccessForEnd(expectedEnd);
            if(pipe==null||original==null||policy==null||IntPtr.Size!=8||Environment.OSVersion.Platform!=PlatformID.Win32NT)
                throw new InvalidOperationException("host-child-local-input");
            bool added=false;IntPtr buffer=IntPtr.Zero;
            try{
                original.RequireBefore(original.CodePreparationDeadlineMs);
                pipe.DangerousAddRef(ref added);IntPtr raw=pipe.DangerousGetHandle();
                Need(raw!=IntPtr.Zero&&raw!=new IntPtr(-1));
                uint flags=0;Need(GetFileType(raw)==3&&GetHandleInformation(raw,out flags)&&flags==1);
                policy.BeforeClear(expectedEnd,raw.ToInt64(),3,flags,original.ReadElapsedMilliseconds());
                original.RequireBefore(original.CodePreparationDeadlineMs);
                // Clear only INHERIT; unknown/protect-from-close flags were denied.
                Need(SetHandleInformation(raw,1,0));
                Need(GetFileType(raw)==3&&GetHandleInformation(raw,out flags)&&flags==0);
                original.RequireBefore(original.CodePreparationDeadlineMs);
                // Resolve an already-loaded Windows module, never load a caller path.
                IntPtr module=GetModuleHandleW("ntdll.dll");Need(module!=IntPtr.Zero);
                IntPtr entry=GetProcAddress(module,"NtQueryObject");Need(entry!=IntPtr.Zero);
                var query=(QueryObject)Marshal.GetDelegateForFunctionPointer(entry,typeof(QueryObject));
                buffer=Marshal.AllocHGlobal(56);for(int i=0;i<56;i+=4)Marshal.WriteInt32(buffer,i,0);
                uint returned;int status=query(raw,0,buffer,56,out returned);
                Need(status==0&&returned==56);
                uint granted=unchecked((uint)Marshal.ReadInt32(buffer,4));
                HostInheritancePolicy.RequireAccess(expectedEnd,granted);
                Need(GetFileType(raw)==3&&GetHandleInformation(raw,out flags)&&flags==0);
                original.RequireBefore(original.CodePreparationDeadlineMs);
                policy.AfterClear(raw.ToInt64(),true,3,flags,original.ReadElapsedMilliseconds());
                GC.KeepAlive(query);return granted;
            }catch{
                policy.Close();throw;
            }finally{
                if(buffer!=IntPtr.Zero)Marshal.FreeHGlobal(buffer);
                if(added)pipe.DangerousRelease();
            }
        }
        static void Need(bool ok){if(!ok)throw new InvalidOperationException("host-child-local-denied");}
        [DllImport("kernel32.dll",SetLastError=true)]static extern uint GetFileType(IntPtr handle);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetHandleInformation(IntPtr handle,out uint flags);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr GetModuleHandleW(string name);
        [DllImport("kernel32.dll",CharSet=CharSet.Ansi,ExactSpelling=true,SetLastError=true)]static extern IntPtr GetProcAddress(IntPtr module,string name);
    }
}
