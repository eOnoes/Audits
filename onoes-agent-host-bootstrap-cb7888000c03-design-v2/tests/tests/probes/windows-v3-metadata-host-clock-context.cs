// Pure versioned clock DATA. Integrity/binding only, never peer authentication.
using System;
namespace Onoes.MetadataExperiment {
    internal sealed class MetadataHostClockContext {
        internal const int WireBytes=128;
        readonly byte[] wire;
        MetadataHostClockContext(byte[] owned){wire=owned;}
        static void Need(bool ok){if(!ok)throw new InvalidOperationException("metadata-host-clock-context-invalid");}
        internal long OriginTicks {get{return (long)MetadataBytes.Number(wire,36,8);}}
        internal long Frequency {get{return (long)MetadataBytes.Number(wire,44,8);}}
        internal int WorkMs {get{return (int)MetadataBytes.Number(wire,52,4);}}
        internal byte[] Nonce {get{return MetadataBytes.Slice(wire,4,32);}}
        internal byte[] ToWire(){return (byte[])wire.Clone();}
        internal byte[] Reference(){return MetadataBytes.Hash("onoes-metadata-host-clock-reference/v1",wire);}
        internal static MetadataHostClockContext Create(long origin,long frequency,byte[] nonce,int work,byte[] hostSession){
            Need(origin>0 && frequency>0 && work>=1 && work<=25000);
            var b=new byte[WireBytes];b[0]=79;b[1]=77;b[2]=75;b[3]=49; // OMK1, not OMH1/OMWI
            MetadataBytes.Put(b,4,MetadataBytes.DigestCopy(nonce));
            MetadataBytes.Number(b,36,(ulong)origin,8);MetadataBytes.Number(b,44,(ulong)frequency,8);
            MetadataBytes.Number(b,52,(ulong)work,4);MetadataBytes.Number(b,56,(ulong)(work+5000),4);
            MetadataBytes.Number(b,60,(ulong)(work+10000),4);MetadataBytes.Put(b,64,MetadataBytes.DigestCopy(hostSession));
            MetadataBytes.Put(b,96,MetadataBytes.Hash("onoes-metadata-host-clock-context/v1",MetadataBytes.Slice(b,0,96)));
            return Parse(b);
        }
        internal static MetadataHostClockContext Parse(byte[] input){
            Need(input!=null && input.Length==WireBytes);var b=(byte[])input.Clone();
            Need(b[0]==79 && b[1]==77 && b[2]==75 && b[3]==49);
            MetadataBytes.DigestCopy(MetadataBytes.Slice(b,4,32));MetadataBytes.DigestCopy(MetadataBytes.Slice(b,64,32));
            ulong origin=MetadataBytes.Number(b,36,8),frequency=MetadataBytes.Number(b,44,8),work=MetadataBytes.Number(b,52,4);
            Need(origin>0 && origin<=Int64.MaxValue && frequency>0 && frequency<=Int64.MaxValue && work>=1 && work<=25000);
            Need(MetadataBytes.Number(b,56,4)==work+5000 && MetadataBytes.Number(b,60,4)==work+10000);
            Need(MetadataBytes.Same(MetadataBytes.Slice(b,96,32),MetadataBytes.Hash("onoes-metadata-host-clock-context/v1",MetadataBytes.Slice(b,0,96))));
            return new MetadataHostClockContext(b);
        }
        // Expected values must originate outside this wire. Same bytes or a
        // matching checksum alone cannot establish host/boot or peer identity.
        internal void Match(byte[] reference,byte[] hostSession,byte[] nonce,int work){
            var r=MetadataBytes.DigestCopy(reference);var h=MetadataBytes.DigestCopy(hostSession);var n=MetadataBytes.DigestCopy(nonce);
            Need(work==WorkMs && MetadataBytes.Same(r,Reference()) &&
                MetadataBytes.Same(h,MetadataBytes.Slice(wire,64,32)) && MetadataBytes.Same(n,Nonce));
        }
    }
}
