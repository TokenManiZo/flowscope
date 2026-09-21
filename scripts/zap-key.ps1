[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ((Test-Path Variable:\IsWindows) -and -not $IsWindows) { throw 'zap-key.ps1 is for Windows. Use scripts/zap-key.sh on macOS/Linux.' }

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

if (-not (Test-Path -LiteralPath $keyFile)) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $keyFile) | Out-Null
    $bytes = [byte[]]::new(32)
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    $key = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    [System.IO.File]::WriteAllText($keyFile, $key + [Environment]::NewLine,
        [System.Text.UTF8Encoding]::new($false))
}

$keyItem = Get-Item -LiteralPath $keyFile -Force
if ($keyItem.PSIsContainer -or ($keyItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    throw "ZAP key must be a regular file, not a directory or link: $keyFile"
}

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
# Windows에서 DACL만 잠근다. Set-Acl cmdlet은 SACL(audit) 섹션까지 쓰려 해서 비관리자에게
# SeSecurityPrivilege를 요구하므로, 네이티브 icacls로 상속을 끊고 현재 사용자에게만 FullControl을
# 부여한다(파일 소유자는 관리자 권한 없이 DACL을 바꿀 수 있다).
& icacls $keyFile /inheritance:r /grant:r "$($identity.Name):(F)" *> $null
if ($LASTEXITCODE -ne 0) { throw "Could not restrict the ZAP key file ACL: $keyFile" }

$key = [System.IO.File]::ReadAllText($keyFile).Trim()
if ($key -notmatch '^[A-Za-z0-9._~-]+$' -or $key.Length -lt 32 -or $key.Length -gt 256) {
    throw "Invalid ZAP key file: $keyFile"
}

Write-Host "FlowScope ZAP API key is ready at $keyFile. The key value was not printed."
