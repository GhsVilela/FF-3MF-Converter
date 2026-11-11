import { SaxesParser, type SaxesTag } from 'saxes';

export interface XmlScan {
  metadata: Record<string, string>;
  unit: string;
  triangles: number;
  vertices: number;
  bounds: { min: [number, number, number]; max: [number, number, number] } | null;
  objectBounds: Record<string, { min: [number, number, number]; max: [number, number, number] }>;
  hasPaint: boolean;
  hasCustomSupports: boolean;
  hasCustomSeams: boolean;
  paintStates: Set<number>;
  items: Array<{ objectId: string; transform?: string }>;
  objects: Array<{
    id: string;
    hasMesh: boolean;
    components: Array<{ objectId?: string; path?: string; transform?: string }>;
  }>;
  colors: string[];
}

function emptyScan(): XmlScan {
  return {
    metadata: {},
    unit: 'millimeter',
    triangles: 0,
    vertices: 0,
    bounds: null,
    objectBounds: {},
    hasPaint: false,
    hasCustomSupports: false,
    hasCustomSeams: false,
    paintStates: new Set<number>(),
    items: [],
    objects: [],
    colors: [],
  };
}

function addPoint(scan: XmlScan, x: number, y: number, z: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
  if (!scan.bounds) {
    scan.bounds = { min: [x, y, z], max: [x, y, z] };
    return;
  }
  scan.bounds.min[0] = Math.min(scan.bounds.min[0], x);
  scan.bounds.min[1] = Math.min(scan.bounds.min[1], y);
  scan.bounds.min[2] = Math.min(scan.bounds.min[2], z);
  scan.bounds.max[0] = Math.max(scan.bounds.max[0], x);
  scan.bounds.max[1] = Math.max(scan.bounds.max[1], y);
  scan.bounds.max[2] = Math.max(scan.bounds.max[2], z);
}

function attr(tag: SaxesTag, name: string): string | undefined {
  const value = tag.attributes[name];
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : value.value;
}

export function scanModelXml(xml: string): XmlScan {
  const scan = emptyScan();
  const parser = new SaxesParser({ xmlns: true });
  let currentObject: XmlScan['objects'][number] | undefined;
  let currentObjectId: string | undefined;
  let metadataName: string | undefined;
  let metadataText = '';
  let depth = 0;
  let objectDepth = 0;

  parser.on('opentag', (tag) => {
    depth += 1;
    switch (tag.name) {
      case 'model': {
        scan.unit = attr(tag, 'unit') ?? 'millimeter';
        break;
      }
      case 'metadata': {
        metadataName = attr(tag, 'name');
        metadataText = attr(tag, 'value') ?? '';
        break;
      }
      case 'vertex': {
        scan.vertices += 1;
        const x = Number(attr(tag, 'x'));
        const y = Number(attr(tag, 'y'));
        const z = Number(attr(tag, 'z'));
        addPoint(scan, x, y, z);
        if (currentObjectId) {
          const existing = scan.objectBounds[currentObjectId];
          if (!existing) {
            scan.objectBounds[currentObjectId] = { min: [x, y, z], max: [x, y, z] };
          } else {
            existing.min[0] = Math.min(existing.min[0], x);
            existing.min[1] = Math.min(existing.min[1], y);
            existing.min[2] = Math.min(existing.min[2], z);
            existing.max[0] = Math.max(existing.max[0], x);
            existing.max[1] = Math.max(existing.max[1], y);
            existing.max[2] = Math.max(existing.max[2], z);
          }
        }
        break;
      }
      case 'triangle': {
        scan.triangles += 1;
        const paint = attr(tag, 'paint_color') ?? attr(tag, 'slic3rpe:mmu_segmentation');
        if (paint) {
          scan.hasPaint = true;
          for (const state of paintStatesFromString(paint)) scan.paintStates.add(state);
        }
        if (attr(tag, 'paint_supports') ?? attr(tag, 'slic3rpe:custom_supports')) {
          scan.hasCustomSupports = true;
        }
        if (attr(tag, 'paint_seam') ?? attr(tag, 'slic3rpe:custom_seam')) {
          scan.hasCustomSeams = true;
        }
        break;
      }
      case 'item': {
        scan.items.push({
          objectId: attr(tag, 'objectid') ?? '',
          transform: attr(tag, 'transform'),
        });
        break;
      }
      case 'object': {
        currentObject = {
          id: attr(tag, 'id') ?? '',
          hasMesh: false,
          components: [],
        };
        currentObjectId = currentObject.id || undefined;
        scan.objects.push(currentObject);
        objectDepth = depth;
        break;
      }
      case 'mesh': {
        if (currentObject) currentObject.hasMesh = true;
        break;
      }
      case 'component': {
        if (currentObject) {
          currentObject.components.push({
            objectId: attr(tag, 'objectid'),
            path: attr(tag, 'p:path') ?? attr(tag, 'path'),
            transform: attr(tag, 'transform'),
          });
        }
        break;
      }
      case 'm:color':
      case 'color': {
        const value = attr(tag, 'color') ?? attr(tag, 'value');
        if (value) scan.colors.push(value);
        break;
      }
      default:
        break;
    }
  });

  parser.on('text', (text) => {
    if (metadataName) metadataText += text;
  });

  parser.on('closetag', (tag) => {
    if (tag.name === 'metadata' && metadataName) {
      scan.metadata[metadataName] = metadataText.trim();
      metadataName = undefined;
      metadataText = '';
    }
    if (tag.name === 'object' && currentObject && depth === objectDepth) {
      currentObject = undefined;
      currentObjectId = undefined;
    }
    depth -= 1;
  });

  parser.on('error', (error) => {
    throw error;
  });

  parser.write(xml).close();
  return scan;
}

