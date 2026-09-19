// Pure fixed host-code pins and bounded stream snapshot; no load or native call.
using System;
using System.IO;
using System.Security.Cryptography;
namespace Onoes.MetadataExperiment {
    internal enum MetadataHostCodeRole { RetentionLibrary=1, WatchdogCore=2, WatchdogWrapper=3 }
    internal sealed class MetadataHostCodePin {
        internal readonly string Leaf;internal readonly int ByteLength;readonly byte[] digest;
        static void Need(bool ok){if(!ok)throw new InvalidOperationException("metadata-host-code-unavailable");}
        internal MetadataHostCodePin(MetadataHostCodeRole role,int length,byte[] sha256){
            switch(role){
                case MetadataHostCodeRole.RetentionLibrary:Leaf="host-report-sink.dll";break;
                case MetadataHostCodeRole.WatchdogCore:Leaf="windows-v3-metadata-watchdog.ps1";break;
                case MetadataHostCodeRole.WatchdogWrapper:Leaf="windows-v3-metadata-retained-watchdog.ps1";break;
                default:throw new InvalidOperationException("metadata-host-code-unavailable");
            }
            Need(length>0 && length<=(role==MetadataHostCodeRole.RetentionLibrary?4194304:131072));
            Need(sha256!=null && sha256.Length==32);digest=(byte[])sha256.Clone();
            bool nonzero=false;foreach(byte b in digest)nonzero|=b!=0;Need(nonzero);ByteLength=length;
        }
        internal static void Time(MetadataHostRunClock original,long deadline){
            try{Need(original!=null && deadline>=1 && deadline<=original.WorkMs);original.RequireBefore(deadline);}
            catch{throw new InvalidOperationException("metadata-host-code-unavailable");}
        }
        // Stream is trusted-owner input. Native owner separately verifies its
        // type/name/security/identity/streams before and after this exact read.
        internal byte[] ReadChecked(Stream stream,MetadataHostRunClock original,long deadline){
            byte[] bytes=null;bool returned=false;
            try{
                Time(original,deadline);Need(stream!=null && stream.CanRead && stream.CanSeek);
                Need(stream.Length==ByteLength);stream.Position=0;Time(original,deadline);
                bytes=new byte[ByteLength];int at=0;
                while(at<bytes.Length){Time(original,deadline);int remaining=Math.Min(4096,bytes.Length-at);
                    int n=stream.Read(bytes,at,remaining);Need(n>0 && n<=remaining);at+=n;Time(original,deadline);}
                Need(stream.ReadByte()==-1 && stream.Length==ByteLength);Time(original,deadline);
                using(var sha=SHA256.Create()){
                    var actual=sha.ComputeHash(bytes);int difference=0;for(int i=0;i<32;i++)difference|=actual[i]^digest[i];
                    Array.Clear(actual,0,actual.Length);Need(difference==0);
                }
                Time(original,deadline);returned=true;return bytes;
            }catch{throw new InvalidOperationException("metadata-host-code-unavailable");}
            finally{if(!returned && bytes!=null)Array.Clear(bytes,0,bytes.Length);}
        }
    }
}
