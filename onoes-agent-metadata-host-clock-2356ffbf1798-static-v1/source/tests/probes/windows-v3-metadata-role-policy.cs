// TEST-ONLY pure role-run accounting; not process stop or native evidence.
using System;

namespace Onoes.MetadataExperiment {
    internal sealed class MetadataRoleSnapshot {
        internal readonly bool Prepared,Started,ProtocolCompleted,StopRequested,CleanupObserved,CleanupCompleted,IoSettled,Uncertain;
        internal MetadataRoleSnapshot(bool prepared,bool started,bool protocol,bool stopping,bool observed,bool cleanup,bool io,bool uncertain) {
            Prepared=prepared;Started=started;ProtocolCompleted=protocol;StopRequested=stopping;
            CleanupObserved=observed;CleanupCompleted=cleanup;IoSettled=io;Uncertain=uncertain;
        }
        // No Passed/admission/process-stopped field. A service may still be alive.
    }
    internal sealed class MetadataRolePolicy {
        internal const int WorkMs=25000,StopMs=5000,CaseMs=30000;
        long last,stopDeadline;
        bool prepared,started,protocol,stopping,observed,cleanup,io,uncertain;
        bool Time(long now) {
            if(now<0 || now<last) { uncertain=true;return false; }
            last=now;
            if(stopping && !observed && now>=stopDeadline) uncertain=true;
            return true;
        }
        void Deny() { uncertain=true;throw new InvalidOperationException("metadata-role-order"); }
        void Work(long now) { if(!Time(now) || uncertain || stopping || now>=WorkMs) Deny(); }
        internal void Prepared(long now) { Work(now);if(prepared) Deny();prepared=true; }
        internal void Begin(long now) { Work(now);if(!prepared || started) Deny();started=true; }
        internal void CompleteProtocol(long now) { Work(now);if(!started || protocol) Deny();protocol=true; }
        internal void Failed() { uncertain=true; }
        internal void RequestStop(long now) {
            bool valid=Time(now);
            if(stopping) return;
            stopping=true;
            // Late callbacks cannot renew the original 25+5 second case ceiling.
            stopDeadline=valid ? Math.Min(now,WorkMs)+StopMs : 0;
            if(!valid || now>=stopDeadline) uncertain=true;
        }
        internal void ObserveCleanup(bool completed,bool ioSettled,long now) {
            bool valid=Time(now);
            if(!stopping || observed) Deny();
            observed=true;cleanup=completed;io=ioSettled;
            if(!valid || !completed || !ioSettled || now>=stopDeadline) uncertain=true;
        }
        internal MetadataRoleSnapshot Snapshot(long now) {
            if(!Time(now)) uncertain=true;
            // Reading after expiry does not renew any authority. If shutdown was
            // never requested, surface that missed watchdog as uncertain.
            if(!stopping && now>=WorkMs) uncertain=true;
            return new MetadataRoleSnapshot(prepared,started,protocol,stopping,observed,cleanup,io,uncertain);
        }
    }
}
