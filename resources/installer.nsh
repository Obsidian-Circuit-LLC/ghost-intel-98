; Ghost Intel 98 — electron-builder NSIS custom hooks.
;
; Adds an OPT-IN, DEFAULT-UNCHECKED checkbox to the installer that, ONLY when the user ticks it,
; removes the app's %APPDATA% data left by a previous install — including the two prior product
; names the app has shipped under (Dead Cyber Society 98, Ghost Access 98).
;
; DESTRUCTIVE-OP SAFETY (load-bearing):
;   - The checkbox is created UNCHECKED (no auto-check macro applied); the user must opt in every time.
;   - Deletion is gated behind ${If} $CleanPrevData == 1.
;   - Every RMDir target is existence-guarded and scoped to one of exactly three %APPDATA% app
;     dirs. We NEVER touch $INSTDIR or anything outside those folders.
;
; Per-user install (perMachine:false) ⇒ no elevation; %APPDATA% resolves to the current user's
; roaming profile. oneClick:false ⇒ customPageAfterChangeDir fires.

; electron-builder concatenates this custom include into the installer script BEFORE
; installer.nsi pulls in MUI2/LogicLib/nsDialogs, so the ${If}/${NSD_*} macros used by the
; top-level Functions below are otherwise undefined at parse time and makensis aborts.
; Pull them in here explicitly; both headers carry internal !ifndef guards, so the later
; re-inclusion by electron-builder (and by the test harness) is a no-op.
!include LogicLib.nsh
!include nsDialogs.nsh

; electron-builder compiles this file TWICE — once for the installer and once (with BUILD_UNINSTALLER
; defined) for the uninstaller. The custom page + cleanup are installer-only; the uninstaller pass does
; NOT insert customPageAfterChangeDir (assistedInstaller.nsh guards it behind !ifndef BUILD_UNINSTALLER),
; so leaving these page Functions defined there orphans them → NSIS warning 6010 → (warnings are errors)
; → the whole build fails. Guard everything installer-specific so the uninstaller pass sees none of it.
!ifndef BUILD_UNINSTALLER

Var CleanPrevData
Var CleanPrevDataCheckbox

; customPageAfterChangeDir is expanded by electron-builder's assistedInstaller.nsh at
; page-declaration scope (between the MUI_PAGE_* directives), so it may contain ONLY a
; page directive — never raw instructions. The nsDialogs page body lives in the
; cleanPrevDataPageShow Function below. This mirrors electron-builder's own multiUserUi.nsh
; pattern (PageEx/Page custom + a page callback Function).
!macro customPageAfterChangeDir
  Page custom cleanPrevDataPageShow cleanPrevDataPageLeave
!macroend

Function cleanPrevDataPageShow
  ; Reset the flag on every (re)show so a tick from an earlier visit can't linger across a
  ; Back/Next round-trip and act on a freshly-rebuilt, visibly-UNCHECKED box (data-loss guard).
  StrCpy $CleanPrevData 0
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "If you have used this app before, you can optionally remove its saved data and settings. This is not required."
  Pop $1

  ; Created without an auto-check macro ⇒ starts UNCHECKED. Opt-in only.
  ${NSD_CreateCheckbox} 0 30u 100% 12u "Remove data and settings from a previous installation"
  Pop $CleanPrevDataCheckbox
  ${NSD_OnClick} $CleanPrevDataCheckbox onCleanPrevDataToggle

  nsDialogs::Show
FunctionEnd

Function onCleanPrevDataToggle
  ${NSD_GetState} $CleanPrevDataCheckbox $CleanPrevData
FunctionEnd

; Authoritative sync: read the ACTUAL checkbox state when the user leaves the page (clicks Next),
; so $CleanPrevData always reflects what is on screen — never a stale value from an earlier visit.
; Without this, ticking the box then going Back and forward again would leave the flag set while
; the rebuilt checkbox shows unchecked, and cleanup would run against the user's visible intent.
Function cleanPrevDataPageLeave
  ${NSD_GetState} $CleanPrevDataCheckbox $CleanPrevData
FunctionEnd

; Force-close a running Ghost Intel 98 before the install writes files. Without this, an
; over-install onto an app that's still open leaves the old renderer/main locked, so the update
; can "succeed" while the previously-running old build stays on disk — exactly the "installed but
; still shows the old engine" symptom. Belt-and-braces on top of electron-builder's own check.
!macro customInit
  nsExec::Exec 'taskkill /F /IM "Ghost Intel 98.exe" /T'
  Pop $0 ; discard exit code — a not-running app (code 128) is a harmless no-op
!macroend

!macro customInstall
  ${If} $CleanPrevData == 1
    ; Scoped strictly to the three %APPDATA% app dirs. Existence-guarded; never $INSTDIR.
    ${If} ${FileExists} "$APPDATA\Ghost Intel 98\*.*"
      RMDir /r "$APPDATA\Ghost Intel 98"
    ${EndIf}
    ${If} ${FileExists} "$APPDATA\Dead Cyber Society 98\*.*"
      RMDir /r "$APPDATA\Dead Cyber Society 98"
    ${EndIf}
    ${If} ${FileExists} "$APPDATA\Ghost Access 98\*.*"
      RMDir /r "$APPDATA\Ghost Access 98"
    ${EndIf}
  ${EndIf}
!macroend

!endif ; !BUILD_UNINSTALLER
