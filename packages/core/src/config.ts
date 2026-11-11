import type { ChangeEntry, ConversionOptions, FilamentMapping, PlateInfo } from '@open3mf/shared';
import { ConversionError } from './errors.js';
import type { LoadedSource } from './source.js';
import { normalizeColor } from './source.js';

export interface TargetProcessPreset {
  name: string;
  layerHeight: string;
  config: Record<string, unknown>;
}

export interface TargetFilamentPreset {
  name: string;
  type: string;
  config: Record<string, unknown>;
}

export interface TargetProfileInput {
  printer: {
    id: string;
    name: string;
    maxColors: number;
  };
  nozzle: {
    diameter: string;
    machineProfile: string;
    defaultProcess: string;
    defaultFilament: string;
    build: {
      area: string[];
      height: number;
      extruders: number;
    };
    processes: Array<{ name: string; layerHeight: string }>;
  };
  machine: Record<string, unknown>;
  processes: TargetProcessPreset[];
  filaments: TargetFilamentPreset[];
  template: {
    application: string;
    threeMfVersion: string;
    source: string;
    config: Record<string, unknown>;
  };
  process: TargetProcessPreset;
}

export interface BuildConfigResult {
  projectConfig: Record<string, unknown>;
  filamentMapping: FilamentMapping[];
  settings: ChangeEntry[];
  warnings: string[];
  plates: PlateInfo[];
  paintMap: Map<number, number>;
  targetSlotCount: number;
  translate: { x: number; y: number } | undefined;
  scale: number;
  unitScale: number;
  metadata: {
    set: Record<string, string>;
    strip: Set<string>;
  };
}

const QUALITY_KEYS = new Set([
  'layer_height',
  'initial_layer_print_height',
  'wall_loops',
  'wall_thickness',
  'wall_generator',
  'wall_sequence',
  'wall_infill_order',
  'outer_wall_line_width',
  'inner_wall_line_width',
  'internal_solid_infill_line_width',
  'top_surface_line_width',
  'initial_layer_line_width',
  'sparse_infill_line_width',
  'support_line_width',
  'min_wall_thickness',
  'detect_thin_wall',
  'only_one_wall_top',
  'only_one_wall_first_layer',
  'min_feature_size',
  'min_length_factor',
  'top_shell_layers',
  'bottom_shell_layers',
  'top_shell_thickness',
  'bottom_shell_thickness',
  'top_surface_density',
  'bottom_surface_density',
  'top_surface_pattern',
  'bottom_surface_pattern',
  'internal_solid_infill_pattern',
  'sparse_infill_density',
  'sparse_infill_pattern',
  'sparse_infill_anchor',
  'sparse_infill_anchor_max',
  'infill_combination',
  'infill_direction',
  'infill_overlap',
  'minimum_sparse_infill_area',
  'gap_fill_enabled',
  'gap_fill_target',
  'filter_out_gap_fill',
  'infill_wall_overlap',
  'solid_infill_direction',
  'fill_multiline',
  'enable_support',
  'support_type',
  'support_style',
  'support_threshold_angle',
  'support_on_build_plate_only',
  'support_interface_top_layers',
  'support_interface_bottom_layers',
  'support_interface_pattern',
  'support_top_z_distance',
  'support_bottom_z_distance',
  'support_object_xy_distance',
  'support_interface_spacing',
  'support_base_pattern',
  'support_base_pattern_spacing',
  'support_angle',
  'support_remove_small_overhang',
  'tree_support_branch_angle',
  'tree_support_branch_distance',
  'tree_support_wall_count',
  'tree_support_angle_slow',
  'tree_support_auto_brim',
  'tree_support_brim_width',
  'support_filament',
  'support_interface_filament',
  'support_interface_loop_pattern',
  'brim_type',
  'brim_width',
  'brim_object_gap',
  'brim_ears',
  'brim_ears_max_angle',
  'skirt_loops',
  'skirt_distance',
  'skirt_height',
  'draft_shield',
  'raft_layers',
  'seam_position',
  'seam_gap',
  'scarf_enable',
  'scarf_length',
  'scarf_gap',
  'scarf_overhang_threshold',
  'wipe_before_external_loop',
  'wipe_on_loops',
  'ironing_type',
  'ironing_flow',
  'ironing_spacing',
  'ironing_pattern',
  'ironing_angle',
  'ironing_inset',
  'spiral_mode',
  'spiral_mode_smooth',
  'fuzzy_skin',
  'fuzzy_skin_thickness',
  'fuzzy_skin_point_distance',
  'fuzzy_skin_first_layer',
  'print_sequence',
  'exclude_object',
  'gcode_label_objects',
  'reduce_crossing_wall',
  'avoid_crossing_perimeters',
  'enable_prime_tower',
  'prime_tower_width',
  'prime_tower_brim_width',
  'prime_tower_rib_wall',
  'wipe_tower_x',
  'wipe_tower_y',
  'filament_prime_volume',
  'flush_volumes_matrix',
]);

