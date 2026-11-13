import { ConversionError } from './errors.js';

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

export function scanModelXml(source: string): XmlScan {
  const xml = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const scan = emptyScan();
  let currentObject: XmlScan['objects'][number] | undefined;
  let currentObjectId: string | undefined;
  let metadataName: string | undefined;
  let metadataText = '';
  let metadataDepth = 0;
  let depth = 0;
  let objectDepth = 0;
  let index = 0;
  const openTags: string[] = [];

  while (index < xml.length) {
    const lt = xml.indexOf('<', index);
    if (lt === -1) break;
    if (lt > index && metadataName) metadataText += xml.slice(index, lt);

    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end === -1) invalidXml('unclosed comment');
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end === -1) invalidXml('unclosed CDATA section');
      if (metadataName) metadataText += xml.slice(lt + 9, end);
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end === -1) invalidXml('unclosed processing instruction');
      index = end + 2;
      continue;
    }
    if (xml.startsWith('<!', lt)) {
      if (/^<!doctype/i.test(xml.slice(lt, lt + 9))) {
        invalidXml('DTD declarations are not allowed');
      }
      const end = xml.indexOf('>', lt + 2);
      if (end === -1) invalidXml('unclosed declaration');
      index = end + 1;
      continue;
    }

    const tag = readRawTag(xml, lt, 'scan');
    if (tag.closing) {
      const expected = openTags.pop();
      if (expected !== tag.name) {
        invalidXml(`unexpected closing tag ${tag.name}`);
      }
      if (tag.name === 'metadata' && metadataName && depth === metadataDepth) {
        scan.metadata[metadataName] = metadataText.trim();
        metadataName = undefined;
        metadataText = '';
      }
      if (tag.name === 'object' && currentObject && depth === objectDepth) {
        currentObject = undefined;
        currentObjectId = undefined;
      }
      depth -= 1;
      index = tag.end;
      continue;
    }

    depth += 1;
    if (!tag.selfClosing) openTags.push(tag.name);
    switch (tag.name) {
      case 'model':
        scan.unit = attributeValue(tag, 'unit') ?? 'millimeter';
        break;
      case 'metadata':
        metadataName = attributeValue(tag, 'name');
        metadataText = attributeValue(tag, 'value') ?? '';
        metadataDepth = depth;
        break;
      case 'vertex': {
        scan.vertices += 1;
        const x = Number(attributeValue(tag, 'x'));
        const y = Number(attributeValue(tag, 'y'));
        const z = Number(attributeValue(tag, 'z'));
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
        const paint =
          attributeValue(tag, 'paint_color') ?? attributeValue(tag, 'slic3rpe:mmu_segmentation');
        if (paint) {
          scan.hasPaint = true;
          for (const state of paintStatesFromString(paint)) scan.paintStates.add(state);
        }
        if (
          attributeValue(tag, 'paint_supports') ??
          attributeValue(tag, 'slic3rpe:custom_supports')
        ) {
          scan.hasCustomSupports = true;
        }
        if (attributeValue(tag, 'paint_seam') ?? attributeValue(tag, 'slic3rpe:custom_seam')) {
          scan.hasCustomSeams = true;
        }
        break;
      }
      case 'item':
        scan.items.push({
          objectId: attributeValue(tag, 'objectid') ?? '',
          transform: attributeValue(tag, 'transform'),
        });
        break;
      case 'object':
        currentObject = {
          id: attributeValue(tag, 'id') ?? '',
          hasMesh: false,
          components: [],
        };
        currentObjectId = currentObject.id || undefined;
        scan.objects.push(currentObject);
        objectDepth = depth;
        break;
      case 'mesh':
        if (currentObject) currentObject.hasMesh = true;
        break;
      case 'component':
        if (currentObject) {
          currentObject.components.push({
            objectId: attributeValue(tag, 'objectid'),
            path: attributeValue(tag, 'p:path') ?? attributeValue(tag, 'path'),
            transform: attributeValue(tag, 'transform'),
          });
        }
        break;
      case 'm:color':
      case 'color': {
        const value = attributeValue(tag, 'color') ?? attributeValue(tag, 'value');
        if (value) scan.colors.push(value);
        break;
      }
      default:
        break;
    }

    if (tag.selfClosing) {
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
    }
    index = tag.end;
  }

  if (openTags.length > 0) invalidXml('unclosed elements');
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
  if (!/[&"<>]/.test(value)) return value;
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeText(value: string): string {
  if (!/[&<>]/.test(value)) return value;
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

interface RawAttribute {
  name: string;
  value: string;
  raw: string;
  quote: '"' | "'";
}

interface RawTag {
  name: string;
  start: number;
  end: number;
  closing: boolean;
  selfClosing: boolean;
  attributes: RawAttribute[];
}

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeXmlEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#')) {
      const codePoint =
        body[1] === 'x' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }
    return XML_ENTITIES[body] ?? match;
  });
}

function isXmlWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

function skipWhitespace(xml: string, index: number): number {
  while (index < xml.length && isXmlWhitespace(xml[index])) index += 1;
  return index;
}

function isWhitespaceOnly(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!isXmlWhitespace(value[index])) return false;
  }
  return true;
}

function invalidXml(reason: string): never {
  throw new ConversionError('INVALID_FILE', `The 3MF model XML is invalid: ${reason}`);
}

type AttributeMode = 'all' | 'none' | 'scan' | 'rewrite';

const SCAN_ATTRIBUTE_TAGS = new Set([
  'model',
  'metadata',
  'vertex',
  'triangle',
  'item',
  'object',
  'component',
  'm:color',
  'color',
]);

// In the common case the scale is 1, so vertex attributes do not need to be
// parsed during rewriting at all.
const REWRITE_ATTRIBUTE_TAGS = new Set(['metadata', 'model', 'triangle', 'item', 'component']);

function readRawTag(xml: string, start: number, mode: AttributeMode = 'all'): RawTag {
  if (xml[start] !== '<') invalidXml('expected a tag');
  let index = start + 1;
  if (xml[index] === '/') {
    index += 1;
    const nameStart = index;
    while (index < xml.length && xml[index] !== '>') index += 1;
    if (xml[index] !== '>') invalidXml('unclosed closing tag');
    return {
      name: xml.slice(nameStart, index).trim(),
      start,
      end: index + 1,
      closing: true,
      selfClosing: false,
      attributes: [],
    };
  }

  const nameStart = index;
  while (
    index < xml.length &&
    !isXmlWhitespace(xml[index]) &&
    xml[index] !== '/' &&
    xml[index] !== '>'
  ) {
    index += 1;
  }
  const name = xml.slice(nameStart, index);
  if (!name) invalidXml('empty tag name');

  const keepAttributes =
    mode === 'all' ||
    (mode === 'scan' && SCAN_ATTRIBUTE_TAGS.has(name)) ||
    (mode === 'rewrite' && REWRITE_ATTRIBUTE_TAGS.has(name));
  if (!keepAttributes) {
    let selfClosing = false;
    let quote: string | undefined;
    while (index < xml.length) {
      const char = xml[index];
      if (quote) {
        if (char === quote) quote = undefined;
        index += 1;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        index += 1;
        continue;
      }
      if (char === '>') {
        return {
          name,
          start,
          end: index + 1,
          closing: false,
          selfClosing,
          attributes: [],
        };
      }
      if (char === '/') selfClosing = true;
      index += 1;
    }
    invalidXml(`unclosed tag ${name}`);
  }

  const attributes: RawAttribute[] = [];
  let selfClosing = false;
  while (index < xml.length) {
    index = skipWhitespace(xml, index);
    const char = xml[index];
    if (char === '>') {
      index += 1;
      break;
    }
    if (char === '/') {
      selfClosing = true;
      index += 1;
      continue;
    }
    if (char === undefined) invalidXml(`unclosed tag ${name}`);

    const attributeStart = index;
    while (
      index < xml.length &&
      !isXmlWhitespace(xml[index]) &&
      xml[index] !== '=' &&
      xml[index] !== '>' &&
      xml[index] !== '/'
    ) {
      index += 1;
    }
    const attributeName = xml.slice(attributeStart, index);
    if (!attributeName) invalidXml(`malformed attribute in ${name}`);
    index = skipWhitespace(xml, index);
    if (xml[index] !== '=') invalidXml(`attribute ${attributeName} has no value`);
    index += 1;
    index = skipWhitespace(xml, index);
    const quote = xml[index];
    if (quote !== '"' && quote !== "'") invalidXml(`attribute ${attributeName} is not quoted`);
    index += 1;
    const valueStart = index;
    while (index < xml.length && xml[index] !== quote) index += 1;
    if (index >= xml.length) invalidXml(`unclosed attribute ${attributeName}`);
    const raw = xml.slice(valueStart, index);
    index += 1;
    attributes.push({
      name: attributeName,
      value: decodeXmlEntities(raw),
      raw,
      quote,
    });
  }

  return { name, start, end: index, closing: false, selfClosing, attributes };
}