export interface RewriteOptions {
  paintMap?: Map<number, number>;
  translate?: { x: number; y: number };
  scale?: number;
  unitScale?: number;
  setMetadata?: Record<string, string>;
  stripMetadata?: Set<string>;
  isRootModel?: boolean;
  setUnit?: string;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function transformParts(value: string): number[] | undefined {
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== 12 || parts.some((part) => !Number.isFinite(part))) return undefined;
  return parts;
}

function formatTransform(parts: number[]): string {
  return parts
    .map((part) => {
      const rounded = Math.abs(part) < 1e-9 ? 0 : Math.round(part * 1e6) / 1e6;
      return String(rounded);
    })
    .join(' ');
}

function applyTransform(
  value: string | undefined,
  options: RewriteOptions,
  requireTransform: boolean,
  addTranslate: boolean,
): string | undefined {
  const scale = (options.scale ?? 1) * (options.unitScale ?? 1);
  const tx = addTranslate ? (options.translate?.x ?? 0) : 0;
  const ty = addTranslate ? (options.translate?.y ?? 0) : 0;
  if (!requireTransform && !value && scale === 1 && tx === 0 && ty === 0) return value;

  const parts = value ? (transformParts(value) ?? undefined) : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  if (!parts) return value;
  // Vertices carry the scale. Transform rotations stay unchanged; translations scale with the model.
  const scaled = parts.slice();
  scaled[9] = (scaled[9] ?? 0) * scale + tx;
  scaled[10] = (scaled[10] ?? 0) * scale + ty;
  scaled[11] = (scaled[11] ?? 0) * scale;
  return formatTransform(scaled);
}

function remapPaint(value: string, paintMap: Map<number, number> | undefined): string {
  if (!paintMap || paintMap.size === 0) return value;
  return remapPaintString(value, paintMap);
}

