# Changelog

## 0.3.0

- Added a first-plate preview after upload. The converter reads the plate render
  embedded in the 3MF, stores it with the staged upload and serves it through
  `GET /api/uploads/:id/thumbnail`; the configure screen shows it before the
  target settings.
- Reworked the 3MF model XML scanner and rewriter. The new streaming scanner
  avoids namespace resolution, keeps untouched tags verbatim, preserves
  self-closing elements and only rebuilds tags that actually change. A 61 MB
  project with 4.1 million triangles dropped from about 67 s and 2.8 GB peak RSS
  to about 27 s and 1.4 GB in local testing.
- Fixed migration of legacy `slic3rpe:mmu_segmentation`,
  `slic3rpe:custom_supports` and `slic3rpe:custom_seam` attributes.
- Increased the default `CONVERSION_TIMEOUT_SECONDS` from 120 to 600 seconds for
  large multi-plate projects. The documentation now explains that a conversion
  is CPU-bound and uses one worker thread per active job.
- Upload analysis also uses the faster scanner, reducing the wait before the
  configure screen for large projects.

## 0.2.1

- Fixed the upload progress bar staying near zero until the transfer finished.
  It now follows the uploaded bytes and switches to an analysing state while the
  server reads plates, objects and colours.
- Conversion progress now reports real stages: analysing the 3MF, building the
  target profile, remapping the model, packaging the Flash Studio project and
  validating the output. The UI shows the active stage, percentage and elapsed
  time instead of remaining at 10%.
- Polling is resilient to transient rate-limit, server and network failures. It
  retries with backoff and shows a reconnect notice instead of returning to the
  configuration screen with a bare `Failed to fetch`.
- Fixed rate limiting never being applied because the Fastify plugins were
  registered after the routes. The job-status endpoint now has its own budget so
  normal conversion polling cannot exhaust the request limit.
- Staged uploads persist their metadata under `DATA_DIR`, so a server restart or
  container redeploy no longer invalidates a valid `uploadId`.
- Reduced peak memory for large multi-plate projects by releasing raw model
  buffers as soon as the XML strings and rewritten entries are built.
- Improved timeout and interrupted-conversion messages.

## 0.2.0

- Added an optional `keepAllColors` conversion mode. When a source project uses
  more colours than the target printer exposes, it keeps one filament slot per
  used source colour instead of merging into the printer slots. Available in the
  UI, the API and the CLI (`--keep-all-colors`).
- Fixed portable archives containing absolute `node_modules` symlinks from the
  build machine. The broken `.bin`/workspace links caused noisy `xattr`
  warnings when removing the macOS quarantine flag.
- Fixed support-interface filaments being treated as unused. A filament used
  only by `support_interface_filament` is now included in the colour list and
  preserved by `keepAllColors`.
- Fixed multi-plate fit checks using the combined bounds of every plate. Each
  plate is now checked separately, using the full 3MF object transform (scale,
  rotation and translation).

## 0.1.0

Initial release under the **FF-3MF Converter** name.

- FlashForge-inspired light/industrial UI with a dark theme, IBM Plex typography
  and responsive conversion workflow.

- Convert Bambu Studio, OrcaSlicer and compatible 3MF projects into Flash
  Studio-ready projects for FlashForge AD5X, Adventurer 5M, Adventurer 5M Pro,
  Creator 5 and Creator 5 Pro.
- Preserve geometry, plates, painted colours, painted supports and painted
  seams.
- Remap multicolour projects for the AD5X IFS and Creator 5 toolheads.
- Merge or select colours for single-colour printers.
- Recompute `different_settings_to_system` so Flash Studio keeps the converted
  settings.
- Generate a per-setting conversion report.
- Fastify API with upload/analyse/convert/download job flow.
- React + Vite UI with English and Portuguese (Brazil).
- `ff3mf` CLI.
- Multi-arch Docker image, Compose file, TrueNAS and reverse-proxy guidance.
- Portable Windows x64, Linux x64, macOS arm64 and macOS x64 executables with a
  bundled Node.js runtime, native launcher (`FF-3MF.exe` / `ff3mf`), embedded
  Windows icon and SHA-256 checksums. The macOS builds are not signed with an
  Apple Developer ID and are not notarized; the documentation covers the
  Gatekeeper workaround.
- CI, release, nightly, CodeQL and dependency-review workflows.
