# Changelog

## 0.1.0

Initial release.

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
- `open3mf` CLI.
- Multi-arch Docker image, Compose file, TrueNAS and reverse-proxy guidance.
- Portable Windows x64 and Linux x64 executables with a bundled Node.js runtime,
  native launcher and SHA-256 checksums.
- CI, release, nightly, CodeQL and dependency-review workflows.
