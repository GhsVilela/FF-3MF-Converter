import { describe, expect, it } from 'vitest';
import {
  encodePaintState,
  paintStatesFromString,
  parsePaintTree,
  remapPaintString,
} from '../src/paint.js';

describe('paint codec', () => {
  it('reads the documented single-state values', () => {
    expect(paintStatesFromString('4')).toEqual([1]);
    expect(paintStatesFromString('8')).toEqual([2]);
    expect(paintStatesFromString('0C')).toEqual([3]);
    expect(paintStatesFromString('1C')).toEqual([4]);
    expect(paintStatesFromString('2C')).toEqual([5]);
  });

  it('round-trips every state from 1 to 16', () => {
    for (let state = 1; state <= 16; state += 1) {
      const encoded = encodePaintState(state);
      expect(paintStatesFromString(encoded)).toEqual([state]);
    }
  });

  it('round-trips extended states', () => {
    for (const state of [17, 18, 24, 32]) {
      expect(paintStatesFromString(encodePaintState(state))).toEqual([state]);
    }
  });

  it('remaps a simple state without changing the encoding shape', () => {
    expect(remapPaintString('4', new Map([[1, 3]]))).toBe('0C');
    expect(remapPaintString('0C', new Map([[3, 1]]))).toBe('4');
    expect(remapPaintString('1C', new Map([[4, 2]]))).toBe('8');
  });

  it('remaps all leaves in a split tree', () => {
    const source = '841';
    const tree = parsePaintTree(source);
    expect(tree).toBeDefined();
    const remapped = remapPaintString(
      source,
      new Map([
        [3, 1],
        [2, 4],
      ]),
    );
    expect(remapped).not.toBe(source);
    expect(new Set(paintStatesFromString(remapped))).toEqual(new Set([1, 4]));
  });

  it('returns malformed data unchanged', () => {
    expect(remapPaintString('not-hex', new Map([[1, 2]]))).toBe('not-hex');
    expect(paintStatesFromString('')).toEqual([]);
  });
});
