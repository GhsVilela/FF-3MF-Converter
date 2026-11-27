# Changelog

## 0.5.0

- Added an OrcaSlicer 2.5+ Python plugin. It adds an FF-3MF tab, exports the
  current project (including unsaved changes when the host supports it), runs
  the existing FF-3MF conversion, shows progress and colour mapping, and stores
  the converted project and report in the plugin data folder.
- Added a second plugin source: **Select a .3mf file**. It copies the chosen
  file to plugin staging in 512 KiB chunks, validates it, and converts it
  without requiring the file to be open in OrcaSlicer. Current-project and
  selected-file analyses are invalidated independently.
- Plugin upload progress now reports the actual upload percentage and byte
  count instead of stopping at 18%. After the upload, the progress bar switches
  to an indeterminate server-analysis state.
- Clarified the two plugin steps: **Upload & analyse** prepares the source and
  preview; **Convert** reuses the uploaded source and starts with
  **Preparing the conversion**, without uploading again.
- Added the multi-plate preview carousel to the plugin. Plate images are loaded
  lazily and cached; previous/next buttons, arrow keys and a compact plate
  counter let users inspect every embedded plate render.
- Enlarged the plugin preview and moved the arrows and plate counter to a
  separate control row below the image so they no longer overlap the render.
- Renamed the plugin tab to **FF-3MF**, updated the header to **FlashForge
  project converter**, matched the web brand mark, and stopped automatically
  opening the file picker when switching to the selected-file source.
- Fixed the plugin staying **Offline** after OrcaSlicer's network permission
  prompt is approved. The first connection probe now retries automatically for
  about 30 seconds, and the page re-checks when it regains focus.
- Added the single-file plugin build (`npm run build:orca-plugin`) and the
  standard-library Python test suite (`npm run test:orca-plugin`), including an
  end-to-end upload → convert → download test against the real API.
- The release workflow publishes `ff3mf_orca_<version>.py` and its checksum.
  The version suffix uses underscores because OrcaSlicer imports `.py` plugins
  by file stem and a dotted filename is treated as a dotted module path.

## 0.4.0

- Updated the dependency set across the workspace: Fastify Compress 9,
  Fastify Rate Limit 11, Commander 15, Fast XML Parser 5.12.1, Lucide React 1.x,
  Tailwind Merge 3.7.1, Playwright 1.65.1, ESLint 10.15, Prettier 3.10.1,
  TypeScript ESLint 8.74 and Vitest 5.1.1.
- Upgraded to TypeScript 6.0.3 and declared the Node type library explicitly in
  the shared tsconfig. TypeScript 7.0.2 is not adopted yet because
  `typescript-eslint` 8.74 only supports TypeScript `<6.1.0`.
- Replaced the Lucide GitHub brand icon, which was removed in Lucide 1.x, with a
  local GitHub mark so the repository link keeps its appearance.
- Conversion, profile and browser tests continue to pass; no conversion
  behaviour changed.

## 0.3.1

- Added multi-plate preview pagination. Every embedded `plate_<n>` render is
  extracted, stored with the upload and exposed through the thumbnail endpoint.
  The configure screen now has previous/next controls, keyboard arrow support
  and plate indicators.
- `POST /api/uploads` returns a `thumbnails` array listing the plates with a
  preview. `GET /api/uploads/:id/thumbnail?plate=N` serves a specific plate.
- Projects with only a single project thumbnail still show it as plate 1.
- Added a three-plate synthetic fixture and Playwright coverage for carousel
  navigation.

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
