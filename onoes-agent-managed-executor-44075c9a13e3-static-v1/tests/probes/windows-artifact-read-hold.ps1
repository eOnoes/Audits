# Disposable byte-custody experiment, not an installer, launcher or production gate.
# No ACL, privilege, service, registry or security-policy changes. No runtime or
# worker artifact is launched; only this fixed PowerShell/C# file probe executes.
param([switch]$DisposableOnly)
$ErrorActionPreference = 'Stop'
if (-not $DisposableOnly -or $env:OS -ne 'Windows_NT') { throw 'artifact-hold-disposable-windows-required' }
$product = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$artifacts = Join-Path $product 'artifacts'
if (-not (Test-Path -LiteralPath $artifacts -PathType Container) -or
    ((Get-Item -LiteralPath $artifacts -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'artifact-hold-artifact-directory-required'
}
$probeRoot = Join-Path $artifacts ('artifact-read-hold-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $probeRoot
$reportPath = Join-Path $probeRoot 'report.json'
$nativePath = Join-Path $product 'src\build-only\native\windows-artifact-read-hold.cs'
$nativeSha256 = (Get-FileHash -LiteralPath $nativePath -Algorithm SHA256).Hash.ToLowerInvariant()
$probeSource = @'
using System;
using System.IO;
using System.IO.MemoryMappedFiles;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;

public static class ArtifactReadHoldProbe {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool CreateHardLinkW(string link, string existing, IntPtr security);
    static readonly byte[] Before = new byte[] { 0x61, 0x62, 0x63, 0x64 };
    static readonly byte[] After = new byte[] { 0x77, 0x78, 0x79, 0x7a };
    static string Hash(Stream stream) {
        stream.Position = 0;
        using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
    }
    static FileStream Hold(string path) { return new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read); }
    static bool Denied(Action operation) {
        try { operation(); return false; }
        catch (IOException) { return true; }
        catch (UnauthorizedAccessException) { return true; }
    }
    static bool InvalidHold(Action operation) {
        try { operation(); return false; }
        catch (InvalidOperationException e) { if(e.Message != "artifact-read-hold-invalid") throw; return true; }
        catch (IOException) { return true; }
        catch (UnauthorizedAccessException) { return true; }
    }
    public static int Implementation(string root) {
        int assertions = 0;
        Action<bool> check = delegate(bool value) { if (!value) throw new Exception("artifact-hold-implementation-case-" + assertions); assertions++; };
        string path = Path.Combine(root, "implementation.bin"); File.WriteAllBytes(path, Before);
        string digest; using (var input = Hold(path)) digest = "sha256:" + Hash(input);
        var artifact = WindowsArtifactReadHold.OpenAndVerify(path, digest, Before.Length);
        using (artifact) {
            artifact.CheckStillHeld(); check(artifact.HeldPhysicalName.StartsWith(@"\\?\Volume{"));
            check(File.ReadAllBytes(path).Length == Before.Length);
            check(Denied(delegate { File.WriteAllBytes(path, After); }));
            check(Denied(delegate { File.Delete(path); }));
            check(Denied(delegate { File.Move(path, path + ".moved"); }));
        }
        check(InvalidHold(delegate { artifact.CheckStillHeld(); }));
        check(!Denied(delegate { File.WriteAllBytes(path, Before); }));
        foreach (long length in new long[] { -1, 3, 5, WindowsArtifactReadHold.MaximumBytes + 1 }) {
            check(InvalidHold(delegate { using (WindowsArtifactReadHold.OpenAndVerify(path, digest, length)) {} }));
            check(!Denied(delegate { File.WriteAllBytes(path, Before); }));
        }
        foreach (string pin in new[] { "sha256:" + new string('0', 64), digest.ToUpperInvariant(), digest + "\n" }) {
            check(InvalidHold(delegate { using (WindowsArtifactReadHold.OpenAndVerify(path, pin, Before.Length)) {} }));
            check(!Denied(delegate { File.WriteAllBytes(path, Before); }));
        }
        check(InvalidHold(delegate { using (WindowsArtifactReadHold.OpenAndVerify(Path.Combine(root, "IMPLEMENTATION.bin"), digest, Before.Length)) {} }));
        check(InvalidHold(delegate { using (WindowsArtifactReadHold.OpenAndVerify(path + ":data", digest, Before.Length)) {} }));
        using (var writer = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite | FileShare.Delete))
            check(InvalidHold(delegate { using (WindowsArtifactReadHold.OpenAndVerify(path, digest, Before.Length)) {} }));
        MemoryMappedViewAccessor view;
        using (var writer = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite | FileShare.Delete))
        using (var mapping = MemoryMappedFile.CreateFromFile(writer, null, 0, MemoryMappedFileAccess.ReadWrite, HandleInheritability.None, true))
            view = mapping.CreateViewAccessor(0, Before.Length, MemoryMappedFileAccess.ReadWrite);
        using (view) {
            check(InvalidHold(delegate { using (WindowsArtifactReadHold.OpenAndVerify(path, digest, Before.Length)) {} }));
            view.Write(0, Before[0]); view.Flush(); check(view.ReadByte(0) == Before[0]);
        }
        using (var heldAgain = WindowsArtifactReadHold.OpenAndVerify(path, digest, Before.Length)) { heldAgain.CheckStillHeld(); assertions++; }
        string linked = Path.Combine(root, "linked.bin"); File.WriteAllBytes(linked, Before);
        check(CreateHardLinkW(linked + ".alias", linked, IntPtr.Zero));
        check(InvalidHold(delegate { using (WindowsArtifactReadHold.OpenAndVerify(linked, digest, Before.Length)) {} }));
        string ads = Path.Combine(root, "streams.bin"); File.WriteAllBytes(ads, Before);
        // .NET Framework's path parser rejects ADS syntax; create this fixed
        // disposable stream through Win32 so stream-enumeration denial is real.
        using (var adsHandle = CreateFileW(ads + ":fixture", 0x40000000, 3, IntPtr.Zero, 1, 0x80, IntPtr.Zero)) {
            check(!adsHandle.IsInvalid);
            using (var adsStream = new FileStream(adsHandle, FileAccess.Write)) adsStream.WriteByte(1);
        }
        check(InvalidHold(delegate { using (WindowsArtifactReadHold.OpenAndVerify(ads, digest, Before.Length)) {} }));
        string empty = Path.Combine(root, "empty.bin"); File.WriteAllBytes(empty, new byte[0]);
        string emptyDigest; using (var input = Hold(empty)) emptyDigest = "sha256:" + Hash(input);
        using (var emptyHold = WindowsArtifactReadHold.OpenAndVerify(empty, emptyDigest, 0)) { emptyHold.CheckStillHeld(); assertions++; }
        return assertions;
    }
    public static string Ordinary(string root) {
        string path = Path.Combine(root, "ordinary.bin"); File.WriteAllBytes(path, Before);
        bool write, append, delete, rename, compatibleRead, changed, writableAfterRelease;
        using (var hold = Hold(path)) {
            string before = Hash(hold);
            compatibleRead = File.ReadAllBytes(path).Length == Before.Length;
            write = Denied(delegate { File.WriteAllBytes(path, After); });
            append = Denied(delegate { using (var stream = new FileStream(path, FileMode.Append, FileAccess.Write)) stream.WriteByte(0x7a); });
            delete = Denied(delegate { File.Delete(path); });
            rename = Denied(delegate { File.Move(path, path + ".moved"); });
            changed = Hash(hold) != before;
        }
        writableAfterRelease = !Denied(delegate { File.WriteAllBytes(path, After); });
        return String.Join("|", new[] { compatibleRead, write, append, delete, rename, changed, writableAfterRelease });
    }
    public static string ExistingWriter(string root) {
        string path = Path.Combine(root, "writer.bin"); File.WriteAllBytes(path, Before);
        bool denied;
        using (var writer = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite | FileShare.Delete))
            denied = Denied(delegate { using (var hold = Hold(path)) {} });
        bool canHold = !Denied(delegate { using (var hold = Hold(path)) {} });
        return denied + "|" + canHold;
    }
    public static string ExistingWritableMapping(string root) {
        string path = Path.Combine(root, "mapping.bin"); File.WriteAllBytes(path, Before);
        // Keep a writable view after both the ordinary file handle and mapping
        // object are closed. An outstanding view, not an open write handle, is
        // the hypothesis: sharing checks may not revoke its mutation ability.
        MemoryMappedViewAccessor view;
        using (var writer = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite | FileShare.Delete))
        using (var mapping = MemoryMappedFile.CreateFromFile(writer, null, 0, MemoryMappedFileAccess.ReadWrite,
            HandleInheritability.None, true)) {
            view = mapping.CreateViewAccessor(0, Before.Length, MemoryMappedFileAccess.ReadWrite);
        }
        using (view) {
            FileStream hold = null;
            bool acquired = !Denied(delegate { hold = Hold(path); });
            bool wrote = false, changed = false;
            if (acquired) using (hold) {
                string before = Hash(hold);
                wrote = !Denied(delegate { view.Write(0, (byte)0x7a); view.Flush(); });
                changed = Hash(hold) != before;
            }
            // Positive control: the view really remains writable after ordinary
            // handles close, including when its existence prevented acquisition.
            view.Write(0, (byte)0x79); view.Flush();
            bool viewStillWritable = view.ReadByte(0) == 0x79;
            return acquired + "|" + wrote + "|" + changed + "|" + viewStillWritable;
        }
    }
    public static string ParentRename(string root, bool pinParent) {
        string parent = Path.Combine(root, pinParent ? "pinned-parent" : "unanchored-parent"); Directory.CreateDirectory(parent);
        string path = Path.Combine(parent, "worker.bin"); File.WriteAllBytes(path, Before);
        SafeFileHandle anchor = null;
        try {
            if (pinParent) {
                // READ_ATTRIBUTES, share READ|WRITE but not DELETE,
                // OPEN_EXISTING, BACKUP_SEMANTICS|OPEN_REPARSE_POINT.
                anchor = CreateFileW(parent, 0x80, 3, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
                if (anchor.IsInvalid) throw new IOException("directory-anchor-open-failed");
            }
            bool denied, changedPath = false;
            using (var hold = Hold(path)) {
                string digest = Hash(hold);
                denied = Denied(delegate { Directory.Move(parent, parent + "-moved"); });
                if (!denied) {
                    Directory.CreateDirectory(parent); File.WriteAllBytes(path, After);
                    using (var replacement = Hold(path)) changedPath = Hash(replacement) != digest;
                }
                if (Hash(hold) != digest) throw new IOException("held-file-changed-during-parent-test");
            }
            if (anchor != null) { anchor.Dispose(); anchor = null; }
            bool afterRelease = !Denied(delegate { Directory.Move(parent, parent + "-released"); });
            return denied + "|" + changedPath + "|" + afterRelease;
        } finally {
            if (anchor != null) anchor.Dispose();
        }
    }
}
'@
Add-Type -TypeDefinition ((Get-Content -LiteralPath $nativePath -Raw) + "`nnamespace Probe {`n" + $probeSource + "`n}")
function Parse-Flags([string]$Text, [int]$Count) {
    $parts = $Text.Split('|')
    if ($parts.Count -ne $Count -or @($parts | Where-Object { $_ -notin @('True', 'False') }).Count -ne 0) {
        throw 'artifact-hold-result-shape'
    }
    return @($parts | ForEach-Object { $_ -eq 'True' })
}
$ordinary = Parse-Flags ([Probe.ArtifactReadHoldProbe]::Ordinary($probeRoot)) 7
$writer = Parse-Flags ([Probe.ArtifactReadHoldProbe]::ExistingWriter($probeRoot)) 2
$mapping = Parse-Flags ([Probe.ArtifactReadHoldProbe]::ExistingWritableMapping($probeRoot)) 4
$unanchored = Parse-Flags ([Probe.ArtifactReadHoldProbe]::ParentRename($probeRoot, $false)) 3
$anchored = Parse-Flags ([Probe.ArtifactReadHoldProbe]::ParentRename($probeRoot, $true)) 3
$implementationCases = [Probe.ArtifactReadHoldProbe]::Implementation($probeRoot)
if (-not $ordinary[0] -or $ordinary[5] -or -not $ordinary[6] -or -not $writer[1] -or -not $mapping[3] -or
    -not $unanchored[2] -or -not $anchored[2]) {
    throw 'artifact-hold-positive-control-failed'
}
$report = [ordered]@{
    schemaVersion = 'onoes-artifact-read-hold-probe/v1'
    evidenceClass = 'LOCAL_DISPOSABLE_PRIMITIVE_EXECUTION_NOT_PRODUCTION_CUSTODY'
    osVersion = [Environment]::OSVersion.Version.ToString()
    powershellVersion = $PSVersionTable.PSVersion.ToString()
    harnessSha256 = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
    nativeSourceSha256 = $nativeSha256; implementationAssertions = $implementationCases
    compatibleRead = $ordinary[0]; writeDenied = $ordinary[1]; appendDenied = $ordinary[2]
    deleteDenied = $ordinary[3]; renameDenied = $ordinary[4]; ordinaryBytesChanged = $ordinary[5]
    writableAfterRelease = $ordinary[6]; existingWriterDeniesHold = $writer[0]; holdAfterWriterRelease = $writer[1]
    mappedViewSurvivesHandleClosure = $true; holdWithWritableView = $mapping[0]
    mappedWriteSucceeded = $mapping[1]; mappedBytesChangedDuringHold = $mapping[2]
    writableViewPositiveControl = $mapping[3]
    leafOnlyParentRenameDenied = $unanchored[0]; leafOnlyPathSubstituted = $unanchored[1]
    anchoredParentRenameDenied = $anchored[0]; anchoredPathSubstituted = $anchored[1]
    parentRenameAfterRelease = $anchored[2]
    testedByteMutationRoutesDenied = (-not $mapping[2] -and $ordinary[1] -and $ordinary[2] -and $ordinary[3] -and $ordinary[4] -and $writer[0])
    noProductionConclusion = $true; hostSecurityConfigurationChanged = $false; artifactExecutableLaunched = $false
}
$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $reportPath -Encoding UTF8
[ordered]@{ reportPath = $reportPath; evidence = $report } | ConvertTo-Json -Depth 5 -Compress
