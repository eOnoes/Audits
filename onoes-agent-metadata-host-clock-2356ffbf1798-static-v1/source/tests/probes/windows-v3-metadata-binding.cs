// TEST-ONLY pure canonical data bindings. Digests/ack bytes are NOT custody,
// credentials, stop evidence or permission to resume. No OS/native handle use.
using System;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Onoes.MetadataExperiment {
    internal static class MetadataBytes {
        internal static bool Same(byte[] a,byte[] b) {
            if(a==null || b==null || a.Length!=b.Length) return false;
            int difference=0; for(int i=0;i<a.Length;i++) difference|=a[i]^b[i]; return difference==0;
        }
        internal static byte[] DigestCopy(byte[] input) {
            if(input==null || input.Length!=32) throw new InvalidOperationException("metadata-binding-size");
            byte[] copy=(byte[])input.Clone(); int any=0; foreach(byte b in copy) any|=b;
            if(any==0) throw new InvalidOperationException("metadata-binding-zero");
            return copy;
        }
        internal static byte[] Hex(string value) {
            if(!MetadataPinSyntax.IsDigest(value)) throw new InvalidOperationException("metadata-binding-hex");
            byte[] b=new byte[32]; for(int i=0;i<32;i++) b[i]=Byte.Parse(value.Substring(i*2,2),NumberStyles.HexNumber,CultureInfo.InvariantCulture);
            return DigestCopy(b);
        }
        internal static byte[] Slice(byte[] bytes,int start,int length) {
            byte[] result=new byte[length]; Buffer.BlockCopy(bytes,start,result,0,length); return result;
        }
        internal static byte[] Hash(string domain,byte[] value) {
            byte[] prefix=Encoding.ASCII.GetBytes(domain+"\0"), bytes=new byte[prefix.Length+value.Length];
            Buffer.BlockCopy(prefix,0,bytes,0,prefix.Length); Buffer.BlockCopy(value,0,bytes,prefix.Length,value.Length);
            using(var hash=SHA256.Create()) return hash.ComputeHash(bytes);
        }
        internal static void Put(byte[] target,int offset,byte[] value) { Buffer.BlockCopy(value,0,target,offset,value.Length); }
        internal static void Number(byte[] target,int offset,ulong value,int bytes) {
            for(int i=0;i<bytes;i++) target[offset+i]=(byte)(value>>(8*i));
        }
        internal static ulong Number(byte[] source,int offset,int bytes) {
            ulong result=0; for(int i=0;i<bytes;i++) result|=((ulong)source[offset+i])<<(8*i); return result;
        }
        internal static byte[] TranscriptDigest(byte[] transcript) {
            if(transcript==null || transcript.Length!=98) throw new InvalidOperationException("metadata-transcript-size");
            byte[] owned=(byte[])transcript.Clone();
            if(owned[0]!=1 || (owned[1]!=2 && owned[1]!=3)) throw new InvalidOperationException("metadata-transcript-role");
            DigestCopy(Slice(owned,2,32)); byte[] a=DigestCopy(Slice(owned,34,32)),b=DigestCopy(Slice(owned,66,32));
            if(Same(a,b)) throw new InvalidOperationException("metadata-transcript-reflection");
            return Hash("onoes-metadata-transcript/v1",owned);
        }
    }
    internal sealed class MetadataRunBinding {
        internal const int ContextBytes=168;
        internal readonly int Case;
        readonly byte[] run,bundle,fixture;
        internal MetadataRunBinding(int caseNumber,byte[] runNonce,byte[] bundleDigest,byte[] fixtureDigest) {
            if(caseNumber<1 || caseNumber>13) throw new InvalidOperationException("metadata-case-range");
            Case=caseNumber; run=MetadataBytes.DigestCopy(runNonce); bundle=MetadataBytes.DigestCopy(bundleDigest); fixture=MetadataBytes.DigestCopy(fixtureDigest);
        }
        internal byte[] FixtureDigest { get { return (byte[])fixture.Clone(); } }
        static byte[] PinDigest(PeerPin pin) {
            // All fields come from the bounded, immutable, fixed-role pin constructor.
            string text=((int)pin.Role).ToString(CultureInfo.InvariantCulture)+"\n"+pin.Service+"\n"+pin.UserSid+"\n"+pin.Image+"\n"+pin.TokenProfile+"\n";
            return MetadataBytes.Hash("onoes-metadata-peer/v1",Encoding.ASCII.GetBytes(text));
        }
        internal byte[] ContextWire(PeerPin a,PeerPin b) {
            if(a==null || b==null || a.UserSid==b.UserSid) throw new InvalidOperationException("metadata-context-pins");
            PeerPin client=a.Role==FixtureRole.Coordinator ? a : b,server=a.Role==FixtureRole.Coordinator ? b : a;
            if(client.Role!=FixtureRole.Coordinator || (server.Role!=FixtureRole.Anchor && server.Role!=FixtureRole.Supervisor))
                throw new InvalidOperationException("metadata-context-roles");
            byte[] wire=new byte[ContextBytes]; wire[0]=79;wire[1]=77;wire[2]=67;wire[3]=49;
            wire[4]=1;wire[5]=(byte)Case;wire[6]=1;wire[7]=(byte)server.Role;
            MetadataBytes.Put(wire,8,run);MetadataBytes.Put(wire,40,bundle);MetadataBytes.Put(wire,72,fixture);
            MetadataBytes.Put(wire,104,PinDigest(client));MetadataBytes.Put(wire,136,PinDigest(server));
            return wire;
        }
        internal byte[] ContextDigest(PeerPin a,PeerPin b) { return MetadataBytes.Hash("onoes-metadata-context/v1",ContextWire(a,b)); }
    }
    internal sealed class MetadataCustodyOffer {
        internal const int WireBytes=200, AckBytes=112;
        readonly byte[] wire;
        internal ulong JobValue { get { return MetadataBytes.Number(wire,104,8); } }
        internal ulong RootValue { get { return MetadataBytes.Number(wire,112,8); } }
        internal uint RootId { get { return (uint)MetadataBytes.Number(wire,120,4); } }
        internal long RootCreated { get { return (long)MetadataBytes.Number(wire,128,8); } }
        internal byte[] Digest { get { return MetadataBytes.Slice(wire,168,32); } }
        internal byte[] ToWire() { return (byte[])wire.Clone(); }
        MetadataCustodyOffer(byte[] owned) { wire=owned; }
        static bool Handle(ulong value) { return value>0 && value<=Int64.MaxValue && (value&3)==0; }
        internal static MetadataCustodyOffer Create(MetadataRunBinding binding,byte[] context,byte[] transcriptDigest,byte[] nonce,
            ulong job,ulong root,uint rootId,long rootCreated,byte[] actualFixtureDigest) {
            if(binding==null) throw new InvalidOperationException("metadata-offer-binding");
            byte[] c=MetadataBytes.DigestCopy(context),t=MetadataBytes.DigestCopy(transcriptDigest),n=MetadataBytes.DigestCopy(nonce);
            byte[] f=MetadataBytes.DigestCopy(actualFixtureDigest);
            if(!MetadataBytes.Same(f,binding.FixtureDigest)) throw new InvalidOperationException("metadata-offer-fixture");
            byte[] value=new byte[WireBytes];value[0]=79;value[1]=77;value[2]=79;value[3]=49;
            value[4]=1;value[5]=(byte)binding.Case;value[6]=1;value[7]=3;
            MetadataBytes.Put(value,8,c);MetadataBytes.Put(value,40,t);MetadataBytes.Put(value,72,n);
            MetadataBytes.Number(value,104,job,8);MetadataBytes.Number(value,112,root,8);MetadataBytes.Number(value,120,rootId,4);
            MetadataBytes.Number(value,128,unchecked((ulong)rootCreated),8);MetadataBytes.Put(value,136,f);
            MetadataBytes.Put(value,168,MetadataBytes.Hash("onoes-metadata-offer/v1",MetadataBytes.Slice(value,0,168)));
            return Parse(value,binding,c,t);
        }
        internal static MetadataCustodyOffer Parse(byte[] input,MetadataRunBinding binding,byte[] context,byte[] transcriptDigest) {
            if(input==null || input.Length!=WireBytes || binding==null) throw new InvalidOperationException("metadata-offer-size");
            byte[] owned=(byte[])input.Clone(),c=MetadataBytes.DigestCopy(context),t=MetadataBytes.DigestCopy(transcriptDigest);
            if(owned[0]!=79 || owned[1]!=77 || owned[2]!=79 || owned[3]!=49 || owned[4]!=1 || owned[5]!=binding.Case || owned[6]!=1 || owned[7]!=3 ||
                MetadataBytes.Number(owned,124,4)!=0 || !MetadataBytes.Same(MetadataBytes.Slice(owned,8,32),c) ||
                !MetadataBytes.Same(MetadataBytes.Slice(owned,40,32),t) || !MetadataBytes.Same(MetadataBytes.Slice(owned,136,32),binding.FixtureDigest) ||
                !MetadataBytes.Same(MetadataBytes.Slice(owned,168,32),MetadataBytes.Hash("onoes-metadata-offer/v1",MetadataBytes.Slice(owned,0,168))))
                throw new InvalidOperationException("metadata-offer-identity");
            MetadataBytes.DigestCopy(MetadataBytes.Slice(owned,72,32));
            var offer=new MetadataCustodyOffer(owned);
            if(!Handle(offer.JobValue) || !Handle(offer.RootValue) || offer.JobValue==offer.RootValue || offer.RootId==0 || offer.RootCreated<=0)
                throw new InvalidOperationException("metadata-offer-handles");
            return offer;
        }
        // DATA encoding only. The future native holder must mint/send this ONLY
        // after verified retention. This method itself does not prove custody.
        internal byte[] AcknowledgmentWire() {
            byte[] ack=new byte[AckBytes]; ack[0]=79;ack[1]=77;ack[2]=65;ack[3]=49;
            ack[4]=1;ack[5]=wire[5];ack[6]=3;ack[7]=1;ack[8]=1; // retained-not-resumed
            MetadataBytes.Put(ack,16,MetadataBytes.Slice(wire,8,32));MetadataBytes.Put(ack,48,MetadataBytes.Slice(wire,40,32));
            MetadataBytes.Put(ack,80,Digest);return ack;
        }
        internal void CheckAcknowledgment(byte[] input) {
            if(input==null || input.Length!=AckBytes) throw new InvalidOperationException("metadata-ack-size");
            byte[] owned=(byte[])input.Clone();
            if(!MetadataBytes.Same(owned,AcknowledgmentWire())) throw new InvalidOperationException("metadata-ack-binding");
        }
        internal byte[] FinishRequestWire() {
            byte[] value=AcknowledgmentWire();value[2]=70;value[6]=1;value[7]=3;return value; // OMF1
        }
        internal byte[] FinishAcknowledgmentWire() {
            byte[] value=AcknowledgmentWire();value[2]=83;return value; // OMS1
        }
        void CheckFinish(byte[] input,bool request) {
            if(input==null || input.Length!=AckBytes) throw new InvalidOperationException("metadata-finish-size");
            byte[] owned=(byte[])input.Clone();
            if(!MetadataBytes.Same(owned,request ? FinishRequestWire() : FinishAcknowledgmentWire()))
                throw new InvalidOperationException("metadata-finish-binding");
        }
        internal void CheckFinishRequest(byte[] input) { CheckFinish(input,true); }
        internal void CheckFinishAcknowledgment(byte[] input) { CheckFinish(input,false); }
    }
}
