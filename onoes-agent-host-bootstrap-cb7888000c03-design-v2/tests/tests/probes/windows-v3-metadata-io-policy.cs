// TEST-ONLY pure completion accounting. Fabricated samples are not OS evidence.
// This file has no handles, native calls, clocks, callbacks or effect authority.
using System;

namespace Onoes.MetadataExperiment {
    internal enum PipeIoKind { Connect=1, Read=2, Write=3 }

    internal sealed class IoCompletionPolicy {
        internal const int MaximumBytes=4096, MaximumWorkMs=5000, DrainMs=1000;
        readonly PipeIoKind kind;
        readonly int requested, deadline;
        long lastTime, drainDeadline;
        bool issued, returned, accepted, denied, uncertain, clockFault, cancelReported;
        internal bool Settled { get; private set; }
        internal bool CancelRequested { get; private set; }
        internal bool CancelCalled { get; private set; }
        internal bool CancelCallSucceeded { get; private set; }
        internal int CancelError { get; private set; }
        internal uint Bytes { get; private set; }
        internal bool MayRelease { get { return !issued || Settled; } }
        internal bool MayReturnSuccess { get { return Settled && accepted && !denied && !uncertain; } }
        internal bool MustAbandon { get { return uncertain || clockFault || (CancelRequested && lastTime>=drainDeadline); } }

        internal IoCompletionPolicy(PipeIoKind operation,int length,int workMs) {
            if(operation!=PipeIoKind.Connect && operation!=PipeIoKind.Read && operation!=PipeIoKind.Write)
                throw new InvalidOperationException("metadata-io-kind");
            if((operation==PipeIoKind.Connect && length!=0) || (operation!=PipeIoKind.Connect && (length<1 || length>MaximumBytes)))
                throw new InvalidOperationException("metadata-io-length");
            if(workMs<1 || workMs>MaximumWorkMs) throw new InvalidOperationException("metadata-io-budget");
            kind=operation; requested=length; deadline=workMs; drainDeadline=workMs+DrainMs;
        }

        internal void Tick(long now,bool canceled) {
            if(now<0 || now<lastTime) { clockFault=true; denied=true; }
            if(now>=0 && now>=lastTime) lastTime=now;
            if(canceled || clockFault || now>=deadline) {
                denied=true;
                if(!CancelRequested) {
                    CancelRequested=true;
                    // Bounded even if a caller supplies long.MaxValue. No renewed grace.
                    if(now>=0 && now<deadline) drainDeadline=Math.Min(drainDeadline,now+DrainMs);
                }
            }
        }
        void InvalidOrder() { denied=true; throw new InvalidOperationException("metadata-io-order"); }
        internal void Begin(long now,bool canceled) {
            Tick(now,canceled);
            if(issued || denied) { InvalidOrder(); return; }
            // Mark BEFORE crossing the native boundary: an exception is uncertain.
            issued=true;
        }
        internal void StartReturned(bool success,int error,long now,bool canceled) {
            Tick(now,canceled);
            if(!issued || returned || Settled || uncertain) { InvalidOrder(); return; }
            returned=true;
            if(success || error==997) return; // query GetOverlappedResult, including immediate success
            if(kind==PipeIoKind.Connect && error==535) {
                Settled=true; accepted=true; return; // connected before ConnectNamedPipe; no pending request
            }
            Settled=true; denied=true; // call failed without issuing pending work
        }
        internal void Observe(bool success,int error,uint transferred,long now,bool canceled) {
            Tick(now,canceled);
            if(!issued || !returned || Settled || uncertain) { InvalidOrder(); return; }
            if(success) {
                Settled=true;
                // ConnectNamedPipe's byte count is undefined: do not interpret it.
                Bytes=kind==PipeIoKind.Connect ? 0 : transferred;
                accepted=kind==PipeIoKind.Connect ||
                    (kind==PipeIoKind.Write ? transferred==(uint)requested : transferred>0 && transferred<=(uint)requested);
                if(!accepted) denied=true;
                return;
            }
            if(error==996) return; // ERROR_IO_INCOMPLETE is not completion
            if(error==995 || error==109 || error==232 || error==233 || error==234) {
                Settled=true; denied=true; return; // aborted/broken/no-data/not-connected/more-data
            }
            // Unknown error (including invalid handle/parameter): retain, never infer settlement.
            Abandon();
        }
        internal void MarkCancelAttempt() {
            if(!issued || Settled || CancelCalled) { InvalidOrder(); return; }
            Tick(lastTime,true); CancelCalled=true; // before crossing the native cancellation boundary
        }
        internal void NoteCancelResult(bool success,int error) {
            if(!CancelCalled || cancelReported) { InvalidOrder(); return; }
            cancelReported=true; CancelCallSucceeded=success; CancelError=success ? 0 : error;
            // Neither successful cancellation nor ERROR_NOT_FOUND proves completion.
        }
        internal void Abandon() { uncertain=true; denied=true; }
    }
}
