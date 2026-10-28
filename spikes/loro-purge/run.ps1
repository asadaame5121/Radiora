param(
    [ValidateSet('test', 'demo', 'known-failure', 'check')]
    [string]$Action = 'test',
    [string]$Toolchain = 'stable-x86_64-pc-windows-gnu'
)

$ErrorActionPreference = 'Stop'
$env:CARGO_HOME = Join-Path $PSScriptRoot '.cargo-home'
$env:TMP = Join-Path $env:CARGO_HOME 'tmp'
$env:TEMP = $env:TMP
$env:TMPDIR = $env:TMP
New-Item -ItemType Directory -Force -Path $env:TMP | Out-Null
$manifest = Join-Path $PSScriptRoot 'Cargo.toml'

switch ($Action) {
    'test' { cargo "+$Toolchain" test --locked --manifest-path $manifest }
    'demo' { cargo "+$Toolchain" run --locked --manifest-path $manifest }
    'known-failure' {
        cargo "+$Toolchain" test --locked --manifest-path $manifest --test workspace `
            session_replay_transforms -- --ignored --nocapture
    }
    'check' {
        cargo "+$Toolchain" fmt --manifest-path $manifest -- --check
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        cargo "+$Toolchain" clippy --locked --manifest-path $manifest --all-targets -- -D warnings
    }
}
exit $LASTEXITCODE
