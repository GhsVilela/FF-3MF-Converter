# Compatibility and manual validation

Automated tests cover the conversion engine and use the OrcaSlicer CLI to verify
that the generated project can be opened and sliced. Flash Studio itself is a
desktop application, so the final check is manual.

## CI validation

The test suite:

- Parses the generated ZIP and project settings.
- Checks target identity, filament counts, `different_settings_to_system` length
  and paint ranges.
- Confirms the application stamp.
- Slices converted fixtures with OrcaSlicer 2.3.0 in development.

A release candidate should also be sliced with the OrcaSlicer version that
matches the target generation.

## Manual Flash Studio checklist

Run this before tagging a release, and whenever a printer profile changes.

### AD5X / Adventurer 5M / 5M Pro

- [ ] Convert a single-colour project.
- [ ] Open Flash Studio and use **File → Open Project**.
- [ ] Confirm the printer model, nozzle and process.
- [ ] Confirm the filament list and temperatures.
- [ ] Slice and inspect the first layer.
- [ ] Convert a four-colour project for AD5X.
- [ ] Confirm four source colours map to four IFS slots (or the chosen merge).
- [ ] Slice and inspect the colour changes and prime tower.
- [ ] Convert the same project for 5M and confirm the single-colour merge.
- [ ] Check a multi-plate project and the bed fit warning.

### Creator 5 / Creator 5 Pro

- [ ] Convert a four-colour project.
- [ ] Open as a project and confirm four toolheads/filaments.
- [ ] Slice and inspect tool changes.
- [ ] Confirm the template compatibility warning is absent, or document the
      required Flash Studio version.

### General

- [ ] A generic geometry-only 3MF converts with target defaults.
- [ ] A sliced `.gcode.3mf` is rejected with a useful message.
- [ ] A model larger than the bed produces a warning and is not silently scaled.
- [ ] The report lists kept, adapted and dropped settings.
- [ ] The downloaded file has the expected name and opens again.

## Known compatibility notes

- Flash Studio may show a newer-file warning for Creator 5 templates because
  they use the newer OrcaSlicer profile generation. If it appears, update Flash
  Studio or use the AD5X/5M path where possible.
- Orca/Flash Studio can ignore project settings when a file is dragged onto the
  plate instead of opened as a project. The UI and documentation call this out.
- OrcaSlicer's upstream AD5X multicolour slicing is not identical to Flash
  Studio's IFS handling. Automated slicing is a structural check, not a
  guarantee of printer behaviour.
- The output is a project, not a sliced print file. It does not contain G-code,
  thumbnails for the target printer, or print-time estimates.
