[CmdletBinding()]
param([switch] $Build)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:Failures = 0
$script:Warnings = 0

function Write-Ok([string] $Message) { Write-Host "OK    $Message" }
function Write-WarningResult([string] $Message) {
    Write-Host "WARN  $Message"
    $script:Warnings++
}
function Write-Failure([string] $Message) {
    Write-Host "FAIL  $Message"
    $script:Failures++
}
function Get-EnvironmentPort([string] $Name, [int] $DefaultValue) {
    $raw = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($raw)) { return $DefaultValue }
    $parsed = 0
    if (-not [int]::TryParse($raw, [ref] $parsed) -or $parsed -lt 1 -or $parsed -gt 65535) {
        throw "$Name must be a TCP port from 1 to 65535."
    }
    return $parsed
}
function Test-LocalPort([int] $Port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        return $client.ConnectAsync('127.0.0.1', $Port).Wait(1000) -and $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}
function Test-OwnerOnlyAcl([string] $Path) {
    try {
        $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $acl = Get-Acl -LiteralPath $Path
        if (-not $acl.AreAccessRulesProtected) { return $false }
        foreach ($rule in $acl.Access) {
            if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
            $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
            if ($sid -ne $currentSid) { return $false }
        }
        return $true
    } catch {
        return $false
    }
}
function Invoke-ZapApi([string] $Path, [string] $Key, [int] $Port) {
    return Invoke-RestMethod -Uri "http://127.0.0.1:$Port$Path" -Headers @{ 'X-ZAP-API-Key' = $Key } -Method Get -TimeoutSec 4
}

if (-not $IsWindows) { throw 'doctor.ps1 is for Windows. Use scripts/doctor.sh on macOS/Linux.' }
Write-Host 'FlowScope Windows environment check'

$humanPort = Get-EnvironmentPort 'FLOWSCOPE_HUMAN_PORT' 8080
$scannerPort = Get-EnvironmentPort 'FLOWSCOPE_BURP_SCANNER_PORT' 8081
$zapPort = Get-EnvironmentPort 'FLOWSCOPE_ZAP_PORT' 8089
$webPort = Get-EnvironmentPort 'FLOWSCOPE_WEB_PORT' 17777

if (Test-LocalPort $humanPort) { Write-Ok "HUMAN port 127.0.0.1:$humanPort is open" }
else { Write-Failure "HUMAN port 127.0.0.1:$humanPort is closed" }
if (Test-LocalPort $scannerPort) { Write-Ok "SCANNER port 127.0.0.1:$scannerPort is open" }
else { Write-Failure "SCANNER port 127.0.0.1:$scannerPort is closed" }

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
$key = ''
if (Test-Path -LiteralPath $keyFile -PathType Leaf) {
    $item = Get-Item -LiteralPath $keyFile -Force
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        Write-Failure "ZAP key file is a link: $keyFile"
    } else {
        $key = [System.IO.File]::ReadAllText($keyFile).Trim()
        if ($key -match '^[A-Za-z0-9._~-]+$' -and $key.Length -ge 32 -and $key.Length -le 256) {
            Write-Ok 'local ZAP key file has a valid format'
        } else {
            Write-Failure 'ZAP key file has an invalid format'
        }
        if (Test-OwnerOnlyAcl $keyFile) { Write-Ok 'ZAP key ACL is restricted to the current Windows user' }
        else { Write-Failure 'ZAP key ACL is inherited or grants another identity access; rerun zap-up.ps1' }
    }
} else {
    Write-Failure "ZAP key file is absent: $keyFile"
}

if (-not [string]::IsNullOrWhiteSpace($key)) {
    try {
        $version = Invoke-ZapApi '/JSON/core/view/version/' $key $zapPort
        if ($version.version -eq '2.17.0') { Write-Ok 'ZAP 2.17.0 API is reachable on loopback' }
        else { Write-WarningResult "ZAP API version is $($version.version), not the tested 2.17.0 baseline" }

        $enabled = Invoke-ZapApi '/JSON/network/view/isHttpProxyEnabled/' $key $zapPort
        $proxy = Invoke-ZapApi '/JSON/network/view/getHttpProxy/' $key $zapPort
        $proxyJson = $proxy | ConvertTo-Json -Compress -Depth 8
        if ($enabled.isHttpProxyEnabled -eq 'true' -and
            $proxyJson -match [regex]::Escape($scannerPort.ToString()) -and
            ($proxyJson -match 'host\.docker\.internal' -or $proxyJson -match '127\.0\.0\.1' -or $proxyJson -match 'localhost')) {
            Write-Ok 'ZAP upstream proxy points to the Burp SCANNER listener'
        } else {
            Write-Failure "ZAP upstream proxy is not enabled for the local Burp SCANNER port $scannerPort"
        }

        $addOns = Invoke-ZapApi '/JSON/autoupdate/view/installedAddons/' $key $zapPort
        $installedIds = @($addOns.installedAddons | ForEach-Object { $_.id })
        $missing = @(@('spider', 'client', 'spiderAjax', 'pscan', 'pscanrules', 'selenium', 'openapi', 'websocket', 'network', 'replacer') |
            Where-Object { $_ -notin $installedIds })
        if ($missing.Count -eq 0) { Write-Ok 'required ZAP crawler/passive/API/WebSocket/Network add-ons are installed' }
        else { Write-Failure "missing required ZAP add-on(s): $($missing -join ', ')" }
    } catch {
        Write-Failure "ZAP API is not reachable at 127.0.0.1:$zapPort"
    }
}

if (Test-LocalPort $webPort) { Write-Ok "FlowScope Web UI port $webPort is open" }
else { Write-WarningResult "FlowScope Web UI port $webPort is closed; load the JAR in Burp" }

if ($Build) {
    $maven = Get-Command mvn -ErrorAction SilentlyContinue
    if ($null -eq $maven) {
        Write-Failure 'Maven 3.9 or newer is required for source builds'
        Write-Failure 'Maven JDK could not be checked'
    } else {
        $mavenOutput = @(& mvn -version 2>&1)
        $mavenVersion = if ($mavenOutput.Count -gt 0 -and $mavenOutput[0] -match 'Apache Maven ([0-9.]+)') { $Matches[1] } else { '' }
        $javaVersion = ''
        $javaLine = $mavenOutput | Where-Object { $_ -match '^Java version:' } | Select-Object -First 1
        if ($javaLine -match 'Java version:\s*([^, ]+)') { $javaVersion = $Matches[1] }
        $mavenParts = $mavenVersion.Split('.')
        if ($mavenParts.Count -ge 2 -and [int]$mavenParts[0] -eq 3 -and [int]$mavenParts[1] -ge 9) {
            Write-Ok "Maven $mavenVersion is available"
        } else { Write-Failure 'Maven 3.9 or newer is required for source builds' }
        $javaMajor = if ($javaVersion -match '^([0-9]+)') { [int]$Matches[1] } else { 0 }
        if ($javaMajor -ge 21) { Write-Ok "Maven uses JDK $javaVersion" }
        else { Write-Failure 'Maven must use JDK 21 or newer for source builds' }
    }
}

Write-Host "`nResult: $script:Failures failure(s), $script:Warnings warning(s)"
if ($script:Failures -gt 0) { exit 1 }
