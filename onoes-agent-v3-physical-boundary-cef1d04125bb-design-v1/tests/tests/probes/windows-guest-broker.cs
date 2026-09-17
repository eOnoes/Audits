// Disposable Windows Sandbox prototype ONLY. Not a production broker or grant.
// One fixed fixture path; no shell, dynamic module, caller path, or credentials.
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

public sealed class OnoesGuestBroker : ServiceBase
{
    public const string Name = "OnoesGuestBrokerProbe";
    public const string Root = @"C:\OnoesGuestBrokerProbe";
    private const string Target = Root + @"\private\fixture.txt";
    private const string Pipe = "onoes-guest-broker-probe-v1";
    private volatile bool stopping;
    private NamedPipeServerStream current;
    private Thread worker;
    private readonly object gate = new object();

    public OnoesGuestBroker() { ServiceName = Name; AutoLog = false; CanStop = true; }
    public static string AccountSid()
    {
        return ((SecurityIdentifier)new NTAccount("NT SERVICE", Name).Translate(typeof(SecurityIdentifier))).Value;
    }
    protected override void OnStart(string[] args)
    {
        if (WindowsIdentity.GetCurrent().User.Value != AccountSid()
            || new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))
            throw new InvalidOperationException("guest-broker-identity-invalid");
        GrantFixtureIdentityQueries();
        stopping = false;
        // Acquire the name BEFORE SCM can report Running. Retain this same
        // server instance across every connection, including rejected frames.
        current = CreateOwnedPipe(Pipe);
        try { worker = new Thread(Serve); worker.IsBackground = true; worker.Start(); }
        catch { current.Dispose(); current = null; throw; }
    }
    protected override void OnStop()
    {
        stopping = true;
        lock (gate) { if (current != null) current.Dispose(); }
        if (worker != null && !worker.Join(5000)) throw new InvalidOperationException("guest-broker-stop-unconfirmed");
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct PipeAttributes { public int Length; public IntPtr Descriptor; public int Inherit; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern Microsoft.Win32.SafeHandles.SafePipeHandle CreateNamedPipeW(string name,
        uint openMode, uint mode, uint instances, uint output, uint input, uint timeout, ref PipeAttributes attributes);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CancelIoEx(Microsoft.Win32.SafeHandles.SafePipeHandle pipe, IntPtr overlapped);
    private static NamedPipeServerStream CreateOwnedPipe(string name)
    {
        var acl = new PipeSecurity(); acl.SetAccessRuleProtection(true, false);
        foreach (string sid in new[] { AccountSid(), "S-1-5-18" })
            acl.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(sid), PipeAccessRights.FullControl, AccessControlType.Allow));
        acl.AddAccessRule(new PipeAccessRule(new SecurityIdentifier("S-1-5-19"), PipeAccessRights.ReadWrite, AccessControlType.Allow));
        byte[] descriptor = acl.GetSecurityDescriptorBinaryForm();
        var pinned = GCHandle.Alloc(descriptor, GCHandleType.Pinned);
        try
        {
            var attributes = new PipeAttributes { Length = Marshal.SizeOf(typeof(PipeAttributes)), Descriptor = pinned.AddrOfPinnedObject() };
            // DUPLEX | OVERLAPPED | FIRST_PIPE_INSTANCE. Byte mode; explicitly
            // reject remote clients. No inherited pipe handle, max one instance.
            var handle = CreateNamedPipeW(@"\\.\pipe\" + name, 0x40080003, 8, 1, 1024, 1024, 3000, ref attributes);
            if (handle.IsInvalid)
            {
                int error = Marshal.GetLastWin32Error(); handle.Dispose();
                throw new System.ComponentModel.Win32Exception(error);
            }
            try { return new NamedPipeServerStream(PipeDirection.InOut, true, false, handle); }
            catch { handle.Dispose(); throw; }
        }
        finally { pinned.Free(); }
    }
    private sealed class PipeRecoveryUnconfirmed : Exception { }
    private static void FinishIo(Task task, PipeStream pipe, int timeout)
    {
        try { if (task.Wait(Math.Max(0, timeout))) return; }
        catch (AggregateException) { throw new IOException("pipe-io-failed"); }
        // Do not reuse an instance with an outstanding operation from its prior
        // client. Cancellation alone is NOT completion; observe completion too.
        CancelIoEx(pipe.SafePipeHandle, IntPtr.Zero);
        try { task.Wait(1000); } catch (AggregateException) { }
        if (!task.IsCompleted) throw new PipeRecoveryUnconfirmed();
        throw new IOException("pipe-io-timeout");
    }
    private void Serve()
    {
        var pipe = current;
        try
        {
            while (!stopping)
            {
                pipe.WaitForConnection();
                try
                {
                    string request = ReadLine(pipe, 1024);
                    string response;
                    // An I/O failure might follow replacement. Never label an
                    // uncertain effect as a proven no-effect denial.
                    try { response = Handle(request); } catch { response = "unconfirmed"; }
                    byte[] result = Encoding.ASCII.GetBytes(response + "\n");
                    FinishIo(pipe.WriteAsync(result, 0, result.Length), pipe, 3000);
                    // Disconnect discards unread reply bytes. The normal client
                    // closes only after reading its reply; bound that wait rather
                    // than blocking forever in FlushFileBuffers/WaitForPipeDrain.
                    byte[] closed = new byte[1];
                    FinishIo(pipe.ReadAsync(closed, 0, 1), pipe, 3000);
                }
                catch (IOException) { }
                if (!stopping) pipe.Disconnect();
            }
        }
        // A broken lifecycle must not recreate an unreserved name while SCM
        // still advertises a healthy service. This fixed guest executable exits;
        // production recovery/settlement is a separate unimplemented boundary.
        catch { if (!stopping) Environment.Exit(93); }
    }
    private static string ReadLine(Stream stream, int limit)
    {
        var timer = Stopwatch.StartNew(); var bytes = new MemoryStream(); var next = new byte[1];
        while (bytes.Length <= limit)
        {
            int remaining = 3000 - (int)timer.ElapsedMilliseconds;
            if (remaining <= 0) throw new IOException("read-incomplete");
            Task<int> read = stream.ReadAsync(next, 0, 1);
            FinishIo(read, (PipeStream)stream, remaining);
            if (read.Result != 1) throw new IOException("read-incomplete");
            if (next[0] == 10) return Encoding.ASCII.GetString(bytes.ToArray());
            if (next[0] < 32 || next[0] > 126) throw new IOException("read-invalid");
            bytes.WriteByte(next[0]);
        }
        throw new IOException("read-limit");
    }
    private static string Digest(byte[] bytes)
    {
        using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
    }
    private static string Handle(string request)
    {
        if (request == "identity") return AccountSid() + "|" + Process.GetCurrentProcess().Id;
        if (request == "snapshot") return Digest(File.ReadAllBytes(Target));
        string[] parts = request.Split('|');
        if (parts.Length != 3 || parts[0] != "replace" || parts[1].Length != 64) return "denied";
        byte[] postimage;
        try { postimage = Convert.FromBase64String(parts[2]); } catch { return "denied"; }
        if (postimage.Length > 512 || Convert.ToBase64String(postimage) != parts[2]) return "denied";
        // The private tree is created by the guest installer before service start.
        // No third-party direct writer is granted access. These checks are not a
        // defense for arbitrary shared folders or previously issued writable handles.
        if ((File.GetAttributes(Target) & FileAttributes.ReparsePoint) != 0) return "denied";
        if (Digest(File.ReadAllBytes(Target)) != parts[1]) return "stale";
        string stage = Root + @"\private\stage-" + Guid.NewGuid().ToString("N");
        try
        {
            using (var file = new FileStream(stage, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                4096, FileOptions.WriteThrough)) { file.Write(postimage, 0, postimage.Length); file.Flush(true); }
            File.Replace(stage, Target, null);
            return Digest(File.ReadAllBytes(Target)) == Digest(postimage) ? "replaced" : "unconfirmed";
        }
        finally { if (File.Exists(stage)) File.Delete(stage); }
    }

    private static string Request(string text) { return RequestTo(Pipe, text); }
    private static string RequestTo(string pipeName, string text)
    {
        using (var client = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous,
            TokenImpersonationLevel.Identification))
        {
            client.Connect(3000);
            // Retain the process object through the exchange. A reply string is
            // never an identity credential; no request byte precedes this check.
            using (var peer = new BrokerPeer(client))
            {
                byte[] bytes = Encoding.ASCII.GetBytes(text + "\n");
                if (!client.WriteAsync(bytes, 0, bytes.Length).Wait(3000)) throw new IOException("client-write-timeout");
                return ReadLine(client, 512);
            }
        }
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct ServiceStatus
    {
        public uint Type, State, Controls, Win32Exit, SpecificExit, Checkpoint, WaitHint, Pid, Flags;
    }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenSCManager(string machine, string database, uint access);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenService(IntPtr manager, string name, uint access);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool QueryServiceStatusEx(IntPtr service, int level, out ServiceStatus status, int size, out int needed);
    [DllImport("advapi32.dll")]
    private static extern bool CloseServiceHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetNamedPipeServerProcessId(Microsoft.Win32.SafeHandles.SafePipeHandle pipe, out uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint size);
    [DllImport("kernel32.dll")]
    private static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("advapi32.dll")]
    private static extern uint GetSecurityInfo(IntPtr handle, int type, uint info,
        out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll")]
    private static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("advapi32.dll")]
    private static extern uint SetSecurityInfo(IntPtr handle, int type, uint info,
        IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
    private static void GrantQuery(IntPtr handle, int mask)
    {
        IntPtr owner, group, dacl, sacl, descriptor;
        if (GetSecurityInfo(handle, 6, 4, out owner, out group, out dacl, out sacl, out descriptor) != 0)
            throw new IOException("query-acl-read-denied");
        try
        {
            byte[] bytes = new byte[checked((int)GetSecurityDescriptorLength(descriptor))];
            Marshal.Copy(descriptor, bytes, 0, bytes.Length);
            var security = new RawSecurityDescriptor(bytes, 0);
            if (security.DiscretionaryAcl == null) throw new IOException("query-acl-null");
            // Preserve all existing ACEs. Admit only query metadata to the fixed
            // fixture principal; never memory, duplication, modification or stop.
            security.DiscretionaryAcl.InsertAce(security.DiscretionaryAcl.Count,
                new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, mask,
                    new SecurityIdentifier("S-1-5-19"), false, null));
            byte[] aclBytes = new byte[security.DiscretionaryAcl.BinaryLength];
            security.DiscretionaryAcl.GetBinaryForm(aclBytes, 0);
            var pinned = GCHandle.Alloc(aclBytes, GCHandleType.Pinned);
            try
            {
                if (SetSecurityInfo(handle, 6, 4, IntPtr.Zero, IntPtr.Zero,
                    pinned.AddrOfPinnedObject(), IntPtr.Zero) != 0) throw new IOException("query-acl-set-denied");
            }
            finally { pinned.Free(); }
        }
        finally { LocalFree(descriptor); }
    }
    private static void GrantFixtureIdentityQueries()
    {
        GrantQuery(GetCurrentProcess(), 0x1000);
        IntPtr token;
        if (!OpenProcessToken(GetCurrentProcess(), 0x60008, out token)) throw new IOException("query-token-open-denied");
        try { GrantQuery(token, 8); } finally { CloseHandle(token); }
    }
    private sealed class BrokerPeer : IDisposable
    {
        private IntPtr process;
        private static bool IsRunning(IntPtr handle)
        {
            uint code;
            // This fixed executable never exits with STILL_ACTIVE (259).
            return GetExitCodeProcess(handle, out code) && code == 259;
        }
        public BrokerPeer(NamedPipeClientStream pipe)
        {
            IntPtr manager = IntPtr.Zero, service = IntPtr.Zero, token = IntPtr.Zero;
            try
            {
                manager = OpenSCManager(null, null, 1); // SC_MANAGER_CONNECT only.
                if (manager == IntPtr.Zero) throw new IOException("peer-manager-denied");
                service = OpenService(manager, Name, 4); // SERVICE_QUERY_STATUS only.
                ServiceStatus status; int needed; uint pid;
                if (service == IntPtr.Zero || !QueryServiceStatusEx(service, 0, out status,
                    Marshal.SizeOf(typeof(ServiceStatus)), out needed)
                    || status.Type != 0x10 || status.State != 4 || status.Pid == 0
                    || !GetNamedPipeServerProcessId(pipe.SafePipeHandle, out pid) || pid != status.Pid)
                    throw new IOException("peer-service-mismatch");
                process = OpenProcess(0x1000, false, checked((int)pid)); // QUERY_LIMITED_INFORMATION only.
                var image = new StringBuilder(1024); uint size = 1024;
                if (process == IntPtr.Zero) throw new IOException("peer-process-denied");
                if (!IsRunning(process)) throw new IOException("peer-process-exited");
                if (!QueryFullProcessImageName(process, 0, image, ref size)
                    || !String.Equals(image.ToString(), Root + @"\broker.exe", StringComparison.OrdinalIgnoreCase))
                    throw new IOException("peer-image-mismatch");
                if (!OpenProcessToken(process, 8, out token)) throw new IOException("peer-token-denied");
                using (var identity = new WindowsIdentity(token))
                    if (identity.User.Value != AccountSid()) throw new IOException("peer-account-mismatch");
                // Recheck SCM and liveness after opening the retained process
                // object; never accept a stale stopped-service PID.
                if (!QueryServiceStatusEx(service, 0, out status, Marshal.SizeOf(typeof(ServiceStatus)), out needed)
                    || status.State != 4 || status.Pid != pid || !IsRunning(process))
                    throw new IOException("peer-changed");
            }
            catch { Dispose(); throw; }
            finally
            {
                if (token != IntPtr.Zero) CloseHandle(token);
                if (service != IntPtr.Zero) CloseServiceHandle(service);
                if (manager != IntPtr.Zero) CloseServiceHandle(manager);
            }
        }
        public void Dispose() { if (process != IntPtr.Zero) { CloseHandle(process); process = IntPtr.Zero; } }
    }
    private static bool SpoofDeniedBeforeWrite(bool positiveControl)
    {
        string fakeName = Pipe + "-negative-" + Guid.NewGuid().ToString("N");
        using (var fake = new NamedPipeServerStream(fakeName, PipeDirection.InOut, 1,
            PipeTransmissionMode.Byte, PipeOptions.Asynchronous))
        {
            var attempt = Task.Run(delegate {
                if (positiveControl)
                {
                    using (var raw = new NamedPipeClientStream(".", fakeName, PipeDirection.InOut))
                    {
                        raw.Connect(3000); raw.WriteByte(67); raw.Flush();
                    }
                    return true;
                }
                try { RequestTo(fakeName, "fixed-secret-canary"); return false; }
                catch (IOException error) { return error.Message == "peer-service-mismatch"; }
            });
            if (!fake.WaitForConnectionAsync().Wait(5000)) return false;
            // Both runs use the same byte observer. The unverified control must
            // deliver its canary; the checked client must close without one.
            byte[] observed = new byte[1]; int count;
            try
            {
                var read = fake.ReadAsync(observed, 0, 1);
                if (!read.Wait(5000)) return false;
                count = read.Result;
            }
            catch (IOException error)
            {
                if ((error.HResult & 0xffff) != 109 && (error.HResult & 0xffff) != 232) throw;
                count = 0;
            }
            catch (AggregateException error)
            {
                var io = error.InnerException as IOException;
                if (error.InnerExceptions.Count != 1 || io == null
                    || ((io.HResult & 0xffff) != 109 && (io.HResult & 0xffff) != 232)) throw;
                count = 0;
            }
            return (positiveControl ? count == 1 && observed[0] == 67 : count == 0)
                && attempt.Wait(5000) && attempt.Result;
        }
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateHardLink(string name, string existing, IntPtr reserved);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int id);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
    private static bool AccessDenied(Action action)
    {
        try { action(); return false; } catch (Exception error) { return (error.HResult & 0xffff) == 5; }
    }
    private static bool NameReserved()
    {
        try { using (var other = CreateOwnedPipe(Pipe)) { return false; } }
        catch (System.ComponentModel.Win32Exception error) { return error.NativeErrorCode == 5; }
    }
    private static bool ObserveDisconnect(NamedPipeClientStream client)
    {
        try
        {
            byte[] one = new byte[1]; var read = client.ReadAsync(one, 0, 1);
            return read.Wait(6000) && read.Result == 0;
        }
        catch (IOException error) { return (error.HResult & 0xffff) == 109 || (error.HResult & 0xffff) == 232; }
        catch (AggregateException error)
        {
            var io = error.InnerException as IOException;
            return error.InnerExceptions.Count == 1 && io != null
                && ((io.HResult & 0xffff) == 109 || (io.HResult & 0xffff) == 232);
        }
    }
    private static bool TransportControls(string expected)
    {
        using (var positive = CreateOwnedPipe(Pipe + "-free-" + Guid.NewGuid().ToString("N"))) { }
        string identity = Request("identity");
        for (int i = 0; i < 20; i++)
            if (!NameReserved() || Request("snapshot") != expected || !NameReserved()) return false;
        // Invalid ASCII, overlong frame, idle before request, and a client that
        // reads a reply but refuses to close. Each must release the connection
        // without releasing the name or restarting the service process.
        for (int mode = 0; mode < 4; mode++)
        {
            using (var client = new NamedPipeClientStream(".", Pipe, PipeDirection.InOut,
                PipeOptions.Asynchronous, TokenImpersonationLevel.Identification))
            {
                client.Connect(3000);
                using (var peer = new BrokerPeer(client))
                {
                    byte[] payload = mode == 0 ? new byte[] { 0 }
                        : mode == 1 ? Encoding.ASCII.GetBytes(new string('a', 1025))
                        : mode == 3 ? Encoding.ASCII.GetBytes("snapshot\n") : new byte[0];
                    if (payload.Length != 0) FinishIo(client.WriteAsync(payload, 0, payload.Length), client, 3000);
                    if (mode == 3 && ReadLine(client, 512) != expected) return false;
                    if (!NameReserved() || !ObserveDisconnect(client) || !NameReserved()) return false;
                }
            }
            if (Request("identity") != identity || Request("snapshot") != expected) return false;
        }
        return true;
    }
    private static int SquatName()
    {
        if (WindowsIdentity.GetCurrent().User.Value != "S-1-5-19") return 140;
        using (var squat = CreateOwnedPipe(Pipe))
        {
            File.WriteAllText(Root + @"\client\squat-ready", "fixed-ready");
            var timer = Stopwatch.StartNew();
            while (!File.Exists(Root + @"\client\squat-release") && timer.ElapsedMilliseconds < 20000) Thread.Sleep(50);
            return File.Exists(Root + @"\client\squat-release") ? 0 : 141;
        }
    }
    private static int Client(bool recovery)
    {
        if (WindowsIdentity.GetCurrent().User.Value != "S-1-5-19") return 101;
        if (!SpoofDeniedBeforeWrite(true) || !SpoofDeniedBeforeWrite(false)) return 115;
        string[] identity = Request("identity").Split('|');
        if (identity.Length != 2 || identity[0] != AccountSid()) return 102;
        string before = Digest(Encoding.ASCII.GetBytes("fixed-preimage"));
        string after = Digest(Encoding.ASCII.GetBytes("fixed-postimage"));
        if (recovery) return Request("snapshot") == after ? 0 : 103;
        if (!TransportControls(before)) return 133;
        if (Request("snapshot") != before || Request("shell|cmd") != "denied") return 104;
        if (Request("replace|" + before + "|" + Convert.ToBase64String(new byte[513])) != "denied"
            || Request("replace|" + before + "|not-base64!") != "denied"
            || Request("replace|" + before + "|YQ==|D:/outside") != "denied") return 114;
        if (Request("replace|" + after + "|" + Convert.ToBase64String(Encoding.ASCII.GetBytes("fixed-postimage"))) != "stale") return 105;
        if (Request("replace|" + before + "|" + Convert.ToBase64String(Encoding.ASCII.GetBytes("fixed-postimage"))) != "replaced") return 106;
        if (Request("snapshot") != after) return 107;
        if (!AccessDenied(delegate { File.ReadAllBytes(Target); })
            || !AccessDenied(delegate { File.WriteAllText(Target, "forbidden"); })
            || !AccessDenied(delegate { Directory.Move(Root + @"\private", Root + @"\moved"); })
            || !AccessDenied(delegate { Directory.Move(Root, Root + "-moved"); })
            || !AccessDenied(delegate { Directory.CreateDirectory(Root + @"\private\forbidden"); })
            || !AccessDenied(delegate { File.WriteAllText(Root + @"\broker.exe", "forbidden"); })) return 108;
        string output = Root + @"\client";
        File.WriteAllText(output + @"\control", "fixed-control");
        if (!CreateHardLink(output + @"\control-link", output + @"\control", IntPtr.Zero)) return 109;
        if (CreateHardLink(output + @"\escape-link", Target, IntPtr.Zero) || Marshal.GetLastWin32Error() != 5) return 110;
        // A combined-rights denial would not prove denial of each individual right.
        foreach (uint right in new uint[] { 0x0008, 0x0010, 0x0020, 0x0040 })
        {
            IntPtr own = OpenProcess(right, false, Process.GetCurrentProcess().Id);
            if (own == IntPtr.Zero) return 111;
            CloseHandle(own);
            IntPtr process = OpenProcess(right, false, Int32.Parse(identity[1]));
            if (process != IntPtr.Zero) { CloseHandle(process); return 112; }
            if (Marshal.GetLastWin32Error() != 5) return 113;
        }
        IntPtr broker = OpenProcess(0x1000, false, Int32.Parse(identity[1]));
        if (broker == IntPtr.Zero) return 116;
        try
        {
            // Query permission must not permit duplicating/impersonating the
            // service token or adjusting its privileges, groups or defaults.
            foreach (uint right in new uint[] { 2, 4, 0x20, 0x40, 0x80, 0x100 })
            {
                IntPtr token;
                if (!OpenProcessToken(GetCurrentProcess(), right, out token)) return 117;
                CloseHandle(token);
                if (OpenProcessToken(broker, right, out token)) { CloseHandle(token); return 118; }
                if (Marshal.GetLastWin32Error() != 5) return 119;
            }
        }
        finally { CloseHandle(broker); }
        IntPtr manager = OpenSCManager(null, null, 1);
        if (manager == IntPtr.Zero) return 130;
        try
        {
            foreach (uint right in new uint[] { 2, 0x10, 0x20 }) // change config, start, stop.
            {
                IntPtr service = OpenService(manager, Name, right);
                if (service != IntPtr.Zero) { CloseServiceHandle(service); return 131; }
                if (Marshal.GetLastWin32Error() != 5) return 132;
            }
        }
        finally { CloseServiceHandle(manager); }
        return 0;
    }
    public static int Main(string[] args)
    {
        if (!Directory.Exists(@"C:\Users\WDAGUtilityAccount")) return 90;
        try
        {
            if (args.Length == 1 && args[0] == "--fixture-client") return Client(false);
            if (args.Length == 1 && args[0] == "--fixture-recovery") return Client(true);
            if (args.Length == 1 && args[0] == "--fixture-squat") return SquatName();
            if (args.Length != 0) return 91;
            ServiceBase.Run(new OnoesGuestBroker()); return 0;
        }
        catch (IOException error)
        {
            // Fixed fixture phase codes only, never exception text or buffers.
            string[] reasons = { "peer-manager-denied", "peer-service-mismatch", "peer-process-denied",
                "peer-process-exited", "peer-image-mismatch", "peer-token-denied", "peer-account-mismatch", "peer-changed" };
            int index = Array.IndexOf(reasons, error.Message);
            return index >= 0 ? 121 + index : 129;
        }
        catch { return 99; }
    }
}
