// HOST COMPILE ONLY. Read-only existing artifacts; no installer, loader or Main.
// An ALREADY trusted bootstrap must own this helper. It cannot authenticate the
// DLL/CLR which has already loaded it. Separate host placement/enrollment required.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;
namespace Onoes.MetadataExperiment {
    internal sealed partial class MetadataHostReportSink {
        internal sealed class HostCodeReadHold : IDisposable {
            readonly object gate=new object();readonly MetadataHostCodePin pin;readonly MetadataHostRunClock clock;readonly long deadline;
            readonly SafeFileHandle[] parents=new SafeFileHandle[2];readonly Information[] parentIds=new Information[2];
            readonly string[] paths=new string[2];FileStream file;Information fileId;string filePath;
            bool closed,poisoned,taken,verified;
            HostCodeReadHold(MetadataHostCodePin expected,MetadataHostRunClock original,int workMs){pin=expected;clock=original;deadline=workMs;}
            void Time(){Need(!closed && !poisoned);MetadataHostCodePin.Time(clock,deadline);}
            void Parents(bool capture){
                Time();for(int i=0;i<2;i++){
                    var info=Info(parents[i]);Need((info.Attributes&0x410)==0x10 && Name(parents[i])==paths[i]);
                    if(i==0)MetadataFixturePolicy.AncestorDescriptor(Security(parents[i]),true);
                    else MetadataHostSinkPolicy.CheckDescriptor(Security(parents[i]),true);
                    if(capture)parentIds[i]=info;else Need(Same(info,parentIds[i]));
                    Need(info.Volume==parentIds[0].Volume);Time();
                }
            }
            Information FileShape(){
                Time();var info=Info(file.SafeFileHandle);
                MetadataFixturePolicy.FileShape(info.Attributes,info.Links,info.SizeHigh,info.SizeLow,pin.ByteLength);
                Need(info.Volume==parentIds[0].Volume && Name(file.SafeFileHandle)==filePath);
                MetadataHostSinkPolicy.CheckDescriptor(Security(file.SafeFileHandle),false);
                var streams=new byte[4096];Need(GetFileInformationByHandleEx(file.SafeFileHandle,7,streams,4096));
                MetadataFixturePolicy.UnnamedStream(streams,pin.ByteLength);Time();return info;
            }
            void Check(){
                Parents(false);var current=FileShape();
                Need(Same(current,fileId) && current.WriteHigh==fileId.WriteHigh && current.WriteLow==fileId.WriteLow);Time();
            }
            // Fixed program root, DISTINCT from the evidence root. Identity and
            // byte pins must be independently enrolled, never inferred here.
            internal static HostCodeReadHold OpenInApprovedHost(string volumeRoot,uint volume,uint rootHigh,uint rootLow,
                MetadataHostCodePin pin,MetadataHostRunClock original,int workMs){
                HostCodeReadHold owner=null;SafeFileHandle raw=null;
                try{
                    Need(pin!=null && (rootHigh!=0 || rootLow!=0));MetadataFixturePolicy.VolumeRoot(volumeRoot);
                    Need(original!=null);original.RequireBudget(workMs);
                    MetadataHostCodePin.Time(original,workMs);MetadataHostCodePin.Time(original,Math.Min(workMs,5000));
                    Need(Environment.OSVersion.Platform==PlatformID.Win32NT && IntPtr.Size==8 && Marshal.SizeOf(typeof(Information))==52);
                    using(var identity=WindowsIdentity.GetCurrent())Need(identity.User!=null && identity.User.Value==MetadataFixturePolicy.SystemSid);
                    owner=new HostCodeReadHold(pin,original,workMs);owner.paths[0]=volumeRoot;owner.paths[1]=volumeRoot+"OnoesMetadataHost01";
                    for(int i=0;i<2;i++){owner.Time();owner.parents[i]=CreateFileW(owner.paths[i],0x00120080,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero);}
                    owner.Parents(true);Need(owner.parentIds[0].Volume==volume && owner.parentIds[1].IndexHigh==rootHigh && owner.parentIds[1].IndexLow==rootLow);
                    uint serial,max,flags;var fs=new StringBuilder(32);
                    Need(GetVolumeInformationW(volumeRoot,IntPtr.Zero,0,out serial,out max,out flags,fs,32) && serial==volume &&
                        fs.ToString()=="NTFS" && (flags&8)!=0 && GetDriveTypeW(volumeRoot)==3);
                    owner.filePath=owner.paths[1]+"\\"+pin.Leaf;owner.Time();
                    // READ_CONTROL + GENERIC_READ; FILE_SHARE_READ only; existing
                    // non-following open. No writer/delete-compatible file handle.
                    raw=CreateFileW(owner.filePath,0x80020000,1,IntPtr.Zero,3,0x00200000,IntPtr.Zero);
                    Need(raw!=null && !raw.IsInvalid);owner.file=new FileStream(raw,FileAccess.Read,4096,false);raw=null;
                    owner.fileId=owner.FileShape();owner.Check();
                    MetadataHostCodePin.Time(original,Math.Min(workMs,5000));return owner;
                }catch{
                    if(owner!=null){owner.poisoned=true;try{owner.Dispose();}catch{}}
                    if(raw!=null)try{raw.Dispose();}catch{}
                    throw new InvalidOperationException("metadata-host-code-unavailable");
                }
            }
            // One caller-owned byte handoff. Keep THIS hold alive across all
            // future use; neither returned bytes nor a path are an authority.
            internal byte[] TakeCheckedBytes(){lock(gate){
                byte[] bytes=null;try{
                    Need(!taken);taken=true;Check();bytes=pin.ReadChecked(file,clock,Math.Min(deadline,5000));Check();
                    MetadataHostCodePin.Time(clock,Math.Min(deadline,5000));verified=true;
                    var result=bytes;bytes=null;return result;
                }catch{poisoned=true;throw new InvalidOperationException("metadata-host-code-unavailable");}
                finally{if(bytes!=null)Array.Clear(bytes,0,bytes.Length);}
            }}
            internal void CheckForUse(){lock(gate){try{Need(verified);Check();}catch{poisoned=true;throw new InvalidOperationException("metadata-host-code-unavailable");}}}
            public void Dispose(){lock(gate){
                if(closed)return;closed=true;bool failed=false;
                try{if(file!=null)file.Dispose();}catch{failed=true;}
                for(int i=1;i>=0;i--)try{if(parents[i]!=null)parents[i].Dispose();}catch{failed=true;}
                if(failed)throw new InvalidOperationException("metadata-host-code-unavailable");
            }}
        }
    }
}
