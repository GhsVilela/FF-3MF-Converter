import { statSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
import type { SourceAnalysis, SourceFilament } from '@ff3mf/shared';
import { ConversionError } from './errors.js';
import { DEFAULT_LIMITS, type ConversionLimits } from './limits.js';
import { readZip, type ZipContents } from './zip.js';
import { scanModelXml, type XmlScan } from './xml.js';

export interface LoadedSource {
  filePath: string;
  contents: ZipContents;
  rootModelName: string;
  rootXml: string;
  rootScan: XmlScan;
  modelFiles: Map<string, { xml: string; scan: XmlScan }>;
  projectConfig?: Record<string, unknown>;
  modelSettingsXml?: string;
  analysis: SourceAnalysis;
  unitScale: number;
  usedSlots: number[];
  sourceFilaments: SourceFilament[];
  plateCount: number;
  bounds: { min: [number, number, number]; max: [number, number, number] } | null;
  worldBounds: { min: [number, number, number]; max: [number, number, number] } | null;
}

type Bounds = { min: [number, number, number]; max: [number, number, number] };

function transformTranslation(transform: string | undefined): [number, number, number] {
  if (!transform) return [0, 0, 0];
  const parts = transform.trim().split(/\s+/).map(Number);
  if (parts.length !== 12 || parts.some((part) => !Number.isFinite(part))) return [0, 0, 0];
  return [parts[9] ?? 0, parts[10] ?? 0, parts[11] ?? 0];
}

function shiftBounds(bounds: Bounds, translation: [number, number, number]): Bounds {
  return {
    min: [
      bounds.min[0] + translation[0],
      bounds.min[1] + translation[1],
      bounds.min[2] + translation[2],
    ],
    max: [
      bounds.max[0] + translation[0],
      bounds.max[1] + translation[1],
      bounds.max[2] + translation[2],
    ],
  };
}

function mergeBounds(left: Bounds | null, right: Bounds | null): Bounds | null {
  if (!left) return right;
  if (!right) return left;
  return {
    min: [
      Math.min(left.min[0], right.min[0]),
      Math.min(left.min[1], right.min[1]),
      Math.min(left.min[2], right.min[2]),
    ],
    max: [
      Math.max(left.max[0], right.max[0]),
      Math.max(left.max[1], right.max[1]),
      Math.max(left.max[2], right.max[2]),
    ],
  };
}

function computeWorldBounds(
  rootScan: XmlScan,
  modelFiles: Map<string, { xml: string; scan: XmlScan }>,
): Bounds | null {
  const rootBounds = new Map<string, Bounds>();
  for (const [id, bounds] of Object.entries(rootScan.objectBounds)) {
    rootBounds.set(id, bounds);
  }

  const modelBoundsByPath = new Map<string, Map<string, Bounds>>();
  for (const [name, entry] of modelFiles) {
    const byId = new Map<string, Bounds>();
    for (const [id, bounds] of Object.entries(entry.scan.objectBounds)) byId.set(id, bounds);
    modelBoundsByPath.set(name.replace(/^\/+/, ''), byId);
  }

  const resolveRootObject = (id: string, seen = new Set<string>()): Bounds | null => {
    if (rootBounds.has(id)) return rootBounds.get(id) ?? null;
    if (seen.has(id)) return null;
    seen.add(id);
    const object = rootScan.objects.find((entry) => entry.id === id);
    if (!object) return null;
    let combined: Bounds | null = null;
    for (const component of object.components) {
      if (!component.objectId) continue;
      const path = component.path?.replace(/^\/+/, '');
      let child: Bounds | null = null;
      if (path) {
        child = modelBoundsByPath.get(path)?.get(component.objectId) ?? null;
      } else {
        child = resolveRootObject(component.objectId, seen);
      }
      if (child) {
        const shifted = shiftBounds(child, transformTranslation(component.transform));
        combined = mergeBounds(combined, shifted);
      }
    }
    if (combined) rootBounds.set(id, combined);
    return combined;
  };

  for (const object of rootScan.objects) resolveRootObject(object.id);

  let world: Bounds | null = null;
  if (rootScan.items.length > 0) {
    for (const item of rootScan.items) {
      const local = resolveRootObject(item.objectId);
      if (!local) continue;
      world = mergeBounds(world, shiftBounds(local, transformTranslation(item.transform)));
    }
  }
  if (!world) {
    for (const bounds of rootBounds.values()) world = mergeBounds(world, bounds);
  }
  if (!world) {
    for (const bounds of rootScan.objectBounds ? Object.values(rootScan.objectBounds) : []) {
      world = mergeBounds(world, bounds);
    }
  }
  return world;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  trimValues: true,
  allowBooleanAttributes: true,
  processEntities: false,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function findRootModel(contents: ZipContents): string {
  const rels = contents.files.get('_rels/.rels');
  if (rels) {
    try {
      const parsed = xmlParser.parse(rels.toString('utf8')) as Record<string, any>;
      const relationships = asArray(parsed?.Relationships?.Relationship);
      for (const relationship of relationships) {
        const target = String(relationship?.Target ?? '');
        const type = String(relationship?.Type ?? '');
        if (type.includes('/3dmodel') && target) {
          return target.replace(/^\/+/, '');
        }
      }
    } catch {
      // Fall back to the conventional path below.
    }
  }
  if (contents.files.has('3D/3dmodel.model')) return '3D/3dmodel.model';
  const candidate = contents.names.find((name) => name.toLowerCase().endsWith('.model'));
  if (candidate) return candidate;
  throw new ConversionError('NO_MODEL', 'This 3MF does not contain a 3D model');
}

function getUnitScale(unit: string): number {
  switch (unit.toLowerCase()) {
    case 'micron':
      return 0.001;
    case 'centimeter':
      return 10;
    case 'inch':
      return 25.4;
    case 'foot':
      return 304.8;
    case 'meter':
      return 1000;
    default:
      return 1;
  }
}

function unionBounds(
  target: { min: [number, number, number]; max: [number, number, number] } | null,
  source: { min: [number, number, number]; max: [number, number, number] } | null,
  scale: number,
): { min: [number, number, number]; max: [number, number, number] } | null {
  if (!source) return target;
  const scaled: { min: [number, number, number]; max: [number, number, number] } = {
    min: [source.min[0] * scale, source.min[1] * scale, source.min[2] * scale],
    max: [source.max[0] * scale, source.max[1] * scale, source.max[2] * scale],
  };
  if (!target) return scaled;
  return {
    min: [
      Math.min(target.min[0], scaled.min[0]),
      Math.min(target.min[1], scaled.min[1]),
      Math.min(target.min[2], scaled.min[2]),
    ],
    max: [
      Math.max(target.max[0], scaled.max[0]),
      Math.max(target.max[1], scaled.max[1]),
      Math.max(target.max[2], scaled.max[2]),
    ],
  };
}

function extractExtruderSlots(modelSettingsXml?: string): number[] {
  if (!modelSettingsXml) return [];
  const slots: number[] = [];
  const pattern = /key="extruder"\s+value="(\d+)"/g;
  for (const match of modelSettingsXml.matchAll(pattern)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) slots.push(value);
  }
  return slots;
}

function parseProjectConfig(contents: ZipContents): Record<string, unknown> | undefined {
  const raw = contents.files.get('Metadata/project_settings.config');
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('project settings are not an object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new ConversionError('INVALID_FILE', 'The 3MF project settings are not valid JSON', [
      error instanceof Error ? error.message : String(error),
    ]);
  }
}

