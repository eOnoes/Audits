using System;using Onoes.MetadataExperiment;
internal static class HostSuspendedTests {
    static int checks;
    static void Need(bool value){checks++;if(!value)throw new Exception("suspended-check");}
    static void Deny(Action action){try{action();}catch(InvalidOperationException){checks++;return;}throw new Exception("suspended-denial");}
    static HostSuspendedPolicy Made(){var p=new HostSuspendedPolicy(100);p.BeginCreate(0);p.CreateReturned(true,1);return p;}
    static int Main(){
        foreach(int work in new[]{1,2,100,4999,5000,5001,25000}){
            int deadline=Math.Min(work,5000);
            var p=new HostSuspendedPolicy(work);Need(!p.MustRetain);p.BeginCreate(0);Need(p.MustRetain);
            p.CreateReturned(true,0);p.RequirePrepared(deadline-1);Need(p.MustRetain&&!p.Closed);
            p.BeginStop(deadline);Need(p.StopAttempted&&p.Closed&&!p.StopConfirmed);
            p.ObserveStop(258,1,deadline);Need(!p.StopConfirmed);
            p.ObserveStop(0,1,deadline+1);Need(!p.StopConfirmed);
            p.ObserveStop(258,0,deadline+2);Need(!p.StopConfirmed);
            p.ObserveStop(0,0,deadline+3);Need(p.StopConfirmed&&!p.MustRetain&&!p.Uncertain);
            Deny(()=>p.BeginCreate(0));Deny(()=>p.BeginStop(deadline+4));
            var late=new HostSuspendedPolicy(work);late.BeginCreate(0);late.CreateReturned(true,deadline);
            Need(late.Uncertain&&late.Closed&&late.MustRetain);late.BeginStop(deadline);late.ObserveStop(0,0,deadline);Need(!late.StopConfirmed&&late.MustRetain);
            var failed=new HostSuspendedPolicy(work);failed.BeginCreate(0);failed.CreateReturned(false,0);Need(failed.Closed&&!failed.MustRetain&&!failed.StopConfirmed);Deny(()=>failed.BeginCreate(0));
            var expiry=new HostSuspendedPolicy(work);Deny(()=>expiry.BeginCreate(deadline));Need(expiry.Closed&&!expiry.MustRetain);
        }
        foreach(long now in new[]{-1L,0L,long.MaxValue}){
            var p=Made();p.BeginStop(now);Need(p.StopAttempted&&p.Uncertain&&p.MustRetain);p.ObserveStop(0,0,2);Need(!p.StopConfirmed);
        }
        foreach(uint wait in new uint[]{1,257,259,uint.MaxValue}){
            var p=Made();p.BeginStop(2);p.ObserveStop(wait,0,3);Need(p.Uncertain&&!p.StopConfirmed&&p.MustRetain);
        }
        foreach(long now in new[]{-1L,1L,1002L,long.MaxValue}){
            var p=Made();p.BeginStop(2);p.ObserveStop(0,0,now);Need(p.Uncertain&&!p.StopConfirmed);p.ObserveStop(0,0,3);Need(!p.StopConfirmed);
        }
        for(int cut=0;cut<4;cut++){
            var p=new HostSuspendedPolicy(100);if(cut>0)p.BeginCreate(0);if(cut>1)p.CreateReturned(true,1);if(cut>2)p.BeginStop(2);
            p.Deny();Need(p.Closed&&p.MustRetain==(cut>0));Deny(()=>p.BeginCreate(3));
            if(cut==2){p.BeginStop(3);p.ObserveStop(0,0,4);Need(p.StopConfirmed);}
        }
        var before=new HostSuspendedPolicy(100);Deny(()=>before.CreateReturned(true,0));Need(before.Closed&&!before.StopConfirmed);
        var twice=Made();Deny(()=>twice.CreateReturned(true,2));Need(twice.Closed&&twice.MustRetain);
        var pending=new HostSuspendedPolicy(100);pending.BeginCreate(0);Deny(()=>pending.RequirePrepared(1));Need(pending.MustRetain);
        var notMade=new HostSuspendedPolicy(100);Deny(()=>notMade.BeginStop(0));Need(!notMade.StopConfirmed);
        var unknown=Made();unknown.Unknown();unknown.BeginStop(2);unknown.ObserveStop(0,0,3);Need(unknown.Uncertain&&!unknown.StopConfirmed);
        var deniedDuringCall=new HostSuspendedPolicy(100);deniedDuringCall.BeginCreate(0);deniedDuringCall.Deny();
        Need(deniedDuringCall.MustRetain);deniedDuringCall.CreateReturned(true,1);Deny(()=>deniedDuringCall.RequirePrepared(2));
        deniedDuringCall.BeginStop(2);deniedDuringCall.ObserveStop(0,0,3);Need(deniedDuringCall.StopConfirmed);
        var expiredPrepared=Made();Deny(()=>expiredPrepared.RequirePrepared(100));Need(expiredPrepared.MustRetain);
        expiredPrepared.BeginStop(100);expiredPrepared.ObserveStop(0,0,101);Need(expiredPrepared.StopConfirmed);
        var pendingReturn=new HostSuspendedPolicy(100);pendingReturn.BeginCreate(0);pendingReturn.Unknown();
        Need(pendingReturn.MustRetain);pendingReturn.CreateReturned(true,1);pendingReturn.BeginStop(2);pendingReturn.ObserveStop(0,0,3);
        Need(pendingReturn.Uncertain&&!pendingReturn.StopConfirmed&&pendingReturn.MustRetain);
        foreach(int work in new[]{-1,0,25001,int.MaxValue})Deny(()=>new HostSuspendedPolicy(work));
        Console.WriteLine("{\"kind\":\"host-suspended-pure-policy\",\"checks\":"+checks+",\"nativeCases\":\"NOT_RUN\"}");return 0;
    }
}
