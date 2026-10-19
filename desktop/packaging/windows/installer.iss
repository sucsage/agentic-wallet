; Kravii for Windows: per-user install (no administrator rights), so the app can update itself.
; Built by the release workflow: iscc /DAppVersion=<v> /DSourceExe=<path> packaging\windows\installer.iss
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceExe
  #define SourceExe "..\..\dist\AgenticWallet-windows-x64.exe"
#endif

[Setup]
AppId={{6E3F8A52-2C1B-4C55-9B7E-4F1A9C0D7E21}
AppName=Kravii
AppVersion={#AppVersion}
AppPublisher=Kravii (FinTechathon 2026 demo)
AppPublisherURL=https://agentic-wallet-inky.vercel.app/download
DefaultDirName={localappdata}\Programs\Kravii
DefaultGroupName=Kravii
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\..\dist
OutputBaseFilename=Kravii-{#AppVersion}-windows-x64-setup
SetupIconFile=..\icons\icon.ico
UninstallDisplayIcon={app}\Kravii.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "{#SourceExe}"; DestDir: "{app}"; DestName: "Kravii.exe"; Flags: ignoreversion

[Icons]
Name: "{group}\Kravii"; Filename: "{app}\Kravii.exe"
Name: "{group}\Uninstall Kravii"; Filename: "{uninstallexe}"
Name: "{userdesktop}\Kravii"; Filename: "{app}\Kravii.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Kravii.exe"; Description: "Open Kravii"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; The updater's leftover from a replaced version. Your wallet data (%APPDATA%) is kept.
Type: files; Name: "{app}\Kravii.exe.old"
