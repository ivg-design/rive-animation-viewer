# Rive file icon asset

The `.riv` document type metadata names dedicated file icons on macOS and
Windows. The final user-supplied assets are tracked at:

`src-tauri/icons/RiveFileIcon.icns`

`src-tauri/icons/RiveFileIcon.ico`

The Tauri resource map copies it into the macOS app bundle at
`Contents/Resources/RiveFileIcon.icns`. Do not replace it with the application
icon or a generated placeholder. RAV exports and owns the canonical
`app.rive.animation.viewer.riv` UTI, and both its UTI declaration and document
claim reference this file.

The Windows icon is bundled as `RiveFileIcon.ico`; the NSIS post-install hook
overrides Tauri's executable-based `Rive File\\DefaultIcon` registration with
that resource. The hook also preserves the association that existed before RAV
across repairs and updater installs so a later uninstall restores it instead of
leaving an orphaned `Rive File` class. It contains mechanically resized 16, 20,
24, 32, 40, 48, 64, 96, 128, and 256 pixel frames generated from the same
1024 px master with:

```sh
magick RIV-RAV-FILE-ICON.png -alpha on -background none \
  -define icon:auto-resize=256,128,96,64,48,40,32,24,20,16 \
  RiveFileIcon.ico
```
