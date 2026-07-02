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

Var CleanPrevData
Var CleanPrevDataCheckbox

!macro customPageAfterChangeDir
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
!macroend

Function onCleanPrevDataToggle
  ${NSD_GetState} $CleanPrevDataCheckbox $CleanPrevData
FunctionEnd

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
