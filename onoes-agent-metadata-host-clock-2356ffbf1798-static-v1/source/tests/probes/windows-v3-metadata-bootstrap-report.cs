// Pure outer observation framing. No permit, authenticated claim or stop proof.
using System;
namespace Onoes.MetadataExperiment {
    internal enum MetadataBootstrapFailure { None=0,Provision=1,Setup=2,Startup=3,Case=4,Cleanup=5,Deadline=6 }
    internal static class MetadataBootstrapReport {
        internal const int WireBytes=384;
        const int CoreBytes=352;
        static void Need(bool ok){if(!ok)throw new InvalidOperationException("metadata-bootstrap-report");}
        static bool Zero(byte[] b,int at,int length){int all=0;for(int i=at;i<at+length;i++)all|=b[i];return all==0;}
        // Independent replay of each possible monotonic transition prefix.
        static bool Prefix(int[] masks,int roles){
            var expected=new int[masks.Length];
            for(int step=0;step<=roles*masks.Length;step++){
                bool same=true;for(int i=0;i<masks.Length;i++)same&=masks[i]==expected[i];if(same)return true;
                if(step<roles*masks.Length)expected[step%masks.Length]|=1<<(step/masks.Length);
            }return false;
        }
        internal static byte[] Encode(byte[] nonce,byte[] bundle,string fixture,long elapsed,MetadataBootstrapFailure failure,
            MetadataProvisionSnapshot provision,MetadataSetupSnapshot setup,MetadataStartSnapshot startup,byte[] caseReport,MetadataCaseCleanup cleanup){
            Need(elapsed>=0 && failure>=MetadataBootstrapFailure.None && failure<=MetadataBootstrapFailure.Deadline);
            Need(cleanup>=MetadataCaseCleanup.NotObserved && cleanup<=MetadataCaseCleanup.DisposalThrew);
            nonce=MetadataBytes.DigestCopy(nonce);bundle=MetadataBytes.DigestCopy(bundle);byte[] image=MetadataBytes.Hex(fixture);
            var b=new byte[WireBytes];b[0]=79;b[1]=77;b[2]=66;b[3]=49;b[4]=1; // OMB1
            b[5]=(byte)((provision!=null?1:0)|(setup!=null?2:0)|(startup!=null?4:0)|(caseReport!=null?8:0)|(elapsed>=30000?16:0));
            if(elapsed>=30000 && failure==MetadataBootstrapFailure.None)failure=MetadataBootstrapFailure.Deadline;
            b[6]=(byte)failure;b[7]=(byte)cleanup;MetadataBytes.Number(b,8,(ulong)Math.Min(elapsed,30000),4);
            if(provision!=null){
                Need(Prefix(new[]{provision.Attempted,provision.Created,provision.Verified},9));
                MetadataBytes.Number(b,12,(ulong)provision.Attempted,2);MetadataBytes.Number(b,14,(ulong)provision.Created,2);MetadataBytes.Number(b,16,(ulong)provision.Verified,2);
                b[18]=(byte)((provision.Uncertain?1:0)|(provision.Finished?2:0));
            }
            if(setup!=null){Need(Prefix(new[]{setup.Attempted,setup.Created,setup.Verified},3));b[20]=(byte)setup.Attempted;b[21]=(byte)setup.Created;b[22]=(byte)setup.Verified;b[23]=(byte)(setup.Uncertain?1:0);}
            if(startup!=null){
                Need(Prefix(new[]{startup.EnableAttempted,startup.Enabled,startup.StartAttempted,startup.StartReturned,startup.Observed},3));
                b[24]=(byte)startup.EnableAttempted;b[25]=(byte)startup.Enabled;b[26]=(byte)startup.StartAttempted;b[27]=(byte)startup.StartReturned;b[28]=(byte)startup.Observed;
                b[29]=(byte)((startup.Uncertain?1:0)|(startup.Finished?2:0)|(startup.Transferred?4:0));
            }
            MetadataBytes.Put(b,32,MetadataBytes.Hash("onoes-metadata-report-run/v1",nonce));MetadataBytes.Put(b,64,bundle);MetadataBytes.Put(b,96,image);
            if(caseReport!=null)MetadataBytes.Put(b,128,MetadataCaseReport.Validate(caseReport,nonce,bundle,fixture));
            MetadataBytes.Put(b,CoreBytes,MetadataBytes.Hash("onoes-metadata-bootstrap-report/v1",MetadataBytes.Slice(b,0,CoreBytes)));
            return Validate(b,nonce,bundle,fixture);
        }
        internal static byte[] Validate(byte[] supplied,byte[] nonce,byte[] bundle,string fixture){
            Need(supplied!=null && supplied.Length==WireBytes);var b=(byte[])supplied.Clone();
            nonce=MetadataBytes.DigestCopy(nonce);bundle=MetadataBytes.DigestCopy(bundle);byte[] image=MetadataBytes.Hex(fixture);
            Need(b[0]==79 && b[1]==77 && b[2]==66 && b[3]==49 && b[4]==1 && b[5]<=31 && b[6]<=6 && b[7]<=2);
            Need(MetadataBytes.Same(MetadataBytes.Slice(b,CoreBytes,32),MetadataBytes.Hash("onoes-metadata-bootstrap-report/v1",MetadataBytes.Slice(b,0,CoreBytes))));
            Need(MetadataBytes.Same(MetadataBytes.Slice(b,32,32),MetadataBytes.Hash("onoes-metadata-report-run/v1",nonce)) &&
                MetadataBytes.Same(MetadataBytes.Slice(b,64,32),bundle) && MetadataBytes.Same(MetadataBytes.Slice(b,96,32),image));
            int flags=b[5];ulong elapsed=MetadataBytes.Number(b,8,4);Need(elapsed<=30000 && ((flags&16)!=0)==(elapsed==30000));
            Need(b[19]==0 && Zero(b,30,2) && b[18]<=3 && b[23]<=1 && b[29]<=7);
            int pa=(int)MetadataBytes.Number(b,12,2),pc=(int)MetadataBytes.Number(b,14,2),pv=(int)MetadataBytes.Number(b,16,2);
            Need(Prefix(new[]{pa,pc,pv},9) && Prefix(new[]{(int)b[20],(int)b[21],(int)b[22]},3) &&
                Prefix(new[]{(int)b[24],(int)b[25],(int)b[26],(int)b[27],(int)b[28]},3));
            if((flags&1)==0)Need(Zero(b,12,7));if((b[18]&2)!=0)Need(pv==511);
            if((flags&2)==0)Need(Zero(b,20,4));else Need((flags&1)!=0 && b[18]==2 && pv==511);
            if((flags&4)==0)Need(Zero(b,24,6));else Need((flags&2)!=0 && b[22]==7 && b[23]==0);
            if((b[29]&2)!=0)Need(b[28]==7);if((b[29]&4)!=0)Need((b[29]&2)!=0);
            if((flags&8)==0)Need(Zero(b,128,224));else{
                Need((flags&4)!=0 && (b[29]&2)!=0 && b[28]==7);
                byte[] nested=MetadataCaseReport.Validate(MetadataBytes.Slice(b,128,224),nonce,bundle,fixture);
                Need(MetadataBytes.Number(nested,8,4)<=elapsed);
            }
            if(b[6]==0)Need(flags==15 && b[7]==1 && b[29]==6 && b[135]==0);
            return b; // independent copy of claims, never a successful physical verdict
        }
    }
}
