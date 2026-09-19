// COMPILE ONLY. Only the private-constructor, same-process inert factory can
// supply these endpoints. This is NOT inherited/protected host admission.
using System;using Microsoft.Win32.SafeHandles;
namespace Onoes.MetadataExperiment {
    internal sealed partial class MetadataHostReadLane {
        internal static MetadataHostReadLane FromInertPair(MetadataHostInertPair pair){
            if(pair==null)throw new InvalidOperationException("host-read-pair");SafePipeHandle owned=pair.TakeReader();
            try{return new MetadataHostReadLane(owned,pair.Clock,pair.Route);}catch{owned.Dispose();throw;}
        }
    }
    internal sealed partial class MetadataHostWriteLane {
        internal static MetadataHostWriteLane FromInertPair(MetadataHostInertPair pair){
            if(pair==null)throw new InvalidOperationException("host-write-pair");SafePipeHandle owned=pair.TakeWriter();
            try{return new MetadataHostWriteLane(owned,pair.Clock,pair.Route);}catch{owned.Dispose();throw;}
        }
    }
}
