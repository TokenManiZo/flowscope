[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $IsWindows) { throw 'zap-down.ps1 is for Windows. Use scripts/zap-down.sh on macOS/Linux.' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Desktop is required.' }

$repoDirectory = Split-Path -Parent $PSScriptRoot
$configDirectory = if ([string]::IsNullOrWhiteSpace($env:FLOWSCOPE_CONFIG_DIR)) {
    Join-Path $HOME '.flowscope'
} else {
    $env:FLOWSCOPE_CONFIG_DIR
}
$keyFile = if ([string]::IsNullOrWhiteSpace($env:FLOWSCOPE_ZAP_KEY_FILE)) {
    Join-Path $configDirectory 'zap-api-key'
} else {
    $env:FLOWSCOPE_ZAP_KEY_FILE
}
$keyFile = [System.IO.Path]::GetFullPath($keyFile)
$env:FLOWSCOPE_ZAP_KEY_FILE = if (Test-Path -LiteralPath $keyFile) {
    $keyFile
} else {
    $PSCommandPath
}

& docker compose --project-name flowscope-zap --file (Join-Path $repoDirectory 'infra/zap/compose.yaml') down
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose could not stop FlowScope ZAP.' }
