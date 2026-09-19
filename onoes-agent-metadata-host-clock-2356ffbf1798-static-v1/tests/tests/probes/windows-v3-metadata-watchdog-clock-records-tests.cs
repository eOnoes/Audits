// Pure V2 framing/claims and immutable history controls, no native storage.
using System;using Onoes.MetadataExperiment;
internal static class WatchdogClockRecordsTests {
    static byte[] D(byte n){var b=new byte[32];for(int i=0;i<32;i++)b[i]=n;return b;}
    static void Need(bool ok){if(!ok)throw new Exception("watchdog-clock-records-test-failed");}
    static void Deny(Action f){bool bad=false;try{f();}catch(InvalidOperationException){bad=true;}Need(bad);}
    internal static void Run(){
        var context=MetadataHostClockContext.Create(123456789012345678,10000000,D(1),25000,D(7)).ToWire();
        var intent=MetadataWatchdogClockRecords.Intent(D(8),D(9),D(2),D(3),context);
        Need(MetadataBytes.Same(MetadataWatchdogClockRecords.IntentReference(intent),MetadataBytes.Hex("266731e817713254285524ef059a7cc9513ce76a67db9e8524cc6793f6991191")));
        var arm=MetadataWatchdogClockRecords.ArmFrame(intent);Need(arm.Length==499);
        Need(MetadataBytes.Same(MetadataBytes.Hash("onoes-test-watchdog-arm-vector/v2",arm),MetadataBytes.Hex("9f25e933c9fa5469178dea11125e36114488cd0f440355785802367f34824621")));
        var terminal=MetadataWatchdogClockRecords.Terminal(intent,2,31);Need(intent.Length==292 && terminal.Length==72);
        for(int i=0;i<292;i++){var bad=(byte[])intent.Clone();bad[i]^=1;Deny(()=>MetadataWatchdogClockRecords.ValidateIntent(bad));}
        for(int i=0;i<72;i++){var bad=(byte[])terminal.Clone();bad[i]^=1;Deny(()=>MetadataWatchdogClockRecords.ValidateTerminal(bad,intent));}
        for(int n=0;n<292;n++)Deny(()=>MetadataWatchdogClockRecords.ValidateIntent(new byte[n]));
        for(int n=0;n<72;n++)Deny(()=>MetadataWatchdogClockRecords.ValidateTerminal(new byte[n],intent));
        Deny(()=>MetadataWatchdogClockRecords.ValidateIntent(null));Deny(()=>MetadataWatchdogClockRecords.ValidateIntent(new byte[293]));
        Deny(()=>MetadataWatchdogClockRecords.ValidateTerminal(null,intent));Deny(()=>MetadataWatchdogClockRecords.ValidateTerminal(new byte[73],intent));
        var old=MetadataWatchdogRetentionPolicy.Intent(D(8),D(1),D(9),D(2),D(3),25000);
        Deny(()=>MetadataWatchdogClockRecords.ValidateIntent(old));Deny(()=>MetadataWatchdogClockRecords.ValidateTerminal(MetadataWatchdogRetentionPolicy.Terminal(old,2,31),intent));
        for(int trigger=-1;trigger<=5;trigger++)for(int flags=-1;flags<=32;flags++){
            bool valid=trigger>=0 && trigger<=4 && flags>=0 && flags<=31 && (((flags&1)!=0)?trigger!=0:trigger==0) && ((flags&16)==0 || (flags&12)==12);
            if(valid)MetadataWatchdogClockRecords.ValidateTerminal(MetadataWatchdogClockRecords.Terminal(intent,trigger,flags),intent);
            else Deny(()=>MetadataWatchdogClockRecords.Terminal(intent,trigger,flags));
        }
        foreach(int at in new[]{4,36,68,100,136,168,176,196}){
            var bad=(byte[])intent.Clone();bad[at]^=1;
            if(at>=132)MetadataBytes.Put(bad,228,MetadataBytes.Hash("onoes-metadata-host-clock-context/v1",MetadataBytes.Slice(bad,132,96)));
            MetadataBytes.Put(bad,260,MetadataBytes.Hash("onoes-metadata-watchdog-intent/v2",MetadataBytes.Slice(bad,0,260)));
            MetadataWatchdogClockRecords.ValidateIntent(bad);Deny(()=>MetadataWatchdogClockRecords.MatchIntent(bad,intent));Deny(()=>MetadataWatchdogClockRecords.ValidateTerminal(terminal,bad));
        }
        var history=MetadataWatchdogClockHistory.Create(intent,terminal,intent);var missing=MetadataWatchdogClockHistory.Create(intent,null,intent);
        Need(history.RequiresReconciliation && !history.StopProven && !history.MayDispatch && history.Status=="recorded-claims-not-verification");
        Need(missing.TerminalWire==null && missing.Status=="intent-only-unconfirmed");
        intent[0]=terminal[0]=0;var copy=history.IntentWire;copy[0]=0;copy=history.TerminalWire;copy[0]=0;
        Need(history.IntentWire[0]==79 && history.TerminalWire[0]==79);
    }
}
