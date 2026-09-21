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
# 기존 파일의 보안기술자를 읽어 DACL만 잠근다. 빈 FileSecurity를 새로 만들면 owner·SACL 섹션까지
# 쓰려다 관리자 권한(SeSecurityPrivilege)을 요구하므로, 파일 생성자(=현재 사용자)가 그대로 소유한
# 채로 상속을 끊고 현재 사용자 FullControl 하나만 남긴다.
$acl = Get-Acl -LiteralPath $keyFile
$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRule($rule) }
$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
    $identity.User,
    [System.Security.AccessControl.FileSystemRights]::FullControl,
    [System.Security.AccessControl.AccessControlType]::Allow))
Set-Acl -LiteralPath $keyFile -AclObject $acl

$key = [System.IO.File]::ReadAllText($keyFile).Trim()
if ($key -notmatch '^[A-Za-z0-9._~-]+$' -or $key.Length -lt 32 -or $key.Length -gt 256) {
    throw "Invalid ZAP key file: $keyFile"
}

Write-Host "FlowScope ZAP API key is ready at $keyFile. The key value was not printed."
