// Dormant trusted-service primitive. NOT an IPC endpoint, approval gate, installer,
// arbitrary-folder editor, or sandbox. Compile/execute only in disposable guests
// until the independent consumer gate is met. All input bytes remain untrusted.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

internal sealed class ManagedIoException : Exception {
    internal readonly string Code;
    internal readonly int DiagnosticValue;
    internal ManagedIoException(string code, int diagnosticValue = 0) : base("managed-io-" + code) { Code = code; DiagnosticValue = diagnosticValue; }
}

internal sealed partial class WindowsManagedWorkspace : IDisposable {
    internal const int MaximumFileBytes = 16777216;
    private const uint ReadControl = 0x20000, Read = 0x80000000, Write = 0x40000000;
    private const uint Delete = 0x10000, OpenExisting = 3, NoFollow = 0x02200000;
    private const string SystemSid = "S-1-5-18", Administrators = "S-1-5-32-544";
    private const string TrustedInstaller = "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
    private readonly string serviceSid, rootPath, rootName, rootIdentity;
    private readonly List<SafeFileHandle> anchors = new List<SafeFileHandle>();
    private readonly List<string> anchorNames = new List<string>();
    private readonly object gate = new object();
    private SafeFileHandle workspaceLock;
    private bool disposed, poisoned;

