// TEST-ONLY fixed M04 observation report. Structural claims only, never PASS,
// independent evidence, authorization, physical custody or observer-stop proof.
using System;

namespace Onoes.MetadataExperiment {
    internal enum MetadataCaseFailure { None=0,Configuration=1,Preparation=2,Readiness=3,Dispatch=4,Protocol=5,Stop=6,Roots=7,Cleanup=8,Deadline=9 }
    internal enum MetadataCaseCleanup { NotObserved=0,DisposalReturned=1,DisposalThrew=2 }
    internal static class MetadataCaseReport {
        internal const int WireBytes=224;
        const int CoreBytes=192;
        static void Need(bool value) { if(!value) throw new InvalidOperationException("metadata-case-report"); }
        static bool Zero(byte[] bytes,int start,int length) { int any=0;for(int i=start;i<start+length;i++) any|=bytes[i];return any==0; }
        static int Controls(MetadataControlSnapshot value) {
            Need(value!=null);return (value.PrepareAttempted?1:0)|(value.PrepareReturned?2:0)|(value.DispatchAttempted?4:0)|
                (value.DispatchReturned?8:0)|(value.StopAttempted?16:0)|(value.StopReturned?32:0)|(value.Uncertain?64:0);
        }
        internal static byte[] Encode(byte[] runNonce,byte[] bundleDigest,string fixtureDigest,string configurationDigest,
            long elapsedMs,bool prepared,bool dispatched,bool protocolCompleted,MetadataCaseFailure failure,
            MetadataServiceJobSnapshot job,MetadataRootExitObservation[] roots,MetadataControlSnapshot[] controls,MetadataCaseCleanup cleanup=MetadataCaseCleanup.NotObserved) {
            byte[] nonce=MetadataBytes.DigestCopy(runNonce),bundle=MetadataBytes.DigestCopy(bundleDigest),fixture=MetadataBytes.Hex(fixtureDigest);
            Need(elapsedMs>=0 && failure>=MetadataCaseFailure.None && failure<=MetadataCaseFailure.Deadline);
            Need(cleanup>=MetadataCaseCleanup.NotObserved && cleanup<=MetadataCaseCleanup.DisposalThrew);
            Need((roots==null || roots.Length==3) && (controls==null || controls.Length==3));
            if(roots!=null) roots=(MetadataRootExitObservation[])roots.Clone();if(controls!=null) controls=(MetadataControlSnapshot[])controls.Clone();
            var wire=new byte[WireBytes];wire[0]=79;wire[1]=77;wire[2]=81;wire[3]=49;wire[4]=1;wire[5]=5; // OMQ1, v1, M04
            wire[6]=(byte)((configurationDigest!=null?1:0)|(prepared?2:0)|(dispatched?4:0)|(protocolCompleted?8:0)|
                (job!=null?16:0)|(roots!=null?32:0)|(controls!=null?64:0)|(elapsedMs>=30000?128:0));
            if(elapsedMs>=30000 && failure==MetadataCaseFailure.None) failure=MetadataCaseFailure.Deadline;
            wire[7]=(byte)failure;MetadataBytes.Number(wire,8,(ulong)Math.Min(elapsedMs,30000),4);
            wire[12]=(byte)cleanup; // local Dispose return/throw, never all-objects-released
            if(configurationDigest!=null) MetadataBytes.Put(wire,16,MetadataBytes.Hex(configurationDigest));
            MetadataBytes.Put(wire,48,bundle);MetadataBytes.Put(wire,80,fixture);
            MetadataBytes.Put(wire,112,MetadataBytes.Hash("onoes-metadata-report-run/v1",nonce));
            if(job!=null) wire[144]=(byte)((job.AllAttached?1:0)|(job.StopRequested?2:0)|(job.KillAttempted?4:0)|(job.StopConfirmed?8:0)|(job.Uncertain?16:0));
            for(int i=0;i<3;i++) {
                if(roots!=null) { Need(roots[i]!=null);wire[148+i*4]=(byte)roots[i].Kind;wire[149+i*4]=(byte)(roots[i].PriorUncertainty?1:0); }
                if(controls!=null) wire[160+i*4]=(byte)Controls(controls[i]);
            }
            MetadataBytes.Put(wire,CoreBytes,MetadataBytes.Hash("onoes-metadata-case-report/v1",MetadataBytes.Slice(wire,0,CoreBytes)));
            Validate(wire,nonce,bundle,fixtureDigest);return wire;
        }
        internal static byte[] Validate(byte[] supplied,byte[] expectedNonce,byte[] expectedBundle,string expectedFixture) {
            Need(supplied!=null && supplied.Length==WireBytes);var wire=(byte[])supplied.Clone();
            byte[] nonce=MetadataBytes.DigestCopy(expectedNonce),bundle=MetadataBytes.DigestCopy(expectedBundle),fixture=MetadataBytes.Hex(expectedFixture);
            Need(wire[0]==79 && wire[1]==77 && wire[2]==81 && wire[3]==49 && wire[4]==1 && wire[5]==5 && wire[7]<=9);
            Need(MetadataBytes.Same(MetadataBytes.Slice(wire,CoreBytes,32),MetadataBytes.Hash("onoes-metadata-case-report/v1",MetadataBytes.Slice(wire,0,CoreBytes))));
            Need(wire[12]<=2 && Zero(wire,13,3) && Zero(wire,145,3) && Zero(wire,172,20));
            Need(MetadataBytes.Same(MetadataBytes.Slice(wire,48,32),bundle) && MetadataBytes.Same(MetadataBytes.Slice(wire,80,32),fixture) &&
                MetadataBytes.Same(MetadataBytes.Slice(wire,112,32),MetadataBytes.Hash("onoes-metadata-report-run/v1",nonce)));
            int flags=wire[6];ulong elapsed=MetadataBytes.Number(wire,8,4);
            Need(elapsed<=30000 && ((flags&128)!=0)==(elapsed==30000));
            Need(((flags&1)==0)==Zero(wire,16,32));
            Need((flags&2)==0 || (flags&1)!=0);Need((flags&4)==0 || (flags&2)!=0);Need((flags&8)==0 || (flags&4)!=0);
            int j=wire[144];Need(j<=31);if((flags&16)==0) Need(j==0);
            Need((j&4)==0 || (j&2)!=0);Need((j&8)==0 || (j&3)==3);
            for(int i=0;i<3;i++) {
                int at=148+i*4;Need(wire[at]<=4 && wire[at+1]<=1 && Zero(wire,at+2,2));if((flags&32)==0) Need(Zero(wire,at,4));
                if((flags&32)!=0 && (j&8)!=0) Need(wire[at]!=0);
                at=160+i*4;int c=wire[at];Need(c<=127 && Zero(wire,at+1,3));if((flags&64)==0) Need(c==0);
                Need((c&2)==0 || (c&1)!=0);Need((c&4)==0 || (c&2)!=0);Need((c&8)==0 || (c&4)!=0);Need((c&32)==0 || (c&16)!=0);
                if((flags&64)!=0 && (flags&2)!=0) Need((c&3)==3);
                if((flags&64)!=0 && (flags&4)!=0) Need((c&12)==12);
            }
            if(wire[7]==0) {
                // "No recorded failure" is internally coherent only when every
                // prerequisite claim is present. Even this is NOT a passed case.
                Need(flags==127 && j==11 && wire[12]==1);
                for(int i=0;i<3;i++) Need(wire[148+i*4]==1 && wire[149+i*4]==0 && wire[160+i*4]==63);
            }
            return wire; // independent copy; no trusted provenance or permit
        }
    }
}
