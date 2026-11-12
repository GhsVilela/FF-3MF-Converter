import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { readZip } from '../src/zip.js';
import { convert3mf } from '../src/convert.js';
import { ConversionError } from '../src/errors.js';
import { createFixtureAsync } from './fixtures.js';
import { loadTargetProfile } from '@ff3mf/profiles';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function paintValues(xml: string): string[] {
  return [...xml.matchAll(/paint_color="([^"]+)"/g)].map((match) => match[1] ?? '');
}

describe('3MF conversion', () => {
  it('converts a four-colour project for AD5X', async () => {
    const fixture = await createFixtureAsync({
      paintStates: ['4', '8', '0C', '1C'],
    });
    cleanups.push(fixture.cleanup);
    const output = path.join(fixture.directory, 'out.3mf');
    const profile = loadTargetProfile('ad5x', '0.4', '0.16mm Standard @FF AD5X');
    const result = await convert3mf(fixture.file, output, profile, {
      printerId: 'ad5x',
      nozzle: '0.4',
      preserveTemperatures: true,
      layout: 'center',
    });

    expect(result.report.target.printerName).toBe('FlashForge AD5X');
    expect(result.report.target.processName).toBe('0.16mm Standard @FF AD5X');
    expect(result.report.filaments).toHaveLength(4);

    const contents = await readZip(output);
    const config = JSON.parse(
      contents.files.get('Metadata/project_settings.config')!.toString('utf8'),
    );
    expect(config.printer_model).toBe('Flashforge AD5X');
    expect(config.filament_colour).toHaveLength(4);
    expect(config.filament_settings_id).toHaveLength(4);
    expect(config.nozzle_diameter).toEqual(['0.4']);
    expect(config.different_settings_to_system).toHaveLength(6);
    expect(config.print_compatible_printers).toContain('Flashforge AD5X 0.4 nozzle');
    expect(config.layer_height).toBe('0.16');
    expect(config.wall_loops).toBe('4');
    expect(config.enable_support).toBe('1');

    const part = contents.files.get('3D/Objects/part.model')!.toString('utf8');
    expect(new Set(paintValues(part))).toEqual(new Set(['4', '8', '0C', '1C']));
    expect(contents.files.get('Metadata/model_settings.config')).toBeDefined();
  });

  it('merges four colours into one slot on AD5M', async () => {
    const fixture = await createFixtureAsync({
      paintStates: ['4', '8', '0C', '1C'],
    });
    cleanups.push(fixture.cleanup);
    const output = path.join(fixture.directory, 'out.3mf');
    const profile = loadTargetProfile('ad5m', '0.4');
    await convert3mf(fixture.file, output, profile, {
      printerId: 'ad5m',
      nozzle: '0.4',
      preserveTemperatures: true,
      layout: 'center',
    });

    const contents = await readZip(output);
    const config = JSON.parse(
      contents.files.get('Metadata/project_settings.config')!.toString('utf8'),
    );
    expect(config.printer_model).toBe('Flashforge Adventurer 5M');
    expect(config.filament_colour).toHaveLength(1);
    expect(config.filament_settings_id).toHaveLength(1);
    expect(config.different_settings_to_system).toHaveLength(3);
    expect(config.enable_prime_tower).toBe('0');

    const part = contents.files.get('3D/Objects/part.model')!.toString('utf8');
    expect(new Set(paintValues(part))).toEqual(new Set(['4']));
  });

  it('uses target defaults for a generic geometry-only 3MF', async () => {
    const fixture = await createFixtureAsync({ withSettings: false });
    cleanups.push(fixture.cleanup);
    const output = path.join(fixture.directory, 'out.3mf');
    const profile = loadTargetProfile('ad5m', '0.4');
    const result = await convert3mf(fixture.file, output, profile, {
      printerId: 'ad5m',
      nozzle: '0.4',
      layout: 'center',
    });

    expect(result.report.source.hasProjectSettings).toBe(false);
    expect(result.report.filaments).toHaveLength(1);
    const contents = await readZip(output);
    const config = JSON.parse(
      contents.files.get('Metadata/project_settings.config')!.toString('utf8'),
    );
    expect(config.printer_model).toBe('Flashforge Adventurer 5M');
    expect(config.filament_colour).toHaveLength(1);
  });

  it('converts for the four-toolhead Creator 5', async () => {
    const fixture = await createFixtureAsync({
      paintStates: ['4', '8', '0C', '1C'],
    });
    cleanups.push(fixture.cleanup);
    const output = path.join(fixture.directory, 'out.3mf');
    const profile = loadTargetProfile('creator-5', '0.4');
    await convert3mf(fixture.file, output, profile, {
      printerId: 'creator-5',
      nozzle: '0.4',
      preserveTemperatures: true,
      layout: 'center',
    });
    const contents = await readZip(output);
    const config = JSON.parse(
      contents.files.get('Metadata/project_settings.config')!.toString('utf8'),
    );
    expect(config.printer_model).toBe('Flashforge Creator 5');
    expect(config.nozzle_diameter).toHaveLength(4);
    expect(config.filament_colour).toHaveLength(4);
    expect(config.different_settings_to_system).toHaveLength(6);
    expect(config.filament_map_mode).toBe('Auto For Flush');
  });

  it('generates model settings for a bare geometry 3MF', async () => {
    const fixture = await createFixtureAsync({
      withSettings: false,
      withModelSettings: false,
    });
    cleanups.push(fixture.cleanup);
    const output = path.join(fixture.directory, 'out.3mf');
    const profile = loadTargetProfile('ad5m', '0.4');
    await convert3mf(fixture.file, output, profile, {
      printerId: 'ad5m',
      nozzle: '0.4',
      layout: 'center',
    });
    const contents = await readZip(output);
    const modelSettings = contents.files.get('Metadata/model_settings.config')!.toString('utf8');
    expect(modelSettings).toContain('plater_id');
    expect(modelSettings).toContain('value="1"');
  });

  it('rejects sliced print files', async () => {
    const fixture = await createFixtureAsync({ sliced: true });
    cleanups.push(fixture.cleanup);
    const profile = loadTargetProfile('ad5m', '0.4');
    await expect(
      convert3mf(fixture.file, path.join(fixture.directory, 'out.3mf'), profile, {
        printerId: 'ad5m',
        nozzle: '0.4',
      }),
    ).rejects.toMatchObject<Partial<ConversionError>>({ code: 'SLICED_FILE' });
  });
});