const DROP_PATTERN =
  /speed|acceleration|jerk|pressure_advance|retraction|z_hop|fan_|auxiliary|chamber_|volumetric|purge|flush_|machine_|gcode|start_gcode|end_gcode|timelapse|camera|ams|calibration|lidar|scan_first_layer|bbl_|host|physical_extruder_map|filament_map|extruder_colour|extruder_offset|printable_area|nozzle_diameter|nozzle_temperature_range|filament_ids|filament_settings_id|filament_colour|filament_type|filament_diameter|filament_density|filament_cost|filament_vendor|filament_soluble|filament_is_support|filament_notes|default_filament_profile|compatible_printers|print_compatible_printers|upward_compatible_machine|printer_model|printer_variant|printer_settings_id|print_settings_id/i;

const ENUM_KEYS = new Set([
  'sparse_infill_pattern',
  'internal_solid_infill_pattern',
  'top_surface_pattern',
  'bottom_surface_pattern',
  'seam_position',
  'support_type',
  'support_style',
  'brim_type',
  'ironing_type',
  'wall_generator',
  'wall_sequence',
  'gap_fill_target',
  'print_sequence',
  'draft_shield',
  'fuzzy_skin',
  'spiral_mode',
  'support_on_build_plate_only',
  'brim_ears',
  'tree_support_auto_brim',
]);

const VALUE_MAPS: Record<string, Record<string, string>> = {
  sparse_infill_pattern: {
    'zig-zag': 'rectilinear',
    zigzag: 'rectilinear',
    grid: 'grid',
    cubic: 'cubic',
    gyroid: 'gyroid',
    line: 'line',
    concentric: 'concentric',
    honeycomb: 'honeycomb',
    triangles: 'triangles',
    lightning: 'lightning',
    '3dhoneycomb': '3dhoneycomb',
  },
  internal_solid_infill_pattern: {
    'zig-zag': 'rectilinear',
    zigzag: 'rectilinear',
  },
  brim_type: {
    auto_brim: 'auto',
    outer_only: 'outer_only',
    no_brim: 'no_brim',
    outer_and_inner: 'outer_and_inner',
    inner_only: 'inner_only',
  },
};

const PER_FILAMENT_KEY =
  /^(filament_|nozzle_temperature$|nozzle_temperature_initial_layer$|nozzle_temperature_range_|hot_plate_temp|cool_plate_temp|eng_plate_temp|textured_.*plate_temp|supertack_plate_temp|pressure_advance$|slow_down_layer_time$|slow_down_for_layer_cooling$|fan_cooling_layer_time$|overhang_fan_|close_fan_|full_fan_|chamber_temperature$|activate_air_filtration$|during_print_exhaust_fan_speed$|additional_cooling_fan_speed$|reduce_fan_stop_start_freq$|dont_slow_down_outer_wall$|enable_overhang_bridge_fan$|support_material_interface_fan_speed$|support_material_fan_speed$)/;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function arrayValue(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function firstValue(value: unknown): unknown {
  return arrayValue(value)[0];
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return undefined;
}

function numericValue(value: unknown): number | undefined {
  const raw = firstValue(value);
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeForComparison(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map((entry) => String(entry)));
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value === undefined || value === null) return '';
  return String(value);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return normalizeForComparison(left) === normalizeForComparison(right);
}

function valueAt(value: unknown, index: number): unknown {
  if (Array.isArray(value)) return value[index] ?? value[0];
  return value;
}

