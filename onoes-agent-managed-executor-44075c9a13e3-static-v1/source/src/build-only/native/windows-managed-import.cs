// Dormant byte import into an ALREADY newly created, protected and pinned root.
// No source path, root enrollment, authorization, overwrite, resume or cleanup.
// A crashed/partial import stays blocked by a private pending marker. Only a
// complete read-back permits its rename to a seal; that seal is NOT authority.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Text;
using Microsoft.Win32.SafeHandles;

internal sealed partial class WindowsManagedWorkspace {
    internal const int ImportBodyMaximum = 32 + 4 + 4194304 + 64 * (2 + 240 + 4 + 32);
    private bool importing;
    private const string PendingImport = ".onoes-import-pending", ImportSeal = ".onoes-import-seal";
    private sealed class ImportEntry { internal string Path, Digest; internal byte[] Bytes; }
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    private static extern bool CreateDirectoryW(string path,ref SecurityAttributes security);

    private void RequireNoPendingImport() {
        var file=CreateFileW(rootPath+"\\"+PendingImport,ReadControl|0x80,7,IntPtr.Zero,OpenExisting,NoFollow,IntPtr.Zero);
        int error=Marshal.GetLastWin32Error();
        using(file) {
            if(!file.IsInvalid) throw new ManagedIoException("import-incomplete");
            if(error!=2)throw new ManagedIoException("import-state",error); // Only FILE_NOT_FOUND means absent.
        }
    }
    private SafeFileHandle CreateImportDirectory(string path) {
        var acl=new DirectorySecurity();
        acl.SetSecurityDescriptorSddlForm("O:"+serviceSid+"G:"+serviceSid+"D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;"+serviceSid+")");
        byte[] bytes=acl.GetSecurityDescriptorBinaryForm(); var pin=GCHandle.Alloc(bytes,GCHandleType.Pinned);
        try {
            var attributes=new SecurityAttributes { Length=Marshal.SizeOf(typeof(SecurityAttributes)),Descriptor=pin.AddrOfPinnedObject(),Inherit=0 };
            Need(CreateDirectoryW(path,ref attributes),"import-directory-create"); // Never adopt an existing directory.
        } finally { pin.Free(); }
        var handle=Open(path,ReadControl|Read,3);
        try { DirectoryCheck(handle,true); Need(Name(handle)==path,"path-alias"); return handle; }
        catch { handle.Dispose(); throw; }
    }
    private void RequireEmptyImportRoot() {
        // Enumerate the retained directory HANDLE. .NET Framework's path-based
        // enumeration rejected the validated volume-GUID name with error 87.
        // Fixed x64 FILE_ID_BOTH_DIR_INFO layout, bounded buffer/entries/queries.
        IntPtr buffer=Marshal.AllocHGlobal(4096); var names=new HashSet<string>(StringComparer.Ordinal);
        try {
            for(int call=0;call<2;call++) {
                for(int i=0;i<4096;i++)Marshal.WriteByte(buffer,i,0);
                if(!GetFileInformationByHandleEx(anchors[anchors.Count-1],call==0?11:10,buffer,4096)) {
                    int error=Marshal.GetLastWin32Error();
                    if(error!=18)throw new ManagedIoException("import-enumeration",error);
                    Need(names.Contains(".onoes-io.lock"),"import-root-not-empty"); return;
                }
                int at=0;
                for(;;) {
                    Need(at>=0 && at<=4096-104,"import-enumeration");
                    int next=Marshal.ReadInt32(buffer,at), length=Marshal.ReadInt32(buffer,at+60);
                    Need(length>0 && length<=510 && length%2==0 && at+104+length<=4096,"import-enumeration");
                    string name=Marshal.PtrToStringUni(IntPtr.Add(buffer,at+104),length/2);
                    Need((name=="." || name==".." || name==".onoes-io.lock") && names.Count<3 && names.Add(name),"import-root-not-empty");
                    if(next==0)break;
                    Need(next>=104+length && next%8==0 && next<=4096-at,"import-enumeration"); at+=next;
                }
            }
            throw new ManagedIoException("import-enumeration");
        } finally { Marshal.FreeHGlobal(buffer); }
    }
    private static List<ImportEntry> ParseImport(byte[] body) {
        Need(body!=null && body.Length>=36 && body.Length<=ImportBodyMaximum,"import-frame");
        uint count=BitConverter.ToUInt32(body,32); Need(count>0 && count<=64,"import-frame");
        var entries=new List<ImportEntry>(); var spelling=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
        var files=new HashSet<string>(StringComparer.OrdinalIgnoreCase); var dirs=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        int at=36,total=0; string previous=null;
        try {
            for(int index=0;index<count;index++) {
                Need(at<=body.Length-2,"import-frame"); int length=BitConverter.ToUInt16(body,at); at+=2;
                Need(length>0 && length<=240 && at<=body.Length-length-36,"import-frame");
                for(int i=0;i<length;i++) Need(body[at+i]>=32 && body[at+i]<=126,"import-frame");
                string path=Encoding.ASCII.GetString(body,at,length); at+=length; string[] parts=Parts(path);
                Need(previous==null || String.CompareOrdinal(previous,path)<0,"import-order"); previous=path;
                string prefix="";
                for(int i=0;i<parts.Length;i++) {
                    prefix+=(i==0?"":"/")+parts[i]; string prior;
                    Need(!spelling.TryGetValue(prefix,out prior) || prior==prefix,"import-alias"); spelling[prefix]=prefix;
                    if(i==parts.Length-1) Need(!dirs.Contains(prefix) && files.Add(prefix),"import-collision");
                    else { Need(!files.Contains(prefix),"import-collision"); dirs.Add(prefix); }
                }
                uint size=BitConverter.ToUInt32(body,at); at+=4;
                Need(size<=1048576 && total<=4194304-size && at<=body.Length-32-size,"import-budget");
                string digest="sha256:"+BitConverter.ToString(body,at,32).Replace("-","").ToLowerInvariant(); at+=32;
                byte[] content=new byte[size]; Buffer.BlockCopy(body,at,content,0,(int)size); at+=(int)size; total+=(int)size;
                var entry=new ImportEntry { Path=path,Digest=digest,Bytes=content }; entries.Add(entry);
                Need(Digest(content)==digest,"import-digest");
            }
            Need(at==body.Length,"import-frame");
            // Independent exact serialization of the existing import manifest.
            // The conservative path alphabet contains no quote/backslash/control.
            var json=new StringBuilder("{\"files\":[");
            for(int i=0;i<entries.Count;i++) {
                var entry=entries[i]; if(i>0)json.Append(',');
                json.Append("{\"byteLength\":").Append(entry.Bytes.Length.ToString(System.Globalization.CultureInfo.InvariantCulture))
                    .Append(",\"relativePath\":\"").Append(entry.Path).Append("\",\"sha256\":\"").Append(entry.Digest).Append("\"}");
            }
            json.Append("],\"schemaVersion\":\"onoes-managed-workspace-import/v1\"}");
            Need(Digest(Encoding.UTF8.GetBytes(json.ToString()))=="sha256:"+BitConverter.ToString(body,0,32).Replace("-","").ToLowerInvariant(),"import-manifest");
            return entries;
        } catch { foreach(var entry in entries) Array.Clear(entry.Bytes,0,entry.Bytes.Length); throw; }
    }
    internal void ImportNewFiles(byte[] input) {
        Need(input!=null && input.Length<=ImportBodyMaximum,"import-frame"); byte[] body=(byte[])input.Clone();
        List<ImportEntry> entries=null;
        try {
            entries=ParseImport(body); // Validate ALL names, sizes and hashes before creating anything.
            lock(gate) {
                Ready();
                RequireEmptyImportRoot();
                var handles=new List<SafeFileHandle>(); var made=new HashSet<string>(StringComparer.Ordinal);
                SafeFileHandle marker=null; bool started=false; int step=1;
                try {
                    marker=Stage(rootPath+"\\"+PendingImport); started=true; importing=true;
                    step=2;
                    FileCheck(marker,rootName+"\\"+PendingImport);
                    uint written; byte[] manifest=new byte[32]; Buffer.BlockCopy(body,0,manifest,0,32);
                    Need(WriteFile(marker,manifest,32,out written,IntPtr.Zero) && written==32 && FlushFileBuffers(marker),"import-marker");
                    foreach(var entry in entries) {
                        step=3;
                        string[] parts=Parts(entry.Path); string parent=rootName;
                        for(int i=0;i<parts.Length-1;i++) {
                            parent+="\\"+parts[i]; if(made.Add(parent)) handles.Add(CreateImportDirectory(parent));
                        }
                        Ready(); string path=rootName+"\\"+entry.Path.Replace('/','\\');
                        step=4;
                        // CREATE_NEW + explicit private DACL. No pre-existing inode is ever written.
                        using(var file=Stage(path)) {
                            FileCheck(file,path);
                            Need(WriteFile(file,entry.Bytes,(uint)entry.Bytes.Length,out written,IntPtr.Zero) && written==entry.Bytes.Length,"import-write");
                            Need(FlushFileBuffers(file),"import-flush"); FileCheck(file,path);
                        }
                    }
                    foreach(var entry in entries) {
                        step=5;
                        byte[] read=ReadFileBytes(entry.Path,entry.Bytes.Length);
                        try { Need(read.Length==entry.Bytes.Length && Digest(read)==entry.Digest,"import-readback"); }
                        finally { Array.Clear(read,0,read.Length); }
                    }
                    Ready(); foreach(var handle in handles) DirectoryCheck(handle,true);
                    step=6;
                    byte[] name=Encoding.Unicode.GetBytes(rootName+"\\"+ImportSeal); int size=24+name.Length;
                    IntPtr rename=Marshal.AllocHGlobal(size);
                    try {
                        for(int i=0;i<size;i++)Marshal.WriteByte(rename,i,0);
                        // ReplaceIfExists = false. Never overwrite a prior seal.
                        Marshal.WriteInt32(rename,16,name.Length); Marshal.Copy(name,0,IntPtr.Add(rename,20),name.Length);
                        Need(SetFileInformationByHandle(marker,3,rename,(uint)size),"import-seal");
                    } finally { Marshal.FreeHGlobal(rename); }
                    FileCheck(marker,rootName+"\\"+ImportSeal); Need(FlushFileBuffers(marker),"import-seal-flush");
                    step=7;
                    importing=false; Ready();
                } catch {
                    if(started) { poisoned=true; throw new ManagedIoException("import-incomplete",step); } throw;
                } finally {
                    importing=false; if(marker!=null)marker.Dispose();
                    for(int i=handles.Count-1;i>=0;i--) handles[i].Dispose();
                    // Partial roots intentionally retained. No recursive deletion or automatic resume.
                }
            }
        } finally {
            Array.Clear(body,0,body.Length);
            if(entries!=null)foreach(var entry in entries)Array.Clear(entry.Bytes,0,entry.Bytes.Length);
        }
    }
}
