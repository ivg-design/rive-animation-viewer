; Tauri's file-association template uses the application executable for every
; document icon. RAV ships a dedicated multi-resolution icon for .riv files,
; so replace only the generated Rive File class's DefaultIcon value after the
; standard association has been written.
;
; This hook runs for initial installs, repairs, and /UPDATE installs. The icon
; resource has already been copied to $INSTDIR by this point.
Var RavRestoreRivAssociationBackup
Var RavRivAssociationBackupExisted
Var RavPreviousRivAssociationBackup

; Tauri's APP_ASSOCIATE macro unconditionally backs up the current .riv class.
; On a repair or in-place updater install that current class is already
; "Rive File"; allowing it to back itself up would leave an orphan association
; after the eventual uninstall. Preserve the original pre-RAV class instead.
!macro NSIS_HOOK_PREINSTALL
  StrCpy $RavRestoreRivAssociationBackup "0"
  StrCpy $RavRivAssociationBackupExisted "0"
  StrCpy $RavPreviousRivAssociationBackup ""
  ClearErrors
  ReadRegStr $RavPreviousRivAssociationBackup SHCTX "Software\Classes\.riv" "Rive File_backup"
  ${IfNot} ${Errors}
    StrCpy $RavRivAssociationBackupExisted "1"
  ${EndIf}
  ReadRegStr $R0 SHCTX "Software\Classes\.riv" ""
  ${If} $R0 == "Rive File"
    StrCpy $RavRestoreRivAssociationBackup "1"
  ${EndIf}
  ClearErrors
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $RavRestoreRivAssociationBackup == "1"
    ${If} $RavRivAssociationBackupExisted == "1"
      WriteRegStr SHCTX "Software\Classes\.riv" "Rive File_backup" "$RavPreviousRivAssociationBackup"
    ${Else}
      DeleteRegValue SHCTX "Software\Classes\.riv" "Rive File_backup"
    ${EndIf}
  ${EndIf}
  WriteRegStr SHCTX "Software\Classes\Rive File\DefaultIcon" "" "$\"$INSTDIR\RiveFileIcon.ico$\",0"
  !insertmacro UPDATEFILEASSOC
!macroend

; Tauri's normal uninstall restores the backed-up class, removes the Rive File
; class, and deletes the bundled .ico. Remove only RAV's backup value (and the
; extension key if it is now empty), then notify Explorer so it does not retain
; a stale document icon. The in-place /UPDATE path does not run this hook.
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue SHCTX "Software\Classes\.riv" "Rive File_backup"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.riv"
  !insertmacro UPDATEFILEASSOC
!macroend
