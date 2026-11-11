import { describe, expect, it } from 'vitest';
import { getCatalog, loadTargetProfile } from '../src/index.js';

describe('FlashForge profile catalog', () => {
  it('exposes the five supported printers', () => {
    const catalog = getCatalog();
    expect(catalog.printers.map((printer) => printer.id).sort()).toEqual([
      'ad5m',
      'ad5m-pro',
      'ad5x',
      'creator-5',
      'creator-5-pro',
    ]);
  });

  it('loads a target profile with a full template and presets', () => {
    const profile = loadTargetProfile('ad5x', '0.4');
    expect(profile.printer.maxColors).toBe(4);
    expect(profile.machine.printer_model).toBe('Flashforge AD5X');
    expect(profile.process.config.layer_height).toBeDefined();
    expect(profile.filaments.length).toBeGreaterThan(5);
    expect(profile.template.config.layer_height).toBe('0.2');
    expect(Object.keys(profile.template.config).length).toBeGreaterThan(400);
  });

  it('keeps Creator 5 as a four-tool profile', () => {
    const profile = loadTargetProfile('creator-5', '0.4');
    expect(profile.nozzle.build.extruders).toBe(4);
    expect(profile.printer.maxColors).toBe(4);
    expect(profile.machine.nozzle_diameter).toHaveLength(4);
  });
});
