param(
  [string]$Jar = 'D:\Downloads\alloy-6.2.0-windows-amd64\app\org.alloytools.alloy.dist.jar',
  [string]$OutputDirectory = (Join-Path $PSScriptRoot ('.results/' + [Guid]::NewGuid())),
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Jar -PathType Leaf)) { throw "Missing Alloy jar: $Jar" }
if (Test-Path -LiteralPath $OutputDirectory) { throw "Output already exists: $OutputDirectory" }
if ($TimeoutSeconds -le 0) { throw 'TimeoutSeconds must be positive' }
$java = (Get-Command java -ErrorAction Stop).Source
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$outputRoot = (Resolve-Path -LiteralPath $OutputDirectory).Path
$results = @()
$failed = $false

foreach ($model in @('document_model', 'legacy_sharing')) {
  $file = Join-Path $PSScriptRoot ($model + '.als')
  $listing = & $java -jar $Jar commands $file 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Cannot parse $file : $listing" }
  $listing | Set-Content -LiteralPath (Join-Path $outputRoot ($model + '-commands.txt')) -Encoding UTF8
  $commands = @($listing | Where-Object { "$_" -match '^\d+\s*\.' })
  if ($commands.Count -eq 0) { throw "No commands found in $model" }

  # Numeric command selection avoids Windows native wildcard expansion of '*'.
  foreach ($index in 0..($commands.Count - 1)) {
    $target = Join-Path $outputRoot ($model + '-' + $index)
    $stdout = $target + '.stdout.txt'
    $stderr = $target + '.stderr.txt'
    $argsList = @('-jar', "`"$Jar`"", 'exec', '-c', "$index", '-s', 'sat4j',
      '-t', 'json', '-o', "`"$target`"", "`"$file`"")
    $process = Start-Process -FilePath $java -ArgumentList $argsList -PassThru -NoNewWindow `
      -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    # Retain the process handle so Windows PowerShell 5.1 preserves ExitCode.
    $null = $process.Handle
    $timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
    if ($timedOut) {
      # Only stop the exact process this script started, never other Java sessions.
      if (-not $process.HasExited) { $process.Kill() }
    }
    $process.WaitForExit()
    $receipt = Join-Path $target 'receipt.json'
    $name = "$model/$index"
    $actual = 'ERROR'
    $expected = $null
    $ok = $false
    if (-not $timedOut -and $process.ExitCode -eq 0 -and (Test-Path -LiteralPath $receipt)) {
      $data = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
      $entries = @($data.commands.PSObject.Properties)
      if ($entries.Count -ne 1) { throw "Unexpected receipt: $receipt" }
      $command = $entries[0].Value
      $name = $command.name
      $sat = $null -ne $command.solution -and @($command.solution).Count -gt 0
      $actual = if ($sat) { 'SAT' } else { 'UNSAT' }
      $expected = [int]$command.expects
      $ok = ([int]$sat -eq $expected)
    }
    if ($timedOut) { $actual = 'TIMEOUT' }
    $results += [pscustomobject]@{
      model = $model; index = $index; name = $name
      expectedSat = $expected; actual = $actual; passed = $ok
      modelSha256 = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    }
    Write-Output "$model/$index $name : $actual (expected SAT=$expected)"
    $results | ConvertTo-Json -Depth 4 | Set-Content `
      -LiteralPath (Join-Path $outputRoot 'summary.json') -Encoding UTF8
    if (-not $ok) { $failed = $true }
  }
}
Write-Output "Receipts, instances and summary: $outputRoot"
if ($failed) { throw 'Alloy expectation mismatch, execution error, or timeout; inspect summary.json' }
