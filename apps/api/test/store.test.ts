import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceAnalysis } from '@ff3mf/shared';

function analysis(fileName: string): SourceAnalysis {
  return {
    fileName,
    fileSize: 4,
    sourceApp: 'OrcaSlicer',
    plates: 1,
    objects: 1,
    triangles: 12,
    colors: [{ slot: 1, color: '#000000', type: 'PLA', name: 'PLA', used: true }],
    usedColorCount: 1,
    hasPaint: false,
    hasCustomSupports: false,
    hasCustomSeams: false,
    hasProjectSettings: true,
    isSliced: false,
    warnings: [],
  };
}

describe('upload store persistence', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'ff3mf-store-'));
    process.env.DATA_DIR = directory;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    vi.resetModules();
  });

  it('restores a staged upload after a process restart', async () => {
    const first = await import('../src/store.js');
    first.ensureDataDirs();
    const id = randomUUID();
    const inputPath = path.join(directory, 'uploads', id, 'input.3mf');
    mkdirSync(path.dirname(inputPath), { recursive: true });
    writeFileSync(inputPath, '3mf!');
    first.createUpload(id, inputPath, 'GTA.3mf', 4, analysis('GTA.3mf'));

    vi.resetModules();
    const restoredStore = await import('../src/store.js');
    expect(restoredStore.getUpload(id)).toBeUndefined();

    restoredStore.ensureDataDirs();
    restoredStore.restoreUploads();

    expect(restoredStore.getUpload(id)).toMatchObject({
      id,
      inputPath,
      originalName: 'GTA.3mf',
      size: 4,
    });
  });

  it('removes expired staged uploads', async () => {
    const store = await import('../src/store.js');
    store.ensureDataDirs();
    const id = randomUUID();
    const uploadDirectory = path.join(directory, 'uploads', id);
    const inputPath = path.join(uploadDirectory, 'input.3mf');
    mkdirSync(uploadDirectory, { recursive: true });
    writeFileSync(inputPath, '3mf!');
    writeFileSync(
      path.join(uploadDirectory, 'upload.json'),
      JSON.stringify({
        id,
        originalName: 'old.3mf',
        size: 4,
        analysis: analysis('old.3mf'),
        createdAt: Date.now() - 120_000,
        expiresAt: Date.now() - 60_000,
      }),
    );

    store.restoreUploads();

    expect(store.getUpload(id)).toBeUndefined();
    expect(existsSync(uploadDirectory)).toBe(false);
  });
});