export function rewriteModelXml(xml: string, options: RewriteOptions = {}): string {
  const parser = new SaxesParser({ xmlns: true });
  const output: string[] = ['<?xml version="1.0" encoding="UTF-8"?>\n'];
  let metadataName: string | undefined;
  let metadataMode: 'skip' | 'override' | undefined;
  let metadataOverride = '';
  let skippedDepth = 0;

  const writeTag = (tag: SaxesTag, overrides?: Map<string, string | undefined>) => {
    const attributes: string[] = [];
    for (const [name, attribute] of Object.entries(tag.attributes)) {
      const original = typeof attribute === 'string' ? attribute : attribute.value;
      const value = overrides?.has(name) ? overrides.get(name) : original;
      if (value === undefined) continue;
      attributes.push(`${name}="${escapeAttribute(value)}"`);
    }
    output.push(`<${tag.name}${attributes.length ? ' ' + attributes.join(' ') : ''}>`);
  };

  parser.on('opentag', (tag) => {
    if (skippedDepth > 0) {
      skippedDepth += 1;
      return;
    }

    if (tag.name === 'metadata') {
      metadataName = attr(tag, 'name');
      if (metadataName && options.stripMetadata?.has(metadataName)) {
        skippedDepth = 1;
        return;
      }
      if (metadataName && options.setMetadata?.[metadataName] !== undefined) {
        metadataMode = 'override';
        metadataOverride = options.setMetadata[metadataName] ?? '';
        output.push(`<metadata name="${escapeAttribute(metadataName)}">`);
        return;
      }
    }

    if (tag.name === 'triangle') {
      const overrides = new Map<string, string | undefined>();
      let paint = attr(tag, 'paint_color');
      const supports = attr(tag, 'paint_supports');
      const seam = attr(tag, 'paint_seam');

      if (!paint) {
        const legacy = attr(tag, 'slic3rpe:mmu_segmentation');
        if (legacy) {
          paint = remapPaint(legacy, options.paintMap);
          overrides.set('slic3rpe:mmu_segmentation', undefined);
          overrides.set('paint_color', paint);
        }
      } else {
        overrides.set('paint_color', remapPaint(paint, options.paintMap));
      }

      const legacySupports = attr(tag, 'slic3rpe:custom_supports');
      if (!supports && legacySupports) {
        overrides.set('slic3rpe:custom_supports', undefined);
        overrides.set('paint_supports', legacySupports);
      }
      const legacySeam = attr(tag, 'slic3rpe:custom_seam');
      if (!seam && legacySeam) {
        overrides.set('slic3rpe:custom_seam', undefined);
        overrides.set('paint_seam', legacySeam);
      }

      writeTag(tag, overrides);
      return;
    }

    if (tag.name === 'vertex') {
      const scale = (options.scale ?? 1) * (options.unitScale ?? 1);
      if (scale !== 1) {
        const overrides = new Map<string, string | undefined>();
        for (const axis of ['x', 'y', 'z'] as const) {
          const value = attr(tag, axis);
          if (value !== undefined) overrides.set(axis, String(Number(value) * scale));
        }
        writeTag(tag, overrides);
        return;
      }
    }

    if (tag.name === 'model' && options.setUnit) {
      writeTag(tag, new Map([['unit', options.setUnit]]));
      return;
    }

    if ((tag.name === 'item' && options.isRootModel) || tag.name === 'component') {
      const transform = applyTransform(
        attr(tag, 'transform'),
        options,
        tag.name === 'item',
        tag.name === 'item',
      );
      if (transform !== attr(tag, 'transform')) {
        writeTag(tag, new Map([['transform', transform]]));
        return;
      }
    }

    writeTag(tag);
  });

  parser.on('text', (text) => {
    if (skippedDepth > 0) return;
    if (metadataMode === 'override') return;
    output.push(escapeText(text));
  });

  parser.on('closetag', (tag) => {
    if (skippedDepth > 0) {
      skippedDepth -= 1;
      return;
    }
    if (tag.name === 'metadata') {
      if (metadataMode === 'override') {
        output.push(escapeText(metadataOverride), '</metadata>');
        metadataMode = undefined;
        metadataName = undefined;
        metadataOverride = '';
        return;
      }
      metadataName = undefined;
    }
    output.push(`</${tag.name}>`);
  });

  parser.on('comment', (comment) => {
    if (skippedDepth === 0) output.push(`<!--${comment}-->`);
  });

  parser.on('cdata', (data) => {
    if (skippedDepth === 0) output.push(`<![CDATA[${data}]]>`);
  });

  parser.on('error', (error) => {
    throw error;
  });

  parser.write(xml).close();
  return output.join('');
}

export function formatNumber(value: number): string {
  const rounded = Math.abs(value) < 1e-9 ? 0 : Math.round(value * 1e6) / 1e6;
  return String(rounded);
}

// Imported at the bottom to keep the XML walker readable; the paint codec is independent.
import { paintStatesFromString, remapPaintString } from './paint.js';
