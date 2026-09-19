// HOST COMPILE ONLY. Owns selected startup inputs, not a loader or bootstrap trust.
// Native holds have no caller-supplied factory; tests use a separate link closure.
using System;
namespace Onoes.MetadataExperiment {
    internal sealed class MetadataHostCodeSet : IDisposable {
        readonly object gate=new object();readonly MetadataHostRunClock clock;readonly int workMs;
        readonly MetadataHostReportSink.HostCodeReadHold[] holds=new MetadataHostReportSink.HostCodeReadHold[3];
        readonly byte[][] bytes=new byte[3][];readonly bool[] taken=new bool[3];
        bool ready,closed,poisoned;
        static void Need(bool value){if(!value)throw new InvalidOperationException("metadata-host-code-set-unavailable");}
        MetadataHostCodeSet(MetadataHostRunClock original,int work){clock=original;workMs=work;}
        static int Index(MetadataHostCodeRole role){int index=(int)role-1;Need(index>=0 && index<3);return index;}
        void Time(bool preparation){Need(!closed && !poisoned);MetadataHostCodePin.Time(clock,preparation?Math.Min(workMs,5000):workMs);}
        void Check(){Time(false);foreach(var hold in holds){Need(hold!=null);hold.CheckForUse();Time(false);}}
        internal static MetadataHostCodeSet OpenInApprovedHost(string root,uint volume,uint high,uint low,
            MetadataHostCodePin library,MetadataHostCodePin core,MetadataHostCodePin wrapper,MetadataHostRunClock original,int work){
            MetadataHostCodeSet owner=null;
            try{
                Need(library!=null && core!=null && wrapper!=null && library.Leaf=="host-report-sink.dll" &&
                    core.Leaf=="windows-v3-metadata-watchdog.ps1" && wrapper.Leaf=="windows-v3-metadata-retained-watchdog.ps1");
                Need(original!=null);original.RequireBudget(work);
                MetadataHostCodePin.Time(original,work);owner=new MetadataHostCodeSet(original,work);owner.Time(true);
                var pins=new[]{library,core,wrapper};
                // Acquire ALL holds before any byte read; never return a partial owner.
                for(int i=0;i<3;i++){owner.Time(true);owner.holds[i]=MetadataHostReportSink.HostCodeReadHold.OpenInApprovedHost(root,volume,high,low,pins[i],original,work);}
                for(int i=0;i<3;i++){owner.Time(true);owner.bytes[i]=owner.holds[i].TakeCheckedBytes();}
                owner.Check();owner.Time(true);owner.ready=true;return owner;
            }catch{if(owner!=null){owner.poisoned=true;try{owner.Dispose();}catch{}}throw new InvalidOperationException("metadata-host-code-set-unavailable");}
        }
        internal byte[] TakeCheckedBytes(MetadataHostCodeRole role){lock(gate){
            byte[] copy=null;try{
                Need(ready);int index=Index(role);Need(!taken[index]);taken[index]=true;Time(true);Check();
                copy=(byte[])bytes[index].Clone();Check();Time(true);
                Array.Clear(bytes[index],0,bytes[index].Length);bytes[index]=null;
                var returned=copy;copy=null;return returned;
            }catch{
                // Previously returned code may already be in use. Poison forward
                // work but keep custody until the trusted caller ends that use.
                poisoned=true;throw new InvalidOperationException("metadata-host-code-set-unavailable");
            }finally{if(copy!=null)Array.Clear(copy,0,copy.Length);}
        }}
        internal void CheckForUse(){lock(gate){try{Need(ready);Check();}catch{poisoned=true;throw new InvalidOperationException("metadata-host-code-set-unavailable");}}}
        public void Dispose(){lock(gate){
            if(closed)return;closed=true;bool failed=false;
            for(int i=2;i>=0;i--){
                try{if(holds[i]!=null)holds[i].Dispose();}catch{failed=true;}
                if(bytes[i]!=null){Array.Clear(bytes[i],0,bytes[i].Length);bytes[i]=null;}
            }
            if(failed)throw new InvalidOperationException("metadata-host-code-set-unavailable");
        }}
    }
}