function setAt(config: Record<string, unknown>, key: string, index: number, value: unknown): void {
  const current = config[key];
  if (Array.isArray(current)) {
    const next = current.slice();
    while (next.length < index + 1) next.push(next[0] ?? value);
    next[index] = value;
    config[key] = next;
  } else {
    const length = index + 1;
    config[key] = Array.from({ length }, (_, position) =>
      position === index ? value : (current ?? value),
    );
  }
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const current = target[key];
    // Profile files occasionally wrap scalar settings in a one-element array.
    // The template is a real project snapshot, so its type wins.
    if (
      Array.isArray(value) &&
      value.length === 1 &&
      current !== undefined &&
      !Array.isArray(current)
    ) {
      target[key] = clone(value[0]);
    } else {
      target[key] = clone(value);
    }
  }
}

function addSetting(
  settings: ChangeEntry[],
  key: string,
  category: ChangeEntry['category'],
  decision: ChangeEntry['decision'],
  reason: string,
  sourceValue?: unknown,
  targetValue?: unknown,
): void {
  settings.push({ key, category, decision, reason, sourceValue, targetValue });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function bedExtents(area: string[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
} {
  const points = area
    .map((entry) => entry.split('x').map(Number))
    .filter((point) => point.length === 2 && point.every(Number.isFinite)) as Array<
    [number, number]
  >;
  if (points.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: 256,
      maxY: 256,
      width: 256,
      height: 256,
      centerX: 128,
      centerY: 128,
    };
  }
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

function buildFilamentMapping(
  source: LoadedSource,
  maxColors: number,
  requested: Record<string, number> | undefined,
  settings: ChangeEntry[],
  warnings: string[],
): { mapping: FilamentMapping[]; paintMap: Map<number, number>; targetSlotCount: number } {
  const sourceSlots = source.usedSlots.length > 0 ? source.usedSlots : [1];
  const colorOf = (slot: number) =>
    source.sourceFilaments.find((filament) => filament.slot === slot)?.color ?? '#F2754E';
  const typeOf = (slot: number) =>
    source.sourceFilaments.find((filament) => filament.slot === slot)?.type ?? 'PLA';
  const nameOf = (slot: number) =>
    source.sourceFilaments.find((filament) => filament.slot === slot)?.name ?? `Filament ${slot}`;

  const paintMap = new Map<number, number>();
  const mapping: FilamentMapping[] = [];

  for (let index = 0; index < sourceSlots.length; index += 1) {
    const sourceSlot = sourceSlots[index] ?? 1;
    let targetSlot: number;
    if (requested && requested[String(sourceSlot)] !== undefined) {
      targetSlot = requested[String(sourceSlot)] ?? 1;
    } else if (maxColors === 1) {
      targetSlot = 1;
    } else if (sourceSlots.length <= maxColors) {
      targetSlot = index + 1;
    } else {
      targetSlot = (index % maxColors) + 1;
    }
    targetSlot = clamp(Math.trunc(targetSlot), 1, maxColors);
    paintMap.set(sourceSlot, targetSlot);
    mapping.push({
      sourceSlot,
      sourceColor: colorOf(sourceSlot),
      sourceType: typeOf(sourceSlot),
      targetSlot,
      targetPreset: '',
      targetColor: colorOf(sourceSlot),
      targetType: typeOf(sourceSlot),
      merged: false,
    });
    if (requested?.[String(sourceSlot)] !== undefined) {
      addSetting(
        settings,
        `filament_slot_${sourceSlot}`,
        'filament',
        'translated',
        'Mapped to the target filament slot.',
        sourceSlot,
        targetSlot,
      );
    }
    if (sourceSlots.length > maxColors && !requested) {
      addSetting(
        settings,
        `filament_slot_${sourceSlot}`,
        'filament',
        'translated',
        `The target supports ${maxColors} colour${maxColors === 1 ? '' : 's'}; similar colours may be merged.`,
        sourceSlot,
        targetSlot,
      );
    }
    if (nameOf(sourceSlot)) {
      // Name is informational; the target preset is selected below.
    }
  }

  const byTarget = new Map<number, FilamentMapping[]>();
  for (const entry of mapping) {
    const group = byTarget.get(entry.targetSlot) ?? [];
    group.push(entry);
    byTarget.set(entry.targetSlot, group);
  }
  for (const group of byTarget.values()) {
    if (group.length > 1) {
      for (const entry of group) entry.merged = true;
      warnings.push(
        `Source filaments ${group.map((entry) => entry.sourceSlot).join(', ')} share target slot ${group[0]?.targetSlot}. The first colour/material wins.`,
      );
    }
  }

  const highestTargetSlot = Math.max(1, ...mapping.map((entry) => entry.targetSlot));
  return {
    mapping,
    paintMap,
    targetSlotCount: Math.max(1, Math.min(maxColors, Math.max(byTarget.size, highestTargetSlot))),
  };
}

function chooseFilamentPreset(profile: TargetProfileInput, material: string): TargetFilamentPreset {
  const normalized = material.trim().toUpperCase();
  const candidates = profile.filaments.filter(
    (preset) => preset.type?.toUpperCase() === normalized,
  );
  const isCompatible = (preset: TargetFilamentPreset) => {
    const compatible = preset.config.compatible_printers;
    if (!compatible) return true;
    const list = Array.isArray(compatible) ? compatible : [compatible];
    return list.map(String).includes(profile.nozzle.machineProfile);
  };
  const compatibleCandidates = candidates.filter(isCompatible);
  const pool = compatibleCandidates.length > 0 ? compatibleCandidates : candidates;
  const preferred =
    pool.find((preset) => preset.name.includes('Generic')) ??
    pool.find((preset) => preset.name.includes('Flashforge')) ??
    pool[0] ??
    profile.filaments.find((preset) => preset.name === profile.nozzle.defaultFilament) ??
    profile.filaments[0];
  if (!preferred) {
    throw new ConversionError(
      'PROFILE_ERROR',
      `No filament preset is available for ${profile.printer.name}`,
    );
  }
  return preferred;
}

function applyTargetFilaments(
  config: Record<string, unknown>,
  profile: TargetProfileInput,
  source: LoadedSource,
  mapping: FilamentMapping[],
  targetSlotCount: number,
  preserveTemperatures: boolean,
  settings: ChangeEntry[],
  warnings: string[],
): TargetFilamentPreset[] {
  const selected: TargetFilamentPreset[] = [];
  for (let targetSlot = 1; targetSlot <= targetSlotCount; targetSlot += 1) {
    const entries = mapping.filter((entry) => entry.targetSlot === targetSlot);
    const representative = entries[0];
    const sourceSlot = representative?.sourceSlot ?? 1;
    const sourceFilament = source.sourceFilaments.find((filament) => filament.slot === sourceSlot);
    const preset = chooseFilamentPreset(profile, sourceFilament?.type ?? 'PLA');
    selected.push(preset);
    if (representative) {
      for (const entry of entries) {
        entry.targetPreset = preset.name;
        entry.targetType = preset.type;
        entry.targetColor = normalizeColor(sourceFilament?.color ?? entry.sourceColor);
      }
      if (entries.length > 1) {
        const materials = new Set(entries.map((entry) => entry.sourceType));
        if (materials.size > 1) {
          warnings.push(
            `Target slot ${targetSlot} merges different materials (${[...materials].join(', ')}). The ${preset.type} preset is used.`,
          );
        }
      }
    }
  }

  // Build per-filament arrays from the selected target presets.
  const filamentKeys = new Set<string>();
  for (const preset of selected) {
    for (const key of Object.keys(preset.config)) {
      if (PER_FILAMENT_KEY.test(key)) filamentKeys.add(key);
    }
  }
  for (const key of Object.keys(config)) {
    if (PER_FILAMENT_KEY.test(key)) filamentKeys.add(key);
  }
  filamentKeys.delete('filament_id');
  filamentKeys.delete('filament_map_mode');
  delete config.filament_id;

  for (const key of filamentKeys) {
    const values = selected.map(
      (preset) => valueAt(preset.config[key], 0) ?? valueAt(config[key], 0),
    );
    if (values.every((value) => value === undefined)) continue;
    config[key] = values;
  }

  // Filament identity and colour are project data, not preset data.
  config.filament_settings_id = selected.map((preset) => preset.name);
  delete config.filament_id;
  config.filament_colour = selected.map((_, index) => {
    const representative = mapping.find((entry) => entry.targetSlot === index + 1);
    return normalizeColor(representative?.targetColor ?? representative?.sourceColor ?? '#F2754E');
  });
  config.filament_type = selected.map((preset) => preset.type.toUpperCase());
  config.filament_diameter = selected.map(() => '1.75');
  delete config.filament_ids;

  if (preserveTemperatures) {
    for (let targetSlot = 1; targetSlot <= targetSlotCount; targetSlot += 1) {
      const representative = mapping.find((entry) => entry.targetSlot === targetSlot);
      const sourceSlot = representative?.sourceSlot ?? 1;
      const sourceConfig = source.projectConfig;
      if (!sourceConfig) continue;
      const preset = selected[targetSlot - 1];
      const low = numericValue(preset?.config.nozzle_temperature_range_low) ?? 170;
      const high = numericValue(preset?.config.nozzle_temperature_range_high) ?? 300;
      const temperatures: Array<[string, number, number]> = [
        ['nozzle_temperature', low, high],
        ['nozzle_temperature_initial_layer', low, high],
        ['hot_plate_temp', 0, 120],
        ['hot_plate_temp_initial_layer', 0, 120],
        ['textured_plate_temp', 0, 120],
        ['textured_plate_temp_initial_layer', 0, 120],
        ['cool_plate_temp', 0, 120],
        ['cool_plate_temp_initial_layer', 0, 120],
        ['eng_plate_temp', 0, 120],
        ['eng_plate_temp_initial_layer', 0, 120],
      ];
      for (const [key, min, max] of temperatures) {
        const raw = valueAt(sourceConfig[key], sourceSlot - 1);
        const value = numericValue(raw);
        if (value === undefined) continue;
        const clamped = clamp(value, min, max);
        setAt(config, key, targetSlot - 1, String(clamped));
        if (clamped !== value) {
          addSetting(
            settings,
            key,
            'temperature',
            'clamped',
            `Temperature clamped to the ${profile.printer.name} safe range.`,
            value,
            clamped,
          );
        } else {
          addSetting(
            settings,
            key,
            'temperature',
            'kept',
            'Author temperature preserved within the target printer range.',
            value,
            clamped,
          );
        }
      }
    }
  }

  return selected;
}

function sourceOverrideKeys(source: LoadedSource): Set<string> {
  const diff = source.projectConfig?.different_settings_to_system;
  const processKeys = Array.isArray(diff) ? diff[0] : diff;
  if (typeof processKeys !== 'string' || processKeys.length === 0) return new Set<string>();
  return new Set(
    processKeys
      .split(';')
      .map((key) => key.trim())
      .filter(Boolean),
  );
}

function applyQualitySettings(
  config: Record<string, unknown>,
  profile: TargetProfileInput,
  source: LoadedSource,
  paintMap: Map<number, number>,
  settings: ChangeEntry[],
  warnings: string[],
): void {
  const sourceConfig = source.projectConfig;
  if (!sourceConfig) return;
  const overrides = sourceOverrideKeys(source);
  if (overrides.size === 0) {
    warnings.push(
      'The source project has no author process overrides; the target process preset provides the print settings.',
    );
    return;
  }

  const allowedValues = new Map<string, Set<string>>();
  for (const key of ENUM_KEYS) {
    const set = new Set<string>();
    for (const process of profile.processes) {
      const value = stringValue(process.config[key]);
      if (value !== undefined) set.add(value);
    }
    const templateValue = stringValue(config[key]);
    if (templateValue !== undefined) set.add(templateValue);
    allowedValues.set(key, set);
  }

  const nozzleLow = numericValue(profile.machine.min_layer_height) ?? 0.08;
  const nozzleHigh = numericValue(profile.machine.max_layer_height) ?? 0.28;

  for (const key of overrides) {
    const rawSource = sourceConfig[key];
    if (rawSource === undefined) continue;
    if (!QUALITY_KEYS.has(key)) {
      if (DROP_PATTERN.test(key) && !key.startsWith('filament_')) {
        addSetting(
          settings,
          key,
          'other',
          'dropped',
          'Machine-specific tuning from the source printer is not transferred.',
          rawSource,
        );
      }
      continue;
    }
    if (DROP_PATTERN.test(key)) {
      addSetting(
        settings,
        key,
        'other',
        'dropped',
        'Machine-specific tuning from the source printer is not transferred.',
        rawSource,
      );
      continue;
    }

    let value = firstValue(rawSource);
    if (key === 'support_filament' || key === 'support_interface_filament') {
      const slot = numericValue(value);
      if (slot !== undefined && slot > 0) {
        value = paintMap.get(slot) ?? 0;
      }
    }

    if (key === 'layer_height' || key === 'initial_layer_print_height') {
      const numeric = numericValue(value);
      if (numeric === undefined) continue;
      const clamped = clamp(numeric, nozzleLow, nozzleHigh);
      config[key] = String(clamped);
      if (clamped !== numeric) {
        addSetting(
          settings,
          key,
          'quality',
          'clamped',
          `Layer height clamped to the ${profile.nozzle.diameter} mm nozzle range.`,
          numeric,
          clamped,
        );
      } else {
        addSetting(settings, key, 'quality', 'kept', 'Author quality setting preserved.', numeric);
      }
      continue;
    }

    if (ENUM_KEYS.has(key)) {
      const text = stringValue(value);
      if (text === undefined) continue;
      const allowed = allowedValues.get(key) ?? new Set<string>();
      if (allowed.size === 0 || allowed.has(text)) {
        config[key] = text;
        addSetting(settings, key, 'quality', 'kept', 'Author quality setting preserved.', text);
        continue;
      }
      const mapped = VALUE_MAPS[key]?.[text.toLowerCase()];
      if (mapped && (allowed.size === 0 || allowed.has(mapped))) {
        config[key] = mapped;
        addSetting(
          settings,
          key,
          'quality',
          'translated',
          'Translated to the equivalent value used by the target slicer.',
          text,
          mapped,
        );
        continue;
      }
      addSetting(
        settings,
        key,
        'quality',
        'dropped',
        'The target slicer does not support this value; the target preset default is used.',
        text,
      );
      continue;
    }

    if (value !== undefined) {
      config[key] = Array.isArray(value) ? value : String(value);
      addSetting(settings, key, 'quality', 'kept', 'Author quality setting preserved.', value);
    }
  }
}

function applyPrimeTowerSettings(
  config: Record<string, unknown>,
  profile: TargetProfileInput,
  source: LoadedSource,
  settings: ChangeEntry[],
): void {
  const targetSlotCount = arrayValue(config.filament_colour).length;
  const independentTools = profile.nozzle.build.extruders > 1;
  if (targetSlotCount <= 1) {
    config.enable_prime_tower = '0';
  } else if (!independentTools) {
    config.enable_prime_tower = '1';
    config.filament_prime_volume = Array.from({ length: targetSlotCount }, () => '25');
    const size = targetSlotCount;
    const matrix: string[] = [];
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        matrix.push(row === column ? '0' : '280');
      }
    }
    config.flush_volumes_matrix = matrix;
  }

  const bed = bedExtents(profile.machine.printable_area as string[]);
  const towerWidth = numericValue(config.prime_tower_width) ?? 45;
  const towerBrim = numericValue(config.prime_tower_brim_width) ?? 3;
  // Wipe tower coordinates are the lower-left corner. Use a conservative footprint
  // so the tower stays clear of the bed edge even when Orca squares a rib tower.
  const footprint = Math.max(towerWidth, 80);
  const towerX = clamp(
    bed.centerX + bed.width * 0.08,
    bed.minX + 10,
    bed.maxX - footprint - towerBrim * 2 - 5,
  );
  const towerY = clamp(
    bed.centerY + bed.height * 0.08,
    bed.minY + 10,
    bed.maxY - footprint - towerBrim * 2 - 5,
  );
  const wipeX: string[] = [];
  const wipeY: string[] = [];
  for (let plate = 0; plate < source.plateCount; plate += 1) {
    wipeX.push(String(Math.round(towerX)));
    wipeY.push(String(Math.round(towerY)));
  }
  config.wipe_tower_x = wipeX;
  config.wipe_tower_y = wipeY;

  settings.push({
    key: 'enable_prime_tower',
    category: 'quality',
    decision: targetSlotCount > 1 && !independentTools ? 'translated' : 'replaced',
    reason:
      targetSlotCount > 1 && !independentTools
        ? 'Enabled because the target uses a single nozzle with multiple IFS/tool slots.'
        : 'The target printer does not need a purge tower for this configuration.',
    sourceValue: source.projectConfig?.enable_prime_tower,
    targetValue: config.enable_prime_tower,
  });
}

