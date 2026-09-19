// TEST-ONLY immutable image pins and fixed startup profile. Data, not authority.
using System;
using System.Text;
using System.Security.Cryptography;
namespace Onoes.MetadataExperiment {
    internal enum MetadataImageRole { Coordinator=1,Anchor=2,Supervisor=3,Child=4 }
    // Exact bytes, not a general XML/settings parser. No runtime/OS authenticity
    // claim: machine configuration, GAC, environment and loader remain host gates.
    internal static class MetadataRuntimeConfiguration {
        const string Text="<configuration>\n  <startup>\n    <supportedRuntime version=\"v4.0\" sku=\".NETFramework,Version=v4.8\" />\n  </startup>\n</configuration>\n";
        internal static byte[] Bytes() { return Encoding.ASCII.GetBytes(Text); }
        internal static int ByteLength { get { return Text.Length; } }
        internal static string Digest {
            get { using(var hash=SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(Bytes())).Replace("-","").ToLowerInvariant(); }
        }
        internal static string Leaf(MetadataImageRole role) {
            if(role<MetadataImageRole.Coordinator || role>MetadataImageRole.Child) throw new InvalidOperationException("metadata-runtime-role");
            return (role==MetadataImageRole.Child ? "inert-child" : PeerPin.ServiceName((FixtureRole)role))+".exe.config";
        }
        internal static void Validate(byte[] value) {
            if(value==null || value.Length!=Text.Length) throw new InvalidOperationException("metadata-runtime-bytes");
            for(int i=0;i<value.Length;i++) if(value[i]!=(byte)Text[i]) throw new InvalidOperationException("metadata-runtime-bytes");
        }
    }
    internal sealed class MetadataImagePin {
        internal readonly MetadataImageRole Role;
        internal readonly string Leaf,Digest;
        internal readonly int ByteLength;
        internal MetadataImagePin(MetadataImageRole role,int length,string digest) {
            if(role<MetadataImageRole.Coordinator || role>MetadataImageRole.Child || length<1 || length>MetadataFixturePolicy.MaximumChildBytes ||
                !MetadataPinSyntax.IsDigest(digest) || digest==new string('0',64)) throw new InvalidOperationException("metadata-image-pin");
            Role=role;ByteLength=length;Digest=digest;
            Leaf=role==MetadataImageRole.Child ? "inert-child.exe" : PeerPin.ServiceName((FixtureRole)role)+".exe";
        }
    }
    internal sealed class MetadataImageSetPins {
        readonly MetadataImagePin[] images;
        internal readonly MetadataFixturePins Security;
        internal readonly string BundleDigest;
        internal MetadataImageSetPins(string coordinatorSid,string anchorSid,string supervisorSid,string bundleDigest,
            MetadataImagePin coordinator,MetadataImagePin anchor,MetadataImagePin supervisor,MetadataImagePin child) {
            if(!MetadataPinSyntax.IsDigest(bundleDigest) || bundleDigest==new string('0',64)) throw new InvalidOperationException("metadata-image-bundle");
            images=new[]{coordinator,anchor,supervisor,child};
            for(int i=0;i<4;i++) {
                if(images[i]==null || images[i].Role!=(MetadataImageRole)(i+1)) throw new InvalidOperationException("metadata-image-order");
                for(int j=0;j<i;j++) if(images[j].Digest==images[i].Digest) throw new InvalidOperationException("metadata-image-role-alias");
            }
            Security=new MetadataFixturePins(coordinatorSid,anchorSid,supervisorSid,child.Digest);BundleDigest=bundleDigest;
        }
        internal MetadataImagePin Image(int index) {
            if(index<0 || index>=4) throw new InvalidOperationException("metadata-image-index");return images[index];
        }
        internal void MatchRun(string coordinator,string anchor,string supervisor,string bundleDigest,string childDigest) {
            if(coordinator!=Security.CoordinatorSid || anchor!=Security.AnchorSid || supervisor!=Security.SupervisorSid ||
                bundleDigest!=BundleDigest || childDigest!=Security.ChildDigest) throw new InvalidOperationException("metadata-image-run-mismatch");
        }
        // BundleDigest is an external pin, NOT independently reconstructed from
        // these four leaves; the protected bundle/provenance gate remains required.
    }
}
