# AGENTS.md — FF-3MF Converter Development Guide

This file is the primary source of truth for AI agents and contributors working
on FF-3MF Converter. Read it before changing code, profiles or documentation.

## Project overview

FF-3MF Converter is a self-hosted web application that converts 3MF projects
from Orca-family slicers and generic 3MF files into Flash Studio-ready projects
for FlashForge printers.

The output is an **editable project**, not sliced G-code. The user opens it in
Flash Studio with **File → Open Project**, then slices there.

The application is:

- **TypeScript** end to end.
- **Fastify 5** for the API.
- **React 19 + Vite + Tailwind CSS** for the UI.
- **No database**; uploads and results are temporary files with a TTL.
- **Single container**, multi-arch, non-root.
- **AGPL-3.0-or-later**, because the bundled printer profiles and generated
  templates come from the AGPL-licensed OrcaSlicer project.

## Architecture

```
apps/
  api/        Fastify server, job queue, static file serving
  web/        React UI
  cli/        ff3mf command-line interface
packages/
  core/       3MF ZIP/XML handling, paint codec, conversion engine, validation
  profiles/   target profile loader, catalog types
  shared/     shared TypeScript types and Zod schemas
profiles/
  templates/  full target project_settings.config snapshots
  machines/   resolved machine settings per printer/nozzle
  processes/  process preset lists per printer/nozzle
  filaments/  filament preset lists per printer
```

### Conversion flow

1. `POST /api/uploads` saves the file, analyses it and returns a `SourceAnalysis`.
2. `POST /api/conversions` queues a job.
3. `apps/api/src/runner.ts` loads the target profile, chooses a process preset
   closest to the source layer height, and calls `convert3mf`.
4. `packages/core/src/source.ts` reads the source 3MF, detects the source
   slicer, counts plates/objects/triangles, extracts paint states and computes
   bounds.
5. `packages/core/src/config.ts` builds the target configuration from a target
   template, overlays author overrides, maps filaments and computes
   `different_settings_to_system`.
6. `packages/core/src/convert.ts` rewrites the model XML, patches model settings,
   packages a new 3MF and validates the output.
7. `GET /api/conversions/:id/download` returns the result.

## Development commands

```bash
npm ci
npm run build:packages
npm run build -w @ff3mf/api
npm run dev

npm run lint
npm run typecheck
npm test
npm run build
npm run format
npm run format:check
```

`npm run dev` builds the workspace packages and API, then runs the built API and
the Vite dev server. The API listens on port 8080; Vite runs on port 5173 and
proxies `/api` to the API.

### Docker

```bash
docker build -t ff3mf:local .
docker run --rm -p 8080:8080 -v ff3mf_data:/data ff3mf:local
```

### Portable executables

`scripts/build-portable.mjs` assembles the Windows and Linux archives. It
requires Go 1.22+, Python 3 and network access for the pinned Node.js runtime.

```bash
npm run build:portable
```

The launcher source lives in `packaging/launcher`. The Windows icon is generated
by `packaging/icon` and embedded through `rsrc_windows_amd64.syso`. See
`packaging/README.md`. The output is written to `build/artifacts/` and is
intentionally not committed.

### CLI

```bash
npm run build -w @ff3mf/cli
node apps/cli/dist/index.js printers
node apps/cli/dist/index.js convert model.3mf -p ad5x -o out.3mf
```

## Conversion invariants

These are non-negotiable:

1. **Geometry is copied, not regenerated.** Do not rebuild meshes or change
   vertex/triangle order except for the documented unit/scale translation.
2. **Paint data is a bitstream.** Never regex-replace paint codes. Use the
   TriangleSelector codec in `packages/core/src/paint.ts`.
3. **`different_settings_to_system` must be correct.** Without the right keys,
   Orca/Flash Studio silently resets settings to system defaults. Recompute it
   from the target baseline and the final config.
4. **Machine-specific tuning never transfers.** Speeds, acceleration, jerk,
   pressure advance, retraction, fan curves, start/end G-code and hardware keys
   belong to the source printer and must be dropped or replaced.
5. **Target identity wins.** `printer_model`, `printer_variant`,
   `printer_settings_id`, `print_settings_id`, `nozzle_diameter`,
   `print_compatible_printers` and `filament_settings_id` must name the target
   profile exactly.
