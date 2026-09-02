[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-EnvironmentPort([string] $Name, [int] $DefaultValue) {
    $raw = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($raw)) { return $DefaultValue }
    $parsed = 0
    if (-not [int]::TryParse($raw, [ref] $parsed) -or $parsed -lt 1 -or $parsed -gt 65535) {
        throw "$Name must be a TCP port from 1 to 65535."
    }
    return $parsed
}

if (-not $IsWindows) { throw 'zap-up.ps1 is for Windows. Use scripts/zap-up.sh on macOS/Linux.' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Desktop is required.' }
& docker compose version *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose v2 is required.' }

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

& (Join-Path $PSScriptRoot 'zap-key.ps1') *> $null
$key = [System.IO.File]::ReadAllText($keyFile).Trim()
if ($key -notmatch '^[A-Za-z0-9._~-]+$' -or $key.Length -lt 32 -or $key.Length -gt 256) {
    throw "Invalid ZAP key file: $keyFile"
}

$zapPort = Get-EnvironmentPort 'FLOWSCOPE_ZAP_PORT' 8089
$scannerPort = Get-EnvironmentPort 'FLOWSCOPE_BURP_SCANNER_PORT' 8081
$env:FLOWSCOPE_ZAP_KEY_FILE = [System.IO.Path]::GetFullPath($keyFile)
$env:FLOWSCOPE_ZAP_PORT = $zapPort.ToString()
$env:FLOWSCOPE_BURP_SCANNER_PORT = $scannerPort.ToString()

& docker compose --project-name flowscope-zap --file (Join-Path $repoDirectory 'infra/zap/compose.yaml') up --detach
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose could not start FlowScope ZAP.' }

$versionUri = "http://127.0.0.1:$zapPort/JSON/core/view/version/"
for ($attempt = 1; $attempt -le 90; $attempt++) {
    try {
        $version = Invoke-RestMethod -Uri $versionUri -Headers @{ 'X-ZAP-API-Key' = $key } -Method Get -TimeoutSec 2
        if ($null -ne $version.version) {
            Write-Host "FlowScope ZAP is ready at http://127.0.0.1:$zapPort."
            Write-Host "The API key is stored in $keyFile and is read by FlowScope automatically."
            Write-Host "Next: confirm Burp SCANNER 127.0.0.1:$scannerPort, then run .\scripts\doctor.ps1."
            exit 0
        }
    } catch {
        # ZAP is still starting; the API key and exception text are intentionally not printed.
    }
    Start-Sleep -Seconds 1
}

throw 'ZAP did not become ready. Run docker compose -p flowscope-zap -f infra/zap/compose.yaml logs.'
