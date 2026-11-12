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

This produces the Windows and Linux archives in `build/artifacts/`. The
Windows archive contains `FF-3MF.exe` with the embedded icon, the bundled
`runtime/node.exe`, the app and the FlashForge profiles.
