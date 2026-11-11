# Troubleshooting

## The app says "web UI build not found"

The API is running but the Vite build is missing. Run:

```bash
npm run build -w @open3mf/web
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

- Confirm the file was produced by Open3MF, not the original source.
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

Increase `CONVERSION_TIMEOUT_SECONDS` or reduce `MAX_CONCURRENT_JOBS` on a
memory-constrained host. Large projects with millions of triangles are limited
by the machine running the container.

## Authentication problems

If `AUTH_TOKEN` is set, enter it in the UI. The token is stored in the current
browser tab's session storage. A 401 means the token is missing or wrong. If you
use a reverse proxy, make sure it forwards the `Authorization` header.

## Container starts but is unhealthy

Check:

```bash
docker logs open3mf
curl http://localhost:8080/api/health
```

The health check uses `fetch` from Node. If you changed the port, update the
health check or use the image's default `PORT=8080`.
