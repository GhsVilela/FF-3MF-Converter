# Troubleshooting

## The app says "web UI build not found"

The API is running but the Vite build is missing. Run:

```bash
npm run build -w @ff3mf/web
```

In Docker this is handled by the image build. Check that `WEB_DIR` points to the
built `dist` directory if you override it.

## Upload fails with 413

The file exceeds `MAX_UPLOAD_MB`. Increase the limit and the reverse proxy body
limit (for Nginx, `client_max_body_size`). Also check available disk space in
`DATA_DIR`.

## "This is a sliced print file"

The uploaded 3MF contains `Metadata/plate_*.gcode`. It is a print job, not an
editable project. Upload the original project file.

## Flash Studio loads geometry only

Open the file with **File → Open Project**, not by dragging it onto the plate.
Drag-and-drop can import only the geometry and ignore the project settings.

If it still loads geometry only:

- Confirm the file was produced by FF-3MF, not the original source.
- Check the conversion report for warnings.
- Try a newer Flash Studio build, especially for Creator 5.
- Open an issue with the source file type, printer and the report JSON.

## Settings reset to defaults

This usually means `different_settings_to_system` is incomplete or the target
profile names do not match. Re-run the conversion with the current image and
check the report. If you are developing, run the tests and the OrcaSlicer CLI
slice check.

## Wrong colours or merged colours

- Check the colour mapping in the UI before converting.
- Single-colour printers intentionally merge every painted region.
- A project with more than four colours must be merged for AD5X/Creator 5.
- Painted supports and seams are not colours; they are preserved separately.
- If the source uses an unsupported paint encoding, the report warns and the
  original attribute is left untouched.

## Model is off the plate or too large

The converter centres single-plate projects by default but never scales
automatically. Use **Scale to fit** only if changing dimensions is acceptable,
or arrange the model in Flash Studio. Multi-plate projects are preserved as-is;
review each plate.

## Conversion times out

The default `CONVERSION_TIMEOUT_SECONDS` is 600 (ten minutes). Increase it for
very large multi-plate projects or slower hardware. Each conversion is
CPU-bound and uses one worker thread, so a multi-core NAS will show roughly one
busy core per active job; raise `MAX_CONCURRENT_JOBS` only when memory allows.
Reduce concurrency on a memory-constrained host. Projects with millions of
triangles are ultimately limited by the machine running the container.

## Authentication problems

If `AUTH_TOKEN` is set, enter it in the UI. The token is stored in the current
browser tab's session storage. A 401 means the token is missing or wrong. If you
use a reverse proxy, make sure it forwards the `Authorization` header.

## Container starts but is unhealthy

Check:

```bash
docker logs ff3mf
curl http://localhost:8080/api/health
```

The health check uses `fetch` from Node. If you changed the port, update the
health check or use the image's default `PORT=8080`.

## Portable executable will not start

- On Linux, make sure the extracted launcher is executable:
  `chmod +x ff3mf`.
- If the browser does not open, use `--no-browser` and open the printed URL
  manually.
- If port 8080 is busy, the launcher selects the next free port. Pass `--port`
  to choose one explicitly.
- Windows SmartScreen may warn about an unsigned executable. The archives are
  built from the tagged source and checksums are published with each release.
- macOS Gatekeeper may block the launcher because the build is not signed with
  an Apple Developer ID. Remove the quarantine flag from the extracted folder:
  `xattr -dr com.apple.quarantine FF-3MF-Converter-<version>-macos-arm64`
  (use `macos-x64` on Intel). Downloading with `curl -L` avoids the flag.

## Portable data location

- Windows: `%LOCALAPPDATA%\FF-3MF\data`
- Linux: `$XDG_DATA_HOME/ff3mf` or `~/.local/share/ff3mf`
- macOS: `~/Library/Application Support/ff3mf`

Use `--data-dir` to choose another folder. Uploaded files and converted outputs
expire according to `JOB_TTL_MINUTES`.
