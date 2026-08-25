#define MyAppName "XT Music Native"
#define MyAppVersion "0.3.0"
#define MyAppPublisher "pkxutao"
#define MyAppExeName "xtmusic.exe"

[Setup]
AppId={{B3C7A39D-20E0-4A92-91FA-8A515CF4D62E}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\XT Music Native
DefaultGroupName=XT Music Native
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=XT-Music-Native-{#MyAppVersion}-Windows-x64-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile=..\..\build\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "..\target\release\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\XT Music Native"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\XT Music Native"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加图标："; Flags: unchecked

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "启动 XT Music Native"; Flags: nowait postinstall skipifsilent
