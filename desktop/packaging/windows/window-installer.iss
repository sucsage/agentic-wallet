; Kravii for Windows (the app in its own window): one Setup.exe, per-user install (no
; administrator rights), Start menu and desktop shortcuts, uninstaller. Built by the release workflow:
;   iscc /DAppVersion=<v> /DSourceDir=<electrobun build>\Kravii /DOutputDir=<dir> packaging\windows\window-installer.iss
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\electrobun\build\stable-win-x64\Kravii"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\electrobun\out"
#endif

[Setup]
AppId={{9B2D4C61-7E3A-4F08-A1C5-6D2E8F4B3A90}
AppName=Kravii
AppVersion={#AppVersion}
AppVerName=Kravii {#AppVersion}
AppPublisher=Kravii (FinTechathon 2026 demo)
AppPublisherURL=https://agentic-wallet-inky.vercel.app/download
AppComments=Milestone payments with your own deal chain. Test mode demo: no real money.
VersionInfoDescription=Kravii Setup
VersionInfoProductName=Kravii
VersionInfoVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\Kravii
DefaultGroupName=Kravii
DisableProgramGroupPage=yes
DisableDirPage=yes
DisableReadyPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=Kravii-{#AppVersion}-window-windows-x64-Setup
SetupIconFile=..\icons\icon.ico
UninstallDisplayIcon={app}\bin\launcher.exe
UninstallDisplayName=Kravii
Compression=lzma2/ultra64
SolidCompression=yes
#if Ver >= EncodeVer(6,6,0)
WizardStyle=modern dark
#else
WizardStyle=modern
#endif
WizardImageFile=wizard-100.bmp,wizard-250.bmp
WizardSmallImageFile=small-100.bmp,small-250.bmp
WizardImageStretch=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=force
RestartApplications=no

[Messages]
WelcomeLabel2=This installs Kravii {#AppVersion} on your computer.%n%nYour deals as your own signed chain, an AI that drafts them, and escrow that pays per milestone. Test mode demo: no real money.%n%nClose Kravii before you continue.
FinishedLabel=Kravii is installed. Open it from the Start menu or the desktop.%n%nClosing its window keeps it running in the tray; Quit is in the tray menu.

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[InstallDelete]
; An older version's files: the new ones replace them all. Your wallet data (%APPDATA%) is kept.
Type: filesandordirs; Name: "{app}\bin"
Type: filesandordirs; Name: "{app}\Resources"
Type: filesandordirs; Name: "{app}\lib"
; MilestonePay was the old name: its shortcuts go (the install itself is the same, AppId).
Type: filesandordirs; Name: "{userprograms}\MilestonePay"
Type: files; Name: "{userdesktop}\MilestonePay.lnk"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Kravii"; Filename: "{app}\bin\launcher.exe"; WorkingDir: "{app}\bin"; IconFilename: "{app}\Resources\app.ico"; AppUserModelID: "app.milestonepay.desktop"
Name: "{group}\Uninstall Kravii"; Filename: "{uninstallexe}"
Name: "{userdesktop}\Kravii"; Filename: "{app}\bin\launcher.exe"; WorkingDir: "{app}\bin"; IconFilename: "{app}\Resources\app.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\bin\launcher.exe"; WorkingDir: "{app}\bin"; Description: "Open Kravii"; Flags: nowait postinstall skipifsilent
; An update from inside the app runs this installer silently: open Kravii again afterwards.
Filename: "{app}\bin\launcher.exe"; WorkingDir: "{app}\bin"; Flags: nowait runasoriginaluser; Check: WizardSilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /T /IM launcher.exe"; Flags: runhidden; RunOnceId: "StopLauncher"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
// Before copying: stop any copy of Kravii still running (in the tray, an older version installed here,
// or the old browser build), so its files are not locked and the new version is the one that opens.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
  Cmd: String;
begin
  Cmd := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-Process | Where-Object { $_.Path -and ($_.Path.StartsWith(''' +
    ExpandConstant('{app}') + '\'', ''OrdinalIgnoreCase'') -or $_.ProcessName -like ''AgenticWallet*'' -or $_.ProcessName -like ''MilestonePay*'') } | Stop-Process -Force"';
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Cmd, '', SW_HIDE, ewWaitUntilTerminated, Code);
  Result := '';
end;
