Unicode true
Name "Barra Factor Analyzer"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\Barra Factor Analyzer"
RequestExecutionLevel user
ShowInstDetails show
ShowUninstDetails show
BrandingText "Barra Factor Analyzer ${APP_VERSION}"

!include "MUI2.nsh"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "TradChinese"

VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey "ProductName" "Barra Factor Analyzer"
VIAddVersionKey "ProductVersion" "${APP_VERSION}"
VIAddVersionKey "FileVersion" "${APP_VERSION}.0"
VIAddVersionKey "LegalCopyright" "Copyright (c) Barra Factor Analyzer"
VIAddVersionKey "FileDescription" "Barra Factor Analyzer Windows installer"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${STAGE_DIR}/*"

  CreateDirectory "$SMPROGRAMS\Barra Factor Analyzer"
  CreateShortcut "$SMPROGRAMS\Barra Factor Analyzer\啟動因子分析.lnk" "$INSTDIR\runtime\node.exe" '"$INSTDIR\launcher.mjs"' "$INSTDIR\runtime\node.exe" 0 SW_SHOWNORMAL
  CreateShortcut "$SMPROGRAMS\Barra Factor Analyzer\解除安裝.lnk" "$INSTDIR\Uninstall.exe"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BarraFactorAnalyzer" "DisplayName" "Barra Factor Analyzer"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BarraFactorAnalyzer" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BarraFactorAnalyzer" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BarraFactorAnalyzer" "InstallLocation" "$INSTDIR"
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\Barra Factor Analyzer\啟動因子分析.lnk"
  Delete "$SMPROGRAMS\Barra Factor Analyzer\解除安裝.lnk"
  RMDir "$SMPROGRAMS\Barra Factor Analyzer"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BarraFactorAnalyzer"
  RMDir /r "$INSTDIR"
SectionEnd
