# MOCK ONLY. Hyper-V is not imported; every management call is a local function.
param([string]$CorePath, [string]$Mode, [string]$InventoryPin, [int]$WorkMs=25000, [switch]$Pipes, [switch]$DirectReport, [switch]$InventoryOnly,
    [string]$MockRunNonce=('a'*64), [string]$MockBundleDigest=('b'*64))
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
if ($env:ONOES_METADATA_WATCHDOG_MOCK -cne '1') { throw 'mock-only' }
Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop
$PSModuleAutoLoadingPreference='None'
Add-Type -Path @("$PSScriptRoot\..\probes\windows-v3-metadata-host-clock.cs",
    "$PSScriptRoot\..\probes\windows-v3-metadata-host-clock-policy.cs","$PSScriptRoot\v3-metadata-host-clock-fixture.cs")
. $CorePath
$script:id=[guid]'00000000-0000-4000-8000-000000000001'
$script:trace=[Collections.Generic.List[string]]::new()
$script:stopped=$false; $script:reads=0; $script:removed=$false
$incoming=[IO.MemoryStream]::new(); $output=[IO.MemoryStream]::new()
if ($Mode -cin @('dispose-late','dispose-error')) {
    # Test-only input stream: EOF is immediate; disposal alone stalls/fails.
    # No production clock injection, management call or real VM is involved.
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Threading;
public sealed class MetadataMockDisposalStream : MemoryStream {
    public bool Fail;
    protected override void Dispose(bool disposing) {
        if (disposing) {
            if (Fail) throw new IOException("private-dispose-diagnostic");
            Thread.Sleep(5100);
        }
        base.Dispose(disposing);
    }
}
'@
    $incoming.Dispose();$incoming=[MetadataMockDisposalStream]::new();$incoming.Fail=($Mode -ceq 'dispose-error')
}
if ($Mode -ceq 'unexpected-input') { $incoming.WriteByte(65);$incoming.Position=0 }
if ($Pipes) { $incoming.Dispose();$output.Dispose();$incoming=[Console]::OpenStandardInput();$output=[Console]::OpenStandardOutput() }
function Get-VM { [CmdletBinding()]param([guid]$Id)
    if ($Id -ne $script:id) { throw 'wrong-target' };$script:trace.Add('get-vm');$script:reads++
    if ($Mode -ceq 'inventory-error') { throw 'private-inventory-diagnostic' }
    if ($Mode -ceq 'inventory-late') { Start-Sleep -Milliseconds 10050 }
    if ($script:reads -eq 1 -and $Mode -ceq 'arm-failed') { $output.Dispose() }
    if ($script:reads -eq 1 -and $Mode -ceq 'lifeline-error') { $incoming.Dispose() }
    if ($script:reads -gt 1 -and $Mode -ceq 'missing-target') { return }
    $state=if ($script:stopped -or ($Mode -ceq 'already-off' -and $script:reads -gt 1)) { 'Off' } else { 'Running' }
    if ($Mode -ceq 'initially-off') { $state='Off' }
    if ($Mode -ceq 'initially-saved') { $state='Saved' }
    if ($script:stopped -and $Mode -ceq 'saved') { $state='Saved' }
    if ($script:removed -and $Mode -ceq 'restart') { $state='Running' }
    [pscustomobject]@{ Id=$Id;Name='synthetic-v3-metadata';Generation=2;State=$state;
        ProcessorCount=$(if ($Mode -ceq 'cpu') {3}else{2});MemoryAssigned=4294967296;
        AutomaticStartAction=$(if ($Mode -ceq 'auto-start') {'Start'}else{'Nothing'});AutomaticStopAction='TurnOff';
        AutomaticCheckpointsEnabled=($Mode -ceq 'checkpoint') }
}
function Get-VMMemory { [CmdletBinding()]param($VM)
    [pscustomobject]@{ DynamicMemoryEnabled=($Mode -ceq 'dynamic');Startup=$(if ($Mode -ceq 'memory'){8589934592}else{4294967296}) }
}
function Get-VMHardDiskDrive { [CmdletBinding()]param($VM)
    [pscustomobject]@{ DiskNumber=$(if($Mode -ceq 'passthrough'){1}else{$null});ControllerType='SCSI';Path='D:\synthetic\metadata.vhdx';ControllerNumber=0;ControllerLocation=0 }
}
function Get-VHD { [CmdletBinding()]param([guid]$VMId)
    if ($VMId -ne $script:id) { throw 'wrong-vhd-target' }
    [pscustomobject]@{ Path='D:\synthetic\metadata.vhdx';VhdFormat='VHDX';VhdType=$(if($Mode -ceq 'differencing'){'Differencing'}else{'Dynamic'});
        ParentPath=$null;DiskIdentifier=$(if($Mode -ceq 'wrong-disk' -or ($Mode -ceq 'drift' -and $script:stopped)){'00000000-0000-4000-8000-000000000003'}else{'00000000-0000-4000-8000-000000000002'});Size=68719476736 }
}
function Get-VMFirmware { [CmdletBinding()]param($VM)
    [pscustomobject]@{ SecureBoot=$(if($Mode -ceq 'secureboot'){'Off'}else{'On'});SecureBootTemplate='MicrosoftWindows' }
}
function Get-VMIntegrationService { [CmdletBinding()]param($VM)
    [pscustomobject]@{ Id='integration-fixture';Enabled=$false }
    if ($Mode -ceq 'duplicate-integration') { [pscustomobject]@{ Id='integration-fixture';Enabled=$false } }
    if ($Mode -ceq 'invalid-integration') { [pscustomobject]@{ Id="private`ninvalid";Enabled=$false } }
    if ($Mode -ceq 'untyped-integration') { [pscustomobject]@{ Id='second';Enabled='false' } }
}
function Get-VMComPort { [CmdletBinding()]param($VM)
    if ($Mode -ceq 'com-port') { [pscustomobject]@{Path='\\.\pipe\unexpected'} }
}
function Get-VMNetworkAdapter { [CmdletBinding()]param($VM) if ($Mode -ceq 'network') { [pscustomobject]@{Name='unexpected'} } }
function Get-VMGpuPartitionAdapter { [CmdletBinding()]param($VM) if ($Mode -ceq 'gpu') { [pscustomobject]@{Name='unexpected'} } }
function Get-VMAssignableDevice { [CmdletBinding()]param($VM) if ($Mode -ceq 'device') { [pscustomobject]@{Name='unexpected'} } }
function Get-VMDvdDrive { [CmdletBinding()]param($VM) if ($Mode -ceq 'dvd') { [pscustomobject]@{Name='unexpected'} } }
function Stop-VM { [CmdletBinding(SupportsShouldProcess=$true)]param($VM,[switch]$TurnOff,[switch]$AsJob)
    if ($VM.Id -ne $script:id -or -not $TurnOff -or -not $AsJob) { throw 'wrong-stop' }
    $script:trace.Add('stop');if($Mode -ceq 'stop-error'){throw 'private-stop-diagnostic'};$script:stopped=$true
    # A completed job and later Off must NOT certify a missed five-second bound.
    if ($Mode -ceq 'stop-late') { [Threading.Thread]::Sleep(5100) }
    [pscustomobject]@{ Fixture='owned-mock';State=$(if($Mode -ceq 'stop-failed'){'Failed'}else{'Completed'});
        Finished=[Threading.ManualResetEvent]::new($Mode -cne 'stop-timeout') }
}
function Remove-Job { [CmdletBinding()]param($Job)
    if ($Job.Fixture -cne 'owned-mock' -or $Job.State -cne 'Completed') { throw 'wrong-job' }
    $script:trace.Add('remove');$script:removed=$true;$Job.Finished.Dispose()
    if($Mode -ceq 'remove-error'){throw 'private-remove-diagnostic'}
}
# Fail closed if any expected management function was omitted: no module auto-load.
foreach($name in @('Get-VM','Get-VMMemory','Get-VMHardDiskDrive','Get-VHD','Get-VMFirmware','Get-VMIntegrationService','Get-VMComPort',
    'Get-VMNetworkAdapter','Get-VMGpuPartitionAdapter','Get-VMAssignableDevice','Get-VMDvdDrive','Stop-VM','Remove-Job')) {
    if ((Get-Command $name).CommandType.ToString() -cne 'Function') { throw 'mock-command-missing' }
}
$answer=$null;$denied=$false
$original=[MetadataHostClockFixture]::Create($MockRunNonce,$WorkMs)
if($Mode -ceq 'clock-missing'){$original=$null}
if($Mode -ceq 'clock-stopped'){[MetadataHostClockFixture]::Invalidate($original)}
if($Mode -ceq 'clock-wrong-nonce'){$original=[MetadataHostClockFixture]::Create(('b'*64),$WorkMs)}
if($Mode -ceq 'clock-wrong-budget'){$original=[MetadataHostClockFixture]::Create($MockRunNonce,24999)}
if($Mode -ceq 'clock-fails-after-arm'){$incoming.Dispose();$incoming=[MetadataHostClockFaultStream]::new();$incoming.Clock=$original}
if($Mode -ceq 'clock-expired'){[Threading.Thread]::Sleep($WorkMs+20)}
if($Mode -ceq 'clock-partly-spent'){[Threading.Thread]::Sleep(1200)}
$clockPin=if($Mode -ceq 'missing-clock-reference'){''}else{'c'*64}
$intentPin=if($Mode -ceq 'missing-intent-reference'){''}else{'d'*64}
try {
    if ($InventoryOnly) {
        $discoveryId=if($Mode -ceq 'empty-id'){[guid]::Empty}else{$script:id}
        $answer=Read-OnoesMetadataWatchdogInventory -ApprovedReadOnlyInventory:($Mode -cne 'unapproved') -VmId $discoveryId
    } else {
        $answer=Invoke-OnoesMetadataVmWatchdog -ApprovedMetadataVmPowerOff:($Mode -cne 'unapproved') -VmId $script:id -ExpectedInventoryDigest $InventoryPin -RunNonce $MockRunNonce -BundleDigest $MockBundleDigest -Lifeline $incoming -ArmedOutput $output -WorkMs $WorkMs -OriginalClock $original -ClockReference $clockPin -IntentReference $intentPin
    }
}
catch {
    $denied=$true
    if ($InventoryOnly) {
        $expectedReason=if($Mode -cin @('unapproved','empty-id')){'metadata-inventory-not-approved'}else{'metadata-inventory-observation-unavailable'}
        if ($_.Exception.Message -cne $expectedReason) { throw 'mock-unexpected-discovery-error' }
    }
}
$text=if($Pipes -or $Mode -ceq 'arm-failed'){''}else{[Text.Encoding]::UTF8.GetString($output.ToArray())}
if ($DirectReport) {
    if (-not $Pipes -or $denied -or $null -eq $answer) { throw 'mock-direct-report-unavailable' }
    $answer | ConvertTo-Json -Depth 6 -Compress
} else {
    [pscustomobject]@{ mockOnly=$true;denied=$denied;report=$answer;trace=@($script:trace.ToArray());armedText=$text;
        originalElapsedMs=$(try {if($null -eq $original){$null}else{$original.ReadElapsedMilliseconds()}} catch {$null}) } | ConvertTo-Json -Depth 6 -Compress
}
