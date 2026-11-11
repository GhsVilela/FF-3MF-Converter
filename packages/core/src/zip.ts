import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import yazl from 'yazl';
import { ConversionError } from './errors.js';
import { DEFAULT_LIMITS, type ConversionLimits } from './limits.js';

export interface ZipContents {
  names: string[];
  files: Map<string, Buffer>;
}

function normalizeEntryName(name: string): string {
  const normalized = name.replaceAll('\\', '/');
  if (
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    throw new ConversionError('UNSAFE_PATH', `Unsafe archive path: ${name}`);
  }
  return normalized;
}

function openZip(filePath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (error || !zip) {
        reject(new ConversionError('INVALID_ZIP', 'The file is not a valid ZIP/3MF archive'));
        return;
      }
      resolve(zip);
    });
  });
}

function readEntry(zip: ZipFile, entry: Entry, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error(`Unable to read archive entry ${entry.fileName}`));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      stream.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          stream.destroy();
          reject(new ConversionError('ZIP_LIMIT', `Archive entry is too large: ${entry.fileName}`));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  });
}

export async function readZip(
  filePath: string,
  limits: ConversionLimits = DEFAULT_LIMITS,
): Promise<ZipContents> {
  const zip = await openZip(filePath);
  const files = new Map<string, Buffer>();
  const names: string[] = [];
  let totalUncompressed = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          try {
            if (entry.fileName.endsWith('/')) {
              zip.readEntry();
              return;
            }
            if (names.length >= limits.maxEntries) {
              throw new ConversionError('ZIP_LIMIT', 'Archive contains too many entries');
            }
            const name = normalizeEntryName(entry.fileName);
            if (files.has(name)) {
              throw new ConversionError('INVALID_ZIP', `Duplicate archive entry: ${name}`);
            }
            if (entry.uncompressedSize > limits.maxEntryBytes) {
              throw new ConversionError('ZIP_LIMIT', `Archive entry is too large: ${name}`);
            }
            totalUncompressed += entry.uncompressedSize;
            if (totalUncompressed > limits.maxUncompressedBytes) {
              throw new ConversionError('ZIP_LIMIT', 'Archive expands beyond the safety limit');
            }
            const ratio =
              entry.compressedSize === 0
                ? entry.uncompressedSize > 0
                  ? Number.POSITIVE_INFINITY
                  : 1
                : entry.uncompressedSize / entry.compressedSize;
            if (ratio > limits.maxCompressionRatio) {
              throw new ConversionError('ZIP_LIMIT', `Suspicious compression ratio: ${name}`);
            }

            const buffer = await readEntry(zip, entry, limits.maxEntryBytes);
            files.set(name, buffer);
            names.push(name);
            zip.readEntry();
          } catch (error) {
            reject(error);
          }
        })();
      });
      zip.on('end', resolve);
      zip.on('error', reject);
      zip.readEntry();
    });
  } finally {
    zip.close();
  }

  return { names, files };
}

export interface ZipOutputEntry {
  name: string;
  data: Buffer | string;
  compress?: boolean;
}

export async function writeZip(outputPath: string, entries: ZipOutputEntry[]): Promise<void> {
  const zip = new yazl.ZipFile();
  for (const entry of entries) {
    zip.addBuffer(
      Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8'),
      entry.name,
      {
        mtime: new Date('2000-01-01T00:00:00Z'),
        compress: entry.compress ?? true,
      },
    );
  }
  zip.end();
  await pipeline(zip.outputStream as Readable, createWriteStream(outputPath));
}

export function textFile(contents: ZipContents, name: string): string | undefined {
  const buffer = contents.files.get(name);
  return buffer ? buffer.toString('utf8') : undefined;
}
