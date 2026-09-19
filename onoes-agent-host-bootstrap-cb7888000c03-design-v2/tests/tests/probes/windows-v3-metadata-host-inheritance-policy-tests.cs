using System;using Onoes.MetadataExperiment;
internal static class HostInheritanceTests {
    static int checks;
    static void Need(bool ok){checks++;if(!ok)throw new Exception("inheritance-check");}
    static void Deny(Action action){try{action();}catch(InvalidOperationException){checks++;return;}throw new Exception("inheritance-denial");}
    static int Main(){
        int[,] expected={{1,2,3,-4,-5,-6},{-1,4,0,0,0,0},{-2,5,0,0,0,0},{-3,6,0,0,0,0}};
        var readers=new int[7];var writers=new int[7];
        for(int r=1;r<=4;r++){
            var role=(HostActor)r;var ends=HostInheritancePolicy.Ends(role);Need(ends.Length==(r==1?6:2));
            for(int i=0;i<ends.Length;i++){int e=ends[i];Need(e==expected[r-1,i]);if(e>0)readers[e]++;else writers[-e]++;}
            ends[0]=99;Need(HostInheritancePolicy.Ends(role)[0]==expected[r-1,0]);
            foreach(int work in new[]{1,2,100,4999,5000,5001,25000}){
                int deadline=Math.Min(work,5000);var p=new HostInheritancePolicy(role,work);
                Need(p.MayRelease&&!p.MustRetain);p.Prepared(0);p.BeginBorrow(deadline-1);
                Need(p.MustRetain&&!p.MayRelease);p.Close();Need(p.MustRetain);
                p.EndBorrow();Need(p.MayRelease&&p.Closed);Deny(()=>p.EndBorrow());Deny(()=>p.BeginBorrow(0));
                var late=new HostInheritancePolicy(role,work);late.Prepared(0);Deny(()=>late.BeginBorrow(deadline));Need(late.Closed&&late.MayRelease);
                var twice=new HostInheritancePolicy(role,work);twice.Prepared(0);twice.BeginBorrow(0);Deny(()=>twice.BeginBorrow(0));Need(twice.MustRetain);twice.EndBorrow();Need(twice.MayRelease);
            }
            for(int cut=0;cut<3;cut++){
                var p=new HostInheritancePolicy(role,100);if(cut>0)p.Prepared(0);if(cut>1)p.BeginBorrow(1);p.Close();
                Need(p.MustRetain==(cut==2));Deny(()=>p.Prepared(2));Deny(()=>p.BeginBorrow(2));
                if(cut==2){p.EndBorrow();Need(p.MayRelease);}else Deny(()=>p.EndBorrow());
            }
            var order=new HostInheritancePolicy(role,100);Deny(()=>order.BeginBorrow(0));Need(order.Closed&&order.MayRelease);
            var repeat=new HostInheritancePolicy(role,100);repeat.Prepared(1);Deny(()=>repeat.Prepared(1));Need(repeat.Closed);
            var regress=new HostInheritancePolicy(role,100);regress.Prepared(2);Deny(()=>regress.BeginBorrow(1));Need(regress.Closed);
            var negative=new HostInheritancePolicy(role,100);Deny(()=>negative.Prepared(-1));Need(negative.MayRelease);
        }
        for(int route=1;route<=6;route++){Need(readers[route]==1);Need(writers[route]==1);}
        foreach(int role in new[]{-1,0,5,int.MaxValue})Deny(()=>HostInheritancePolicy.Ends((HostActor)role));
        foreach(int work in new[]{-1,0,25001,int.MaxValue})Deny(()=>new HostInheritancePolicy(HostActor.Guard,work));
        Console.WriteLine("{\"kind\":\"host-inheritance-pure-policy\",\"checks\":"+checks+",\"nativeCases\":\"NOT_RUN\"}");return 0;
    }
}
