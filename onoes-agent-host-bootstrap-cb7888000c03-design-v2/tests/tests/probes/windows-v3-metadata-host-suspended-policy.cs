// Pure lifecycle accounting; fabricated observations are not OS settlement.
using System;
namespace Onoes.MetadataExperiment {
    internal sealed class HostSuspendedPolicy {
        readonly int deadline;long last,stopDeadline;bool createAttempt,createReturned,created,stopAttempt;
        internal bool Closed {get;private set;}
        internal bool StopConfirmed {get;private set;}
        internal bool Uncertain {get;private set;}
        internal bool MustRetain {get{return createAttempt&&!createReturned||created&&!StopConfirmed;}}
        internal bool StopAttempted {get{return stopAttempt;}}
        internal HostSuspendedPolicy(int work){if(work<1||work>25000)throw new InvalidOperationException("host-suspended-budget");deadline=Math.Min(work,5000);}
        void Need(bool ok){if(!ok){Closed=true;throw new InvalidOperationException("host-suspended-order");}}
        internal void BeginCreate(long now){Need(!Closed&&!createAttempt&&now>=last&&now>=0&&now<deadline);last=now;createAttempt=true;}
        internal void CreateReturned(bool success,long now){
            Need(createAttempt&&!createReturned);createReturned=true;created=success;
            if(now<last||now>=deadline){Closed=true;Uncertain=true;}else last=now;
            if(!success)Closed=true;
        }
        internal void RequirePrepared(long now){Need(!Closed&&createReturned&&created&&!stopAttempt&&now>=last&&now<deadline);last=now;}
        internal void BeginStop(long now){
            Need(createReturned&&created&&!stopAttempt);Closed=true;stopAttempt=true;
            // A broken original clock cannot erase stop obligation, but cannot
            // supply a deadline or a timely settlement claim either.
            if(now<last||now<0||now>long.MaxValue-1000){Uncertain=true;stopDeadline=0;}
            else{last=now;stopDeadline=now+1000;}
        }
        internal void ObserveStop(uint wait,uint active,long now){
            Need(stopAttempt);if(Uncertain)return;
            if(now<last||now>=stopDeadline||(wait!=0&&wait!=258)){Uncertain=true;return;}
            last=now;if(wait==0&&active==0)StopConfirmed=true;
        }
        internal void Deny(){Closed=true;}
        internal void Unknown(){Closed=true;Uncertain=true;}
    }
}
