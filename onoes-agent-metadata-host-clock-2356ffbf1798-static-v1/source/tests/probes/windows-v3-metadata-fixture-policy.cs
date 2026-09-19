// TEST-ONLY descriptor/data checks. No file open, OS mutation or launch.
using System;
using System.Security.AccessControl;

namespace Onoes.MetadataExperiment {
    internal sealed class MetadataFixturePins {
        internal readonly string CoordinatorSid,AnchorSid,SupervisorSid,ChildDigest;
        internal MetadataFixturePins(string coordinatorSid,string anchorSid,string supervisorSid,string childDigest) {
            foreach(string sid in new[]{coordinatorSid,anchorSid,supervisorSid})
                if(!MetadataPinSyntax.IsServiceSid(sid) || sid==MetadataFixturePolicy.TrustedInstaller) throw new InvalidOperationException("metadata-fixture-pins");
            if(coordinatorSid==anchorSid || coordinatorSid==supervisorSid || anchorSid==supervisorSid || !MetadataPinSyntax.IsDigest(childDigest))
                throw new InvalidOperationException("metadata-fixture-pins");
            CoordinatorSid=coordinatorSid;AnchorSid=anchorSid;SupervisorSid=supervisorSid;ChildDigest=childDigest;
        }
        internal MetadataFixturePins(PeerPin coordinator,PeerPin anchor,PeerPin supervisor,string childDigest) {
            if(coordinator==null || anchor==null || supervisor==null || coordinator.Role!=FixtureRole.Coordinator ||
                anchor.Role!=FixtureRole.Anchor || supervisor.Role!=FixtureRole.Supervisor ||
                coordinator.UserSid==anchor.UserSid || coordinator.UserSid==supervisor.UserSid || anchor.UserSid==supervisor.UserSid ||
                coordinator.UserSid==MetadataFixturePolicy.TrustedInstaller || anchor.UserSid==MetadataFixturePolicy.TrustedInstaller ||
                supervisor.UserSid==MetadataFixturePolicy.TrustedInstaller || !MetadataPinSyntax.IsDigest(childDigest))
                throw new InvalidOperationException("metadata-fixture-pins");
            CoordinatorSid=coordinator.UserSid;AnchorSid=anchor.UserSid;SupervisorSid=supervisor.UserSid;ChildDigest=childDigest;
        }
    }
    internal static class MetadataFixturePolicy {
        internal const string SystemSid="S-1-5-18",Administrators="S-1-5-32-544";
        internal const string TrustedInstaller="S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
        internal const uint Full=0x001f01ff,ReadExecute=0x001200a9;
        internal const int DescriptorMaximum=4096,MaximumChildBytes=1048576;
        static void Need(bool value) { if(!value) throw new InvalidOperationException("metadata-fixture-policy"); }
        static RawSecurityDescriptor Descriptor(byte[] input) {
            Need(input!=null && input.Length>=20 && input.Length<=DescriptorMaximum);
            var value=new RawSecurityDescriptor((byte[])input.Clone(),0);
            Need(value.BinaryLength==input.Length && value.Owner!=null && value.DiscretionaryAcl!=null &&
                (value.ControlFlags&ControlFlags.DiscretionaryAclPresent)!=0 && value.DiscretionaryAcl.Count<=64);
            return value;
        }
        internal static void PrivateDescriptor(byte[] input,bool directory,MetadataFixturePins pins) {
            Need(pins!=null);var value=Descriptor(input);
            Need(value.Owner.Value==SystemSid && value.Group!=null && value.Group.Value==SystemSid &&
                (value.ControlFlags&ControlFlags.DiscretionaryAclProtected)!=0 && value.DiscretionaryAcl.Count==5);
            int seen=0;AceFlags flags=directory ? AceFlags.ObjectInherit|AceFlags.ContainerInherit : AceFlags.None;
            foreach(GenericAce raw in value.DiscretionaryAcl) {
                var ace=raw as CommonAce;
                Need(ace!=null && !ace.IsCallback && ace.AceQualifier==AceQualifier.AccessAllowed && ace.AceFlags==flags);
                string sid=ace.SecurityIdentifier.Value;int bit;uint mask;
                if(sid==SystemSid) { bit=1;mask=Full; }
                else if(sid==Administrators) { bit=2;mask=Full; }
                else if(sid==pins.CoordinatorSid) { bit=4;mask=ReadExecute; }
                else if(sid==pins.AnchorSid) { bit=8;mask=ReadExecute; }
                else if(sid==pins.SupervisorSid) { bit=16;mask=ReadExecute; }
                else { Need(false);return; }
                Need((seen&bit)==0 && unchecked((uint)ace.AccessMask)==mask);seen|=bit;
            }
            Need(seen==31);
        }
        internal static void AncestorDescriptor(byte[] input,bool volumeRoot) {
            var value=Descriptor(input);string owner=value.Owner.Value;
            Need(owner==SystemSid || owner==Administrators || owner==TrustedInstaller);
            foreach(GenericAce raw in value.DiscretionaryAcl) {
                var ace=raw as CommonAce;
                Need(ace!=null && !ace.IsCallback && (ace.AceQualifier==AceQualifier.AccessAllowed || ace.AceQualifier==AceQualifier.AccessDenied));
                if((ace.AceFlags&AceFlags.InheritOnly)!=0 || ace.AceQualifier==AceQualifier.AccessDenied) continue;
                string sid=ace.SecurityIdentifier.Value;
                if(sid==SystemSid || sid==Administrators || sid==TrustedInstaller) continue;
                // C:\ can permit creation of unrelated sibling directories. This is NOT
                // authority to mutate our retained, protected child. DELETE_CHILD,
                // FILE_ADD_FILE (also FILE_WRITE_DATA), WRITE_DAC/OWNER,
                // attribute/EA writes and generic write still deny.
                // Below the volume root, even create-file/subdirectory rights deny.
                uint allowed=ReadExecute|0x80000000u|0x20000000u|(volumeRoot ? 4u : 0u);
                Need((unchecked((uint)ace.AccessMask)&~allowed)==0);
            }
        }
        internal static void FileShape(uint attributes,uint links,uint high,uint low,long expected) {
            Need((attributes&~(1u|0x20u|0x80u))==0 && links==1 && high==0 && low>=1 && low<=MaximumChildBytes && low==expected);
        }
        internal static void UnnamedStream(byte[] bytes,long length) {
            Need(bytes!=null && bytes.Length==4096 && length>=1 && length<=MaximumChildBytes);
            Need(BitConverter.ToUInt32(bytes,0)==0 && BitConverter.ToUInt32(bytes,4)==14 && BitConverter.ToInt64(bytes,8)==length &&
                BitConverter.ToInt64(bytes,16)>=length);
            const string name="::$DATA";
            for(int i=0;i<name.Length;i++) Need(bytes[24+i*2]==(byte)name[i] && bytes[25+i*2]==0);
        }
        internal static void VolumeRoot(string value) {
            const string prefix=@"\\?\Volume{";Guid parsed;
            Need(value!=null && value.Length==prefix.Length+38 && value.StartsWith(prefix,StringComparison.Ordinal) &&
                value.EndsWith(@"}\",StringComparison.Ordinal) && Guid.TryParseExact(value.Substring(prefix.Length,36),"D",out parsed));
        }
    }
}
