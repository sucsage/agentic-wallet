; MilestonePay for Windows (the app in its own window): one Setup.exe, per-user install (no
; administrator rights), Start menu and desktop shortcuts, uninstaller. Built by the release workflow:
;   iscc /DAppVersion=<v> /DSourceDir=<electrobun build>\MilestonePay /DOutputDir=<dir> packaging\windows\window-installer.iss
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\electrobun\build\stable-win-x64\MilestonePay"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\electrobun\out"
#endif

[Setup]
AppId={{9B2D4C61-7E3A-4F08-A1C5-6D2E8F4B3A90}
AppName=MilestonePay
AppVersion={#AppVersion}
AppVerName=MilestonePay {#AppVersion}
AppPublisher=MilestonePay (FinTechathon 2026 demo)
AppPublisherURL=https://agentic-wallet-inky.vercel.app/download
AppComments=Milestone payments with your own deal chain. Test mode demo: no real money.
VersionInfoDescription=MilestonePay Setup
VersionInfoProductName=MilestonePay
VersionInfoVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\MilestonePay
DefaultGroupName=MilestonePay
DisableProgramGroupPage=yes
DisableDirPage=yes
DisableReadyPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=MilestonePay-{#AppVersion}-window-windows-x64-Setup
SetupIconFile=..\icons\icon.ico
UninstallDisplayIcon={app}\bin\launcher.exe
UninstallDisplayName=MilestonePay
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
WelcomeLabel2=This installs MilestonePay {#AppVersion} on your computer.%n%nYour deals as your own signed chain, an AI that drafts them, and escrow that pays per milestone. Test mode demo: no real money.%n%nClose MilestonePay before you continue.
FinishedLabel=MilestonePay is installed. Open it from the Start menu or the desktop.%n%nClosing its window keeps it running in the tray; Quit is in the tray menu.

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[InstallDelete]
; An older version's files: the new ones replace them all. Your wallet data (%APPDATA%) is kept.
Type: filesandordirs; Name: "{app}\bin"
Type: filesandordirs; Name: "{app}\Resources"
Type: filesandordirs; Name: "{app}\lib"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\MilestonePay"; Filename: "{app}\bin\launcher.exe"; WorkingDir: "{app}\bin"; IconFilename: "{app}\Resources\app.ico"; AppUserModelID: "app.milestonepay.desktop"
Name: "{group}\Uninstall MilestonePay"; Filename: "{uninstallexe}"
Name: "{userdesktop}\MilestonePay"; Filename: "{app}\bin\launcher.exe"; WorkingDir: "{app}\bin"; IconFilename: "{app}\Resources\app.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\bin\launcher.exe"; WorkingDir: "{app}\bin"; Description: "Open MilestonePay"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /T /IM launcher.exe"; Flags: runhidden; RunOnceId: "StopLauncher"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
