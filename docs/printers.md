# Printers and compatibility

## Supported printers

| ID              | Printer           | Build volume       | Colours     | Nozzles                   |
| --------------- | ----------------- | ------------------ | ----------- | ------------------------- |
| `ad5x`          | FlashForge AD5X   | 220 × 220 × 220 mm | 4 (IFS)     | 0.4 / 0.6 / 0.8 mm        |
| `ad5m`          | Adventurer 5M     | 220 × 220 × 220 mm | 1           | 0.25 / 0.4 / 0.6 / 0.8 mm |
| `ad5m-pro`      | Adventurer 5M Pro | 220 × 220 × 220 mm | 1           | 0.25 / 0.4 / 0.6 / 0.8 mm |
| `creator-5`     | Creator 5         | 256 × 256 × 256 mm | 4 toolheads | 0.25 / 0.4 / 0.6 / 0.8 mm |
| `creator-5-pro` | Creator 5 Pro     | 256 × 256 × 256 mm | 4 toolheads | 0.25 / 0.4 / 0.6 / 0.8 mm |

## Profile sources

- **AD5X, Adventurer 5M, Adventurer 5M Pro:** OrcaSlicer 2.3.0 profiles and
  templates. These match the Flash Studio 1.7 generation and are the most
  broadly compatible output.
- **Creator 5, Creator 5 Pro:** OrcaSlicer 2.5.0 profiles and templates. These
  use a newer compatibility stamp and may require a newer Flash Studio build.

The app exposes the template source on the printer card and in the conversion
report.

## What is preserved

- Model geometry, object names, parts and modifiers.
- Build plates and instances.
- Painted colours, supports and seams.
- Per-object and per-volume settings that exist in the target profile.
- Author process overrides (layer height, walls, infill, supports, seam, brim,
  ironing, temperatures, etc.).
- Source material type and colour where a target preset exists.

## What is replaced

- Printer model, variant, bed shape, printable height and nozzle diameter.
- Machine start/end G-code and layer-change G-code.
- Machine limits, acceleration and speed capabilities.
- Filament preset identity, temperatures and pressure advance defaults.
- Process preset identity and compatible-printer metadata.
- Project `Application` stamp and 3MF version for Flash Studio compatibility.

## What is dropped

- Speeds, acceleration and jerk.
- Pressure advance and adaptive pressure advance.
- Retraction, z-hop and wipe tuning.
- Fan curves, chamber control and auxiliary fans.
- Bambu AMS, camera, calibration and lidar settings.
- Source machine G-code and hardware metadata.
- Stale plate G-code, slice info and source thumbnails.

## Colour limits

- AD5X: one nozzle plus a four-slot IFS. Up to four colours in a project.
- Adventurer 5M / 5M Pro: one colour. The UI collapses every painted region to
  the selected source colour.
- Creator 5 / 5 Pro: four independent toolheads. Up to four source filaments are
  mapped one-to-one.

If a project uses more colours than the target supports, the UI shows the
mapping and the report records every merge. Review the result before slicing.

## Manual validation

Automated tests validate structure and slice with the OrcaSlicer CLI. Flash
Studio itself is a desktop application and is not available in CI. Before a
release, verify at least one converted project per printer family in Flash
Studio:

1. Open with **File → Open Project**, not drag-and-drop.
2. Confirm the printer, process and filament list.
3. Check the colour preview and plate layout.
4. Slice and inspect the first layers.
5. Save or print a test.
