param([string]$OutputDirectory = (Join-Path $PSScriptRoot ('perf-artifacts/run-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))))
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Use a new output directory' }
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$resolved = (Resolve-Path -LiteralPath $OutputDirectory).Path
$environment = @{
    time = (Get-Date).ToString('o')
    os = (Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, TotalVisibleMemorySize)
    cpu = (Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors)
    disks = @(Get-PhysicalDisk | Select-Object FriendlyName, MediaType, BusType, Size)
    output_disk = (Get-Partition -DriveLetter $resolved.Substring(0,1) | Get-Disk | Select-Object Number, FriendlyName, BusType, Size)
    rust = (& "$env:USERPROFILE/.cargo/bin/rustc.exe" +stable-x86_64-pc-windows-gnu -Vv | Out-String)
    seed = 383
    build = 'release'
    process_memory_scope = 'entire sequential run; peak working set sampled every 100 ms'
}
$environment | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $resolved 'environment.json') -Encoding UTF8
$executable = Join-Path $PSScriptRoot 'target/release/examples/storage_perf.exe'
$process = Start-Process -FilePath $executable -ArgumentList ('"' + $resolved + '"') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $resolved 'stdout.txt') -RedirectStandardError (Join-Path $resolved 'stderr.txt')
    # Retain the handle so ExitCode remains available after Refresh/exit.
    $null = $process.Handle
$peak = 0L
while (-not $process.HasExited) {
    $process.Refresh()
    $peak = [Math]::Max($peak, $process.PeakWorkingSet64)
    Start-Sleep -Milliseconds 100
}
$process.WaitForExit()
if ($null -eq $process.ExitCode) { throw "Child exit code unavailable" }
@{ peak_working_set_bytes = $peak; exit_code = $process.ExitCode } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $resolved 'memory.json') -Encoding UTF8
Get-Content -LiteralPath (Join-Path $resolved 'stdout.txt')
Get-Content -LiteralPath (Join-Path $resolved 'stderr.txt')
Write-Output "Results: $resolved"
exit $process.ExitCode