    [StructLayout(LayoutKind.Sequential)] private struct FileInfo {
        internal uint Attributes, CreationLow, CreationHigh, AccessLow, AccessHigh, WriteLow, WriteHigh;
        internal uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes {
        internal int Length; internal IntPtr Descriptor; internal int Inherit;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="CreateFileW")]
    private static extern SafeFileHandle CreatePrivate(string path, uint access, uint share, ref SecurityAttributes security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInfo info);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int kind, IntPtr buffer, uint size);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool SetFileInformationByHandle(SafeFileHandle file, int kind, IntPtr buffer, uint size);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] private static extern uint GetFinalPathNameByHandleW(SafeFileHandle file, StringBuilder name, uint size, uint flags);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] private static extern bool GetVolumeInformationByHandleW(SafeFileHandle file, StringBuilder volume, uint volumeSize, out uint serial, out uint componentSize, out uint flags, StringBuilder filesystem, uint filesystemSize);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] private static extern uint GetDriveTypeW(string root);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool ReadFile(SafeFileHandle file, byte[] bytes, uint count, out uint read, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool WriteFile(SafeFileHandle file, byte[] bytes, uint count, out uint written, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool FlushFileBuffers(SafeFileHandle file);
    [DllImport("advapi32.dll")] private static extern uint GetSecurityInfo(SafeFileHandle file, int kind, uint info, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll")] private static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);

    private static void Need(bool value, string reason) { if (!value) throw new ManagedIoException(reason); }
    private static FileInfo Info(SafeFileHandle handle) {
        FileInfo result; Need(GetFileInformationByHandle(handle, out result), "identity-query"); return result;
    }
    private static string Name(SafeFileHandle handle) {
        var text = new StringBuilder(1024);
        uint size = GetFinalPathNameByHandleW(handle, text, 1024, 1); // normalized, volume GUID
        Need(size > 0 && size < 1024, "final-name");
        string result = text.ToString();
        Need(Regex.IsMatch(result, @"\A\\\\\?\\Volume\{[a-fA-F0-9-]{36}\}\\"), "local-volume");
        return result;
    }
    private static string Identity(SafeFileHandle handle) {
        FileInfo info = Info(handle);
        return Name(handle) + "|" + info.Volume.ToString("x8") + ":" + info.IndexHigh.ToString("x8") + info.IndexLow.ToString("x8");
    }
    private static SafeFileHandle Open(string path, uint access, uint share) {
        SafeFileHandle handle = CreateFileW(path, access, share, IntPtr.Zero, OpenExisting, NoFollow, IntPtr.Zero);
        if (handle.IsInvalid) { handle.Dispose(); throw new ManagedIoException("open-denied"); }
        return handle;
    }
    private static string[] Parts(string path) {
        Need(path != null && path.Length > 0 && path.Length <= 240, "path");
        Need(Regex.IsMatch(path, @"\A[A-Za-z0-9._@+(), /-]+\z"), "path");
        string[] parts = path.Split('/'); Need(parts.Length <= 16, "path");
        foreach (string part in parts) Need(part.Length > 0 && part.Length <= 64 && part != "." && part != ".."
            && !part.StartsWith(" ") && !part.EndsWith(" ") && !part.EndsWith(".")
            && !part.StartsWith(".onoes-stage-", StringComparison.OrdinalIgnoreCase)
            && !part.Equals(".onoes-io.lock", StringComparison.OrdinalIgnoreCase)
            && !part.StartsWith(".onoes-import-", StringComparison.OrdinalIgnoreCase)
            && !part.Equals(".git", StringComparison.OrdinalIgnoreCase)
            && !part.Equals(".ssh", StringComparison.OrdinalIgnoreCase)
            && !part.Equals("secrets", StringComparison.OrdinalIgnoreCase)
            && !part.Equals("credentials", StringComparison.OrdinalIgnoreCase)
            && !part.Equals("node_modules", StringComparison.OrdinalIgnoreCase)
            && !(part.Equals(".env", StringComparison.OrdinalIgnoreCase)
                || (part.StartsWith(".env.", StringComparison.OrdinalIgnoreCase) && !part.Equals(".env.example", StringComparison.OrdinalIgnoreCase)))
            && !Regex.IsMatch(part, @"\.(pem|key|pfx|p12|kdbx)\z", RegexOptions.IgnoreCase)
            && !Regex.IsMatch(part, @"\A(id_rsa|id_ed25519)\z", RegexOptions.IgnoreCase)
            && !Regex.IsMatch(part, @"\A(con|prn|aux|nul|com[0-9]|lpt[0-9])([ .]|\z)", RegexOptions.IgnoreCase), "path");
        return parts;
    }
    private static void RootSyntax(string path) {
        Need(Environment.OSVersion.Platform == PlatformID.Win32NT && IntPtr.Size == 8, "platform");
        Need(path != null && path.Length >= 4 && path.Length <= 200 && Regex.IsMatch(path, @"\A[A-Z]:\\"), "root-path");
        Parts(path.Substring(3).Replace('\\','/'));
        Need(GetDriveTypeW(path.Substring(0,3)) == 3, "fixed-volume-required");
    }

    // Descriptive install-time identity ONLY. The trusted installer must create
    // a NEW private root and new byte copies, then persist this exact identity in
    // protected state. Never enroll an existing caller folder at request time.
    internal static string CaptureNewRootIdentity(string path) {
        RootSyntax(path);
        using (SafeFileHandle handle = Open(path, ReadControl | 0x80, 3)) return Identity(handle);
    }

    internal WindowsManagedWorkspace(string path, string expectedIdentity, string expectedServiceSid) {
        RootSyntax(path);
        Need(expectedIdentity != null && expectedIdentity.Length <= 512, "root-pin");
        Need(expectedServiceSid != null && Regex.IsMatch(expectedServiceSid, @"\AS-1-5-80-([0-9]+-){4}[0-9]+\z"), "service-identity");
        using (WindowsIdentity current = WindowsIdentity.GetCurrent()) {
            Need(current.User.Value == expectedServiceSid && !new WindowsPrincipal(current).IsInRole(WindowsBuiltInRole.Administrator), "service-identity");
        }
        serviceSid = expectedServiceSid; rootPath = path; rootIdentity = expectedIdentity;
        try {
            string prefix = path.Substring(0,3);
            var paths = new List<string>(); paths.Add(prefix);
            foreach (string part in path.Substring(3).Split('\\')) { prefix = prefix.TrimEnd('\\') + "\\" + part; paths.Add(prefix); }
            foreach (string entry in paths) {
                SafeFileHandle handle = Open(entry, ReadControl | Read, 3); anchors.Add(handle);
                string final = Name(handle); anchorNames.Add(final);
                DirectoryCheck(handle, entry == path);
                // Reject SUBST/mount aliases and case substitutions, rather than
                // comparing only a lowercased path prefix.
                string suffix = entry.Substring(3);
                int boundary = final.IndexOf("}\\", StringComparison.Ordinal) + 2;
                Need(boundary > 1 && final.Substring(boundary) == suffix, "root-alias");
            }
            rootName = Name(anchors[anchors.Count-1]);
            Need(Identity(anchors[anchors.Count-1]) == rootIdentity, "root-pin");
            // Subsequent opens use the validated volume GUID, never a mutable
            // DOS drive-letter mapping. Ancestor handles stay retained.
            rootPath = rootName;
            var fs = new StringBuilder(32); uint serial, maxComponent, flags;
            Need(GetVolumeInformationByHandleW(anchors[0], null, 0, out serial, out maxComponent, out flags, fs, 32)
                && fs.ToString() == "NTFS", "ntfs-required");
            // Installer-created empty private lock, not imported task data. The
            // non-inherited exclusive handle serializes cooperating native
            // instances across processes. Never create/adopt it during a task.
            workspaceLock = Open(rootName+"\\.onoes-io.lock",ReadControl|Read,0);
            FileCheck(workspaceLock,rootName+"\\.onoes-io.lock");
            FileInfo lockInfo=Info(workspaceLock); Need(lockInfo.SizeHigh==0 && lockInfo.SizeLow==0,"lock-shape");
        } catch { CloseAnchors(); throw; }
    }

    private static bool Trusted(string sid, bool privateObject, string expectedServiceSid) {
        return sid == SystemSid || sid == expectedServiceSid || (!privateObject && (sid == Administrators || sid == TrustedInstaller));
    }
    private void SecurityCheck(SafeFileHandle handle, bool privateObject) {
        SecurityCheck(handle, privateObject, serviceSid);
    }
    private static void SecurityCheck(SafeFileHandle handle, bool privateObject, string expectedServiceSid) {
        IntPtr owner, group, dacl, sacl, descriptor;
        Need(GetSecurityInfo(handle, 1, 5, out owner, out group, out dacl, out sacl, out descriptor) == 0, "security-query");
        try {
            uint size = GetSecurityDescriptorLength(descriptor); Need(size > 0 && size <= 65536, "security-size");
            byte[] bytes = new byte[size]; Marshal.Copy(descriptor, bytes, 0, (int)size);
            var security = new RawSecurityDescriptor(bytes, 0);
            Need(security.Owner != null && Trusted(security.Owner.Value, privateObject, expectedServiceSid), "owner");
            Need((security.ControlFlags & ControlFlags.DiscretionaryAclPresent) != 0 && security.DiscretionaryAcl != null, "null-acl");
            bool serviceAccess = false, systemAccess = false;
            foreach (GenericAce generic in security.DiscretionaryAcl) {
                var ace = generic as CommonAce;
                Need(ace != null && !ace.IsCallback, "acl-kind");
                if ((ace.AceFlags & AceFlags.InheritOnly) != 0) continue;
                Need(ace.AceQualifier == AceQualifier.AccessAllowed || ace.AceQualifier == AceQualifier.AccessDenied, "acl-kind");
                if (ace.AceQualifier != AceQualifier.AccessAllowed) continue;
                string sid = ace.SecurityIdentifier.Value; uint mask = unchecked((uint)ace.AccessMask);
                if (sid == expectedServiceSid) serviceAccess = true; if (sid == SystemSid) systemAccess = true;
                // FILE_ADD_FILE shares FILE_WRITE_DATA's bit. Reparse controls
                // can authorize through that bit, so do not infer safety from
                // its directory-friendly name or rely on a nonempty-directory
                // rejection. Inherit-only rights do not apply to this handle.
                // 0x0004 is FILE_APPEND_DATA for files and
                // FILE_ADD_SUBDIRECTORY for directories. Either is an
                // unauthorized mutation capability on an ancestor boundary.
                uint dangerous = 0x10000000 | 0x40000000 | 0x000D0152 | 0x00000004;
                if (!Trusted(sid, privateObject, expectedServiceSid) && (privateObject || (mask & dangerous) != 0)) throw new ManagedIoException("acl-access",ace.AccessMask);
            }
            if (privateObject) Need(serviceAccess && systemAccess, "private-acl");
        } finally { if (descriptor != IntPtr.Zero) LocalFree(descriptor); }
    }
    private void DirectoryCheck(SafeFileHandle handle, bool privateObject) {
        FileInfo info = Info(handle);
        Need((info.Attributes & 0x410) == 0x10, "directory-kind");
        SecurityCheck(handle, privateObject);
    }
    private void Ready() {
        Need(!disposed && !poisoned, "unavailable");
        if (!importing) RequireNoPendingImport();
        for (int i = 0; i < anchors.Count; i++) {
            DirectoryCheck(anchors[i], i == anchors.Count-1);
            Need(Name(anchors[i]) == anchorNames[i], "ancestor-changed");
        }
        Need(Identity(anchors[anchors.Count-1]) == rootIdentity, "root-pin");
        FileCheck(workspaceLock,rootName+"\\.onoes-io.lock");
    }
    internal void AssertCustody() { lock (gate) { Ready(); } }
    private List<SafeFileHandle> Parents(string[] parts) {
        var handles = new List<SafeFileHandle>(); string path = rootPath, name = rootName;
        try {
            for (int i = 0; i < parts.Length-1; i++) {
                path += "\\" + parts[i]; name += "\\" + parts[i];
                SafeFileHandle handle = Open(path, ReadControl | Read, 3); handles.Add(handle);
                DirectoryCheck(handle, true); Need(Name(handle) == name, "path-alias");
            }
            return handles;
        } catch { foreach (SafeFileHandle handle in handles) handle.Dispose(); throw; }
    }
    private void FileCheck(SafeFileHandle handle, string expectedName) {
        FileCheck(handle,expectedName,serviceSid);
    }
    private static void FileCheck(SafeFileHandle handle, string expectedName, string expectedServiceSid) {
        FileInfo info = Info(handle);
        Need((info.Attributes & ~(0x20u | 0x80u)) == 0 && info.Links == 1, "file-kind");
        Need(Name(handle) == expectedName, "path-alias"); SecurityCheck(handle, true, expectedServiceSid);
        // Only the unnamed data stream is supported. Do not silently retain ADS.
        IntPtr stream = Marshal.AllocHGlobal(4096);
        try {
            Need(GetFileInformationByHandleEx(handle, 7, stream, 4096), "streams-query");
            int next = Marshal.ReadInt32(stream), length = Marshal.ReadInt32(stream,4);
            Need(next == 0 && length == 14 && Marshal.PtrToStringUni(IntPtr.Add(stream,24),7) == "::$DATA", "streams");
        } finally { Marshal.FreeHGlobal(stream); }
    }
    private static byte[] ReadBytes(SafeFileHandle handle, int maximum) {
        FileInfo before = Info(handle); Need(before.SizeHigh == 0 && before.SizeLow <= maximum, "file-budget");
        byte[] result = new byte[before.SizeLow], chunk = new byte[65536]; int offset = 0;
        while (offset < result.Length) {
            uint got; Need(ReadFile(handle, chunk, (uint)Math.Min(chunk.Length,result.Length-offset), out got, IntPtr.Zero) && got > 0, "read");
            Buffer.BlockCopy(chunk,0,result,offset,(int)got); offset += (int)got;
        }
        uint extra; Need(ReadFile(handle,chunk,1,out extra,IntPtr.Zero) && extra == 0, "read-race");
        FileInfo after = Info(handle); Need(after.SizeHigh == 0 && after.SizeLow == before.SizeLow && after.Links == 1, "read-race");
        return result;
    }
    internal byte[] ReadFileBytes(string relativePath, int maximumBytes) {
        lock (gate) {
            Need(maximumBytes >= 0 && maximumBytes <= MaximumFileBytes, "file-budget");
            string[] parts = Parts(relativePath); Ready(); List<SafeFileHandle> parents = Parents(parts);
            try {
                string name = rootName + "\\" + String.Join("\\",parts);
                using (SafeFileHandle file = Open(rootPath + "\\" + String.Join("\\",parts), ReadControl | Read, 1)) {
                    FileCheck(file,name); byte[] result = ReadBytes(file,maximumBytes); FileCheck(file,name); Ready(); return result;
                }
            } finally { foreach (SafeFileHandle handle in parents) handle.Dispose(); }
        }
    }
    internal static string Digest(byte[] bytes) {
        using (SHA256 sha = SHA256.Create()) return "sha256:" + BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();
    }
    private SafeFileHandle Stage(string path) {
        var acl = new FileSecurity();
        acl.SetSecurityDescriptorSddlForm("O:"+serviceSid+"G:"+serviceSid+"D:P(A;;FA;;;SY)(A;;FA;;;"+serviceSid+")");
        byte[] bytes = acl.GetSecurityDescriptorBinaryForm(); var pin = GCHandle.Alloc(bytes,GCHandleType.Pinned);
        try {
            var attributes = new SecurityAttributes { Length = Marshal.SizeOf(typeof(SecurityAttributes)), Descriptor = pin.AddrOfPinnedObject(), Inherit = 0 };
            SafeFileHandle handle = CreatePrivate(path,ReadControl|Read|Write|Delete,0,ref attributes,1,0x80200080,IntPtr.Zero);
            if (handle.IsInvalid) { handle.Dispose(); throw new ManagedIoException("stage-create"); } return handle;
        } finally { pin.Free(); }
    }
    internal void ReplaceFileBytes(string relativePath, string expectedDigest, byte[] replacement) {
        Need(replacement != null && replacement.Length <= MaximumFileBytes, "file-budget");
        byte[] copy = (byte[])replacement.Clone();
        try { lock (gate) {
            Need(expectedDigest != null && Regex.IsMatch(expectedDigest,@"\Asha256:[a-f0-9]{64}\z"), "digest");
            string[] parts = Parts(relativePath); Ready(); List<SafeFileHandle> parents = Parents(parts);
            SafeFileHandle stage = null; bool renamed = false;
            try {
                string target = rootPath + "\\" + String.Join("\\",parts), final = rootName + "\\" + String.Join("\\",parts);
                // Validate through an old-file handle that denies writers. It
                // must close before Windows replacement. The exclusive workspace
                // lock and physical custody remain held across that interval;
                // a share mask is NOT the adversarial protection mechanism.
                using (SafeFileHandle old = Open(target,ReadControl|Read,5)) {
                    FileCheck(old,final); byte[] before = ReadBytes(old,MaximumFileBytes);
                    try { Need(Digest(before) == expectedDigest,"preimage"); } finally { Array.Clear(before,0,before.Length); }
                    string stageName = ".onoes-stage-" + Guid.NewGuid().ToString("N");
                    string folder = Path.GetDirectoryName(target), finalFolder = final.Substring(0,final.LastIndexOf('\\'));
                    stage = Stage(folder + "\\" + stageName); FileCheck(stage,finalFolder+"\\"+stageName);
                    uint written; Need(WriteFile(stage,copy,(uint)copy.Length,out written,IntPtr.Zero) && written == copy.Length, "write");
                    Need(FlushFileBuffers(stage),"flush"); FileCheck(stage,finalFolder+"\\"+stageName);
                    Ready(); foreach (SafeFileHandle parent in parents) DirectoryCheck(parent,true); FileCheck(old,final);
                    old.Dispose();
                    // Rename the still-open NEW file handle to the exact volume-
                    // GUID target. All parent handles remain pinned, with their
                    // private ACLs checked. No path-based reopening of staging,
                    // no old-inode write, no shared-file ACL-preservation mode.
                    // The initial relative-name call returned error 87. Use the
                    // common absolute-name form, NOT undocumented Nt* APIs.
                    byte[] name = Encoding.Unicode.GetBytes(final);
                    int renameSize = 24+name.Length;
                    IntPtr rename = Marshal.AllocHGlobal(renameSize);
                    try {
                        for (int i=0;i<renameSize;i++) Marshal.WriteByte(rename,i,0);
                        Marshal.WriteByte(rename,1);
                        Marshal.WriteInt32(rename,16,name.Length);
                        Marshal.Copy(name,0,IntPtr.Add(rename,20),name.Length);
                        if (!SetFileInformationByHandle(stage,3,rename,(uint)renameSize)) throw new ManagedIoException("replace",Marshal.GetLastWin32Error());
                        renamed = true;
                    } finally { Marshal.FreeHGlobal(rename); }
                    FileCheck(stage,final); Need(FlushFileBuffers(stage),"flush"); Ready();
                }
            } catch {
                if (renamed) { poisoned = true; throw new ManagedIoException("reconciliation-required"); } throw;
            } finally {
                if (stage != null) {
                    if (!renamed) {
                        IntPtr disposition = Marshal.AllocHGlobal(1);
                        try { Marshal.WriteByte(disposition,1); if (!SetFileInformationByHandle(stage,4,disposition,1)) poisoned = true; }
                        finally { Marshal.FreeHGlobal(disposition); }
                    }
                    stage.Dispose();
                }
                foreach (SafeFileHandle handle in parents) handle.Dispose();
            }
        } } finally { Array.Clear(copy,0,copy.Length); }
    }
    private void CloseAnchors() {
        if(workspaceLock!=null) { workspaceLock.Dispose(); workspaceLock=null; }
        for (int i = anchors.Count-1; i >= 0; i--) anchors[i].Dispose(); anchors.Clear();
    }
    public void Dispose() { lock (gate) { if (!disposed) { disposed = true; CloseAnchors(); } } }
}
