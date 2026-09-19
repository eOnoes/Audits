using System;using Onoes.MetadataExperiment;
internal static class HostChildPolicyTests {
    static int checks;
    static void Need(bool ok){checks++;if(!ok)throw new Exception("child-policy-check");}
    static void Deny(Action action){try{action();}catch(InvalidOperationException){checks++;return;}throw new Exception("child-policy-denial");}
    static HostChildChannelPolicy New(HostActor role){return new HostChildChannelPolicy(role,100);}
    static void Prefix(HostChildChannelPolicy p,int[] ends,int count){
        for(int i=0;i<count;i++){p.BeforeClear(ends[i],i+100,3,1,0);p.AfterClear(i+100,true,3,0,0);}
    }
    static int Main(){
        for(int end=-6;end<=6;end++){
            if(end==0)continue;
            uint expected=end>0?0x00120089U:0x00120082U;
            Need(HostInheritancePolicy.AccessForEnd(end)==expected);
            HostInheritancePolicy.RequireAccess(end,expected);
            for(int bit=0;bit<32;bit++){
                uint changed=expected^(1U<<bit);
                Deny(()=>HostInheritancePolicy.RequireAccess(end,changed));
            }
            Deny(()=>HostInheritancePolicy.RequireAccess(end,end>0?0x00120082U:0x00120089U));
            Deny(()=>HostInheritancePolicy.RequireAccess(end,0));
            Deny(()=>HostInheritancePolicy.RequireAccess(end,uint.MaxValue));
        }
        foreach(int end in new[]{int.MinValue,-7,0,7,int.MaxValue})Deny(()=>HostInheritancePolicy.AccessForEnd(end));
        for(int r=1;r<=4;r++){
            var role=(HostActor)r;var ends=HostInheritancePolicy.Ends(role);
            foreach(int work in new[]{1,2,100,4999,5000,5001,25000}){
                var p=new HostChildChannelPolicy(role,work);Prefix(p,ends,ends.Length);
                Need(!p.LocallyChecked);p.Finish(Math.Min(work,5000)-1);Need(p.LocallyChecked);
                p.RequireLocallyChecked(Math.Min(work,5000)-1);
                Deny(()=>p.RequireLocallyChecked(Math.Min(work,5000)));Need(p.Closed&&!p.LocallyChecked);
            }
            for(int slot=0;slot<ends.Length;slot++){
                int i=slot;long token=i+100;
                for(int mutation=0;mutation<10;mutation++){
                    var p=New(role);Prefix(p,ends,i);
                    switch(mutation){
                        case 0:Deny(()=>p.BeforeClear(-ends[i],token,3,1,0));break;
                        case 1:Deny(()=>p.BeforeClear(ends[i],0,3,1,0));break;
                        case 2:Deny(()=>p.BeforeClear(ends[i],-1,3,1,0));break;
                        case 3:Deny(()=>p.BeforeClear(ends[i],token,1,1,0));break;
                        case 4:Deny(()=>p.BeforeClear(ends[i],token,3,0,0));break;
                        case 5:Deny(()=>p.BeforeClear(ends[i],token,3,3,0));break;
                        case 6:Deny(()=>p.AfterClear(token,true,3,0,0));break;
                        case 7:Deny(()=>p.Finish(0));break;
                        case 8:Deny(()=>p.BeforeClear(ends[i],token,3,1,100));break;
                        default:Deny(()=>p.RequireLocallyChecked(0));break;
                    }
                    Need(p.Closed&&!p.LocallyChecked);Deny(()=>p.BeforeClear(ends[i],token,3,1,0));
                }
                for(int mutation=0;mutation<9;mutation++){
                    var p=New(role);Prefix(p,ends,i);p.BeforeClear(ends[i],token,3,1,1);
                    switch(mutation){
                        case 0:Deny(()=>p.AfterClear(token+1,true,3,0,1));break;
                        case 1:Deny(()=>p.AfterClear(token,false,3,0,1));break;
                        case 2:Deny(()=>p.AfterClear(token,true,1,0,1));break;
                        case 3:Deny(()=>p.AfterClear(token,true,3,1,1));break;
                        case 4:Deny(()=>p.AfterClear(token,true,3,2,1));break;
                        case 5:Deny(()=>p.AfterClear(token,true,3,0,100));break;
                        case 6:Deny(()=>p.AfterClear(token,true,3,0,0));break;
                        case 7:Deny(()=>p.BeforeClear(ends[i],token,3,1,1));break;
                        default:Deny(()=>p.Finish(1));break;
                    }
                    Need(p.Closed&&!p.LocallyChecked);Deny(()=>p.AfterClear(token,true,3,0,1));
                }
                if(i>0){var p=New(role);Prefix(p,ends,i);Deny(()=>p.BeforeClear(ends[i],100,3,1,0));Need(p.Closed);}
                var closed=New(role);Prefix(closed,ends,i);closed.Close();
                Deny(()=>closed.BeforeClear(ends[i],token,3,1,0));Need(!closed.LocallyChecked);
            }
            var done=New(role);Prefix(done,ends,ends.Length);done.Finish(0);
            Deny(()=>done.Finish(0));Need(!done.LocallyChecked);
            var extra=New(role);Prefix(extra,ends,ends.Length);extra.Finish(0);
            Deny(()=>extra.BeforeClear(ends[0],999,3,1,0));Need(extra.Closed);
            var badTime=New(role);Deny(()=>badTime.BeforeClear(ends[0],100,3,1,-1));Need(badTime.Closed);
            var pending=New(role);pending.BeforeClear(ends[0],100,3,1,0);pending.Close();
            Deny(()=>pending.AfterClear(100,true,3,0,0));Need(!pending.LocallyChecked);
        }
        foreach(int role in new[]{-1,0,5,int.MaxValue})Deny(()=>new HostChildChannelPolicy((HostActor)role,100));
        foreach(int work in new[]{-1,0,25001,int.MaxValue})Deny(()=>new HostChildChannelPolicy(HostActor.Controller,work));
        Console.WriteLine("{\"kind\":\"host-child-channel-pure-policy\",\"checks\":"+checks+",\"nativeCases\":\"NOT_RUN\"}");return 0;
    }
}
