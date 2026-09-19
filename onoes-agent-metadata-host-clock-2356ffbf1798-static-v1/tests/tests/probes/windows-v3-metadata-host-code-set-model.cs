// TEST LINK SUBSTITUTE ONLY. No file, handle, native call, image load or process.
using System;using System.Collections.Generic;
namespace Onoes.MetadataExperiment {
    internal sealed partial class MetadataHostReportSink {
        internal sealed class HostCodeReadHold : IDisposable {
            internal static readonly List<string> Trace=new List<string>();
            internal static readonly byte[][] Buffers=new byte[3][];
            internal static string FailAt,StopAt;internal static int DisposeMask;internal static MetadataHostRunClock Clock;
            internal static string Root;internal static uint Volume,High,Low;internal static int Work;
            int index;
            internal static void Reset(){Trace.Clear();FailAt=StopAt=null;DisposeMask=0;Clock=null;for(int i=0;i<3;i++)Buffers[i]=null;}
            static void Step(string name){Trace.Add(name);if(StopAt==name)Clock.Invalidate();if(FailAt==name)throw new Exception("private-fake-hold-error");}
            internal static HostCodeReadHold OpenInApprovedHost(string root,uint volume,uint high,uint low,MetadataHostCodePin pin,MetadataHostRunClock clock,int work){
                if(!Object.ReferenceEquals(clock,Clock) || root!=Root || volume!=Volume || high!=High || low!=Low || work!=Work)throw new Exception("model-pin-substitution");
                int index=pin.Leaf=="host-report-sink.dll"?0:pin.Leaf=="windows-v3-metadata-watchdog.ps1"?1:2;
                Step("open:"+index);return new HostCodeReadHold{index=index};
            }
            internal byte[] TakeCheckedBytes(){Step("read:"+index);return Buffers[index]=new byte[]{(byte)(index+1),9,8};}
            internal void CheckForUse(){Step("check:"+index);}
            public void Dispose(){Step("dispose:"+index);if((DisposeMask&(1<<index))!=0)throw new Exception("private-fake-dispose-error");}
        }
    }
}
