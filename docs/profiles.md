# Profiles

The `profiles/` directory is generated from pinned OrcaSlicer releases. It is
data, not application code.

## Layout

```
profiles/
  catalog.json              printer catalog and source metadata
  templates/<printer>.json  full project_settings.config snapshot
  machines/<printer>/<nozzle>.json
  processes/<printer>/<nozzle>.json
  filaments/<printer>.json
```

### Catalog

`catalog.json` lists the supported printers, their maximum colour count, the
nozzle variants, the default process/filament, and the source versions and
licenses. The API and UI read it through `packages/profiles`.

### Templates

A template is a complete `project_settings.config` captured from a real
OrcaSlicer export. It supplies:

- The full key set and defaults for the target Flash Studio generation.
- The `Application` and `BambuStudio:3mfVersion` compatibility stamp.
- Target machine, process and filament values.

Templates are captured at the 0.4 mm nozzle and reused for other nozzles; the
selected machine/process/filament data is overlaid at conversion time.

### Machines

Resolved machine presets containing build volume, nozzle array, start/end
G-code, limits and FlashForge identity.

### Processes

Resolved process presets compatible with the printer/nozzle. The UI shows the
list; the API picks the closest layer height when the user does not choose one.

### Filaments

Resolved filament presets for the printer. The converter selects a preset by
material type, preferring Generic and FlashForge profiles.

## Source pins

| Target generation                      | OrcaSlicer |
| -------------------------------------- | ---------- |
| AD5X, Adventurer 5M, Adventurer 5M Pro | 2.3.0      |
| Creator 5, Creator 5 Pro               | 2.5.0      |

## Regenerating

The generation process is intentionally separate from the runtime image:

1. Obtain the pinned OrcaSlicer release (AppImage or source tree).
2. Resolve the `inherits` chains for the FlashForge profiles.
3. Generate a target template by exporting a small test project with headless
   OrcaSlicer.
4. Write the catalog, machine, process and filament files.
5. Run the test suite and an OrcaSlicer CLI slice check.
6. Review the diff and update `THIRD_PARTY_NOTICES.md`.

Do not ship profiles extracted from proprietary applications. The templates and
profiles in this repository come from the open-source OrcaSlicer project and are
distributed under AGPL-3.0-or-later.

## Adding a printer

Add a catalog entry, template, machine/process/filament data and tests. Validate
at least one single-colour and one multi-colour project in Flash Studio before a
release.
