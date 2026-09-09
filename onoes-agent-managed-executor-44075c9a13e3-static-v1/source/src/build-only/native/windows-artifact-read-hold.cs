// Dormant byte-custody primitive. Not enrollment, root ACL validation, dependency
// closure, signature verification, a launcher, or a sandbox. The trusted host
// must supply protected install-time pins and retain this object until every
// related process has stopped. Never acquire it from task-supplied paths/pins.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

internal sealed class WindowsArtifactReadHold : IDisposable {
    internal const long MaximumBytes = 268435456;
    readonly FileStream stream;
    readonly FileInformation identity;
    readonly string physicalName;
    readonly object gate = new object();
    bool disposed;

    [StructLayout(LayoutKind.Sequential)] struct FileInformation {
        internal uint Attributes, CreationLow, CreationHigh, AccessLow, AccessHigh, WriteLow, WriteHigh;
        internal uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation info);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int kind, IntPtr buffer, uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetHandleInformation(SafeFileHandle handle, out uint flags);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder name, uint size, uint flags);
    static void Require(bool valid) { if (!valid) throw new InvalidOperationException("artifact-read-hold-invalid"); }
    static FileInformation Inspect(SafeFileHandle handle, long length) {
        FileInformation info; uint flags;
        Require(GetFileInformationByHandle(handle, out info));
        // Only an ordinary, possibly read-only, single-link data file. Fail on
        // reparse/directory/device/compressed/encrypted/sparse or unknown flags.
        Require((info.Attributes & ~(0x1u | 0x20u | 0x80u)) == 0 && info.Links == 1
            && info.SizeHigh == 0 && info.SizeLow == length);
        Require(GetHandleInformation(handle, out flags) && (flags & 1) == 0);
        IntPtr buffer = Marshal.AllocHGlobal(4096);
        try {
            Require(GetFileInformationByHandleEx(handle, 7, buffer, 4096));
            Require(Marshal.ReadInt32(buffer) == 0 && Marshal.ReadInt32(buffer, 4) == 14
                && Marshal.PtrToStringUni(IntPtr.Add(buffer, 24), 7) == "::$DATA");
        } finally { Marshal.FreeHGlobal(buffer); }
        return info;
    }
    static string PhysicalName(SafeFileHandle handle) {
        var name = new StringBuilder(1024);
        uint length = GetFinalPathNameByHandleW(handle, name, 1024, 1);
        Require(length > 0 && length < 1024);
        string text = name.ToString();
        Require(Regex.IsMatch(text, @"\A\\\\\?\\Volume\{[a-fA-F0-9-]{36}\}\\"));
        return text;
    }
    WindowsArtifactReadHold(FileStream opened, FileInformation expected, string name) {
        stream = opened; identity = expected; physicalName = name;
    }
    internal static WindowsArtifactReadHold OpenAndVerify(string path, string expectedDigest, long expectedBytes) {
        Require(Environment.OSVersion.Platform == PlatformID.Win32NT && IntPtr.Size == 8);
        Require(path != null && path.Length <= 512 && Regex.IsMatch(path, @"\A[A-Z]:\\[A-Za-z0-9._@+(), \\-]+\z")
            && Path.GetFullPath(path) == path && !path.EndsWith("\\"));
        foreach (string part in path.Substring(3).Split('\\')) Require(part.Length > 0 && part != "." && part != ".."
            && !part.EndsWith(".") && !part.EndsWith(" ") && !part.StartsWith(" "));
        Require(expectedBytes >= 0 && expectedBytes <= MaximumBytes && expectedDigest != null
            && Regex.IsMatch(expectedDigest, @"\Asha256:[a-f0-9]{64}\z"));
        FileStream opened = null;
        try {
            // FILE_SHARE_READ only: compatible readers may load these bytes;
            // a conflicting writer/deleter prevents acquisition. Keep this
            // stream OPEN after hashing and across every later launch/use.
            // OPEN_REPARSE_POINT prevents following a final symlink. Directory
            // identity/protection is still a separate host obligation.
            SafeFileHandle handle = CreateFileW(path, 0x80000000, 1, IntPtr.Zero, 3, 0x08200000, IntPtr.Zero);
            try {
                Require(!handle.IsInvalid);
                opened = new FileStream(handle, FileAccess.Read, 65536, false);
            } catch { handle.Dispose(); throw; }
            FileInformation before = Inspect(opened.SafeFileHandle, expectedBytes);
            string name = PhysicalName(opened.SafeFileHandle);
            int boundary = name.IndexOf("}\\", StringComparison.Ordinal) + 2;
            Require(boundary > 1 && name.Substring(boundary) == path.Substring(3));
            string actual;
            using (var hash = SHA256.Create()) actual = "sha256:" + BitConverter.ToString(hash.ComputeHash(opened)).Replace("-", "").ToLowerInvariant();
            Require(actual == expectedDigest && opened.ReadByte() == -1);
            var result = new WindowsArtifactReadHold(opened, before, name);
            result.CheckStillHeld();
            opened = null; return result;
        } finally { if (opened != null) opened.Dispose(); }
    }
    // The returned path is a measured volume-GUID name, not a selected command.
    // It is usable only while this hold AND the host's protected root custody
    // remain alive. Protect all loaded dependencies separately as well.
    internal string HeldPhysicalName { get { lock (gate) { CheckStillHeld(); return physicalName; } } }
    internal void CheckStillHeld() {
        lock (gate) {
            Require(!disposed);
            FileInformation current = Inspect(stream.SafeFileHandle, identity.SizeLow);
            Require(current.Volume == identity.Volume && current.IndexHigh == identity.IndexHigh && current.IndexLow == identity.IndexLow
                && current.WriteLow == identity.WriteLow && current.WriteHigh == identity.WriteHigh
                && PhysicalName(stream.SafeFileHandle) == physicalName);
        }
    }
    public void Dispose() { lock (gate) { if (disposed) return; disposed = true; stream.Dispose(); } }
}
