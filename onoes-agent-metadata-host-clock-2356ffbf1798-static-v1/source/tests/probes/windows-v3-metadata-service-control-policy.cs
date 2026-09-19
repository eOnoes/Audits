// TEST-ONLY pure fixed-control accounting and service-object descriptor checks.
using System;
using System.Security.AccessControl;

namespace Onoes.MetadataExperiment {
    internal sealed class MetadataControlSnapshot {
        internal readonly bool PrepareAttempted,PrepareReturned,DispatchAttempted,DispatchReturned,StopAttempted,StopReturned,Uncertain;
        internal MetadataControlSnapshot(bool pa,bool pr,bool da,bool dr,bool sa,bool sr,bool uncertain) {
            PrepareAttempted=pa;PrepareReturned=pr;DispatchAttempted=da;DispatchReturned=dr;StopAttempted=sa;StopReturned=sr;Uncertain=uncertain;
        }
        // Returned means SCM accepted a request, not prepared/completed/stopped.
    }
    internal sealed class MetadataServiceControlPolicy {
        const int WorkMs=25000,CaseMs=30000;
        bool prepare,prepared,dispatch,dispatched,stop,stopped,uncertain;
        int pending;
        long last,stopDeadline;
        void Deny() { uncertain=true;throw new InvalidOperationException("metadata-service-control-policy"); }
        void Time(long now,long deadline) { if(now<0 || now<last || now>=deadline) Deny();last=now; }
        void Work(long now) { Time(now,WorkMs);if(uncertain || stop || pending!=0) Deny(); }
        internal void BeginPrepare(long now) { Work(now);if(prepare) Deny();prepare=true;pending=129; }
        internal void BeginDispatch(bool allPrepared,long now) { Work(now);if(!allPrepared || !prepared || dispatch) Deny();dispatch=true;pending=128; }
        internal void BeginStop(long deadline,long now) {
            Time(now,CaseMs);if(stop || deadline<=now || deadline>Math.Min(now,WorkMs)+5000) Deny();
            // After uncertainty, STOP is still eligible once, never another work
            // request. This port serializes calls, so an outstanding call denies.
            if(pending!=0) Deny();stop=true;stopDeadline=deadline;pending=1;
        }
        internal void Returned(int command,bool accepted,long now) {
            if(pending!=command || (command!=1 && command!=128 && command!=129)) Deny();
            pending=0;Time(now,command==1 ? stopDeadline : WorkMs);if(!accepted) Deny();
            if(command==129) prepared=true;else if(command==128) dispatched=true;else stopped=true;
        }
        internal void Failed() { pending=0;uncertain=true; }
        internal MetadataControlSnapshot Snapshot() { return new MetadataControlSnapshot(prepare,prepared,dispatch,dispatched,stop,stopped,uncertain); }
    }
    internal static class MetadataServiceControlSecurity {
        internal const uint Access=0x20124; // READ_CONTROL | QUERY_STATUS | STOP | USER_DEFINED_CONTROL
        static void Need(bool value) { if(!value) throw new InvalidOperationException("metadata-service-control-security"); }
        static string[] Sids(MetadataGuestRunPins pins) {
            Need(pins!=null);return Sids(pins.Coordinator.UserSid,pins.Anchor.UserSid,pins.Supervisor.UserSid);
        }
        static string[] Sids(string coordinator,string anchor,string supervisor) {
            var roles=new[]{coordinator,anchor,supervisor};
            for(int i=0;i<3;i++) Need(MetadataPinSyntax.IsServiceSid(roles[i]) && roles[i]!=MetadataFixturePolicy.TrustedInstaller);
            Need(coordinator!=anchor && coordinator!=supervisor && anchor!=supervisor);
            return new[]{"S-1-5-18","S-1-5-32-544",coordinator,anchor,supervisor};
        }
        internal static byte[] Descriptor(MetadataGuestRunPins pins) {
            return DescriptorFor(Sids(pins));
        }
        internal static byte[] SetupDescriptor(string coordinator,string anchor,string supervisor) {
            return DescriptorFor(Sids(coordinator,anchor,supervisor));
        }
        static byte[] DescriptorFor(string[] sids) {
            string sddl="O:SYG:SYD:P";
            for(int i=0;i<5;i++) sddl+="(A;;"+(i<2 ? "0xf01ff" : "0x4")+";;;"+sids[i]+")";
            var sd=new RawSecurityDescriptor(sddl);var bytes=new byte[sd.BinaryLength];sd.GetBinaryForm(bytes,0);return bytes;
        }
        internal static void CheckDescriptor(byte[] input,MetadataGuestRunPins pins) {
            CheckDescriptorFor(input,Sids(pins));
        }
        internal static void CheckSetupDescriptor(byte[] input,string coordinator,string anchor,string supervisor) {
            CheckDescriptorFor(input,Sids(coordinator,anchor,supervisor));
        }
        static void CheckDescriptorFor(byte[] input,string[] sids) {
            Need(input!=null && input.Length>=20 && input.Length<=4096);
            var bytes=(byte[])input.Clone();var sd=new RawSecurityDescriptor(bytes,0);
            Need(sd.BinaryLength==bytes.Length && sd.Owner!=null && sd.Owner.Value==sids[0] && sd.Group!=null && sd.Group.Value==sids[0] &&
                sd.ControlFlags==(ControlFlags.SelfRelative|ControlFlags.DiscretionaryAclPresent|ControlFlags.DiscretionaryAclProtected) &&
                sd.SystemAcl==null && sd.DiscretionaryAcl!=null && sd.DiscretionaryAcl.Count==5);
            int seen=0;
            for(int i=0;i<5;i++) {
                var ace=sd.DiscretionaryAcl[i] as CommonAce;
                Need(ace!=null && !ace.IsCallback && ace.AceFlags==AceFlags.None && ace.AceQualifier==AceQualifier.AccessAllowed);
                int who=Array.IndexOf(sids,ace.SecurityIdentifier.Value);Need(who>=0 && (seen&(1<<who))==0);
                Need(ace.AccessMask==(who<2 ? 0xf01ff : 4));seen|=1<<who;
            }
            Need(seen==31);
        }
    }
}
