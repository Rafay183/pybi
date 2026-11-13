; PyBI Windows installer (Inno Setup 6.3+).
; Built by installer\build\build.ps1, which passes AppVersion, NumVersion, StageDir, OutputDir, AppRepo.
;
; * Installs per user into %LOCALAPPDATA%\Programs\PyBI: no admin rights, no UAC prompt.
; * Ships its own Python and every dependency: works offline, never touches a system Python.
; * Upgrades in place (same AppId): the launcher runs this installer with /SILENT to update.
; * NEVER change AppId, or updates will install a second copy instead of upgrading.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef NumVersion
  #define NumVersion "0.0.0.0"
#endif
#ifndef StageDir
  #define StageDir "..\build\installer\stage"
#endif
#ifndef OutputDir
  #define OutputDir "..\dist"
#endif
#ifndef AppRepo
  #define AppRepo "Rafay183/pybi"
#endif

#define AppName "PyBI"
#define AppExe "PyBI.exe"
#define AppURL "https://github.com/" + AppRepo

[Setup]
AppId={{3C5B5500-1278-4D14-842B-8CA8CD2C6230}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=PyBI contributors
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases
AppCopyright=PyBI contributors
VersionInfoVersion={#NumVersion}
VersionInfoProductVersion={#NumVersion}
VersionInfoDescription={#AppName} Setup
VersionInfoProductTextVersion={#AppVersion}

DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
UsePreviousAppDir=yes
UsePreviousTasks=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0

OutputDir={#OutputDir}
OutputBaseFilename=PyBI-Setup
SetupIconFile=assets\pybi.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
WizardStyle=modern
WizardSizePercent=110
WizardImageFile=assets\wizard.bmp,assets\wizard@2x.bmp
WizardSmallImageFile=assets\wizard-small.bmp,assets\wizard-small@2x.bmp
Compression=lzma2/ultra64
SolidCompression=yes
LZMANumBlockThreads=4
CloseApplications=force
RestartApplications=no
SetupLogging=yes
ShowLanguageDialog=no
#ifexist "..\LICENSE"
LicenseFile=..\LICENSE
#endif
#ifexist "..\LICENSE.txt"
LicenseFile=..\LICENSE.txt
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
WelcomeLabel2=This will install [name/ver] on your computer.%n%nPyBI comes with its own Python and every library it needs, so there is nothing else to install. It runs privately on your computer and opens in your web browser.%n%nAdministrator rights are not needed.
FinishedLabel=PyBI is installed.%n%nOpen it any time from the PyBI icon on your desktop or in the Start menu. It opens in your web browser at a local address (http://127.0.0.1).

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop icon"; GroupDescription: "Shortcuts:"
Name: "autoupdate"; Description: "Check for &updates automatically (recommended)"; GroupDescription: "Updates:"

[InstallDelete]
; Remove the previous runtime and launcher first, so no stale packages survive an upgrade.
Type: filesandordirs; Name: "{app}\runtime"
Type: filesandordirs; Name: "{app}\_internal"

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "assets\pybi.ico"; DestDir: "{app}\assets"; Flags: ignoreversion

[INI]
Filename: "{app}\settings.ini"; Section: "updates"; Key: "auto_check"; String: "1"; Tasks: autoupdate
Filename: "{app}\settings.ini"; Section: "updates"; Key: "auto_check"; String: "0"; Tasks: not autoupdate

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\assets\pybi.ico"; Comment: "Open PyBI in your browser"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\assets\pybi.ico"; Comment: "Open PyBI in your browser"; Tasks: desktopicon

[Run]
; Runs after a normal install (checkbox on the last page) and after a silent update, so PyBI reopens by itself.
; CI smoke tests pass /NOLAUNCH=1 to skip it.
Filename: "{app}\{#AppExe}"; Description: "Open PyBI now"; Flags: nowait postinstall; Check: ShouldLaunch

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/IM {#AppExe} /T /F"; Flags: runhidden; RunOnceId: "StopPyBI"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\runtime"
Type: filesandordirs; Name: "{app}\_internal"
Type: files; Name: "{app}\settings.ini"
Type: filesandordirs; Name: "{localappdata}\PyBI\updates"

[Code]
function ShouldLaunch: Boolean;
begin
  Result := ExpandConstant('{param:NOLAUNCH|0}') = '0';
end;

procedure StopRunningPyBI;
var
  Code: Integer;
  Cmd, AppPath: String;
begin
  { The launcher, then any PyBI server still running from this install's private Python. }
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM {#AppExe} /T /F', '', SW_HIDE, ewWaitUntilTerminated, Code);
  AppPath := ExpandConstant('{app}');
  StringChangeEx(AppPath, '''', '''''', True);  { escape apostrophes for PowerShell }
  Cmd := '-NoProfile -ExecutionPolicy Bypass -Command "Get-Process python,pythonw -ErrorAction SilentlyContinue | ' +
         'Where-Object { $_.Path -like ''' + AppPath + '\runtime\*'' } | Stop-Process -Force"';
  Exec('powershell.exe', Cmd, '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopRunningPyBI;
  Result := '';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    StopRunningPyBI;
  if CurUninstallStep = usPostUninstall then
    if not UninstallSilent then
      if MsgBox('Also remove PyBI''s logs and settings?' + #13#10#13#10 +
                'Your dashboards in Documents\PyBI are always kept.', mbConfirmation, MB_YESNO) = IDYES then
        DelTree(ExpandConstant('{localappdata}\PyBI'), True, True, True);
end;
