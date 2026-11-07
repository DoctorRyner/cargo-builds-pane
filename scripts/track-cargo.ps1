# Runs cargo exactly as given and keeps a status file and a log of it, so the Cargo builds pane shows the run live:
# what it builds, progress, time, OK or FAILED, and a notification when it ends. The output still goes to this terminal.
#
#   pwsh -File track-cargo.ps1 -Label "app" build --release
#   powershell -ExecutionPolicy Bypass -File track-cargo.ps1 -Label "tests" test -p my-crate
#
# Folder: $env:CARGO_BUILDS_DIR, else ~/.cargo-builds. Files: <yyyyMMdd-HHmmss>-<pid>.json (id, label, state
# running|ok|failed, started, ended, exitCode, log, cwd, args) and the .log beside it. The newest 40 runs are kept.
# Exit code: cargo's. A plain script on purpose (no [Parameter] attributes): everything after -Label, cargo's own flags
# like -p and -j too, lands in $args unchanged.
param([string]$Label = 'cargo')
$CargoArgs = @($args)
$ErrorActionPreference = 'Continue'   # cargo writes its progress to stderr; never turn that into a stop
$dir = if ($env:CARGO_BUILDS_DIR) { $env:CARGO_BUILDS_DIR } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.cargo-builds' }
New-Item -ItemType Directory -Force $dir | Out-Null
$id = (Get-Date -Format 'yyyyMMdd-HHmmss') + "-$PID"
$log = Join-Path $dir "$id.log"
$json = Join-Path $dir "$id.json"
$started = (Get-Date).ToUniversalTime().ToString('o')

function Write-Status([string]$State, $Code) {
  $status = [ordered]@{
    id = $id; label = $Label; state = $State; started = $started
    ended = if ($State -eq 'running') { $null } else { (Get-Date).ToUniversalTime().ToString('o') }
    exitCode = $Code; log = $log; cwd = (Get-Location).Path; args = ($CargoArgs -join ' ')
  }
  # Written whole to a temp file, then moved, so the pane never reads half a file.
  $status | ConvertTo-Json | Set-Content -Encoding utf8 "$json.tmp"
  Move-Item -Force "$json.tmp" $json
}

# Old runs: keep the newest 40.
Get-ChildItem $dir -Filter *.json | Sort-Object Name -Descending | Select-Object -Skip 40 | ForEach-Object {
  Remove-Item -Force $_.FullName, ($_.FullName -replace '\.json$', '.log') -ErrorAction SilentlyContinue
}

Write-Status 'running' $null
# Progress lines ("Building [=>  ] 161/466") also when the output is not a console, so the pane can read them.
$env:CARGO_TERM_PROGRESS_WHEN = 'always'
$env:CARGO_TERM_PROGRESS_WIDTH = '110'
$writer = New-Object System.IO.StreamWriter($log, $false, (New-Object System.Text.UTF8Encoding($false)))
$writer.AutoFlush = $true
$code = 1
try {
  & cargo @CargoArgs 2>&1 | ForEach-Object {
    $line = "$_"
    $writer.WriteLine($line)
    Write-Host $line
  }
  $code = $LASTEXITCODE
} finally {
  $writer.Dispose()
  # Also on Ctrl+C: a run never stays "running" in the pane.
  Write-Status ($(if ($code -eq 0) { 'ok' } else { 'failed' })) $code
}
exit $code
