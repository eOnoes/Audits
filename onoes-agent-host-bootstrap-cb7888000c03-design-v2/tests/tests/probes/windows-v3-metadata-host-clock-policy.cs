// Pure clock arithmetic. No clock callback, wall time, I/O or authentication.
using System;
namespace Onoes.MetadataExperiment {
    internal sealed class MetadataHostClockState {
        internal readonly long OriginTicks,Frequency;
        internal readonly int WorkMs;
        readonly byte[] nonce;
        long last;
        bool unavailable;
        internal MetadataHostClockState(long origin,long frequency,byte[] runNonce,int workMs){
            if(origin<=0 || frequency<=0 || workMs<1 || workMs>25000 || runNonce==null || runNonce.Length!=32)
                throw new InvalidOperationException("metadata-host-clock-unavailable");
            nonce=(byte[])runNonce.Clone();bool nonzero=false;foreach(byte b in nonce)nonzero|=b!=0;
            if(!nonzero)throw new InvalidOperationException("metadata-host-clock-unavailable");
            OriginTicks=origin;Frequency=frequency;WorkMs=workMs;last=origin;
        }
        void Need(bool ok){if(!ok){unavailable=true;throw new InvalidOperationException("metadata-host-clock-unavailable");}}
        internal void Invalidate(){unavailable=true;}
        internal byte[] CopyNonce(){Need(!unavailable);return (byte[])nonce.Clone();}
        internal void RequireBinding(byte[] runNonce,int workMs){
            Need(!unavailable && workMs==WorkMs && runNonce!=null && runNonce.Length==32);
            int difference=0;for(int i=0;i<32;i++)difference|=runNonce[i]^nonce[i];Need(difference==0);
        }
        internal void RequireBudget(int workMs){Need(!unavailable && workMs==WorkMs);}
        internal long Observe(long now,long frequency,bool highResolution){
            Need(!unavailable && highResolution && frequency==Frequency && now>=OriginTicks && now>=last);
            last=now;
            // Subtract BEFORE scaling. Decimal holds every Int64 value exactly;
            // +1 tick is the conservative same-host cross-thread uncertainty.
            // A saturated expired reading can never wrap into a fresh budget.
            decimal scaled=((decimal)now-OriginTicks+1m)*1000m;
            if(scaled>=35000m*Frequency)return 35000;
            return (long)(scaled/Frequency);
        }
        internal void RequireBefore(long elapsed,long deadlineMs){
            Need(!unavailable && elapsed>=0 && deadlineMs>=1 && deadlineMs<=WorkMs+10000);
            // Expiring work does NOT invalidate the clock needed for stop/retention.
            if(elapsed>=deadlineMs)throw new InvalidOperationException("metadata-host-clock-expired");
        }
    }
}
