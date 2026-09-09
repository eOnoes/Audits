// Dormant SYSTEM installation bookkeeping, not approval, import-ready state,
// service enrollment or an anti-rollback witness. New protected namespace only.
// Native compilation/execution remains disposable-guest-only pending review.
using System;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

internal sealed partial class WindowsManagedWorkspace {
    private const string RegistrationDomain="agent-root-provisioning-intent/v1\n";
    [DllImport("kernel32.dll",SetLastError=true)]
    private static extern bool SetFilePointerEx(SafeFileHandle file,long offset,out long position,uint method);

    private static string RegistrationIntent(string path,string parent,string service,string requestId) {
        Need(requestId!=null && Regex.IsMatch(requestId,@"\A[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\z"),"registration-request");
        // These fields cannot contain newlines: path/SID were validated and
        // parent was matched against the physically captured identity already.
        return RegistrationDomain+Digest(Encoding.UTF8.GetBytes("agent-root-provisioning-request/v1\n"
            +requestId+"\n"+path+"\n"+parent+"\n"+service+"\n"))+"\n";
    }
    private static void RegistrationAppend(SafeFileHandle file,byte[] bytes) {
        Need(bytes.Length>0 && bytes.Length<=1024,"registration-budget");
        uint written;Need(WriteFile(file,bytes,(uint)bytes.Length,out written,IntPtr.Zero)
            &&written==bytes.Length&&FlushFileBuffers(file),"registration-write");
    }
    private static string RegistrationRead(SafeFileHandle file,ProvisioningParent parent,string intent,string service) {
        FileCheck(file,parent.RecordPath,service);
        long offset;Need(SetFilePointerEx(file,0,out offset,0)&&offset==0,"registration-seek");
        byte[] bytes=ReadBytes(file,1024);string text;
        try {text=new UTF8Encoding(false,true).GetString(bytes);} catch(DecoderFallbackException){throw new ManagedIoException("registration-invalid");}
        Need(text.StartsWith(intent,StringComparison.Ordinal),"registration-mismatch");
        string[] fields=text.Substring(intent.Length).Split('\n');
        Need(fields.Length==3 && fields[0].Length>0 && fields[0].Length<=512 && fields[2]=="","registration-incomplete");
        string identity=fields[0];
        Need(fields[1]==Digest(Encoding.UTF8.GetBytes(intent+identity+"\n")),"registration-invalid");
        // A complete record is historical creation evidence only. Re-read
        // current physical identity/ACL/lock; never recreate or repair anything.
        using(var root=Open(parent.ChildPath,ReadControl|Read,3)) {
            Need((Info(root).Attributes&0x410)==0x10 && Name(root)==parent.ChildPath
                &&Identity(root)==identity,"registration-root-changed");
            SecurityCheck(root,true,service);
            using(var heldLock=Open(parent.ChildPath+"\\.onoes-io.lock",ReadControl|Read,0)) {
                FileCheck(heldLock,parent.ChildPath+"\\.onoes-io.lock",service);
                var info=Info(heldLock);Need(info.SizeHigh==0 &&info.SizeLow==0,"lock-shape");
                parent.Check();FileCheck(file,parent.RecordPath,service);SecurityCheck(root,true,service);
            }
        }
        return identity;
    }
    /** Read/reconcile only. Missing/incomplete state is not initialization or
     * permission to repeat creation. Requires no active native workspace user. */
    internal static string ReadRegisteredRoot(string path,string parentIdentity,string service,string requestId) {
        using(var parent=new ProvisioningParent(path,parentIdentity,service)) {
            string intent=RegistrationIntent(path,parentIdentity,service,requestId);
            using(var record=Open(parent.RecordPath,ReadControl|Read,0))return RegistrationRead(record,parent,intent,service);
        }
    }
    /** One new record and one new root, or exact completed-history read-back.
     * Intent is flushed BEFORE root creation. A cold/partial retry never appends
     * to an old record, even if every expected file exists. No cleanup/adoption.
     * Private parent pin/configuration custody remains an installer prerequisite. */
    internal static string ProvisionRegisteredRoot(string path,string parentIdentity,string service,string requestId) {
        using(var parent=new ProvisioningParent(path,parentIdentity,service)) {
            string intent=RegistrationIntent(path,parentIdentity,service,requestId);
            var acl=new FileSecurity();acl.SetSecurityDescriptorSddlForm("O:SYG:SYD:P(A;;FA;;;SY)(A;;GR;;;"+service+")");
            byte[] sd=acl.GetSecurityDescriptorBinaryForm();var pin=GCHandle.Alloc(sd,GCHandleType.Pinned);
            SafeFileHandle record;
            try {
                var attributes=new SecurityAttributes {Length=Marshal.SizeOf(typeof(SecurityAttributes)),Descriptor=pin.AddrOfPinnedObject(),Inherit=0};
                record=CreatePrivate(parent.RecordPath,ReadControl|Read|Write,0,ref attributes,1,NoFollow,IntPtr.Zero);
                int error=Marshal.GetLastWin32Error();
                if(record.IsInvalid) {
                    record.Dispose();Need(error==80 ||error==183,"registration-create");
                    using(var prior=Open(parent.RecordPath,ReadControl|Read,0))return RegistrationRead(prior,parent,intent,service);
                }
            } finally {pin.Free();}
            using(record) {
                // ROOT_REGISTRATION_TEST_SEAM: record-created
                FileCheck(record,parent.RecordPath,service);
                RegistrationAppend(record,Encoding.UTF8.GetBytes(intent));
                // ROOT_REGISTRATION_TEST_SEAM: intent-flushed
                string identity=ProvisionNewRoot(path,parentIdentity,service);
                // ROOT_REGISTRATION_TEST_SEAM: root-created
                string body=intent+identity+"\n";
                RegistrationAppend(record,Encoding.UTF8.GetBytes(identity+"\n"+Digest(Encoding.UTF8.GetBytes(body))+"\n"));
                // ROOT_REGISTRATION_TEST_SEAM: completion-flushed
                return RegistrationRead(record,parent,intent,service);
            }
        }
    }
}
