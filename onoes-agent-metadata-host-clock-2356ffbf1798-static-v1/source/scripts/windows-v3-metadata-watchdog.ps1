# Definitions only. No default VM, Hyper-V contact, launch or installation on load.
# Future separately approved host process. This is emergency Off observation,
# never guest verification, host dispatch settlement or authority to restart.
function Get-OnoesMetadataWatchdogInventorySnapshot {
    param([guid]$VmId)
    $ErrorActionPreference = 'Stop'; Set-StrictMode -Version Latest
    if ($VmId -eq [guid]::Empty) { throw 'metadata-watchdog-pin' }
    $targets = @(Get-VM -Id $VmId -ErrorAction Stop)
    if ($targets.Count -ne 1) { throw 'metadata-watchdog-target' }
    $vm = $targets[0]
    if ($vm.Id -ne $VmId -or $vm.Generation -ne 2 -or $vm.ProcessorCount -lt 1 -or $vm.ProcessorCount -gt 2 -or
        $vm.MemoryAssigned -lt 0 -or $vm.MemoryAssigned -gt 4294967296 -or $vm.Name.Length -lt 1 -or $vm.Name.Length -gt 80 -or
        $vm.AutomaticStartAction.ToString() -cne 'Nothing' -or $vm.AutomaticCheckpointsEnabled) { throw 'metadata-watchdog-configuration' }
    $memory = Get-VMMemory -VM $vm -ErrorAction Stop
    $disks = @(Get-VMHardDiskDrive -VM $vm -ErrorAction Stop)
    $vhds = @(Get-VHD -VMId $VmId -ErrorAction Stop)
    $firmware = Get-VMFirmware -VM $vm -ErrorAction Stop
    $integration = @(Get-VMIntegrationService -VM $vm -ErrorAction Stop)
    $ports = @(Get-VMComPort -VM $vm -ErrorAction Stop)
    if ($memory.DynamicMemoryEnabled -or $memory.Startup -lt 1 -or $memory.Startup -gt 4294967296 -or
        $disks.Count -ne 1 -or $vhds.Count -ne 1 -or $null -ne $disks[0].DiskNumber -or
        $disks[0].ControllerType.ToString() -cne 'SCSI' -or $disks[0].Path -cnotmatch '\A[A-Za-z]:\\[^\r\n]{1,500}\.vhdx\z' -or
        $vhds[0].Path -cne $disks[0].Path -or $vhds[0].VhdFormat.ToString() -cne 'VHDX' -or
        $vhds[0].VhdType.ToString() -cnotin @('Fixed','Dynamic') -or -not [string]::IsNullOrEmpty($vhds[0].ParentPath) -or
        [guid]$vhds[0].DiskIdentifier -eq [guid]::Empty -or $vhds[0].Size -le 0 -or
        $firmware.SecureBoot.ToString() -cne 'On' -or $integration.Count -gt 16 -or $ports.Count -gt 2 -or
        @(Get-VMNetworkAdapter -VM $vm -ErrorAction Stop).Count -ne 0 -or
        @(Get-VMGpuPartitionAdapter -VM $vm -ErrorAction Stop).Count -ne 0 -or
        @(Get-VMAssignableDevice -VM $vm -ErrorAction Stop).Count -ne 0 -or
        @(Get-VMDvdDrive -VM $vm -ErrorAction Stop).Count -ne 0) { throw 'metadata-watchdog-configuration' }
    foreach ($port in $ports) { if (-not [string]::IsNullOrEmpty($port.Path)) { throw 'metadata-watchdog-port' } }
    $serviceMap = [Collections.Generic.SortedDictionary[string,bool]]::new([StringComparer]::Ordinal)
    foreach ($service in $integration) {
        $id = [string]$service.Id
        if ($service.Enabled -isnot [bool] -or $id -cnotmatch '\A[\x21-\x7e]{1,200}\z' -or $serviceMap.ContainsKey($id)) { throw 'metadata-watchdog-integration' }
        $serviceMap.Add($id, $service.Enabled)
    }
    $services = @($serviceMap.Keys | ForEach-Object { [ordered]@{ id=$_; enabled=$serviceMap[$_] } })
    # Stable inventory v1: excludes Running/Off, current memory usage and VHD
    # allocation growth. Includes configuration and disk ID, NOT physical custody.
    $inventory = [ordered]@{ schema='onoes-metadata-watchdog-inventory/v1'; vmId=$VmId.ToString(); name=$vm.Name;
        generation=[int]$vm.Generation; processors=[int]$vm.ProcessorCount; memoryStartup=[long]$memory.Startup;
        automaticStart=$vm.AutomaticStartAction.ToString(); automaticStop=$vm.AutomaticStopAction.ToString();
        diskPath=$disks[0].Path; diskId=([guid]$vhds[0].DiskIdentifier).ToString(); diskSize=[long]$vhds[0].Size;
        diskType=$vhds[0].VhdType.ToString(); controller=[int]$disks[0].ControllerNumber; location=[int]$disks[0].ControllerLocation;
        secureBootTemplate=[string]$firmware.SecureBootTemplate; integration=$services; emptyComPorts=$ports.Count }
    $text = $inventory | ConvertTo-Json -Depth 5 -Compress
    $bytes = [Text.UTF8Encoding]::new($false, $true).GetBytes($text)
    if ($bytes.Length -gt 4096) { throw 'metadata-watchdog-inventory-limit' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $digest = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose(); [Array]::Clear($bytes, 0, $bytes.Length) }
    # Internal capture shared by discovery and pin verification. No pin is
    # adopted by collecting it, and the VM object never becomes a portable permit.
    return [pscustomobject]@{ Target=$vm; Inventory=$inventory; Wire=$text; ByteLength=([Text.Encoding]::UTF8.GetByteCount($text)); Digest=$digest }
}
function Get-OnoesMetadataWatchdogTarget {
    param([guid]$VmId, [string]$ExpectedInventoryDigest)
    $ErrorActionPreference = 'Stop'; Set-StrictMode -Version Latest
    # Retain denial before any management read when the required pin is absent.
    if ($VmId -eq [guid]::Empty -or $ExpectedInventoryDigest -cnotmatch '\A[a-f0-9]{64}\z' -or
        $ExpectedInventoryDigest -ceq ('0' * 64)) { throw 'metadata-watchdog-pin' }
    $captured = Get-OnoesMetadataWatchdogInventorySnapshot -VmId $VmId
    if ($captured.Digest -cne $ExpectedInventoryDigest) { throw 'metadata-watchdog-inventory-mismatch' }
    return $captured.Target
}
function Read-OnoesMetadataWatchdogInventory {
    param([switch]$ApprovedReadOnlyInventory, [guid]$VmId)
    $ErrorActionPreference = 'Stop'; Set-StrictMode -Version Latest
    if (-not $ApprovedReadOnlyInventory -or $VmId -eq [guid]::Empty) { throw 'metadata-inventory-not-approved' }
    # Discovery only. The switch is trusted operator/launcher input, not consent
    # authentication. No guest login, configuration, power or stop path is called.
    $clock = [Diagnostics.Stopwatch]::StartNew()
    try {
        $captured = Get-OnoesMetadataWatchdogInventorySnapshot -VmId $VmId
        $state = $captured.Target.State.ToString()
        if ($state -cnotin @('Off','Running') -or $clock.ElapsedMilliseconds -ge 10000) { throw 'metadata-inventory-observation-unavailable' }
        return [pscustomobject]@{ kind='metadata-inventory-discovery-not-approval'; vmState=$state;
            inventoryDigest=$captured.Digest; inventoryByteLength=$captured.ByteLength; inventoryWire=$captured.Wire;
            physicalDiskCustodyEstablished=$false; guestIdentityEstablished=$false; guestContacted=$false;
            configurationChanged=$false; executionAuthorized=$false; authority='none' }
    } catch { throw 'metadata-inventory-observation-unavailable' } # no raw management diagnostics in the result
}
function Invoke-OnoesMetadataVmWatchdog {
    param([switch]$ApprovedMetadataVmPowerOff, [guid]$VmId, [string]$ExpectedInventoryDigest,
        [string]$RunNonce, [string]$BundleDigest, [IO.Stream]$Lifeline, [IO.Stream]$ArmedOutput,
        [int]$WorkMs = 25000, [Onoes.MetadataExperiment.MetadataHostRunClock]$OriginalClock,
        [string]$ClockReference,[string]$IntentReference)
    $ErrorActionPreference = 'Stop'; Set-StrictMode -Version Latest
    if (-not $ApprovedMetadataVmPowerOff -or $VmId -eq [guid]::Empty -or $null -eq $Lifeline -or $null -eq $ArmedOutput -or
        -not $Lifeline.CanRead -or -not $ArmedOutput.CanWrite -or $WorkMs -lt 1 -or $WorkMs -gt 25000) { throw 'metadata-watchdog-not-approved' }
    foreach ($pin in @($ExpectedInventoryDigest,$RunNonce,$BundleDigest,$ClockReference,$IntentReference)) {
        if ($pin -cnotmatch '\A[a-f0-9]{64}\z' -or $pin -ceq ('0' * 64)) { throw 'metadata-watchdog-pin' }
    }
    # These pins/switch are trusted-launcher inputs, NOT consent authentication.
    # No historical/default VM target or credentials are inferred by this API.
    # The trusted launcher starts this clock BEFORE reservation/preflight and
    # carries the same authenticated host origin here. Never renew spent time.
    # The clock itself is not authentication or an approval capability.
    $nonceBytes=New-Object byte[] 32
    for ($i=0;$i -lt 32;$i++) { $nonceBytes[$i]=[Convert]::ToByte($RunNonce.Substring($i*2,2),16) }
    try {
        if ($null -eq $OriginalClock) { throw 'missing-clock' }
        $OriginalClock.RequireRun($nonceBytes,$WorkMs)
    } catch { throw 'metadata-watchdog-original-clock' }
    finally { [Array]::Clear($nonceBytes,0,$nonceBytes.Length) }
    $clock = $OriginalClock
    $vm = Get-OnoesMetadataWatchdogTarget $VmId $ExpectedInventoryDigest
    if ($vm.State.ToString() -cne 'Running' -or $clock.ReadElapsedMilliseconds() -ge $WorkMs) { throw 'metadata-watchdog-preflight' }
    $armed = $false; $attempted = $false; $off = $false; $jobSettled = $false; $timely = $false
    $job = $null; $trigger = 'arm-failed'; $one = New-Object byte[] 1
    $read = $null; $write = $null; $arm = $null
    try {
        # The retained bridge checks these exact bytes against its owned V2
        # intent. Standalone core pins alone are not custody/authentication.
        $record = [ordered]@{ kind='metadata-watchdog-armed-v2-not-authorization'; inventoryDigest=$ExpectedInventoryDigest;
            runNonce=$RunNonce; bundleDigest=$BundleDigest; workMs=$WorkMs; stopMs=5000;
            clockReference=$ClockReference; intentReference=$IntentReference }
        $arm = [Text.Encoding]::UTF8.GetBytes(($record | ConvertTo-Json -Compress) + "`n")
        if ($arm.Length -gt 1024) { throw 'metadata-watchdog-arm-limit' }
        $remaining = [int]($WorkMs - $clock.ReadElapsedMilliseconds())
        if ($remaining -le 0) { throw 'metadata-watchdog-arm-timeout' }
        $write = $ArmedOutput.WriteAsync($arm, 0, $arm.Length)
        if (-not $write.Wait($remaining)) { throw 'metadata-watchdog-arm-timeout' }
        # Console streams can return Task<VoidTaskResult>, unlike MemoryStream.
        # Suppress that implementation value: this function returns ONE report.
        $null = $write.GetAwaiter().GetResult()
        $remaining = [int]($WorkMs - $clock.ReadElapsedMilliseconds())
        if ($remaining -le 0 -or -not $ArmedOutput.FlushAsync().Wait($remaining) -or $clock.ReadElapsedMilliseconds() -ge $WorkMs) { throw 'metadata-watchdog-arm-timeout' }
        $armed = $true; $trigger = 'deadline'
        $remaining = [int]($WorkMs - $clock.ReadElapsedMilliseconds())
        $read = $Lifeline.ReadAsync($one, 0, 1)
        if ($remaining -gt 0 -and $read.Wait($remaining)) {
            if ($read.GetAwaiter().GetResult() -eq 0) { $trigger = 'owner-eof' } else { $trigger = 'unexpected-input' }
        }
        if ($clock.ReadElapsedMilliseconds() -ge $WorkMs) { $trigger = 'deadline' }
    } catch { if ($armed) { $trigger = 'lifeline-error' } }
    finally {
        # A failed counter must not skip the already-required emergency attempt.
        # It cannot authorize a wait or a timely-stop claim either.
        $clockUsable=$true; $stopDeadline=$WorkMs+5000
        try { $stopDeadline = [Math]::Min($clock.ReadElapsedMilliseconds() + 5000, $WorkMs + 5000) }
        catch { $clockUsable=$false }
        try {
            # Stop the frozen ID even on later configuration drift. No other VM,
            # guest control, host-process kill, retry, Save or restart fallback.
            $targets = @(Get-VM -Id $VmId -ErrorAction Stop)
            if ($targets.Count -ne 1 -or $targets[0].Id -ne $VmId) { throw 'metadata-watchdog-stop-target' }
            if ($targets[0].State.ToString() -cne 'Off') {
                $attempted = $true
                $job = Stop-VM -VM $targets[0] -TurnOff -Confirm:$false -AsJob -ErrorAction Stop
                $remaining=0
                if ($clockUsable) { $remaining = [int][Math]::Max(0, $stopDeadline - $clock.ReadElapsedMilliseconds()) }
                if ($null -eq $job -or $remaining -le 0 -or -not $job.Finished.WaitOne($remaining) -or
                    $job.State.ToString() -cne 'Completed') { throw 'metadata-watchdog-stop-unconfirmed' }
                $jobSettled = $true
                Remove-Job -Job $job -ErrorAction Stop
            } else { $jobSettled = $true }
            $after = Get-OnoesMetadataWatchdogTarget $VmId $ExpectedInventoryDigest
            $off = $after.State.ToString() -ceq 'Off'
            $timely = $clockUsable -and ($clock.ReadElapsedMilliseconds() -lt $stopDeadline)
        } catch { $off = $false }
        # Disposal follows the emergency attempt; never wait on a stalled owner
        # before attempting stop. Outstanding tasks own their buffers until done.
        try { $Lifeline.Dispose() } catch { $off = $false }
        if ($null -eq $read -or $read.IsCompleted) { [Array]::Clear($one, 0, $one.Length) }
        if ($null -ne $arm -and ($null -eq $write -or $write.IsCompleted)) { [Array]::Clear($arm, 0, $arm.Length) }
    }
    # Include lifeline cleanup and buffer retirement in the ORIGINAL stop budget.
    # Synchronous Dispose may block: a prior timely Off sample cannot certify
    # timely completion after it returns. Do not renew the stop deadline here.
    try { $timely = $timely -and ($clock.ReadElapsedMilliseconds() -lt $stopDeadline) }
    catch { $timely=$false }
    # A late Off sample is diagnostic only, never confirmation within the budget.
    return [pscustomobject]@{ kind='metadata-watchdog-observation-not-verification'; inventoryDigest=$ExpectedInventoryDigest;
        runNonce=$RunNonce; bundleDigest=$BundleDigest; armed=$armed; trigger=$trigger; stopAttempted=$attempted;
        hostOffObserved=$off; stopJobSettled=$jobSettled; stopWithinBudget=($off -and $jobSettled -and $timely);
        controllerDispatchClosed=$false; guestStopProven=$false; verificationEvidence=$false; authority='none' }
}
