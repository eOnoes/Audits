// Runtime adapter, NOT an authenticated channel or loader. An already-trusted
// same-host/same-boot launcher owns the independent pins and original clock.
using System;
namespace Onoes.MetadataExperiment {
    public static class MetadataHostClockTransfer {
        public static byte[] CreateInTrustedHost(MetadataHostRunClock original,byte[] hostSession){
            if(original==null)throw new InvalidOperationException("metadata-host-clock-transfer-unavailable");
            original.RequireBefore(original.WorkMs);var nonce=original.CopyNonce();
            var context=MetadataHostClockContext.Create(original.OriginTicks,original.Frequency,nonce,original.WorkMs,hostSession);
            original.RequireRun(nonce,original.WorkMs);return context.ToWire();
        }
        public static byte[] ContextReference(byte[] wire){return MetadataHostClockContext.Parse(wire).Reference();}
        // Join to the clock ALREADY owned by this process, never renew its origin.
        // Return an owned validated wire, not the caller's mutable buffer.
        public static byte[] RequireExistingInTrustedHost(MetadataHostRunClock original,byte[] wire,byte[] expectedReference,
            byte[] expectedHostSession,byte[] expectedNonce,int expectedWorkMs){
            if(original==null)throw new InvalidOperationException("metadata-host-clock-transfer-unavailable");
            var context=MetadataHostClockContext.Parse(wire);
            context.Match(expectedReference,expectedHostSession,expectedNonce,expectedWorkMs);
            if(context.OriginTicks!=original.OriginTicks || context.Frequency!=original.Frequency)
                throw new InvalidOperationException("metadata-host-clock-transfer-unavailable");
            original.RequireRun(context.Nonce,context.WorkMs);return context.ToWire();
        }
        public static MetadataHostRunClock ReceiveInTrustedHost(byte[] wire,byte[] expectedReference,
            byte[] expectedHostSession,byte[] expectedNonce,int expectedWorkMs){
            var context=MetadataHostClockContext.Parse(wire);
            context.Match(expectedReference,expectedHostSession,expectedNonce,expectedWorkMs);
            // Only after exact independent binding, sample THIS process's QPC.
            // The original timestamp is never replaced with receipt time.
            return MetadataHostRunClock.ReceiveInTrustedHost(context.OriginTicks,context.Frequency,context.Nonce,context.WorkMs);
        }
    }
}
