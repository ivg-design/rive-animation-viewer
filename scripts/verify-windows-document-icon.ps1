[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExpectedVersion,

    [string]$InstallDir,

    [string]$ExpectedIconSha256,

    [ValidateSet('NSS', 'MSI')]
    [string]$ExpectedBundleType = 'NSS',

    [string]$ExpectedPreviousProgId,

    [string]$ReceiptPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-DefaultRegistryValue {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Registry key does not exist: $Path"
    }
    return (Get-Item -LiteralPath $Path).GetValue(
        '',
        $null,
        [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
    )
}

function Resolve-IconPath {
    param([Parameter(Mandatory = $true)][string]$IconSpec)

    $expanded = [Environment]::ExpandEnvironmentVariables($IconSpec.Trim())
    if ($expanded -match '^"([^"]+)"(?:,-?\d+)?$') {
        return $Matches[1]
    }
    if ($expanded -match '^(.+?)(?:,-?\d+)?$') {
        return $Matches[1].Trim()
    }
    throw "Cannot parse DefaultIcon value: $IconSpec"
}

function Find-RavInstall {
    $registryRoots = @(
        'Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'Registry::HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'Registry::HKEY_LOCAL_MACHINE\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
    )

    foreach ($root in $registryRoots) {
        if (-not (Test-Path -LiteralPath $root)) {
            continue
        }
        foreach ($entry in Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue) {
            $properties = Get-ItemProperty -LiteralPath $entry.PSPath -ErrorAction SilentlyContinue
            if ($null -eq $properties) {
                continue
            }

            $displayNameProperty = $properties.PSObject.Properties['DisplayName']
            if ($null -eq $displayNameProperty -or [string]$displayNameProperty.Value -ne 'Rive Animation Viewer') {
                continue
            }

            $installLocationProperty = $properties.PSObject.Properties['InstallLocation']
            $uninstallStringProperty = $properties.PSObject.Properties['UninstallString']
            $displayVersionProperty = $properties.PSObject.Properties['DisplayVersion']

            $candidate = if ($installLocationProperty) { ([string]$installLocationProperty.Value).Trim('"') } else { '' }
            if (-not $candidate -and $uninstallStringProperty -and $uninstallStringProperty.Value) {
                $uninstaller = ([string]$uninstallStringProperty.Value).Trim('"')
                $candidate = Split-Path -Parent $uninstaller
            }
            if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Container)) {
                return [pscustomobject]@{
                    InstallDir = $candidate
                    DisplayVersion = if ($displayVersionProperty) { [string]$displayVersionProperty.Value } else { '' }
                    UninstallRegistryPath = $entry.Name
                }
            }
        }
    }
    throw 'Cannot locate an installed Rive Animation Viewer package.'
}

$expectedProgId = if ($ExpectedBundleType -eq 'NSS') { 'Rive File' } else { 'Rive Animation Viewer.riv' }
$registryScope = if ($ExpectedBundleType -eq 'NSS') {
    'Registry::HKEY_CURRENT_USER\Software\Classes'
} else {
    'Registry::HKEY_LOCAL_MACHINE\Software\Classes'
}

if ($ExpectedBundleType -eq 'MSI' -and -not $InstallDir) {
    throw 'MSI acceptance requires -InstallDir so the per-machine payload is checked unambiguously.'
}

$install = $null
if (-not $InstallDir) {
    $install = Find-RavInstall
    $InstallDir = $install.InstallDir
}
$InstallDir = (Resolve-Path -LiteralPath $InstallDir).Path

$appExe = Join-Path $InstallDir 'app.exe'
if (-not (Test-Path -LiteralPath $appExe -PathType Leaf)) {
    throw "Installed RAV executable does not exist: $appExe"
}

$versionInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($appExe)
if ($versionInfo.ProductVersion -ne $ExpectedVersion) {
    throw "Installed ProductVersion '$($versionInfo.ProductVersion)' does not equal expected '$ExpectedVersion'."
}
if ($install -and $install.DisplayVersion -and $install.DisplayVersion -ne $ExpectedVersion) {
    throw "Installer DisplayVersion '$($install.DisplayVersion)' does not equal expected '$ExpectedVersion'."
}

$bundleMarker = "__TAURI_BUNDLE_TYPE_VAR_$ExpectedBundleType"
$binaryText = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($appExe))
if ($binaryText.IndexOf($bundleMarker, [StringComparison]::Ordinal) -lt 0) {
    throw "Installed executable does not contain expected Tauri bundle marker '$bundleMarker'."
}
$binaryText = $null

