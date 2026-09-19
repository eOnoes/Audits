// TEST-ONLY pure accounting. Fabricated inputs are not native stop evidence.
using System;
using System.Security.AccessControl;

namespace Onoes.MetadataExperiment {
    internal sealed class MetadataServiceJobSnapshot {
        internal readonly bool AllAttached,StopRequested,KillAttempted,StopConfirmed,Uncertain;
        internal MetadataServiceJobSnapshot(bool attached,bool stopping,bool killed,bool stopped,bool uncertain) {
            AllAttached=attached;StopRequested=stopping;KillAttempted=killed;StopConfirmed=stopped;Uncertain=uncertain;
        }
        // No protocol-completed, passed, admission or service-exit-code claim.
    }
    internal sealed class MetadataServiceJobPolicy {
        internal const int WorkMs=25000,StopMs=5000,CaseMs=30000;
        internal const uint JobFlags=0x2208,MaximumProcesses=8,CpuFlags=5,CpuRate=2000;
        internal const ulong MaximumMemory=536870912;
        int attached;
        long last,deadline;
        bool stopping,killed,confirmed,uncertain,expired;
        bool Time(long now) {
            if(now<0 || now<last) { uncertain=true;expired=true;return false; }
            last=now;
            if(stopping && !confirmed && now>=deadline) { uncertain=true;expired=true; }
            return true;
        }
        void Deny() { uncertain=true;throw new InvalidOperationException("metadata-service-job-policy"); }
        void Work(long now) { if(!Time(now) || uncertain || stopping || now>=WorkMs) Deny(); }
        internal void Attached(int index,long now) { Work(now);if(index!=attached || index>=3) Deny();attached++; }
        internal void Ready(long now) { Work(now);if(attached!=3) Deny(); }
        internal void Failed() { uncertain=true; }
        internal void BeginStop(long now) {
            bool valid=Time(now);if(stopping) return;
            stopping=true;deadline=valid ? Math.Min(now,WorkMs)+StopMs : 0;
            if(!valid || now>=deadline) { uncertain=true;expired=true; }
        }
        internal bool ClaimKill() { if(!stopping) Deny();if(killed) return false;killed=true;return true; }
        internal int Remaining(long now) {
            if(!Time(now) || !stopping || expired || confirmed) return 0;
            return (int)Math.Max(0,deadline-now);
        }
        internal long StopDeadline { get { if(!stopping) Deny();return deadline; } }
        internal bool KillDue(long now) { if(!stopping) Deny();return Remaining(now)<=2000; } // reserve final two seconds for hard stop observation
        internal bool ObserveStop(int signaledRoots,uint activeProcesses,long now) {
            bool valid=Time(now);
            if(!stopping || signaledRoots<0 || signaledRoots>7 || activeProcesses>MaximumProcesses) Deny();
            if(confirmed) return true;
            if(valid && !expired && now<deadline && attached==3 && signaledRoots==7 && activeProcesses==0) confirmed=true;
            return confirmed;
        }
        internal MetadataServiceJobSnapshot Snapshot() {
            return new MetadataServiceJobSnapshot(attached==3,stopping,killed,confirmed,uncertain);
        }
        internal static byte[] Descriptor() {
            var sd=new RawSecurityDescriptor("O:SYG:SYD:P(A;;0x1f003f;;;SY)");
            var bytes=new byte[sd.BinaryLength];sd.GetBinaryForm(bytes,0);return bytes;
        }
        internal static void CheckDescriptor(byte[] input) {
            if(input==null || input.Length<20 || input.Length>4096) throw new InvalidOperationException("metadata-service-job-dacl");
            var bytes=(byte[])input.Clone();var sd=new RawSecurityDescriptor(bytes,0);
            var ace=sd.DiscretionaryAcl!=null && sd.DiscretionaryAcl.Count==1 ? sd.DiscretionaryAcl[0] as CommonAce : null;
            if(sd.BinaryLength!=bytes.Length || sd.Owner==null || sd.Owner.Value!="S-1-5-18" || sd.Group==null || sd.Group.Value!="S-1-5-18" ||
                sd.ControlFlags!=(ControlFlags.SelfRelative|ControlFlags.DiscretionaryAclPresent|ControlFlags.DiscretionaryAclProtected) ||
                sd.SystemAcl!=null || ace==null || ace.AceFlags!=AceFlags.None || ace.IsCallback ||
                ace.AceQualifier!=AceQualifier.AccessAllowed || ace.SecurityIdentifier.Value!="S-1-5-18" || ace.AccessMask!=0x1f003f)
                throw new InvalidOperationException("metadata-service-job-dacl");
        }
    }
}
