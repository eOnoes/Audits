// TEST-ONLY bounded fixed M04 configuration codec. Parsing is not authorization,
// protected-file custody, observed token identity or cross-process freshness.
using System;
using System.Security.Cryptography;
using System.Text;

namespace Onoes.MetadataExperiment {
    internal sealed class MetadataGuestRunPins {
        internal readonly PeerPin Coordinator,Anchor,Supervisor;
        internal readonly MetadataFixturePins Fixture;
        internal readonly MetadataRunBinding Binding;
        internal MetadataGuestRunPins(PeerPin coordinator,PeerPin anchor,PeerPin supervisor,string fixtureDigest,byte[] runNonce,byte[] bundleDigest) {
            Fixture=new MetadataFixturePins(coordinator,anchor,supervisor,fixtureDigest);
            Coordinator=coordinator;Anchor=anchor;Supervisor=supervisor;
            Binding=new MetadataRunBinding(5,runNonce,bundleDigest,MetadataBytes.Hex(fixtureDigest)); // M04 only
        }
        internal PeerPin Role(FixtureRole role) {
            if(role==FixtureRole.Coordinator) return Coordinator;
            if(role==FixtureRole.Anchor) return Anchor;
            if(role==FixtureRole.Supervisor) return Supervisor;
            throw new InvalidOperationException("metadata-role-pin");
        }
    }
    internal sealed class MetadataGuestConfiguration {
        // OMG1, case + reserved, nonce/bundle/child, three 104-byte peer slots:
        // SID length + 3 reserved, canonical ASCII SID padded to 68, profile32.
        internal const int WireBytes=416;
        internal readonly MetadataGuestRunPins Pins;
        internal readonly string Digest;
        MetadataGuestConfiguration(MetadataGuestRunPins pins,string digest) { Pins=pins;Digest=digest; }
        static void Need(bool value) { if(!value) throw new InvalidOperationException("metadata-configuration-wire"); }
        static byte[] Block(byte[] wire,int offset) {
            var value=new byte[32];Buffer.BlockCopy(wire,offset,value,0,32);
            int any=0;foreach(byte b in value) any|=b;Need(any!=0);return value;
        }
        static string Hex(byte[] value) { return BitConverter.ToString(value).Replace("-","").ToLowerInvariant(); }
        static PeerPin Peer(byte[] wire,int offset,FixtureRole role) {
            int length=wire[offset];Need(length>=1 && length<=68);
            Need(wire[offset+1]==0 && wire[offset+2]==0 && wire[offset+3]==0);
            for(int i=0;i<68;i++) Need(i<length ? wire[offset+4+i]>=32 && wire[offset+4+i]<=126 : wire[offset+4+i]==0);
            string sid=Encoding.ASCII.GetString(wire,offset+4,length);
            return new PeerPin(role,sid,Hex(Block(wire,offset+72)));
        }
        internal static byte[] Encode(MetadataGuestRunPins pins) {
            Need(pins!=null && pins.Binding.Case==5);
            var wire=new byte[WireBytes];wire[0]=79;wire[1]=77;wire[2]=71;wire[3]=49;wire[4]=5;
            // Reuse the binding's privately snapshotted nonce/bundle/fixture bytes.
            byte[] context=pins.Binding.ContextWire(pins.Coordinator,pins.Anchor);
            Buffer.BlockCopy(context,8,wire,8,96);
            PeerPin[] peers={pins.Coordinator,pins.Anchor,pins.Supervisor};
            for(int i=0;i<3;i++) {
                int offset=104+104*i;byte[] sid=Encoding.ASCII.GetBytes(peers[i].UserSid);
                Need(sid.Length>=1 && sid.Length<=68);wire[offset]=(byte)sid.Length;
                Buffer.BlockCopy(sid,0,wire,offset+4,sid.Length);
                MetadataBytes.Put(wire,offset+72,MetadataBytes.Hex(peers[i].TokenProfile));
            }
            Parse(wire); // Validate the exact bytes returned, never a later rebuild.
            return wire;
        }
        internal static MetadataGuestConfiguration Parse(byte[] input) {
            Need(input!=null && input.Length==WireBytes); // BEFORE snapshot/allocation
            var wire=(byte[])input.Clone();
            Need(wire[0]==79 && wire[1]==77 && wire[2]==71 && wire[3]==49 && wire[4]==5 && wire[5]==0 && wire[6]==0 && wire[7]==0);
            var pins=new MetadataGuestRunPins(Peer(wire,104,FixtureRole.Coordinator),Peer(wire,208,FixtureRole.Anchor),
                Peer(wire,312,FixtureRole.Supervisor),Hex(Block(wire,72)),Block(wire,8),Block(wire,40));
            using(var sha=SHA256.Create()) return new MetadataGuestConfiguration(pins,Hex(sha.ComputeHash(wire)));
        }
    }
}
