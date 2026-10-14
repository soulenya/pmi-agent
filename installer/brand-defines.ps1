<#
.SYNOPSIS
    Emit the iscc /D defines for the current brand (brand\brand.json).

.DESCRIPTION
    Reads brand\brand.json at the repo root and prints one /DName=Value per
    line: AppPublisher, AppURL, AppId, InstallDirName, SetupName, DataDirName,
    AppDescription. With no brand file nothing is printed and setup.iss uses
    its PMI defaults. Used by build-installer.bat and the Windows release
    workflow:

        $defs = & installer\brand-defines.ps1
        & iscc.exe @defs installer\setup.iss
#>
[CmdletBinding()]
param(
    [string]$BrandFile = "",
    # Wrap each define in double quotes (values may contain spaces) for cmd.exe.
    [switch]$Quoted,
    # Print only the setup base name (e.g. LittleGerry_Setup).
    [switch]$SetupNameOnly
)

if (-not $BrandFile) {
    # $PSScriptRoot is empty in a param default under Windows PowerShell 5.
    $here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $BrandFile = Join-Path (Split-Path -Parent $here) "brand\brand.json"
}

$b = if (Test-Path $BrandFile) { Get-Content $BrandFile -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }

if ($SetupNameOnly) {
    $n = if ($b -and $b.windows.setup_name) { $b.windows.setup_name } else { "LittleGerry_Setup" }
    Write-Output $n
    return
}
if (-not $b) { return }

function Def($name, $value) {
    if ($null -ne $value -and "$value".Trim() -ne "") {
        if ($Quoted) { "`"/D$name=$value`"" } else { "/D$name=$value" }
    }
}

Def "AppPublisher"   $b.publisher
Def "AppURL"         $(if ($b.github_repo) { "https://github.com/$($b.github_repo)" })
Def "AppId"          $b.windows.app_id
Def "InstallDirName" $b.windows.install_dir_name
Def "SetupName"      $b.windows.setup_name
Def "DataDirName"    $b.data_dir_name
Def "AppDescription" $(if ($b.product.name) { "AI Executive Assistant for the $($b.product.name) Program" } elseif ($b.company_short) { "AI Executive Assistant for $($b.company_short)" })
