// TEST-ONLY pure SCM-shell accounting. No service/process/thread or authority.
using System;

namespace Onoes.MetadataExperiment {
    internal enum MetadataRootExitKind { StillRunning=0,CompletionAndCleanupReported=1,IncompleteOrUncertainReported=2,FixedEntryFailure=3,UnexpectedExit=4 }
    internal sealed class MetadataRootExitObservation {
        internal readonly MetadataRootExitKind Kind;
        internal readonly bool PriorUncertainty;
        internal MetadataRootExitObservation(bool rootSignaled,uint code,bool priorUncertainty) {
            PriorUncertainty=priorUncertainty;
            Kind=!rootSignaled ? MetadataRootExitKind.StillRunning : code==0 ? MetadataRootExitKind.CompletionAndCleanupReported :
                code==1 ? MetadataRootExitKind.IncompleteOrUncertainReported : code==81 || code==82 || code==83 ? MetadataRootExitKind.FixedEntryFailure : MetadataRootExitKind.UnexpectedExit;
        }
        internal MetadataRootExitObservation(MetadataRootExitKind kind,bool priorUncertainty) {
            if(kind<MetadataRootExitKind.StillRunning || kind>MetadataRootExitKind.UnexpectedExit) throw new InvalidOperationException("metadata-root-result");
            Kind=kind;PriorUncertainty=priorUncertainty;
        }
        // Bounded process-reported status, NOT independent protocol/job settlement.
    }
    internal sealed class MetadataServiceSnapshot {
        internal readonly bool Started,Ready,DispatchConsumed,Stopping,JoinObserved,WorkersJoined,LocalCleanup,Uncertain;
        internal MetadataServiceSnapshot(bool started,bool ready,bool dispatch,bool stopping,bool observed,bool joined,bool cleanup,bool uncertain) {
            Started=started;Ready=ready;DispatchConsumed=dispatch;Stopping=stopping;
            JoinObserved=observed;WorkersJoined=joined;LocalCleanup=cleanup;Uncertain=uncertain;
        }
        // No process-stopped, successful case or permission field.
    }
    internal sealed class MetadataServicePolicy {
        internal const int RunCommand=128,PrepareCommand=129;
        long last,deadline;
        bool started,preparationClaimed,ready,signaled,dispatch,entered,protocolReported,stopping,observed,joined,cleanup,uncertain;
        bool Time(long now) {
            if(now<0 || now<last) { uncertain=true;return false; }
            last=now;return true;
        }
        void Deny() { uncertain=true;throw new InvalidOperationException("metadata-service-order"); }
        void Work(long now) { if(!Time(now) || uncertain || stopping || now>=MetadataRolePolicy.WorkMs) Deny(); }
        internal void Start(int argumentCount,long now) {
            Work(now);if(started || argumentCount!=0) Deny();started=true;
        }
        internal void ClaimPreparation(long now) { Work(now);if(!started || preparationClaimed) Deny();preparationClaimed=true; }
        internal void Prepared(long now) { Work(now);if(!preparationClaimed || ready) Deny();ready=true; }
        internal void SignalReturned(long now) { Work(now);if(!ready || signaled || dispatch) Deny();signaled=true; }
        internal void Dispatch(int command,long now) {
            Work(now);if(!ready || !signaled || dispatch || command!=RunCommand) Deny();dispatch=true;
        }
        internal void BeginDispatch(long now) {
            Work(now);if(!dispatch || entered) Deny();entered=true;
        }
        internal void ProtocolSignalReturned(MetadataRoleSnapshot role,long now) {
            Work(now);if(!entered || protocolReported || role==null || !role.Prepared || !role.Started || !role.ProtocolCompleted || role.StopRequested || role.Uncertain) Deny();
            protocolReported=true;
        }
        internal int FinalExitCode(long now) {
            Snapshot(now);
            return started && ready && signaled && dispatch && entered && protocolReported && stopping && observed && joined && cleanup && !uncertain ? 0 : 1;
        }
        internal void Failed() { uncertain=true; }
        internal int WorkRemaining(long now) {
            if(!Time(now) || uncertain || stopping || now>=MetadataRolePolicy.WorkMs) return 0;
            return (int)(MetadataRolePolicy.WorkMs-now);
        }
        internal void Stop(long now) {
            bool valid=Time(now);
            if(stopping) return;
            stopping=true;deadline=valid ? Math.Min(now,MetadataRolePolicy.WorkMs)+MetadataRolePolicy.StopMs : 0;
            if(!valid || now>=deadline) uncertain=true;
        }
        internal int Remaining(long now) {
            if(!Time(now) || !stopping) { uncertain=true;return 0; }
            if(now>=deadline) { if(!observed) uncertain=true;return 0; }
            return (int)(deadline-now);
        }
        internal void ObserveJoin(bool workJoined,bool stopJoined,MetadataRoleSnapshot role,long now) {
            int left=Remaining(now);
            if(!stopping || observed) Deny();
            observed=true;joined=workJoined && stopJoined;
            cleanup=role!=null && role.StopRequested && role.CleanupObserved && role.CleanupCompleted && role.IoSettled;
            if(left==0 || !joined || !cleanup || role.Uncertain) uncertain=true;
        }
        internal MetadataServiceSnapshot Snapshot(long now) {
            if(!Time(now) || (!stopping && now>=MetadataRolePolicy.WorkMs) || (stopping && !observed && now>=deadline)) uncertain=true;
            return new MetadataServiceSnapshot(started,ready,dispatch,stopping,observed,joined,cleanup,uncertain);
        }
    }
}
