// HOST COMPILE ONLY: bridge for the separately approved/protected watchdog host.
// No Main, loader, elevation, VM access or consent authentication. Caller owns
// output transport and original clock. Retained bytes remain observations only.
using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
namespace Onoes.MetadataExperiment {
    public sealed class MetadataWatchdogRetentionBridge : IDisposable {
        readonly object sync=new object();readonly MetadataHostRunClock clock;readonly Stream output;
        readonly byte[] intent,arm;readonly int workMs;readonly ArmWriter writer;
        MetadataHostReportSink.WatchdogReservation reservation;
        Task writeTask,flushTask;bool writeAttempted,flushAttempted,armConfirmed,terminalAttempted,closed,armClosed;
        static void Need(bool value){if(!value)throw new InvalidOperationException("metadata-retained-watchdog-unavailable");}
        MetadataWatchdogRetentionBridge(byte[] expected,MetadataHostRunClock original,Stream target,int work){
            intent=MetadataWatchdogClockRecords.ValidateIntent(expected);arm=MetadataWatchdogClockRecords.ArmFrame(intent);
            clock=original;output=target;workMs=work;writer=new ArmWriter(this);
        }
        // Pins and approval must originate outside this library. Constructing
        // this object is NOT authentication, enrollment or permission to run.
        public static MetadataWatchdogRetentionBridge Reserve(string volumeRoot,uint volume,uint high,uint low,
            byte[] nonce,byte[] inventory,byte[] bundle,byte[] fixture,int work,MetadataHostRunClock original,Stream armOutput,
            byte[] context,byte[] reference,byte[] hostSession){
            MetadataWatchdogRetentionBridge bridge=null;
            try{
                Need(original!=null && armOutput!=null && armOutput.CanWrite);original.RequireRun(nonce,work);
                var owned=MetadataHostClockTransfer.RequireExistingInTrustedHost(original,context,reference,hostSession,nonce,work);
                var expected=MetadataWatchdogClockRecords.Intent(MetadataWatchdogRetentionPolicy.RootBinding(volumeRoot,volume,high,low),inventory,bundle,fixture,owned);
                bridge=new MetadataWatchdogRetentionBridge(expected,original,armOutput,work);
                bridge.reservation=MetadataHostReportSink.ReserveWatchdogInApprovedHost(volumeRoot,volume,high,low,MetadataWatchdogClockRecords.Clock(expected).Nonce,
                    MetadataBytes.Slice(expected,36,32),MetadataBytes.Slice(expected,68,32),MetadataBytes.Slice(expected,100,32),work,original,
                    owned,MetadataHostClockTransfer.ContextReference(owned),MetadataBytes.Slice(owned,64,32));
                bridge.Ready();return bridge;
            }catch{if(bridge!=null)try{bridge.Dispose();}catch{}throw new InvalidOperationException("metadata-retained-watchdog-unavailable");}
        }
        void LiveBudget(){Need(!closed && !armClosed && reservation!=null);clock.RequireBefore(workMs);}
        void Ready(){LiveBudget();reservation.AssertReadyForArm();LiveBudget();}
        public Stream ArmedOutput {get{lock(sync){Need(!closed);return writer;}}}
        public string ClockReference {get{return BitConverter.ToString(MetadataWatchdogClockRecords.Clock(intent).Reference()).Replace("-","").ToLowerInvariant();}}
        public string IntentReference {get{return BitConverter.ToString(MetadataWatchdogClockRecords.IntentReference(intent)).Replace("-","").ToLowerInvariant();}}
        Task WriteArm(byte[] buffer,int offset,int count,CancellationToken token){lock(sync){
            Need(!closed && !writeAttempted);writeAttempted=true;
            Need(buffer!=null && offset>=0 && count==arm.Length && offset<=buffer.Length-count && !token.IsCancellationRequested);
            for(int i=0;i<count;i++)Need(buffer[offset+i]==arm[i]);
            Ready(); // full retained intent/root read-back before any arm bytes
            writeTask=output.WriteAsync(arm,0,arm.Length,token);Need(writeTask!=null);return writeTask;
        }}
        async Task FlushAndObserve(CancellationToken token){
            await output.FlushAsync(token).ConfigureAwait(false);
            // Arm bytes may already be visible. Never touch storage here: it
            // could stall entry into the emergency stop loop after the arm.
            lock(sync){LiveBudget();armConfirmed=true;}
        }
        Task FlushArm(CancellationToken token){lock(sync){
            Need(!closed && !flushAttempted);flushAttempted=true;
            Need(writeTask!=null && writeTask.Status==TaskStatus.RanToCompletion && !token.IsCancellationRequested);
            LiveBudget();flushTask=FlushAndObserve(token);return flushTask;
        }}
        public void RecordClaims(string inventory,string nonce,string bundle,string trigger,
            bool armed,bool attempted,bool off,bool settled,bool timely){lock(sync){
            Need(!closed && !terminalAttempted);terminalAttempted=true;
            // Outstanding arm I/O cannot be labeled settled or race disposal.
            Need((writeTask==null || writeTask.IsCompleted) && (flushTask==null || flushTask.IsCompleted));
            Need(!armed || armConfirmed);
            clock.RequireBefore(clock.RetentionDeadlineMs);
            var wire=MetadataWatchdogClockRecords.Observation(intent,inventory,nonce,bundle,trigger,armed,attempted,off,settled,timely);
            // Preserve a returned write; the wrapper accounts for a later clock
            // failure separately after cleanup rather than erasing this fact.
            try{reservation.RecordTerminalClaims(wire);}finally{Array.Clear(wire,0,wire.Length);}
        }}
        public void Dispose(){lock(sync){if(closed)return;closed=true;armClosed=true;
            // Output belongs to the caller; pending output retains its immutable
            // non-secret frame. Late flush completion sees closed and cannot
            // re-enter native custody or promote the saved observation.
            if(reservation!=null)reservation.Dispose();
        }}
        sealed class ArmWriter : Stream {
            readonly MetadataWatchdogRetentionBridge owner;
            internal ArmWriter(MetadataWatchdogRetentionBridge value){owner=value;}
            public override bool CanRead {get{return false;}}
            public override bool CanSeek {get{return false;}}
            public override bool CanWrite {get{lock(owner.sync){return !owner.closed && !owner.armClosed;}}}
            public override long Length {get{throw new NotSupportedException();}}
            public override long Position {get{throw new NotSupportedException();}set{throw new NotSupportedException();}}
            public override int Read(byte[] buffer,int offset,int count){throw new NotSupportedException();}
            public override long Seek(long offset,SeekOrigin origin){throw new NotSupportedException();}
            public override void SetLength(long value){throw new NotSupportedException();}
            public override void Write(byte[] buffer,int offset,int count){throw new NotSupportedException();}
            public override void Flush(){throw new NotSupportedException();}
            public override Task WriteAsync(byte[] buffer,int offset,int count,CancellationToken token){return owner.WriteArm(buffer,offset,count,token);}
            public override Task FlushAsync(CancellationToken token){return owner.FlushArm(token);}
            protected override void Dispose(bool disposing){if(disposing)lock(owner.sync){owner.armClosed=true;}base.Dispose(disposing);}
        }
    }
}
