// Pure descriptor and exact intent framing. Saved claims are not authorization.
using System;
using System.Security.AccessControl;
namespace Onoes.MetadataExperiment {
    internal static class MetadataHostSinkPolicy {
        internal const int IntentBytes=164;
        static void Need(bool ok){if(!ok)throw new InvalidOperationException("metadata-host-sink-policy");}
        // Trusted owner resources only, not a caller-supplied effect port. Each
        // cleanup is attempted independently; a failure must not skip the rest.
        // A pending return value is handed off only if all cleanup succeeded.
        internal static void CompleteWriteCleanup(IDisposable temporaryStream,IDisposable rawHandle,Action releaseDescriptor,IDisposable pendingHandoff){
            bool failed=false;
            try{if(temporaryStream!=null)temporaryStream.Dispose();}catch{failed=true;}
            try{if(rawHandle!=null)rawHandle.Dispose();}catch{failed=true;}
            try{if(releaseDescriptor==null)failed=true;else releaseDescriptor();}catch{failed=true;}
            if(!failed)return;
            try{if(pendingHandoff!=null)pendingHandoff.Dispose();}catch{/* Remains an unavailable outcome. */}
            throw new InvalidOperationException("metadata-host-sink-unavailable");
        }
        internal static byte[] Descriptor(bool directory){
            string flags=directory?"OICI":"";
            var sd=new RawSecurityDescriptor("O:SYG:SYD:P(A;"+flags+";0x001f01ff;;;SY)(A;"+flags+";0x001f01ff;;;BA)");
            var b=new byte[sd.BinaryLength];sd.GetBinaryForm(b,0);CheckDescriptor(b,directory);return b;
        }
        internal static void CheckDescriptor(byte[] input,bool directory){
            Need(input!=null && input.Length>=20 && input.Length<=4096);
            var sd=new RawSecurityDescriptor((byte[])input.Clone(),0);
            Need(sd.BinaryLength==input.Length && sd.Owner!=null && sd.Owner.Value==MetadataFixturePolicy.SystemSid &&
                sd.Group!=null && sd.Group.Value==MetadataFixturePolicy.SystemSid &&
                (sd.ControlFlags&ControlFlags.DiscretionaryAclPresent)!=0 &&
                (sd.ControlFlags&ControlFlags.DiscretionaryAclProtected)!=0 && sd.DiscretionaryAcl!=null && sd.DiscretionaryAcl.Count==2);
            int seen=0;var flags=directory?AceFlags.ObjectInherit|AceFlags.ContainerInherit:AceFlags.None;
            foreach(GenericAce raw in sd.DiscretionaryAcl){
                var ace=raw as CommonAce;
                Need(ace!=null && !ace.IsCallback && ace.AceQualifier==AceQualifier.AccessAllowed && ace.AceFlags==flags &&
                    unchecked((uint)ace.AccessMask)==MetadataFixturePolicy.Full);
                int bit=ace.SecurityIdentifier.Value==MetadataFixturePolicy.SystemSid?1:ace.SecurityIdentifier.Value==MetadataFixturePolicy.Administrators?2:0;
                Need(bit!=0 && (seen&bit)==0);seen|=bit;
            }Need(seen==3);
        }
        internal static byte[] Intent(byte[] nonce,byte[] inventory,byte[] bundle,byte[] fixture){
            var b=new byte[IntentBytes];b[0]=79;b[1]=77;b[2]=72;b[3]=49; // OMH1
            MetadataBytes.Put(b,4,MetadataBytes.DigestCopy(nonce));MetadataBytes.Put(b,36,MetadataBytes.DigestCopy(inventory));
            MetadataBytes.Put(b,68,MetadataBytes.DigestCopy(bundle));MetadataBytes.Put(b,100,MetadataBytes.DigestCopy(fixture));
            MetadataBytes.Put(b,132,MetadataBytes.Hash("onoes-metadata-host-intent/v1",MetadataBytes.Slice(b,0,132)));return b;
        }
        internal static void MatchIntent(byte[] input,byte[] nonce,byte[] inventory,byte[] bundle,byte[] fixture){
            Need(input!=null && input.Length==IntentBytes && MetadataBytes.Same(input,Intent(nonce,inventory,bundle,fixture)));
        }
    }
}