function arrayValue(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

export async function loadSourceAsync(
  filePath: string,
  limits: ConversionLimits = DEFAULT_LIMITS,
): Promise<LoadedSource> {
  const contents = await readZip(filePath, limits);
  return loadSourceFromContents(filePath, contents);
}

function loadSourceFromContents(filePath: string, contents: ZipContents): LoadedSource {
  const gcodeFiles = contents.names.filter((name) => /^Metadata\/plate_\d+\.gcode$/i.test(name));
  if (gcodeFiles.length > 0) {
    throw new ConversionError(
      'SLICED_FILE',
      'This is a sliced print file (.gcode.3mf), not an editable project. Upload the original .3mf project instead.',
    );
  }

  const rootModelName = findRootModel(contents);
  const rootBuffer = contents.files.get(rootModelName);
  if (!rootBuffer) {
    throw new ConversionError('NO_MODEL', `The 3MF model entry is missing: ${rootModelName}`);
  }
  const rootXml = rootBuffer.toString('utf8');
  const rootScan = scanModelXml(rootXml);

  const modelFiles = new Map<string, { xml: string; scan: XmlScan }>();
  for (const name of contents.names) {
    if (name === rootModelName) continue;
    if (!/^3D\/.*\.model$/i.test(name)) continue;
    const buffer = contents.files.get(name);
    if (!buffer) continue;
    const xml = buffer.toString('utf8');
    modelFiles.set(name, { xml, scan: scanModelXml(xml) });
  }

  const projectConfig = parseProjectConfig(contents);
  const modelSettingsXml = contents.files.get('Metadata/model_settings.config')?.toString('utf8');

  let bounds: LoadedSource['bounds'] = rootScan.bounds;
  let triangles = rootScan.triangles;
  let vertices = rootScan.vertices;
  for (const { scan } of modelFiles.values()) {
    bounds = unionBounds(bounds, scan.bounds, 1);
    triangles += scan.triangles;
    vertices += scan.vertices;
  }

  if (vertices === 0 && triangles === 0) {
    throw new ConversionError(
      'NO_MODEL',
      'This 3MF does not contain editable mesh geometry. It may be a sliced print file or a metadata-only package.',
    );
  }

  const unit = rootScan.unit || 'millimeter';
  const unitScale = getUnitScale(unit);
  let worldBounds = computeWorldBounds(rootScan, modelFiles);
  if (unitScale !== 1) {
    if (bounds) {
      bounds = {
        min: [bounds.min[0] * unitScale, bounds.min[1] * unitScale, bounds.min[2] * unitScale],
        max: [bounds.max[0] * unitScale, bounds.max[1] * unitScale, bounds.max[2] * unitScale],
      };
    }
    if (worldBounds) {
      worldBounds = {
        min: [
          worldBounds.min[0] * unitScale,
          worldBounds.min[1] * unitScale,
          worldBounds.min[2] * unitScale,
        ],
        max: [
          worldBounds.max[0] * unitScale,
          worldBounds.max[1] * unitScale,
          worldBounds.max[2] * unitScale,
        ],
      };
    }
  }

  const paintStates = new Set<number>();
  let hasPaint = false;
  let hasCustomSupports = false;
  let hasCustomSeams = false;
  for (const scan of [rootScan, ...[...modelFiles.values()].map((entry) => entry.scan)]) {
    hasPaint ||= scan.hasPaint;
    hasCustomSupports ||= scan.hasCustomSupports;
    hasCustomSeams ||= scan.hasCustomSeams;
    for (const state of scan.paintStates) paintStates.add(state);
  }

  const extruderSlots = extractExtruderSlots(modelSettingsXml);
  const usedSlots = [...new Set([...paintStates, ...extruderSlots])]
    .filter((slot) => Number.isFinite(slot) && slot > 0)
    .sort((a, b) => a - b);

  const colorValues = arrayValue(projectConfig?.filament_colour).map(String);
  const typeValues = arrayValue(projectConfig?.filament_type).map(String);
  const nameValues = arrayValue(projectConfig?.filament_settings_id).map(String);
  const filamentCount = Math.max(colorValues.length, typeValues.length, ...usedSlots, 1);
  const effectiveUsedSlots = usedSlots.length > 0 ? usedSlots : [1];

  const sourceFilaments: SourceFilament[] = [];
  for (let slot = 1; slot <= filamentCount; slot += 1) {
    sourceFilaments.push({
      slot,
      color: normalizeColor(colorValues[slot - 1] ?? '#F2754E'),
      type: (typeValues[slot - 1] ?? 'PLA').toUpperCase(),
      name: nameValues[slot - 1] ?? `Filament ${slot}`,
      used: effectiveUsedSlots.includes(slot),
    });
  }

  const plateCount = Math.max(
    1,
    (modelSettingsXml?.match(/<plate\b/g) ?? []).length,
    (projectConfig?.wipe_tower_x as unknown[] | undefined)?.length ?? 1,
  );

  const metadata = rootScan.metadata;
  const application = metadata.Application ?? '';
  let sourceApp = 'Generic 3MF';
  if (metadata.OrcaSlicer || /^OrcaSlicer-/i.test(application)) sourceApp = 'OrcaSlicer';
  else if (/^BambuStudio-/i.test(application)) sourceApp = 'Bambu Studio / OrcaSlicer family';
  else if (/^PrusaSlicer-/i.test(application)) sourceApp = 'PrusaSlicer';
  else if (/^Cura/i.test(application)) sourceApp = 'Cura';
  else if (application) sourceApp = application;

  const sourcePrinter =
    stringValue(projectConfig?.printer_model) ?? stringValue(projectConfig?.printer_settings_id);
  const sourceProcess =
    stringValue(projectConfig?.print_settings_id) ?? stringValue(projectConfig?.print_profile);
  const layerHeightRaw = projectConfig?.layer_height;
  const layerHeight =
    typeof layerHeightRaw === 'number'
      ? layerHeightRaw
      : layerHeightRaw !== undefined
        ? Number.parseFloat(String(layerHeightRaw))
        : undefined;
  const nozzleRaw = arrayValue(projectConfig?.nozzle_diameter)[0];
  const nozzle = stringValue(nozzleRaw);

  const objects = Math.max(
    rootScan.objects.length,
    rootScan.items.length,
    [...modelFiles.values()].reduce((sum, entry) => sum + entry.scan.objects.length, 0),
  );

  const warnings: string[] = [];
  if (!projectConfig) {
    warnings.push(
      'No slicer settings were found. The model will use the selected FlashForge defaults.',
    );
  }
  if (unitScale !== 1) {
    warnings.push(`Model units were ${unit}; the converter will write millimetres.`);
  }
  if (modelSettingsXml && /<plate\b/g.test(modelSettingsXml)) {
    const plates = (modelSettingsXml.match(/<plate\b/g) ?? []).length;
    if (plates > 1) warnings.push(`The project contains ${plates} build plates.`);
  }
  if (hasPaint) warnings.push('Painted colour data will be remapped to the target filament slots.');
  if (!hasPaint && !projectConfig && rootScan.colors.length > 1) {
    warnings.push(
      'This file uses per-triangle colour groups without slicer paint data. The colours are preserved in the geometry but may not slice as separate filaments.',
    );
  }

  const analysis: SourceAnalysis = {
    fileName: filePath.split(/[\\/]/).pop() ?? 'model.3mf',
    fileSize: statSync(filePath).size,
    sourceApp,
    sourcePrinter,
    sourceProcess,
    layerHeight: Number.isFinite(layerHeight) ? layerHeight : undefined,
    nozzle,
    plates: plateCount,
    objects,
    triangles,
    colors: sourceFilaments,
    usedColorCount: effectiveUsedSlots.length,
    hasPaint,
    hasCustomSupports,
    hasCustomSeams,
    hasProjectSettings: Boolean(projectConfig),
    isSliced: false,
    warnings,
  };

  return {
    filePath,
    contents,
    rootModelName,
    rootXml,
    rootScan,
    modelFiles,
    projectConfig,
    modelSettingsXml,
    analysis,
    unitScale,
    usedSlots: effectiveUsedSlots,
    sourceFilaments,
    plateCount,
    bounds,
    worldBounds,
  };
}

export function normalizeColor(value: string): string {
  const trimmed = value.trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9A-F]{8}$/.test(trimmed)) return trimmed.slice(0, 7);
  if (/^[0-9A-F]{6}$/.test(trimmed)) return `#${trimmed}`;
  if (/^[0-9A-F]{8}$/.test(trimmed)) return `#${trimmed.slice(0, 6)}`;
  return '#F2754E';
}
