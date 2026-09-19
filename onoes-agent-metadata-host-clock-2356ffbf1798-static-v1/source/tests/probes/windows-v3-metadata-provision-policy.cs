// Pure bounded payload/creation accounting. Not install, consent or custody proof.
using System;
using System.Security.AccessControl;
using System.Security.Cryptography;
namespace Onoes.MetadataExperiment {
    internal sealed class MetadataBundlePayload : IDisposable {
        readonly byte[][] images=new byte[4][];
        internal readonly MetadataImageSetPins Pins;
        bool closed;
        internal MetadataBundlePayload(MetadataImageSetPins pins,byte[] coordinator,byte[] anchor,byte[] supervisor,byte[] child) {
            if(pins==null) throw new InvalidOperationException("metadata-bundle-payload");Pins=pins;
            var values=new[]{coordinator,anchor,supervisor,child};
            try {
                for(int i=0;i<4;i++) {
                    if(values[i]==null || values[i].Length!=pins.Image(i).ByteLength) throw new InvalidOperationException("metadata-bundle-payload");
                    images[i]=(byte[])values[i].Clone();
                    using(var hash=SHA256.Create()) if(BitConverter.ToString(hash.ComputeHash(images[i])).Replace("-","").ToLowerInvariant()!=pins.Image(i).Digest)
                        throw new InvalidOperationException("metadata-bundle-payload");
                }
            } catch {Dispose();throw;}
        }
        internal string Leaf(int index) {
            if(closed || index<0 || index>=8) throw new InvalidOperationException("metadata-bundle-index");
            return index<4?Pins.Image(index).Leaf:MetadataRuntimeConfiguration.Leaf((MetadataImageRole)(index-3));
        }
        internal byte[] Copy(int index) { Leaf(index);return index<4?(byte[])images[index].Clone():MetadataRuntimeConfiguration.Bytes(); }
        internal byte[] Descriptor(bool directory) {
            if(closed) throw new InvalidOperationException("metadata-bundle-closed");
            string flags=directory?"OICI":"";
            var sd=new RawSecurityDescriptor("O:SYG:SYD:P(A;"+flags+";0x001f01ff;;;SY)(A;"+flags+";0x001f01ff;;;BA)"+
                "(A;"+flags+";0x001200a9;;;"+Pins.Security.CoordinatorSid+")(A;"+flags+";0x001200a9;;;"+Pins.Security.AnchorSid+")"+
                "(A;"+flags+";0x001200a9;;;"+Pins.Security.SupervisorSid+")");
            var bytes=new byte[sd.BinaryLength];sd.GetBinaryForm(bytes,0);MetadataFixturePolicy.PrivateDescriptor(bytes,directory,Pins.Security);return bytes;
        }
        public void Dispose() {if(closed)return;closed=true;foreach(var bytes in images)if(bytes!=null)Array.Clear(bytes,0,bytes.Length);}
    }
    internal sealed class MetadataProvisionSnapshot {
        internal readonly int Attempted,Created,Verified;
        internal readonly bool Uncertain,Finished;
        internal MetadataProvisionSnapshot(int a,int c,int v,bool u,bool f){Attempted=a;Created=c;Verified=v;Uncertain=u;Finished=f;}
    }
    internal sealed class MetadataProvisionPolicy {
        int attempted,created,verified,next,phase;long last;bool failed,finished;
        void Need(bool ok){if(!ok){failed=true;throw new InvalidOperationException("metadata-provision-policy");}}
        void Time(long now){Need(!failed && !finished && now>=last && now>=0 && now<25000);last=now;}
        internal void Begin(int index,long now){Time(now);Need(index==next && index>=0 && index<9 && phase==0 && verified==attempted);attempted|=1<<index;phase=1;}
        internal void Created(int index,long now){Time(now);Need(index==next && phase==1);created|=1<<index;phase=2;}
        internal void Verified(int index,long now){Time(now);Need(index==next && phase==2);verified|=1<<index;phase=0;next++;}
        internal void Finish(long now){Time(now);Need(verified==511 && phase==0);finished=true;}
        internal void Failed(){failed=true;}
        internal MetadataProvisionSnapshot Snapshot(){return new MetadataProvisionSnapshot(attempted,created,verified,failed,finished);}
    }
}