function applyIdentityAndCompatibility(
  config: Record<string, unknown>,
  profile: TargetProfileInput,
  selectedFilaments: TargetFilamentPreset[],
  targetSlotCount: number,
): void {
  const machineModel = stringValue(profile.machine.printer_model) ?? profile.nozzle.machineProfile;
  const machineVariant = stringValue(profile.machine.printer_variant) ?? profile.nozzle.diameter;
  const nozzleArray = arrayValue(profile.machine.nozzle_diameter);
  const extruders = profile.nozzle.build.extruders;

  config.printer_model = machineModel;
  config.printer_variant = machineVariant;
  config.printer_settings_id = profile.nozzle.machineProfile;
  config.print_settings_id = profile.process.name;
  config.filament_settings_id = selectedFilaments.map((preset) => preset.name);
  config.nozzle_diameter = Array.from(
    { length: extruders },
    () => stringValue(nozzleArray[0]) ?? profile.nozzle.diameter,
  );
  config.print_compatible_printers = [profile.nozzle.machineProfile];
  config.filament_diameter = Array.from({ length: targetSlotCount }, () => '1.75');
  config.thumbnails = stringValue(config.thumbnails) ?? '140x110/PNG';
  delete config.filament_ids;
}

function computeDifferentSettings(
  config: Record<string, unknown>,
  profile: TargetProfileInput,
  selectedFilaments: TargetFilamentPreset[],
  targetSlotCount: number,
): string[] {
  const processBaseline = profile.process.config;
  const templateBaseline = profile.template.config;
  const processKeys = new Set<string>();
  for (const key of Object.keys(processBaseline)) {
    if (DROP_PATTERN.test(key) || PER_FILAMENT_KEY.test(key)) continue;
    if (key in profile.machine) continue;
    processKeys.add(key);
  }
  for (const key of QUALITY_KEYS) {
    if (key in config && !(key in profile.machine) && !PER_FILAMENT_KEY.test(key)) {
      processKeys.add(key);
    }
  }

  const changedProcess: string[] = [];
  for (const key of processKeys) {
    if (!(key in config)) continue;
    const baseline = processBaseline[key] ?? templateBaseline[key];
    if (!valuesEqual(config[key], baseline)) {
      if (baseline === undefined && normalizeForComparison(config[key]) === '') continue;
      changedProcess.push(key);
    }
  }
  changedProcess.sort();

  const filamentBaselineKeys = new Set<string>();
  for (const preset of selectedFilaments) {
    for (const key of Object.keys(preset.config)) {
      if (PER_FILAMENT_KEY.test(key)) filamentBaselineKeys.add(key);
    }
  }
  for (const key of Object.keys(config)) {
    if (PER_FILAMENT_KEY.test(key)) filamentBaselineKeys.add(key);
  }

  const filamentChanged: string[][] = [];
  for (let slot = 0; slot < targetSlotCount; slot += 1) {
    const keys: string[] = [];
    for (const key of filamentBaselineKeys) {
      if (!(key in config)) continue;
      const baseline = selectedFilaments[slot]?.config[key] ?? templateBaseline[key];
      if (!valuesEqual(valueAt(config[key], slot), valueAt(baseline, 0))) {
        keys.push(key);
      }
    }
    keys.sort();
    filamentChanged.push(keys);
  }

  const changedPrinter: string[] = [];
  for (const key of Object.keys(profile.machine)) {
    if (key.startsWith('_') || key === 'from' || key === 'type' || key === 'name') continue;
    if (key === 'printer_settings_id' || key === 'thumbnails') continue;
    if (!(key in config)) continue;
    const baseline = profile.machine[key] ?? templateBaseline[key];
    if (!valuesEqual(config[key], baseline)) changedPrinter.push(key);
  }
  changedPrinter.sort();

  return [
    changedProcess.join(';'),
    ...filamentChanged.map((keys) => keys.join(';')),
    changedPrinter.join(';'),
  ];
}