6. **Colours are compacted and remapped.** Unused source filaments are removed;
   used slots are remapped in paint data, object/volume `extruder` metadata and
   support filament settings.
7. **The output is validated before download.** A failed validation must delete
   the output and return an error; never return a corrupt project.
8. **Sliced `.gcode.3mf` files are rejected.** They have no editable project
   geometry.

## Profile data

The `profiles/` directory is generated, not hand-written. Do not edit the JSON
files manually unless you are fixing a generator bug and can explain why.

- Templates are generated with headless OrcaSlicer 2.3.0 for the AD5X, 5M and
  5M Pro, and OrcaSlicer 2.5.0 for Creator 5/Pro.
- `profiles/templates/<printer>.json` contains a full
  `project_settings.config` captured from a real OrcaSlicer export.
- Machine, process and filament files are resolved from the same OrcaSlicer
  profile source (following `inherits` chains).
- Keep the source version, URL and license in `profiles/catalog.json` and
  `THIRD_PARTY_NOTICES.md`.

When updating profiles:

1. Pin an OrcaSlicer release tag.
2. Regenerate the templates and resolved data.
3. Run the full test suite and the OrcaSlicer CLI slice check.
4. Review the diff carefully: profile changes can alter print behaviour.
5. Update `docs/printers.md` and the compatibility notes.

## Adding a printer

1. Add the printer to the profile catalog with its ID, name, series, maximum
   colours, build volume, nozzle list and template.
2. Generate a target template from the matching OrcaSlicer profile set.
3. Add machine/process/filament data for every supported nozzle.
4. Add the printer to the tests and the UI catalog automatically (the UI reads
   `/api/printers`).
5. Validate one single-colour and one multi-colour project manually in Flash
   Studio before release.

Do not add printers without a real profile and a validation plan.

## Testing requirements

Before considering a change complete:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run build:packages
npm test
npm run build
```

Add tests for:

- New paint or config transformations.
- New filament/slot mapping rules.
- New printer profiles.
- Error paths for malformed, oversized or sliced files.

Tests must not commit third-party models. Use synthetic fixtures in
`packages/core/test/fixtures.ts`. Keep geometry small and deterministic.

## Security requirements

- Treat every uploaded ZIP as hostile.
- Enforce entry count, uncompressed size, per-entry size and compression ratio.
- Reject absolute paths, `..`, drive letters and NUL bytes.
- Parse XML without DTD/external entity resolution.
- Never shell out with user-controlled arguments.
- Never log file contents or tokens.
- Keep temp files under `DATA_DIR` and clean them up on completion, TTL expiry
  and startup.
- Keep the container non-root.

## Git workflow

- Work on `main` only when the repository owner explicitly asks for it.
- Do not commit or push unless explicitly requested.
- Do not commit secrets, generated data volumes, uploaded models or converted
  files.
- Keep changes focused and leave the working tree ready for review.

## UI design direction

- Light-first, industrial interface inspired by the FlashForge palette:
  blue `#0077B6`, orange `#E96114`, ink, paper and teal.
- IBM Plex Sans for UI text and IBM Plex Mono for labels, metadata and tables.
- Use thin rules, square panels, technical labels and a subtle blueprint grid.
- Avoid glassmorphism, oversized gradient blobs, purple palettes and generic
  rounded SaaS cards. Keep the interface deliberate and readable.
- Dark mode is a first-class theme but not the default.

## Documentation rules

- Describe the project in terms of the open 3MF format and the open-source
  OrcaSlicer profile ecosystem.
- Do not reference or link commercial converter services in project files.
- Do not include proprietary Flash Studio assets, screenshots or extracted
  profiles.
- Keep the README, `docs/printers.md` and `THIRD_PARTY_NOTICES.md` in sync when
  printer support changes.

## Release checklist

1. CI is green.
2. `profiles/catalog.json` and `THIRD_PARTY_NOTICES.md` are current.
3. `README.md` and docs reflect the shipped printer/source matrix.
4. A converted project was opened and sliced in Flash Studio for each supported
   printer family (or the limitation is documented).
5. Tag `vX.Y.Z`.
6. The release workflow publishes GHCR (and Docker Hub if enabled).

## License

The project is AGPL-3.0-or-later. Contributions must be compatible with that
license. Do not copy code or data from incompatible sources.
