Unicode true
!include "MUI2.nsh"

!ifndef VERSION
!define VERSION "0.3.0"
!endif
!ifndef BINARY
!define BINARY "xtmusic.exe"
!endif
!ifndef OUTFILE
!define OUTFILE "XT-Music-Native-${VERSION}-Windows-x64-Setup.exe"
!endif

Name "XT Music Native ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\XT Music Native"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "XT Music Native" SecMain
  SetOutPath "$INSTDIR"
  File /oname=xtmusic.exe "${BINARY}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\XT Music Native"
  CreateShortcut "$SMPROGRAMS\XT Music Native\XT Music Native.lnk" "$INSTDIR\xtmusic.exe"
  CreateShortcut "$DESKTOP\XT Music Native.lnk" "$INSTDIR\xtmusic.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\XTMusicNative" "DisplayName" "XT Music Native"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\XTMusicNative" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\XTMusicNative" "Publisher" "pkxutao"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\XTMusicNative" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\XT Music Native.lnk"
  Delete "$SMPROGRAMS\XT Music Native\XT Music Native.lnk"
  RMDir "$SMPROGRAMS\XT Music Native"
  Delete "$INSTDIR\xtmusic.exe"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\XTMusicNative"
SectionEnd
