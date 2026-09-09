// Dormant install-time primitive. No service registration, operator approval,
// task admission, source import, existing-root adoption, repair or deletion.
// Compile and run ONLY in disposable guests until independent consumer review.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

internal sealed partial class WindowsManagedWorkspace {
    private static void ProvisionerIdentity() {
        Need(Environment.OSVersion.Platform==PlatformID.Win32NT && IntPtr.Size==8,"platform");
        using(var current=WindowsIdentity.GetCurrent())Need(current.User.Value==SystemSid,"provisioner-identity");
    }
    // Descriptive discovery only. Caller must independently choose/protect the
    // installation namespace and persist its pin. Not an authorization token.
    internal static string CaptureProvisioningParentIdentity(string path) {
        ProvisionerIdentity(); ProvisioningPath(path,true);
        using(var handle=Open(path,ReadControl|Read,3)) {
            Need((Info(handle).Attributes&0x410)==0x10,"directory-kind");
            return Identity(handle);
        }
    }
    private static void ProvisioningPath(string path,bool allowVolume) {
        Need(path!=null && path.IndexOf('/')<0,"root-path");
        if(allowVolume && Regex.IsMatch(path,@"\A[A-Z]:\\\z")) {
            Need(GetDriveTypeW(path)==3,"fixed-volume-required"); return;
        }
        RootSyntax(path);
    }
    // Shared retained ancestry for creation and its separate creation record.
    // No callback/await or caller-controlled security descriptor is accepted.
    private sealed class ProvisioningParent : IDisposable {
        private readonly List<SafeFileHandle> handles=new List<SafeFileHandle>();
        private readonly List<string> names=new List<string>();
        private readonly string pin,sid;
        internal readonly string ChildPath,RecordPath;
        internal ProvisioningParent(string path,string expectedParentIdentity,string expectedServiceSid) {
            ProvisionerIdentity(); ProvisioningPath(path,false);
            Need(expectedParentIdentity!=null && expectedParentIdentity.Length>0 && expectedParentIdentity.Length<=512,"parent-pin");
            Need(expectedServiceSid!=null && Regex.IsMatch(expectedServiceSid,@"\AS-1-5-80-([0-9]+-){4}[0-9]+\z")
                && new SecurityIdentifier(expectedServiceSid).Value==expectedServiceSid,"service-identity");
            pin=expectedParentIdentity;sid=expectedServiceSid;
            try {
            string[] parts=path.Substring(3).Split('\\'); string prefix=path.Substring(0,3);
            for(int i=0;i<parts.Length;i++) {
                if(i>0)prefix=prefix.TrimEnd('\\')+"\\"+parts[i-1];
                var handle=Open(prefix,ReadControl|Read,3); handles.Add(handle);
                Need((Info(handle).Attributes&0x410)==0x10,"directory-kind");
                SecurityCheck(handle,false,expectedServiceSid);
                string final=Name(handle);names.Add(final);
                int boundary=final.IndexOf("}\\",StringComparison.Ordinal)+2;
                Need(boundary>1 && final.Substring(boundary)==prefix.Substring(3),"root-alias");
            }
            var parent=handles[handles.Count-1];
            Need(Identity(parent)==expectedParentIdentity,"parent-pin");
            var fs=new StringBuilder(32);uint serial,component,flags;
            Need(GetVolumeInformationByHandleW(handles[0],null,0,out serial,out component,out flags,fs,32)
                && fs.ToString()=="NTFS" && (flags&8)!=0,"ntfs-required");
            // GUID path from retained handles, not the caller's mutable drive
            // mapping. Every ancestor remains open without delete sharing.
            ChildPath=Name(parent).TrimEnd('\\')+"\\"+parts[parts.Length-1];
            RecordPath=Name(parent).TrimEnd('\\')+"\\.onoes-root-"+Digest(Encoding.UTF8.GetBytes(parts[parts.Length-1])).Substring(7)+".record";
            } catch {Dispose();throw;}
        }
        internal void Check() {
            for(int i=0;i<handles.Count;i++) {
                Need(Name(handles[i])==names[i] && (Info(handles[i]).Attributes&0x410)==0x10,"ancestor-changed");
                SecurityCheck(handles[i],false,sid);
            }
            Need(Identity(handles[handles.Count-1])==pin,"parent-pin");
        }
        public void Dispose() {for(int i=handles.Count-1;i>=0;i--)handles[i].Dispose();}
    }
    internal static string ProvisionNewRoot(string path,string expectedParentIdentity,string expectedServiceSid) {
        // A trusted SYSTEM installation controller, not an interactive client
        // or the ordinary non-admin service, owns this one create-only step.
        // The controller must bind the real installed service identity itself.
        using(var parent=new ProvisioningParent(path,expectedParentIdentity,expectedServiceSid)) {
            string createdPath=parent.ChildPath;
            var acl=new DirectorySecurity();
            acl.SetSecurityDescriptorSddlForm("O:SYG:SYD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;"+expectedServiceSid+")");
            byte[] bytes=acl.GetSecurityDescriptorBinaryForm();var pin=GCHandle.Alloc(bytes,GCHandleType.Pinned);
            try {
                var security=new SecurityAttributes {Length=Marshal.SizeOf(typeof(SecurityAttributes)),Descriptor=pin.AddrOfPinnedObject(),Inherit=0};
                // Atomic create-only: no existence-check/adopt/ACL-rewrite path.
                Need(CreateDirectoryW(createdPath,ref security),"provision-create");
                using(var created=Open(createdPath,ReadControl|Read,3)) {
                    Need((Info(created).Attributes&0x410)==0x10 && Name(created)==createdPath,"root-alias");
                    SecurityCheck(created,true,expectedServiceSid);
                    using(var file=CreatePrivate(createdPath+"\\.onoes-io.lock",ReadControl|Read|Write,0,ref security,1,NoFollow,IntPtr.Zero)) {
                        Need(!file.IsInvalid,"provision-lock-create");
                        SecurityCheck(file,true,expectedServiceSid);var info=Info(file);
                        Need((info.Attributes&~(0x20u|0x80u))==0 && info.Links==1 && info.SizeHigh==0 && info.SizeLow==0
                            && Name(file)==createdPath+"\\.onoes-io.lock" && FlushFileBuffers(file),"provision-lock-readback");
                    }
                    parent.Check();
                    SecurityCheck(created,true,expectedServiceSid);
                    return Identity(created);
                }
            } finally {pin.Free();}
        }
        // Failure can leave a private orphan; this primitive still never adopts
        // or deletes it. Directory-entry power-loss durability is not claimed.
    }
}
