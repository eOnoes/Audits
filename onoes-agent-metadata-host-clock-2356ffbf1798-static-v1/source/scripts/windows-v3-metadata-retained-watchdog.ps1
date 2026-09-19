# DORMANT COMPOSITION ONLY. Caller must already load the exact reviewed protected
# host library/core, establish independent lifetime, and provide scoped authority.
# This file loads no assembly/module, obtains no credential and starts no process.
function Invoke-OnoesMetadataRetainedVmWatchdog {
    param([switch]$ApprovedMetadataVmPowerOff,[guid]$VmId,[string]$ExpectedInventoryDigest,
        [string]$RunNonce,[string]$BundleDigest,[string]$FixtureDigest,
        [string]$VolumeRoot,[uint32]$Volume,[uint32]$RootIndexHigh,[uint32]$RootIndexLow,
        [IO.Stream]$Lifeline,[IO.Stream]$ArmedOutput,[int]$WorkMs=25000,[Onoes.MetadataExperiment.MetadataHostRunClock]$OriginalClock,
        [byte[]]$ClockContext,[byte[]]$ClockReference,[byte[]]$HostSession)
    $ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
    # Deny before native reservation, not merely before VM stop. This switch and
    # pins are trusted-host inputs, never evidence that a human gave consent.
    if (-not $ApprovedMetadataVmPowerOff -or $VmId -eq [guid]::Empty -or
        $null -eq $OriginalClock -or $WorkMs -lt 1 -or $WorkMs -gt 25000 -or
        $null -eq $Lifeline -or -not $Lifeline.CanRead -or
        $null -eq $ArmedOutput -or -not $ArmedOutput.CanWrite) { throw 'metadata-retained-watchdog-not-approved' }
    $pins=[Collections.Generic.List[byte[]]]::new()
    foreach ($pin in @($RunNonce,$ExpectedInventoryDigest,$BundleDigest,$FixtureDigest)) {
        if ($pin -cnotmatch '\A[a-f0-9]{64}\z' -or $pin -ceq ('0'*64)) { throw 'metadata-retained-watchdog-pin' }
        $bytes=New-Object byte[] 32
        for ($i=0;$i -lt 32;$i++) { $bytes[$i]=[Convert]::ToByte($pin.Substring($i*2,2),16) }
        $pins.Add($bytes)
    }
    $owner=$null; $observation=$null; $recordAttempted=$false; $recorded=$false; $cleanupReturned=$false; $retentionFailed=$false
    try {
        $OriginalClock.RequireRun($pins[0],$WorkMs)
        # The native factory is the only reservation path. No duck-typed port,
        # callback, fallback writer or local same-user replacement is accepted.
        $owner=[Onoes.MetadataExperiment.MetadataWatchdogRetentionBridge]::Reserve($VolumeRoot,$Volume,$RootIndexHigh,$RootIndexLow,
            $pins[0],$pins[1],$pins[2],$pins[3],$WorkMs,$OriginalClock,$ArmedOutput,$ClockContext,$ClockReference,$HostSession)
        $candidate=Invoke-OnoesMetadataVmWatchdog -ApprovedMetadataVmPowerOff -VmId $VmId -ExpectedInventoryDigest $ExpectedInventoryDigest `
            -RunNonce $RunNonce -BundleDigest $BundleDigest -WorkMs $WorkMs -OriginalClock $OriginalClock `
            -Lifeline $Lifeline -ArmedOutput $owner.ArmedOutput -ClockReference $owner.ClockReference -IntentReference $owner.IntentReference
        # Emergency stop/observation above MUST precede terminal retention.
        if ($null -eq $candidate -or $candidate.kind -cne 'metadata-watchdog-observation-not-verification' -or
            $candidate.inventoryDigest -cne $ExpectedInventoryDigest -or $candidate.runNonce -cne $RunNonce -or
            $candidate.bundleDigest -cne $BundleDigest -or $candidate.authority -cne 'none' -or
            $candidate.trigger -cnotin @('arm-failed','deadline','owner-eof','unexpected-input','lifeline-error')) { throw 'metadata-retained-watchdog-observation' }
        foreach ($name in @('armed','stopAttempted','hostOffObserved','stopJobSettled','stopWithinBudget','controllerDispatchClosed','guestStopProven','verificationEvidence')) {
            if ($candidate.$name -isnot [bool]) { throw 'metadata-retained-watchdog-observation' }
        }
        if ($candidate.controllerDispatchClosed -or $candidate.guestStopProven -or $candidate.verificationEvidence) { throw 'metadata-retained-watchdog-observation' }
        $observation=[pscustomobject]@{ kind='metadata-watchdog-observation-not-verification'; inventoryDigest=$ExpectedInventoryDigest;
            runNonce=$RunNonce;bundleDigest=$BundleDigest;trigger=[string]$candidate.trigger;armed=$candidate.armed;
            stopAttempted=$candidate.stopAttempted;hostOffObserved=$candidate.hostOffObserved;stopJobSettled=$candidate.stopJobSettled;
            stopWithinBudget=$candidate.stopWithinBudget;controllerDispatchClosed=$false;guestStopProven=$false;verificationEvidence=$false;authority='none' }
        $recordAttempted=$true
        $owner.RecordClaims($observation.inventoryDigest,$observation.runNonce,$observation.bundleDigest,$observation.trigger,
            $observation.armed,$observation.stopAttempted,$observation.hostOffObserved,$observation.stopJobSettled,$observation.stopWithinBudget)
        $recorded=$true
    } catch { $retentionFailed=$true } # Never publish raw private/native/management diagnostics.
    finally {
        if ($null -ne $owner) { try { $owner.Dispose();$cleanupReturned=$true } catch { $retentionFailed=$true } }
        foreach ($bytes in $pins) { [Array]::Clear($bytes,0,$bytes.Length) }
    }
    # Cleanup counts against the ORIGINAL retention allowance, never a new timer.
    # Preserve historical write/readback separately from failed cleanup/timing.
    # A true write return is never a complete-retention or execution assertion.
    $retentionUncertain=$retentionFailed -or -not $recorded -or -not $cleanupReturned
    try { $OriginalClock.RequireBefore($WorkMs+10000) } catch { $retentionUncertain=$true }
    return [pscustomobject]@{ kind='metadata-retained-watchdog-claims-not-verification'; observation=$observation;
        retentionAttempted=$recordAttempted; retentionWriteReadBackReturned=$recorded; retentionCleanupReturned=$cleanupReturned;
        retentionUncertain=$retentionUncertain;
        requiresReconciliation=$true; durableEvidenceRetained=$false; executionAuthorized=$false; authority='none' }
}
