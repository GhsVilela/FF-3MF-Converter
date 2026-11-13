# Changelog

## Unreleased

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
