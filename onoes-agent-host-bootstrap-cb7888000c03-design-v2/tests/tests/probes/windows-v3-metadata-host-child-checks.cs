// COMPILE ONLY. Trusted-child local prerequisite composition, not authentication.
// No public raw-handle parser, process creation, resume, channel I/O or readiness.
using System;using System.Threading;using Microsoft.Win32.SafeHandles;
namespace Onoes.MetadataExperiment {
    internal static class MetadataHostChildChecks {
        static readonly int[] attempts=new int[4];
        // Expected role/nonce/work and original clock must come from the existing
        // authenticated same-host startup path, NEVER from the endpoints themselves.
        // Caller retains ownership and must dispose its endpoints on any failure.
        internal static void CheckInTrustedChild(HostActor role,SafePipeHandle[] supplied,
            MetadataHostRunClock original,byte[] expectedNonce,int expectedWork){
            var ends=HostInheritancePolicy.Ends(role);
            if(Interlocked.CompareExchange(ref attempts[(int)role-1],1,0)!=0)
                throw new InvalidOperationException("host-child-checks-used");
            SafePipeHandle[] pipes=null;bool[] held=null;
            HostChildChannelPolicy policy=null;
            try{
                if(original==null||supplied==null||supplied.Length!=ends.Length||expectedNonce==null||expectedNonce.Length!=32)
                    throw new InvalidOperationException("host-child-checks-input");
                var nonce=(byte[])expectedNonce.Clone();pipes=(SafePipeHandle[])supplied.Clone();held=new bool[pipes.Length];
                original.RequireRun(nonce,expectedWork);policy=new HostChildChannelPolicy(role,expectedWork);
                // Retain the complete list before querying/mutating its first slot.
                // Caller disposal cannot recycle a later slot during this sequence.
                for(int i=0;i<pipes.Length;i++){
                    if(pipes[i]==null)throw new InvalidOperationException("host-child-checks-input");
                    pipes[i].DangerousAddRef(ref held[i]);
                    for(int j=0;j<i;j++)if(pipes[j].DangerousGetHandle()==pipes[i].DangerousGetHandle())
                        throw new InvalidOperationException("host-child-checks-alias");
                }
                for(int i=0;i<pipes.Length;i++)MetadataHostChildLocal.ClearAndMeasure(pipes[i],ends[i],original,policy);
                original.RequireRun(nonce,expectedWork);
                policy.Finish(original.ReadElapsedMilliseconds());
                policy.RequireLocallyChecked(original.ReadElapsedMilliseconds());
            }catch{
                if(policy!=null)policy.Close();
                // A partial local failure cannot be repaired by a new policy/clock
                // over the same run. Denial does not claim handle cleanup or stop.
                if(original!=null)original.Invalidate();throw;
            }finally{
                if(held!=null)for(int i=held.Length-1;i>=0;i--)if(held[i])pipes[i].DangerousRelease();
            }
        }
    }
}