function layoutResult(
  source: LoadedSource,
  profile: TargetProfileInput,
  options: ConversionOptions,
  warnings: string[],
): { translate: { x: number; y: number } | undefined; scale: number; plates: PlateInfo[] } {
  const bed = bedExtents(profile.machine.printable_area as string[]);
  const bounds = source.worldBounds ?? source.bounds;
  const layout = options.layout ?? 'center';
  const plates: PlateInfo[] = [];

  if (!bounds) {
    return {
      translate: undefined,
      scale: 1,
      plates: Array.from({ length: source.plateCount }, (_, index) => ({
        plate: index + 1,
        objects: source.analysis.objects,
        fits: true,
        moved: false,
      })),
    };
  }

  const width = bounds.max[0] - bounds.min[0];
  const height = bounds.max[1] - bounds.min[1];
  let scale = 1;
  if (layout === 'scale' && (width > bed.width || height > bed.height)) {
    scale = Math.min((bed.width - 10) / width, (bed.height - 10) / height, 1);
    warnings.push(
      `The model was scaled to ${(scale * 100).toFixed(1)}% to fit the ${profile.printer.name} build plate. Check dimensions before printing.`,
    );
  }

  const scaledWidth = width * scale;
  const scaledHeight = height * scale;
  const fits = scaledWidth <= bed.width + 0.01 && scaledHeight <= bed.height + 0.01;
  const shouldMove = layout !== 'keep' && source.plateCount === 1;

  let translate: { x: number; y: number } | undefined;
  if (shouldMove) {
    const sourceCenterX = ((bounds.min[0] + bounds.max[0]) / 2) * scale;
    const sourceCenterY = ((bounds.min[1] + bounds.max[1]) / 2) * scale;
    translate = {
      x: bed.centerX - sourceCenterX,
      y: bed.centerY - sourceCenterY,
    };
  }

  if (!fits && layout !== 'scale') {
    warnings.push(
      `The model is ${scaledWidth.toFixed(1)} × ${scaledHeight.toFixed(1)} mm and does not fit the ${bed.width} × ${bed.height} mm build plate. It was not scaled. Use "Scale to fit" or arrange it in Flash Studio.`,
    );
  }
  if (source.plateCount > 1) {
    warnings.push(
      'Multiple build plates were preserved as-is. Review the plate layout and fit in Flash Studio before slicing.',
    );
  }

  for (let plate = 1; plate <= source.plateCount; plate += 1) {
    plates.push({
      plate,
      objects: source.analysis.objects,
      fits,
      moved: Boolean(translate),
      note:
        source.plateCount > 1
          ? 'Multi-plate layout preserved; verify placement in Flash Studio.'
          : fits
            ? 'Model fits the target build plate.'
            : 'Model is larger than the target build plate.',
    });
  }

  return { translate, scale, plates };
}

