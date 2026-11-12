# Packaging and launcher

The portable builds use a small Go launcher that starts the bundled Node.js
runtime, opens the browser and keeps the app in a user-data directory.

## Windows icon

`packaging/launcher/app.ico` is the multi-resolution Windows icon (16–256 px).
It is embedded in `FF-3MF.exe` through
`packaging/launcher/rsrc_windows_amd64.syso`, which is generated with
[`rsrc`](https://github.com/akavel/rsrc):

```bash
cd packaging/icon
go run . -ico ../launcher/app.ico
cd ../launcher
go run github.com/akavel/rsrc@v0.10.2 -ico app.ico -o rsrc_windows_amd64.syso
```

The icon source is `packaging/icon/main.go`. Regenerate the `.ico` and `.syso`
files whenever the brand mark changes.

## Build

```bash
npm run build:portable
```

This produces the Windows, Linux and macOS archives in `build/artifacts/`. The
Windows archive contains `FF-3MF.exe` with the embedded icon, the bundled
`runtime/node.exe`, the app and the FlashForge profiles. The macOS archives are
built for Apple Silicon (`macos-arm64`) and Intel (`macos-x64`).

The macOS launchers are not signed with an Apple Developer ID and are not
notarized. If Gatekeeper blocks the first launch after a browser download,
remove the quarantine flag from the extracted folder:

```bash
xattr -dr com.apple.quarantine FF-3MF-Converter-<version>-macos-arm64
```

No Apple Developer account is required for the build or for this workaround.
