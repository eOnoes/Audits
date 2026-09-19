// Pure inert-pair ownership bookkeeping, not observed endpoint custody.
using System;
namespace Onoes.MetadataExperiment {
    internal sealed class MetadataHostPairPolicy {
        internal const uint ServerOpen=0x40080001,PipeMode=8,ClientAccess=0x00120082,ClientOpen=0x40110000,CreatorAcl=0x0012008f;
        readonly int deadline;long last;bool begun,ready;
        internal bool Closed {get;private set;}
        internal bool ReaderTaken {get;private set;}
        internal bool WriterTaken {get;private set;}
        internal int Deadline {get{return deadline;}}
        internal MetadataHostPairPolicy(HostReadRoute route,int work){
            MetadataHostReadPolicy.FrameSizes(route);if(work<1||work>25000)throw new InvalidOperationException("host-pair-work");deadline=Math.Min(work,5000);
        }
        void Need(bool ok){if(!ok){Closed=true;throw new InvalidOperationException("host-pair-state");}}
        void Time(long now){Need(!Closed&&now>=0&&now>=last&&now<deadline);last=now;}
        internal void Begin(long now){Time(now);Need(!begun);begun=true;}
        internal void Connected(long now){Time(now);Need(begun&&!ready);ready=true;}
        internal void RequireReady(long now){Time(now);Need(ready);}
        internal void Take(bool reader,long now){RequireReady(now);Need(reader?!ReaderTaken:!WriterTaken);if(reader)ReaderTaken=true;else WriterTaken=true;}
        internal void Close(){Closed=true;}
        internal static void CheckServer(uint type,uint handleFlags,uint pipeFlags,uint output,uint input,uint instances,uint state,uint current){
            // Observed Windows GetNamedPipeInfo includes PIPE_REJECT_REMOTE_CLIENTS
            // in addition to PIPE_SERVER_END. Require both; no unknown-bit masking.
            if(type!=3||handleFlags!=0||pipeFlags!=9||output>65536||input>65536||instances!=1||state!=0||current!=1)
                throw new InvalidOperationException("host-pair-server-properties");
        }
        internal static void CheckClient(uint type,uint handleFlags){if(type!=3||handleFlags!=0)throw new InvalidOperationException("host-pair-client-properties");}
        internal static void CheckPeers(uint own,uint client,uint server){if(own==0||client!=own||server!=own)throw new InvalidOperationException("host-pair-not-self-connected");}
    }
}
