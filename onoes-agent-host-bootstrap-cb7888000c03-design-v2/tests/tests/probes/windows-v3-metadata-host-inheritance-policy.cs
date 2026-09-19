// Pure role topology and native-call lifetime bookkeeping, NOT launch permission.
using System;
namespace Onoes.MetadataExperiment {
    internal enum HostActor { Guard=1,Controller=2,Writer=3,Stop=4 }
    internal sealed class HostInheritancePolicy {
        readonly int deadline;long last;bool prepared,borrowed,returned,closed;
        internal bool MustRetain {get{return borrowed&&!returned;}}
        internal bool MayRelease {get{return !MustRetain;}}
        internal bool Closed {get{return closed;}}
        // Explicit mapped file rights. Never inherit creator-only rights via SAME_ACCESS.
        // Reader: READ_DATA, READ_EA, READ_ATTRIBUTES, READ_CONTROL, SYNCHRONIZE.
        // Writer: WRITE_DATA, READ_ATTRIBUTES, READ_CONTROL, SYNCHRONIZE.
        internal static uint AccessForEnd(int end){
            if(end==0||end < -6||end>6)throw new InvalidOperationException("host-inheritance-end");
            return end>0?0x00120089U:0x00120082U;
        }
        internal static void RequireAccess(int end,uint granted){
            if(granted!=AccessForEnd(end))throw new InvalidOperationException("host-inheritance-access");
        }
        // Positive route = reader; negative route = writer. Fresh arrays only.
        internal static int[] Ends(HostActor role){
            switch(role){
                case HostActor.Guard:return new[]{1,2,3,-4,-5,-6};
                case HostActor.Controller:return new[]{-1,4};
                case HostActor.Writer:return new[]{-2,5};
                case HostActor.Stop:return new[]{-3,6};
                default:throw new InvalidOperationException("host-inheritance-role");
            }
        }
        internal HostInheritancePolicy(HostActor role,int work){
            Ends(role);if(work<1||work>25000)throw new InvalidOperationException("host-inheritance-budget");
            deadline=Math.Min(work,5000);
        }
        void Need(bool ok){if(!ok){closed=true;throw new InvalidOperationException("host-inheritance-order");}}
        void Time(long now){Need(!closed&&now>=last&&now>=0&&now<deadline);last=now;}
        internal void Prepared(long now){Time(now);Need(!prepared&&!borrowed);prepared=true;}
        internal void BeginBorrow(long now){Time(now);Need(prepared&&!borrowed);borrowed=true;}
        // Return is cleanup bookkeeping, allowed after expiry/denial. It confers
        // no successful-create/identity claim. The trusted caller must have really
        // returned from CreateProcess AND destroyed its referencing attribute list.
        internal void EndBorrow(){Need(borrowed&&!returned);returned=true;closed=true;}
        internal void Close(){closed=true;}
    }
}
