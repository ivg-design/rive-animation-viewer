# Rive file icon asset

The `.riv` document type metadata names the dedicated file icon
`RiveFileIcon.icns`. The final user-supplied asset is tracked at:

`src-tauri/icons/RiveFileIcon.icns`

The Tauri resource map copies it into the macOS app bundle at
`Contents/Resources/RiveFileIcon.icns`. Do not replace it with the application
icon or a generated placeholder. Both the official
`app.rive.editor.rive-file` UTI and RAV's pre-2.4.3 legacy
`app.rive.animation.viewer.riv` migration declaration reference this file.
