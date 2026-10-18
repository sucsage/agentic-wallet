; MilestonePay for Windows: per-user install (no administrator rights), so the app can update itself.
; Built by the release workflow: iscc /DAppVersion=<v> /DSourceExe=<path> packaging\windows\installer.iss
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceExe
  #define SourceExe "..\..\dist\AgenticWallet-windows-x64.exe"
#endif

[Setup]
AppId={{6E3F8A52-2C1B-4C55-9B7E-4F1A9C0D7E21}
AppName=MilestonePay
AppVersion={#AppVersion}
AppPublisher=MilestonePay (FinTechathon 2026 demo)
AppPublisherURL=https://agentic-wallet-inky.vercel.app/download
DefaultDirName={localappdata}\Programs\MilestonePay
DefaultGroupName=MilestonePay
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\..\dist
OutputBaseFilename=MilestonePay-{#AppVersion}-windows-x64-setup
SetupIconFile=..\icons\icon.ico
UninstallDisplayIcon={app}\MilestonePay.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "{#SourceExe}"; DestDir: "{app}"; DestName: "MilestonePay.exe"; Flags: ignoreversion

[Icons]
Name: "{group}\MilestonePay"; Filename: "{app}\MilestonePay.exe"
Name: "{group}\Uninstall MilestonePay"; Filename: "{uninstallexe}"
Name: "{userdesktop}\MilestonePay"; Filename: "{app}\MilestonePay.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\MilestonePay.exe"; Description: "Open MilestonePay"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; The updater's leftover from a replaced version. Your wallet data (%APPDATA%) is kept.
Type: files; Name: "{app}\MilestonePay.exe.old"
