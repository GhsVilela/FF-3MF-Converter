interface LeafNode {
  type: 'leaf';
  state: number;
}

interface SplitNode {
  type: 'split';
  specialSide: number;
  children: PaintNode[];
}

type PaintNode = LeafNode | SplitNode;

function nibblesFromString(value: string): number[] | undefined {
  const hex = value.trim();
  if (!hex || !/^[0-9a-fA-F]+$/.test(hex)) return undefined;
  // Slicer paint data is serialized in reverse nibble order.
  return hex
    .split('')
    .reverse()
    .map((character) => Number.parseInt(character, 16));
}

function parseNode(nibbles: number[], cursor: { index: number }): PaintNode {
  if (cursor.index >= nibbles.length) throw new Error('Unexpected end of paint data');
  const code = nibbles[cursor.index++] ?? 0;
  const splitSides = code & 3;
  if (splitSides === 0) {
    let state = code >> 2;
    if (state === 3) {
      const extension = nibbles[cursor.index++];
      if (extension === undefined) throw new Error('Missing paint state extension');
      if (extension <= 13) {
        state = 3 + extension;
      } else if (extension === 14) {
        const low = nibbles[cursor.index++];
        const high = nibbles[cursor.index++];
        if (low === undefined || high === undefined) {
          throw new Error('Missing extended paint state');
        }
        state = 17 + low + high * 16;
      }
    }
    return { type: 'leaf', state };
  }

  const specialSide = code >> 2;
  const children: PaintNode[] = [];
  for (let index = 0; index < splitSides + 1; index += 1) {
    children.push(parseNode(nibbles, cursor));
  }
  return { type: 'split', specialSide, children };
}

function encodeNode(node: PaintNode): number[] {
  if (node.type === 'leaf') {
    const state = Math.max(0, Math.trunc(node.state));
    if (state <= 2) return [(state << 2) & 0x0f];
    if (state <= 16) return [12, state - 3];
    const value = state - 17;
    return [12, 14, value & 0x0f, (value >> 4) & 0x0f];
  }

  const code = ((node.specialSide & 3) << 2) | (node.children.length - 1);
  const nibbles = [code];
  for (const child of node.children) nibbles.push(...encodeNode(child));
  return nibbles;
}

function encodeString(nibbles: number[]): string {
  return nibbles
    .slice()
    .reverse()
    .map((nibble) => nibble.toString(16).toUpperCase())
    .join('');
}

export function parsePaintTree(value: string): PaintNode | undefined {
  const nibbles = nibblesFromString(value);
  if (!nibbles) return undefined;
  try {
    const cursor = { index: 0 };
    const root = parseNode(nibbles, cursor);
    return cursor.index === nibbles.length ? root : undefined;
  } catch {
    return undefined;
  }
}

export function paintStatesFromString(value: string): number[] {
  const root = parsePaintTree(value);
  if (!root) return [];
  const states: number[] = [];
  const walk = (node: PaintNode) => {
    if (node.type === 'leaf') {
      if (node.state > 0) states.push(node.state);
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(root);
  return states;
}

export function remapPaintString(value: string, mapping: Map<number, number>): string {
  const root = parsePaintTree(value);
  if (!root) return value;
  const remap = (node: PaintNode): PaintNode => {
    if (node.type === 'leaf') {
      const target = mapping.get(node.state);
      return { type: 'leaf', state: target ?? node.state };
    }
    return { type: 'split', specialSide: node.specialSide, children: node.children.map(remap) };
  };
  return encodeString(encodeNode(remap(root)));
}

export function encodePaintState(state: number): string {
  return encodeString(encodeNode({ type: 'leaf', state }));
}
