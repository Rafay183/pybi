<#
.SYNOPSIS
  Builds dist\PyBI-Setup.exe: private Python + pybi-ray + PyBI.exe launcher, packed with Inno Setup.

.DESCRIPTION
  Runs on GitHub Actions (windows-latest) or on any Windows 10/11 PC with Python 3.11 on PATH.

    .\installer\scripts\build.ps1 -Version 1.2.0 -Repo Rafay183/pybi

  Steps
    1. Download the official CPython NuGet build (relocatable, no system install) into stage\runtime
    2. pip install the package from this repo (or -PackageSpec) and its dependencies into it
    3. Freeze installer\launcher into PyBI.exe with PyInstaller, with the ر icon and version info
    4. Write launcher.json (version + GitHub repo used by the auto-updater)
    5. Optionally code-sign (env PYBI_SIGN_PFX + PYBI_SIGN_PASSWORD)
    6. Compile installer\pybi.iss with Inno Setup and write the .sha256 next to it
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Repo = "",
  [string]$PythonVersion = "3.11.9",
  [string]$PackageSpec = "",
  [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # makes Invoke-WebRequest much faster

$Installer = Split-Path -Parent $PSScriptRoot          # ...\installer
$Root      = Split-Path -Parent $Installer             # repo root
$Build     = Join-Path $Root "build\installer"
$Stage     = Join-Path $Build "stage"
$Dist      = Join-Path $Root "dist"
$Assets    = Join-Path $Installer "assets"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Run([string]$exe, [string[]]$argv) {
  & $exe @argv
  if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $exe $($argv -join ' ')" }
}
function Write-Utf8NoBom($path, $text) {
  [IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding $false))
}

# Numeric 4-part version for Windows file metadata: 1.2.3rc1 -> 1.2.3.0
$nums = [regex]::Match($Version, '^\d+(\.\d+){0,3}').Value
if (-not $nums) { throw "Version '$Version' must start with a number, e.g. 1.2.0" }
$parts = @($nums.Split('.')) + @('0', '0', '0', '0')
$NumVersion = ($parts[0..3] -join '.')

Step "Clean build folders"
Remove-Item -Recurse -Force $Build -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Stage, $Dist | Out-Null

# ------------------------------------------------------------------ 1. runtime
Step "Download Python $PythonVersion (NuGet build)"
$nupkg = Join-Path $Build "python.$PythonVersion.zip"
Invoke-WebRequest -Uri "https://www.nuget.org/api/v2/package/python/$PythonVersion" -OutFile $nupkg
Expand-Archive -Path $nupkg -DestinationPath (Join-Path $Build "nuget") -Force
Copy-Item -Recurse (Join-Path $Build "nuget\tools") (Join-Path $Stage "runtime")
$Py = Join-Path $Stage "runtime\python.exe"
Run $Py @("-c", "import sys, ssl, sqlite3; print(sys.version)")

Step "Install pip into the runtime"
& $Py -m pip --version 2>$null
if ($LASTEXITCODE -ne 0) { Run $Py @("-m", "ensurepip", "--upgrade") }
Run $Py @("-m", "pip", "install", "--upgrade", "--no-warn-script-location", "--disable-pip-version-check", "pip", "setuptools", "wheel")

Step "Install PyBI and its dependencies"
if (-not $PackageSpec) {
  if ((Test-Path (Join-Path $Root "pyproject.toml")) -or (Test-Path (Join-Path $Root "setup.py"))) {
    $PackageSpec = $Root                       # build exactly the tagged source
  } else {
    $PackageSpec = "pybi-ray==$Version"        # fall back to the PyPI release
  }
}
Write-Host "Package: $PackageSpec"
Run $Py @("-m", "pip", "install", "--no-warn-script-location", "--disable-pip-version-check", $PackageSpec)
$extra = Join-Path $Installer "requirements-extra.txt"
if (Test-Path $extra) {
  Run $Py @("-m", "pip", "install", "--no-warn-script-location", "--disable-pip-version-check", "-r", $extra)
}
Run $Py @("-c", "import pybi; print('pybi', getattr(pybi, '__version__', '(no __version__)'), 'from', pybi.__file__)")

Step "Precompile bytecode (faster first start)"
& $Py -m compileall -q -j 0 (Join-Path $Stage "runtime\Lib") | Out-Null
# pip's .exe shims in Scripts\ point at the build machine; python -m pip keeps working.
Remove-Item -Force (Join-Path $Stage "runtime\Scripts\*.exe") -ErrorAction SilentlyContinue