function attributeValue(tag: RawTag, name: string): string | undefined {
  for (const attribute of tag.attributes) {
    if (attribute.name === name) return attribute.value;
  }
  return undefined;
}

function serializeTag(tag: RawTag, changes?: Map<string, string | undefined>): string {
  let serialized = `<${tag.name}`;
  for (const attribute of tag.attributes) {
    const changed = changes?.has(attribute.name) === true;
    const value = changed ? changes?.get(attribute.name) : attribute.value;
    if (value === undefined) continue;
    const raw = changed
      ? escapeAttribute(value)
      : attribute.quote === '"'
        ? attribute.raw
        : escapeAttribute(attribute.value);
    serialized += ` ${attribute.name}="${raw}"`;
  }
  if (changes) {
    for (const [name, value] of changes) {
      if (value === undefined || tag.attributes.some((attribute) => attribute.name === name)) {
        continue;
      }
      serialized += ` ${name}="${escapeAttribute(value)}"`;
    }
  }
  return `${serialized}${tag.selfClosing ? '/>' : '>'}`;
}

function rewriteTriangleTag(tag: RawTag, paintMap?: Map<number, number>): string | undefined {
  let paint: RawAttribute | undefined;
  let legacyPaint: RawAttribute | undefined;
  let supports: RawAttribute | undefined;
  let legacySupports: RawAttribute | undefined;
  let seam: RawAttribute | undefined;
  let legacySeam: RawAttribute | undefined;
  for (const attribute of tag.attributes) {
    switch (attribute.name) {
      case 'paint_color':
        paint = attribute;
        break;
      case 'slic3rpe:mmu_segmentation':
        legacyPaint = attribute;
        break;
      case 'paint_supports':
        supports = attribute;
        break;
      case 'slic3rpe:custom_supports':
        legacySupports = attribute;
        break;
      case 'paint_seam':
        seam = attribute;
        break;
      case 'slic3rpe:custom_seam':
        legacySeam = attribute;
        break;
      default:
        break;
    }
  }
  // A modern attribute wins over the legacy spelling; only migrate the legacy
  // attribute when the modern one is absent.
  if (paint) legacyPaint = undefined;
  if (supports) legacySupports = undefined;
  if (seam) legacySeam = undefined;

  if (!paint && !legacyPaint && !supports && !legacySupports && !seam && !legacySeam) {
    return undefined;
  }

  const remappedPaint = paint ? remapPaint(paint.value, paintMap) : undefined;
  const remappedLegacyPaint = legacyPaint ? remapPaint(legacyPaint.value, paintMap) : undefined;
  const paintChanged = remappedPaint !== undefined && remappedPaint !== paint?.value;
  if (!paintChanged && !legacyPaint && !legacySupports && !legacySeam) {
    return undefined;
  }

  let serialized = '<triangle';
  for (const attribute of tag.attributes) {
    if (attribute === legacyPaint || attribute === legacySupports || attribute === legacySeam) {
      continue;
    }
    const raw =
      attribute === paint && paintChanged && remappedPaint !== undefined
        ? escapeAttribute(remappedPaint)
        : attribute.quote === '"'
          ? attribute.raw
          : escapeAttribute(attribute.value);
    serialized += ` ${attribute.name}="${raw}"`;
  }
  if (legacyPaint && remappedLegacyPaint !== undefined) {
    serialized += ` paint_color="${escapeAttribute(remappedLegacyPaint)}"`;
  }
  if (legacySupports) {
    serialized += ` paint_supports="${escapeAttribute(legacySupports.value)}"`;
  }
  if (legacySeam) {
    serialized += ` paint_seam="${escapeAttribute(legacySeam.value)}"`;
  }
  return `${serialized}${tag.selfClosing ? '/>' : '>'}`;
}

function rewriteVertexTag(tag: RawTag, scale: number): string | undefined {
  let changed = false;
  let serialized = '<vertex';
  for (const attribute of tag.attributes) {
    let raw = attribute.quote === '"' ? attribute.raw : escapeAttribute(attribute.value);
    if (attribute.name === 'x' || attribute.name === 'y' || attribute.name === 'z') {
      const numeric = Number(attribute.value);
      if (Number.isFinite(numeric)) {
        const next = String(numeric * scale);
        if (next !== attribute.value) {
          raw = escapeAttribute(next);
          changed = true;
        }
      }
    }
    serialized += ` ${attribute.name}="${raw}"`;
  }
  return changed ? `${serialized}${tag.selfClosing ? '/>' : '>'}` : undefined;
}

