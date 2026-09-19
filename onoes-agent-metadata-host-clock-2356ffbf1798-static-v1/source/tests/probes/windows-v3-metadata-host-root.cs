// HOST COMPILE ONLY. No Main/caller, elevation, installation or root adoption.
// Separate scoped approval is required before this fixed CREATE-ONLY operation.
// Its returned identity is a proposal, not enrollment, retention or execution permission.
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;
namespace Onoes.MetadataExperiment {
    internal sealed partial class MetadataHostReportSink {
        static int rootPreparationClaimed;
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
        static extern bool CreateDirectoryW(string path,ref CreationSecurity security);
        static void RootTime(Stopwatch original){Need(original!=null && original.IsRunning && original.ElapsedMilliseconds<MetadataHostRootPolicy.BudgetMs);}
        static Information CheckRootParent(SafeFileHandle parent,string path,uint volume,uint high,uint low){
            var info=Info(parent);
            Need((info.Attributes&0x410)==0x10 && info.Volume==volume && info.IndexHigh==high && info.IndexLow==low && Name(parent)==path);
            MetadataFixturePolicy.AncestorDescriptor(Security(parent),true);return info;
        }
        internal static MetadataHostRootProposal CreateRootInApprovedHost(string expectedVolumeRoot,uint expectedVolume,
            uint parentIndexHigh,uint parentIndexLow,Stopwatch original,out MetadataHostRootSnapshot snapshot){
            var policy=new MetadataHostRootPolicy();snapshot=policy.Snapshot();
            SafeFileHandle parent=null,root=null;GCHandle descriptorPin=default(GCHandle);
            byte[] descriptor=null;MetadataHostRootProposal proposal=null;bool failed=false;
            try{
                RootTime(original);MetadataFixturePolicy.VolumeRoot(expectedVolumeRoot);Need(parentIndexHigh!=0 || parentIndexLow!=0);
                Need(Environment.OSVersion.Platform==PlatformID.Win32NT && IntPtr.Size==8 &&
                    Marshal.SizeOf(typeof(Information))==52 && Marshal.SizeOf(typeof(CreationSecurity))==24);
                using(var identity=WindowsIdentity.GetCurrent())Need(identity.User!=null && identity.User.Value==MetadataFixturePolicy.SystemSid);
                Need(Interlocked.CompareExchange(ref rootPreparationClaimed,1,0)==0);
                parent=CreateFileW(expectedVolumeRoot,0x00120080,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
                var before=CheckRootParent(parent,expectedVolumeRoot,expectedVolume,parentIndexHigh,parentIndexLow);
                uint serial,max,flags;var filesystem=new StringBuilder(32);
                Need(GetVolumeInformationW(expectedVolumeRoot,IntPtr.Zero,0,out serial,out max,out flags,filesystem,32) &&
                    serial==expectedVolume && filesystem.ToString()=="NTFS" && (flags&8)!=0 && GetDriveTypeW(expectedVolumeRoot)==3);
                string path=expectedVolumeRoot+"OnoesMetadataEvidence01";
                descriptor=MetadataHostSinkPolicy.Descriptor(true);descriptorPin=GCHandle.Alloc(descriptor,GCHandleType.Pinned);
                var security=new CreationSecurity{Length=24,Descriptor=descriptorPin.AddrOfPinnedObject(),Inherit=0};
                RootTime(original);Need(Same(before,CheckRootParent(parent,expectedVolumeRoot,expectedVolume,parentIndexHigh,parentIndexLow)));
                policy.Begin(original.ElapsedMilliseconds); // possible effect BEFORE the one native call
                Need(CreateDirectoryW(path,ref security)); // existing root is a denial, NEVER opened/adopted/repaired
                policy.Created(original.ElapsedMilliseconds);RootTime(original);
                root=CreateFileW(path,0x00120080,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
                var created=Info(root);Need((created.Attributes&0x410)==0x10 && created.Volume==expectedVolume && Name(root)==path);
                MetadataHostSinkPolicy.CheckDescriptor(Security(root),true);RootTime(original);
                Need(Same(before,CheckRootParent(parent,expectedVolumeRoot,expectedVolume,parentIndexHigh,parentIndexLow)));
                Need(Same(created,Info(root)) && Name(root)==path);MetadataHostSinkPolicy.CheckDescriptor(Security(root),true);
                policy.Verified(original.ElapsedMilliseconds);
                proposal=new MetadataHostRootProposal(expectedVolumeRoot,created.Volume,created.IndexHigh,created.IndexLow);
            }catch{failed=true;policy.Failed();}
            finally{
                // Attempt every release. No failed cleanup can return a successful proposal.
                try{if(root!=null)root.Dispose();}catch{failed=true;policy.Failed();}
                try{if(parent!=null)parent.Dispose();}catch{failed=true;policy.Failed();}
                try{if(descriptorPin.IsAllocated)descriptorPin.Free();}catch{failed=true;policy.Failed();}
                if(descriptor!=null)Array.Clear(descriptor,0,descriptor.Length);
                if(!failed)try{RootTime(original);policy.Finish(original.ElapsedMilliseconds);}catch{failed=true;policy.Failed();}
                snapshot=policy.Snapshot();
            }
            Need(!failed && proposal!=null && snapshot.Finished && !snapshot.Uncertain);
            // Handles are closed. Later protected enrollment and sink open must
            // revalidate custody/identity independently; no automatic adoption here.
            return proposal;
        }
    }
}