export function buildTargetConfig(
  source: LoadedSource,
  profile: TargetProfileInput,
  options: ConversionOptions,
): BuildConfigResult {
  const settings: ChangeEntry[] = [];
  const warnings: string[] = [];

  const config = clone(profile.template.config);
  deepMerge(config, profile.machine);
  deepMerge(config, profile.process.config);

  const { mapping, paintMap, targetSlotCount } = buildFilamentMapping(
    source,
    profile.printer.maxColors,
    options.colorMapping,
    settings,
    warnings,
  );
  if (source.usedSlots.length > profile.printer.maxColors) {
    warnings.push(
      `This project uses ${source.usedSlots.length} colours; ${profile.printer.name} supports ${profile.printer.maxColors}. Review the filament mapping before printing.`,
    );
  }

  const selectedFilaments = applyTargetFilaments(
    config,
    profile,
    source,
    mapping,
    targetSlotCount,
    options.preserveTemperatures ?? true,
    settings,
    warnings,
  );

  applyQualitySettings(config, profile, source, paintMap, settings, warnings);
  applyPrimeTowerSettings(config, profile, source, settings);
  applyIdentityAndCompatibility(config, profile, selectedFilaments, targetSlotCount);

  config.different_settings_to_system = computeDifferentSettings(
    config,
    profile,
    selectedFilaments,
    targetSlotCount,
  );

  const layout = layoutResult(source, profile, options, warnings);

  const metadata = {
    set: {
      Application: profile.template.application,
      'BambuStudio:3mfVersion': profile.template.threeMfVersion,
      CreationDate: '',
      ModificationDate: '',
      DesignerUserId: '',
    },
    strip: new Set([
      'OrcaSlicer',
      'slic3rpe:Version3mf',
      'ProfileId',
      'ModelId',
      'ProfileCover',
      'DesignerCover',
    ]),
  };

  return {
    projectConfig: config,
    filamentMapping: mapping,
    settings,
    warnings,
    plates: layout.plates,
    paintMap,
    targetSlotCount,
    translate: layout.translate,
    scale: layout.scale,
    unitScale: source.unitScale,
    metadata,
  };
}

export function summarizeSettings(settings: ChangeEntry[]) {
  return {
    settingsKept: settings.filter((entry) => entry.decision === 'kept').length,
    settingsChanged: settings.filter((entry) =>
      ['translated', 'clamped', 'replaced'].includes(entry.decision),
    ).length,
    settingsDropped: settings.filter((entry) => entry.decision === 'dropped').length,
  };
}