function findElementEnd(xml: string, startTag: RawTag): number {
  if (startTag.selfClosing) return startTag.end;
  let depth = 1;
  let index = startTag.end;
  while (index < xml.length) {
    const lt = xml.indexOf('<', index);
    if (lt === -1) invalidXml(`unclosed element ${startTag.name}`);
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end === -1) invalidXml('unclosed comment');
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end === -1) invalidXml('unclosed CDATA section');
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end === -1) invalidXml('unclosed processing instruction');
      index = end + 2;
      continue;
    }
    if (xml.startsWith('<!', lt)) {
      const end = xml.indexOf('>', lt + 2);
      if (end === -1) invalidXml('unclosed declaration');
      index = end + 1;
      continue;
    }
    const tag = readRawTag(xml, lt, 'none');
    if (tag.closing) depth -= 1;
    else if (!tag.selfClosing) depth += 1;
    index = tag.end;
    if (depth === 0) return index;
  }
  invalidXml(`unclosed element ${startTag.name}`);
}

export function rewriteModelXml(source: string, options: RewriteOptions = {}): string {
  const withoutBom = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const declaration = /^\s*<\?xml\b[^?]*\?>/.exec(withoutBom);
  const xml = declaration ? withoutBom.slice(declaration[0].length) : withoutBom;
  const output: string[] = ['<?xml version="1.0" encoding="UTF-8"?>\n'];
  const vertexScale = (options.scale ?? 1) * (options.unitScale ?? 1);
  const appendText = (text: string) => {
    if (!text || isWhitespaceOnly(text)) return;
    output.push(text);
  };

  let index = 0;
  while (index < xml.length) {
    const lt = xml.indexOf('<', index);
    if (lt === -1) {
      appendText(xml.slice(index));
      break;
    }
    if (lt > index) appendText(xml.slice(index, lt));

    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end === -1) invalidXml('unclosed comment');
      output.push(xml.slice(lt, end + 3));
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end === -1) invalidXml('unclosed CDATA section');
      output.push(xml.slice(lt, end + 3));
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end === -1) invalidXml('unclosed processing instruction');
      output.push(xml.slice(lt, end + 2));
      index = end + 2;
      continue;
    }
    if (xml.startsWith('<!', lt)) {
      if (/^<!doctype/i.test(xml.slice(lt, lt + 9))) {
        invalidXml('DTD declarations are not allowed');
      }
      const end = xml.indexOf('>', lt + 2);
      if (end === -1) invalidXml('unclosed declaration');
      output.push(xml.slice(lt, end + 1));
      index = end + 1;
      continue;
    }

    const tag = readRawTag(xml, lt, vertexScale === 1 ? 'rewrite' : 'all');
    if (!tag.closing) {
      if (tag.name === 'metadata') {
        const name = attributeValue(tag, 'name');
        if (name && options.stripMetadata?.has(name)) {
          index = findElementEnd(xml, tag);
          continue;
        }
        if (name && options.setMetadata?.[name] !== undefined) {
          output.push(
            `<metadata name="${escapeAttribute(name)}">`,
            escapeText(options.setMetadata[name] ?? ''),
            '</metadata>',
          );
          index = findElementEnd(xml, tag);
          continue;
        }
      }

      if (tag.name === 'triangle') {
        output.push(rewriteTriangleTag(tag, options.paintMap) ?? xml.slice(tag.start, tag.end));
        index = tag.end;
        continue;
      }
      if (tag.name === 'vertex' && vertexScale !== 1) {
        output.push(rewriteVertexTag(tag, vertexScale) ?? xml.slice(tag.start, tag.end));
        index = tag.end;
        continue;
      }
      if (tag.name === 'model' && options.setUnit) {
        const current = attributeValue(tag, 'unit');
        if (current !== options.setUnit) {
          output.push(serializeTag(tag, new Map([['unit', options.setUnit]])));
          index = tag.end;
          continue;
        }
      }
      if ((tag.name === 'item' && options.isRootModel) || tag.name === 'component') {
        const current = attributeValue(tag, 'transform');
        const transform = applyTransform(
          current,
          options,
          tag.name === 'item',
          tag.name === 'item',
        );
        if (transform !== current) {
          output.push(serializeTag(tag, new Map([['transform', transform]])));
          index = tag.end;
          continue;
        }
      }
    }

    output.push(xml.slice(tag.start, tag.end));
    index = tag.end;
  }

  return output.join('');
}

export function formatNumber(value: number): string {
  const rounded = Math.abs(value) < 1e-9 ? 0 : Math.round(value * 1e6) / 1e6;
  return String(rounded);
}

// Imported at the bottom to keep the XML walker readable; the paint codec is independent.
import { paintStatesFromString, remapPaintString } from './paint.js';