$extensionKey = "$registryScope\.riv"
$progId = [string](Get-DefaultRegistryValue -Path $extensionKey)
if ([string]::IsNullOrWhiteSpace($progId)) {
    throw "$extensionKey does not resolve to a ProgID."
}
if ($progId -ne $expectedProgId) {
    throw "Installed $ExpectedBundleType .riv ProgID '$progId' does not equal expected '$expectedProgId'."
}

$previousProgId = $null
if ($ExpectedBundleType -eq 'NSS') {
    $extensionRegistryKey = Get-Item -LiteralPath $extensionKey
    $previousProgId = [string]$extensionRegistryKey.GetValue(
        'Rive File_backup',
        $null,
        [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
    )
    if ($ExpectedPreviousProgId -and $previousProgId -ne $ExpectedPreviousProgId) {
        throw "Preserved pre-RAV ProgID '$previousProgId' does not equal expected '$ExpectedPreviousProgId'."
    }
} elseif ($ExpectedPreviousProgId) {
    throw '-ExpectedPreviousProgId applies only to the NSIS acceptance path.'
}

if ($ExpectedBundleType -eq 'MSI') {
    $hkcuExtensionKey = 'Registry::HKEY_CURRENT_USER\Software\Classes\.riv'
    $hkcuProgIdKey = "Registry::HKEY_CURRENT_USER\Software\Classes\$expectedProgId"
    if ((Test-Path -LiteralPath $hkcuExtensionKey) -or (Test-Path -LiteralPath $hkcuProgIdKey)) {
        throw 'MSI acceptance requires no HKCU .riv or ProgID shadow over the HKLM registration.'
    }
}

$progIdKey = "$registryScope\$progId"
if (-not (Test-Path -LiteralPath $progIdKey)) {
    throw "The active .riv ProgID does not exist: $progId"
}

$defaultIconKey = "$progIdKey\DefaultIcon"
$defaultIcon = [string](Get-DefaultRegistryValue -Path $defaultIconKey)
if ([string]::IsNullOrWhiteSpace($defaultIcon)) {
    throw "The active .riv ProgID has no DefaultIcon value: $progId"
}
if ($defaultIcon -match '(?i)app\.exe') {
    throw "The active .riv icon still points at the application executable: $defaultIcon"
}

$iconPath = Resolve-IconPath -IconSpec $defaultIcon
$expectedIconPath = Join-Path $InstallDir 'RiveFileIcon.ico'
$expectedDefaultIcon = "`"$expectedIconPath`",0"
if (-not [string]::Equals($defaultIcon, $expectedDefaultIcon, [StringComparison]::OrdinalIgnoreCase)) {
    throw "DefaultIcon '$defaultIcon' does not equal expected '$expectedDefaultIcon'."
}
if (-not [string]::Equals(
    [IO.Path]::GetFullPath($iconPath),
    [IO.Path]::GetFullPath($expectedIconPath),
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "The active .riv icon path is outside the resolved install directory: $iconPath"
}
if (-not (Test-Path -LiteralPath $iconPath -PathType Leaf)) {
    throw "The registered .riv icon file does not exist: $iconPath"
}

$iconSha256 = (Get-FileHash -LiteralPath $iconPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ExpectedIconSha256 -and $iconSha256 -ne $ExpectedIconSha256.ToLowerInvariant()) {
    throw "Installed icon SHA-256 '$iconSha256' does not equal expected '$($ExpectedIconSha256.ToLowerInvariant())'."
}

$receipt = [ordered]@{
    schema = 'rav-windows-document-icon-acceptance-v1'
    checkedAtUtc = [DateTime]::UtcNow.ToString('o')
    expectedVersion = $ExpectedVersion
    productVersion = $versionInfo.ProductVersion
    fileVersion = $versionInfo.FileVersion
    installDir = $InstallDir
    appExe = $appExe
    bundleMarker = $bundleMarker
    registryScope = $registryScope
    expectedProgId = $expectedProgId
    progId = $progId
    previousProgId = $previousProgId
    defaultIcon = $defaultIcon
    iconPath = $iconPath
    iconSha256 = $iconSha256
    uninstallRegistryPath = if ($install) { $install.UninstallRegistryPath } else { $null }
}

$json = $receipt | ConvertTo-Json -Depth 3
if ($ReceiptPath) {
    $receiptParent = Split-Path -Parent $ReceiptPath
    if ($receiptParent) {
        New-Item -ItemType Directory -Path $receiptParent -Force | Out-Null
    }
    Set-Content -LiteralPath $ReceiptPath -Value $json -Encoding utf8
}
$json
