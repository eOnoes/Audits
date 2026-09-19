// Pure fixed identity pins, separated from fabricated/observed peer samples.
using System;
using System.Globalization;

namespace Onoes.MetadataExperiment {
    internal sealed class PeerPin {
        internal readonly FixtureRole Role;
        internal readonly string Service, UserSid, Image, TokenProfile;
        internal PeerPin(FixtureRole role,string sid,string tokenProfile) {
            string name=ServiceName(role);
            if(!MetadataPinSyntax.IsServiceSid(sid) || !MetadataPinSyntax.IsDigest(tokenProfile))
                throw new InvalidOperationException("peer-pin-invalid");
            Role=role; Service=name; UserSid=sid; TokenProfile=tokenProfile;
            Image=@"C:\OnoesTest\v3-metadata-01\"+name+".exe";
        }
        internal static string ServiceName(FixtureRole role) {
            switch(role) {
                case FixtureRole.Coordinator: return "OnoesMetadataCoordinator01";
                case FixtureRole.Anchor: return "OnoesMetadataAnchor01";
                case FixtureRole.Supervisor: return "OnoesMetadataSupervisor01";
                default: throw new InvalidOperationException("peer-role-invalid");
            }
        }
    }
    internal static class MetadataPinSyntax {
        internal static bool IsDigest(string value) {
            if(value==null || value.Length!=64) return false;
            foreach(char c in value) if(!((c>='0' && c<='9') || (c>='a' && c<='f'))) return false;
            return true;
        }
        internal static bool IsServiceSid(string value) {
            if(value==null || value.Length>68) return false;
            string[] parts=value.Split('-');
            if(parts.Length!=9 || parts[0]!="S" || parts[1]!="1" || parts[2]!="5" || parts[3]!="80") return false;
            for(int i=4;i<9;i++) {
                uint part;
                if(!UInt32.TryParse(parts[i],NumberStyles.None,CultureInfo.InvariantCulture,out part) ||
                    part.ToString(CultureInfo.InvariantCulture)!=parts[i]) return false;
            }
            return true;
        }
    }
}