# ------------------------------------------------------------------ 2. launcher
Step "Freeze the launcher into PyBI.exe"
Run "python" @("-m", "pip", "install", "--disable-pip-version-check", "pyinstaller==6.11.1")
$vfile = Join-Path $Build "version_info.txt"
$tuple = ($parts[0..3] -join ', ')
Write-Utf8NoBom $vfile @"
VSVersionInfo(
  ffi=FixedFileInfo(filevers=($tuple), prodvers=($tuple), mask=0x3f, flags=0x0, OS=0x40004,
                    fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('040904B0', [
      StringStruct('CompanyName', 'PyBI contributors'),
      StringStruct('FileDescription', 'PyBI'),
      StringStruct('FileVersion', '$Version'),
      StringStruct('InternalName', 'PyBI'),
      StringStruct('OriginalFilename', 'PyBI.exe'),
      StringStruct('ProductName', 'PyBI'),
      StringStruct('ProductVersion', '$Version')])]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
"@
$launcher = Join-Path $Installer "launcher"
Run "python" @("-m", "PyInstaller", "--noconfirm", "--clean", "--windowed", "--onedir",
  "--name", "PyBI",
  "--icon", (Join-Path $Assets "pybi.ico"),
  "--version-file", $vfile,
  "--paths", $launcher,
  "--add-data", "$(Join-Path $Assets 'pybi.png');assets",
  "--add-data", "$(Join-Path $Assets 'pybi.ico');assets",
  "--distpath", (Join-Path $Build "dist"),
  "--workpath", (Join-Path $Build "work"),
  "--specpath", $Build,
  (Join-Path $launcher "main.py"))
Copy-Item -Recurse -Force (Join-Path $Build "dist\PyBI\*") $Stage

# ------------------------------------------------------------------ 3. config
Step "Write launcher.json"
$cfg = [ordered]@{}
$base = Join-Path $launcher "launcher.json"
if (Test-Path $base) {
  (Get-Content $base -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $cfg[$_.Name] = $_.Value }
}
$cfg["version"] = $Version
if ($Repo) { $cfg["github_repo"] = $Repo }
Write-Utf8NoBom (Join-Path $Stage "launcher.json") ($cfg | ConvertTo-Json -Depth 5)
Get-Content (Join-Path $Stage "launcher.json")

# ------------------------------------------------------------------ 4. signing (optional)
function Sign($file) {
  if (-not $env:PYBI_SIGN_PFX) { return }
  $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
              Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $signtool) { Write-Warning "signtool.exe not found; skipping signing"; return }
  Run $signtool.FullName @("sign", "/f", $env:PYBI_SIGN_PFX, "/p", $env:PYBI_SIGN_PASSWORD,
    "/fd", "sha256", "/tr", "http://timestamp.digicert.com", "/td", "sha256", $file)
}
Sign (Join-Path $Stage "PyBI.exe")

if ($SkipInstaller) { Write-Host "Stage ready at $Stage"; return }

# ------------------------------------------------------------------ 5. installer
Step "Compile installer with Inno Setup"
$iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
# pybi.iss uses x64compatible, which needs Inno Setup 6.3 or newer
$needInno = -not (Test-Path $iscc)
if (-not $needInno) { $needInno = ([version](Get-Item $iscc).VersionInfo.FileVersion) -lt [version]"6.3" }
if ($needInno) { Run "choco" @("upgrade", "innosetup", "-y", "--no-progress") }
$isccArgs = @("/Q", "/DAppVersion=$Version", "/DNumVersion=$NumVersion", "/DStageDir=$Stage", "/DOutputDir=$Dist")
if ($Repo) { $isccArgs += "/DAppRepo=$Repo" }
Run $iscc ($isccArgs + @((Join-Path $Installer "pybi.iss")))
$setup = Join-Path $Dist "PyBI-Setup.exe"
Sign $setup

$hash = (Get-FileHash -Algorithm SHA256 $setup).Hash.ToLower()
[IO.File]::WriteAllText("$setup.sha256", "$hash  PyBI-Setup.exe`n", [Text.Encoding]::ASCII)
$size = "{0:N1} MB" -f ((Get-Item $setup).Length / 1MB)
Step "Done: $setup ($size)  sha256 $hash"
