// HOST COMPILE ONLY. No Main/caller/installer. Requires separately approved SYSTEM
// use and an existing private root; NEVER provision, repair, overwrite or delete.
// NTFS flush/readback is not power-loss, anti-rollback or observer-authenticity proof.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;
namespace Onoes.MetadataExperiment {
    internal sealed partial class MetadataHostReportSink : IDisposable {
        readonly SafeFileHandle[] parents=new SafeFileHandle[2];
        readonly Information[] identities=new Information[2];
        readonly string[] names=new string[2];
        readonly MetadataHostRunClock clock;readonly Stopwatch readClock;
        readonly long deadlineMs;
        readonly byte[] nonce,inventory,bundle,fixture;
        readonly string leaf;
        FileStream intent;
        bool closed,poisoned,reservationReady;int reportAttempted;
        [StructLayout(LayoutKind.Sequential)] struct Information {
            internal uint Attributes,CreatedLow,CreatedHigh,AccessLow,AccessHigh,WriteLow,WriteHigh;
            internal uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;
        }
        [StructLayout(LayoutKind.Sequential)] struct CreationSecurity { internal int Length;internal IntPtr Descriptor;internal int Inherit; }
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true,EntryPoint="CreateFileW")] static extern SafeFileHandle CreateProtectedFile(string path,uint access,uint share,ref CreationSecurity security,uint creation,uint flags,IntPtr template);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle file,out Information info);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandleEx(SafeFileHandle file,int kind,[Out] byte[] data,uint length);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetHandleInformation(SafeFileHandle file,out uint flags);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool FlushFileBuffers(SafeFileHandle file);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandleW(SafeFileHandle file,StringBuilder path,uint capacity,uint flags);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetVolumeInformationW(string root,IntPtr name,uint nameSize,out uint serial,out uint maximum,out uint flags,StringBuilder filesystem,uint capacity);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern uint GetDriveTypeW(string root);
        [DllImport("advapi32.dll")] static extern uint GetSecurityInfo(SafeFileHandle file,int kind,uint info,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
        [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
        [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
        static void Need(bool ok){if(!ok)throw new InvalidOperationException("metadata-host-sink-unavailable");}
        MetadataHostReportSink(byte[] run,byte[] inv,byte[] images,byte[] child,MetadataHostRunClock original,Stopwatch historical,long deadline){
            Need((original!=null)!=(historical!=null));
            nonce=MetadataBytes.DigestCopy(run);inventory=MetadataBytes.DigestCopy(inv);bundle=MetadataBytes.DigestCopy(images);fixture=MetadataBytes.DigestCopy(child);
            clock=original;readClock=historical;deadlineMs=deadline;leaf=BitConverter.ToString(nonce).Replace("-","").ToLowerInvariant();
        }
        void Time(){Need(!closed && !poisoned);
            if(clock!=null)clock.RequireBefore(reservationReady?deadlineMs:Math.Min(deadlineMs,clock.WorkMs));
            else Need(readClock!=null && deadlineMs==5000 && readClock.IsRunning && readClock.ElapsedMilliseconds<deadlineMs);
        }
        static Information Info(SafeFileHandle handle){Information info=new Information();uint flags;
            Need(handle!=null && !handle.IsClosed && !handle.IsInvalid && GetHandleInformation(handle,out flags) && flags==0 && GetFileInformationByHandle(handle,out info));return info;
        }
        static string Name(SafeFileHandle handle){var b=new StringBuilder(512);uint n=GetFinalPathNameByHandleW(handle,b,512,1);Need(n>0 && n<512);return b.ToString();}
        static byte[] Security(SafeFileHandle handle){IntPtr o,g,d,s,sd=IntPtr.Zero;
            try{Need(GetSecurityInfo(handle,1,7,out o,out g,out d,out s,out sd)==0 && sd!=IntPtr.Zero);uint n=GetSecurityDescriptorLength(sd);Need(n>=20 && n<=4096);var b=new byte[n];Marshal.Copy(sd,b,0,(int)n);return b;}
            finally{if(sd!=IntPtr.Zero)LocalFree(sd);}
        }
        static bool Same(Information a,Information b){return a.Volume==b.Volume && a.IndexHigh==b.IndexHigh && a.IndexLow==b.IndexLow && a.CreatedHigh==b.CreatedHigh && a.CreatedLow==b.CreatedLow;}
        void Parents(bool compare){
            Time();for(int i=0;i<2;i++){var info=Info(parents[i]);Need((info.Attributes&0x410)==0x10 && Name(parents[i])==names[i]);
                if(i==0)MetadataFixturePolicy.AncestorDescriptor(Security(parents[i]),true);else MetadataHostSinkPolicy.CheckDescriptor(Security(parents[i]),true);
                if(compare)Need(Same(info,identities[i]));else identities[i]=info;Need(info.Volume==identities[0].Volume);
            }Time();
        }
        // expectedVolumeRoot and file identity must come from separate protected
        // enrollment, NOT from discovery inside this call. No arbitrary leaf/path.
        static MetadataHostReportSink OpenRoot(string expectedVolumeRoot,uint expectedVolume,uint rootIndexHigh,uint rootIndexLow,
            byte[] nonce,byte[] inventory,byte[] bundle,byte[] fixture,MetadataHostRunClock original,Stopwatch historical,long deadline){
            MetadataFixturePolicy.VolumeRoot(expectedVolumeRoot);Need(rootIndexHigh!=0 || rootIndexLow!=0);
            Need(Environment.OSVersion.Platform==PlatformID.Win32NT && IntPtr.Size==8 && Marshal.SizeOf(typeof(Information))==52 && Marshal.SizeOf(typeof(CreationSecurity))==24);
            using(var identity=WindowsIdentity.GetCurrent())Need(identity.User!=null && identity.User.Value==MetadataFixturePolicy.SystemSid);
            var owner=new MetadataHostReportSink(nonce,inventory,bundle,fixture,original,historical,deadline);
            try{
                // Recheck the OWNED nonce, not only the mutable factory input,
                // before any native root open or possible reservation write.
                if(original!=null)original.RequireRun(owner.nonce,original.WorkMs);
                owner.Time();owner.names[0]=expectedVolumeRoot;owner.names[1]=expectedVolumeRoot+"OnoesMetadataEvidence01";
                for(int i=0;i<2;i++){owner.Time();owner.parents[i]=CreateFileW(owner.names[i],0x00120080,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero);}
                owner.Parents(false);Need(owner.identities[0].Volume==expectedVolume && owner.identities[1].IndexHigh==rootIndexHigh && owner.identities[1].IndexLow==rootIndexLow);
                uint serial,max,flags;var fs=new StringBuilder(32);Need(GetVolumeInformationW(expectedVolumeRoot,IntPtr.Zero,0,out serial,out max,out flags,fs,32) && serial==expectedVolume && fs.ToString()=="NTFS" && GetDriveTypeW(expectedVolumeRoot)==3);
                owner.Parents(true);return owner;
            }catch{owner.poisoned=true;try{owner.Dispose();}catch{/* Cleanup uncertainty cannot replace the bounded failure. */}throw new InvalidOperationException("metadata-host-sink-unavailable");}
        }
        FileStream WriteNew(string suffix,byte[] wire){
            Need(clock!=null && readClock==null); // Historical reads cannot become writers.
            Parents(true);string path=names[1]+"\\"+leaf+suffix;var descriptor=MetadataHostSinkPolicy.Descriptor(false);
            var pin=GCHandle.Alloc(descriptor,GCHandleType.Pinned);SafeFileHandle handle=null;FileStream stream=null,pendingHandoff=null;
            try{
                var security=new CreationSecurity{Length=24,Descriptor=pin.AddrOfPinnedObject(),Inherit=0};Time();
                handle=CreateProtectedFile(path,0xc0000000,0,ref security,1,0x80200000,IntPtr.Zero);Need(handle!=null && !handle.IsInvalid);
                stream=new FileStream(handle,FileAccess.ReadWrite,4096,false);handle=null;
                var before=Info(stream.SafeFileHandle);Need(before.SizeHigh==0 && before.SizeLow==0 && before.Links==1 && (before.Attributes&~0xa0u)==0 && before.Volume==identities[0].Volume && Name(stream.SafeFileHandle)==path);
                MetadataHostSinkPolicy.CheckDescriptor(Security(stream.SafeFileHandle),false);
                Time();stream.Write(wire,0,wire.Length);stream.Flush();Need(FlushFileBuffers(stream.SafeFileHandle));Time();
                CheckFile(stream,path,wire);Need(Same(before,Info(stream.SafeFileHandle)));Parents(true);
                pendingHandoff=stream;stream=null;return pendingHandoff;
            }finally{MetadataHostSinkPolicy.CompleteWriteCleanup(stream,handle,delegate{pin.Free();},pendingHandoff);}
        }
        Information CheckFileShape(FileStream stream,string path,int length){
            Time();var info=Info(stream.SafeFileHandle);MetadataFixturePolicy.FileShape(info.Attributes,info.Links,info.SizeHigh,info.SizeLow,length);
            Need(info.Volume==identities[0].Volume && Name(stream.SafeFileHandle)==path);MetadataHostSinkPolicy.CheckDescriptor(Security(stream.SafeFileHandle),false);
            var streams=new byte[4096];Need(GetFileInformationByHandleEx(stream.SafeFileHandle,7,streams,4096));MetadataFixturePolicy.UnnamedStream(streams,length);Time();return info;
        }
        void CheckFile(FileStream stream,string path,byte[] wire){
            var before=CheckFileShape(stream,path,wire.Length);
            var read=new byte[wire.Length];try{stream.Position=0;int at=0;while(at<read.Length){Time();int n=stream.Read(read,at,read.Length-at);Need(n>0);at+=n;}
                Need(stream.ReadByte()==-1 && MetadataBytes.Same(read,wire));Time();
                var after=CheckFileShape(stream,path,wire.Length);Need(Same(before,after) && before.WriteHigh==after.WriteHigh && before.WriteLow==after.WriteLow);
            }finally{Array.Clear(read,0,read.Length);}
        }
        public void Dispose(){if(closed)return;closed=true;bool failed=false;
            try{if(intent!=null)intent.Dispose();}catch{failed=true;}
            for(int i=1;i>=0;i--)try{if(parents[i]!=null)parents[i].Dispose();}catch{failed=true;}
            foreach(var bytes in new[]{nonce,inventory,bundle,fixture})Array.Clear(bytes,0,bytes.Length);
            if(controllerClockIntent!=null)Array.Clear(controllerClockIntent,0,controllerClockIntent.Length);
            if(failed)throw new InvalidOperationException("metadata-host-sink-unavailable");
        }
    }
}
